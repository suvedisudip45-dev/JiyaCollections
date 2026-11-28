import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDeliveryStatus, STATUS_MAP } from "../services/deliveryService.js";
import { validateSelfDeliveryTransition } from "../services/distributorSelfDeliveryService.js";
import { cancelCustomerOrder } from "../services/orderCancellationService.js";
import { markCustomerReturnRefunded } from "../services/customerReturnWorkflowService.js";
import { prisma } from "../config/db.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

test("normalizeDeliveryStatus correctly maps courier 'Customer Not Found' and 'Undelivered' statuses", () => {
  const variations = [
    "Customer Not Found",
    "customer unreachable",
    "customer not reachable",
    "delivery attempt failed",
    "undelivered",
    "phone unreachable",
    "phone switched off",
    "door closed",
    "failed delivery",
  ];

  for (const variation of variations) {
    const result = normalizeDeliveryStatus(variation);
    assert.equal(
      result.deliveryState,
      "CUSTOMER_NOT_FOUND",
      `Expected ${variation} to map to CUSTOMER_NOT_FOUND, got ${result.deliveryState}`
    );
    assert.equal(result.canonicalStatus, "Customer Not Found");
    assert.equal(result.fulfillmentStatus, "customer_not_found");
  }

  assert.equal(STATUS_MAP["Customer Not Found"], "CUSTOMER_NOT_FOUND");
  assert.equal(STATUS_MAP["Undelivered"], "CUSTOMER_NOT_FOUND");
});

test("validateSelfDeliveryTransition supports Customer Not Found and subsequent re-attempt delivery", () => {
  // From On the Way to Customer Not Found
  const notFoundResult = validateSelfDeliveryTransition("on_the_way", "customer_not_found");
  assert.equal(notFoundResult.valid, true);
  assert.equal(notFoundResult.canonicalStatus, "Customer Not Found");
  assert.equal(notFoundResult.internalStatus, "customer_not_found");

  // Re-attempt: from Customer Not Found back to On the Way
  const retryResult = validateSelfDeliveryTransition("customer_not_found", "on_the_way");
  assert.equal(retryResult.valid, true);
  assert.equal(retryResult.canonicalStatus, "On the Way");
  assert.equal(retryResult.internalStatus, "on_the_way");

  // Final successful delivery: from Customer Not Found or On the Way to Delivered
  const deliveredResult = validateSelfDeliveryTransition("customer_not_found", "delivered");
  assert.equal(deliveredResult.valid, true);
  assert.equal(deliveredResult.canonicalStatus, "Delivered");
});

test("Customer order cancellation restores redeemed marketing card benefit to CLAIMED", async (t) => {
  const testOrderId = "order-with-card-benefit";
  const testCustomerId = "customer-123";
  const testCardId = "card-456";
  const testBenefitId = "benefit-789";

  let redemptionRestored = false;
  let eventLogged = false;

  const fakeOrder = {
    id: testOrderId,
    userId: testCustomerId,
    status: "Order Placed",
    fulfillmentStatus: "pending_assignment",
    items: JSON.stringify([{ productId: "p1", quantity: 1, size: "M", color: "Black" }]),
    payment: false,
    rewardApplied: JSON.stringify({
      source: "MARKETING_CARD",
      cardId: testCardId,
      benefitId: testBenefitId,
      discountAmount: 150,
    }),
    deliveryOrder: null,
  };

  stubMethod(t, prisma, "$transaction", async (callback) => {
    const tx = {
      order: {
        findFirst: async () => fakeOrder,
        findUnique: async () => ({ ...fakeOrder, status: "Cancelled" }),
        findMany: async () => [fakeOrder],
        updateMany: async () => ({ count: 1 }),
      },
      journalEntry: { findFirst: async () => null },
      accountingDocument: { findFirst: async () => null },
      cashTransaction: { findFirst: async () => null },
      distributorCashEvent: { findFirst: async () => null },
      ncmRequestAttempt: { findFirst: async () => null },
      giftRewardEntitlement: {
        findFirst: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
      orderAssignment: {
        findUnique: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
      marketingCardOrder: {
        findUnique: async () => null,
      },
      marketingBenefitRedemption: {
        updateMany: async ({ where, data }) => {
          if (where.cardId === testCardId && where.benefitId === testBenefitId && data.status === "CLAIMED") {
            redemptionRestored = true;
          }
          return { count: 1 };
        },
      },
      marketingCardEvent: {
        create: async ({ data }) => {
          if (data.cardId === testCardId && data.eventType === "BENEFIT_RESTORED_ON_ORDER_CANCELLATION") {
            eventLogged = true;
          }
          return { id: "event-1" };
        },
      },
      product: {
        findUnique: async () => ({ id: "p1", name: "Shirt", stockQuantity: 10 }),
        update: async () => ({ id: "p1" }),
      },
      inventoryBalance: {
        findMany: async () => [],
      },
      stockLog: {
        create: async () => ({ id: "stock-log-1" }),
      },
      systemAuditOutbox: {
        create: async () => ({ id: "audit-1" }),
      },
    };
    return callback(tx);
  });

  const result = await cancelCustomerOrder({
    orderId: testOrderId,
    customerId: testCustomerId,
    reason: "Mistaken item selection",
  });

  assert.equal(result.alreadyCancelled, false);
  assert.equal(redemptionRestored, true, "MarketingBenefitRedemption must be reverted to CLAIMED");
  assert.equal(eventLogged, true, "BENEFIT_RESTORED_ON_ORDER_CANCELLATION event must be logged");
});

test("markCustomerReturnRefunded updates the linked Order status to 'Returned'", async (t) => {
  const testReturnId = "return-abc";
  const testOrderId = "order-xyz";
  let orderStatusUpdated = false;

  const fakeReturn = {
    id: testReturnId,
    orderId: testOrderId,
    userId: "cust-1",
    deliveryRoute: "NCM",
    lifecycleStatus: "REFUND_PENDING",
    refundStatus: "PENDING",
    totalRefundAmount: 500,
  };

  stubMethod(t, prisma, "$transaction", async (callback) => {
    const tx = {
      customerReturn: {
        findUnique: async () => fakeReturn,
        updateMany: async () => ({ count: 1 }),
      },
      accountPayable: {
        findFirst: async () => ({ id: "pay-1", status: "SETTLED" }),
      },
      order: {
        updateMany: async ({ where, data }) => {
          if (where.id === testOrderId && data.status === "Returned" && data.fulfillmentStatus === "returned") {
            orderStatusUpdated = true;
          }
          return { count: 1 };
        },
      },
      customerReturnEvent: {
        create: async () => ({ id: "ev-1" }),
      },
      systemAuditOutbox: {
        create: async () => ({ id: "audit-1" }),
      },
    };
    return callback(tx);
  });

  await markCustomerReturnRefunded({
    returnId: testReturnId,
    adminId: "admin-1",
    actorContext: { actorId: "admin-1", actorRole: "ADMIN" },
  });

  assert.equal(orderStatusUpdated, true, "Order status must be updated to 'Returned'");
});
