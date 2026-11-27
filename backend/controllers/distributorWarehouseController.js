import { prisma } from "../config/db.js";
import {
  barcodeScanIdempotencyKey,
  normalizeCycleCountInput,
  normalizePrePackInput,
  normalizeWarehouseScanInput,
  resolveDistributorBarcode,
  fail,
} from "../services/distributorWarehouseService.js";

const respondError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  message: error.statusCode ? error.message : "The warehouse operation could not be completed.",
  ...(error.code ? { code: error.code } : {}),
});

export const getDistributorBarcode = async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    const result = await prisma.$transaction(async (tx) =>
      resolveDistributorBarcode({ tx, distributorId: req.distributorId, code })
    );
    return res.json({ success: true, sku: result });
  } catch (error) {
    return respondError(res, error);
  }
};

export const listDistributorPrePacks = async (req, res) => {
  try {
    const prePacks = await prisma.distributorPrePack.findMany({
      where: { distributorId: req.distributorId, isActive: true },
      orderBy: { updatedAt: "desc" },
      include: {
        lines: {
          include: {
            inventorySku: {
              include: { product: { select: { id: true, name: true, image: true, price: true } } },
            },
          },
        },
      },
    });
    return res.json({ success: true, prePacks });
  } catch (error) {
    return respondError(res, error);
  }
};

export const createDistributorPrePack = async (req, res) => {
  try {
    const input = normalizePrePackInput(req.body);
    const prePack = await prisma.$transaction(async (tx) => {
      const skus = await tx.inventorySku.findMany({
        where: { id: { in: input.lines.map((line) => line.inventorySkuId) }, isActive: true },
        select: { id: true },
      });
      if (skus.length !== input.lines.length) {
        throw fail("Every pre-pack line must reference an active inventory SKU.", "INVALID_PRE_PACK_SKU", 409);
      }
      return tx.distributorPrePack.create({
        data: {
          distributorId: req.distributorId,
          name: input.name,
          description: input.description,
          createdByAccountId: req.auth.accountId,
          lines: { create: input.lines },
        },
        include: { lines: { include: { inventorySku: { include: { product: true } } } } },
      });
    }, { isolationLevel: "Serializable" });
    return res.status(201).json({ success: true, prePack: prePack });
  } catch (error) {
    return respondError(res, error);
  }
};

export const recordDistributorWarehouseScan = async (req, res) => {
  try {
    const input = normalizeWarehouseScanInput(req.body);
    const suppliedKey = String(req.headers["idempotency-key"] || req.body.idempotencyKey || "").trim();
    if (suppliedKey.length > 191) throw fail("Idempotency-Key is too long.");
    const event = await prisma.$transaction(async (tx) => {
      const sku = await resolveDistributorBarcode({ tx, distributorId: req.distributorId, code: input.scanCode });
      const key = suppliedKey || barcodeScanIdempotencyKey({
        distributorId: req.distributorId,
        operation: input.operation,
        scanCode: input.scanCode,
        referenceId: input.referenceId,
        actorId: req.auth.accountId,
      });
      const replay = await tx.warehouseScanEvent.findUnique({ where: { idempotencyKey: key } });
      if (replay) {
        const replayMatches = replay.distributorId === req.distributorId &&
          replay.operation === input.operation &&
          replay.scanCode === input.scanCode &&
          replay.referenceId === input.referenceId &&
          replay.quantity === input.quantity &&
          replay.inventorySkuId === sku.inventorySkuId;
        if (!replayMatches) {
          throw fail("The scan idempotency key was used for different scan details.", "IDEMPOTENCY_CONFLICT", 409);
        }
        return { event: replay, expected: replay.matched, sku, replayed: true };
      }
      if (input.expectedInventorySkuId && input.expectedInventorySkuId !== sku.inventorySkuId) {
        const mismatch = await tx.warehouseScanEvent.create({
          data: {
            distributorId: req.distributorId,
            inventorySkuId: sku.inventorySkuId,
            scanCode: input.scanCode,
            operation: input.operation,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            quantity: input.quantity,
            matched: false,
            idempotencyKey: key,
            actorAccountId: req.auth.accountId,
          },
        });
        return { event: mismatch, expected: false, sku };
      }
      const created = await tx.warehouseScanEvent.create({
        data: {
          distributorId: req.distributorId,
          inventorySkuId: sku.inventorySkuId,
          scanCode: input.scanCode,
          operation: input.operation,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          quantity: input.quantity,
          matched: true,
          idempotencyKey: key,
          actorAccountId: req.auth.accountId,
        },
      });
      return { event: created, expected: true, sku };
    }, { isolationLevel: "Serializable" });

    if (!event.expected) {
      return res.status(409).json({
        success: false,
        code: "WRONG_SKU_SCAN",
        message: `Scanned ${event.sku.productName} (${event.sku.size}/${event.sku.color}) does not match the expected SKU.`,
        scannedSku: event.sku,
      });
    }
    return res.json({ success: true, matched: true, scan: event.event, sku: event.sku });
  } catch (error) {
    return respondError(res, error);
  }
};

export const createDistributorCycleCount = async (req, res) => {
  try {
    const input = normalizeCycleCountInput(req.body);
    const count = await prisma.$transaction(async (tx) => {
      const destination = await tx.inventoryLocation.findFirst({
        where: { kind: "DISTRIBUTOR", distributorId: req.distributorId, isActive: true },
        select: { id: true },
      });
      if (!destination) throw fail("No active distributor inventory location was found.", "DISTRIBUTOR_LOCATION_NOT_FOUND", 409);
      const balances = await tx.inventoryBalance.findMany({
        where: {
          locationId: destination.id,
          inventorySkuId: { in: input.lines.map((line) => line.inventorySkuId) },
        },
        select: { inventorySkuId: true, quantityOnHand: true, reservedQuantity: true },
      });
      const balanceBySku = new Map(balances.map((balance) => [balance.inventorySkuId, balance]));
      return tx.warehouseCycleCount.create({
        data: {
          distributorId: req.distributorId,
          countCode: input.countCode,
          notes: input.notes,
          createdByAccountId: req.auth.accountId,
          lines: {
            create: input.lines.map((line) => {
              const balance = balanceBySku.get(line.inventorySkuId);
              const systemQuantity = balance
                ? Math.max(0, Number(balance.quantityOnHand) - Number(balance.reservedQuantity))
                : 0;
              return {
                inventorySkuId: line.inventorySkuId,
                systemQuantity,
                countedQuantity: line.countedQuantity,
                varianceQuantity: line.countedQuantity - systemQuantity,
                note: line.note,
              };
            }),
          },
        },
        include: { lines: { include: { inventorySku: { include: { product: true } } } } },
      });
    }, { isolationLevel: "Serializable" });
    return res.status(201).json({ success: true, cycleCount: count });
  } catch (error) {
    return respondError(res, error);
  }
};

export const listDistributorCycleCounts = async (req, res) => {
  try {
    const counts = await prisma.warehouseCycleCount.findMany({
      where: { distributorId: req.distributorId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { lines: { include: { inventorySku: { include: { product: true } } } } },
    });
    return res.json({ success: true, cycleCounts: counts });
  } catch (error) {
    return respondError(res, error);
  }
};
