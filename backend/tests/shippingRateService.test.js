import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../config/db.js";
import { resolveDistrictShippingFee } from "../controllers/shippingController.js";
import {
  normalizeShippingRouteOverrides,
  resolveRouteShippingRate,
} from "../services/shippingRateService.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const config = {
  sameDistrictFee: 50,
  differentDistrictFee: 120,
  sameProvinceFee: 150,
  differentProvinceFee: 250,
  splitShipmentFee: 175,
  freeShippingMin: 1000,
  routeOverrides: [{
    originProvince: "Bagmati Province",
    originDistrict: "Kathmandu",
    destinationProvince: "Gandaki Province",
    destinationDistrict: "Kaski",
    fee: 250,
  }, {
    originProvince: "Bagmati Province",
    originDistrict: "Kathmandu",
    destinationProvince: "Koshi Province",
    destinationDistrict: "Sunsari",
    fee: 350,
  }],
};

test("route overrides distinguish priority corridors without requiring rates for every district", () => {
  const kathmanduToPokhara = resolveRouteShippingRate({
    originProvince: "Bagmati Province",
    originDistrict: "Kathmandu",
    destinationProvince: "Gandaki Province",
    destinationDistrict: "Kaski",
    subtotal: 500,
    config,
  });
  const kathmanduToDharan = resolveRouteShippingRate({
    originProvince: "Bagmati Province",
    originDistrict: "Kathmandu",
    destinationProvince: "Koshi Province",
    destinationDistrict: "Sunsari",
    subtotal: 500,
    config,
  });

  assert.equal(kathmanduToPokhara.fee, 250);
  assert.equal(kathmanduToPokhara.tier, "ROUTE_OVERRIDE");
  assert.equal(kathmanduToPokhara.label, "Kathmandu to Kaski");
  assert.equal(kathmanduToDharan.fee, 350);
});

test("route rates fall back to same-district, same-province, and cross-province tiers", () => {
  const withinDistrict = resolveRouteShippingRate({
    originProvince: "Bagmati Province",
    originDistrict: "Kathmandu",
    destinationProvince: "Bagmati Province",
    destinationDistrict: "Lalitpur",
    config: { ...config, routeOverrides: [] },
  });
  const withinProvince = resolveRouteShippingRate({
    originProvince: "Gandaki Province",
    originDistrict: "Kaski",
    destinationProvince: "Gandaki Province",
    destinationDistrict: "Parbat",
    config: { ...config, routeOverrides: [] },
  });
  const acrossProvince = resolveRouteShippingRate({
    originProvince: "Bagmati Province",
    originDistrict: "Kathmandu",
    destinationProvince: "Koshi Province",
    destinationDistrict: "Sunsari",
    config: { ...config, routeOverrides: [] },
  });

  assert.equal(withinDistrict.fee, 50);
  assert.equal(withinDistrict.tier, "SAME_DISTRICT");
  assert.equal(withinProvince.fee, 150);
  assert.equal(withinProvince.tier, "SAME_PROVINCE");
  assert.equal(acrossProvince.fee, 250);
  assert.equal(acrossProvince.tier, "DIFFERENT_PROVINCE");
});

test("free delivery applies after resolving the route rate", () => {
  const result = resolveRouteShippingRate({
    originProvince: "Bagmati Province",
    originDistrict: "Kathmandu",
    destinationProvince: "Gandaki Province",
    destinationDistrict: "Kaski",
    subtotal: 1000,
    config,
  });

  assert.equal(result.fee, 0);
  assert.equal(result.tier, "FREE_SHIPPING");
  assert.equal(result.rateTier, "ROUTE_OVERRIDE");
});

test("route override configuration rejects invalid and duplicate routes", () => {
  assert.throws(() => normalizeShippingRouteOverrides([{
    originProvince: "Bagmati Province",
    originDistrict: "Kathmandu",
    destinationProvince: "Gandaki Province",
    destinationDistrict: "Unknown",
    fee: 250,
  }]), /valid origin and destination districts/);

  assert.throws(() => normalizeShippingRouteOverrides([
    config.routeOverrides[0],
    { ...config.routeOverrides[0], fee: 300 },
  ]), /unique origin and destination districts/);
});

test("shipping quote uses the probable stocked distributor's route", async (t) => {
  stubMethod(t, prisma.shippingConfig, "findFirst", async () => config);
  stubMethod(t, prisma.distributor, "findMany", async () => [{
    id: "hub-1",
    name: "Kathmandu Hub",
    district: "Kathmandu",
    province: "Bagmati Province",
    locations: [{ province: "Bagmati Province", district: "Kathmandu", isActive: true }],
  }]);
  stubMethod(t, prisma.inventoryBalance, "findMany", async () => [{
    quantityOnHand: 5,
    reservedQuantity: 0,
    location: { distributorId: "hub-1" },
    inventorySku: { productId: "product-1", sizeKey: "medium", colorKey: "navy" },
  }]);

  const result = await resolveDistrictShippingFee({
    district: "Kaski",
    province: "Gandaki Province",
    items: [{ productId: "product-1", size: "Medium", color: "Navy", quantity: 1 }],
  });

  assert.equal(result.fee, 250);
  assert.deepEqual(result.probableDistributor, {
    id: "hub-1",
    name: "Kathmandu Hub",
    district: "Kathmandu",
    province: "Bagmati Province",
  });
});

test("split shipping quote uses the admin-configured flat fee and lists each shipment hub", async (t) => {
  stubMethod(t, prisma.shippingConfig, "findFirst", async () => config);
  stubMethod(t, prisma.distributor, "findMany", async () => [{
    id: "hub-1",
    name: "Kathmandu Hub",
    district: "Kathmandu",
    province: "Bagmati Province",
    qualityRating: 5,
    locations: [{ province: "Bagmati Province", district: "Kathmandu", isActive: true }],
  }, {
    id: "hub-2",
    name: "Pokhara Hub",
    district: "Kaski",
    province: "Gandaki Province",
    qualityRating: 4,
    locations: [{ province: "Gandaki Province", district: "Kaski", isActive: true }],
  }]);
  stubMethod(t, prisma.inventoryBalance, "findMany", async () => [{
    quantityOnHand: 5,
    reservedQuantity: 0,
    location: { distributorId: "hub-1" },
    inventorySku: { productId: "product-1", sizeKey: "medium", colorKey: "navy" },
  }, {
    quantityOnHand: 5,
    reservedQuantity: 0,
    location: { distributorId: "hub-2" },
    inventorySku: { productId: "product-2", sizeKey: "medium", colorKey: "navy" },
  }]);

  const result = await resolveDistrictShippingFee({
    district: "Sunsari",
    province: "Koshi Province",
    subtotal: 700,
    items: [
      { productId: "product-1", size: "Medium", color: "Navy", quantity: 1 },
      { productId: "product-2", size: "Medium", color: "Navy", quantity: 1 },
    ],
  });

  assert.equal(result.splitShipment, true);
  assert.equal(result.fee, 175);
  assert.equal(result.splitShipmentFee, 175);
  assert.deepEqual(result.shipments.map(({ distributor }) => distributor.id).sort(), ["hub-1", "hub-2"]);
});

test("shipping quote fails instead of returning a generic rate without a distributor", async (t) => {
  stubMethod(t, prisma.shippingConfig, "findFirst", async () => config);
  stubMethod(t, prisma.distributor, "findMany", async () => []);

  await assert.rejects(
    resolveDistrictShippingFee({
      district: "Kaski",
      province: "Gandaki Province",
      items: [{ productId: "product-1", size: "Medium", color: "Navy", quantity: 1 }],
    }),
    (error) => error.status === 409 && error.code === "NO_ACTIVE_DISTRIBUTOR"
  );
});
