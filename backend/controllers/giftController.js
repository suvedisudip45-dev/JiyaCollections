import { prisma } from "../config/db.js";
import {
  listGiftCatalog,
  saveGiftCatalog,
  archiveGiftCatalog,
  listLoyaltyTierConfigs,
  saveLoyaltyTierConfig,
  archiveOrderValueGiftRule,
  assignGiftToDistributor,
  cancelPendingAdminDistributorGiftAllocation,
  getEligibleManufacturerGiftOptions,
  getDistributorGiftOptions,
  getManufacturerGiftInventory,
  getDistributorGiftInventory,
  listAdminDistributorGiftStock,
  adjustAdminDistributorGiftStock,
  listAdminGiftAssignments,
  getAdminOrderGiftOptions,
  replaceAdminOrderGift,
  respondToGiftAllocation,
  respondToDistributorGiftAllocation,
  onOrderReturned,
} from "../services/giftService.js";

const sendGiftError = (res, error) => res.status(error.statusCode || (error.code ? 409 : 400)).json({
  success: false,
  message: error.message || "Gift operation failed.",
  ...(error.code ? { code: error.code } : {}),
});

const getAdminActorContext = (req) => ({
  actorId: req.auth?.accountId || null,
  actorRole: req.auth?.role || "ADMIN",
  portalSource: req.auth?.role || "ADMIN",
  ipAddress: req.ip || null,
  userAgent: req.headers["user-agent"] || null,
  correlationId: req.correlationId || null,
});

export const getGiftCatalog = async (req, res) => {
  try {
    const gifts = await listGiftCatalog({ includeInactive: req.query.includeInactive === "true" });
    res.json({ success: true, gifts });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export const getAdminGiftStock = async (req, res) => {
  try {
    const stock = await listAdminDistributorGiftStock({
      page: req.query.page === undefined ? 1 : Number(req.query.page),
      pageSize: req.query.pageSize === undefined ? 50 : Number(req.query.pageSize),
    });
    return res.json({ success: true, ...stock });
  } catch (error) {
    return sendGiftError(res, error);
  }
};

export const adjustAdminGiftStock = async (req, res) => {
  try {
    const inventory = await adjustAdminDistributorGiftStock({
      inventoryId: req.params.inventoryId,
      adjustment: req.body?.adjustment,
      reason: req.body?.reason,
      actorContext: {
        actorId: req.auth?.accountId || null,
        actorRole: req.auth?.role || "ADMIN",
        portalSource: req.auth?.role || "ADMIN",
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        correlationId: req.correlationId || null,
      },
    });
    return res.json({ success: true, message: "Gift stock adjusted and recorded.", inventory });
  } catch (error) {
    return sendGiftError(res, error);
  }
};

export const cancelAdminGiftAllocation = async (req, res) => {
  try {
    const inventory = await cancelPendingAdminDistributorGiftAllocation({
      inventoryId: req.params.inventoryId,
      reason: req.body?.reason,
      actorContext: getAdminActorContext(req),
    });
    return res.json({ success: true, message: "Pending distributor gift allocation cancelled.", inventory });
  } catch (error) {
    return sendGiftError(res, error);
  }
};

export const getAdminGiftAssignments = async (_req, res) => {
  try {
    const orders = await listAdminGiftAssignments();
    return res.json({ success: true, orders });
  } catch (error) {
    return sendGiftError(res, error);
  }
};

export const getAdminGiftOptions = async (req, res) => {
  try {
    const result = await getAdminOrderGiftOptions({ orderId: req.params.orderId });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendGiftError(res, error);
  }
};

export const updateAdminOrderGift = async (req, res) => {
  try {
    const order = await replaceAdminOrderGift({
      orderId: req.params.orderId,
      inventoryId: req.body?.inventoryId,
      actorContext: getAdminActorContext(req),
    });
    return res.json({ success: true, message: "Order gift updated before packing.", order });
  } catch (error) {
    return sendGiftError(res, error);
  }
};

export const saveGiftEntry = async (req, res) => {
  try {
    const actorContext = getAdminActorContext(req);
    const gift = await prisma.$transaction((tx) => saveGiftCatalog(req.body || {}, tx, actorContext));
    return res.json({ success: true, message: "Gift catalog item saved.", gift });
  } catch (error) {
    return sendGiftError(res, error);
  }
};

export const deleteGiftEntry = async (req, res) => {
  try {
    const actorContext = getAdminActorContext(req);
    const gift = await prisma.$transaction((tx) => archiveGiftCatalog({
      giftId: req.params.id,
      actorContext,
      client: tx,
    }));
    return res.json({ success: true, message: "Gift catalog item archived.", gift });
  } catch (error) {
    return sendGiftError(res, error);
  }
};

export const getTierConfigs = async (req, res) => {
  try {
    const tiers = await listLoyaltyTierConfigs();
    res.json({ success: true, tiers });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export const saveTierConfig = async (req, res) => {
  try {
    const actorContext = getAdminActorContext(req);
    const config = await prisma.$transaction((tx) => saveLoyaltyTierConfig(req.body || {}, tx, actorContext));
    return res.json({ success: true, message: "Gift tier configuration saved.", config });
  } catch (error) {
    return sendGiftError(res, error);
  }
};

export const archiveTierConfig = async (req, res) => {
  try {
    const config = await prisma.$transaction((tx) => archiveOrderValueGiftRule({
      ruleId: req.params.id,
      actorContext: getAdminActorContext(req),
      client: tx,
    }));
    return res.json({ success: true, message: "Order-value gift rule archived.", config });
  } catch (error) {
    return sendGiftError(res, error);
  }
};

export const createDistributorGiftDistribution = async (req, res) => {
  try {
    const inventory = await assignGiftToDistributor({
      ...(req.body || {}),
      actorContext: getAdminActorContext(req),
    });
    return res.json({ success: true, message: "Gift stock assigned to distributor.", inventory });
  } catch (error) {
    return sendGiftError(res, error);
  }
};

export const getManufacturerGiftQueue = async (req, res) => {
  try {
    const inventory = await getManufacturerGiftInventory(req.manufacturerId);
    res.json({ success: true, inventory });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export const respondToGiftQueue = async (req, res) => {
  try {
    const inventory = await respondToGiftAllocation({
      inventoryId: req.params.id,
      manufacturerId: req.manufacturerId,
      decision: req.body.decision,
      notes: req.body.notes,
    });
    res.json({ success: true, message: "Manufacturer gift response recorded.", inventory });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export const getManufacturerOrderGiftOptions = async (req, res) => {
  try {
    const result = await getEligibleManufacturerGiftOptions({
      orderId: req.params.orderId,
      manufacturerId: req.manufacturerId,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export const getDistributorGiftQueue = async (req, res) => {
  try {
    const inventory = await getDistributorGiftInventory(req.distributorId);
    res.json({ success: true, inventory });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export const respondToDistributorGiftQueue = async (req, res) => {
  try {
    const inventory = await respondToDistributorGiftAllocation({
      inventoryId: req.params.id,
      distributorId: req.distributorId,
      decision: req.body.decision,
      receivedQuantity: req.body.receivedQuantity,
      notes: req.body.notes,
    });
    res.json({ success: true, message: "Distributor gift response recorded.", inventory });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export const getDistributorOrderGiftOptions = async (req, res) => {
  try {
    const result = await getDistributorGiftOptions({
      orderId: req.params.orderId,
      distributorId: req.distributorId,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export const markGiftReturned = async (req, res) => {
  try {
    if (typeof req.body.giftReturned !== "boolean") {
      return res.status(400).json({ success: false, message: "Explicitly indicate whether the gift was returned intact." });
    }
    const result = await onOrderReturned(req.params.orderId, {
      giftReturned: req.body.giftReturned,
      notes: req.body.notes,
      expectedManufacturerId: req.auth?.role === "MANUFACTURER" ? req.manufacturerId : undefined,
    });
    res.json({ success: true, result });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export const markDistributorGiftReturned = async (req, res) => {
  try {
    if (typeof req.body.giftReturned !== "boolean") {
      return res.status(400).json({ success: false, message: "Explicitly indicate whether the gift was returned intact." });
    }
    const result = await onOrderReturned(req.params.orderId, {
      giftReturned: req.body.giftReturned,
      notes: req.body.notes,
      expectedDistributorId: req.distributorId,
    });
    res.json({ success: true, result });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};
