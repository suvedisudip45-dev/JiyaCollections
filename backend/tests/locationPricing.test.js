import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeNepalLocation,
  findEligibleLocationManufacturer,
  getAvailableVariantQuantity,
  reserveVariantQuantities,
  resolveEffectiveProductDiscount,
} from "../services/locationPricingService.js";

test("location pricing canonicalizes valid Nepal province and district pairs only", () => {
  assert.deepEqual(canonicalizeNepalLocation("Bagmati Province", "Kathmandu"), {
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

test("manufacturer eligibility uses unreserved variant quantity", () => {
  const inventory = {
    quantity: 20,
    reservedQty: 1,
    variantsStock: [
      { size: "M", color: "Black", quantity: 3, reservedQty: 2 },
      { size: "L", color: "White", quantity: 10, reservedQty: 1 },
    ],
  };
  assert.equal(getAvailableVariantQuantity(inventory, { size: "M", color: "Black" }), 1);
  assert.equal(getAvailableVariantQuantity(inventory, { size: "S", color: "Black" }), 0);
  assert.equal(getAvailableVariantQuantity(inventory, {}), 10);
});

test("location discount replaces product discount only when local stock qualifies", () => {
  assert.deepEqual(resolveEffectiveProductDiscount({ productDiscount: 10, locationDiscount: 20, locationEligible: true }), {
    percentage: 20,
    source: "LOCATION",
  });
  assert.deepEqual(resolveEffectiveProductDiscount({ productDiscount: 10, locationDiscount: 20, locationEligible: false }), {
    percentage: 10,
    source: "PRODUCT",
  });
  assert.deepEqual(resolveEffectiveProductDiscount({ productDiscount: 0, locationDiscount: null, locationEligible: false }), {
    percentage: 0,
    source: "BASE",
  });
});

test("checkout location eligibility requires one mapped hub to cover the complete cart", () => {
  const locations = [
    {
      manufacturerId: "m1",
      manufacturer: { id: "m1", inventory: [{ productId: "p1", quantity: 5, reservedQty: 0 }] },
    },
    {
      manufacturerId: "m2",
      manufacturer: { id: "m2", inventory: [{ productId: "p2", quantity: 5, reservedQty: 0 }] },
    },
    {
      manufacturerId: "m3",
      manufacturer: { id: "m3", inventory: [
        { productId: "p1", quantity: 5, reservedQty: 0 },
        { productId: "p2", quantity: 2, reservedQty: 0 },
      ] },
    },
  ];
  const cart = [
    { productId: "p1", quantity: 1 },
    { productId: "p2", size: "M", color: "Black", quantity: 2 },
  ];

  assert.equal(findEligibleLocationManufacturer(locations, cart).manufacturerId, "m3");
  assert.equal(findEligibleLocationManufacturer(locations.slice(0, 2), cart), null);
  assert.equal(findEligibleLocationManufacturer(locations, [{ productId: "p2", quantity: 1 }], { wholeBasket: false })[0]?.manufacturerId, "m2");
});

test("variant reservation distributes generic quantity across available variants", () => {
  const variants = [
    { size: "S", color: "Black", quantity: 2, reservedQty: 1 },
    { size: "M", color: "Black", quantity: 3, reservedQty: 0 },
  ];
  const reserved = reserveVariantQuantities(variants, { productId: "p1", quantity: 3 });
  assert.deepEqual(reserved.map((variant) => variant.reservedQty), [2, 2]);
  assert.equal(reserved.reduce((sum, variant) => sum + variant.reservedQty, 0), 4);
  assert.throws(() => reserveVariantQuantities(variants, { productId: "p1", size: "XL", quantity: 1 }), { code: "LOCATION_STOCK_CHANGED" });
});