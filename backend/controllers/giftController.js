import { prisma } from "../config/db.js";
import {
  listGiftCatalog,
  saveGiftCatalog,
  listLoyaltyTierConfigs,
  saveLoyaltyTierConfig,
  assignGiftToManufacturer,
  getEligibleManufacturerGiftOptions,
  getManufacturerGiftInventory,
  respondToGiftAllocation,
  onOrderReturned,
} from "../services/giftService.js";

export const getGiftCatalog = async (req, res) => {
  try {
    const gifts = await listGiftCatalog();
    res.json({ success: true, gifts });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export const saveGiftEntry = async (req, res) => {
  try {
    const gift = await saveGiftCatalog(req.body || {});
    res.json({ success: true, message: "Gift catalog item saved.", gift });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export const deleteGiftEntry = async (req, res) => {
  try {
    await prisma.giftCatalog.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, message: "Gift catalog item archived." });
  } catch (error) {
    res.json({ success: false, message: error.message });
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
    const config = await saveLoyaltyTierConfig(req.body || {});
    res.json({ success: true, message: "Gift tier configuration saved.", config });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

export const createManufacturerGiftDistribution = async (req, res) => {
  try {
    const inventory = await assignGiftToManufacturer(req.body || {});
    res.json({ success: true, message: "Gift stock assigned to manufacturer.", inventory });
  } catch (error) {
    res.json({ success: false, message: error.message });
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
