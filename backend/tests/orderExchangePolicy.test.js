import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import { isBeforeNcmHandoff } from "../services/orderCancellationService.js";
import { calculateCustomerReturnRefundPolicy, decideCustomerReturnRequest, nextCustomerReturnNcmState, resolveCustomerReturnNcmState, returnItemsFromOrder } from "../services/customerReturnWorkflowService.js";
import { applyExchangeNcmStatus, buildExchangeNcmReturnComment, decideCustomerExchangeRequest, isExchangeReturnReceiptConfirmed, listAdminExchangeRequests, mapExchangeNcmStatus, reconcileCustomerExchange, requestHashFor, snapshotReplacementItems, toAdminExchangeRequestDto } from "../services/orderExchangeService.js";
import { resolveReturnExchangeRoute } from "../services/returnExchangeRouting.js";
import {
  createReturnExchangeSettlementPayable,
  resolveReturnExchangeSettlementRate,
} from "../services/returnExchangeSettlementService.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

test("return and exchange routing follows the completed delivery channel", () => {
  assert.deepEqual(resolveReturnExchangeRoute({
    assignment: { distributorId: "dist-1", deliveryType: "SELF_DELIVERY" },
    deliveryOrder: null,
  }), { route: "DISTRIBUTOR", distributorId: "dist-1" });

  assert.deepEqual(resolveReturnExchangeRoute({
    assignment: { distributorId: "dist-1", deliveryType: "NCM" },
    deliveryOrder: { ncmOrderId: 123, deliveryType: "Door2Door" },
  }), { route: "NCM", distributorId: null });

  assert.equal(resolveReturnExchangeRoute({
    assignment: { distributorId: null, deliveryType: "SELF_DELIVERY" },
    deliveryOrder: null,
  }), null);
});

test("return and exchange settlement rates are selected by delivery route and operation", () => {
  const config = {
    ncmReturnSettlementRate: 21,
    ncmExchangeSettlementRate: 34,
    distributorReturnSettlementRate: 17,
    distributorExchangeSettlementRate: 29,
  };

  assert.equal(resolveReturnExchangeSettlementRate(config, "NCM", "RETURN"), 21);
  assert.equal(resolveReturnExchangeSettlementRate(config, "NCM", "EXCHANGE"), 34);
  assert.equal(resolveReturnExchangeSettlementRate(config, "DISTRIBUTOR", "RETURN"), 17);
  assert.equal(resolveReturnExchangeSettlementRate(config, "DISTRIBUTOR", "EXCHANGE"), 29);
  assert.equal(resolveReturnExchangeSettlementRate(null, "NCM", "RETURN"), 0);
  assert.equal(resolveReturnExchangeSettlementRate(config, "UNKNOWN", "RETURN"), 0);
});

test("customer return fee is percentage of returned product value and excludes original delivery charge", () => {
  const policy = calculateCustomerReturnRefundPolicy({
    productValue: "1500.00",
    chargeRatePercent: 10,
    originalDeliveryFee: "120.00",
  });
  assert.equal(policy.snapshot.customerReturnCharge, "150.00");
  assert.equal(policy.snapshot.approvedRefundAmount, "1350.00");
  assert.equal(policy.snapshot.originalDeliveryFeeRefunded, "0.00");
  assert.equal(policy.approvedRefundAmount.toFixed(2), "1350.00");
});

test("completed logistics creates one payable to the selected provider", async () => {
  const payableCreates = [];
  const documentCreates = [];
  const documentsByKey = new Map();
  const tx = {
    accountPayable: {
      findFirst: async ({ where }) => payableCreates.find((item) =>
        item.referenceType === where.referenceType && item.referenceId === where.referenceId
      ) || null,
      create: async ({ data }) => {
        payableCreates.push(data);
        return data;
      },
    },
    distributor: {
      findUnique: async () => ({ id: "dist-1", name: "Pokhara Hub" }),
    },
    accountingParty: {
      upsert: async () => ({ id: "party-dist-1" }),
    },
    accountingDocument: {
      upsert: async ({ where, create }) => {
        const existing = documentsByKey.get(where.idempotencyKey);
        if (existing) return existing;
        const document = {
          id: `document-dist-logistics-${documentCreates.length + 1}`,
          idempotencyKey: where.idempotencyKey,
          ...create,
          originalAmount: create.originalAmount,
        };
        documentCreates.push(document);
        documentsByKey.set(where.idempotencyKey, document);
        return document;
      },
    },
  };

  const ncmPayable = await createReturnExchangeSettlementPayable(tx, {
    id: "return-12345678",
    deliveryRoute: "NCM",
    logisticsSettlementAmount: 42,
    ncmDeliveryCharge: 55,
  }, "RETURN");
  const distributorReturnBill = await createReturnExchangeSettlementPayable(tx, {
    id: "return-dist-1234",
    deliveryRoute: "DISTRIBUTOR",
    distributorId: "dist-1",
    logisticsSettlementAmount: 17,
  }, "RETURN");
  await createReturnExchangeSettlementPayable(tx, {
    id: "return-dist-1234",
    deliveryRoute: "DISTRIBUTOR",
    distributorId: "dist-1",
    logisticsSettlementAmount: 17,
  }, "RETURN");
  const distributorPayable = await createReturnExchangeSettlementPayable(tx, {
    id: "exchange-87654321",
    deliveryRoute: "DISTRIBUTOR",
    distributorId: "dist-1",
    logisticsSettlementAmount: 29,
  }, "EXCHANGE");
  await createReturnExchangeSettlementPayable(tx, {
    id: "exchange-87654321",
    deliveryRoute: "DISTRIBUTOR",
    distributorId: "dist-1",
    logisticsSettlementAmount: 29,
  }, "EXCHANGE");

  assert.equal(ncmPayable.payeeName, "Nepal Can Move");
  assert.equal(distributorPayable.payeeName, "Pokhara Hub");
  assert.equal(ncmPayable.totalAmount, 55);
  assert.match(ncmPayable.notes, /Provider-reported/);
  assert.equal(Number(distributorReturnBill.totalAmount), 17);
  assert.equal(Number(distributorPayable.totalAmount), 29);
  assert.equal(documentCreates[0].sourceType, "DISTRIBUTOR_RETURN_LOGISTICS");
  assert.equal(documentCreates[1].sourceType, "DISTRIBUTOR_EXCHANGE_LOGISTICS");
  assert.match(documentCreates[0].notes, /configured rate estimate/);
  assert.equal(documentCreates.length, 2);
  assert.equal(payableCreates.length, 1);
  assert.equal(payableCreates[0].totalAmount, 55);
  assert.equal(payableCreates[0].referenceType, "RETURN_LOGISTICS_SETTLEMENT");

  const customerPaidNcmReturn = await createReturnExchangeSettlementPayable({
    ...tx,
    accountPayable: {
      ...tx.accountPayable,
      findFirst: async () => null,
    },
  }, {
    id: "return-customer-paid",
    deliveryRoute: "NCM",
    ncmDeliveryCharge: 20,
    ncmChargePayer: "CUSTOMER",
    logisticsSettlementAmount: 18,
  }, "RETURN");
  assert.equal(customerPaidNcmReturn, null);
  assert.equal(payableCreates.length, 1);
});

test("customer cancellation is allowed only before any NCM handoff attempt", () => {
  assert.equal(isBeforeNcmHandoff({
    order: { status: "Order Placed", fulfillmentStatus: "ready_for_pickup" },
    delivery: { state: "SUBMISSION_PENDING", ncmOrderId: null },
    submissionAttempt: null,
  }), true);

  assert.equal(isBeforeNcmHandoff({
    order: { status: "Order Placed", fulfillmentStatus: "ncm_submission_started" },
    delivery: { state: "NCM_SUBMISSION_STARTED", ncmOrderId: null },
    submissionAttempt: null,
  }), false);

  assert.equal(isBeforeNcmHandoff({
    order: { status: "Shipped", fulfillmentStatus: "in_transit" },
    delivery: { state: "NCM_CREATED", ncmOrderId: 123 },
    submissionAttempt: { result: "SUCCESS" },
  }), false);

  assert.equal(isBeforeNcmHandoff({
    order: { status: "Order Placed", fulfillmentStatus: "ready_for_pickup" },
    delivery: { state: "SUBMISSION_FAILED", ncmOrderId: null },
    submissionAttempt: { result: "UNKNOWN" },
  }), false);

  assert.equal(isBeforeNcmHandoff({
    order: { status: "Order Placed", fulfillmentStatus: "ready_for_pickup" },
    delivery: { state: "SUBMISSION_FAILED", ncmOrderId: null },
    submissionAttempt: { result: "FAILED", httpStatus: 400 },
  }), true);
});

test("exchange NCM statuses normalize pickup and both delivery legs", () => {
  assert.equal(mapExchangeNcmStatus("Pickup Complete"), "PICKUP_COMPLETE");
  assert.equal(mapExchangeNcmStatus("pickup_completed"), "PICKUP_COMPLETE");
  assert.equal(mapExchangeNcmStatus("Delivered"), "DELIVERED");
  assert.equal(mapExchangeNcmStatus("Sent to Vendor"), "DELIVERED_TO_VENDOR");
  assert.equal(mapExchangeNcmStatus("Sent for Delivery"), "IN_TRANSIT");
  assert.equal(isExchangeReturnReceiptConfirmed({
    mappedStatus: "DELIVERED",
    currentStatus: "AWAITING_PICKUP",
  }), false);
  assert.equal(isExchangeReturnReceiptConfirmed({
    mappedStatus: "DELIVERED",
    currentStatus: "PICKUP_COMPLETE",
  }), true);
  assert.equal(isExchangeReturnReceiptConfirmed({
    mappedStatus: "DELIVERED_TO_VENDOR",
    currentStatus: "AWAITING_PICKUP",
  }), true);
});

test("return-only NCM vendor receipt labels cannot complete the exchange replacement leg", async (t) => {
  const attemptedAt = new Date("2026-10-16T08:00:00.000Z");
  const request = {
    id: "exchange-vendor-label-leg",
    status: "IN_PROGRESS",
    ncmReturnOrderId: 12359,
    ncmReplacementOrderId: 12360,
    ncmSubmissionAttemptedAt: attemptedAt,
    returnPickupStatus: "PICKUP_COMPLETE",
    returnPickupCompletedAt: new Date("2026-10-16T09:00:00.000Z"),
    manufacturerReceivedAt: null,
    replacementStatus: "IN_TRANSIT",
    replacementDeliveredAt: null,
    replacementStockReservedAt: null,
    replacementStockConsumedAt: null,
    inspectionResult: null,
  };
  let persistedRequest = { ...request };
  const eventRows = [];
  const tx = {
    orderExchangeRequest: {
      findUnique: async () => ({ ...persistedRequest }),
      update: async ({ data }) => {
        persistedRequest = { ...persistedRequest, ...data };
        return { ...persistedRequest };
      },
    },
    orderExchangeEvent: {
      create: async ({ data }) => {
        eventRows.push(data);
        return data;
      },
    },
  };
  stubMethod(t, prisma.orderExchangeRequest, "findFirst", async () => ({ ...persistedRequest }));
  stubMethod(t, prisma, "$transaction", async (callback) => callback(tx));

  const applied = await applyExchangeNcmStatus({
    ncmOrderId: request.ncmReplacementOrderId,
    status: "Sent to Vendor",
    timestamp: "2026-10-16T10:00:00.000Z",
  });

  assert.equal(applied, true);
  assert.equal(persistedRequest.replacementStatus, "IN_TRANSIT");
  assert.equal(persistedRequest.replacementDeliveredAt, null);
  assert.equal(persistedRequest.replacementStockConsumedAt, null);
  assert.equal(persistedRequest.status, "RETURN_PICKUP_COMPLETE");
  assert.equal(eventRows[0].eventType, "NCM_REPLACEMENT_DELIVERED_TO_VENDOR");

  const deliveredApplied = await applyExchangeNcmStatus({
    ncmOrderId: request.ncmReplacementOrderId,
    status: "Delivered",
    timestamp: "2026-10-16T11:00:00.000Z",
  });

  assert.equal(deliveredApplied, true);
  assert.equal(persistedRequest.replacementStatus, "DELIVERED");
  assert.equal(persistedRequest.replacementDeliveredAt.toISOString(), "2026-10-16T11:00:00.000Z");
  assert.equal(persistedRequest.status, "RETURN_PICKUP_COMPLETE");
});

test("Admin NCM exchange reconciliation replays both complete histories oldest-first", async (t) => {
  const attemptedAt = new Date("2026-10-16T08:00:00.000Z");
  let request = {
    id: "exchange-ncm-reconcile",
    status: "NCM_CREATED",
    ncmReturnOrderId: 12357,
    ncmReplacementOrderId: 12358,
    ncmSubmissionAttemptedAt: attemptedAt,
    returnPickupStatus: "AWAITING_PICKUP",
    returnPickupCompletedAt: null,
    manufacturerReceivedAt: null,
    replacementStatus: "PICKUP_PENDING",
    replacementDeliveredAt: null,
    replacementStockReservedAt: null,
    replacementStockConsumedAt: null,
    inspectionResult: null,
    completedAt: null,
  };
  const exchangeEvents = [];
  const eventKeys = new Set();
  const updateSnapshots = [];
  const originalFetch = global.fetch;
  const originalToken = process.env.NCM_API_TOKEN;
  const originalBaseUrl = process.env.NCM_API_BASE_URL;
  const returnHistory = [
    { status: "Sent to Vendor", added_time: "2026-10-16T10:50:00.000Z" },
    { status: "Delivered", added_time: "2026-10-16T09:02:00.000Z" },
    { status: "Pickup Complete", added_time: "2026-10-16T09:03:00.000Z" },
    { status: "Delivered", added_time: "2026-10-15T12:00:00.000Z" },
  ];
  for (let index = 0; index < 101; index += 1) {
    returnHistory.push({
      status: "Sent for Delivery",
      added_time: new Date(Date.parse("2026-10-16T09:04:00.000Z") + index * 60000).toISOString(),
    });
  }
  returnHistory.push({ status: "Unknown status without timestamp" });
  const replacementHistory = [
    { status: "Delivered", added_time: "2026-10-16T11:00:00.000Z" },
    { status: "Sent for Delivery", added_time: "2026-10-16T10:00:00.000Z" },
  ];
  process.env.NCM_API_TOKEN = "test-ncm-token";
  process.env.NCM_API_BASE_URL = "https://ncm.test";
  global.fetch = async (url) => {
    const orderId = new URL(String(url)).searchParams.get("id");
    const data = orderId === "12357" ? returnHistory : replacementHistory;
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const tx = {
    orderExchangeRequest: {
      findUnique: async () => ({ ...request }),
      update: async ({ data }) => {
        request = { ...request, ...data };
        updateSnapshots.push({ ...request });
        return { ...request };
      },
    },
    orderExchangeEvent: {
      create: async ({ data }) => {
        if (eventKeys.has(data.idempotencyKey)) {
          throw Object.assign(new Error("Duplicate exchange event"), { code: "P2002" });
        }
        eventKeys.add(data.idempotencyKey);
        exchangeEvents.push(data);
        return { id: `exchange-event-${exchangeEvents.length}`, ...data };
      },
    },
  };
  stubMethod(t, prisma.orderExchangeRequest, "findUnique", async () => ({ ...request, events: exchangeEvents }));
  stubMethod(t, prisma.orderExchangeRequest, "findFirst", async () => ({ ...request }));
  stubMethod(t, prisma, "$transaction", async (callback) => callback(tx));

  try {
    const result = await reconcileCustomerExchange(request.id);
    assert.equal(request.returnPickupStatus, "DELIVERED_TO_VENDOR");
    assert.equal(request.manufacturerReceivedAt.toISOString(), "2026-10-16T10:50:00.000Z");
    assert.equal(request.returnPickupCompletedAt.toISOString(), "2026-10-16T09:03:00.000Z");
    assert.equal(request.replacementStatus, "DELIVERED");
    assert.equal(request.replacementDeliveredAt.toISOString(), "2026-10-16T11:00:00.000Z");
    assert.equal(result.processedStatusCount, 106);
    assert.equal(result.skippedStatusCount, 2);
    assert.equal(result.partial, true);
    assert.equal(exchangeEvents.length, 106);
    assert.equal(exchangeEvents[0].eventType, "NCM_RETURN_DELIVERED");
    assert.equal(updateSnapshots[0].returnPickupStatus, "AWAITING_PICKUP");
    assert.equal(updateSnapshots[0].manufacturerReceivedAt, null);
    assert.equal(exchangeEvents.find((item) => item.eventType === "NCM_RETURN_PICKUP_COMPLETE").metadata.status, "Pickup Complete");
    assert.equal(exchangeEvents.at(-2).eventType, "NCM_REPLACEMENT_IN_TRANSIT");
    assert.equal(exchangeEvents.at(-1).eventType, "NCM_REPLACEMENT_DELIVERED");

    const replay = await reconcileCustomerExchange(request.id);
    assert.equal(replay.processedStatusCount, 106);
    assert.equal(exchangeEvents.length, 106);
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.NCM_API_TOKEN;
    else process.env.NCM_API_TOKEN = originalToken;
    if (originalBaseUrl === undefined) delete process.env.NCM_API_BASE_URL;
    else process.env.NCM_API_BASE_URL = originalBaseUrl;
  }
});

test("exchange request fingerprint is stable regardless of item order", () => {
  const first = requestHashFor({
    orderId: "order-1",
    reasonCode: "DEFECTIVE",
    reasonDetails: "Loose stitching",
    items: [
      { productId: "p2", size: "L", color: "Black", quantity: 1 },
      { productId: "p1", size: "M", color: "White", quantity: 2 },
    ],
  });
  const reordered = requestHashFor({
    orderId: "order-1",
    reasonCode: "DEFECTIVE",
    reasonDetails: "Loose stitching",
    items: [
      { productId: "p1", size: "M", color: "White", quantity: 2 },
      { productId: "p2", size: "L", color: "Black", quantity: 1 },
    ],
  });
  assert.equal(first, reordered);
  assert.notEqual(first, requestHashFor({
    orderId: "order-1",
    reasonCode: "DEFECTIVE",
    reasonDetails: "Loose stitching",
    items: [
      { productId: "p2", size: "L", color: "Black", quantity: 1 },
      { productId: "p1", size: "M", color: "White", quantity: 2 },
    ],
    replacementItems: [{ productId: "p1", size: "XL", color: "White", quantity: 2 }],
  }));
  assert.notEqual(first, requestHashFor({
    orderId: "order-1",
    reasonCode: "DEFECTIVE",
    reasonDetails: "Different cause",
    items: [{ productId: "p1", size: "M", color: "White", quantity: 2 }],
  }));
});

test("admin exchange DTO serializes BigInt order timestamps as strings", () => {
  const dto = toAdminExchangeRequestDto({
    id: "exchange-1",
    order: { id: "order-1", date: 1790863117000n },
  }, 2);

  assert.equal(dto.order.date, "1790863117000");
  assert.equal(dto.lifetimeReturnedUnits, 2);
  assert.doesNotThrow(() => JSON.stringify(dto));
});

test("admin exchange requests resolve accounting period and fiscal year by their foreign keys", async (t) => {
  const request = {
    id: "exchange-1",
    customerId: "customer-1",
    exchangeJournalEntryId: "journal-1",
    order: { id: "order-1", date: 1790863117000n },
  };
  stubMethod(t, prisma, "$transaction", async (queries) => Promise.all(queries));
  stubMethod(t, prisma.orderExchangeRequest, "findMany", async (args) => {
    if (args.select?.customerId) {
      return [{ customerId: "customer-1", items: [] }];
    }
    return [request];
  });
  stubMethod(t, prisma.orderExchangeRequest, "count", async () => 1);
  stubMethod(t, prisma.orderAssignment, "findMany", async () => []);
  stubMethod(t, prisma.customerReturn, "findMany", async () => []);
  stubMethod(t, prisma.journalEntry, "findMany", async ({ select }) => {
    assert.equal(select.accountingPeriodId, true);
    assert.equal(select.fiscalYearId, true);
    assert.equal(select.accountingPeriod, undefined);
    assert.equal(select.fiscalYear, undefined);
    return [{
      id: "journal-1",
      journalNumber: "JE-2026-00001",
      transactionDate: new Date("2026-10-30T00:00:00.000Z"),
      accountingPeriodId: "period-1",
      fiscalYearId: "fiscal-year-1",
    }];
  });
  stubMethod(t, prisma.accountingPeriod, "findMany", async () => [
    { id: "period-1", periodName: "2026-10" },
  ]);
  stubMethod(t, prisma.fiscalYear, "findMany", async () => [
    { id: "fiscal-year-1", name: "2083/2084" },
  ]);

  const result = await listAdminExchangeRequests({});
  assert.equal(result.total, 1);
  assert.equal(result.requests[0].journalEntry.journalNumber, "JE-2026-00001");
  assert.deepEqual(result.requests[0].journalEntry.accountingPeriod, {
    id: "period-1",
    periodName: "2026-10",
  });
  assert.deepEqual(result.requests[0].journalEntry.fiscalYear, {
    id: "fiscal-year-1",
    name: "2083/2084",
  });
});

test("NCM exchange approval requires an allocated replacement bill for unequal-value physical bills", async (t) => {
  const current = {
    id: "exchange-ncm-1",
    orderId: "order-1",
    customerId: "customer-1",
    manufacturerId: "manufacturer-1",
    deliveryRoute: "NCM",
    settlementDistributorId: "dist-1",
    status: "REQUESTED",
    priceDifference: 100,
    replacementStockReservedAt: null,
    replacementStockReleasedAt: null,
    replacementItems: [],
    cardId: null,
    order: { status: "Delivered", deliveryOrder: { ncmOrderId: 123 } },
  };
  stubMethod(t, prisma, "$transaction", (callback) => callback({
    orderExchangeRequest: {
      findUnique: async () => current,
    },
    orderAssignment: {
      findUnique: async () => ({
        distributorId: "dist-1",
        deliveryType: "NCM",
        paperBillRequested: true,
        paperBillNumber: "VAT-0010",
        paperBillDocumentType: "VAT_TAX_INVOICE",
      }),
    },
  }));

  await assert.rejects(
    decideCustomerExchangeRequest({
      requestId: current.id,
      adminId: "admin-1",
      decision: "APPROVE",
      reason: "Approved after review",
      replacementPaperBillNumber: "VAT-0011",
      replacementPaperBillAttached: false,
    }),
    { code: "EXCHANGE_REPLACEMENT_BILL_NOT_ATTACHED" },
  );
  await assert.rejects(
    decideCustomerExchangeRequest({
      requestId: current.id,
      adminId: "admin-1",
      decision: "APPROVE",
      reason: "Approved after review",
      replacementPaperBillAttached: true,
    }),
    { code: "PAPER_BILL_NUMBER_REQUIRED" },
  );
});

test("return requests cannot exceed purchased and previously returned quantities", () => {
  const orderItems = [{ productId: "p1", name: "Top", size: "M", color: "Black", quantity: 2, purchasedUnitPrice: 100 }];
  const item = { productId: "p1", size: "M", color: "Black", quantity: 1 };
  const snapshot = returnItemsFromOrder(orderItems, [item]);

  assert.equal(snapshot[0].refundAmount, 100);
  assert.equal(snapshot[0].condition, "PENDING_INSPECTION");
  assert.throws(() => returnItemsFromOrder(orderItems, [{ ...item, quantity: 3 }]), { code: "RETURN_QUANTITY_EXCEEDED" });
  assert.throws(() => returnItemsFromOrder(orderItems, [item], [{ items: [{ ...item, quantity: 2 }] }]), { code: "RETURN_QUANTITY_EXCEEDED" });
});

test("return webhooks ignore original delivery completion until the return leg starts", () => {
  assert.deepEqual(nextCustomerReturnNcmState({ currentStatus: "PENDING_ADMIN_REVIEW", status: "Delivered" }), {
    lifecycleStatus: "PENDING_ADMIN_REVIEW",
    returnPickupStatus: undefined,
  });
  assert.deepEqual(nextCustomerReturnNcmState({ currentStatus: "NCM_RETURN_INITIATED", status: "Pickup Complete" }), {
    lifecycleStatus: "RETURN_IN_TRANSIT",
    returnPickupStatus: "PICKUP_COMPLETE",
  });
  assert.deepEqual(nextCustomerReturnNcmState({ currentStatus: "NCM_RETURN_INITIATED", status: "Delivered" }), {
    lifecycleStatus: "NCM_RETURN_INITIATED",
    returnPickupStatus: undefined,
  });
  assert.deepEqual(nextCustomerReturnNcmState({ currentStatus: "NCM_RETURN_INITIATED", status: "Sent to Vendor" }), {
    lifecycleStatus: "RECEIVED_AT_WAREHOUSE",
    returnPickupStatus: "DELIVERED_TO_MANUFACTURER",
  });
  assert.deepEqual(nextCustomerReturnNcmState({ currentStatus: "RETURN_IN_TRANSIT", status: "sent_for_delivery" }), {
    lifecycleStatus: "RETURN_IN_TRANSIT",
    returnPickupStatus: "SENT_FOR_DELIVERY",
  });
  assert.deepEqual(nextCustomerReturnNcmState({ currentStatus: "RETURN_IN_TRANSIT", status: "order_dispatched" }), {
    lifecycleStatus: "RETURN_IN_TRANSIT",
    returnPickupStatus: "DISPATCHED",
  });
  assert.deepEqual(nextCustomerReturnNcmState({ currentStatus: "RETURN_IN_TRANSIT", status: "order_arrived" }), {
    lifecycleStatus: "RETURN_IN_TRANSIT",
    returnPickupStatus: "ARRIVED_AT_DESTINATION",
  });
  assert.deepEqual(nextCustomerReturnNcmState({ currentStatus: "RETURN_IN_TRANSIT", status: "Delivered" }), {
    lifecycleStatus: "RECEIVED_AT_WAREHOUSE",
    returnPickupStatus: "DELIVERED_TO_MANUFACTURER",
  });
  assert.deepEqual(resolveCustomerReturnNcmState({
    currentStatus: "RETURN_IN_TRANSIT",
    currentPickupStatus: "ARRIVED_AT_DESTINATION",
    status: "Pickup Complete",
  }), {
    lifecycleStatus: "RETURN_IN_TRANSIT",
    returnPickupStatus: "ARRIVED_AT_DESTINATION",
  });
});

test("exchange replacement quantities match requested return quantities", () => {
  const orderItems = [{ productId: "p1", name: "Top", size: "S", color: "White", quantity: 2, price: 100 }];
  const requestedItems = [{ productId: "p1", name: "Top", size: "S", color: "White", quantity: 1, unitPrice: 100 }];
  const replacement = snapshotReplacementItems({
    orderItems,
    requestedItems,
    replacementItems: [{ productId: "p1", size: "M", color: "Black", quantity: 1 }],
  });

  assert.equal(replacement[0].size, "M");
  assert.equal(replacement[0].color, "Black");
  assert.equal(replacement[0].unitCostPrice, null);
  assert.throws(() => snapshotReplacementItems({
    orderItems,
    requestedItems,
    replacementItems: [{ productId: "p1", size: "M", color: "Black", quantity: 2 }],
  }), { code: "EXCHANGE_REPLACEMENT_QUANTITY_MISMATCH" });
});

test("different-product exchange snapshots the active catalog cost at request time", () => {
  const replacement = snapshotReplacementItems({
    orderItems: [],
    requestedItems: [{ productId: "old-product", quantity: 1, unitPrice: 100 }],
    replacementItems: [{ productId: "new-product", size: "M", color: "Black", quantity: 1 }],
    catalogProducts: new Map([["new-product", {
      id: "new-product",
      name: "Jacket",
      price: 250,
      costPrice: 120,
    }]]),
  });

  assert.equal(replacement[0].unitPrice, 250);
  assert.equal(replacement[0].unitCostPrice, 120);
  assert.throws(() => snapshotReplacementItems({
    orderItems: [],
    requestedItems: [{ productId: "old-product", quantity: 1, unitPrice: 100 }],
    replacementItems: [{ productId: "new-product", size: "M", color: "Black", quantity: 1 }],
    catalogProducts: new Map([["new-product", {
      id: "new-product",
      name: "Jacket",
      price: 250,
      costPrice: null,
    }]]),
  }), { code: "EXCHANGE_COST_SNAPSHOT_MISSING" });
});

test("exchange return comment carries the cause and replacement plan to NCM", () => {
  const comment = buildExchangeNcmReturnComment({
    reasonCode: "DEFECTIVE",
    reasonDetails: "Loose stitching",
    items: [{ name: "Top", size: "S", color: "White", quantity: 1 }],
    replacementItems: [{ name: "Top", size: "M", color: "Black", quantity: 1 }],
  });

  assert.match(comment, /Loose stitching/);
  assert.match(comment, /Returning: Top S White x1/);
  assert.match(comment, /Replacement requested: Top M Black x1/);
  assert.ok(comment.length <= 1000);
});

test("admin approval routes a manufacturer-less self-delivery exchange to its distributor without NCM", async (t) => {
  const current = {
    id: "exchange-1",
    orderId: "order-1",
    customerId: "customer-1",
    manufacturerId: null,
    distributorId: "dist-1",
    deliveryRoute: "DISTRIBUTOR",
    status: "REQUESTED",
    replacementStockReservedAt: null,
    replacementStockReleasedAt: null,
    replacementItems: [{ productId: "product-1", size: "M", color: "Black", quantity: 1 }],
    cardId: null,
    order: { status: "Delivered", deliveryOrder: null },
  };
  let updateData;
  let findRequestCount = 0;

  stubMethod(t, prisma, "$transaction", (callback) => callback({
    shippingConfig: {
      findFirst: async () => ({ distributorExchangeSettlementRate: 29 }),
    },
    orderExchangeRequest: {
      findUnique: async () => {
        findRequestCount += 1;
        return findRequestCount === 1 ? current : { ...current, ...updateData };
      },
      updateMany: async ({ data }) => {
        updateData = data;
        return { count: 1 };
      },
    },
    orderAssignment: {
      findUnique: async () => ({ distributorId: "dist-1", deliveryType: "SELF_DELIVERY" }),
    },
    inventorySku: {
      findUnique: async () => ({ id: "sku-1", isActive: true }),
    },
    inventoryBalance: {
      findMany: async () => [{ id: "balance-1", locationId: "location-1", quantityOnHand: 5, reservedQuantity: 1 }],
      updateMany: async () => ({ count: 1 }),
    },
    orderExchangeEvent: { create: async () => ({ id: "event-1" }) },
  }));

  const result = await decideCustomerExchangeRequest({
    requestId: current.id,
    adminId: "admin-1",
    decision: "APPROVE",
    reason: "Approved after review",
  });

  assert.equal(result.request.status, "APPROVED_FOR_DISTRIBUTOR");
  assert.equal(result.ncmSubmission, null);
  assert.equal(updateData.deliveryRoute, "DISTRIBUTOR");
  assert.equal(updateData.distributorId, "dist-1");
  assert.ok(updateData.replacementStockReservedAt instanceof Date);
  assert.equal(Object.hasOwn(updateData, "ncmChargePayer"), false);
  assert.equal(updateData.logisticsSettlementAmount, 29);
});

test("admin approval routes a self-delivery return to the original distributor without NCM", async (t) => {
  const current = {
    id: "return-1",
    orderId: "order-1",
    lifecycleStatus: "PENDING_ADMIN_REVIEW",
    deliveryRoute: "DISTRIBUTOR",
    distributorId: "dist-1",
    totalRefundAmount: 1000,
  };
  let updateData;
  stubMethod(t, prisma.customerReturn, "findUnique", async () => ({ ...current, ...updateData }));

  stubMethod(t, prisma, "$transaction", (callback) => callback({
    shippingConfig: {
      findFirst: async () => ({ distributorReturnSettlementRate: 17 }),
    },
    customerReturn: {
      findUnique: async () => current,
      updateMany: async ({ data }) => {
        updateData = data;
        return { count: 1 };
      },
    },
    order: {
      findUnique: async () => ({ deliveryFee: 100, date: BigInt(Date.now()) }),
    },
    vatRateVersion: {
      findFirst: async () => null,
    },
    taxConfiguration: {
      findUnique: async () => ({ vatRate: 13 }),
    },
    orderAssignment: {
      findUnique: async () => ({ distributorId: "dist-1", deliveryType: "SELF_DELIVERY" }),
    },
    deliveryOrder: {
      findUnique: async () => null,
    },
    customerReturnEvent: { create: async () => ({ id: "return-event-1" }) },
    systemAuditOutbox: { create: async () => ({ id: "audit-1" }) },
  }));

  const result = await decideCustomerReturnRequest({
    returnId: current.id,
    adminId: "admin-1",
    decision: "APPROVE",
    reason: "Approved after review",
    chargePayer: "CUSTOMER",
  });

  assert.equal(result.lifecycleStatus, "DISTRIBUTOR_RETURN_PENDING");
  assert.equal(updateData.deliveryRoute, "DISTRIBUTOR");
  assert.equal(updateData.distributorId, "dist-1");
  assert.equal(Object.hasOwn(updateData, "ncmChargePayer"), false);
  assert.equal(updateData.logisticsSettlementAmount, 17);
  assert.equal(updateData.approvedRefundAmount.toFixed(2), "1000.00");
  assert.equal(updateData.refundPolicySnapshot.originalDeliveryFeeRefunded, "0.00");
});
