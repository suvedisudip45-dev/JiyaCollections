import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateOrderGiftEligibility,
  adjustAdminDistributorGiftStock,
  archiveGiftCatalog,
  archiveOrderValueGiftRule,
  assignGiftToDistributor,
  cancelPendingAdminDistributorGiftAllocation,
  autoAssignGiftForCheckout,
  bindGiftRewardsToCheckout,
  createGiftSkuFromName,
  createPendingGiftEntitlement,
  getDistributorGiftInventory,
  listAdminDistributorGiftStock,
  getDistributorGiftOptions,
  isExactGiftValue,
  getManufacturerGiftOptions,
  normalizeGiftCategory,
  onOrderReturned,
  reconcileNonCardGiftAssignment,
  releaseGiftRewardOnOrderCancellation,
  releaseUnfulfilledGiftForPackedCheckout,
  replaceAdminOrderGift,
  respondToDistributorGiftAllocation,
  saveGiftCatalog,
  saveLoyaltyTierConfig,
} from "../services/giftService.js";
import { claimCustomerReward } from "../services/marketingCardCustomerService.js";

test("order value promotions require an exact configured gift value", () => {
  const order = { amount: 6500, rewardApplied: "{}" };
  const rules = [
    { triggerType: "ORDER_VALUE", minSpendThreshold: 5000, giftTargetValue: 300, isActive: true },
    { triggerType: "ORDER_VALUE", minSpendThreshold: 6000, giftTargetValue: 450, isActive: true },
    { triggerType: "ORDER_VALUE", minSpendThreshold: 7000, giftTargetValue: 900, isActive: true },
  ];

  assert.deepEqual(calculateOrderGiftEligibility(order, rules), {
    eligible: true,
    budget: 450,
    requiredValue: 450,
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
  assert.equal(calculateOrderGiftEligibility(order).requiredValue, 350);
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

test("catalog value cannot change while the gift is assigned to an unfulfilled order", async () => {
  const client = {
    giftCatalog: {
      findUnique: async ({ where }) => where.id
        ? { id: "gift-1", priceValue: 400 }
        : { id: "gift-1" },
      update: async () => { throw new Error("Unexpected catalog update."); },
    },
    order: { count: async () => 1 },
  };

  await assert.rejects(
    saveGiftCatalog({ id: "gift-1", name: "Gift", priceValue: 500, category: "GENERAL" }, client),
    /cannot change while it is assigned to an unfulfilled order/
  );
});

test("admin gift catalog create and archive mutations write audit events", async () => {
  const audits = [];
  let archived = false;
  const client = {
    giftCatalog: {
      findUnique: async ({ where }) => where.id
        ? { id: "gift-1", name: "Gift box", sku: "GFT-GIFT-BOX", priceValue: 200, category: "GENERAL", isActive: true }
        : null,
      upsert: async ({ create }) => ({ id: "gift-1", ...create }),
      update: async () => { archived = true; return { id: "gift-1", isActive: false }; },
    },
    systemAuditOutbox: {
      create: async ({ data }) => { audits.push(data.event); return { id: `audit-${audits.length}` }; },
    },
  };
  const actorContext = { actorId: "admin-1", actorRole: "ADMIN" };

  await saveGiftCatalog({
    name: "Gift box",
    priceValue: 200,
    category: "GENERAL",
  }, client, actorContext);
  const result = await archiveGiftCatalog({ giftId: "gift-1", client, actorContext });

  assert.equal(archived, true);
  assert.equal(result.isActive, false);
  assert.deepEqual(audits.map(({ action }) => action), ["GIFT_CATALOG_CREATED", "GIFT_CATALOG_ARCHIVED"]);
  assert.ok(audits.every(({ actorId }) => actorId === "admin-1"));
});

test("admin order-value gift rules can be archived without changing loyalty tiers", async () => {
  let updates = 0;
  const audits = [];
  const activeRule = {
    id: "rule-1",
    tierName: "Orders over 5000",
    triggerType: "ORDER_VALUE",
    minSpendThreshold: 5000,
    giftTargetValue: 300,
    isActive: true,
  };
  const tx = {
    loyaltyTierConfig: {
      findUnique: async ({ where }) => where.id === "loyalty-tier"
        ? { id: "loyalty-tier", triggerType: "LOYALTY" }
        : activeRule,
      update: async ({ data }) => {
        updates += 1;
        return { ...activeRule, ...data };
      },
    },
    systemAuditOutbox: { create: async ({ data }) => { audits.push(data.event); return { id: "audit-1" }; } },
  };
  const updatedRule = await saveLoyaltyTierConfig({
    id: "rule-1",
    tierName: "Orders over 6000",
    minSpendThreshold: 6000,
    giftTargetValue: 350,
  }, tx, { actorId: "admin-1" });
  assert.equal(updatedRule.tierName, "Orders over 6000");
  const archived = await archiveOrderValueGiftRule({
    ruleId: "rule-1",
    actorContext: { actorId: "admin-1" },
    client: tx,
  });
  assert.equal(archived.isActive, false);
  assert.deepEqual(audits.map(({ action }) => action), [
    "ORDER_VALUE_GIFT_RULE_UPDATED",
    "ORDER_VALUE_GIFT_RULE_ARCHIVED",
  ]);
  await assert.rejects(
    archiveOrderValueGiftRule({ ruleId: "loyalty-tier", client: tx }),
    /Order-value gift rule not found/
  );
  await assert.rejects(
    saveLoyaltyTierConfig({
      id: "loyalty-tier",
      tierName: "Gold",
      minSpendThreshold: 1000,
      giftTargetValue: 200,
    }, tx),
    /Only order-value gift rules can be edited/
  );
  assert.equal(updates, 2);
});

test("admin order-value rule cannot overwrite a loyalty tier with a matching name", async () => {
  let auditWritten = false;
  const client = {
    loyaltyTierConfig: {
      findUnique: async () => ({ id: "loyalty-1", triggerType: "LOYALTY", tierName: "Gold" }),
      update: async () => { throw new Error("Unexpected loyalty tier update."); },
      create: async () => { throw new Error("Unexpected rule creation."); },
    },
    systemAuditOutbox: { create: async () => { auditWritten = true; } },
  };

  await assert.rejects(
    saveLoyaltyTierConfig({
      tierName: "Gold",
      minSpendThreshold: 5000,
      giftTargetValue: 300,
    }, client),
    /already used by a loyalty tier/
  );
  assert.equal(auditWritten, false);
});

test("admin distributor gift distribution writes a matching audit event", async () => {
  let audit;
  const inventory = {
    id: "stock-1",
    status: "PENDING_ACCEPTANCE",
    notes: "Admin distributed gift inventory to distributor.",
  };
  const tx = {
    distributorGiftInventory: { create: async () => inventory },
    distributorGiftMovementLog: { create: async () => ({}) },
    systemAuditOutbox: { create: async ({ data }) => { audit = data.event; return { id: "audit-1" }; } },
  };
  const client = {
    giftCatalog: { findUnique: async () => ({ id: "gift-1", isActive: true }) },
    distributor: { findFirst: async () => ({ id: "distributor-1" }) },
    $transaction: async (callback) => callback(tx),
  };

  await assignGiftToDistributor({
    distributorId: "distributor-1",
    giftId: "gift-1",
    quantity: 3,
    actorContext: { actorId: "admin-1" },
    client,
  });

  assert.equal(audit.action, "DISTRIBUTOR_GIFT_STOCK_DISTRIBUTED");
  assert.equal(audit.afterState.quantitySent, 3);
  assert.equal(audit.actorId, "admin-1");
});

test("admin cancellation preserves history and only cancels pending, unreserved stock", async () => {
  const movementEntries = [];
  let audit;
  let pendingStock = {
    id: "stock-1",
    distributorId: "distributor-1",
    giftId: "gift-1",
    status: "PENDING_ACCEPTANCE",
    quantitySent: 4,
    quantityAvailable: 4,
    quantityReserved: 0,
    receivedQuantity: null,
    notes: "Admin assigned.",
  };
  const tx = {
    distributorGiftInventory: {
      findUnique: async () => pendingStock,
      updateMany: async ({ where, data }) => {
        assert.equal(where.status, "PENDING_ACCEPTANCE");
        assert.equal(where.quantityReserved, 0);
        pendingStock = { ...pendingStock, ...data };
        return { count: 1 };
      },
    },
    distributorGiftMovementLog: { create: async ({ data }) => { movementEntries.push(data); return data; } },
    systemAuditOutbox: { create: async ({ data }) => { audit = data.event; return { id: "audit-1" }; } },
  };
  const result = await cancelPendingAdminDistributorGiftAllocation({
    inventoryId: "stock-1",
    reason: "Dispatch was created in error.",
    actorContext: { actorId: "admin-1" },
    client: { $transaction: async (callback) => callback(tx) },
  });

  assert.equal(result.status, "CANCELLED");
  assert.equal(result.quantityAvailable, 0);
  assert.equal(movementEntries[0].movementType, "CANCELLED");
  assert.equal(movementEntries[0].quantity, 4);
  assert.match(movementEntries[0].notes, /created in error/);
  assert.equal(audit.action, "DISTRIBUTOR_GIFT_ALLOCATION_CANCELLED");
  assert.equal(audit.afterState.status, "CANCELLED");
  assert.match(audit.afterState.cancellationReason, /created in error/);
});

test("admin cancellation rejects acknowledged stock and races without writing history", async () => {
  let writes = 0;
  const tx = {
    distributorGiftInventory: {
      findUnique: async () => ({
        id: "stock-1",
        distributorId: "distributor-1",
        giftId: "gift-1",
        status: "ACCEPTED",
        quantitySent: 4,
        quantityAvailable: 4,
        quantityReserved: 0,
      }),
      updateMany: async () => { writes += 1; return { count: 0 }; },
    },
    distributorGiftMovementLog: { create: async () => { writes += 1; } },
    systemAuditOutbox: { create: async () => { writes += 1; } },
  };
  const client = { $transaction: async (callback) => callback(tx) };

  await assert.rejects(
    cancelPendingAdminDistributorGiftAllocation({
      inventoryId: "stock-1",
      reason: "Wrong allocation.",
      client,
    }),
    /Only pending distributor gift allocations/
  );
  assert.equal(writes, 0);

  tx.distributorGiftInventory.findUnique = async () => ({
    id: "stock-1",
    distributorId: "distributor-1",
    giftId: "gift-1",
    status: "PENDING_ACCEPTANCE",
    quantitySent: 4,
    quantityAvailable: 4,
    quantityReserved: 0,
  });
  tx.distributorGiftInventory.updateMany = async () => ({ count: 0 });
  await assert.rejects(
    cancelPendingAdminDistributorGiftAllocation({
      inventoryId: "stock-1",
      reason: "Wrong allocation.",
      client,
    }),
    (error) => error.code === "GIFT_ALLOCATION_CHANGED"
  );
  assert.equal(writes, 0);
});

test("admin gift stock adjustments preserve reservations and record movement plus audit", async () => {
  let stock = {
    id: "stock-1",
    distributorId: "distributor-1",
    giftId: "gift-1",
    status: "ACCEPTED",
    quantityAvailable: 5,
    quantityReserved: 2,
  };
  let movement;
  let audit;
  const tx = {
    distributorGiftInventory: {
      findUnique: async () => stock,
      updateMany: async ({ where, data }) => {
        assert.equal(where.quantityAvailable, 5);
        assert.equal(where.quantityReserved, 2);
        stock = { ...stock, quantityAvailable: stock.quantityAvailable + data.quantityAvailable.increment };
        return { count: 1 };
      },
    },
    distributorGiftMovementLog: { create: async ({ data }) => { movement = data; return data; } },
    systemAuditOutbox: { create: async ({ data }) => { audit = data.event; return { id: "audit-1" }; } },
  };
  const client = { $transaction: async (callback) => callback(tx) };

  const result = await adjustAdminDistributorGiftStock({
    inventoryId: "stock-1",
    adjustment: -3,
    reason: "Physical count confirmed three fewer units.",
    actorContext: { actorId: "admin-1", actorRole: "ADMIN" },
    client,
  });

  assert.equal(result.quantityAvailable, 2);
  assert.equal(result.quantityReserved, 2);
  assert.equal(movement.movementType, "ADJUSTED");
  assert.equal(movement.quantity, -3);
  assert.equal(movement.notes, "Physical count confirmed three fewer units.");
  assert.equal(audit.action, "DISTRIBUTOR_GIFT_STOCK_ADJUSTED");
  assert.equal(audit.actorId, "admin-1");
});

test("admin gift stock listing is paginated and validates page size", async () => {
  let stockQuery;
  const client = {
    distributorGiftInventory: {
      findMany: async (query) => { stockQuery = query; return [{ id: "stock-51" }]; },
      count: async () => 101,
    },
  };
  const result = await listAdminDistributorGiftStock({ page: 2, pageSize: 50 }, client);

  assert.equal(stockQuery.skip, 50);
  assert.equal(stockQuery.take, 50);
  assert.deepEqual(result, { inventory: [{ id: "stock-51" }], total: 101, page: 2, pageSize: 50 });
  await assert.rejects(listAdminDistributorGiftStock({ page: 1, pageSize: 101 }, client), /between 1 and 100/);
});

test("admin gift stock adjustment requires a reason and cannot reduce below zero", async () => {
  let transactionStarted = false;
  const client = { $transaction: async (callback) => { transactionStarted = true; return callback({}); } };
  await assert.rejects(
    adjustAdminDistributorGiftStock({ inventoryId: "stock-1", adjustment: -1, reason: " ", client }),
    /reason is required/
  );
  assert.equal(transactionStarted, false);

  const tx = {
    distributorGiftInventory: {
      findUnique: async () => ({
        id: "stock-1",
        distributorId: "distributor-1",
        giftId: "gift-1",
        status: "ACCEPTED",
        quantityAvailable: 1,
        quantityReserved: 3,
      }),
    },
  };
  await assert.rejects(
    adjustAdminDistributorGiftStock({
      inventoryId: "stock-1",
      adjustment: -2,
      reason: "Correcting count.",
      client: { $transaction: async (callback) => callback(tx) },
    }),
    /cannot reduce available stock below zero/
  );
});

test("admin gift stock adjustment rejects a concurrent stock change without writing movement", async () => {
  let movementWritten = false;
  const tx = {
    distributorGiftInventory: {
      findUnique: async () => ({
        id: "stock-1",
        distributorId: "distributor-1",
        giftId: "gift-1",
        status: "ACCEPTED",
        quantityAvailable: 4,
        quantityReserved: 1,
      }),
      updateMany: async () => ({ count: 0 }),
    },
    distributorGiftMovementLog: { create: async () => { movementWritten = true; } },
    systemAuditOutbox: { create: async () => { throw new Error("Unexpected audit write."); } },
  };

  await assert.rejects(
    adjustAdminDistributorGiftStock({
      inventoryId: "stock-1",
      adjustment: 1,
      reason: "Physical count correction.",
      client: { $transaction: async (callback) => callback(tx) },
    }),
    (error) => error.code === "GIFT_STOCK_CHANGED"
  );
  assert.equal(movementWritten, false);
});

test("manufacturer gift options are limited to the order's own hub and eligible value", async () => {
  let inventoryQuery;
  const client = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        userId: "customer-1",
        manufacturerId: "hub-1",
        checkoutGroupId: "checkout-1",
        amount: 4000,
        rewardApplied: { giftAmount: 250, giftDescription: "Loyalty gift" },
        assignedGift: null,
      }),
      findFirst: async () => null,
    },
    giftRewardEntitlement: {
      findFirst: async () => ({ id: "card-entitlement", rewardValue: 250 }),
    },
    manufacturerGiftInventory: {
      findMany: async (query) => {
        inventoryQuery = query;
        return [{
          id: "stock-1",
          giftId: "gift-1",
          quantityAvailable: 2,
          gift: { id: "gift-1", name: "Cotton Tote", sku: "GFT-COTTON-TOTE", category: "GENERAL", priceValue: 250 },
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
  assert.deepEqual(inventoryQuery.where.gift.priceValue, { equals: 250, gt: 0 });
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
        userId: "customer-1",
        distributorId: "distributor-1",
        checkoutGroupId: "checkout-1",
        amount: 4000,
        rewardApplied: { giftAmount: 250, giftDescription: "Loyalty gift" },
        assignedGift: null,
      }),
      findFirst: async () => null,
    },
    orderAssignment: { findUnique: async () => ({ distributorId: "distributor-1" }) },
    giftRewardEntitlement: {
      findFirst: async () => ({ id: "card-entitlement", rewardValue: 250 }),
    },
    distributorGiftInventory: {
      findMany: async (query) => {
        inventoryQuery = query;
        return [{
          id: "stock-1",
          giftId: "gift-1",
          quantityAvailable: 2,
          gift: { id: "gift-1", name: "Cotton Tote", sku: "GFT-COTTON-TOTE", category: "GENERAL", priceValue: 250 },
        }];
      },
    },
  };

  const result = await getDistributorGiftOptions({ orderId: "order-1", distributorId: "distributor-1", client });

  assert.equal(result.eligible, true);
  assert.equal(inventoryQuery.where.distributorId, "distributor-1");
  assert.equal(inventoryQuery.where.status, "ACCEPTED");
  assert.deepEqual(inventoryQuery.where.quantityAvailable, { gt: 0 });
  assert.deepEqual(inventoryQuery.where.gift.priceValue, { equals: 250, gt: 0 });
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
        userId: "customer-1",
        distributorId: null,
        checkoutGroupId: "checkout-1",
        amount: 4000,
        rewardApplied: { giftAmount: 250, giftDescription: "Loyalty gift" },
        assignedGift: null,
      }),
      findFirst: async () => null,
    },
    orderAssignment: { findUnique: async () => ({ distributorId: "distributor-1" }) },
    giftRewardEntitlement: {
      findFirst: async () => ({ id: "card-entitlement", rewardValue: 250 }),
    },
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

test("split-shipment gift eligibility uses its reserved card reward value", async () => {
  let inventoryQuery;
  const client = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        userId: "customer-1",
        checkoutGroupId: "checkout-1",
        distributorId: null,
        amount: 3000,
        rewardApplied: {},
        assignedGift: null,
      }),
      findFirst: async () => null,
    },
    orderAssignment: { findUnique: async () => ({ distributorId: "distributor-1" }) },
    giftRewardEntitlement: {
      findFirst: async () => ({ id: "card-entitlement", rewardValue: 300 }),
    },
    distributorGiftInventory: {
      findMany: async (query) => { inventoryQuery = query; return []; },
    },
  };

  const result = await getDistributorGiftOptions({ orderId: "order-1", distributorId: "distributor-1", client });

  assert.equal(result.eligible, true);
  assert.equal(result.eligibility.requiredValue, 300);
  assert.deepEqual(inventoryQuery.where.gift.priceValue, { equals: 300, gt: 0 });
});

test("gift values are compared to currency precision instead of an under-budget cap", () => {
  assert.equal(isExactGiftValue(500, 500.004), true);
  assert.equal(isExactGiftValue(495, 500), false);
  assert.equal(isExactGiftValue(505, 500), false);
});

test("loyalty gift entitlement is created with the configured exact value", async () => {
  let upsertQuery;
  const client = {
    giftRewardEntitlement: {
      upsert: async (query) => {
        upsertQuery = query;
        return { id: "loyalty-entitlement", ...query.create };
      },
    },
  };

  const entitlement = await createPendingGiftEntitlement({
    client,
    customerId: "customer-1",
    sourceType: "LOYALTY",
    sourceKey: "LOYALTY_ORDER:order-1",
    rewardValue: 500,
  });

  assert.equal(entitlement.id, "loyalty-entitlement");
  assert.equal(upsertQuery.create.rewardValue, 500);
  assert.equal(upsertQuery.create.sourceType, "LOYALTY");
  assert.equal(upsertQuery.where.sourceKey, "LOYALTY_ORDER:order-1");
});

test("checkout reserves a pending card or loyalty gift entitlement", async () => {
  const calls = [];
  const client = {
    giftRewardEntitlement: {
      findFirst: async (query) => {
        calls.push(["pending", query]);
        return { id: "old-card-reward", sourceType: "CARD", status: "PENDING" };
      },
      updateMany: async (query) => {
        calls.push(["reserve", query]);
        return { count: 1 };
      },
    },
  };

  const reservedId = await bindGiftRewardsToCheckout({
    client,
    customerId: "customer-1",
    checkoutGroupId: "checkout-1",
    orderId: "order-1",
    orderAmount: 3000,
    rewardApplied: { giftAmount: 500, giftDescription: "Gold reward" },
  });

  assert.equal(reservedId, "old-card-reward");
  assert.deepEqual(calls.find(([type]) => type === "pending")[1].where, {
    customerId: "customer-1",
    sourceType: { in: ["CARD", "LOYALTY"] },
    status: "PENDING",
    checkoutGroupId: null,
  });
  assert.equal(calls.find(([type]) => type === "pending")[1].where.status, "PENDING");
  assert.equal(calls.find(([type]) => type === "reserve")[1].data.checkoutGroupId, "checkout-1");
});

test("checkout reserves a selected loyalty reward before older queued gifts", async () => {
  const calls = [];
  const client = {
    giftRewardEntitlement: {
      findFirst: async (query) => {
        calls.push(["pending", query]);
        if (query.where.id === "current-loyalty-entitlement") {
          return { id: "current-loyalty-entitlement", sourceType: "LOYALTY", status: "PENDING" };
        }
        return { id: "older-card-entitlement", sourceType: "CARD", status: "PENDING" };
      },
      updateMany: async (query) => {
        calls.push(["reserve", query]);
        return { count: 1 };
      },
    },
  };

  const reservedId = await bindGiftRewardsToCheckout({
    client,
    customerId: "customer-1",
    orderId: "order-1",
    preferredEntitlementId: "current-loyalty-entitlement",
  });

  assert.equal(reservedId, "current-loyalty-entitlement");
  assert.equal(calls.filter(([type]) => type === "pending").length, 1);
  assert.equal(calls.find(([type]) => type === "reserve")[1].where.sourceType.in.includes("LOYALTY"), true);
});

test("checkout does not reserve a gift when no pending entitlement exists", async () => {
  let reservationLookup;
  const client = {
    giftRewardEntitlement: {
      findFirst: async ({ where }) => {
        reservationLookup = where;
        return null;
      },
    },
  };

  const result = await bindGiftRewardsToCheckout({
    client,
    customerId: "customer-1",
    orderId: "order-1",
    rewardApplied: { giftAmount: 200, giftDescription: "Loyalty gift" },
    orderAmount: 9000,
    orderValueRules: [{ minSpendThreshold: 1000, giftTargetValue: 200, isActive: true }],
  });

  assert.equal(result, null);
  assert.deepEqual(reservationLookup.sourceType, { in: ["CARD", "LOYALTY"] });
});

test("automatic gift allocation chooses an exact-value gift from the best assigned geography once per group", async () => {
  const mutations = [];
  let entitlementQuery;
  const groupOrders = [
    { id: "order-local", userId: "customer-1", address: { district: "Kathmandu", province: "Bagmati" }, amount: 1500, rewardApplied: {}, fulfillmentStatus: "quality_check", assignedGiftId: null },
    { id: "order-province", userId: "customer-1", address: {}, amount: 1500, rewardApplied: {}, fulfillmentStatus: "quality_check", assignedGiftId: null },
  ];
  const client = {
    order: {
      findUnique: async () => ({ ...groupOrders[0], checkoutGroupId: "checkout-1" }),
      findMany: async () => groupOrders,
      updateMany: async (query) => { mutations.push(["order", query]); return { count: 1 }; },
    },
    loyaltyTierConfig: { findMany: async () => [] },
    giftRewardEntitlement: {
      findFirst: async (query) => {
        entitlementQuery = query;
        const entitlement = { id: "entitlement-1", sourceType: "LOYALTY", rewardValue: 500, status: "RESERVED" };
        return Object.fromEntries(Object.keys(query.select).map((field) => [field, entitlement[field]]));
      },
      updateMany: async (query) => { mutations.push(["entitlement", query]); return { count: 1 }; },
    },
    orderAssignment: {
      findMany: async () => [
        { orderId: "order-local", distributorId: "local-distributor", status: "quality_check" },
        { orderId: "order-province", distributorId: "province-distributor", status: "quality_check" },
      ],
    },
    distributorGiftInventory: {
      findMany: async (query) => {
        assert.deepEqual(query.where.distributorId.in, ["local-distributor", "province-distributor"]);
        assert.deepEqual(query.where.gift, { isActive: true, priceValue: { equals: 500 } });
        return [
          { id: "stock-local", distributorId: "local-distributor", giftId: "gift-local", quantityAvailable: 1, gift: { id: "gift-local", name: "Local gift", priceValue: 500, category: "OTHER", isActive: true }, distributor: { district: "Kathmandu", province: "Bagmati" } },
          { id: "stock-province", distributorId: "province-distributor", giftId: "gift-province", quantityAvailable: 1, gift: { id: "gift-province", name: "Province gift", priceValue: 500, category: "PARTNER_PRODUCT", isActive: true }, distributor: { district: "Lalitpur", province: "Bagmati" } },
        ];
      },
      updateMany: async (query) => { mutations.push(["stock", query]); return { count: 1 }; },
    },
    distributorGiftMovementLog: { create: async (query) => { mutations.push(["movement", query]); return {}; } },
  };

  const result = await autoAssignGiftForCheckout({ orderId: "order-local", client });

  assert.equal(result.assigned, true);
  assert.equal(result.orderId, "order-local");
  assert.equal(result.distributorId, "local-distributor");
  assert.deepEqual(Object.keys(entitlementQuery.select).sort(), ["id", "rewardValue", "sourceType", "status"]);
  assert.equal(mutations.filter(([type]) => type === "order").length, 1);
  assert.equal(mutations.find(([type]) => type === "entitlement")[1].data.orderId, "order-local");
});

test("automatic gift allocation keeps the entitlement pending when assigned hubs have no matching stock", async () => {
  const mutations = [];
  const client = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        userId: "customer-1",
        checkoutGroupId: "checkout-1",
        address: { district: "Kathmandu", province: "Bagmati" },
      }),
      findMany: async () => [{
        id: "order-1",
        userId: "customer-1",
        address: { district: "Kathmandu", province: "Bagmati" },
        fulfillmentStatus: "quality_check",
        assignedGiftId: null,
      }],
      updateMany: async () => { mutations.push("order"); return { count: 1 }; },
    },
    loyaltyTierConfig: { findMany: async () => [] },
    giftRewardEntitlement: {
      findFirst: async () => ({ id: "entitlement-1", sourceType: "LOYALTY", rewardValue: 500, status: "RESERVED", checkoutGroupId: "checkout-1" }),
      updateMany: async () => { mutations.push("entitlement"); return { count: 1 }; },
    },
    orderAssignment: { findMany: async () => [{ orderId: "order-1", distributorId: "district-distributor", status: "quality_check" }] },
    distributorGiftInventory: { findMany: async () => [] },
  };

  const result = await autoAssignGiftForCheckout({ orderId: "order-1", client });

  assert.deepEqual(result, { assigned: false, reason: "no assigned distributor has an exact-value gift in stock" });
  assert.deepEqual(mutations, []);
});

test("automatic gift allocation never assigns a second gift to the same checkout group", async () => {
  let stockLookups = 0;
  const client = {
    order: {
      findUnique: async () => ({ id: "order-2", checkoutGroupId: "checkout-1" }),
      findMany: async () => [{ id: "order-1", assignedGiftId: "gift-1" }, { id: "order-2", assignedGiftId: null }],
    },
    distributorGiftInventory: { findMany: async () => { stockLookups += 1; return []; } },
  };

  const result = await autoAssignGiftForCheckout({ orderId: "order-2", client });

  assert.deepEqual(result, { assigned: false, reason: "checkout already has a gift" });
  assert.equal(stockLookups, 0);
});

test("automatic gift allocation ignores unsupported order-value entitlements", async () => {
  let stockLookups = 0;
  const client = {
    order: {
      findUnique: async () => ({ id: "order-1", userId: "customer-1", checkoutGroupId: "checkout-1" }),
      findMany: async () => [{ id: "order-1", assignedGiftId: null }],
    },
    giftRewardEntitlement: {
      findFirst: async ({ where }) => {
      assert.deepEqual(where.sourceType.in, ["CARD", "LOYALTY"]);
      return { id: "value-rule-entitlement", sourceType: "ORDER_VALUE", status: "RESERVED" };
      },
    },
    distributorGiftInventory: {
      findMany: async () => {
        stockLookups += 1;
        return [];
      },
    },
  };

  const result = await autoAssignGiftForCheckout({ orderId: "order-1", client });

  assert.deepEqual(result, { assigned: false, reason: "no reserved gift reward" });
  assert.equal(stockLookups, 0);
});

test("legacy non-card gift assignment releases distributor reserve and clears checklist gift", async () => {
  const calls = [];
  const tx = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        assignedGiftId: "gift-1",
        assignedDistributorGiftInventoryId: "stock-1",
        assignedGiftInventoryId: null,
        giftStatus: "PENDING_PACKING",
        fulfillmentStatus: "letter_ready",
        manufacturerId: null,
      }),
      updateMany: async (query) => {
        calls.push(["order", query]);
        return { count: 1 };
      },
    },
    giftRewardEntitlement: {
      findUnique: async () => ({
        id: "entitlement-1",
        sourceType: "ORDER_VALUE",
        marketingBenefitRedemptionId: null,
        status: "ASSIGNED",
      }),
      updateMany: async (query) => {
        calls.push(["entitlement", query]);
        return { count: 1 };
      },
    },
    distributorGiftInventory: {
      findUnique: async () => ({ id: "stock-1", distributorId: "distributor-1" }),
      updateMany: async (query) => {
        calls.push(["stock", query]);
        return { count: 1 };
      },
    },
    distributorGiftMovementLog: {
      create: async (query) => {
        calls.push(["movement", query]);
        return query;
      },
    },
  };
  const client = { $transaction: async (callback) => callback(tx) };

  const result = await reconcileNonCardGiftAssignment("order-1", client);

  assert.equal(result.reconciled, true);
  assert.deepEqual(calls.find(([type]) => type === "stock")[1].data, {
    quantityReserved: { decrement: 1 },
    quantityAvailable: { increment: 1 },
  });
  assert.equal(calls.find(([type]) => type === "order")[1].data.assignedGiftId, null);
  assert.equal(calls.find(([type]) => type === "order")[1].data.giftStatus, "NONE");
  assert.equal(calls.find(([type]) => type === "entitlement")[1].data.status, "CANCELLED");
  assert.equal(calls.find(([type]) => type === "movement")[1].data.movementType, "RESTOCKED");
});

test("legacy gift reconciliation preserves valid scanned-card assignments", async () => {
  let stockTouched = false;
  const tx = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        assignedGiftId: "gift-1",
        giftStatus: "PENDING_PACKING",
        fulfillmentStatus: "letter_ready",
      }),
    },
    giftRewardEntitlement: {
      findUnique: async () => ({
        id: "entitlement-1",
        sourceType: "CARD",
        marketingBenefitRedemptionId: "redemption-1",
        status: "ASSIGNED",
      }),
    },
    distributorGiftInventory: {
      updateMany: async () => { stockTouched = true; return { count: 1 }; },
    },
  };
  const client = { $transaction: async (callback) => callback(tx) };

  const result = await reconcileNonCardGiftAssignment("order-1", client);

  assert.deepEqual(result, { reconciled: false, reason: "valid claimed-card gift" });
  assert.equal(stockTouched, false);
});

test("legacy gift reconciliation preserves assigned loyalty gifts", async () => {
  let stockTouched = false;
  const tx = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        assignedGiftId: "gift-1",
        giftStatus: "PENDING_PACKING",
        fulfillmentStatus: "letter_ready",
      }),
    },
    giftRewardEntitlement: {
      findUnique: async () => ({
        id: "entitlement-1",
        sourceType: "LOYALTY",
        status: "ASSIGNED",
      }),
    },
    distributorGiftInventory: {
      updateMany: async () => { stockTouched = true; return { count: 1 }; },
    },
  };
  const client = { $transaction: async (callback) => callback(tx) };

  const result = await reconcileNonCardGiftAssignment("order-1", client);

  assert.deepEqual(result, { reconciled: false, reason: "valid loyalty gift" });
  assert.equal(stockTouched, false);
});

test("distributor inventory refresh releases stale unclaimed gift reservations before showing counts", async () => {
  const calls = [];
  let staleAssignmentExists = true;
  const tx = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        assignedGiftId: "gift-1",
        assignedDistributorGiftInventoryId: "stock-1",
        giftStatus: staleAssignmentExists ? "PENDING_PACKING" : "NONE",
        fulfillmentStatus: "letter_ready",
      }),
      updateMany: async (query) => {
        staleAssignmentExists = false;
        calls.push(["order", query]);
        return { count: 1 };
      },
    },
    giftRewardEntitlement: {
      findUnique: async () => ({
        id: "entitlement-1",
        sourceType: "ORDER_VALUE",
        marketingBenefitRedemptionId: null,
        status: "ASSIGNED",
      }),
      updateMany: async (query) => { calls.push(["entitlement", query]); return { count: 1 }; },
    },
    distributorGiftInventory: {
      findUnique: async () => ({ id: "stock-1", distributorId: "distributor-1" }),
      updateMany: async (query) => {
        calls.push(["stock", query]);
        return { count: 1 };
      },
    },
    distributorGiftMovementLog: { create: async () => ({}) },
  };
  const client = {
    $transaction: async (callback) => callback(tx),
    order: {
      findMany: async () => staleAssignmentExists ? [{ id: "order-1" }] : [],
    },
    distributorGiftInventory: {
      findMany: async () => [{ id: "stock-1", quantityAvailable: 4, quantityReserved: 0 }],
    },
  };

  const inventory = await getDistributorGiftInventory("distributor-1", client);

  assert.equal(inventory[0].quantityAvailable, 4);
  assert.equal(calls.find(([type]) => type === "stock")[1].data.quantityAvailable.increment, 1);
  assert.equal(calls.find(([type]) => type === "order")[1].data.assignedGiftId, null);
});

test("distributor receipt records the counted quantity and rejects counts above dispatch", async () => {
  let stockUpdate;
  let movement;
  const tx = {
    distributorGiftInventory: {
      findFirst: async () => ({ id: "stock-1", giftId: "gift-1", quantityAvailable: 5, quantitySent: 5, status: "PENDING_ACCEPTANCE" }),
      updateMany: async ({ data }) => { stockUpdate = data; return { count: 1 }; },
      findUnique: async () => ({ id: "stock-1", ...stockUpdate }),
    },
    distributorGiftMovementLog: { create: async ({ data }) => { movement = data; return data; } },
  };
  const client = { $transaction: async (callback) => callback(tx) };

  await respondToDistributorGiftAllocation({
    inventoryId: "stock-1",
    distributorId: "distributor-1",
    decision: "ACCEPTED",
    receivedQuantity: 3,
    client,
  });
  assert.equal(stockUpdate.quantityAvailable, 3);
  assert.equal(stockUpdate.receivedQuantity, 3);
  assert.equal(movement.movementType, "RECEIVED");
  assert.equal(movement.quantity, 3);

  await assert.rejects(
    respondToDistributorGiftAllocation({
      inventoryId: "stock-1",
      distributorId: "distributor-1",
      decision: "ACCEPTED",
      receivedQuantity: 6,
      client,
    }),
    /cannot exceed the number of gifts sent/
  );
});

test("unfulfilled rewards return to pending only after every checkout shipment is packed", async () => {
  let entitlementUpdate;
  const entitlement = { id: "entitlement-1", status: "RESERVED", checkoutGroupId: "checkout-1" };
  const client = {
    order: {
      findUnique: async () => ({ id: "order-1", checkoutGroupId: "checkout-1" }),
      findMany: async () => [{ fulfillmentStatus: "packed" }, { fulfillmentStatus: "delivered" }],
    },
    giftRewardEntitlement: {
      findMany: async () => [{ id: "entitlement-1", sourceType: "LOYALTY" }],
      updateMany: async ({ data, where }) => {
        entitlementUpdate = { data, where };
        Object.assign(entitlement, data);
        return { count: 1 };
      },
      findFirst: async () => entitlement.status === "PENDING" ? entitlement : null,
    },
  };

  assert.equal(await releaseUnfulfilledGiftForPackedCheckout({ orderId: "order-1", client }), true);
  assert.equal(entitlementUpdate.data.status, "PENDING");
  assert.equal(entitlementUpdate.data.checkoutGroupId, null);
  const laterCheckoutReservation = await bindGiftRewardsToCheckout({
    client,
    customerId: "customer-1",
    orderId: "later-order",
  });
  assert.equal(laterCheckoutReservation, "entitlement-1");
  assert.equal(entitlement.status, "RESERVED");
  assert.equal(entitlement.checkoutGroupId, "later-order");
});

test("order cancellation restores reserved distributor gift stock and releases the reward", async () => {
  const events = [];
  const tx = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        userId: "customer-1",
        checkoutGroupId: null,
        manufacturerId: null,
        distributorId: null,
        assignedGiftId: "gift-1",
        assignedGiftInventoryId: null,
        assignedDistributorGiftInventoryId: "stock-1",
        giftStatus: "PENDING_PACKING",
      }),
      findMany: async () => [{ id: "order-1", status: "Cancelled" }],
      update: async ({ data }) => { events.push(["order", data]); return {}; },
      updateMany: async () => ({ count: 1 }),
    },
    orderAssignment: { findUnique: async () => ({ distributorId: "distributor-1" }) },
    distributorGiftInventory: {
      updateMany: async ({ data }) => { events.push(["stock", data]); return { count: 1 }; },
    },
    distributorGiftMovementLog: { create: async ({ data }) => { events.push(["movement", data]); return {}; } },
    giftRewardEntitlement: {
      updateMany: async ({ data }) => { events.push(["entitlement", data]); return { count: 1 }; },
    },
  };

  await releaseGiftRewardOnOrderCancellation(tx, "order-1");

  assert.deepEqual(events.find(([type]) => type === "stock")[1], {
    quantityReserved: { decrement: 1 },
    quantityAvailable: { increment: 1 },
  });
  assert.equal(events.find(([type]) => type === "entitlement")[1].status, "PENDING");
});

test("an intact returned gift is restocked in distributor inventory", async () => {
  const events = [];
  let giftStatus = "DELIVERED";
  const tx = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        manufacturerId: null,
        distributorId: null,
        assignedGiftId: "gift-1",
        assignedGiftInventoryId: null,
        assignedDistributorGiftInventoryId: "stock-1",
        giftStatus,
      }),
      updateMany: async ({ data }) => { giftStatus = data.giftStatus; events.push(["order-update", data]); return { count: 1 }; },
    },
    orderAssignment: { findUnique: async () => ({ distributorId: "distributor-1" }) },
    distributorGiftInventory: {
      updateMany: async ({ where, data }) => { events.push(["stock", { where, data }]); return { count: 1 }; },
    },
    distributorGiftMovementLog: { create: async ({ data }) => { events.push(["movement", data]); return {}; } },
  };
  const client = { $transaction: async (callback) => callback(tx) };

  const result = await onOrderReturned("order-1", { giftReturned: true, expectedDistributorId: "distributor-1" }, client);

  assert.equal(result.updated, true);
  assert.equal(events.find(([type]) => type === "stock")[1].data.quantityAvailable.increment, 1);
  assert.equal(events.find(([type]) => type === "movement")[1].movementType, "RESTOCKED");
});

test("claiming a card gift creates a pending exact-value entitlement for the customer's next order", async () => {
  let entitlementData;
  const redemption = { id: "redemption-1", status: "CLAIMED", claimedAt: new Date() };
  const tx = {
    marketingCard: {
      findUnique: async () => ({
        id: "card-1",
        physicalStatus: "AVAILABLE",
        hasBenefit: true,
        exchangeLockRequestId: null,
        campaign: { isOwnStore: true, cardExpiresAt: null },
        customerLinks: [{ id: "link-1", status: "ACTIVE", activatedAt: new Date() }],
        benefit: { id: "benefit-1", benefitType: "GIFT", value: 500, status: "ACTIVE" },
      }),
    },
    marketingBenefitRedemption: {
      findUnique: async () => null,
      create: async () => redemption,
    },
    giftRewardEntitlement: {
      upsert: async ({ create }) => { entitlementData = create; return create; },
    },
    marketingCardEvent: { create: async () => ({}) },
  };
  const client = { $transaction: async (callback) => callback(tx) };

  const result = await claimCustomerReward({ customerId: "customer-1", cardId: "card-1", client });

  assert.equal(result.benefitType, "GIFT");
  assert.equal(result.status, "CLAIMED");
  assert.equal(entitlementData.customerId, "customer-1");
  assert.equal(entitlementData.sourceType, "CARD");
  assert.equal(entitlementData.rewardValue, 500);
  assert.equal(entitlementData.marketingBenefitRedemptionId, "redemption-1");
});

test("claiming an Own Store voucher makes it available for checkout without creating a gift entitlement", async () => {
  let entitlementCreated = false;
  const tx = {
    marketingCard: {
      findUnique: async () => ({
        id: "card-voucher",
        physicalStatus: "AVAILABLE",
        hasBenefit: true,
        exchangeLockRequestId: null,
        campaign: { isOwnStore: true, cardExpiresAt: null },
        customerLinks: [{ id: "link-1", status: "ACTIVE", activatedAt: new Date() }],
        benefit: { id: "benefit-voucher", benefitType: "VOUCHER", value: 500, status: "ACTIVE" },
      }),
    },
    marketingBenefitRedemption: {
      findUnique: async () => null,
      create: async () => ({ id: "redemption-voucher", status: "CLAIMED", claimedAt: new Date() }),
    },
    giftRewardEntitlement: {
      upsert: async () => { entitlementCreated = true; },
    },
    marketingCardEvent: { create: async () => ({}) },
  };
  const client = { $transaction: async (callback) => callback(tx) };

  const result = await claimCustomerReward({ customerId: "customer-1", cardId: "card-voucher", client });

  assert.equal(result.benefitType, "VOUCHER");
  assert.equal(result.status, "CLAIMED");
  assert.equal(entitlementCreated, false);
});

test("card reward claims reject zero-value vouchers and discounts above 100 percent", async () => {
  for (const benefit of [
    { benefitType: "VOUCHER", value: 0 },
    { benefitType: "DISCOUNT", value: 101 },
  ]) {
    const tx = {
      marketingCard: {
        findUnique: async () => ({
          id: "card-invalid-reward",
          physicalStatus: "AVAILABLE",
          hasBenefit: true,
          exchangeLockRequestId: null,
          campaign: { isOwnStore: true, cardExpiresAt: null },
          customerLinks: [{ id: "link-1", status: "ACTIVE", activatedAt: new Date() }],
          benefit: { id: "benefit-invalid", ...benefit, status: "ACTIVE" },
        }),
      },
    };

    await assert.rejects(
      claimCustomerReward({
        customerId: "customer-1",
        cardId: "card-invalid-reward",
        client: { $transaction: async (callback) => callback(tx) },
      }),
      /card reward has an invalid value/i
    );
  }
});

test("an assigned but unscanned card cannot create a gift entitlement", async () => {
  let redemptionCreated = false;
  let entitlementCreated = false;
  const tx = {
    marketingCard: {
      findUnique: async () => ({
        id: "card-1",
        physicalStatus: "ASSIGNED",
        hasBenefit: true,
        exchangeLockRequestId: null,
        campaign: { isOwnStore: true, cardExpiresAt: null },
        customerLinks: [],
        benefit: { id: "benefit-1", benefitType: "GIFT", value: 200, status: "ACTIVE" },
      }),
    },
    marketingBenefitRedemption: {
      findUnique: async () => null,
      create: async () => { redemptionCreated = true; },
    },
    giftRewardEntitlement: {
      upsert: async () => { entitlementCreated = true; },
    },
    marketingCardEvent: { create: async () => ({}) },
  };
  const client = { $transaction: async (callback) => callback(tx) };

  await assert.rejects(
    claimCustomerReward({ customerId: "customer-1", cardId: "card-1", client }),
    /scan and verify this card/i
  );
  assert.equal(redemptionCreated, false);
  assert.equal(entitlementCreated, false);
});

test("Admin cannot replace a gift after checklist completion or packing", async () => {
  for (const fulfillmentStatus of ["checklist_complete", "packed"]) {
    const client = {
      $transaction: async (callback) => callback({
        order: {
          findUnique: async () => ({
            id: "order-1",
            status: "Processing",
            fulfillmentStatus,
            giftStatus: "PENDING_PACKING",
            assignedGiftId: "gift-1",
            assignedGift: { id: "gift-1", priceValue: 500 },
            assignedDistributorGiftInventory: { id: "stock-1", distributorId: "distributor-1" },
            assignedDistributorGiftInventoryId: "stock-1",
            giftRewardEntitlement: { id: "entitlement-1", rewardValue: 500 },
          }),
        },
      }),
    };

    await assert.rejects(
      replaceAdminOrderGift({ orderId: "order-1", inventoryId: "replacement-stock", client }),
      /only allowed for active orders before packing/
    );
  }
});

test("Admin replacement only accepts same-distributor stock at the exact reward value", async () => {
  let stockQuery;
  const client = {
    $transaction: async (callback) => callback({
      order: {
        findUnique: async () => ({
          id: "order-1",
          status: "Processing",
          fulfillmentStatus: "quality_check",
          giftStatus: "PENDING_PACKING",
          assignedGiftId: "gift-1",
          assignedGift: { id: "gift-1", priceValue: 500 },
          assignedDistributorGiftInventory: { id: "stock-1", distributorId: "distributor-1" },
          assignedDistributorGiftInventoryId: "stock-1",
          giftRewardEntitlement: { id: "entitlement-1", rewardValue: 500 },
        }),
      },
      distributorGiftInventory: {
        findFirst: async (query) => { stockQuery = query; return null; },
      },
    }),
  };

  await assert.rejects(
    replaceAdminOrderGift({ orderId: "order-1", inventoryId: "replacement-stock", client }),
    /exact reward value/
  );
  assert.equal(stockQuery.where.distributorId, "distributor-1");
  assert.deepEqual(stockQuery.where.gift.priceValue, { equals: 500 });
});
