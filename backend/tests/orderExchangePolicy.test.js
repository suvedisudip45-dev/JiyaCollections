import assert from "node:assert/strict";
import test from "node:test";
import { isBeforeNcmHandoff } from "../services/orderCancellationService.js";
import { nextCustomerReturnNcmState, resolveCustomerReturnNcmState, returnItemsFromOrder } from "../services/customerReturnWorkflowService.js";
import { buildExchangeNcmReturnComment, mapExchangeNcmStatus, requestHashFor, snapshotReplacementItems, toAdminExchangeRequestDto } from "../services/orderExchangeService.js";

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
