import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../config/db.js";
import { runAllocationEngine } from "../controllers/orderAssignmentController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const createBalance = (id, quantityOnHand, reservedQuantity = 0) => ({
  id,
  quantityOnHand,
  reservedQuantity,
  inventorySku: {
    productId: "product-1",
    sizeKey: "medium",
    colorKey: "navy blue",
  },
});

test("allocator selects a covered distributor with sufficient aggregate variant stock and reserves it", async (t) => {
  const order = {
    id: "order-1",
    status: "Order Placed",
    assignmentId: null,
    fulfillmentStatus: "pending",
    manufacturerId: "legacy-manufacturer",
    address: JSON.stringify({ province: "Bagmati Province", district: "Kathmandu", city: "Kathmandu" }),
    items: JSON.stringify([
      { productId: "product-1", size: "Medium", color: "Navy Blue", quantity: 2 },
      { productId: "product-1", size: "Medium", color: "Navy Blue", quantity: 3 },
    ]),
  };
  const eligibleDistributor = {
    id: "distributor-2",
    name: "Kathmandu Hub",
    city: "Kathmandu",
    stockLocations: [{ balances: [createBalance("balance-1", 4), createBalance("balance-2", 3, 1)] }],
  };
  const insufficientDistributor = {
    id: "distributor-1",
    name: "Small Hub",
    city: "Kathmandu",
    stockLocations: [{ balances: [createBalance("balance-3", 4)] }],
  };
  const reserved = [];
  let assignmentData;

  stubMethod(t, prisma.order, "findUnique", async () => order);
  stubMethod(t, prisma.distributorLocation, "findMany", async (args) => {
    assert.deepEqual(args.where, {
      province: "Bagmati Province",
      district: "Kathmandu",
      isActive: true,
      distributor: { status: "ACTIVE", isActive: true },
    });
    return [insufficientDistributor, eligibleDistributor].map((distributor) => ({ distributor }));
  });
  stubMethod(t, prisma, "$transaction", async (callback) => callback({
    order: {
      updateMany: async () => ({ count: 1 }),
      update: async () => order,
    },
    product: {
      findUnique: async () => ({ id: "product-1", variants: [] }),
      update: async ({ data }) => ({ id: "product-1", ...data }),
    },
    inventoryBalance: {
      findMany: async ({ select } = {}) => select
        ? []
        : [
            { id: "balance-1", quantityOnHand: 4, reservedQuantity: 0 },
            { id: "balance-2", quantityOnHand: 3, reservedQuantity: 1 },
          ],
      updateMany: async ({ where, data }) => {
        reserved.push({ id: where.id, quantity: data.reservedQuantity.increment });
        return { count: 1 };
      },
    },
    orderAssignment: {
      create: async ({ data }) => {
        assignmentData = data;
        return { id: "assignment-1", ...data };
      },
    },
    systemAuditOutbox: { create: async () => ({ id: "audit-1" }) },
  }));

  const result = await runAllocationEngine(order.id);

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, eligibleDistributor.id);
  assert.equal(assignmentData.distributorId, eligibleDistributor.id);
  assert.equal("manufacturerId" in assignmentData, false);
  assert.deepEqual(reserved, [
    { id: "balance-1", quantity: 4 },
    { id: "balance-2", quantity: 1 },
  ]);
});

test("allocator does not assign when no covered distributor has every requested variant", async (t) => {
  stubMethod(t, prisma.order, "findUnique", async () => ({
    id: "order-2",
    status: "Order Placed",
    assignmentId: null,
    address: JSON.stringify({ province: "Bagmati Province", district: "Kathmandu" }),
    items: JSON.stringify([{ productId: "product-1", size: "Medium", color: "Navy Blue", quantity: 2 }]),
  }));
  stubMethod(t, prisma.distributorLocation, "findMany", async () => [{
    distributor: {
      id: "distributor-1",
      name: "Insufficient Hub",
      city: "Kathmandu",
      stockLocations: [{ balances: [createBalance("balance-1", 1)] }],
    },
  }]);

  const result = await runAllocationEngine("order-2");

  assert.equal(result.success, false);
  assert.match(result.message, /No approved distributor/);
});
