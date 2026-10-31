import {
  canonicalizeNepalLocation,
  listLocationProductDiscounts,
  listManufacturerLocationMappings,
  resolveLocationProductPrices,
  saveLocationProductDiscount,
  saveManufacturerLocationMappings,
} from "../services/locationPricingService.js";
import { getLocationLookupData } from "../services/locationLookupService.js";
import { previewDistributorAllocation } from "./orderAssignmentController.js";

const sendError = (res, error) => res.status(error.status || 400).json({
  success: false,
  code: error.code || "LOCATION_PRICING_FAILED",
  message: error.message || "Unable to process location pricing request.",
});

const toPublicPriceLine = (item) => {
  const publicItem = { ...item };
  delete publicItem.locationDiscountDistributorId;
  return publicItem;
};

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
    const { discounts, products, distributors } = await listLocationProductDiscounts();
    const { locations: locationMappings } = await getLocationLookupData();
    const locations = locationMappings.filter((entry) => entry.type !== "NATIONWIDE");
    return res.json({ success: true, discounts, products, distributors, locations });
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
    const province = req.body.province;
    const district = req.body.district;
    const location = canonicalizeNepalLocation(province, district);
    if (!location) {
      const result = await resolveLocationProductPrices({ items: req.body.items, province, district });
      return res.json({ success: true, ...result, fulfillmentConfirmed: false, locationDiscountApplied: false });
    }

    const allocation = await previewDistributorAllocation({
      address: { province: location.province, district: location.district, ncmBranch: req.body.ncmBranch || "" },
      items: req.body.items,
    });
    if (!allocation.success) {
      const result = await resolveLocationProductPrices({
        items: req.body.items,
        province: location.province,
        district: location.district,
      });
      return res.json({
        success: true,
        ...result,
        fulfillmentConfirmed: false,
        locationDiscountApplied: false,
        fulfillmentSelectionError: {
          code: allocation.code || "DISTRIBUTOR_UNAVAILABLE",
          message: allocation.message || "No distributor is currently available for this location.",
        },
      });
    }

    const shipmentGroups = allocation.splitShipments?.length
      ? allocation.splitShipments.map(({ distributor, items }) => ({
        distributor,
        items: items.map((item) => ({
          productId: item.productId,
          size: item.size,
          color: item.color,
          quantity: item.qty,
        })),
      }))
      : [{
        distributor: allocation.distributor,
        items: req.body.items,
      }];

    const pricedGroups = await Promise.all(shipmentGroups.map(async (group) => {
      const prices = await resolveLocationProductPrices({
        items: group.items,
        province: location.province,
        district: location.district,
        distributorId: group.distributor.id,
      });
      return {
        items: prices.items.map(toPublicPriceLine),
      };
    }));
    const pricedItems = pricedGroups.flatMap(({ items }) => items);
    return res.json({
      success: true,
      location,
      fulfillmentConfirmed: true,
      locationDiscountApplied: pricedItems.some((item) => item.discountSource === "LOCATION"),
      items: pricedItems,
    });
  } catch (error) {
    return sendError(res, error);
  }
};