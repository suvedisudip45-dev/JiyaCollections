import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import { applyNcmStatus, reconcileActiveDeliveries, reconcileDelivery, reconcileDueActiveDeliveries, requestDeliveryReturn } from "../services/deliveryService.js";
import { reconcileCustomerReturnNcmStatus } from "../services/customerReturnWorkflowService.js";

const replaceMethods = (replacements) => {
  const originals = replacements.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, value] of replacements) target[key] = value;
  return () => {
    for (const [target, key, original] of originals.reverse()) target[key] = original;
  };
};

const statusLookupMocks = (delivery, tx) => replaceMethods([
  [prisma.stockTransferShipment, "findMany", async () => []],
  [prisma.deliveryOrder, "findMany", async () => [delivery]],
  [prisma.customerReturn, "findFirst", async () => null],
  [prisma, "$transaction", async (callback) => callback(tx)],
]);

test("active NCM delivery reconciliation syncs a bounded batch and reports remaining deliveries", async () => {
  const activeDeliveries = Array.from({ length: 26 }, (_, index) => ({
    id: `delivery-active-${String(index + 1).padStart(2, "0")}`,
    orderId: `order-active-${String(index + 1).padStart(2, "0")}`,
    ncmOrderId: 15000 + index,
    state: "IN_TRANSIT",
    ncmStatus: "In Transit",
    ncmReconciliationRequired: false,
  }));
  const deliveriesById = new Map(activeDeliveries.map((delivery) => [delivery.id, delivery]));
  const queryArgs = [];
  let fetchCount = 0;
  let reconciliationEventCount = 0;
  const tx = {
    deliveryEvent: {
      create: async () => {
        reconciliationEventCount += 1;
        return { id: `reconciliation-event-${reconciliationEventCount}` };
      },
    },
    deliveryOrder: {
      update: async ({ where, data }) => {
        const updated = { ...deliveriesById.get(where.id), ...data };
        deliveriesById.set(where.id, updated);
        return updated;
      },
    },
  };
  const originalFetch = global.fetch;
  const originalToken = process.env.NCM_API_TOKEN;
  const originalBaseUrl = process.env.NCM_API_BASE_URL;
  const originalAttempts = process.env.NCM_HTTP_MAX_ATTEMPTS;
  const restore = replaceMethods([
    [prisma.deliveryOrder, "findMany", async (args) => {
      queryArgs.push(args);
      return activeDeliveries.filter((delivery) => !args.where.id || delivery.id > args.where.id.gt);
    }],
    [prisma.deliveryOrder, "findUnique", async ({ where }) => deliveriesById.get(where.id)],
    [prisma, "$transaction", async (callback) => callback(tx)],
  ]);
  process.env.NCM_API_TOKEN = "test-token";
  process.env.NCM_API_BASE_URL = "https://ncm.test";
  process.env.NCM_HTTP_MAX_ATTEMPTS = "1";
  global.fetch = async (input) => {
    fetchCount += 1;
    if (new URL(String(input)).searchParams.get("id") === "15000") {
      return new Response(JSON.stringify({ detail: "Temporary provider failure" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await reconcileActiveDeliveries({ actorId: "admin-1" });

    assert.equal(queryArgs[0].take, 26);
    assert.deepEqual(queryArgs[0].orderBy, { id: "asc" });
    assert.equal(fetchCount, 25);
    assert.equal(reconciliationEventCount, 25);
    assert.equal(result.count, 25);
    assert.equal(result.reconciledCount, 0);
    assert.equal(result.reviewCount, 24);
    assert.equal(result.failedCount, 1);
    assert.equal(result.hasMore, true);
    assert.equal(result.nextAfterId, "delivery-active-25");
    assert.equal(result.results[0].outcome, "FAILED");
    assert.equal(result.results[1].outcome, "NEEDS_REVIEW");

    const finalPage = await reconcileActiveDeliveries({ afterId: result.nextAfterId });
    assert.deepEqual(queryArgs[1].where.id, { gt: "delivery-active-25" });
    assert.equal(finalPage.count, 1);
    assert.equal(finalPage.hasMore, false);
    assert.equal(finalPage.nextAfterId, null);
    assert.equal(fetchCount, 26);
    assert.equal(reconciliationEventCount, 26);
  } finally {
    restore();
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.NCM_API_TOKEN;
    else process.env.NCM_API_TOKEN = originalToken;
    if (originalBaseUrl === undefined) delete process.env.NCM_API_BASE_URL;
    else process.env.NCM_API_BASE_URL = originalBaseUrl;
    if (originalAttempts === undefined) delete process.env.NCM_HTTP_MAX_ATTEMPTS;
    else process.env.NCM_HTTP_MAX_ATTEMPTS = originalAttempts;
  }
});

test("scheduled NCM reconciliation selects stale active deliveries and continues after provider failures", async (t) => {
  const olderThan = new Date("2026-11-09T10:00:00.000Z");
  const activeDeliveries = [
    { id: "delivery-due-01", orderId: "order-due-01", ncmOrderId: 15001, state: "IN_TRANSIT", ncmReconciliationRequired: false },
    { id: "delivery-due-02", orderId: "order-due-02", ncmOrderId: 15002, state: "OUT_FOR_DELIVERY", ncmReconciliationRequired: false },
  ];
  const deliveriesById = new Map(activeDeliveries.map((delivery) => [delivery.id, delivery]));
  const deliveryQueries = [];
  const reconciliationEventSources = [];
  let fetchCount = 0;
  const tx = {
    deliveryEvent: {
      create: async ({ data }) => {
        reconciliationEventSources.push(data.source);
        return { id: "reconciliation-event" };
      },
    },
    deliveryOrder: {
      update: async ({ where, data }) => {
        const updated = { ...deliveriesById.get(where.id), ...data };
        deliveriesById.set(where.id, updated);
        return updated;
      },
    },
  };
  const originalFetch = global.fetch;
  const originalToken = process.env.NCM_API_TOKEN;
  const originalBaseUrl = process.env.NCM_API_BASE_URL;
  const originalAttempts = process.env.NCM_HTTP_MAX_ATTEMPTS;
  process.env.NCM_API_TOKEN = "test-token";
  process.env.NCM_API_BASE_URL = "https://ncm.test";
  process.env.NCM_HTTP_MAX_ATTEMPTS = "1";
  global.fetch = async (input) => {
    fetchCount += 1;
    if (new URL(String(input)).searchParams.get("id") === "15001") {
      return new Response(JSON.stringify({ detail: "Temporary provider failure" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const restore = replaceMethods([
    [prisma.deliveryOrder, "findMany", async (args) => {
      deliveryQueries.push(args);
      return args.where.state ? activeDeliveries : [];
    }],
    [prisma.deliveryOrder, "findUnique", async ({ where }) => deliveriesById.get(where.id)],
    [prisma.stockTransferShipment, "findMany", async () => []],
    [prisma.customerReturn, "findFirst", async () => null],
    [prisma.orderExchangeRequest, "findFirst", async () => null],
    [prisma, "$transaction", async (callback) => callback(tx)],
  ]);
  t.after(() => {
    restore();
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.NCM_API_TOKEN;
    else process.env.NCM_API_TOKEN = originalToken;
    if (originalBaseUrl === undefined) delete process.env.NCM_API_BASE_URL;
    else process.env.NCM_API_BASE_URL = originalBaseUrl;
    if (originalAttempts === undefined) delete process.env.NCM_HTTP_MAX_ATTEMPTS;
    else process.env.NCM_HTTP_MAX_ATTEMPTS = originalAttempts;
  });

  const result = await reconcileDueActiveDeliveries({ olderThan, limit: 2, actorId: "job-test" });

  assert.deepEqual(deliveryQueries[0].where.OR, [
    { lastSyncedAt: null },
    { lastSyncedAt: { lt: olderThan } },
  ]);
  assert.equal(deliveryQueries[0].where.ncmReconciliationRequired, false);
  assert.deepEqual(deliveryQueries[0].orderBy, [{ lastSyncedAt: "asc" }, { id: "asc" }]);
  assert.equal(deliveryQueries[0].take, 3);
  assert.equal(fetchCount, 2);
  assert.equal(result.count, 2);
  assert.equal(result.failedCount, 1);
  assert.equal(result.reviewCount, 1);
  assert.equal(result.hasMore, false);
  assert.deepEqual(reconciliationEventSources, ["SCHEDULED_RECONCILIATION", "SCHEDULED_RECONCILIATION"]);
  assert.equal(deliveriesById.get("delivery-due-01").ncmReconciliationRequired, true);
  assert.equal(deliveriesById.get("delivery-due-02").ncmReconciliationRequired, true);
});

test("NCM delivery commits delivered state and accounting outbox event in one transaction", async () => {
  const delivery = {
    id: "delivery-ncm-1",
    orderId: "order-ncm-1",
    state: "IN_TRANSIT",
    ncmOrderId: 12345,
    codAmount: 0,
    customerDeliveryCharge: 0,
    ncmDeliveryCharge: 0,
    order: { paymentMethod: "COD", payment: false },
  };
  const order = {
    id: "order-ncm-1",
    amount: 226,
    deliveryFee: 22.6,
    items: [{ productId: "product-1", quantity: 1 }],
    paymentMethod: "COD",
    orderType: "ONLINE_STORE",
    userId: "customer-1",
  };
  let committedDeliveryState = delivery.state;
  let committedAccountingEvent = null;
  let stagedDeliveryState = null;
  let stagedAccountingEvent = null;
  const tx = {
    deliveryEvent: { create: async () => ({ id: "delivery-event-1" }) },
    deliveryOrder: {
      update: async ({ data }) => {
        stagedDeliveryState = data.state;
        return { ...delivery, ...data };
      },
    },
    order: {
      findUnique: async () => order,
      update: async ({ data }) => ({ ...order, ...data }),
    },
    orderAssignment: {
      findUnique: async () => null,
      updateMany: async () => ({ count: 1 }),
    },
    collaborationSale: { updateMany: async () => ({ count: 0 }) },
    manufacturerInventoryCostAllocation: { findMany: async () => [] },
    accountingEvent: {
      upsert: async ({ create }) => {
        stagedAccountingEvent = { id: "accounting-event-1", ...create };
        return stagedAccountingEvent;
      },
    },
  };
  const restore = statusLookupMocks(delivery, {
    ...tx,
    deliveryOrder: {
      ...tx.deliveryOrder,
      update: async ({ data }) => {
        stagedDeliveryState = data.state;
        return { ...delivery, ...data };
      },
    },
  });
  prisma.$transaction = async (callback) => {
    const result = await callback(tx);
    committedDeliveryState = stagedDeliveryState;
    committedAccountingEvent = stagedAccountingEvent;
    return result;
  };

  try {
    const result = await applyNcmStatus({
      payload: {
        order_id: "12345",
        status: "Delivered",
        event: "delivery_completed",
        timestamp: "2026-10-16T10:00:00.000Z",
      },
    });

    assert.equal(result[0].deliveryState, "DELIVERED");
    assert.equal(result[0].accountingStatus, "PENDING");
    assert.equal(committedDeliveryState, "DELIVERED");
    assert.equal(committedAccountingEvent.status, "PENDING");
    assert.equal(committedAccountingEvent.idempotencyKey, "DELIVERY_SALE:order-ncm-1");
    assert.equal(committedAccountingEvent.payload.order.deliveryCharge, "22.6");
  } finally {
    restore();
  }
});

test("unmapped or negative NCM statuses queue for reconciliation without fulfillment or accounting side effects", async () => {
  const delivery = {
    id: "delivery-ncm-ambiguous",
    orderId: "order-ncm-ambiguous",
    state: "IN_TRANSIT",
    ncmOrderId: 12346,
    codAmount: 1500,
    customerDeliveryCharge: 100,
    ncmDeliveryCharge: 80,
    ncmReconciliationRequired: false,
    order: { paymentMethod: "COD", payment: false },
  };
  let deliveryUpdate = null;
  let orderUpdateCount = 0;
  let accountingEventCount = 0;
  const tx = {
    deliveryEvent: { create: async () => ({ id: "delivery-event-ambiguous" }) },
    deliveryOrder: {
      update: async ({ data }) => {
        deliveryUpdate = data;
        return { ...delivery, ...data };
      },
    },
    order: { update: async () => { orderUpdateCount += 1; } },
    orderAssignment: { updateMany: async () => ({ count: 1 }) },
    accountingEvent: { upsert: async () => { accountingEventCount += 1; } },
    deliveryReturn: { upsert: async () => { throw new Error("Unexpected return processing"); } },
    deliveryFinancialSettlement: { upsert: async () => { throw new Error("Unexpected settlement"); } },
  };
  const restore = statusLookupMocks(delivery, tx);

  try {
    const results = await applyNcmStatus({
      payload: {
        order_id: "12346",
        status: "Not delivered",
        event: "delivery_completed",
        timestamp: "2026-10-16T10:05:00.000Z",
      },
    });

    assert.equal(results[0].deliveryState, "NEEDS_RECONCILIATION");
    assert.equal(results[0].reconciliationRequired, true);
    assert.equal(deliveryUpdate.state, undefined);
    assert.equal(deliveryUpdate.ncmReconciliationRequired, true);
    assert.match(deliveryUpdate.ncmReconciliationReason, /Unrecognized or conflicting/);
    assert.equal(orderUpdateCount, 0);
    assert.equal(accountingEventCount, 0);
  } finally {
    restore();
  }
});

test("Admin reconciliation fetches NCM status and queues an unrecognized provider response", async () => {
  const delivery = {
    id: "delivery-ncm-remote",
    orderId: "order-ncm-remote",
    state: "IN_TRANSIT",
    ncmOrderId: 12348,
    ncmStatus: "Dispatched",
    ncmReconciliationRequired: false,
    order: { paymentMethod: "COD", payment: false },
  };
  let updateData = null;
  let orderUpdateCount = 0;
  let fetchedUrl = "";
  let deliveryReads = 0;
  const originalFetch = global.fetch;
  const originalToken = process.env.NCM_API_TOKEN;
  const originalBaseUrl = process.env.NCM_API_BASE_URL;
  process.env.NCM_API_TOKEN = "test-ncm-token";
  process.env.NCM_API_BASE_URL = "https://ncm.test";
  global.fetch = async (url) => {
    fetchedUrl = String(url);
    return new Response(JSON.stringify({
      data: [{ status: "Processing exception", added_time: "2026-10-16T10:05:00.000Z" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const tx = {
    deliveryEvent: { create: async () => ({ id: "delivery-event-remote" }) },
    deliveryOrder: {
      update: async ({ data }) => {
        updateData = data;
        return { ...delivery, ...data };
      },
    },
    order: { update: async () => { orderUpdateCount += 1; } },
    orderAssignment: { updateMany: async () => ({ count: 1 }) },
    accountingEvent: { upsert: async () => { throw new Error("Unexpected accounting post"); } },
  };
  const restore = replaceMethods([
    [prisma.stockTransferShipment, "findMany", async () => []],
    [prisma.deliveryOrder, "findMany", async () => [delivery]],
    [prisma.customerReturn, "findFirst", async () => null],
    [prisma.deliveryOrder, "findUnique", async () => {
      deliveryReads += 1;
      return deliveryReads === 1 ? delivery : { ...delivery, ...updateData, events: [] };
    }],
    [prisma, "$transaction", async (callback) => callback(tx)],
  ]);

  try {
    const result = await reconcileDelivery(delivery.id, { actorId: "admin-1" });

    assert.match(fetchedUrl, /\/api\/v1\/order\/status\?id=12348$/);
    assert.equal(result.ncmReconciliationRequired, true);
    assert.equal(result.state, "IN_TRANSIT");
    assert.match(result.ncmReconciliationReason, /Processing exception/);
    assert.equal(updateData.state, undefined);
    assert.equal(orderUpdateCount, 0);
  } finally {
    restore();
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.NCM_API_TOKEN;
    else process.env.NCM_API_TOKEN = originalToken;
    if (originalBaseUrl === undefined) delete process.env.NCM_API_BASE_URL;
    else process.env.NCM_API_BASE_URL = originalBaseUrl;
  }
});

test("stale NCM status cannot regress delivered state or trigger repeat sale accounting", async () => {
  const delivery = {
    id: "delivery-ncm-stale",
    orderId: "order-ncm-stale",
    state: "DELIVERED",
    deliveredAt: new Date("2026-10-16T09:00:00.000Z"),
    ncmOrderId: 12347,
    codAmount: 0,
    customerDeliveryCharge: 0,
    ncmDeliveryCharge: 0,
    ncmReconciliationRequired: false,
    order: { paymentMethod: "COD", payment: true },
  };
  let deliveryUpdate = null;
  let orderUpdateCount = 0;
  let accountingEventCount = 0;
  const tx = {
    deliveryEvent: { create: async () => ({ id: "delivery-event-stale" }) },
    deliveryOrder: {
      update: async ({ data }) => {
        deliveryUpdate = data;
        return { ...delivery, ...data };
      },
    },
    order: { update: async () => { orderUpdateCount += 1; } },
    orderAssignment: { updateMany: async () => ({ count: 1 }) },
    accountingEvent: { upsert: async () => { accountingEventCount += 1; } },
  };
  const restore = statusLookupMocks(delivery, tx);

  try {
    const results = await applyNcmStatus({
      payload: {
        order_id: "12347",
        status: "Dispatched",
        event: "order_dispatched",
        timestamp: "2026-10-16T08:00:00.000Z",
      },
    });

    assert.equal(results[0].stale, true);
    assert.equal(results[0].reconciliationRequired, true);
    assert.equal(deliveryUpdate.state, undefined);
    assert.equal(deliveryUpdate.ncmReconciliationRequired, true);
    assert.equal(orderUpdateCount, 0);
    assert.equal(accountingEventCount, 0);
  } finally {
    restore();
  }
});

test("older delivered status cannot advance an order or post accounting", async () => {
  const delivery = {
    id: "delivery-ncm-old-delivered",
    orderId: "order-ncm-old-delivered",
    state: "IN_TRANSIT",
    ncmOrderId: 12349,
    codAmount: 0,
    customerDeliveryCharge: 0,
    ncmDeliveryCharge: 0,
    ncmReconciliationRequired: false,
    events: [{ occurredAt: new Date("2026-10-16T09:00:00.000Z") }],
    order: { paymentMethod: "COD", payment: false },
  };
  let deliveryUpdate = null;
  let orderUpdateCount = 0;
  let accountingEventCount = 0;
  const tx = {
    deliveryEvent: { create: async () => ({ id: "delivery-event-old-delivered" }) },
    deliveryOrder: {
      update: async ({ data }) => {
        deliveryUpdate = data;
        return { ...delivery, ...data };
      },
    },
    order: { update: async () => { orderUpdateCount += 1; } },
    orderAssignment: { updateMany: async () => ({ count: 1 }) },
    accountingEvent: { upsert: async () => { accountingEventCount += 1; } },
  };
  const restore = statusLookupMocks(delivery, tx);

  try {
    const results = await applyNcmStatus({
      payload: {
        order_id: "12349",
        status: "Delivered",
        event: "delivery_completed",
        timestamp: "2026-10-16T08:00:00.000Z",
      },
    });

    assert.equal(results[0].stale, true);
    assert.equal(results[0].reconciliationRequired, true);
    assert.equal(deliveryUpdate.state, undefined);
    assert.equal(deliveryUpdate.ncmReconciliationRequired, true);
    assert.equal(orderUpdateCount, 0);
    assert.equal(accountingEventCount, 0);
  } finally {
    restore();
  }
});

test("NCM return after delivery preserves COD and does not claim physical receipt", async () => {
  const delivery = {
    id: "delivery-ncm-return-after-delivery",
    orderId: "order-ncm-return-after-delivery",
    state: "DELIVERED",
    deliveredAt: new Date("2026-10-16T10:00:00.000Z"),
    ncmOrderId: 12350,
    codAmount: 1500,
    customerDeliveryCharge: 100,
    ncmDeliveryCharge: 80,
    ncmDeliveryDiscount: 20,
    order: { paymentMethod: "COD", payment: true },
    events: [],
  };
  const existingSettlement = {
    id: "settlement-ncm-return-after-delivery",
    deliveryOrderId: delivery.id,
    codExpected: 1500,
    settlementState: "PENDING",
  };
  let orderUpdate = null;
  let deliveryUpdate = null;
  let settlementUpdate = null;
  let returnRecord = null;
  const tx = {
    deliveryEvent: { create: async () => ({ id: "delivery-event-return" }) },
    deliveryOrder: {
      update: async ({ data }) => {
        deliveryUpdate = data;
        return { ...delivery, ...data };
      },
    },
    order: {
      update: async ({ data }) => {
        orderUpdate = data;
        return { ...delivery.order, ...data };
      },
    },
    orderAssignment: { updateMany: async () => ({ count: 1 }) },
    deliveryReturn: {
      upsert: async ({ create }) => {
        returnRecord = create;
        return { id: "delivery-return-1", ...create };
      },
    },
    deliveryFinancialSettlement: {
      findUnique: async () => existingSettlement,
      updateMany: async ({ where, data }) => {
        settlementUpdate = { where, data };
        return { count: 1 };
      },
    },
  };
  const restore = statusLookupMocks(delivery, tx);

  try {
    const [result] = await applyNcmStatus({
      payload: {
        order_id: "12350",
        status: "Returned",
        event: "order_returned",
        timestamp: "2026-10-16T11:00:00.000Z",
      },
    });

    assert.equal(result.deliveryState, "RETURN_REQUESTED");
    assert.equal(orderUpdate.payment, true);
    assert.equal(orderUpdate.status, undefined);
    assert.equal(orderUpdate.fulfillmentStatus, "return_requested");
    assert.equal(deliveryUpdate.returnedAt, undefined);
    assert.equal(returnRecord.state, "RETURN_REQUESTED");
    assert.equal(settlementUpdate.data.settlementState, "RETURN_PENDING");
    assert.equal(settlementUpdate.data.codExpected, undefined);
    assert.equal(existingSettlement.codExpected, 1500);
  } finally {
    restore();
  }
});

test("NCM return after a settled COD remittance leaves the settlement posted", async () => {
  const delivery = {
    id: "delivery-ncm-settled-return",
    orderId: "order-ncm-settled-return",
    state: "DELIVERED",
    deliveredAt: new Date("2026-10-16T10:00:00.000Z"),
    ncmOrderId: 12351,
    codAmount: 1500,
    customerDeliveryCharge: 100,
    order: { paymentMethod: "COD", payment: true },
    events: [],
  };
  const existingSettlement = {
    id: "settlement-ncm-settled-return",
    deliveryOrderId: delivery.id,
    codExpected: 1500,
    settlementState: "SETTLED",
    journalEntryId: "journal-ncm-remittance",
  };
  let settlementUpdate = null;
  const tx = {
    deliveryEvent: { create: async () => ({ id: "delivery-event-settled-return" }) },
    deliveryOrder: { update: async ({ data }) => ({ ...delivery, ...data }) },
    order: { update: async ({ data }) => ({ ...delivery.order, ...data }) },
    orderAssignment: { updateMany: async () => ({ count: 1 }) },
    deliveryReturn: { upsert: async ({ create }) => ({ id: "delivery-return-2", ...create }) },
    deliveryFinancialSettlement: {
      findUnique: async () => existingSettlement,
      update: async ({ data }) => {
        settlementUpdate = data;
        return { ...existingSettlement, ...data };
      },
    },
  };
  const restore = statusLookupMocks(delivery, tx);

  try {
    await applyNcmStatus({
      payload: {
        order_id: "12351",
        status: "Returned",
        event: "order_returned",
        timestamp: "2026-10-16T11:00:00.000Z",
      },
    });

    assert.equal(settlementUpdate.settlementState, undefined);
    assert.equal(settlementUpdate.codExpected, undefined);
    assert.equal(settlementUpdate.deliveryFeeActual, undefined);
    assert.equal(settlementUpdate.journalEntryId, undefined);
    assert.match(settlementUpdate.varianceReason, /after delivery/);
  } finally {
    restore();
  }
});

test("NCM return before delivery creates a zero-COD pending settlement", async () => {
  const delivery = {
    id: "delivery-ncm-return-before-delivery",
    orderId: "order-ncm-return-before-delivery",
    state: "IN_TRANSIT",
    ncmOrderId: 12353,
    codAmount: 1500,
    customerDeliveryCharge: 100,
    ncmDeliveryCharge: 80,
    ncmDeliveryDiscount: 20,
    order: { paymentMethod: "COD", payment: false },
    events: [],
  };
  let settlementCreate = null;
  let orderUpdate = null;
  const tx = {
    deliveryEvent: { create: async () => ({ id: "delivery-event-pre-delivery-return" }) },
    deliveryOrder: { update: async ({ data }) => ({ ...delivery, ...data }) },
    order: {
      update: async ({ data }) => {
        orderUpdate = data;
        return { ...delivery.order, ...data };
      },
    },
    orderAssignment: { updateMany: async () => ({ count: 1 }) },
    deliveryReturn: {
      upsert: async ({ create }) => ({ id: "delivery-return-pre-delivery", ...create }),
    },
    deliveryFinancialSettlement: {
      findUnique: async () => null,
      create: async ({ data }) => {
        settlementCreate = data;
        return { id: "settlement-pre-delivery-return", ...data };
      },
    },
  };
  const restore = statusLookupMocks(delivery, tx);

  try {
    await applyNcmStatus({
      payload: {
        order_id: "12353",
        status: "Returned",
        event: "order_returned",
        timestamp: "2026-10-16T11:00:00.000Z",
      },
    });

    assert.equal(settlementCreate.codExpected, 0);
    assert.equal(settlementCreate.settlementState, "RETURN_PENDING");
    assert.equal(settlementCreate.deliveryFeeExpected, 100);
    assert.equal(settlementCreate.deliveryFeeActual, 80);
    assert.equal(orderUpdate.status, undefined);
    assert.equal(orderUpdate.fulfillmentStatus, "return_requested");
  } finally {
    restore();
  }
});

test("NCM delivery is not acknowledged as successful when COD settlement tracking fails", async () => {
  const delivery = {
    id: "delivery-ncm-settlement-failure",
    orderId: "order-ncm-settlement-failure",
    state: "IN_TRANSIT",
    ncmOrderId: 12352,
    codAmount: 1500,
    customerDeliveryCharge: 100,
    ncmDeliveryCharge: 80,
    order: { paymentMethod: "COD", payment: false },
    events: [],
  };
  const tx = {
    deliveryEvent: { create: async () => ({ id: "delivery-event-settlement-failure" }) },
    deliveryOrder: { update: async ({ data }) => ({ ...delivery, ...data }) },
    order: {
      findUnique: async () => ({
        id: delivery.orderId,
        amount: 1500,
        items: [],
        paymentMethod: "COD",
        orderType: "ONLINE_STORE",
        userId: "customer-settlement-failure",
      }),
      update: async ({ data }) => ({ ...delivery.order, ...data }),
    },
    orderAssignment: {
      findUnique: async () => null,
      updateMany: async () => ({ count: 1 }),
    },
    deliveryFinancialSettlement: {
      upsert: async () => {
        throw new Error("Settlement storage unavailable");
      },
    },
    accountingEvent: { upsert: async () => ({ id: "unused-accounting-event" }) },
    collaborationSale: { updateMany: async () => ({ count: 0 }) },
    manufacturerInventoryCostAllocation: { findMany: async () => [] },
  };
  const restore = statusLookupMocks(delivery, tx);

  try {
    await assert.rejects(applyNcmStatus({
      payload: {
        order_id: "12352",
        status: "Delivered",
        event: "delivery_completed",
        timestamp: "2026-10-16T10:00:00.000Z",
      },
    }), /Settlement storage unavailable/);
  } finally {
    restore();
  }
});

test("manual NCM return request does not mark the order physically returned", async () => {
  const delivery = {
    id: "delivery-ncm-manual-return",
    orderId: "order-ncm-manual-return",
    manufacturerId: "manufacturer-1",
    state: "IN_TRANSIT",
    ncmOrderId: 12354,
    codAmount: 1500,
    customerDeliveryCharge: 100,
    ncmDeliveryCharge: 80,
    order: { paymentMethod: "COD", payment: false },
  };
  let orderUpdate = null;
  let deliveryUpdate = null;
  let settlementCreate = null;
  let requestedUrl = "";
  let requestedBody = null;
  const originalFetch = global.fetch;
  const originalToken = process.env.NCM_API_TOKEN;
  const originalBaseUrl = process.env.NCM_API_BASE_URL;
  process.env.NCM_API_TOKEN = "test-ncm-token";
  process.env.NCM_API_BASE_URL = "https://ncm.test";
  global.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ data: { success: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const tx = {
    deliveryReturn: {
      create: async ({ data }) => ({ id: "manual-delivery-return", ...data }),
    },
    deliveryOrder: {
      update: async ({ data }) => {
        deliveryUpdate = data;
        return { ...delivery, ...data };
      },
    },
    order: {
      update: async ({ data }) => {
        orderUpdate = data;
        return { ...delivery.order, ...data };
      },
    },
    deliveryFinancialSettlement: {
      findUnique: async () => null,
      create: async ({ data }) => {
        settlementCreate = data;
        return { id: "manual-return-settlement", ...data };
      },
    },
    deliveryEvent: { create: async () => ({ id: "manual-return-event" }) },
  };
  const restore = replaceMethods([
    [prisma.deliveryOrder, "findUnique", async () => delivery],
    [prisma.deliveryReturn, "findUnique", async () => null],
    [prisma, "$transaction", async (callback) => callback(tx)],
  ]);

  try {
    await requestDeliveryReturn({
      deliveryId: delivery.id,
      manufacturerId: "manufacturer-1",
      reason: "Customer unavailable",
    });

    assert.match(requestedUrl, /\/api\/v2\/vendor\/order\/return$/);
    assert.deepEqual(requestedBody, { pk: 12354, comment: "Customer unavailable" });
    assert.equal(deliveryUpdate.returnedAt, undefined);
    assert.equal(orderUpdate.status, undefined);
    assert.equal(orderUpdate.fulfillmentStatus, "return_requested");
    assert.equal(settlementCreate.codExpected, 0);
    assert.equal(settlementCreate.settlementState, "RETURN_PENDING");
  } finally {
    restore();
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.NCM_API_TOKEN;
    else process.env.NCM_API_TOKEN = originalToken;
    if (originalBaseUrl === undefined) delete process.env.NCM_API_BASE_URL;
    else process.env.NCM_API_BASE_URL = originalBaseUrl;
  }
});

test("NCM Sent to Vendor confirms warehouse receipt without completing return accounting", async () => {
  const attemptedAt = new Date("2026-10-16T10:00:00.000Z");
  const occurredAt = new Date("2026-10-16T11:00:00.000Z");
  const customerReturn = {
    id: "customer-return-ncm-received",
    requestKey: "return-request-key",
    originalNcmOrderId: 12355,
    ncmReturnOrderId: 12355,
    lifecycleStatus: "NCM_RETURN_INITIATED",
    returnPickupStatus: "AWAITING_PICKUP",
    ncmSubmissionAttemptedAt: attemptedAt,
    returnPickupCompletedAt: null,
    manufacturerReceivedAt: null,
  };
  let returnUpdate = null;
  let returnEvent = null;
  const tx = {
    customerReturn: {
      update: async ({ data }) => {
        returnUpdate = data;
        return { ...customerReturn, ...data };
      },
    },
    customerReturnEvent: {
      create: async ({ data }) => {
        returnEvent = data;
        return { id: "customer-return-event", ...data };
      },
    },
  };
  const restore = replaceMethods([
    [prisma.stockTransferShipment, "findMany", async () => []],
    [prisma.deliveryOrder, "findMany", async () => []],
    [prisma.customerReturn, "findFirst", async () => customerReturn],
    [prisma, "$transaction", async (callback) => callback(tx)],
  ]);

  try {
    const [result] = await applyNcmStatus({
      payload: {
        order_id: "12355",
        status: "Sent to Vendor",
        event: "order.status.changed",
        timestamp: occurredAt.toISOString(),
      },
    });

    assert.equal(result.customerReturn, true);
    assert.equal(returnUpdate.lifecycleStatus, "RECEIVED_AT_WAREHOUSE");
    assert.equal(returnUpdate.returnPickupStatus, "DELIVERED_TO_MANUFACTURER");
    assert.equal(returnUpdate.manufacturerReceivedAt.toISOString(), occurredAt.toISOString());
    assert.equal(returnUpdate.inspectedAt, undefined);
    assert.equal(returnUpdate.refundStatus, undefined);
    assert.equal(returnEvent.toStatus, "RECEIVED_AT_WAREHOUSE");
  } finally {
    restore();
  }
});

test("Admin NCM return reconciliation replays timestamped statuses oldest-first", async () => {
  const attemptedAt = new Date("2026-10-16T08:00:00.000Z");
  const initialReturn = {
    id: "customer-return-ncm-poll",
    deliveryRoute: "NCM",
    originalNcmOrderId: 12356,
    ncmReturnOrderId: 12356,
    lifecycleStatus: "NCM_RETURN_INITIATED",
    returnPickupStatus: "AWAITING_PICKUP",
    ncmSubmissionAttemptedAt: attemptedAt,
    returnPickupCompletedAt: null,
    manufacturerReceivedAt: null,
  };
  let lifecycleStatus = initialReturn.lifecycleStatus;
  let returnPickupStatus = initialReturn.returnPickupStatus;
  const returnEvents = [];
  let fetchedUrl = "";
  const originalFetch = global.fetch;
  const originalToken = process.env.NCM_API_TOKEN;
  const originalBaseUrl = process.env.NCM_API_BASE_URL;
  const statusHistory = [
    { status: "Delivered", added_time: "2026-10-15T12:00:00.000Z" },
    { status: "Pickup Complete", added_time: "2026-10-16T09:00:00.000Z" },
  ];
  for (let index = 0; index < 101; index += 1) {
    statusHistory.push({
      status: "Sent for Delivery",
      added_time: new Date(Date.parse("2026-10-16T09:01:00.000Z") + index * 60000).toISOString(),
    });
  }
  statusHistory.push(
    { status: "Sent to Vendor", added_time: "2026-10-16T10:50:00.000Z" },
    { status: "Unknown status without timestamp" },
  );
  process.env.NCM_API_TOKEN = "test-ncm-token";
  process.env.NCM_API_BASE_URL = "https://ncm.test";
  global.fetch = async (url) => {
    fetchedUrl = String(url);
    return new Response(JSON.stringify(statusHistory), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const tx = {
    customerReturn: {
      update: async ({ data }) => {
        lifecycleStatus = data.lifecycleStatus;
        returnPickupStatus = data.returnPickupStatus;
        return { ...initialReturn, lifecycleStatus, returnPickupStatus, ...data };
      },
    },
    customerReturnEvent: {
      create: async ({ data }) => {
        returnEvents.push(data);
        return { id: `return-event-${returnEvents.length}`, ...data };
      },
    },
  };
  const restore = replaceMethods([
    [prisma.customerReturn, "findUnique", async () => ({
      ...initialReturn,
      lifecycleStatus,
      returnPickupStatus,
    })],
    [prisma.customerReturn, "findFirst", async () => ({
      ...initialReturn,
      lifecycleStatus,
      returnPickupStatus,
    })],
    [prisma, "$transaction", async (callback) => callback(tx)],
  ]);

  try {
    const result = await reconcileCustomerReturnNcmStatus({
      returnId: initialReturn.id,
      adminId: "admin-return-reconciler",
    });

    assert.match(fetchedUrl, /\/api\/v1\/order\/status\?id=12356$/);
    assert.equal(result.returnRecord.lifecycleStatus, "RECEIVED_AT_WAREHOUSE");
    assert.equal(result.returnRecord.returnPickupStatus, "DELIVERED_TO_MANUFACTURER");
    assert.equal(result.latestNcmStatus, "Sent to Vendor");
    assert.equal(result.processedStatusCount, 104);
    assert.equal(result.skippedStatusCount, 1);
    assert.equal(result.partial, true);
    assert.equal(returnEvents.length, 103);
    assert.equal(returnEvents[0].metadata.status, "Pickup Complete");
    assert.equal(returnEvents.at(-1).metadata.status, "Sent to Vendor");
    assert.ok(returnEvents.every(({ metadata }) => metadata.source === "NCM_POLL"));
    assert.ok(returnEvents.every(({ actorId, actorRole }) => actorId === "admin-return-reconciler" && actorRole === "ADMIN"));
  } finally {
    restore();
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.NCM_API_TOKEN;
    else process.env.NCM_API_TOKEN = originalToken;
    if (originalBaseUrl === undefined) delete process.env.NCM_API_BASE_URL;
    else process.env.NCM_API_BASE_URL = originalBaseUrl;
  }
});
