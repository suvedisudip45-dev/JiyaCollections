import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import { isBeforeNcmHandoff } from "../services/orderCancellationService.js";
import { calculateCustomerReturnRefundPolicy, decideCustomerReturnRequest, nextCustomerReturnNcmState, resolveCustomerReturnNcmState, returnItemsFromOrder } from "../services/customerReturnWorkflowService.js";
import { buildExchangeNcmReturnComment, decideCustomerExchangeRequest, mapExchangeNcmStatus, requestHashFor, snapshotReplacementItems, toAdminExchangeRequestDto } from "../services/orderExchangeService.js";
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
  const creates = [];
  const tx = {
    accountPayable: {
      findFirst: async ({ where }) => creates.find((item) =>
        item.referenceType === where.referenceType && item.referenceId === where.referenceId
      ) || null,
      create: async ({ data }) => {
        creates.push(data);
        return data;
      },
    },
    distributor: {
      findUnique: async () => ({ name: "Pokhara Hub" }),
    },
  };

  const ncmPayable = await createReturnExchangeSettlementPayable(tx, {
    id: "return-12345678",
    deliveryRoute: "NCM",
    logisticsSettlementAmount: 42,
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
  assert.equal(creates[0].totalAmount, 42);
  assert.equal(creates[0].referenceType, "RETURN_LOGISTICS_SETTLEMENT");
  assert.equal(creates[1].totalAmount, 29);
  assert.equal(creates[1].referenceType, "EXCHANGE_LOGISTICS_SETTLEMENT");
  assert.equal(creates.length, 2);
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
  assert.equal(mapExchangeNcmStatus("Sent for Delivery"), "IN_TRANSIT");
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
  assert.throws(() => snapshotReplacementItems({
    orderItems,
    requestedItems,
    replacementItems: [{ productId: "p1", size: "M", color: "Black", quantity: 2 }],
  }), { code: "EXCHANGE_REPLACEMENT_QUANTITY_MISMATCH" });
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
