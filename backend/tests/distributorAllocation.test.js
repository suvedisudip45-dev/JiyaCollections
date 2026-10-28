import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../config/db.js";
import {
  previewDistributorAllocation,
  runAllocationEngine,
} from "../controllers/orderAssignmentController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const createBalance = (id, quantityOnHand, reservedQuantity = 0, {
  productId = "product-1",
  sizeKey = "medium",
  colorKey = "navy blue",
} = {}) => ({
  id,
  quantityOnHand,
  reservedQuantity,
  inventorySku: {
    productId,
    sizeKey,
    colorKey,
  },
});

const createDistributor = ({
  id,
  name = id,
  province = "Bagmati Province",
  district = "Kathmandu",
  ncmPickupBranch = "",
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
  ncmPickupBranch,
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

const installAllocationMocks = (t, {
  order = createOrder(),
  distributors = [],
  inactiveInTransaction = [],
  missingProductIds = [],
} = {}) => {
  let assignmentData;
  const auditEvents = [];
  const stockQueryDistributorIds = [];
  const transactionEvents = [];
  stubMethod(t, prisma.order, "findUnique", async () => order);
  stubMethod(t, prisma.product, "findMany", async ({ where }) =>
    where.id.in.filter((productId) => !missingProductIds.includes(productId)).map((id) => ({ id }))
  );
  stubMethod(t, prisma.distributor, "findMany", async (args) => {
    assert.deepEqual(args.where, { status: "ACTIVE", isActive: true });
    return distributors;
  });
  stubMethod(t, prisma.inventoryBalance, "findMany", async ({ where }) => {
    const distributorIds = where.location.distributorId.in;
    stockQueryDistributorIds.push(distributorIds);
    return distributors
      .filter((distributor) => distributorIds.includes(distributor.id))
      .flatMap((distributor) => (distributor.stockLocations || [])
        .flatMap((stockLocation) => stockLocation.balances || [])
        .map((balance) => ({
          ...balance,
          location: { distributorId: distributor.id },
        })));
  });
  stubMethod(t, prisma, "$transaction", async (callback) => callback({
    distributor: {
      findFirst: async ({ where }) => {
        const selected = distributors.find((distributor) => distributor.id === where.id);
        return selected && !inactiveInTransaction.includes(selected.id) ? { id: selected.id } : null;
      },
    },
    order: {
      updateMany: async () => {
        transactionEvents.push("order-claimed");
        return { count: 1 };
      },
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
      updateMany: async ({ data }) => {
        transactionEvents.push("stock-reserved");
        assert.equal(data.reservedQuantity.increment, 2);
        return { count: 1 };
      },
    },
    orderAssignment: {
      create: async ({ data }) => {
        transactionEvents.push("assignment-created");
        assignmentData = data;
        return { id: "assignment-1", ...data };
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        auditEvents.push(data.event);
        return { id: "audit-1" };
      },
    },
  }));
  return {
    getAssignment: () => assignmentData,
    getStockQueryDistributorIds: () => stockQueryDistributorIds,
    getTransactionEvents: () => transactionEvents,
    getAuditEvents: () => auditEvents,
  };
};

test("allocator reserves distributor stock transactionally before distributor acceptance", async (t) => {
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
  const { getAssignment, getTransactionEvents } = installAllocationMocks(t, {
    distributors: [sameProvinceHub, exactDistrictHub],
  });

  const result = await runAllocationEngine("order-1");

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, exactDistrictHub.id);
  assert.equal(getAssignment().distributorId, exactDistrictHub.id);
  assert.equal(getAssignment().status, "assigned");
  assert.deepEqual(getTransactionEvents(), ["order-claimed", "stock-reserved", "assignment-created"]);
});

test("split order allocation stays with the hub selected for its product", async (t) => {
  const preferredHub = createDistributor({
    id: "preferred-hub",
    qualityRating: 3,
  });
  const higherRatedHub = createDistributor({
    id: "higher-rated-hub",
    qualityRating: 5,
  });
  const { getAssignment } = installAllocationMocks(t, {
    distributors: [higherRatedHub, preferredHub],
  });

  const result = await runAllocationEngine("order-1", {
    preferredDistributorId: preferredHub.id,
  });

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, preferredHub.id);
  assert.equal(getAssignment().distributorId, preferredHub.id);
});

test("allocator falls back from an out-of-stock preferred hub to a stocked hub by location tier", async (t) => {
  const preferredHub = createDistributor({
    id: "preferred-empty-hub",
    stock: [createBalance("preferred-short-balance", 1)],
  });
  const sameProvinceHub = createDistributor({
    id: "same-province-stocked-hub",
    district: "Lalitpur",
    locations: [],
    qualityRating: 5,
  });
  const { getAssignment } = installAllocationMocks(t, {
    distributors: [preferredHub, sameProvinceHub],
  });

  const result = await runAllocationEngine("order-1", {
    preferredDistributorId: preferredHub.id,
  });

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, sameProvinceHub.id);
  assert.equal(getAssignment().distributorId, sameProvinceHub.id);
});

test("admin forced assignment selects only the requested stocked distributor and records its reason", async (t) => {
  const defaultHub = createDistributor({ id: "default-hub", qualityRating: 5 });
  const selectedHub = createDistributor({
    id: "admin-selected-hub",
    district: "Lalitpur",
    locations: [],
    qualityRating: 1,
  });
  const { getAssignment, getAuditEvents, getStockQueryDistributorIds } = installAllocationMocks(t, {
    order: {
      ...createOrder(),
      orderType: "ONLINE_STORE",
      fulfillmentStatus: "PENDING_ASSIGNMENT",
    },
    distributors: [defaultHub, selectedHub],
  });

  const result = await runAllocationEngine("order-1", {
    preferredDistributorId: selectedHub.id,
    forcePreferredDistributorId: true,
    adminOverrideReason: "Customer delivery deadline requires this local hub.",
    actorId: "admin-account-1",
    actorRole: "ADMIN",
    portalSource: "ADMIN",
  });

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, selectedHub.id);
  assert.equal(getAssignment().distributorId, selectedHub.id);
  assert.match(getAssignment().notes, /Customer delivery deadline/);
  assert.deepEqual(getStockQueryDistributorIds(), [[selectedHub.id]]);
  assert.equal(getAuditEvents()[0].action, "ORDER_ADMIN_ASSIGNED_DISTRIBUTOR");
  assert.equal(getAuditEvents()[0].afterState.reason, "Customer delivery deadline requires this local hub.");
});

test("admin forced assignment does not fall back when the selected distributor lacks stock", async (t) => {
  const stockedDefaultHub = createDistributor({ id: "default-hub" });
  const selectedHub = createDistributor({
    id: "admin-selected-hub",
    stock: [createBalance("selected-short-balance", 1)],
  });
  const { getAssignment, getStockQueryDistributorIds } = installAllocationMocks(t, {
    order: {
      ...createOrder(),
      orderType: "ONLINE_STORE",
      fulfillmentStatus: "PENDING_ASSIGNMENT",
    },
    distributors: [stockedDefaultHub, selectedHub],
  });

  const result = await runAllocationEngine("order-1", {
    preferredDistributorId: selectedHub.id,
    forcePreferredDistributorId: true,
  });

  assert.equal(result.success, false);
  assert.equal(result.code, "INSUFFICIENT_DISTRIBUTOR_STOCK");
  assert.equal(getAssignment(), undefined);
  assert.deepEqual(getStockQueryDistributorIds(), [[selectedHub.id]]);
});

test("shipping allocation preview uses the same priority-ranked stocked distributor", async (t) => {
  const exactDistrictHub = createDistributor({ id: "exact-hub", qualityRating: 2.5 });
  const sameProvinceHub = createDistributor({
    id: "province-hub",
    district: "Lalitpur",
    qualityRating: 5,
  });
  installAllocationMocks(t, { distributors: [sameProvinceHub, exactDistrictHub] });

  const result = await previewDistributorAllocation({
    address: { province: "Bagmati Province", district: "Kathmandu" },
    items: [{ productId: "product-1", size: "Medium", color: "Navy Blue", quantity: 2 }],
  });

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, exactDistrictHub.id);
  assert.equal(result.distributor.district, "Kathmandu");
});

test("shipping allocation preview splits products between hubs when no single hub has the full cart", async (t) => {
  const apparelHub = createDistributor({
    id: "apparel-hub",
    stock: [createBalance("apparel-balance", 3, 0, { productId: "product-1" })],
  });
  const accessoryHub = createDistributor({
    id: "accessory-hub",
    stock: [createBalance("accessory-balance", 3, 0, { productId: "product-2" })],
  });
  installAllocationMocks(t, { distributors: [apparelHub, accessoryHub] });

  const result = await previewDistributorAllocation({
    address: { province: "Bagmati Province", district: "Kathmandu" },
    items: [
      { productId: "product-1", size: "Medium", color: "Navy Blue", quantity: 2 },
      { productId: "product-2", size: "Medium", color: "Navy Blue", quantity: 1 },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(result.splitShipments.length, 2);
  assert.deepEqual(result.splitShipments.map(({ distributor }) => distributor.id).sort(), [
    "accessory-hub",
    "apparel-hub",
  ]);
  assert.deepEqual(result.splitShipments.map(({ items }) => items[0].qty).sort(), [1, 2]);
});

test("shipping allocation preview splits one product quantity across stock-eligible hubs", async (t) => {
  const higherRatedHub = createDistributor({
    id: "higher-rated-hub",
    qualityRating: 5,
    stock: [createBalance("higher-rated-balance", 2)],
  });
  const nextHub = createDistributor({
    id: "next-hub",
    qualityRating: 4,
    stock: [createBalance("next-balance", 3)],
  });
  installAllocationMocks(t, { distributors: [higherRatedHub, nextHub] });

  const result = await previewDistributorAllocation({
    address: { province: "Bagmati Province", district: "Kathmandu" },
    items: [{ productId: "product-1", size: "Medium", color: "Navy Blue", quantity: 4 }],
  });

  assert.equal(result.success, true);
  assert.deepEqual(
    result.splitShipments.map(({ distributor, items }) => [distributor.id, items[0].qty]),
    [["higher-rated-hub", 2], ["next-hub", 2]]
  );
});

test("overlapping coverage is resolved by distributor rating", async (t) => {
  const lowerRatedHub = createDistributor({
    id: "lower-rated-hub",
    qualityRating: 3.5,
    ratingCount: 20,
  });
  const higherRatedHub = createDistributor({
    id: "higher-rated-hub",
    qualityRating: 4.8,
    ratingCount: 3,
  });
  installAllocationMocks(t, { distributors: [lowerRatedHub, higherRatedHub] });

  const result = await runAllocationEngine("order-1");

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, higherRatedHub.id);
});

test("registered district is the default service area when no coverage is configured", async (t) => {
  const defaultCoverageHub = createDistributor({
    id: "default-coverage-hub",
    qualityRating: 2.5,
    locations: [],
  });
  const higherRatedSameProvinceHub = createDistributor({
    id: "same-province-hub",
    district: "Lalitpur",
    qualityRating: 5,
    locations: [],
  });
  installAllocationMocks(t, { distributors: [higherRatedSameProvinceHub, defaultCoverageHub] });

  const result = await runAllocationEngine("order-1");

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, defaultCoverageHub.id);
});

test("matching NCM branch is used before a same-province fallback", async (t) => {
  const matchingBranchHub = createDistributor({
    id: "branch-hub",
    province: "Gandaki Province",
    district: "Kaski",
    ncmPickupBranch: "Kathmandu",
    qualityRating: 3,
  });
  const provinceHub = createDistributor({
    id: "province-hub",
    district: "Lalitpur",
    ncmPickupBranch: "Lalitpur",
    qualityRating: 5,
  });
  const order = createOrder();
  order.address = JSON.stringify({
    province: "Bagmati Province",
    district: "Kathmandu",
    ncmBranch: " KATHMANDU ",
  });
  installAllocationMocks(t, { order, distributors: [provinceHub, matchingBranchHub] });

  const result = await runAllocationEngine("order-1");

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, matchingBranchHub.id);
});

test("same-district hub ranks above a matching NCM branch", async (t) => {
  const localHub = createDistributor({ id: "same-district-hub", qualityRating: 2 });
  const branchHub = createDistributor({
    id: "branch-hub",
    province: "Gandaki Province",
    district: "Kaski",
    ncmPickupBranch: "Kathmandu",
    qualityRating: 5,
  });
  const order = createOrder();
  order.address = JSON.stringify({
    province: "Bagmati Province",
    district: "Kathmandu",
    ncmBranch: "Kathmandu",
  });
  installAllocationMocks(t, { order, distributors: [branchHub, localHub] });

  const result = await runAllocationEngine("order-1");

  assert.equal(result.success, true);
  assert.equal(result.distributor.id, localHub.id);
});

test("stock lookup is limited to the highest-priority location tier", async (t) => {
  const localHub = createDistributor({ id: "local-hub" });
  const provinceHub = createDistributor({ id: "province-hub", district: "Lalitpur" });
  const { getStockQueryDistributorIds } = installAllocationMocks(t, {
    distributors: [provinceHub, localHub],
  });

  const result = await runAllocationEngine("order-1");

  assert.equal(result.success, true);
  assert.deepEqual(getStockQueryDistributorIds(), [[localHub.id]]);
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
  assert.match(result.message, /No single active distributor has enough/);
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

test("allocator reports missing products before checking distributor stock", async (t) => {
  installAllocationMocks(t, { missingProductIds: ["product-1"] });

  const result = await runAllocationEngine("order-1");

  assert.equal(result.success, false);
  assert.equal(result.code, "PRICE_PRODUCT_NOT_FOUND");
  assert.equal(result.productId, "product-1");
  assert.match(result.message, /Product not found: product-1/);
});

test("allocator does not assign an order if the selected distributor became inactive", async (t) => {
  const distributor = createDistributor({ id: "just-deactivated" });
  installAllocationMocks(t, {
    distributors: [distributor],
    inactiveInTransaction: [distributor.id],
  });

  const result = await runAllocationEngine("order-1");

  assert.equal(result.success, false);
  assert.equal(result.code, "DISTRIBUTOR_INACTIVE");
  assert.match(result.message, /no longer active/i);
});
