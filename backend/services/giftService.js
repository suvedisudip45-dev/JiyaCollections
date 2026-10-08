import { prisma } from "../config/db.js";

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
  const loyaltyGiftValue = Math.max(0, Number(reward.giftAmount || 0));
  const matchedOrderRules = (Array.isArray(orderValueRules) ? orderValueRules : []).filter((rule) =>
    rule?.isActive !== false &&
    String(rule?.triggerType || "ORDER_VALUE").toUpperCase() === "ORDER_VALUE" &&
    Number(order.amount || 0) >= Number(rule?.minSpendThreshold || 0)
  );
  const orderValueGiftValue = matchedOrderRules.reduce(
    (maxValue, rule) => Math.max(maxValue, Number(rule.giftTargetValue || 0)),
    0
  );
  const reasons = [];
  if (loyaltyGiftValue > 0) reasons.push("LOYALTY_TIER");
  if (orderValueGiftValue > 0) reasons.push("ORDER_VALUE");

  return {
    eligible: reasons.length > 0,
    budget: Math.max(loyaltyGiftValue, orderValueGiftValue),
    reasons,
    loyaltyGiftValue,
    orderValueGiftValue,
    loyaltyGiftDescription: String(reward.giftDescription || "").trim(),
  };
};

export const listGiftCatalog = async () => prisma.giftCatalog.findMany({
  where: { isActive: true },
  orderBy: { priceValue: "asc" },
});

export const saveGiftCatalog = async (payload = {}) => {
  const name = String(payload.name || "").trim();
  const skuBase = createGiftSkuFromName(name);
  const category = normalizeGiftCategory(payload.category);
  let sku = skuBase;
  let suffix = 2;
  while (true) {
    const duplicate = await prisma.giftCatalog.findUnique({ where: { sku } });
    if (!duplicate || duplicate.id === payload.id) break;
    sku = `${skuBase}-${suffix++}`;
  }
  const safePayload = {
    name,
    sku,
    priceValue: Number(payload.priceValue || 0),
    category,
    description: payload.description || null,
    isActive: payload.isActive !== false,
  };

  if (!safePayload.name) throw new Error("Gift name is required.");
  if (!Number.isFinite(safePayload.priceValue) || safePayload.priceValue <= 0) throw new Error("Gift value must be greater than zero.");

  if (payload.id) {
    return prisma.giftCatalog.update({
      where: { id: payload.id },
      data: safePayload,
    });
  }

  return prisma.giftCatalog.upsert({
    where: { sku: safePayload.sku },
    update: safePayload,
    create: safePayload,
  });
};

export const listLoyaltyTierConfigs = async () => prisma.loyaltyTierConfig.findMany({
  where: { triggerType: "ORDER_VALUE" },
  orderBy: { minSpendThreshold: "asc" },
});

export const saveLoyaltyTierConfig = async (payload = {}) => {
  const data = {
    tierName: String(payload.tierName || "").trim(),
    triggerType: "ORDER_VALUE",
    minSpendThreshold: Number(payload.minSpendThreshold || 0),
    giftTargetValue: Number(payload.giftTargetValue || 0),
    description: payload.description || null,
    isActive: payload.isActive !== false,
  };

  if (!data.tierName) throw new Error("Rule name or loyalty tier is required.");
  if (data.minSpendThreshold <= 0) {
    throw new Error("Order-value rules require a positive minimum order value.");
  }
  if (data.giftTargetValue <= 0) throw new Error("Gift value ceiling must be greater than zero.");

  if (payload.id) {
    return prisma.loyaltyTierConfig.update({
      where: { id: payload.id },
      data,
    });
  }

  return prisma.loyaltyTierConfig.upsert({
    where: { tierName: data.tierName },
    update: data,
    create: data,
  });
};

export const assignGiftToManufacturer = async ({ manufacturerId, giftId, quantity = 1, notes = "" }) => {
  if (!manufacturerId || !giftId) throw new Error("Manufacturer and gift are required.");
  const normalizedQuantity = Number(quantity);
  if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1) {
    throw new Error("Gift quantity must be a positive whole number.");
  }

  const gift = await prisma.giftCatalog.findUnique({ where: { id: giftId } });
  if (!gift) throw new Error("Gift not found.");

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

export const assignGiftToDistributor = async ({ distributorId, giftId, quantity = 1, notes = "" }) => {
  if (!distributorId || !giftId) throw new Error("Distributor and gift are required.");
  const normalizedQuantity = Number(quantity);
  if (!Number.isSafeInteger(normalizedQuantity) || normalizedQuantity < 1) {
    throw new Error("Gift quantity must be a positive whole number.");
  }
  const [gift, distributor] = await Promise.all([
    prisma.giftCatalog.findUnique({ where: { id: giftId } }),
    prisma.distributor.findFirst({ where: { id: distributorId, status: "ACTIVE", isActive: true }, select: { id: true } }),
  ]);
  if (!gift) throw new Error("Gift not found.");
  if (!distributor) throw new Error("An active distributor profile is required.");

  return prisma.$transaction(async (tx) => {
    const inventory = await tx.distributorGiftInventory.create({
      data: {
        distributorId,
        giftId,
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
    return inventory;
  });
};

export const getDistributorGiftInventory = async (distributorId) => prisma.distributorGiftInventory.findMany({
  where: { distributorId },
  include: { gift: true },
  orderBy: { createdAt: "desc" },
});

export const respondToDistributorGiftAllocation = async ({ inventoryId, distributorId, decision, notes }) => {
  const normalizedDecision = String(decision || "").toUpperCase();
  if (!["ACCEPTED", "REJECTED"].includes(normalizedDecision)) {
    throw new Error("Decision must be ACCEPTED or REJECTED.");
  }
  return prisma.$transaction(async (tx) => {
    const inventory = await tx.distributorGiftInventory.findFirst({
      where: { id: inventoryId, distributorId },
      include: { gift: true },
    });
    if (!inventory) throw new Error("Gift allocation not found for this distributor.");
    if (inventory.status !== "PENDING_ACCEPTANCE") {
      throw new Error("Only pending gift allocations can be accepted or rejected.");
    }
    const updated = await tx.distributorGiftInventory.update({
      where: { id: inventoryId },
      data: { status: normalizedDecision, notes: notes || `${normalizedDecision} by distributor.` },
    });
    await tx.distributorGiftMovementLog.create({
      data: {
        distributorId,
        giftId: inventory.giftId,
        movementType: normalizedDecision === "ACCEPTED" ? "ALLOCATED" : "REJECTED",
        quantity: inventory.quantityAvailable,
        notes: notes || `Gift allocation ${normalizedDecision.toLowerCase()} by distributor.`,
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

  const orderValueRules = await client.loyaltyTierConfig.findMany({
    where: { isActive: true, triggerType: "ORDER_VALUE" },
  });
  const eligibility = calculateOrderGiftEligibility(order, orderValueRules);
  const assignedGift = order.assignedGift ? {
    id: order.assignedGift.id,
    name: order.assignedGift.name,
    sku: order.assignedGift.sku,
    priceValue: Number(order.assignedGift.priceValue || 0),
    status: order.giftStatus,
  } : null;

  if (!eligibility.eligible || assignedGift) {
    return { eligible: Boolean(assignedGift), alreadyAssigned: Boolean(assignedGift), eligibility, assignedGift, options: [] };
  }

  const inventory = await client.manufacturerGiftInventory.findMany({
    where: {
      manufacturerId,
      status: "ACCEPTED",
      quantityAvailable: { gt: 0 },
      gift: { isActive: true, priceValue: { lte: eligibility.budget, gt: 0 } },
    },
    include: { gift: true },
    orderBy: [{ gift: { priceValue: "asc" } }, { createdAt: "asc" }],
  });

  return {
    eligible: true,
    alreadyAssigned: false,
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
    if (order.distributorId !== distributorId) throw new Error("Order does not belong to this distributor.");

    const orderValueRules = await client.loyaltyTierConfig.findMany({
      where: { isActive: true, triggerType: "ORDER_VALUE" },
    });
    const eligibility = calculateOrderGiftEligibility(order, orderValueRules);
    const assignedGift = order.assignedGift ? {
      id: order.assignedGift.id,
      name: order.assignedGift.name,
      sku: order.assignedGift.sku,
      priceValue: Number(order.assignedGift.priceValue || 0),
      status: order.giftStatus,
    } : null;

    if (!eligibility.eligible || assignedGift) {
      return { eligible: Boolean(assignedGift), alreadyAssigned: Boolean(assignedGift), eligibility, assignedGift, options: [] };
    }

    const inventory = await client.distributorGiftInventory.findMany({
      where: {
        distributorId,
        status: "ACCEPTED",
        quantityAvailable: { gt: 0 },
        gift: { isActive: true, priceValue: { lte: eligibility.budget, gt: 0 } },
      },
      include: { gift: true },
      orderBy: [{ gift: { priceValue: "asc" } }, { createdAt: "asc" }],
    });

    return {
      eligible: true,
      alreadyAssigned: false,
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
      where: { id: orderId, distributorId, assignedGiftId: null, giftStatus: "NONE" },
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
  if (expectedDistributorId && order.distributorId !== expectedDistributorId) throw new Error("Order does not belong to this distributor.");
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

    if (order.distributorId && order.assignedDistributorGiftInventoryId) {
      await tx.distributorGiftMovementLog.create({
        data: {
          distributorId: order.distributorId,
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

  const distributorGift = Boolean(order.distributorId && order.assignedDistributorGiftInventoryId);
  const inventoryUpdate = distributorGift
    ? await client.distributorGiftInventory.updateMany({
      where: { id: order.assignedDistributorGiftInventoryId, distributorId: order.distributorId, quantityReserved: { gt: 0 } },
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

  if (distributorGift) {
    await client.distributorGiftMovementLog.create({
      data: {
        distributorId: order.distributorId,
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

export const onOrderReturned = async (orderId, { giftReturned = false, notes = "", expectedManufacturerId, expectedDistributorId } = {}) => prisma.$transaction(async (tx) => {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, manufacturerId: true, distributorId: true, assignedGiftId: true, assignedGiftInventoryId: true, assignedDistributorGiftInventoryId: true, giftStatus: true },
  });

  if (!order?.assignedGiftId) return { order, updated: false, reason: "no gift assigned" };
  if (expectedManufacturerId && order.manufacturerId !== expectedManufacturerId) throw new Error("Order does not belong to this manufacturer.");
  if (expectedDistributorId && order.distributorId !== expectedDistributorId) throw new Error("Order does not belong to this distributor.");
  if (["RETURNED", "LOST"].includes(order.giftStatus)) return { order, updated: false, reason: "gift return already recorded" };

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
    const distributorGift = Boolean(order.distributorId && order.assignedDistributorGiftInventoryId);
    const where = {
      ...(hasReservation ? { quantityReserved: { gt: 0 } } : {}),
    };
    const data = {
      ...(giftReturned ? { quantityAvailable: { increment: 1 } } : {}),
      ...(hasReservation ? { quantityReserved: { decrement: 1 } } : {}),
    };
    const inventoryUpdate = distributorGift
      ? await tx.distributorGiftInventory.updateMany({
        where: { id: order.assignedDistributorGiftInventoryId, distributorId: order.distributorId, ...where },
        data,
      })
      : await tx.manufacturerGiftInventory.updateMany({
        where: { id: order.assignedGiftInventoryId, ...where },
        data,
      });
    if (inventoryUpdate.count !== 1) throw new Error("Assigned gift inventory is missing or no longer reserved.");
  }

  const distributorGift = Boolean(order.distributorId && order.assignedDistributorGiftInventoryId);
  if (distributorGift) {
    await tx.distributorGiftMovementLog.create({
      data: {
        distributorId: order.distributorId,
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

  return {
    order: await tx.order.findUnique({ where: { id: orderId }, include: { assignedGift: true } }),
    updated: true,
    returnStatus: giftReturned ? "restocked" : "lost",
  };
}, { isolationLevel: "Serializable" });
