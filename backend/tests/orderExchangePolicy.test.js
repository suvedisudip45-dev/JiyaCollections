import assert from "node:assert/strict";
import test from "node:test";
import { isBeforeNcmHandoff } from "../services/orderCancellationService.js";
import { mapExchangeNcmStatus, requestHashFor, toAdminExchangeRequestDto } from "../services/orderExchangeService.js";

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
