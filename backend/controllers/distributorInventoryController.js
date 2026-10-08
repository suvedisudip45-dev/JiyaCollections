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

const responseError = (res, error) => {
  console.error("decreaseDistributorInventory error:", error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Unable to record distributor inventory decrease.",
    ...(error.code ? { code: error.code } : {}),
  });
};

export const getDistributorInventory = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const location = await prisma.inventoryLocation.findFirst({
      where: {
        kind: "DISTRIBUTOR",
        distributorId: req.distributorId,
        inventoryOwner: "PLATFORM",
        isActive: true,
      },
      select: { id: true },
    });
    if (!location) return res.json(paginatedResponse("inventory", [], pagination, 0));

    const where = {
      locationId: location.id,
      inventorySku: { isActive: true, product: { published: true } },
    };
    const [balances, total] = await prisma.$transaction([
      prisma.inventoryBalance.findMany({
        where,
        orderBy: [{ inventorySku: { product: { name: "asc" } } }, { inventorySku: { size: "asc" } }, { inventorySku: { color: "asc" } }],
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          inventorySku: {
            include: {
              product: {
                select: { id: true, name: true, image: true, price: true, category: true },
              },
            },
          },
        },
      }),
      prisma.inventoryBalance.count({ where }),
    ]);
    const inventory = balances.map((balance) => ({
      inventorySkuId: balance.inventorySkuId,
      productId: balance.inventorySku.productId,
      productName: balance.inventorySku.product.name,
      product: balance.inventorySku.product,
      size: balance.inventorySku.size,
      color: balance.inventorySku.color,
      quantity: balance.quantityOnHand,
      reservedQty: balance.reservedQuantity,
      availableQty: Math.max(0, balance.quantityOnHand - balance.reservedQuantity),
    }));
    return res.json(paginatedResponse("inventory", inventory, pagination, total));
  } catch (error) {
    return responseError(res, error);
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
