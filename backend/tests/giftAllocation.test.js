import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateOrderGiftEligibility,
  createGiftSkuFromName,
  getDistributorGiftOptions,
  getManufacturerGiftOptions,
  normalizeGiftCategory,
} from "../services/giftService.js";

test("order value promotions provide the configured maximum gift value", () => {
  const order = { amount: 6500, rewardApplied: "{}" };
  const rules = [
    { triggerType: "ORDER_VALUE", minSpendThreshold: 5000, giftTargetValue: 300, isActive: true },
    { triggerType: "ORDER_VALUE", minSpendThreshold: 6000, giftTargetValue: 450, isActive: true },
    { triggerType: "ORDER_VALUE", minSpendThreshold: 7000, giftTargetValue: 900, isActive: true },
  ];

  assert.deepEqual(calculateOrderGiftEligibility(order, rules), {
    eligible: true,
    budget: 450,
    reasons: ["ORDER_VALUE"],
    loyaltyGiftValue: 0,
    orderValueGiftValue: 450,
    loyaltyGiftDescription: "",
  });
});

test("an active loyalty tier reward automatically qualifies the order", () => {
  const order = {
    amount: 1500,
    rewardApplied: JSON.stringify({ giftAmount: 350, giftDescription: "Member gift", levelName: "Gold" }),
  };

  assert.equal(calculateOrderGiftEligibility(order).eligible, true);
  assert.equal(calculateOrderGiftEligibility(order).budget, 350);
  assert.deepEqual(calculateOrderGiftEligibility(order).reasons, ["LOYALTY_TIER"]);
});

test("loyalty and order value budgets combine without exceeding the highest trigger", () => {
  const order = {
    amount: 8000,
    rewardApplied: { giftAmount: 300, giftDescription: "Member gift" },
  };
  const rules = [{ triggerType: "ORDER_VALUE", minSpendThreshold: 5000, giftTargetValue: 450 }];

  const result = calculateOrderGiftEligibility(order, rules);
  assert.equal(result.budget, 450);
  assert.deepEqual(result.reasons, ["LOYALTY_TIER", "ORDER_VALUE"]);
});

test("orders without an active loyalty gift or matching value rule do not qualify", () => {
  const order = { amount: 1500, rewardApplied: "{}" };

  assert.equal(calculateOrderGiftEligibility(order, []).eligible, false);
  assert.equal(calculateOrderGiftEligibility(order, [{ triggerType: "ORDER_VALUE", minSpendThreshold: 2000, giftTargetValue: 300 }]).eligible, false);
});

test("gift SKU is derived from its name and categories are constrained", () => {
  assert.equal(createGiftSkuFromName("Partner's Everyday Tote"), "GFT-PARTNER-S-EVERYDAY-TOTE");
  assert.equal(normalizeGiftCategory("partner-product"), "PARTNER_PRODUCT");
  assert.throws(() => normalizeGiftCategory("unknown"), /category must be/i);
});

test("manufacturer gift options are limited to the order's own hub and eligible value", async () => {
  let inventoryQuery;
  const client = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        manufacturerId: "hub-1",
        amount: 4000,
        rewardApplied: { giftAmount: 250, giftDescription: "Loyalty gift" },
        assignedGift: null,
      }),
    },
    loyaltyTierConfig: { findMany: async () => [] },
    manufacturerGiftInventory: {
      findMany: async (query) => {
        inventoryQuery = query;
        return [{
          id: "stock-1",
          giftId: "gift-1",
          quantityAvailable: 2,
          gift: { id: "gift-1", name: "Cotton Tote", sku: "GFT-COTTON-TOTE", category: "GENERAL", priceValue: 200 },
        }];
      },
    },
  };

  const result = await getManufacturerGiftOptions({ orderId: "order-1", manufacturerId: "hub-1", client });

  assert.equal(result.eligible, true);
  assert.equal(result.eligibility.budget, 250);
  assert.deepEqual(result.options.map(({ inventoryId, name }) => ({ inventoryId, name })), [
    { inventoryId: "stock-1", name: "Cotton Tote" },
  ]);
  assert.equal(inventoryQuery.where.manufacturerId, "hub-1");
  assert.equal(inventoryQuery.where.status, "ACCEPTED");
  assert.deepEqual(inventoryQuery.where.quantityAvailable, { gt: 0 });
  assert.equal(inventoryQuery.where.gift.priceValue.lte, 250);
});

test("manufacturer gift options reject orders owned by another hub", async () => {
  const client = {
    order: { findUnique: async () => ({ id: "order-1", manufacturerId: "hub-2" }) },
  };

  await assert.rejects(
    getManufacturerGiftOptions({ orderId: "order-1", manufacturerId: "hub-1", client }),
    /does not belong to this manufacturer/
  );
});

test("distributor gift options use only accepted stock owned by the order's distributor", async () => {
  let inventoryQuery;
  const client = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        distributorId: "distributor-1",
        amount: 4000,
        rewardApplied: { giftAmount: 250, giftDescription: "Loyalty gift" },
        assignedGift: null,
      }),
    },
    orderAssignment: { findUnique: async () => ({ distributorId: "distributor-1" }) },
    loyaltyTierConfig: { findMany: async () => [] },
    distributorGiftInventory: {
      findMany: async (query) => {
        inventoryQuery = query;
        return [{
          id: "stock-1",
          giftId: "gift-1",
          quantityAvailable: 2,
          gift: { id: "gift-1", name: "Cotton Tote", sku: "GFT-COTTON-TOTE", category: "GENERAL", priceValue: 200 },
        }];
      },
    },
  };

  const result = await getDistributorGiftOptions({ orderId: "order-1", distributorId: "distributor-1", client });

  assert.equal(result.eligible, true);
  assert.equal(inventoryQuery.where.distributorId, "distributor-1");
  assert.equal(inventoryQuery.where.status, "ACCEPTED");
  assert.deepEqual(inventoryQuery.where.quantityAvailable, { gt: 0 });
  assert.equal(inventoryQuery.where.gift.priceValue.lte, 250);
  assert.equal(result.options[0].inventoryId, "stock-1");
});

test("distributor gift options reject orders owned by another hub", async () => {
  const client = {
    order: { findUnique: async () => ({ id: "order-1", distributorId: "distributor-2" }) },
    orderAssignment: { findUnique: async () => ({ distributorId: "distributor-2" }) },
  };

  await assert.rejects(
    getDistributorGiftOptions({ orderId: "order-1", distributorId: "distributor-1", client }),
    /does not belong to this distributor/
  );
});

test("distributor gift options accept an auto-allocated order owned through its fulfillment assignment", async () => {
  let inventoryQuery;
  const client = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        distributorId: null,
        amount: 4000,
        rewardApplied: { giftAmount: 250, giftDescription: "Loyalty gift" },
        assignedGift: null,
      }),
    },
    orderAssignment: { findUnique: async () => ({ distributorId: "distributor-1" }) },
    loyaltyTierConfig: { findMany: async () => [] },
    distributorGiftInventory: {
      findMany: async (query) => {
        inventoryQuery = query;
        return [];
      },
    },
  };

  const result = await getDistributorGiftOptions({
    orderId: "order-1",
    distributorId: "distributor-1",
    client,
  });

  assert.equal(result.eligible, true);
  assert.equal(inventoryQuery.where.distributorId, "distributor-1");
});
