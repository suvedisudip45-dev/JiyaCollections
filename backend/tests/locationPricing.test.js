import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import {
  canonicalizeNepalLocation,
  resolveLocationProductPrices,
  resolveEffectiveProductDiscount,
  saveLocationProductDiscount,
  selectLocationProductRule,
} from "../services/locationPricingService.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

test("location pricing canonicalizes valid Nepal province and district pairs only", () => {
  assert.deepEqual(canonicalizeNepalLocation("Bagmati Province", "Kathmandu"), {
    province: "Bagmati Province",
    district: "Kathmandu",
  });
  assert.deepEqual(canonicalizeNepalLocation("Bagmati Province", "Kathmandu District"), {
    province: "Bagmati Province",
    district: "Kathmandu",
  });
  assert.deepEqual(canonicalizeNepalLocation("Lumbini Province", "Nawalparasi West"), {
    province: "Lumbini Province",
    district: "Parasi",
  });
  assert.equal(canonicalizeNepalLocation("Koshi Province", "Kathmandu"), null);
  assert.equal(canonicalizeNepalLocation("Bagmati", "Kathmandu"), null);
});

test("a distributor-specific price rule takes precedence over a legacy location rule", () => {
  const rules = [
    { distributorId: null, discountPercentage: 10 },
    { distributorId: "hub-kathmandu", discountPercentage: 20 },
  ];
  assert.equal(selectLocationProductRule(rules, "hub-kathmandu"), rules[1]);
  assert.equal(selectLocationProductRule(rules, "other-hub"), rules[0]);
  assert.equal(selectLocationProductRule(rules.slice(1), "other-hub"), null);
});

test("location discount replaces product discount when the selected distributor has a matching rule", () => {
  assert.deepEqual(resolveEffectiveProductDiscount({ productDiscount: 10, locationDiscount: 20, hasLocationRule: true }), {
    percentage: 20,
    source: "LOCATION",
  });
  assert.deepEqual(resolveEffectiveProductDiscount({ productDiscount: 10, locationDiscount: 0, hasLocationRule: true }), {
    percentage: 0,
    source: "LOCATION",
  });
  assert.deepEqual(resolveEffectiveProductDiscount({ productDiscount: 10, locationDiscount: 20, hasLocationRule: false }), {
    percentage: 10,
    source: "PRODUCT",
  });
  assert.deepEqual(resolveEffectiveProductDiscount({ productDiscount: 0, locationDiscount: null, hasLocationRule: false }), {
    percentage: 0,
    source: "BASE",
  });
});

test("checkout price resolution applies the selected distributor rule without manufacturer lookups", async () => {
  const client = {
    product: {
      findMany: async () => [{ id: "product-1", price: 1250, discount: 5 }],
    },
    locationProductDiscount: {
      findMany: async ({ where }) => {
        assert.deepEqual(where.OR, [
          { distributorId: "hub-kathmandu" },
          { distributorId: null },
        ]);
        return [
          { productId: "product-1", distributorId: "hub-kathmandu", discountPercentage: 20 },
          { productId: "product-1", distributorId: null, discountPercentage: 10 },
        ];
      },
    },
  };
  const result = await resolveLocationProductPrices({
    items: [{ productId: "product-1", size: "M", color: "Black", quantity: 2 }],
    province: "Bagmati Province",
    district: "Kathmandu",
    distributorId: "hub-kathmandu",
    client,
  });
  assert.equal(result.items[0].discountSource, "LOCATION");
  assert.equal(result.items[0].effectiveDiscountPercentage, 20);
  assert.equal(result.items[0].effectiveUnitPrice, 1000);
  assert.equal(result.items[0].locationDiscountDistributorId, "hub-kathmandu");
});

test("without a selected distributor, distributor-specific rules do not change the price", async () => {
  const client = {
    product: {
      findMany: async () => [{ id: "product-1", price: 1250, discount: 5 }],
    },
    locationProductDiscount: {
      findMany: async ({ where }) => {
        assert.equal(where.distributorId, null);
        return [];
      },
    },
  };
  const result = await resolveLocationProductPrices({
    items: [{ productId: "product-1", quantity: 1 }],
    province: "Bagmati Province",
    district: "Kathmandu",
    client,
  });
  assert.equal(result.items[0].discountSource, "PRODUCT");
  assert.equal(result.items[0].effectiveDiscountPercentage, 5);
});

test("saving a place-wise rule scopes its unique key to the distributor", async (t) => {
  let upsertArgs;
  stubMethod(t, prisma.product, "findUnique", async () => ({ id: "product-1" }));
  stubMethod(t, prisma.distributor, "findFirst", async () => ({ id: "hub-kathmandu" }));
  stubMethod(t, prisma.locationProductDiscount, "upsert", async (args) => {
    upsertArgs = args;
    return args.create;
  });

  await saveLocationProductDiscount({
    productId: "product-1",
    distributorId: "hub-kathmandu",
    province: "Bagmati Province",
    district: "Kathmandu",
    discountPercentage: 20,
  });

  assert.deepEqual(upsertArgs.where.productId_province_district_scopeKey, {
    productId: "product-1",
    province: "Bagmati Province",
    district: "Kathmandu",
    scopeKey: "hub-kathmandu",
  });
  assert.equal(upsertArgs.create.distributorId, "hub-kathmandu");
  assert.equal(upsertArgs.create.scopeKey, "hub-kathmandu");
});