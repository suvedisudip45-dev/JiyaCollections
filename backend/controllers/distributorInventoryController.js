import { createHash } from "node:crypto";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";
import {
  applyInventoryMovement,
  ensureInventoryLocation,
} from "../services/inventoryLedgerService.js";
import { normalizeDistributorStockDecrease } from "../services/distributorStockService.js";
import { syncProductStock } from "../services/stockSyncService.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";

const actorContext = (req) => ({
  actorId: req.auth?.accountId || null,
  actorRole: "DISTRIBUTOR",
  portalSource: "DISTRIBUTOR",
  ipAddress: req.ip || null,
  userAgent: req.headers["user-agent"] || null,
  correlationId: req.correlationId || null,
});

const responseError = (res, error, action = "decreaseDistributorInventory", fallbackMessage = "Unable to record distributor inventory decrease.") => {
  console.error(`${action} error:`, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : fallbackMessage,
    ...(error.code ? { code: error.code } : {}),
  });
};

const getDistributorInventoryLocations = (distributorId) => prisma.inventoryLocation.findMany({
  where: {
    kind: { in: ["DISTRIBUTOR", "DAMAGED"] },
    distributorId,
    inventoryOwner: "PLATFORM",
    isActive: true,
  },
  select: { id: true, kind: true },
});

const inventoryQuantities = (balances, locations) => {
  const hubLocationIds = new Set(locations.filter((location) => location.kind === "DISTRIBUTOR").map((location) => location.id));
  const hubBalances = balances.filter((balance) => hubLocationIds.has(balance.locationId));
  const damagedQty = balances
    .filter((balance) => locations.some((location) => location.id === balance.locationId && location.kind === "DAMAGED"))
    .reduce((total, balance) => total + balance.quantityOnHand, 0);
  const quantity = hubBalances.reduce((total, balance) => total + balance.quantityOnHand, 0);
  const reservedQty = hubBalances.reduce((total, balance) => total + balance.reservedQuantity, 0);
  return {
    quantity,
    reservedQty,
    availableQty: Math.max(0, quantity - reservedQty),
    damagedQty,
  };
};

export const getDistributorInventory = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const locations = await getDistributorInventoryLocations(req.distributorId);
    if (!locations.length) return res.json(paginatedResponse("inventory", [], pagination, 0));
    const locationIds = locations.map((location) => location.id);
    if (req.query.groupBy !== "product") {
      const distributorLocationIds = locations
        .filter((location) => location.kind === "DISTRIBUTOR")
        .map((location) => location.id);
      const skuWhere = {
        isActive: true,
        product: { published: true, deletedAt: null },
        balances: { some: { locationId: { in: distributorLocationIds } } },
      };
      const [skus, total] = await prisma.$transaction([
        prisma.inventorySku.findMany({
          where: skuWhere,
          orderBy: [{ product: { name: "asc" } }, { size: "asc" }, { color: "asc" }],
          skip: pagination.skip,
          take: pagination.limit,
          include: {
            product: { select: { id: true, name: true, image: true, price: true, category: true } },
          },
        }),
        prisma.inventorySku.count({ where: skuWhere }),
      ]);
      const balances = skus.length
        ? await prisma.inventoryBalance.findMany({
            where: {
              locationId: { in: locationIds },
              inventorySkuId: { in: skus.map((sku) => sku.id) },
            },
            select: { locationId: true, inventorySkuId: true, quantityOnHand: true, reservedQuantity: true },
          })
        : [];
      const balancesBySku = new Map();
      for (const balance of balances) {
        const skuBalances = balancesBySku.get(balance.inventorySkuId) || [];
        skuBalances.push(balance);
        balancesBySku.set(balance.inventorySkuId, skuBalances);
      }
      const inventory = skus.map((sku) => ({
        inventorySkuId: sku.id,
        productId: sku.productId,
        productName: sku.product.name,
        product: sku.product,
        size: sku.size,
        color: sku.color,
        ...inventoryQuantities(balancesBySku.get(sku.id) || [], locations),
      }));
      return res.json(paginatedResponse("inventory", inventory, pagination, total));
    }

    const skuWhere = {
      isActive: true,
      balances: { some: { locationId: { in: locationIds } } },
    };
    const productWhere = {
      published: true,
      deletedAt: null,
      inventorySkus: { some: skuWhere },
    };
    const [products, total] = await prisma.$transaction([
      prisma.product.findMany({
        where: productWhere,
        orderBy: { name: "asc" },
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          inventorySkus: {
            where: skuWhere,
            orderBy: [{ size: "asc" }, { color: "asc" }],
            select: {
              id: true,
              size: true,
              color: true,
              balances: {
                where: { locationId: { in: locationIds } },
                select: { locationId: true, quantityOnHand: true, reservedQuantity: true },
              },
            },
          },
        },
      }),
      prisma.product.count({ where: productWhere }),
    ]);
    const inventory = products.map((product) => {
      const variants = product.inventorySkus.map((sku) => ({
        inventorySkuId: sku.id,
        size: sku.size,
        color: sku.color,
        ...inventoryQuantities(sku.balances, locations),
      }));
      const totals = variants.reduce((result, variant) => ({
        quantity: result.quantity + variant.quantity,
        reservedQty: result.reservedQty + variant.reservedQty,
        availableQty: result.availableQty + variant.availableQty,
        damagedQty: result.damagedQty + variant.damagedQty,
      }), { quantity: 0, reservedQty: 0, availableQty: 0, damagedQty: 0 });
      return {
        productId: product.id,
        productName: product.name,
        product: {
          id: product.id,
          name: product.name,
          image: product.image,
          price: product.price,
          category: product.category,
        },
        ...totals,
        variants,
      };
    });
    return res.json(paginatedResponse("inventory", inventory, pagination, total));
  } catch (error) {
    return responseError(res, error, "getDistributorInventory", "Unable to load distributor inventory.");
  }
};

export const getDistributorInventorySkuDetails = async (req, res) => {
  try {
    const inventorySkuId = String(req.params.inventorySkuId || "").trim();
    if (!inventorySkuId || inventorySkuId.length > 191) {
      return res.status(400).json({ success: false, message: "A valid product variant is required." });
    }
    const locations = await getDistributorInventoryLocations(req.distributorId);
    const locationIds = locations.map((location) => location.id);
    if (!locationIds.length) {
      return res.status(404).json({ success: false, message: "This product variant is not in your hub inventory." });
    }
    const sku = await prisma.inventorySku.findFirst({
      where: {
        id: inventorySkuId,
        isActive: true,
        product: { published: true, deletedAt: null },
        balances: { some: { locationId: { in: locationIds } } },
      },
      select: {
        id: true,
        productId: true,
        size: true,
        color: true,
        product: { select: { id: true, name: true, image: true, price: true, category: true } },
      },
    });
    if (!sku) {
      return res.status(404).json({ success: false, message: "This product variant is not in your hub inventory." });
    }
    const pagination = getPagination({ ...req.query, limit: Math.min(Number(req.query.limit) || 20, 50) });
    const ledgerWhere = {
      inventorySkuId,
      OR: [
        { sourceLocationId: { in: locationIds } },
        { destinationLocationId: { in: locationIds } },
      ],
    };
    const [balances, movements, total] = await prisma.$transaction([
      prisma.inventoryBalance.findMany({
        where: { inventorySkuId, locationId: { in: locationIds } },
        select: { locationId: true, quantityOnHand: true, reservedQuantity: true },
      }),
      prisma.inventoryLedgerEntry.findMany({
        where: ledgerWhere,
        include: {
          sourceLocation: { select: { name: true, kind: true } },
          destinationLocation: { select: { name: true, kind: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.inventoryLedgerEntry.count({ where: ledgerWhere }),
    ]);
    return res.json({
      success: true,
      inventory: {
        inventorySkuId: sku.id,
        productId: sku.productId,
        productName: sku.product.name,
        product: sku.product,
        size: sku.size,
        color: sku.color,
        ...inventoryQuantities(balances, locations),
      },
      movements,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    return responseError(res, error, "getDistributorInventorySkuDetails", "Unable to load variant details.");
  }
};

export const decreaseDistributorInventory = async (req, res) => {
  try {
    const input = normalizeDistributorStockDecrease(req.body || {});
    const rawIdempotencyKey = String(req.get?.("Idempotency-Key") || req.body?.idempotencyKey || "").trim();
    if (!/^[A-Za-z0-9._:-]{1,140}$/.test(rawIdempotencyKey)) {
      return res.status(400).json({ success: false, message: "A valid Idempotency-Key is required." });
    }
    const idempotencyKey = `DISTRIBUTOR_STOCK_ADJUSTMENT:${createHash("sha256")
      .update(`${req.distributorId}:${rawIdempotencyKey}`)
      .digest("hex")}`;
    const outcome = await prisma.$transaction(async (tx) => {
      const distributor = await tx.distributor.findFirst({
        where: { id: req.distributorId, status: "ACTIVE", isActive: true },
        select: { id: true, name: true },
      });
      if (!distributor) throw Object.assign(new Error("An active distributor profile is required."), { statusCode: 403 });
      const location = await tx.inventoryLocation.findFirst({
        where: {
          kind: "DISTRIBUTOR",
          distributorId: distributor.id,
          inventoryOwner: "PLATFORM",
          isActive: true,
        },
        select: { id: true },
      });
      if (!location) throw Object.assign(new Error("Distributor stock location was not found."), { statusCode: 409 });
      const sku = await tx.inventorySku.findFirst({
        where: { id: input.inventorySkuId, isActive: true },
        select: { id: true, productId: true, size: true, color: true, product: { select: { name: true } } },
      });
      if (!sku) throw Object.assign(new Error("Active inventory SKU not found."), { statusCode: 404 });

      const existing = await tx.inventoryDiscrepancy.findUnique({ where: { idempotencyKey } });
      if (existing) {
        const sameRequest =
          existing.distributorId === distributor.id &&
          existing.inventoryLocationId === location.id &&
          existing.inventorySkuId === input.inventorySkuId &&
          existing.quantity === input.quantity &&
          existing.discrepancyType === (input.adjustmentType === "DAMAGED" ? "OTHER_DAMAGE" : "LOSS") &&
          existing.details === input.reason &&
          JSON.stringify(existing.evidence) === JSON.stringify([input.evidenceUrl]);
        if (!sameRequest) {
          throw Object.assign(new Error("Idempotency key was already used for a different inventory adjustment."), { statusCode: 409 });
        }
        return { discrepancy: existing, replayed: true };
      }

      const destination = await ensureInventoryLocation(tx, {
        kind: input.adjustmentType === "DAMAGED" ? "DAMAGED" : "LOST",
        distributorId: distributor.id,
        name: `${input.adjustmentType === "DAMAGED" ? "Damaged" : "Lost"} stock ${distributor.name}`,
      });
      const discrepancy = await tx.inventoryDiscrepancy.create({
        data: {
          idempotencyKey,
          distributorId: distributor.id,
          inventoryLocationId: location.id,
          inventorySkuId: sku.id,
          discrepancyType: input.adjustmentType === "DAMAGED" ? "OTHER_DAMAGE" : "LOSS",
          custodyStage: "DISTRIBUTOR_STORAGE",
          quantity: input.quantity,
          reportedBy: req.auth.accountId,
          reportedByRole: "DISTRIBUTOR",
          evidence: [input.evidenceUrl],
          details: input.reason,
        },
      });
      await applyInventoryMovement(tx, {
        inventorySkuId: sku.id,
        sourceLocationId: location.id,
        destinationLocationId: destination.id,
        quantity: input.quantity,
        movementType: input.adjustmentType === "DAMAGED" ? "DAMAGE" : "LOSS",
        referenceType: "DISTRIBUTOR_STOCK_ADJUSTMENT",
        referenceId: discrepancy.id,
        idempotencyKey: `distributor-adjustment:${discrepancy.id}`,
        actorId: req.auth.accountId,
        actorRole: "DISTRIBUTOR",
        reason: input.reason,
      });
      await syncProductStock(sku.productId, { client: tx, throwOnError: true });
      await recordSystemAudit(actorContext(req), {
        action: "DISTRIBUTOR_INVENTORY_DECREASE_REPORTED",
        entityType: "InventoryDiscrepancy",
        entityId: discrepancy.id,
        afterState: {
          distributorId: distributor.id,
          inventoryLocationId: location.id,
          inventorySkuId: sku.id,
          productName: sku.product.name,
          size: sku.size,
          color: sku.color,
          adjustmentType: input.adjustmentType,
          quantity: input.quantity,
          evidenceUrl: input.evidenceUrl,
          status: discrepancy.status,
        },
      }, { client: tx });
      return { discrepancy, replayed: false };
    }, { isolationLevel: "Serializable" });
    return res.status(outcome.replayed ? 200 : 201).json({
      success: true,
      message: outcome.replayed ? "Inventory decrease was already recorded." : "Inventory decrease recorded and submitted for admin review.",
      ...outcome,
    });
  } catch (error) {
    return responseError(res, error);
  }
};
