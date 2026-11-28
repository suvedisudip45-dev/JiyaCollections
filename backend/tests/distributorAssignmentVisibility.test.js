import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../config/db.js";
import {
  getMyAssignments,
  updateAssignmentStatus,
} from "../controllers/orderAssignmentController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("distributor assignment list includes orders held for delivery", async (t) => {
  const assignment = {
    id: "assignment-1",
    orderId: "order-1",
    distributorId: "distributor-1",
    status: "on_hold",
    assignedAt: new Date("2026-10-18T00:00:00.000Z"),
  };
  let assignmentQuery;
  stubMethod(t, prisma.orderAssignment, "findMany", async (args) => {
    assignmentQuery = args;
    return [assignment];
  });
  stubMethod(t, prisma.orderAssignment, "count", async () => 1);
  stubMethod(t, prisma, "$transaction", async (queries) => Promise.all(queries));
  stubMethod(t, prisma.order, "findMany", async () => [{
    id: "order-1",
    items: [{ productId: "product-1", quantity: 1 }],
    address: { district: "Kathmandu" },
    date: 1,
  }]);
  stubMethod(t, prisma.deliveryOrder, "findMany", async () => []);

  const response = createResponse();
  await getMyAssignments(
    { distributorId: "distributor-1", query: {} },
    response,
  );

  assert.deepEqual(assignmentQuery.where, { distributorId: "distributor-1" });
  assert.equal(response.body.assignments[0].status, "on_hold");
  assert.equal(response.body.assignments[0].order.id, "order-1");
});

test("distributor cannot modify an order held in the delivery queue", async (t) => {
  stubMethod(t, prisma.orderAssignment, "findUnique", async () => ({
    id: "assignment-1",
    orderId: "order-1",
    distributorId: "distributor-1",
    status: "on_hold",
  }));
  stubMethod(t, prisma.deliveryOrder, "findUnique", async () => null);

  const response = createResponse();
  await updateAssignmentStatus({
    distributorId: "distributor-1",
    params: { id: "assignment-1" },
    body: { status: "package_details_complete", packageWeight: "1 kg" },
  }, response);

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "ORDER_FULFILLMENT_LOCKED");
});

test("distributor cannot modify order details after NCM booking", async (t) => {
  stubMethod(t, prisma.orderAssignment, "findUnique", async () => ({
    id: "assignment-1",
    orderId: "order-1",
    distributorId: "distributor-1",
    status: "package_details_complete",
  }));
  stubMethod(t, prisma.deliveryOrder, "findUnique", async () => ({
    ncmOrderId: 12345,
    state: "NCM_CREATED",
    pickedUpAt: null,
    deliveredAt: null,
  }));

  const response = createResponse();
  await updateAssignmentStatus({
    distributorId: "distributor-1",
    params: { id: "assignment-1" },
    body: { status: "package_details_complete", packageWeight: "2 kg" },
  }, response);

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "ORDER_FULFILLMENT_LOCKED");
});
