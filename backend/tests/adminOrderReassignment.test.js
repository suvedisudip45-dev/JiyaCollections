import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../config/db.js";
import { adminReassignOrder } from "../controllers/orderAssignmentController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const createHarness = (t, {
  sourceReserved = 2,
  targetOnHand = 5,
  assignmentStatus = "rejected",
  transactionAssignmentStatus = assignmentStatus,
} = {}) => {
  const source = {
    id: "source-balance",
    quantityOnHand: 5,
    reservedQuantity: sourceReserved,
    inventorySku: { productId: "product-1", sizeKey: "medium", colorKey: "navy blue" },
  };
  const target = {
    id: "target-balance",
    quantityOnHand: targetOnHand,
    reservedQuantity: 0,
    inventorySku: { productId: "product-1", sizeKey: "medium", colorKey: "navy blue" },
  };
  const assignment = {
    id: "assignment-1",
    orderId: "order-1",
    distributorId: "source-hub",
    manufacturerId: null,
    status: assignmentStatus,
  };
  const order = {
    id: "order-1",
    orderType: "ONLINE_STORE",
    status: "Rejected by Hub",
    fulfillmentStatus: "rejected",
    assignmentId: "assignment-1",
    address: JSON.stringify({ province: "Bagmati Province", district: "Kathmandu" }),
    items: JSON.stringify([{
      productId: "product-1",
      size: "Medium",
      color: "Navy Blue",
      quantity: 2,
    }]),
  };
  const auditEvents = [];
  let transactionCount = 0;
  let reassigned = false;
  let transactionAssignment = { ...assignment, status: transactionAssignmentStatus };

  stubMethod(t, prisma.orderAssignment, "findUnique", async () => ({ ...assignment }));
  stubMethod(t, prisma.order, "findUnique", async () => ({ ...order }));
  stubMethod(t, prisma.deliveryOrder, "findUnique", async () => null);
  stubMethod(t, prisma.product, "findMany", async () => [{ id: "product-1" }]);
  stubMethod(t, prisma.product, "findUnique", async () => ({ id: "product-1", variants: [] }));
  stubMethod(t, prisma.distributor, "findMany", async () => [{
    id: "target-hub",
    name: "Target Hub",
    province: "Bagmati Province",
    district: "Kathmandu",
    locations: [],
    qualityRating: 0,
    ratingCount: 0,
  }]);
  stubMethod(t, prisma.inventoryBalance, "findMany", async () => [{
    ...target,
    location: { distributorId: "target-hub" },
  }]);
  stubMethod(t, prisma, "$transaction", async (callback) => {
    transactionCount += 1;
    const snapshot = {
      sourceReserved: source.reservedQuantity,
      targetReserved: target.reservedQuantity,
      reassigned,
    };
    const tx = {
      orderAssignment: {
        findUnique: async () => ({
          ...(reassigned ? { ...assignment, distributorId: "target-hub", status: "assigned" } : transactionAssignment),
          distributor: { id: reassigned ? "target-hub" : "source-hub", name: reassigned ? "Target Hub" : "Source Hub" },
        }),
        updateMany: async ({ where, data }) => {
          if (
            transactionAssignment.id !== where.id ||
            transactionAssignment.status !== where.status ||
            transactionAssignment.distributorId !== where.distributorId
          ) return { count: 0 };
          transactionAssignment = { ...transactionAssignment, ...data };
          reassigned = true;
          return { count: 1 };
        },
      },
      order: {
        findUnique: async () => ({ ...order }),
        updateMany: async () => ({ count: 1 }),
      },
      deliveryOrder: { findUnique: async () => null },
      distributor: { findFirst: async () => ({ id: "target-hub" }) },
      inventoryBalance: {
        findMany: async ({ where }) => {
          if (!where.location.distributorId) return [];
          const hubId = where.location.distributorId;
          return hubId === "target-hub" ? [target] : hubId === "source-hub" ? [source] : [];
        },
        updateMany: async ({ where, data }) => {
          const balance = [source, target].find((item) => item.id === where.id);
          if (
            !balance ||
            balance.reservedQuantity !== where.reservedQuantity ||
            balance.quantityOnHand < where.quantityOnHand.gte
          ) return { count: 0 };
          if (data.reservedQuantity.increment) {
            balance.reservedQuantity += data.reservedQuantity.increment;
          } else {
            balance.reservedQuantity -= data.reservedQuantity.decrement;
          }
          return { count: 1 };
        },
      },
      product: {
        findUnique: async () => ({ id: "product-1", variants: [] }),
        update: async ({ data }) => ({ id: "product-1", ...data }),
      },
      systemAuditOutbox: {
        create: async ({ data }) => {
          auditEvents.push(data.event);
          return { id: "audit-1" };
        },
      },
    };

    try {
      return await callback(tx);
    } catch (error) {
      source.reservedQuantity = snapshot.sourceReserved;
      target.reservedQuantity = snapshot.targetReserved;
      reassigned = snapshot.reassigned;
      transactionAssignment = { ...assignment, status: transactionAssignmentStatus };
      throw error;
    }
  });

  return {
    source,
    target,
    auditEvents,
    getTransactionCount: () => transactionCount,
    isReassigned: () => reassigned,
  };
};

const createResponse = () => {
  let statusCode = 200;
  let body;
  return {
    res: {
      status(code) {
        statusCode = code;
        return this;
      },
      json(value) {
        body = value;
        return this;
      },
    },
    getStatus: () => statusCode,
    getBody: () => body,
  };
};

const createRequest = () => ({
  body: {
    assignmentId: "assignment-1",
    distributorId: "target-hub",
    reason: "Reroute due to local fulfillment capacity.",
  },
  auth: { role: "ADMIN", accountId: "admin-1" },
  headers: {},
});

test("Admin reassignment atomically transfers the reservation and audits the reason", async (t) => {
  const harness = createHarness(t);
  const response = createResponse();

  await adminReassignOrder(createRequest(), response.res);

  assert.equal(response.getStatus(), 200);
  assert.equal(response.getBody().success, true);
  assert.equal(harness.source.reservedQuantity, 0);
  assert.equal(harness.target.reservedQuantity, 2);
  assert.equal(harness.isReassigned(), true);
  assert.equal(harness.auditEvents[0].action, "ORDER_ADMIN_REASSIGNED_DISTRIBUTOR");
  assert.equal(
    harness.auditEvents[0].afterState.reason,
    "Reroute due to local fulfillment capacity.",
  );
});

test("Admin can reassign an assigned order while it is still awaiting distributor acceptance", async (t) => {
  const harness = createHarness(t, { assignmentStatus: "assigned" });
  const response = createResponse();

  await adminReassignOrder(createRequest(), response.res);

  assert.equal(response.getStatus(), 200);
  assert.equal(response.getBody().success, true);
  assert.equal(harness.source.reservedQuantity, 0);
  assert.equal(harness.target.reservedQuantity, 2);
  assert.equal(harness.isReassigned(), true);
});

test("Admin reassignment does not start a transaction if the target lacks stock", async (t) => {
  const harness = createHarness(t, { targetOnHand: 1 });
  const response = createResponse();

  await adminReassignOrder(createRequest(), response.res);

  assert.equal(response.getStatus(), 409);
  assert.equal(response.getBody().success, false);
  assert.equal(response.getBody().code, "INSUFFICIENT_DISTRIBUTOR_STOCK");
  assert.equal(harness.getTransactionCount(), 0);
  assert.equal(harness.source.reservedQuantity, 2);
  assert.equal(harness.target.reservedQuantity, 0);
});

test("Admin reassignment rolls back target stock if the source reservation is inconsistent", async (t) => {
  const harness = createHarness(t, { sourceReserved: 1 });
  const response = createResponse();
  stubMethod(t, console, "error", () => {});

  await adminReassignOrder(createRequest(), response.res);

  assert.equal(response.getStatus(), 409);
  assert.equal(response.getBody().code, "ORDER_RESERVATION_MISMATCH");
  assert.equal(harness.source.reservedQuantity, 1);
  assert.equal(harness.target.reservedQuantity, 0);
  assert.equal(harness.isReassigned(), false);
});

test("Admin reassignment stops if the assignment advanced while stock was being checked", async (t) => {
  const harness = createHarness(t, { transactionAssignmentStatus: "accepted" });
  const response = createResponse();
  stubMethod(t, console, "error", () => {});

  await adminReassignOrder(createRequest(), response.res);

  assert.equal(response.getStatus(), 409);
  assert.equal(response.getBody().code, "ORDER_REASSIGNMENT_CONFLICT");
  assert.equal(harness.source.reservedQuantity, 2);
  assert.equal(harness.target.reservedQuantity, 0);
  assert.equal(harness.isReassigned(), false);
});
