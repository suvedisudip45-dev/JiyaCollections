import assert from "node:assert/strict";
import test from "node:test";
import { getAdminOrderControlDetails } from "../services/adminOrderControlService.js";

const createClient = ({ order = null } = {}) => {
  const calls = {};
  const client = {
    order: {
      findUnique: async (args) => {
        calls.order = args;
        return order;
      },
      findMany: async (args) => {
        calls.shipments = args;
        return [
          { id: "order-1", amount: 150, deliveryFee: 10, status: "Order Placed", fulfillmentStatus: "assigned", payment: false, deliveryOrder: null },
          { id: "order-2", amount: 250, deliveryFee: 10, status: "Shipped", fulfillmentStatus: "in_transit", payment: false, deliveryOrder: { state: "IN_TRANSIT", ncmOrderId: 77, ncmStatus: "Moving" } },
        ];
      },
    },
    orderAssignment: {
      findMany: async (args) => {
        calls.assignments = args;
        return [
          { id: "assignment-1", orderId: "order-1", status: "assigned", deliveryType: "NCM", distributor: { id: "hub-1", name: "Hub One" } },
          { id: "assignment-2", orderId: "order-2", status: "in_transit", deliveryType: "NCM", distributor: { id: "hub-2", name: "Hub Two" } },
        ];
      },
    },
    systemAuditLog: {
      findMany: async (args) => {
        calls.audit = args;
        return [{ id: "audit-1", action: "ORDER_ADMIN_ASSIGNED_DISTRIBUTOR", actorRole: "ADMIN" }];
      },
    },
    ncmRequestAttempt: {
      findMany: async (args) => {
        calls.attempts = args;
        return [{ id: "attempt-1", result: "UNKNOWN" }];
      },
    },
  };
  return { client, calls };
};

test("Admin order control details return bounded operational history and all checkout shipments", async () => {
  const order = {
    id: "order-1",
    userId: "customer-1",
    items: [{ productId: "product-1", quantity: 1 }],
    amount: 150,
    deliveryFee: 10,
    address: { district: "Kathmandu" },
    status: "Order Placed",
    paymentMethod: "COD",
    payment: false,
    date: 1760000000000n,
    checkoutGroupId: "checkout-1",
    updatedAt: new Date("2026-10-28T00:00:00Z"),
    orderAssignment: undefined,
    deliveryOrder: { id: "delivery-1", events: [{ id: "event-1", eventType: "NCM_CREATED" }] },
    distributorCashEvents: [],
  };
  const { client, calls } = createClient({ order });
  client.order.findUnique = async (args) => {
    calls.order = args;
    return order;
  };

  const result = await getAdminOrderControlDetails("order-1", { client });

  assert.equal(result.order.id, "order-1");
  assert.equal(result.order.date, 1760000000000);
  assert.equal(result.checkoutShipments.length, 2);
  assert.equal(result.checkoutShipments[0].currentShipment, true);
  assert.equal(result.checkoutShipments[0].distributor.name, "Hub One");
  assert.equal(result.checkoutShipments[1].distributor.name, "Hub Two");
  assert.deepEqual(result.deliveryAttempts, [{ id: "attempt-1", result: "UNKNOWN" }]);
  assert.equal(calls.audit.take, 50);
  assert.equal(calls.attempts.take, 10);
  assert.deepEqual(calls.assignments.where.orderId.in, ["order-1", "order-2"]);
  assert.equal(Object.hasOwn(calls.attempts.select, "requestJson"), false);
});

test("Admin order control details return null for a missing order without extra queries", async () => {
  const { client, calls } = createClient();

  const result = await getAdminOrderControlDetails("missing-order", { client });

  assert.equal(result, null);
  assert.equal(calls.audit, undefined);
  assert.equal(calls.attempts, undefined);
});
