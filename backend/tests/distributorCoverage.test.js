import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../config/db.js";
import { getUnassignedOrders } from "../controllers/orderAssignmentController.js";
import {
  normalizeDistributorCoverage,
  updateDistributorCoverage,
} from "../controllers/distributorController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

test("coverage input is canonicalized and duplicate districts are removed", () => {
  assert.deepEqual(normalizeDistributorCoverage([
    { province: "Lumbini Province", district: "Nawalparasi West" },
    { province: "Lumbini Province", district: "Parasi" },
  ]), [
    { province: "Lumbini Province", district: "Parasi" },
  ]);
});

test("invalid province and district combinations are rejected", () => {
  assert.throws(() => normalizeDistributorCoverage([
    { province: "Koshi Province", district: "Kathmandu" },
  ]), { statusCode: 400 });
});

test("coverage updates replace the district list and audit the change transactionally", async (t) => {
  const calls = { deleted: false, created: null, audit: null, findMany: 0 };
  const tx = {
    distributor: {
      findUnique: async () => ({ id: "distributor-1", name: "Hub" }),
    },
    distributorLocation: {
      findMany: async () => {
        calls.findMany += 1;
        return calls.findMany === 1
          ? [{ province: "Bagmati Province", district: "Kathmandu" }]
          : [{ province: "Lumbini Province", district: "Parasi" }];
      },
      deleteMany: async () => {
        calls.deleted = true;
        return { count: 1 };
      },
      createMany: async ({ data }) => {
        calls.created = data;
        return { count: data.length };
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        calls.audit = data.event;
        return { id: "audit-1" };
      },
    },
  };
  stubMethod(t, prisma, "$transaction", async (callback) => callback(tx));

  let response;
  const res = {
    status: (status) => ({
      json: (body) => {
        response = { status, body };
        return response;
      },
    }),
    json: (body) => {
      response = { status: 200, body };
      return response;
    },
  };

  await updateDistributorCoverage({
    params: { id: "distributor-1" },
    body: { locations: [{ province: "Lumbini Province", district: "Nawalparasi West" }] },
    auth: { accountId: "admin-1", role: "ADMIN" },
    headers: {},
    ip: "127.0.0.1",
  }, res);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.locations, [
    { province: "Lumbini Province", district: "Parasi" },
  ]);
  assert.equal(calls.deleted, true);
  assert.deepEqual(calls.created, [{
    distributorId: "distributor-1",
    province: "Lumbini Province",
    district: "Parasi",
    isActive: true,
  }]);
  assert.equal(calls.audit.action, "DISTRIBUTOR_COVERAGE_UPDATED");
  assert.equal(calls.audit.entityId, "distributor-1");
});

test("admin pending-order listing returns parsed order details for allocation retry", async (t) => {
  const queryResults = [
    [{
      id: "order-1",
      items: JSON.stringify([{ productId: "product-1", quantity: 1 }]),
      address: JSON.stringify({ province: "Bagmati Province", district: "Kathmandu" }),
      amount: 100,
      status: "Order Placed",
      orderType: "ONLINE_STORE",
      fulfillmentStatus: "PENDING_ASSIGNMENT",
      date: 1n,
    }],
    1,
  ];
  stubMethod(t, prisma.order, "findMany", async (args) => {
    assert.equal(args.where.assignmentId, null);
    assert.deepEqual(args.where.orderType.in, ["ONLINE_STORE", "ADMIN_DIRECT"]);
    return queryResults[0];
  });
  stubMethod(t, prisma.order, "count", async () => queryResults[1]);
  stubMethod(t, prisma, "$transaction", async (queries) => Promise.all(queries));

  let response;
  const res = {
    status: (status) => ({
      json: (body) => {
        response = { status, body };
        return response;
      },
    }),
    json: (body) => {
      response = { status: 200, body };
      return response;
    },
  };

  await getUnassignedOrders({ query: {} }, res);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(response.body.orders[0].items, [{ productId: "product-1", quantity: 1 }]);
  assert.deepEqual(response.body.orders[0].address, { province: "Bagmati Province", district: "Kathmandu" });
  assert.equal(response.body.orders[0].date, 1);
});
