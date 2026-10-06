import { prisma } from "../config/db.js";
import { reconcileInventoryLedger } from "../services/inventoryLedgerService.js";

const MAX_PAGE_SIZE = 100;

const parseDate = (value, field) => {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T${field === "to" ? "23:59:59.999" : "00:00:00.000"}`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error(`${field} must be a valid date.`), { statusCode: 400 });
  }
  return date;
};

const reportError = (res, error, action) => {
  console.error(`${action} error:`, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Inventory audit data could not be loaded.",
  });
};

export const getInventoryLedgerOptions = async (_req, res) => {
  try {
    const [skus, locations] = await Promise.all([
      prisma.inventorySku.findMany({
        where: { isActive: true },
        select: { id: true, productId: true, size: true, color: true, product: { select: { name: true } } },
        orderBy: [{ product: { name: "asc" } }, { size: "asc" }, { color: "asc" }],
        take: 500,
      }),
      prisma.inventoryLocation.findMany({
        where: { isActive: true },
        select: { id: true, name: true, kind: true, manufacturerId: true, distributorId: true },
        orderBy: [{ kind: "asc" }, { name: "asc" }],
        take: 500,
      }),
    ]);
    return res.json({ success: true, skus, locations });
  } catch (error) {
    return reportError(res, error, "getInventoryLedgerOptions");
  }
};

export const listInventoryLedgerEntries = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (from && to && from > to) {
      return res.status(400).json({ success: false, message: "The from date must not be after the to date." });
    }
    const where = {
      ...(req.query.inventorySkuId ? { inventorySkuId: String(req.query.inventorySkuId) } : {}),
      ...(req.query.movementType ? { movementType: String(req.query.movementType).trim().toUpperCase() } : {}),
      ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(req.query.locationId ? {
        OR: [
          { sourceLocationId: String(req.query.locationId) },
          { destinationLocationId: String(req.query.locationId) },
        ],
      } : {}),
    };
    const [entries, total] = await prisma.$transaction([
      prisma.inventoryLedgerEntry.findMany({
        where,
        include: {
          inventorySku: { select: { id: true, size: true, color: true, product: { select: { name: true } } } },
          sourceLocation: { select: { id: true, name: true, kind: true } },
          destinationLocation: { select: { id: true, name: true, kind: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.inventoryLedgerEntry.count({ where }),
    ]);
    return res.json({ success: true, entries, page, limit, total });
  } catch (error) {
    return reportError(res, error, "listInventoryLedgerEntries");
  }
};

export const reconcileInventory = async (req, res) => {
  try {
    const inventorySkuId = String(req.query.inventorySkuId || "").trim();
    const locationId = String(req.query.locationId || "").trim();
    if (!inventorySkuId && !locationId) {
      return res.status(400).json({
        success: false,
        message: "Select an inventory SKU, a location, or both before running reconciliation.",
      });
    }
    const balanceWhere = {
      ...(inventorySkuId ? { inventorySkuId } : {}),
      ...(locationId ? { locationId } : {}),
    };
    const ledgerWhere = {
      ...(inventorySkuId ? { inventorySkuId } : {}),
      ...(locationId ? {
        OR: [{ sourceLocationId: locationId }, { destinationLocationId: locationId }],
      } : {}),
    };
    const [balances, ledgerEntries] = await prisma.$transaction([
      prisma.inventoryBalance.findMany({
        where: balanceWhere,
        select: { locationId: true, inventorySkuId: true, quantityOnHand: true, reservedQuantity: true },
      }),
      prisma.inventoryLedgerEntry.findMany({
        where: ledgerWhere,
        select: { sourceLocationId: true, destinationLocationId: true, inventorySkuId: true, quantity: true },
      }),
    ]);
    const items = reconcileInventoryLedger({ balances, ledgerEntries, locationId: locationId || null });
    return res.json({
      success: true,
      reconciledAt: new Date().toISOString(),
      items,
      varianceCount: items.filter((item) => item.variance !== 0).length,
    });
  } catch (error) {
    return reportError(res, error, "reconcileInventory");
  }
};
