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

const createDistributor = ({
  id,
  name = id,
  province = "Bagmati Province",
  district = "Kathmandu",
  stock = [createBalance(`${id}-balance`, 10)],
  qualityRating = 0,
  ratingCount = 0,
  locations,
} = {}) => ({
  id,
  name,
  city: district,
  province,
  district,
  qualityRating,
  ratingCount,
  locations: locations ?? (province && district ? [{ province, district, isActive: true }] : []),
  stockLocations: [{ balances: stock }],
});

const createOrder = (id = "order-1") => ({
  id,
  status: "Order Placed",
  assignmentId: null,
  fulfillmentStatus: "pending",
  manufacturerId: "legacy-manufacturer",
  address: JSON.stringify({ province: "Bagmati Province", district: "Kathmandu", city: "Kathmandu" }),
  items: JSON.stringify([{ productId: "product-1", size: "Medium", color: "Navy Blue", quantity: 2 }]),
});

const installAllocationMocks = (t, { order = createOrder(), distributors = [] } = {}) => {
  let assignmentData;
  stubMethod(t, prisma.order, "findUnique", async () => order);
  stubMethod(t, prisma.distributor, "findMany", async (args) => {
    assert.deepEqual(args.where, { status: "ACTIVE", isActive: true });
    return distributors;
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
      findMany: async ({ where, select } = {}) => {
        if (select || !where?.location?.distributorId) return [];
        const selected = distributors.find((distributor) => distributor.id === where.location.distributorId);
        return (selected?.stockLocations || []).flatMap((location) => location.balances || []);
      },
      updateMany: async () => ({ count: 1 }),
    },
    orderAssignment: {
      create: async ({ data }) => {
        assignmentData = data;
        return { id: "assignment-1", ...data };
      },
    },
    systemAuditOutbox: { create: async () => ({ id: "audit-1" }) },
  }));
  return { getAssignment: () => assignmentData };
};

test("allocator prefers exact district service coverage among stocked hubs", async (t) => {
  const exactDistrictHub = createDistributor({
    id: "exact-hub",
    qualityRating: 2.5,
    ratingCount: 4,
  });
  const sameProvinceHub = createDistributor({
    id: "province-hub",
    district: "Lalitpur",
    qualityRating: 5,
    ratingCount: 20,
  });
  const { getAssignment } = installAllocationMocks(t, {
    distributors: [sameProvinceHub, exactDistrictHub],
  });

  const result = await runAllocationEngine("order-1");

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, exactDistrictHub.id);
  assert.equal(getAssignment().distributorId, exactDistrictHub.id);
});

test("allocator falls back to a stocked hub in the same province before other provinces", async (t) => {
  const exactDistrictOutOfStock = createDistributor({
    id: "empty-exact",
    stock: [createBalance("empty-exact-balance", 1)],
  });
  const sameProvinceHub = createDistributor({
    id: "province-hub",
    district: "Lalitpur",
    locations: [],
  });
  const remoteHub = createDistributor({
    id: "remote-hub",
    province: "Koshi Province",
    district: "Morang",
    qualityRating: 5,
    ratingCount: 30,
  });
  const { getAssignment } = installAllocationMocks(t, {
    distributors: [remoteHub, exactDistrictOutOfStock, sameProvinceHub],
  });

  const result = await runAllocationEngine("order-1");

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, sameProvinceHub.id);
  assert.equal(getAssignment().distributorId, sameProvinceHub.id);
});

test("allocator ranks stocked nationwide fallback hubs by customer review rating", async (t) => {
  const highlyRatedHub = createDistributor({
    id: "high-rating-hub",
    province: "Koshi Province",
    district: "Morang",
    qualityRating: 4.8,
    ratingCount: 5,
  });
  const lowerRatedHub = createDistributor({
    id: "lower-rating-hub",
    province: "Gandaki Province",
    district: "Kaski",
    qualityRating: 4.2,
    ratingCount: 25,
  });
  const { getAssignment } = installAllocationMocks(t, {
    distributors: [lowerRatedHub, highlyRatedHub],
  });

  const result = await runAllocationEngine("order-1");

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, highlyRatedHub.id);
  assert.equal(getAssignment().distributorId, highlyRatedHub.id);
});

test("allocator returns variant shortages when no active distributor has sufficient stock", async (t) => {
  const insufficientHub = createDistributor({
    id: "small-hub",
    stock: [createBalance("short-balance", 1)],
  });
  installAllocationMocks(t, { distributors: [insufficientHub] });

  const result = await runAllocationEngine("order-1");

  assert.equal(result.success, false);
  assert.equal(result.code, "INSUFFICIENT_DISTRIBUTOR_STOCK");
  assert.match(result.message, /No active distributor has enough/);
  assert.deepEqual(result.stockShortages, [{
    distributor: "small-hub",
    shortages: [{
      productId: "product-1",
      size: "Medium",
      color: "Navy Blue",
      requiredQuantity: 2,
      availableQuantity: 1,
    }],
  }]);
});
