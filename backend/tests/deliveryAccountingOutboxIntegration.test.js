import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import { applyNcmStatus, reconcileDelivery } from "../services/deliveryService.js";

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
