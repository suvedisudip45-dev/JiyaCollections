import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../config/db.js";
import { adminUpdateAssignmentFulfillment } from "../controllers/orderAssignmentController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
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

const createRequest = (status = "quality_check") => ({
  params: { id: "assignment-1" },
  body: {
    status,
    reason: "Admin verifies the distributor quality checkpoint.",
  },
  auth: { role: "ADMIN", accountId: "admin-1" },
  adminId: "admin-profile-1",
  headers: {},
});

test("Admin fulfillment validates distributor stages and records a reason in the audit", async (t) => {
  const auditEvents = [];
  let assignmentUpdate;
  let orderUpdate;
  const assignment = {
    id: "assignment-1",
    orderId: "order-1",
    distributorId: "distributor-1",
    manufacturerId: null,
    status: "accepted",
    notes: "{}",
  };
  stubMethod(t, prisma.orderAssignment, "findUnique", async () => assignment);
  stubMethod(t, prisma.deliveryOrder, "findUnique", async () => null);
  stubMethod(t, prisma.platformFeatureConfig, "findUnique", async () => ({
    loyaltyEnabled: false,
    marketingCardsEnabled: false,
    lettersEnabled: false,
  }));
  stubMethod(t, prisma, "$transaction", async (callback) => callback({
    order: {
      findUnique: async () => ({ fulfillmentStatus: "accepted" }),
      updateMany: async ({ where, data }) => {
        assert.equal(where.fulfillmentStatus, "accepted");
        orderUpdate = data;
        return { count: 1 };
      },
    },
    orderAssignment: {
      updateMany: async ({ where, data }) => {
        assert.equal(where.status, "accepted");
        assignmentUpdate = data;
        return { count: 1 };
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        auditEvents.push(data.event);
        return { id: "audit-1" };
      },
    },
  }));
  const response = createResponse();

  await adminUpdateAssignmentFulfillment(createRequest(), response.res);

  assert.equal(response.getStatus(), 200);
  assert.equal(response.getBody().success, true);
  assert.equal(assignmentUpdate.status, "quality_check");
  assert.equal(orderUpdate.fulfillmentStatus, "quality_check");
  assert.equal(auditEvents[0].actorRole, "ADMIN");
  assert.equal(
    auditEvents[0].afterState.adminReason,
    "Admin verifies the distributor quality checkpoint.",
  );
});

test("Admin fulfillment cannot move an accepted assignment back to assigned", async (t) => {
  const assignment = {
    id: "assignment-1",
    orderId: "order-1",
    distributorId: "distributor-1",
    manufacturerId: null,
    status: "accepted",
    notes: "{}",
  };
  stubMethod(t, prisma.orderAssignment, "findUnique", async () => assignment);
  stubMethod(t, prisma.deliveryOrder, "findUnique", async () => null);
  stubMethod(t, prisma.platformFeatureConfig, "findUnique", async () => ({
    loyaltyEnabled: false,
    marketingCardsEnabled: false,
    lettersEnabled: false,
  }));
  const response = createResponse();

  await adminUpdateAssignmentFulfillment(createRequest("assigned"), response.res);

  assert.equal(response.getStatus(), 409);
  assert.equal(response.getBody().code, "ADMIN_FULFILLMENT_ROLLBACK_NOT_ALLOWED");
});

test("Admin fulfillment rejects invalid carrier states instead of overwriting delivery facts", async (t) => {
  const response = createResponse();

  await adminUpdateAssignmentFulfillment(createRequest("delivered"), response.res);

  assert.equal(response.getStatus(), 400);
  assert.match(response.getBody().message, /carrier delivery states/i);
});

test("Admin acceptance reuses the normal acceptance transaction and audit reason", async (t) => {
  const auditEvents = [];
  let acceptedAssignment;
  let acceptedOrder;
  const assignment = {
    id: "assignment-1",
    orderId: "order-1",
    distributorId: "distributor-1",
    manufacturerId: null,
    status: "assigned",
  };
  stubMethod(t, prisma.orderAssignment, "findUnique", async () => assignment);
  stubMethod(t, prisma, "$transaction", async (callback) => callback({
    orderAssignment: {
      findUnique: async () => assignment,
      updateMany: async ({ where, data }) => {
        assert.equal(where.status, "assigned");
        acceptedAssignment = data;
        return { count: 1 };
      },
    },
    deliveryOrder: { findUnique: async () => null },
    order: {
      findUnique: async () => ({
        id: "order-1",
        items: "[]",
        status: "Order Placed",
        fulfillmentStatus: "assigned",
      }),
      update: async ({ data }) => {
        acceptedOrder = data;
        return { id: "order-1", ...data };
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        auditEvents.push(data.event);
        return { id: "audit-1" };
      },
    },
  }));
  const response = createResponse();

  await adminUpdateAssignmentFulfillment(createRequest("accepted"), response.res);

  assert.equal(response.getStatus(), 200);
  assert.equal(response.getBody().success, true);
  assert.equal(acceptedAssignment.status, "accepted");
  assert.ok(acceptedAssignment.acceptedAt instanceof Date);
  assert.equal(acceptedOrder.fulfillmentStatus, "accepted");
  assert.equal(auditEvents[0].actorRole, "ADMIN");
  assert.equal(
    auditEvents[0].afterState.adminReason,
    "Admin verifies the distributor quality checkpoint.",
  );
});
