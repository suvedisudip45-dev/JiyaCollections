import { randomInt } from "node:crypto";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";

const parseObject = (value, fallback = {}) => {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
};

export const createGiftSkuFromName = (name) => {
  const base = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return base ? `GFT-${base}` : "GFT-GIFT";
};

export const normalizeGiftCategory = (category) => {
  const normalized = String(category || "GENERAL").trim().toUpperCase().replace(/[ -]+/g, "_");
  const allowedCategories = new Set(["GENERAL", "PARTNER_PRODUCT", "OTHER"]);
  if (!allowedCategories.has(normalized)) throw new Error("Gift category must be General, Partner Product, or Other.");
  return normalized;
};

export const calculateOrderGiftEligibility = (order = {}, orderValueRules = []) => {
  const reward = parseObject(order.rewardApplied);
  const loyaltyGiftValue = Math.max(
    0,
    Math.round(Number(reward.giftAmount || reward.loyaltyGiftAmount || 0) * 100) / 100
  );
  const matchedOrderRules = (Array.isArray(orderValueRules) ? orderValueRules : []).filter((rule) =>
    rule?.isActive !== false &&
    String(rule?.triggerType || "ORDER_VALUE").toUpperCase() === "ORDER_VALUE" &&
    Number(order.amount || 0) >= Number(rule?.minSpendThreshold || 0)
  );
  const orderValueGiftValue = matchedOrderRules.reduce(
    (maxValue, rule) => Math.max(maxValue, Math.round(Number(rule.giftTargetValue || 0) * 100) / 100),
    0
  );
  const reasons = [];
  if (loyaltyGiftValue > 0) reasons.push("LOYALTY_TIER");
  if (orderValueGiftValue > 0) reasons.push("ORDER_VALUE");

  return {
    eligible: reasons.length > 0,
    budget: Math.max(loyaltyGiftValue, orderValueGiftValue),
    requiredValue: Math.max(loyaltyGiftValue, orderValueGiftValue),
    reasons,
    loyaltyGiftValue,
    orderValueGiftValue,
    loyaltyGiftDescription: String(reward.giftDescription || reward.loyaltyGiftDescription || "").trim(),
  };
};

export const isExactGiftValue = (giftValue, rewardValue) => (
  Number.isFinite(Number(giftValue)) &&
  Number.isFinite(Number(rewardValue)) &&
  Math.round(Number(giftValue) * 100) === Math.round(Number(rewardValue) * 100)
);

export const isDistributorOrderOwner = ({ order, assignment, distributorId }) => Boolean(
  order &&
  distributorId &&
  (!order.distributorId || order.distributorId === distributorId) &&
  (!assignment?.distributorId || assignment.distributorId === distributorId) &&
  (order.distributorId === distributorId || assignment?.distributorId === distributorId)
);

const getOrderAssignment = (client, orderId) => client.orderAssignment.findUnique({
  where: { orderId },
  select: { distributorId: true },
});

const getReservedGiftEntitlement = (client, order, sourceTypes = ["CARD"]) => client.giftRewardEntitlement.findFirst({
  where: {
    customerId: order.userId,
    sourceType: { in: sourceTypes },
    status: "RESERVED",
    checkoutGroupId: order.checkoutGroupId || order.id,
  },
  select: { id: true, rewardValue: true, sourceType: true, status: true },
});

const isAssignedDistributor = async (client, order, distributorId) =>
  isDistributorOrderOwner({
    order,
    assignment: await getOrderAssignment(client, order.id),
    distributorId,
  });

const normalizeLocationKey = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const GIFT_PACKED_STATUSES = [
  "checklist_complete",
  "packed",
  "ready_for_pickup",
  "picked_up",
  "dispatched",
  "on_the_way",
  "in_transit",
  "arrived_at_destination",
  "out_for_delivery",
  "delivered",
  "return_requested",
  "returned",
  "cancelled",
];
const isGiftPackingLocked = (status) => GIFT_PACKED_STATUSES.includes(
  String(status || "").trim().toLowerCase().replace(/[ -]+/g, "_")
);
const isGiftOrderChangeLocked = (order) => (
  isGiftPackingLocked(order?.fulfillmentStatus) ||
  !["PENDING_PACKING", "RESERVED"].includes(String(order?.giftStatus || "").toUpperCase()) ||
  ["cancelled", "delivered", "returned"].includes(String(order?.status || "").trim().toLowerCase())
);

export const autoAssignGiftForCheckout = async ({ orderId, client = prisma }) => {
  const order = await client.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Order not found.");
  const checkoutKey = order.checkoutGroupId || order.id;
  const groupOrders = await client.order.findMany({
    where: order.checkoutGroupId ? { checkoutGroupId: order.checkoutGroupId } : { id: order.id },
    select: {
      id: true,
      userId: true,
      address: true,
      fulfillmentStatus: true,
      distributorId: true,
      assignedGiftId: true,
      giftStatus: true,
    },
  });
  if (groupOrders.some((member) => member.assignedGiftId)) {
    return { assigned: false, reason: "checkout already has a gift" };
  }

  const entitlement = await getReservedGiftEntitlement(client, { ...order, checkoutGroupId: checkoutKey }, ["CARD", "LOYALTY"]);

  if (!entitlement || entitlement.status !== "RESERVED" || !["CARD", "LOYALTY"].includes(entitlement.sourceType)) {
    return { assigned: false, reason: "no reserved gift reward" };
  }

  const groupOrderIds = groupOrders.map((member) => member.id);
  const assignments = await client.orderAssignment.findMany({
    where: { orderId: { in: groupOrderIds } },
    select: { orderId: true, distributorId: true, status: true },
  });
  const orderById = new Map(groupOrders.map((member) => [member.id, member]));
  const eligibleAssignments = assignments.filter((assignment) => {
    const member = orderById.get(assignment.orderId);
    return Boolean(
      assignment.distributorId &&
      member &&
      !isGiftPackingLocked(member.fulfillmentStatus) &&
      !isGiftPackingLocked(assignment.status)
    );
  });
  if (!eligibleAssignments.length) return { assigned: false, reason: "no eligible assigned distributor" };

  const distributorIds = [...new Set(eligibleAssignments.map(({ distributorId }) => distributorId))];
  const stock = await client.distributorGiftInventory.findMany({
    where: {
      distributorId: { in: distributorIds },
      status: "ACCEPTED",
      quantityAvailable: { gt: 0 },
      gift: { isActive: true, priceValue: { equals: Number(entitlement.rewardValue) } },
    },
    include: { gift: true, distributor: { select: { province: true, district: true } } },
  });
  const deliveryAddress = parseObject(order.address);
  const deliveryDistrict = normalizeLocationKey(deliveryAddress.district);
  const deliveryProvince = normalizeLocationKey(deliveryAddress.province);
  const eligibleStock = stock.filter((item) => isExactGiftValue(item.gift?.priceValue, entitlement.rewardValue));
  const rank = (item) => {
    const district = normalizeLocationKey(item.distributor?.district);
    const province = normalizeLocationKey(item.distributor?.province);
    if (deliveryDistrict && district === deliveryDistrict) return 0;
    if (deliveryProvince && province === deliveryProvince) return 1;
    return 2;
  };
  const bestRank = eligibleStock.reduce((best, item) => Math.min(best, rank(item)), Infinity);
  const bestStock = eligibleStock.filter((item) => rank(item) === bestRank);
  if (!bestStock.length) {
    return { assigned: false, reason: "no assigned distributor has an exact-value gift in stock" };
  }

  const totalAvailableUnits = bestStock.reduce((total, item) => total + Number(item.quantityAvailable || 0), 0);
  if (!Number.isSafeInteger(totalAvailableUnits) || totalAvailableUnits <= 0) {
    throw new Error("Matching gift stock has an invalid available quantity.");
  }
  const randomUnit = randomInt(totalAvailableUnits);
  let unitOffset = randomUnit;
  const selectedStock = bestStock.find((item) => {
    unitOffset -= Number(item.quantityAvailable || 0);
    return unitOffset < 0;
  });
  if (!selectedStock) throw new Error("Matching gift stock changed while selecting an item.");
  const matchingAssignments = eligibleAssignments.filter(({ distributorId }) => distributorId === selectedStock.distributorId);
  const targetAssignment = matchingAssignments[randomInt(matchingAssignments.length)];
  const targetOrder = orderById.get(targetAssignment.orderId);
  const stockClaim = await client.distributorGiftInventory.updateMany({
    where: {
      id: selectedStock.id,
      distributorId: selectedStock.distributorId,
      status: "ACCEPTED",
      quantityAvailable: { gt: 0 },
    },
    data: { quantityAvailable: { decrement: 1 }, quantityReserved: { increment: 1 } },
  });
  if (stockClaim.count !== 1) {
    throw Object.assign(new Error("Gift stock changed while it was being reserved. Retry fulfillment."), {
      code: "GIFT_STOCK_CHANGED",
      statusCode: 409,
    });
  }
  const orderClaim = await client.order.updateMany({
    where: { id: targetOrder.id, assignedGiftId: null, giftStatus: "NONE" },
    data: {
      assignedGiftId: selectedStock.giftId,
      assignedDistributorGiftInventoryId: selectedStock.id,
      giftStatus: "PENDING_PACKING",
    },
  });
  if (orderClaim.count !== 1) throw new Error("Gift checkout assignment changed while the reward was being attached.");
  const entitlementClaim = await client.giftRewardEntitlement.updateMany({
    where: { id: entitlement.id, status: "RESERVED", checkoutGroupId: checkoutKey, orderId: null },
    data: {
      status: "ASSIGNED",
      orderId: targetOrder.id,
      giftId: selectedStock.giftId,
      distributorGiftInventoryId: selectedStock.id,
      assignedAt: new Date(),
    },
  });
  if (entitlementClaim.count !== 1) throw new Error("Gift reward was already assigned to another checkout.");
  await client.distributorGiftMovementLog.create({
    data: {
      distributorId: selectedStock.distributorId,
      giftId: selectedStock.giftId,
      orderId: targetOrder.id,
      movementType: "ALLOCATED",
      quantity: 1,
      notes: "System randomly assigned an exact-value gift from accepted distributor stock.",
    },
  });
  return {
    assigned: true,
    orderId: targetOrder.id,
    distributorId: selectedStock.distributorId,
    gift: selectedStock.gift,
  };
};

export const reconcileNonCardGiftAssignment = async (orderId, client = prisma) => client.$transaction(async (tx) => {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      assignedGiftId: true,
      assignedGiftInventoryId: true,
      assignedDistributorGiftInventoryId: true,
      giftStatus: true,
      fulfillmentStatus: true,
      manufacturerId: true,
      distributorId: true,
    },
  });
  if (!order) throw new Error("Order not found.");
  if (!order.assignedGiftId || order.giftStatus !== "PENDING_PACKING") {
    return { reconciled: false, reason: "no un-packed gift assignment" };
  }
  if (isGiftPackingLocked(order.fulfillmentStatus)) {
    return { reconciled: false, reason: "order is already in packing or later" };
  }

  const entitlement = await tx.giftRewardEntitlement.findUnique({
    where: { orderId },
    select: { id: true, sourceType: true, marketingBenefitRedemptionId: true, status: true },
  });
  if (entitlement?.sourceType === "CARD" && entitlement.marketingBenefitRedemptionId) {
    return { reconciled: false, reason: "valid claimed-card gift" };
  }
  if (entitlement?.sourceType === "LOYALTY" && entitlement.status === "ASSIGNED") {
    return { reconciled: false, reason: "valid loyalty gift" };
  }

  if (order.assignedDistributorGiftInventoryId) {
    const inventory = await tx.distributorGiftInventory.findUnique({
      where: { id: order.assignedDistributorGiftInventoryId },
      select: { id: true, distributorId: true },
    });
    if (!inventory) throw new Error("Assigned distributor gift inventory was not found; gift stock was not changed.");
    const released = await tx.distributorGiftInventory.updateMany({
      where: { id: inventory.id, distributorId: inventory.distributorId, quantityReserved: { gt: 0 } },
      data: { quantityReserved: { decrement: 1 }, quantityAvailable: { increment: 1 } },
    });
    if (released.count !== 1) throw new Error("Reserved distributor gift stock could not be released; gift assignment was not changed.");
    await tx.distributorGiftMovementLog.create({
      data: {
        distributorId: inventory.distributorId,
        giftId: order.assignedGiftId,
        orderId,
        movementType: "RESTOCKED",
        quantity: 1,
        notes: "Released a legacy gift assignment without a valid card or loyalty entitlement.",
      },
    });
  } else if (order.assignedGiftInventoryId) {
    const released = await tx.manufacturerGiftInventory.updateMany({
      where: { id: order.assignedGiftInventoryId, quantityReserved: { gt: 0 } },
      data: { quantityReserved: { decrement: 1 }, quantityAvailable: { increment: 1 } },
    });
    if (released.count !== 1) throw new Error("Reserved manufacturer gift stock could not be released; gift assignment was not changed.");
    await tx.giftMovementLog.create({
      data: {
        manufacturerId: order.manufacturerId,
        giftId: order.assignedGiftId,
        movementType: "RESTOCKED",
        quantity: 1,
        notes: "Released a legacy gift assignment without a valid card or loyalty entitlement.",
      },
    });
  } else {
    throw new Error("Assigned gift has no inventory reference; gift assignment was not changed.");
  }

  const cleared = await tx.order.updateMany({
    where: { id: orderId, assignedGiftId: order.assignedGiftId, giftStatus: "PENDING_PACKING" },
    data: {
      assignedGiftId: null,
      assignedGiftInventoryId: null,
      assignedDistributorGiftInventoryId: null,
      giftStatus: "NONE",
    },
  });
  if (cleared.count !== 1) throw new Error("Gift assignment changed during reconciliation; stock release was rolled back.");

  if (entitlement) {
    await tx.giftRewardEntitlement.updateMany({
      where: { id: entitlement.id, orderId, status: "ASSIGNED" },
      data: {
        status: "CANCELLED",
        checkoutGroupId: null,
        orderId: null,
        giftId: null,
        distributorGiftInventoryId: null,
        assignedAt: null,
      },
    });
  }
  return { reconciled: true, reason: "non-card gift assignment cleared and reserved stock released" };
});

export const reconcileDistributorGiftAssignments = async (distributorId, client = prisma) => {
  if (!distributorId) throw new Error("Distributor is required to reconcile gift assignments.");
  let reconciledCount = 0;
  while (true) {
    const staleOrders = await client.order.findMany({
      where: {
        assignedDistributorGiftInventory: { is: { distributorId } },
        assignedGiftId: { not: null },
        giftStatus: "PENDING_PACKING",
        fulfillmentStatus: { notIn: GIFT_PACKED_STATUSES },
        OR: [
          { giftRewardEntitlement: { is: null } },
          { giftRewardEntitlement: { is: { sourceType: { notIn: ["CARD", "LOYALTY"] } } } },
          { giftRewardEntitlement: { is: { sourceType: "CARD", marketingBenefitRedemptionId: null } } },
          { giftRewardEntitlement: { is: { sourceType: "LOYALTY", status: { not: "ASSIGNED" } } } },
        ],
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 100,
    });
    if (!staleOrders.length) break;
    let madeProgress = false;
    for (const { id } of staleOrders) {
      const result = await reconcileNonCardGiftAssignment(id, client);
      if (result.reconciled) {
        reconciledCount += 1;
        madeProgress = true;
      }
    }
    if (!madeProgress) break;
  }
  return reconciledCount;
};

export const releaseUnfulfilledGiftForPackedCheckout = async ({ orderId, client = prisma }) => {
  const order = await client.order.findUnique({ where: { id: orderId }, select: { id: true, checkoutGroupId: true } });
  if (!order) throw new Error("Order not found.");
  const checkoutKey = order.checkoutGroupId || order.id;
  const groupOrders = await client.order.findMany({
    where: order.checkoutGroupId ? { checkoutGroupId: order.checkoutGroupId } : { id: order.id },
    select: { fulfillmentStatus: true },
  });
  if (!groupOrders.length || !groupOrders.every((member) => isGiftPackingLocked(member.fulfillmentStatus))) return false;
  const entitlements = await client.giftRewardEntitlement.findMany({
    where: { checkoutGroupId: checkoutKey, status: "RESERVED", orderId: null },
    select: { id: true, marketingBenefitRedemptionId: true },
  });
  const released = await client.giftRewardEntitlement.updateMany({
    where: { id: { in: entitlements.map(({ id }) => id) }, status: "RESERVED", orderId: null },
    data: { status: "PENDING", checkoutGroupId: null },
  });
  return released.count > 0;
};

export const listGiftCatalog = async ({ includeInactive = false } = {}) => prisma.giftCatalog.findMany({
  where: includeInactive ? undefined : { isActive: true },
  orderBy: { priceValue: "asc" },
});

export const createPendingGiftEntitlement = async ({
  client = prisma,
  customerId,
  sourceType,
  sourceKey,
  rewardValue,
  marketingBenefitRedemptionId,
}) => {
  const parsedValue = Math.round(Number(rewardValue) * 100) / 100;
  if (!customerId || !sourceKey || !["CARD", "LOYALTY", "ORDER_VALUE"].includes(sourceType)) {
    throw new Error("A customer, supported reward source, and unique source key are required.");
  }
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) throw new Error("Gift reward value must be greater than zero.");
  return client.giftRewardEntitlement.upsert({
    where: { sourceKey },
    update: {},
    create: {
      customerId,
      sourceType,
      sourceKey,
      rewardValue: parsedValue,
      marketingBenefitRedemptionId: marketingBenefitRedemptionId || null,
    },
  });
};

export const bindGiftRewardsToCheckout = async ({
  client,
  customerId,
  checkoutGroupId,
  orderId,
  preferredEntitlementId,
}) => {
  const checkoutKey = checkoutGroupId || orderId;
  const pendingWhere = {
    customerId,
    sourceType: { in: ["CARD", "LOYALTY"] },
    status: "PENDING",
    checkoutGroupId: null,
  };
  const pending = (preferredEntitlementId
    ? await client.giftRewardEntitlement.findFirst({
        where: { ...pendingWhere, id: preferredEntitlementId },
      })
    : null) || await client.giftRewardEntitlement.findFirst({
    where: pendingWhere,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!pending) return null;

  const reserved = await client.giftRewardEntitlement.updateMany({
    where: { id: pending.id, ...pendingWhere },
    data: { status: "RESERVED", checkoutGroupId: checkoutKey },
  });
  return reserved.count === 1 ? pending.id : null;
};

export const saveGiftCatalog = async (payload = {}, client = prisma, actorContext = {}) => {
  const name = String(payload.name || "").trim();
  const skuBase = createGiftSkuFromName(name);
  const category = normalizeGiftCategory(payload.category);
  let sku = skuBase;
  let suffix = 2;
  while (true) {
    const duplicate = await client.giftCatalog.findUnique({ where: { sku } });
    if (!duplicate || duplicate.id === payload.id) break;
    sku = `${skuBase}-${suffix++}`;
  }
  const safePayload = {
    name,
    sku,
    priceValue: Math.round(Number(payload.priceValue || 0) * 100) / 100,
    category,
    description: payload.description || null,
    isActive: payload.isActive !== false,
  };

  if (!safePayload.name) throw new Error("Gift name is required.");
  if (!Number.isFinite(safePayload.priceValue) || safePayload.priceValue <= 0) throw new Error("Gift value must be greater than zero.");

  if (payload.id) {
    const existing = await client.giftCatalog.findUnique({
      where: { id: payload.id },
      select: {
        id: true,
        name: true,
        sku: true,
        priceValue: true,
        category: true,
        description: true,
        isActive: true,
      },
    });
    if (!existing) throw new Error("Gift not found.");
    if (!isExactGiftValue(existing.priceValue, safePayload.priceValue)) {
      const activeAssignments = await client.order.count({
        where: {
          assignedGiftId: payload.id,
          giftStatus: { in: ["PENDING_PACKING", "RESERVED"] },
        },
      });
      if (activeAssignments) {
        throw new Error("Gift value cannot change while it is assigned to an unfulfilled order. Use the order gift replacement action instead.");
      }
    }
    const gift = await client.giftCatalog.update({
      where: { id: payload.id },
      data: safePayload,
    });
    await recordSystemAudit(actorContext, {
      action: "GIFT_CATALOG_UPDATED",
      entityType: "GiftCatalog",
      entityId: gift.id,
      beforeState: existing,
      afterState: safePayload,
    }, { client });
    return gift;
  }

  const gift = await client.giftCatalog.upsert({
    where: { sku: safePayload.sku },
    update: safePayload,
    create: safePayload,
  });
  await recordSystemAudit(actorContext, {
    action: "GIFT_CATALOG_CREATED",
    entityType: "GiftCatalog",
    entityId: gift.id,
    beforeState: {},
    afterState: safePayload,
  }, { client });
  return gift;
};

export const archiveGiftCatalog = async ({ giftId, actorContext = {}, client = prisma }) => {
  const gift = await client.giftCatalog.findUnique({
    where: { id: giftId },
    select: { id: true, name: true, sku: true, priceValue: true, category: true, isActive: true },
  });
  if (!gift) throw new Error("Gift not found.");
  if (gift.isActive) {
    await client.giftCatalog.update({ where: { id: giftId }, data: { isActive: false } });
    await recordSystemAudit(actorContext, {
      action: "GIFT_CATALOG_ARCHIVED",
      entityType: "GiftCatalog",
      entityId: giftId,
      beforeState: gift,
      afterState: { ...gift, isActive: false },
    }, { client });
  }
  return { ...gift, isActive: false };
};

export const listLoyaltyTierConfigs = async (client = prisma) => client.loyaltyTierConfig.findMany({
  where: { triggerType: "ORDER_VALUE" },
  orderBy: { minSpendThreshold: "asc" },
});

export const saveLoyaltyTierConfig = async (payload = {}, client = prisma, actorContext = {}) => {
  const data = {
    tierName: String(payload.tierName || "").trim(),
    triggerType: "ORDER_VALUE",
    minSpendThreshold: Number(payload.minSpendThreshold || 0),
    giftTargetValue: Math.round(Number(payload.giftTargetValue || 0) * 100) / 100,
    description: payload.description || null,
    isActive: payload.isActive !== false,
  };

  if (!data.tierName) throw new Error("Rule name or loyalty tier is required.");
  if (!Number.isFinite(data.minSpendThreshold) || data.minSpendThreshold <= 0) {
    throw new Error("Order-value rules require a positive minimum order value.");
  }
  if (!Number.isFinite(data.giftTargetValue) || data.giftTargetValue <= 0) throw new Error("Exact gift value must be greater than zero.");

  let existing;
  if (payload.id) {
    existing = await client.loyaltyTierConfig.findUnique({ where: { id: payload.id } });
    if (!existing || existing.triggerType !== "ORDER_VALUE") {
      throw new Error("Only order-value gift rules can be edited here.");
    }
    const config = await client.loyaltyTierConfig.update({
      where: { id: payload.id },
      data,
    });
    await recordSystemAudit(actorContext, {
      action: "ORDER_VALUE_GIFT_RULE_UPDATED",
      entityType: "LoyaltyTierConfig",
      entityId: config.id,
      beforeState: existing,
      afterState: data,
    }, { client });
    return config;
  }

  existing = await client.loyaltyTierConfig.findUnique({ where: { tierName: data.tierName } });
  if (existing && existing.triggerType !== "ORDER_VALUE") {
    throw new Error("This name is already used by a loyalty tier.");
  }
  const config = existing
    ? await client.loyaltyTierConfig.update({ where: { id: existing.id }, data })
    : await client.loyaltyTierConfig.create({ data });
  await recordSystemAudit(actorContext, {
    action: existing ? "ORDER_VALUE_GIFT_RULE_UPDATED" : "ORDER_VALUE_GIFT_RULE_CREATED",
    entityType: "LoyaltyTierConfig",
    entityId: config.id,
    beforeState: existing || {},
    afterState: data,
  }, { client });
  return config;
};

export const archiveOrderValueGiftRule = async ({ ruleId, actorContext = {}, client = prisma }) => {
  const rule = await client.loyaltyTierConfig.findUnique({ where: { id: ruleId } });
  if (!rule || rule.triggerType !== "ORDER_VALUE") {
    throw new Error("Order-value gift rule not found.");
  }
  if (!rule.isActive) return rule;
  const archived = await client.loyaltyTierConfig.update({
    where: { id: ruleId },
    data: { isActive: false },
  });
  await recordSystemAudit(actorContext, {
    action: "ORDER_VALUE_GIFT_RULE_ARCHIVED",
    entityType: "LoyaltyTierConfig",
    entityId: ruleId,
    beforeState: rule,
    afterState: archived,
  }, { client });
  return archived;
};

export const assignGiftToManufacturer = async ({ manufacturerId, giftId, quantity = 1, notes = "" }) => {
  if (!manufacturerId || !giftId) throw new Error("Manufacturer and gift are required.");
  const normalizedQuantity = Number(quantity);
  if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1) {
    throw new Error("Gift quantity must be a positive whole number.");
  }

  const gift = await prisma.giftCatalog.findUnique({ where: { id: giftId } });
  if (!gift || !gift.isActive) throw new Error("An active catalog gift is required.");

  const inventory = await prisma.$transaction(async (tx) => {
    const createdInventory = await tx.manufacturerGiftInventory.create({
      data: {
      manufacturerId,
      giftId,
      quantityAvailable: normalizedQuantity,
      quantityReserved: 0,
      status: "PENDING_ACCEPTANCE",
      notes: notes || "Assigned by admin.",
      },
    });
    await tx.giftMovementLog.create({
      data: {
        manufacturerId,
        giftId,
        movementType: "ALLOCATED",
        quantity: normalizedQuantity,
        notes: notes || "Admin distributed gift inventory to manufacturer.",
      },
    });
    return createdInventory;
  });
  return inventory;
};

export const getManufacturerGiftInventory = async (manufacturerId) => prisma.manufacturerGiftInventory.findMany({
  where: { manufacturerId },
  include: { gift: true },
  orderBy: { createdAt: "desc" },
});

export const assignGiftToDistributor = async ({
  distributorId,
  giftId,
  quantity = 1,
  notes = "",
  actorContext = {},
  client = prisma,
}) => {
  if (!distributorId || !giftId) throw new Error("Distributor and gift are required.");
  const normalizedQuantity = Number(quantity);
  if (!Number.isSafeInteger(normalizedQuantity) || normalizedQuantity < 1) {
    throw new Error("Gift quantity must be a positive whole number.");
  }
  const [gift, distributor] = await Promise.all([
    client.giftCatalog.findUnique({ where: { id: giftId } }),
    client.distributor.findFirst({ where: { id: distributorId, status: "ACTIVE", isActive: true }, select: { id: true } }),
  ]);
  if (!gift || !gift.isActive) throw new Error("An active catalog gift is required.");
  if (!distributor) throw new Error("An active distributor profile is required.");

  return client.$transaction(async (tx) => {
    const inventory = await tx.distributorGiftInventory.create({
      data: {
        distributorId,
        giftId,
        quantitySent: normalizedQuantity,
        quantityAvailable: normalizedQuantity,
        status: "PENDING_ACCEPTANCE",
        notes: notes || "Assigned by admin.",
      },
    });
    await tx.distributorGiftMovementLog.create({
      data: {
        distributorId,
        giftId,
        movementType: "ALLOCATED",
        quantity: normalizedQuantity,
        notes: notes || "Admin distributed gift inventory to distributor.",
      },
    });
    await recordSystemAudit(actorContext, {
      action: "DISTRIBUTOR_GIFT_STOCK_DISTRIBUTED",
      entityType: "DistributorGiftInventory",
      entityId: inventory.id,
      beforeState: {},
      afterState: {
        distributorId,
        giftId,
        quantitySent: normalizedQuantity,
        status: inventory.status,
        notes: inventory.notes,
      },
    }, { client: tx });
    return inventory;
  });
};

export const cancelPendingAdminDistributorGiftAllocation = async ({
  inventoryId,
  reason,
  actorContext = {},
  client = prisma,
}) => {
  const notes = String(reason || "").trim();
  if (!inventoryId) throw new Error("Gift stock inventory is required.");
  if (notes.length < 3 || notes.length > 500) {
    throw new Error("Cancellation reason must be between 3 and 500 characters.");
  }

  return client.$transaction(async (tx) => {
    const inventory = await tx.distributorGiftInventory.findUnique({
      where: { id: inventoryId },
      select: {
        id: true,
        distributorId: true,
        giftId: true,
        status: true,
        quantitySent: true,
        quantityAvailable: true,
        quantityReserved: true,
        receivedQuantity: true,
        notes: true,
      },
    });
    if (!inventory || inventory.status !== "PENDING_ACCEPTANCE") {
      throw new Error("Only pending distributor gift allocations can be cancelled.");
    }
    if (Number(inventory.quantityReserved) !== 0) {
      throw new Error("An allocation with reserved gifts cannot be cancelled.");
    }
    const updated = await tx.distributorGiftInventory.updateMany({
      where: {
        id: inventoryId,
        status: "PENDING_ACCEPTANCE",
        quantityReserved: 0,
      },
      data: { status: "CANCELLED", quantityAvailable: 0 },
    });
    if (updated.count !== 1) {
      throw Object.assign(new Error("This allocation was already accepted or changed. Refresh stock and try again."), {
        code: "GIFT_ALLOCATION_CHANGED",
        statusCode: 409,
      });
    }

    const updatedInventory = await tx.distributorGiftInventory.findUnique({ where: { id: inventoryId } });
    await tx.distributorGiftMovementLog.create({
      data: {
        distributorId: inventory.distributorId,
        giftId: inventory.giftId,
        movementType: "CANCELLED",
        quantity: inventory.quantitySent,
        notes: `Admin cancelled pending allocation: ${notes}`,
      },
    });
    await recordSystemAudit(actorContext, {
      action: "DISTRIBUTOR_GIFT_ALLOCATION_CANCELLED",
      entityType: "DistributorGiftInventory",
      entityId: inventoryId,
      beforeState: inventory,
      afterState: {
        ...inventory,
        status: "CANCELLED",
        quantityAvailable: 0,
        cancellationReason: notes,
      },
    }, { client: tx });
    return updatedInventory;
  });
};

export const getDistributorGiftInventory = async (distributorId, client = prisma) => {
  await reconcileDistributorGiftAssignments(distributorId, client);
  return client.distributorGiftInventory.findMany({
    where: { distributorId },
    include: { gift: true },
    orderBy: { createdAt: "desc" },
  });
};

export const listAdminDistributorGiftStock = async ({ page = 1, pageSize = 50 } = {}, client = prisma) => {
  const normalizedPage = Number(page);
  const normalizedPageSize = Number(pageSize);
  if (!Number.isSafeInteger(normalizedPage) || normalizedPage < 1) {
    throw new Error("Gift stock page must be a positive whole number.");
  }
  if (!Number.isSafeInteger(normalizedPageSize) || normalizedPageSize < 1 || normalizedPageSize > 100) {
    throw new Error("Gift stock page size must be between 1 and 100.");
  }
  const skip = (normalizedPage - 1) * normalizedPageSize;
  if (!Number.isSafeInteger(skip)) throw new Error("Gift stock page is outside the supported range.");
  const where = {};
  const [inventory, total] = await Promise.all([
    client.distributorGiftInventory.findMany({
      where,
      select: {
        id: true,
        distributorId: true,
        giftId: true,
        quantitySent: true,
        quantityAvailable: true,
        quantityReserved: true,
        receivedQuantity: true,
        status: true,
        notes: true,
        createdAt: true,
        gift: { select: { id: true, name: true, sku: true, priceValue: true, category: true } },
        distributor: { select: { id: true, name: true, district: true, province: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: normalizedPageSize,
    }),
    client.distributorGiftInventory.count({ where }),
  ]);
  return { inventory, total, page: normalizedPage, pageSize: normalizedPageSize };
};

export const adjustAdminDistributorGiftStock = async ({
  inventoryId,
  adjustment,
  reason,
  actorContext = {},
  client = prisma,
}) => {
  const delta = Number(adjustment);
  const notes = String(reason || "").trim();
  if (!inventoryId) throw new Error("Gift stock inventory is required.");
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw new Error("Stock adjustment must be a non-zero whole number.");
  }
  if (!notes) throw new Error("A reason is required for gift stock adjustments.");
  if (notes.length < 3) throw new Error("Gift stock adjustment reasons must be at least 3 characters.");
  if (notes.length > 500) throw new Error("Gift stock adjustment reasons cannot exceed 500 characters.");

  return client.$transaction(async (tx) => {
    const inventory = await tx.distributorGiftInventory.findUnique({
      where: { id: inventoryId },
      select: {
        id: true,
        distributorId: true,
        giftId: true,
        status: true,
        quantityAvailable: true,
        quantityReserved: true,
      },
    });
    if (!inventory || inventory.status !== "ACCEPTED") {
      throw new Error("Only acknowledged distributor gift stock can be adjusted.");
    }
    const quantityAvailable = Number(inventory.quantityAvailable);
    const quantityReserved = Number(inventory.quantityReserved);
    if (!Number.isSafeInteger(quantityAvailable) || !Number.isSafeInteger(quantityReserved)) {
      throw new Error("Gift stock contains invalid quantity data.");
    }
    const adjustedQuantity = quantityAvailable + delta;
    if (adjustedQuantity < 0) {
      throw new Error("The adjustment cannot reduce available stock below zero or affect reserved gifts.");
    }
    if (!Number.isSafeInteger(adjustedQuantity) || adjustedQuantity > 2147483647) {
      throw new Error("Adjusted gift stock exceeds the supported quantity range.");
    }

    const updated = await tx.distributorGiftInventory.updateMany({
      where: {
        id: inventoryId,
        status: "ACCEPTED",
        quantityAvailable,
        quantityReserved,
      },
      data: { quantityAvailable: { increment: delta } },
    });
    if (updated.count !== 1) {
      throw Object.assign(new Error("Gift stock changed while adjusting. Refresh and try again."), {
        code: "GIFT_STOCK_CHANGED",
        statusCode: 409,
      });
    }

    await tx.distributorGiftMovementLog.create({
      data: {
        distributorId: inventory.distributorId,
        giftId: inventory.giftId,
        movementType: "ADJUSTED",
        quantity: delta,
        notes,
      },
    });
    const updatedInventory = await tx.distributorGiftInventory.findUnique({
      where: { id: inventoryId },
    });
    await recordSystemAudit(actorContext, {
      action: "DISTRIBUTOR_GIFT_STOCK_ADJUSTED",
      entityType: "DistributorGiftInventory",
      entityId: inventoryId,
      beforeState: { quantityAvailable, quantityReserved },
      afterState: {
        quantityAvailable: adjustedQuantity,
        quantityReserved,
        adjustment: delta,
        reason: notes,
      },
    }, { client: tx });
    return updatedInventory;
  });
};

export const listAdminGiftAssignments = async () => {
  const orders = await prisma.order.findMany({
    where: {
      assignedGiftId: { not: null },
      giftStatus: { in: ["PENDING_PACKING", "RESERVED"] },
      fulfillmentStatus: { notIn: GIFT_PACKED_STATUSES },
      status: { notIn: ["Cancelled", "cancelled", "delivered", "returned"] },
    },
    select: {
      id: true,
      status: true,
      fulfillmentStatus: true,
      giftStatus: true,
      assignedGiftId: true,
      assignedGift: { select: { id: true, name: true, priceValue: true } },
      assignedDistributorGiftInventoryId: true,
      assignedDistributorGiftInventory: {
        select: {
          id: true,
          distributorId: true,
          distributor: { select: { id: true, name: true, district: true, province: true } },
        },
      },
      giftRewardEntitlement: { select: { id: true, rewardValue: true } },
    },
    orderBy: { date: "desc" },
    take: 100,
  });
  return orders.filter((order) => order.assignedDistributorGiftInventory);
};

export const getAdminOrderGiftOptions = async ({ orderId, client = prisma }) => {
  const order = await client.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      fulfillmentStatus: true,
      giftStatus: true,
      assignedGiftId: true,
      assignedGift: { select: { id: true, name: true, priceValue: true } },
      assignedDistributorGiftInventoryId: true,
      assignedDistributorGiftInventory: { select: { id: true, distributorId: true } },
      giftRewardEntitlement: { select: { id: true, rewardValue: true } },
    },
  });
  if (!order?.assignedGiftId || !order.assignedDistributorGiftInventory) {
    throw new Error("This order does not have a distributor gift that can be changed.");
  }
  if (isGiftOrderChangeLocked(order)) {
    throw new Error("Gift changes are only allowed for active orders before packing.");
  }
  const requiredValue = Number(order.giftRewardEntitlement?.rewardValue ?? order.assignedGift.priceValue);
  const options = await client.distributorGiftInventory.findMany({
    where: {
      id: { not: order.assignedDistributorGiftInventoryId },
      distributorId: order.assignedDistributorGiftInventory.distributorId,
      status: "ACCEPTED",
      quantityAvailable: { gt: 0 },
      gift: { isActive: true, priceValue: { equals: requiredValue } },
    },
    select: {
      id: true,
      giftId: true,
      quantityAvailable: true,
      gift: { select: { id: true, name: true, sku: true, priceValue: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return {
    requiredValue,
    assignedGift: {
      id: order.assignedGift.id,
      name: order.assignedGift.name,
      priceValue: Number(order.assignedGift.priceValue),
      inventoryId: order.assignedDistributorGiftInventoryId,
    },
    options: options.filter((item) => isExactGiftValue(item.gift.priceValue, requiredValue)).map((item) => ({
      inventoryId: item.id,
      giftId: item.giftId,
      name: item.gift.name,
      sku: item.gift.sku,
      priceValue: Number(item.gift.priceValue),
      quantityAvailable: item.quantityAvailable,
    })),
  };
};

export const replaceAdminOrderGift = async ({ orderId, inventoryId, actorContext = {}, client = prisma }) => client.$transaction(async (tx) => {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      fulfillmentStatus: true,
      giftStatus: true,
      assignedGiftId: true,
      assignedGift: { select: { id: true, priceValue: true } },
      assignedDistributorGiftInventoryId: true,
      assignedDistributorGiftInventory: { select: { id: true, distributorId: true } },
      giftRewardEntitlement: { select: { id: true, rewardValue: true } },
    },
  });
  if (!order?.assignedGiftId || !order.assignedDistributorGiftInventory) {
    throw new Error("This order does not have a distributor gift that can be changed.");
  }
  if (isGiftOrderChangeLocked(order)) {
    throw new Error("Gift changes are only allowed for active orders before packing.");
  }
  const requiredValue = Number(order.giftRewardEntitlement?.rewardValue ?? order.assignedGift.priceValue);
  const selectedStock = await tx.distributorGiftInventory.findFirst({
    where: {
      id: inventoryId,
      distributorId: order.assignedDistributorGiftInventory.distributorId,
      status: "ACCEPTED",
      quantityAvailable: { gt: 0 },
      gift: { isActive: true, priceValue: { equals: requiredValue } },
    },
    select: {
      id: true,
      distributorId: true,
      giftId: true,
      gift: { select: { id: true, priceValue: true } },
    },
  });
  if (!selectedStock || !isExactGiftValue(selectedStock.gift.priceValue, requiredValue)) {
    throw new Error("Choose an available gift with the exact reward value from this order's distributor.");
  }
  if (selectedStock.id === order.assignedDistributorGiftInventoryId) {
    return tx.order.findUnique({ where: { id: orderId }, include: { assignedGift: true } });
  }
  const reserved = await tx.distributorGiftInventory.updateMany({
    where: { id: selectedStock.id, status: "ACCEPTED", quantityAvailable: { gt: 0 } },
    data: { quantityAvailable: { decrement: 1 }, quantityReserved: { increment: 1 } },
  });
  if (reserved.count !== 1) throw new Error("Selected gift stock changed. Refresh and try again.");
  const released = await tx.distributorGiftInventory.updateMany({
    where: {
      id: order.assignedDistributorGiftInventoryId,
      distributorId: order.assignedDistributorGiftInventory.distributorId,
      quantityReserved: { gt: 0 },
    },
    data: { quantityReserved: { decrement: 1 }, quantityAvailable: { increment: 1 } },
  });
  if (released.count !== 1) throw new Error("The currently reserved gift stock could not be released.");

  const orderUpdated = await tx.order.updateMany({
    where: {
      id: orderId,
      assignedGiftId: order.assignedGiftId,
      assignedDistributorGiftInventoryId: order.assignedDistributorGiftInventoryId,
      giftStatus: { in: ["PENDING_PACKING", "RESERVED"] },
      fulfillmentStatus: { notIn: GIFT_PACKED_STATUSES },
    },
    data: {
      assignedGiftId: selectedStock.giftId,
      assignedDistributorGiftInventoryId: selectedStock.id,
    },
  });
  if (orderUpdated.count !== 1) {
    throw new Error("The order started packing or its gift changed. Refresh and try again.");
  }
  if (order.giftRewardEntitlement) {
    await tx.giftRewardEntitlement.update({
      where: { id: order.giftRewardEntitlement.id },
      data: { giftId: selectedStock.giftId, distributorGiftInventoryId: selectedStock.id },
    });
  }
  await tx.distributorGiftMovementLog.createMany({
    data: [
      {
        distributorId: order.assignedDistributorGiftInventory.distributorId,
        giftId: order.assignedGiftId,
        orderId,
        movementType: "RESTOCKED",
        quantity: 1,
        notes: "Admin replaced the order gift before packing; prior reservation returned to available stock.",
      },
      {
        distributorId: selectedStock.distributorId,
        giftId: selectedStock.giftId,
        orderId,
        movementType: "ALLOCATED",
        quantity: 1,
        notes: "Admin selected a replacement gift of the exact reward value before packing.",
      },
    ],
  });
  const updatedOrder = await tx.order.findUnique({ where: { id: orderId }, include: { assignedGift: true } });
  await recordSystemAudit(actorContext, {
    action: "ORDER_GIFT_REPLACED_BY_ADMIN",
    entityType: "Order",
    entityId: orderId,
    beforeState: { giftId: order.assignedGiftId, inventoryId: order.assignedDistributorGiftInventoryId },
    afterState: { giftId: selectedStock.giftId, inventoryId: selectedStock.id, exactValue: requiredValue },
  }, { client: tx });
  return updatedOrder;
});

export const respondToDistributorGiftAllocation = async ({ inventoryId, distributorId, decision, receivedQuantity, notes, client = prisma }) => {
  const normalizedDecision = String(decision || "").toUpperCase();
  if (!["ACCEPTED", "REJECTED"].includes(normalizedDecision)) {
    throw new Error("Decision must be ACCEPTED or REJECTED.");
  }
  const parsedReceivedQuantity = Number(receivedQuantity);
  if (normalizedDecision === "ACCEPTED" && (!Number.isSafeInteger(parsedReceivedQuantity) || parsedReceivedQuantity < 0)) {
    throw new Error("Enter the whole-number quantity received before accepting gift stock.");
  }
  return client.$transaction(async (tx) => {
    const inventory = await tx.distributorGiftInventory.findFirst({
      where: { id: inventoryId, distributorId },
      include: { gift: true },
    });
    if (!inventory) throw new Error("Gift allocation not found for this distributor.");
    if (inventory.status !== "PENDING_ACCEPTANCE") {
      throw new Error("Only pending gift allocations can be accepted or rejected.");
    }
    if (normalizedDecision === "ACCEPTED" && parsedReceivedQuantity > inventory.quantityAvailable) {
      throw new Error("Received quantity cannot exceed the number of gifts sent.");
    }
    const updatedCount = await tx.distributorGiftInventory.updateMany({
      where: {
        id: inventoryId,
        distributorId,
        status: "PENDING_ACCEPTANCE",
        quantitySent: inventory.quantitySent,
      },
      data: {
        status: normalizedDecision,
        quantityAvailable: normalizedDecision === "ACCEPTED" ? parsedReceivedQuantity : 0,
        receivedQuantity: normalizedDecision === "ACCEPTED" ? parsedReceivedQuantity : null,
        notes: notes || `${normalizedDecision} by distributor.`,
      },
    });
    if (updatedCount.count !== 1) throw new Error("This gift allocation was already processed. Refresh your stock list.");
    const updated = await tx.distributorGiftInventory.findUnique({ where: { id: inventoryId } });
    await tx.distributorGiftMovementLog.create({
      data: {
        distributorId,
        giftId: inventory.giftId,
        movementType: normalizedDecision === "ACCEPTED" ? "RECEIVED" : "REJECTED",
        quantity: normalizedDecision === "ACCEPTED" ? parsedReceivedQuantity : inventory.quantityAvailable,
        notes: notes || (
          normalizedDecision === "ACCEPTED"
            ? `Distributor acknowledged receipt of ${parsedReceivedQuantity} of ${inventory.quantityAvailable} gift(s).`
            : "Distributor rejected the gift allocation."
        ),
      },
    });
    return updated;
  });
};

export const respondToGiftAllocation = async ({ inventoryId, manufacturerId, decision, notes }) => {
  const normalizedDecision = String(decision || "").toUpperCase();
  if (!["ACCEPTED", "REJECTED"].includes(normalizedDecision)) {
    throw new Error("Decision must be ACCEPTED or REJECTED.");
  }

  const inventory = await prisma.manufacturerGiftInventory.findFirst({
    where: { id: inventoryId, manufacturerId },
    include: { gift: true },
  });

  if (!inventory) throw new Error("Gift allocation not found for this manufacturer.");

  const updatedInventory = await prisma.manufacturerGiftInventory.update({
    where: { id: inventoryId },
    data: {
      status: normalizedDecision,
      notes: notes || `${normalizedDecision} by manufacturer.`,
    },
  });

  await prisma.giftMovementLog.create({
    data: {
      manufacturerId,
      giftId: inventory.giftId,
      movementType: normalizedDecision === "ACCEPTED" ? "ALLOCATED" : "REJECTED",
      quantity: inventory.quantityAvailable,
      notes: notes || `Gift allocation ${normalizedDecision.toLowerCase()} by manufacturer.`,
    },
  });

  return updatedInventory;
};

export const getManufacturerGiftOptions = async ({ orderId, manufacturerId, client = prisma }) => {
  const order = await client.order.findUnique({ where: { id: orderId }, include: { assignedGift: true } });
  if (!order) throw new Error("Order not found.");
  if (order.manufacturerId !== manufacturerId) throw new Error("Order does not belong to this manufacturer.");

  const entitlement = await getReservedGiftEntitlement(client, order);
  const rewardValue = Number(entitlement?.rewardValue || 0);
  const eligibility = {
    eligible: Boolean(entitlement),
    budget: rewardValue,
    requiredValue: rewardValue,
    reasons: entitlement ? ["CARD"] : [],
  };
  const checkoutGiftOrder = order.assignedGiftId
    ? order
    : order.checkoutGroupId
      ? await client.order.findFirst({
          where: { checkoutGroupId: order.checkoutGroupId, assignedGiftId: { not: null } },
          include: { assignedGift: true },
        })
      : null;
  const assignedGift = checkoutGiftOrder?.assignedGift ? {
    id: checkoutGiftOrder.assignedGift.id,
    name: checkoutGiftOrder.assignedGift.name,
    sku: checkoutGiftOrder.assignedGift.sku,
    priceValue: Number(checkoutGiftOrder.assignedGift.priceValue || 0),
    status: order.giftStatus,
  } : null;
  const groupGiftAssigned = Boolean(assignedGift && checkoutGiftOrder?.id !== order.id);

  if (!eligibility.eligible || assignedGift) {
    return { eligible: Boolean(assignedGift), alreadyAssigned: Boolean(assignedGift), groupGiftAssigned, eligibility, assignedGift, options: [] };
  }

  const inventory = await client.manufacturerGiftInventory.findMany({
    where: {
      manufacturerId,
      status: "ACCEPTED",
      quantityAvailable: { gt: 0 },
      gift: { isActive: true, priceValue: { equals: eligibility.requiredValue, gt: 0 } },
    },
    include: { gift: true },
    orderBy: [{ gift: { priceValue: "asc" } }, { createdAt: "asc" }],
  });

  return {
    eligible: true,
    alreadyAssigned: false,
    groupGiftAssigned: false,
    eligibility,
    assignedGift: null,
    options: inventory.map((stock) => ({
      inventoryId: stock.id,
      giftId: stock.giftId,
      name: stock.gift.name,
      sku: stock.gift.sku,
      category: stock.gift.category,
      priceValue: Number(stock.gift.priceValue),
      quantityAvailable: stock.quantityAvailable,
    })),
  };
};

  export const getEligibleManufacturerGiftOptions = async ({ orderId, manufacturerId }) => {
    const result = await getManufacturerGiftOptions({ orderId, manufacturerId });
    if (result.alreadyAssigned || !result.eligible || result.options.length > 0) return result;
    return { ...result, unavailable: true, message: "Gift reward is active, but this hub has no accepted gift stock within the allowed value." };
  };

  export const getDistributorGiftOptions = async ({ orderId, distributorId, client = prisma }) => {
    const order = await client.order.findUnique({ where: { id: orderId }, include: { assignedGift: true } });
    if (!order) throw new Error("Order not found.");
    if (!await isAssignedDistributor(client, order, distributorId)) {
      throw new Error("Order does not belong to this distributor.");
    }

    const entitlement = await getReservedGiftEntitlement(client, order, ["CARD", "LOYALTY"]);
    const rewardValue = Number(entitlement?.rewardValue || 0);
    const eligibility = {
      eligible: Boolean(entitlement),
      budget: rewardValue,
      requiredValue: rewardValue,
      reasons: entitlement ? [entitlement.sourceType] : [],
    };
    const checkoutGiftOrder = order.assignedGiftId
      ? order
      : order.checkoutGroupId
        ? await client.order.findFirst({
            where: { checkoutGroupId: order.checkoutGroupId, assignedGiftId: { not: null } },
            include: { assignedGift: true },
          })
        : null;
    const assignedGift = checkoutGiftOrder?.assignedGift ? {
      id: checkoutGiftOrder.assignedGift.id,
      name: checkoutGiftOrder.assignedGift.name,
      sku: checkoutGiftOrder.assignedGift.sku,
      priceValue: Number(checkoutGiftOrder.assignedGift.priceValue || 0),
      status: order.giftStatus,
    } : null;
    const groupGiftAssigned = Boolean(assignedGift && checkoutGiftOrder?.id !== order.id);

    if (!eligibility.eligible || assignedGift) {
      return { eligible: Boolean(assignedGift), alreadyAssigned: Boolean(assignedGift), groupGiftAssigned, eligibility, assignedGift, options: [] };
    }

    const inventory = await client.distributorGiftInventory.findMany({
      where: {
        distributorId,
        status: "ACCEPTED",
        quantityAvailable: { gt: 0 },
        gift: { isActive: true, priceValue: { equals: eligibility.requiredValue, gt: 0 } },
      },
      include: { gift: true },
      orderBy: [{ gift: { priceValue: "asc" } }, { createdAt: "asc" }],
    });

    return {
      eligible: true,
      alreadyAssigned: false,
      groupGiftAssigned: false,
      eligibility,
      assignedGift: null,
      options: inventory.map((stock) => ({
        inventoryId: stock.id,
        giftId: stock.giftId,
        name: stock.gift.name,
        sku: stock.gift.sku,
        category: stock.gift.category,
        priceValue: Number(stock.gift.priceValue),
        quantityAvailable: stock.quantityAvailable,
      })),
    };
  };

  export const assignGiftToDistributorOrder = async ({ orderId, distributorId, inventoryId, client = prisma }) => {
    const options = await getDistributorGiftOptions({ orderId, distributorId, client });
    if (!options.eligible) throw new Error("This order does not have an active gift promotion.");
    if (options.alreadyAssigned) throw new Error("A gift is already assigned to this order.");
    const selected = options.options.find((option) => option.inventoryId === inventoryId);
    if (!selected) throw new Error("Select an eligible gift from your accepted, available distributor stock.");

    const stockClaim = await client.distributorGiftInventory.updateMany({
      where: { id: selected.inventoryId, distributorId, status: "ACCEPTED", quantityAvailable: { gt: 0 } },
      data: { quantityAvailable: { decrement: 1 }, quantityReserved: { increment: 1 } },
    });
    if (stockClaim.count !== 1) throw new Error("This gift just became unavailable. Refresh the available gifts and choose again.");

    const orderClaim = await client.order.updateMany({
      where: { id: orderId, assignedGiftId: null, giftStatus: "NONE" },
      data: {
        assignedGiftId: selected.giftId,
        assignedDistributorGiftInventoryId: selected.inventoryId,
        giftStatus: "PENDING_PACKING",
      },
    });
    if (orderClaim.count !== 1) throw new Error("Order gift state changed before the gift could be assigned.");

    await client.distributorGiftMovementLog.create({
      data: {
        distributorId,
        giftId: selected.giftId,
        orderId,
        movementType: "ALLOCATED",
        quantity: 1,
        notes: "Distributor allocated an accepted in-stock gift to this eligible order.",
      },
    });
    return client.order.findUnique({ where: { id: orderId }, include: { assignedGift: true } });
  };

  export const assignGiftToOrder = async ({ orderId, manufacturerId, inventoryId, client = prisma }) => {
  const options = await getManufacturerGiftOptions({ orderId, manufacturerId, client });
  if (!options.eligible) throw new Error("This order does not have an active gift promotion.");
  if (options.alreadyAssigned) throw new Error("A gift is already assigned to this order.");
  const selected = options.options.find((option) => option.inventoryId === inventoryId);
  if (!selected) throw new Error("Select an eligible gift from your accepted, available hub stock.");

  const stockClaim = await client.manufacturerGiftInventory.updateMany({
    where: { id: selected.inventoryId, manufacturerId, status: "ACCEPTED", quantityAvailable: { gt: 0 } },
    data: { quantityAvailable: { decrement: 1 }, quantityReserved: { increment: 1 } },
  });
  if (stockClaim.count !== 1) throw new Error("This gift just became unavailable. Refresh the available gifts and choose again.");

  const orderClaim = await client.order.updateMany({
    where: { id: orderId, manufacturerId, assignedGiftId: null, giftStatus: "NONE" },
    data: {
      assignedGiftId: selected.giftId,
      assignedGiftInventoryId: selected.inventoryId,
      giftStatus: "PENDING_PACKING",
    },
  });
  if (orderClaim.count !== 1) throw new Error("Order gift state changed before the gift could be assigned.");

  await client.giftMovementLog.create({
    data: {
      manufacturerId,
      giftId: selected.giftId,
      orderId,
      movementType: "ALLOCATED",
      quantity: 1,
      notes: "Manufacturer selected an accepted in-stock gift for this eligible order.",
    },
  });

  return client.order.findUnique({ where: { id: orderId }, include: { assignedGift: true } });
};

export const onOrderPacked = async (orderId, expectedManufacturerId, expectedDistributorId) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, manufacturerId: true, distributorId: true, assignedGiftId: true, assignedGiftInventoryId: true, assignedDistributorGiftInventoryId: true, giftStatus: true },
  });

  if (!order?.assignedGiftId) return { order, updated: false, reason: "no gift assigned" };
  if (expectedManufacturerId && order.manufacturerId !== expectedManufacturerId) throw new Error("Order does not belong to this manufacturer.");
  if (expectedDistributorId && !await isAssignedDistributor(prisma, order, expectedDistributorId)) {
    throw new Error("Order does not belong to this distributor.");
  }
  if (order.giftStatus === "RESERVED") return { order, updated: false, reason: "gift already reserved" };
  if (order.giftStatus !== "PENDING_PACKING") throw new Error("Gift is not in a packable state.");

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: orderId, giftStatus: "PENDING_PACKING" },
      data: { giftStatus: "RESERVED" },
    });
    if (claimed.count !== 1) {
      return { order: await tx.order.findUnique({ where: { id: orderId }, include: { assignedGift: true } }), updated: false, reason: "gift packing state already changed" };
    }

    const giftDistributorId = order.distributorId || expectedDistributorId;
    if (giftDistributorId && order.assignedDistributorGiftInventoryId) {
      await tx.distributorGiftMovementLog.create({
        data: {
          distributorId: giftDistributorId,
          giftId: order.assignedGiftId,
          orderId,
          movementType: "RESERVED",
          quantity: 1,
          notes: "Packing confirmed for the distributor gift stock reserved at allocation.",
        },
      });
    } else {
      await tx.giftMovementLog.create({
        data: {
          manufacturerId: order.manufacturerId,
          giftId: order.assignedGiftId,
          orderId,
          movementType: "RESERVED",
          quantity: 1,
          notes: "Packing confirmed for the gift stock reserved at allocation.",
        },
      });
    }

    return { order: await tx.order.findUnique({ where: { id: orderId }, include: { assignedGift: true } }), updated: true };
  }, { isolationLevel: "Serializable" });
};

export const applyGiftDeliveryTransition = async (client, orderId, expectedManufacturerId) => {
  const order = await client.order.findUnique({
    where: { id: orderId },
    select: { id: true, manufacturerId: true, distributorId: true, assignedGiftId: true, assignedGiftInventoryId: true, assignedDistributorGiftInventoryId: true, giftStatus: true },
  });

  if (!order?.assignedGiftId) return { order, updated: false, reason: "no gift assigned" };
  if (expectedManufacturerId && order.manufacturerId !== expectedManufacturerId) throw new Error("Order does not belong to this manufacturer.");
  if (order.giftStatus === "DELIVERED") return { order, updated: false, reason: "gift already delivered" };
  if (order.giftStatus !== "RESERVED") return { order, updated: false, reason: "gift was not reserved for packing" };

  const assignment = order.assignedDistributorGiftInventoryId
    ? await getOrderAssignment(client, orderId)
    : null;
  const giftDistributorId = order.distributorId || assignment?.distributorId;
  const distributorGift = Boolean(giftDistributorId && order.assignedDistributorGiftInventoryId);
  const inventoryUpdate = distributorGift
    ? await client.distributorGiftInventory.updateMany({
      where: { id: order.assignedDistributorGiftInventoryId, distributorId: giftDistributorId, quantityReserved: { gt: 0 } },
      data: { quantityReserved: { decrement: 1 } },
    })
    : await client.manufacturerGiftInventory.updateMany({
      where: { id: order.assignedGiftInventoryId, quantityReserved: { gt: 0 } },
      data: { quantityReserved: { decrement: 1 } },
    });
  if (inventoryUpdate.count !== 1) throw new Error("Reserved gift stock is missing for this order.");

  const updatedOrder = await client.order.update({
    where: { id: orderId },
    data: { giftStatus: "DELIVERED" },
    include: { assignedGift: true },
  });
  const rewardEntitlements = await client.giftRewardEntitlement.findMany({
    where: { orderId, status: "ASSIGNED" },
    select: { marketingBenefitRedemptionId: true },
  });
  await client.giftRewardEntitlement.updateMany({
    where: { orderId, status: "ASSIGNED" },
    data: { status: "FULFILLED", fulfilledAt: new Date() },
  });
  const redeemedIds = rewardEntitlements
    .map(({ marketingBenefitRedemptionId }) => marketingBenefitRedemptionId)
    .filter(Boolean);
  if (redeemedIds.length) {
    await client.marketingBenefitRedemption.updateMany({
      where: { id: { in: redeemedIds }, status: "CLAIMED" },
      data: { status: "REDEEMED", redeemedAt: new Date() },
    });
  }

  if (distributorGift) {
    await client.distributorGiftMovementLog.create({
      data: {
        distributorId: giftDistributorId,
        giftId: order.assignedGiftId,
        orderId,
        movementType: "DEDUCTED",
        quantity: 1,
        notes: "Gift was handed over to the customer and deducted from reserved distributor stock.",
      },
    });
  } else {
    await client.giftMovementLog.create({
      data: {
        manufacturerId: order.manufacturerId,
        giftId: order.assignedGiftId,
        orderId,
        movementType: "DEDUCTED",
        quantity: 1,
        notes: "Gift was handed over to the customer and deducted from reserved stock.",
      },
    });
  }

  return { order: updatedOrder, updated: true };
};

export const releaseGiftRewardOnOrderCancellation = async (client, orderId) => {
  const order = await client.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      checkoutGroupId: true,
      manufacturerId: true,
      distributorId: true,
      assignedGiftId: true,
      assignedGiftInventoryId: true,
      assignedDistributorGiftInventoryId: true,
      giftStatus: true,
    },
  });
  if (!order) throw new Error("Order not found.");
  const checkoutKey = order.checkoutGroupId || order.id;
  const groupOrders = await client.order.findMany({
    where: order.checkoutGroupId ? { checkoutGroupId: order.checkoutGroupId } : { id: order.id },
    select: { id: true, status: true },
  });
  const hasActiveSibling = groupOrders.some((member) =>
    member.id !== orderId && !String(member.status || "").toLowerCase().includes("cancel")
  );

  if (order.assignedGiftId && ["PENDING_PACKING", "RESERVED"].includes(order.giftStatus)) {
    if (order.assignedDistributorGiftInventoryId) {
      const distributorId = order.distributorId || (await getOrderAssignment(client, orderId))?.distributorId;
      if (!distributorId) throw new Error("The distributor for the reserved gift could not be resolved.");
      const released = await client.distributorGiftInventory.updateMany({
        where: { id: order.assignedDistributorGiftInventoryId, quantityReserved: { gt: 0 } },
        data: { quantityReserved: { decrement: 1 }, quantityAvailable: { increment: 1 } },
      });
      if (released.count !== 1) throw new Error("Reserved distributor gift stock could not be released for this cancelled order.");
      await client.distributorGiftMovementLog.create({
        data: {
          distributorId,
          giftId: order.assignedGiftId,
          orderId,
          movementType: "RESTOCKED",
          quantity: 1,
          notes: "Order cancelled before delivery; reserved gift returned to available stock.",
        },
      });
    } else if (order.assignedGiftInventoryId) {
      const released = await client.manufacturerGiftInventory.updateMany({
        where: { id: order.assignedGiftInventoryId, quantityReserved: { gt: 0 } },
        data: { quantityReserved: { decrement: 1 }, quantityAvailable: { increment: 1 } },
      });
      if (released.count !== 1) throw new Error("Reserved manufacturer gift stock could not be released for this cancelled order.");
      await client.giftMovementLog.create({
        data: {
          manufacturerId: order.manufacturerId,
          giftId: order.assignedGiftId,
          orderId,
          movementType: "RESTOCKED",
          quantity: 1,
          notes: "Order cancelled before delivery; reserved gift returned to available stock.",
        },
      });
    }
    await client.order.update({
      where: { id: orderId },
      data: {
        assignedGiftId: null,
        assignedGiftInventoryId: null,
        assignedDistributorGiftInventoryId: null,
        giftStatus: "NONE",
      },
    });
  }

  await client.giftRewardEntitlement.updateMany({
    where: { checkoutGroupId: checkoutKey, status: "ASSIGNED", orderId },
    data: {
      status: hasActiveSibling ? "RESERVED" : "PENDING",
      checkoutGroupId: hasActiveSibling ? checkoutKey : null,
      orderId: null,
      giftId: null,
      distributorGiftInventoryId: null,
      assignedAt: null,
    },
  });
  if (!hasActiveSibling) {
    await client.giftRewardEntitlement.updateMany({
      where: { checkoutGroupId: checkoutKey, status: "RESERVED", orderId: null },
      data: { status: "PENDING", checkoutGroupId: null },
    });
  }
};

export const onOrderReturned = async (
  orderId,
  { giftReturned = false, notes = "", expectedManufacturerId, expectedDistributorId } = {},
  client = prisma
) => client.$transaction(async (tx) => {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, manufacturerId: true, distributorId: true, assignedGiftId: true, assignedGiftInventoryId: true, assignedDistributorGiftInventoryId: true, giftStatus: true },
  });

  if (!order?.assignedGiftId) return { order, updated: false, reason: "no gift assigned" };
  if (expectedManufacturerId && order.manufacturerId !== expectedManufacturerId) throw new Error("Order does not belong to this manufacturer.");
  if (expectedDistributorId && !await isAssignedDistributor(tx, order, expectedDistributorId)) {
    throw new Error("Order does not belong to this distributor.");
  }
  if (["RETURNED", "LOST"].includes(order.giftStatus)) return { order, updated: false, reason: "gift return already recorded" };

  const distributorAssignment = order.assignedDistributorGiftInventoryId
    ? await getOrderAssignment(tx, orderId)
    : null;
  const giftDistributorId = order.distributorId || expectedDistributorId || distributorAssignment?.distributorId;
  const distributorGift = Boolean(giftDistributorId && order.assignedDistributorGiftInventoryId);
  const hasReservation = ["PENDING_PACKING", "RESERVED"].includes(order.giftStatus);
  if (giftReturned && !["PENDING_PACKING", "RESERVED", "DELIVERED"].includes(order.giftStatus)) {
    throw new Error("Gift cannot be restocked from its current lifecycle state.");
  }
  const nextGiftStatus = giftReturned ? "RETURNED" : "LOST";
  const claimed = await tx.order.updateMany({
    where: { id: orderId, giftStatus: order.giftStatus },
    data: { giftStatus: nextGiftStatus },
  });
  if (claimed.count !== 1) {
    return { order: await tx.order.findUnique({ where: { id: orderId }, include: { assignedGift: true } }), updated: false, reason: "gift return state already changed" };
  }

  if (hasReservation || giftReturned) {
    const where = {
      ...(hasReservation ? { quantityReserved: { gt: 0 } } : {}),
    };
    const data = {
      ...(giftReturned ? { quantityAvailable: { increment: 1 } } : {}),
      ...(hasReservation ? { quantityReserved: { decrement: 1 } } : {}),
    };
    const inventoryUpdate = distributorGift
      ? await tx.distributorGiftInventory.updateMany({
        where: { id: order.assignedDistributorGiftInventoryId, distributorId: giftDistributorId, ...where },
        data,
      })
      : await tx.manufacturerGiftInventory.updateMany({
        where: { id: order.assignedGiftInventoryId, ...where },
        data,
      });
    if (inventoryUpdate.count !== 1) throw new Error("Assigned gift inventory is missing or no longer reserved.");
  }

  if (distributorGift) {
    await tx.distributorGiftMovementLog.create({
      data: {
        distributorId: giftDistributorId,
        giftId: order.assignedGiftId,
        orderId,
        movementType: giftReturned ? "RESTOCKED" : "LOST",
        quantity: 1,
        notes: notes || (giftReturned ? "Gift returned intact and restored to distributor inventory." : "Gift was not returned or was damaged during return inspection."),
      },
    });
  } else {
    await tx.giftMovementLog.create({
      data: {
        manufacturerId: order.manufacturerId,
        giftId: order.assignedGiftId,
        orderId,
        movementType: giftReturned ? "RESTOCKED" : "LOST",
        quantity: 1,
        notes: notes || (giftReturned ? "Gift returned intact and restored to available inventory." : "Gift was not returned or was damaged during return inspection."),
      },
    });
  }
  if (order.giftStatus !== "DELIVERED") {
    await tx.giftRewardEntitlement.updateMany({
      where: { orderId, status: "ASSIGNED" },
      data: {
        status: "PENDING",
        checkoutGroupId: null,
        orderId: null,
        giftId: null,
        distributorGiftInventoryId: null,
        assignedAt: null,
      },
    });
  }

  return {
    order: await tx.order.findUnique({ where: { id: orderId }, include: { assignedGift: true } }),
    updated: true,
    returnStatus: giftReturned ? "restocked" : "lost",
  };
}, { isolationLevel: "Serializable" });
