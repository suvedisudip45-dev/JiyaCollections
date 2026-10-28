import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import { cancelAdminOrder } from "../services/orderCancellationService.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const createOrder = (overrides = {}) => ({
  id: "order-1",
  userId: "customer-1",
  items: [],
  status: "Order Placed",
  fulfillmentStatus: "PENDING_ASSIGNMENT",
  payment: false,
  assignmentId: null,
  checkoutGroupId: null,
  specialOrder: false,
  deliveryOrder: null,
  ...overrides,
});

const installCancellationMock = (t, { order = createOrder(), carrierAttempt = null } = {}) => {
  const events = [];
  let finalOrder = { ...order, status: "Cancelled", fulfillmentStatus: "cancelled" };
  let orderLookupCount = 0;
  stubMethod(t, prisma, "$transaction", async (callback, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    const tx = {
      order: {
        findFirst: async () => order,
        findUnique: async () => {
          orderLookupCount += 1;
          if (orderLookupCount > 1) return finalOrder;
          return {
            id: order.id,
            userId: order.userId,
            checkoutGroupId: order.checkoutGroupId,
            manufacturerId: order.manufacturerId,
            distributorId: order.distributorId,
            assignedGiftId: null,
            assignedGiftInventoryId: null,
            assignedDistributorGiftInventoryId: null,
            giftStatus: "NONE",
          };
        },
        findMany: async () => [{ id: order.id, status: "Cancelled" }],
        updateMany: async ({ where, data }) => {
          events.push({ type: "cancel-order", where, data });
          finalOrder = { ...finalOrder, ...data };
          return { count: 1 };
        },
        update: async () => finalOrder,
      },
      orderAssignment: {
        findUnique: async () => null,
      },
      ncmRequestAttempt: {
        findFirst: async () => carrierAttempt,
      },
      giftRewardEntitlement: {
        updateMany: async () => ({ count: 0 }),
      },
      marketingCardOrder: {
        findUnique: async () => null,
      },
      systemAuditOutbox: {
        create: async ({ data }) => {
          events.push({ type: "audit", event: data.event });
          return { id: "audit-outbox-1" };
        },
      },
    };
    const result = await callback(tx);
    finalOrder = result.order || finalOrder;
    return result;
  });
  return events;
};

test("Admin cancellation releases eligible state and writes audit in the transaction", async (t) => {
  const events = installCancellationMock(t);

  const result = await cancelAdminOrder({
    orderId: "order-1",
    actorId: "admin-account-1",
    reason: "Customer requested cancellation before dispatch.",
  });

  assert.equal(result.alreadyCancelled, false);
  assert.equal(result.order.status, "Cancelled");
  assert.equal(events[0].type, "cancel-order");
  assert.equal(events[0].data.cancelledByUserId, null);
  assert.equal(events.at(-1).event.action, "ORDER_CANCELLED_BY_ADMIN");
  assert.equal(events.at(-1).event.actorId, "admin-account-1");
});

test("Admin cancellation blocks paid orders before any mutation", async (t) => {
  const events = installCancellationMock(t, { order: createOrder({ payment: true }) });

  await assert.rejects(
    cancelAdminOrder({ orderId: "order-1", actorId: "admin-account-1", reason: "Paid order cancellation request." }),
    (error) => error.code === "PAID_ORDER_REFUND_REQUIRED" && error.statusCode === 409,
  );
  assert.equal(events.length, 0);
});

test("Admin cancellation blocks ambiguous NCM submissions before any mutation", async (t) => {
  const events = installCancellationMock(t, {
    order: createOrder({ deliveryOrder: { id: "delivery-1", state: "NCM_SUBMISSION_STARTED" } }),
    carrierAttempt: { result: "UNKNOWN", httpStatus: null },
  });

  await assert.rejects(
    cancelAdminOrder({ orderId: "order-1", actorId: "admin-account-1", reason: "Stop this order before delivery." }),
    (error) => error.code === "CANCELLATION_CUTOFF_PASSED" && error.statusCode === 409,
  );
  assert.equal(events.length, 0);
});
