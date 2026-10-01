import {
  listLocationProductDiscounts,
  listManufacturerLocationMappings,
  resolveLocationProductPrices,
  saveLocationProductDiscount,
  saveManufacturerLocationMappings,
} from "../services/locationPricingService.js";
import { NEPAL_LOCATION_MAP } from "../utils/nepalLocationData.js";

const sendError = (res, error) => res.status(error.status || 400).json({
  success: false,
  code: error.code || "LOCATION_PRICING_FAILED",
  message: error.message || "Unable to process location pricing request.",
});

export const getManufacturerLocations = async (_req, res) => {
  try {
    const result = await listManufacturerLocationMappings();
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};

export const updateManufacturerLocations = async (req, res) => {
  try {
    const result = await saveManufacturerLocationMappings({
      manufacturerId: req.body.manufacturerId,
      locations: req.body.locations,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getLocationDiscounts = async (_req, res) => {
  try {
    const { discounts, products } = await listLocationProductDiscounts();
    const locations = NEPAL_LOCATION_MAP.filter((entry) => entry.type !== "NATIONWIDE");
    return res.json({ success: true, discounts, products, locations });
  } catch (error) {
    return sendError(res, error);
  }
};

export const updateLocationDiscount = async (req, res) => {
  try {
    const discount = await saveLocationProductDiscount(req.body);
    return res.json({ success: true, discount });
  } catch (error) {
    return sendError(res, error);
  }
};

export const resolveProductPrices = async (req, res) => {
  try {
    const result = await resolveLocationProductPrices({
      items: req.body.items,
      province: req.body.province,
      district: req.body.district,
      eligibilityMode: req.body.eligibilityMode === "PER_ITEM" ? "PER_ITEM" : "WHOLE_BASKET",
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};