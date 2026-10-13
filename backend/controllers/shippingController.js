import { prisma } from "../config/db.js";
import { previewDistributorAllocation } from "./orderAssignmentController.js";
import { normalizeShippingRouteOverrides, resolveRouteShippingRate } from "../services/shippingRateService.js";

// KTM Valley Cluster: Kathmandu, Lalitpur, Bhaktapur are treated as the same district / delivery zone
export const KTM_VALLEY_DISTRICTS = ["kathmandu", "lalitpur", "bhaktapur"];

// Helper to normalize district names
export const normalizeDistrict = (district = "") => {
  if (!district || typeof district !== "string") return "";
  return district
    .trim()
    .toLowerCase()
    .replace(/\s+district$/i, "")
    .trim();
};

// Check if two districts are within the same shipping zone (including KTM cluster)
export const isSameDistrict = (districtA, districtB) => {
  const normA = normalizeDistrict(districtA);
  const normB = normalizeDistrict(districtB);

  if (!normA && !normB) return true;
  if (!normA || !normB) return false;

  // Direct match
  if (normA === normB) return true;

  // Kathmandu Valley cluster (Kathmandu + Lalitpur + Bhaktapur)
  if (KTM_VALLEY_DISTRICTS.includes(normA) && KTM_VALLEY_DISTRICTS.includes(normB)) {
    return true;
  }

  return false;
};

// Default fallback configuration
const DEFAULT_CONFIG = {
  id: "default",
  sameDistrictFee: 50,
  differentDistrictFee: 120,
  sameProvinceFee: 120,
  differentProvinceFee: 120,
  routeOverrides: [],
  splitShipmentFee: 200,
  freeShippingMin: 0,
};

// Checkout routes use the selected distributor origin; older callers retain district-only rates.
export const resolveDistrictShippingFee = async ({
  district,
  province = "",
  subtotal = 0,
  items = [],
  ncmBranch = "",
  originDistrict = "",
  originProvince = "",
}) => {
  let config = await prisma.shippingConfig.findFirst();
  if (!config) {
    config = await prisma.shippingConfig.create({
      data: DEFAULT_CONFIG,
    });
  }

  const itemsTotal = Math.max(0, Number(subtotal) || 0);
  const freeMin = Number(config.freeShippingMin || 0);
  const sameFee = Number(config.sameDistrictFee ?? 50);
  const diffFee = Number(config.differentDistrictFee ?? 120);

  let routeOrigin = { district: originDistrict, province: originProvince };
  let probableDistributor = null;
  let splitShipments = null;
  if (Array.isArray(items) && items.length > 0) {
    const allocation = await previewDistributorAllocation({
      address: { district, province, ncmBranch },
      items,
    });
    if (!allocation.success) {
      throw Object.assign(new Error(allocation.message || "No distributor is currently available for this delivery location."), {
        status: 409,
        code: allocation.code || "DISTRIBUTOR_UNAVAILABLE",
        stockShortages: allocation.stockShortages,
      });
    }
    if (allocation.splitShipments?.length > 1) {
      splitShipments = allocation.splitShipments.map(({ distributor, items: shipmentItems }) => ({
        distributor,
        items: shipmentItems,
      }));
    } else {
      probableDistributor = {
        id: allocation.distributor.id,
        name: allocation.distributor.name,
        district: allocation.distributor.district,
        province: allocation.distributor.province,
      };
      routeOrigin = {
        district: probableDistributor.district,
        province: probableDistributor.province,
      };
    }
  }
  if (splitShipments) {
    const isFreeShipping = freeMin > 0 && itemsTotal >= freeMin;
    return {
      fee: isFreeShipping ? 0 : Number(config.splitShipmentFee ?? DEFAULT_CONFIG.splitShipmentFee),
      tier: isFreeShipping ? "FREE_SHIPPING" : "SPLIT_SHIPMENT",
      rateTier: "SPLIT_SHIPMENT",
      label: isFreeShipping ? "Free Split Delivery" : "Split Delivery",
      splitShipment: true,
      shipmentCount: splitShipments.reduce((count, { items: shipmentItems }) =>
        count + new Set(shipmentItems.map((item) => item.productId)).size, 0),
      splitShipmentFee: Number(config.splitShipmentFee ?? DEFAULT_CONFIG.splitShipmentFee),
      shipments: splitShipments.map(({ distributor, items: shipmentItems }) => ({
        distributor,
        items: shipmentItems,
        origin: {
          district: distributor.district,
          province: distributor.province,
        },
      })),
      destination: { district, province },
      freeShippingMin: freeMin,
      probableDistributor: null,
    };
  }
  if (routeOrigin.district && routeOrigin.province) {
    const routeRate = resolveRouteShippingRate({
      originDistrict: routeOrigin.district,
      originProvince: routeOrigin.province,
      destinationDistrict: district,
      destinationProvince: province,
      subtotal: itemsTotal,
      config: {
        ...DEFAULT_CONFIG,
        ...config,
        sameDistrictFee: sameFee,
        differentDistrictFee: diffFee,
      },
    });
    if (routeRate) {
      return {
        ...routeRate,
        hasLocalHub: routeRate.hasLocalHub,
        probableDistributor,
      };
    }
  }
  if (Array.isArray(items) && items.length > 0) {
    throw Object.assign(new Error("The selected distributor does not have a valid shipping origin configured."), {
      status: 409,
      code: "DISTRIBUTOR_LOCATION_UNAVAILABLE",
    });
  }

  // Check free shipping threshold
  if (freeMin > 0 && itemsTotal >= freeMin) {
    return {
      fee: 0,
      tier: "FREE_SHIPPING",
      label: "Free Delivery",
      sameDistrictFee: sameFee,
      differentDistrictFee: diffFee,
      freeShippingMin: freeMin,
      hasLocalHub: true,
      probableDistributor,
    };
  }

  const customerDist = normalizeDistrict(district);

  if (!customerDist) {
    return {
      fee: diffFee,
      tier: "DIFFERENT_DISTRICT",
      label: "Standard Delivery",
      sameDistrictFee: sameFee,
      differentDistrictFee: diffFee,
      freeShippingMin: freeMin,
      hasLocalHub: false,
    };
  }

  // Fetch active manufacturers across Nepal and map them to their operational districts
  let hasLocalManufacturer = false;

  try {
    const manufacturers = await prisma.manufacturer.findMany({
      where: { isActive: true },
      select: { city: true, ncmPickupBranch: true },
    });

    const branchLookupKeys = [
      ...manufacturers.map((m) => m.ncmPickupBranch).filter(Boolean),
      ...manufacturers.map((m) => m.city).filter(Boolean),
    ];

    const matchedBranches = await prisma.ncmBranch.findMany({
      where: {
        name: { in: branchLookupKeys },
      },
      select: { name: true, districtName: true },
    });

    const manufacturerDistricts = new Set();
    manufacturers.forEach((m) => {
      if (m.city) manufacturerDistricts.add(normalizeDistrict(m.city));
    });
    matchedBranches.forEach((b) => {
      if (b.districtName) manufacturerDistricts.add(normalizeDistrict(b.districtName));
    });

    const isCustomerInKtmValley = KTM_VALLEY_DISTRICTS.includes(customerDist);

    if (isCustomerInKtmValley) {
      // For KTM Valley recipients, any active manufacturer in Kathmandu, Lalitpur, or Bhaktapur counts as a local hub
      hasLocalManufacturer = Array.from(manufacturerDistricts).some((md) =>
        KTM_VALLEY_DISTRICTS.includes(md)
      );
    } else {
      // For other districts, check if an active manufacturer exists in the recipient's district
      hasLocalManufacturer = Array.from(manufacturerDistricts).some((md) =>
        isSameDistrict(md, customerDist)
      );
    }
  } catch (err) {
    console.error("Error querying manufacturers for shipping rate:", err);
  }

  let fee = diffFee;
  let tier = "DIFFERENT_DISTRICT";
  let label = "Outside District";

  if (hasLocalManufacturer) {
    fee = sameFee;
    tier = "SAME_DISTRICT";
    label = "Within District";
  } else {
    fee = diffFee;
    tier = "DIFFERENT_DISTRICT";
    label = "Outside District";
  }

  return {
    fee,
    tier,
    label,
    sameDistrictFee: sameFee,
    differentDistrictFee: diffFee,
    freeShippingMin: freeMin,
    hasLocalHub: hasLocalManufacturer,
  };
};

// Calculate shipping fee endpoint (Public API for frontend preview)
export const calculateShippingFee = async (req, res) => {
  try {
    const district = req.query.district || req.body.district || "";
    const province = req.query.province || req.body.province || "";
    const subtotal = req.query.subtotal || req.body.subtotal || 0;
    const items = req.body.items || [];
    const ncmBranch = req.query.ncmBranch || req.body.ncmBranch || "";
    const originDistrict = req.query.originDistrict || req.body.originDistrict || "";
    const originProvince = req.query.originProvince || req.body.originProvince || "";
    if (!Array.isArray(items) || items.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Shipping quotes accept no more than 100 cart lines.",
      });
    }
    if (items.some((item) =>
      !String(item?.productId || item?._id || item?.id || "").trim() ||
      !Number.isSafeInteger(Number(item?.quantity ?? 1)) ||
      Number(item?.quantity ?? 1) < 1
    )) {
      return res.status(400).json({
        success: false,
        message: "Every shipping quote line requires a product ID and positive whole-number quantity.",
      });
    }

    const result = await resolveDistrictShippingFee({
      district,
      province,
      subtotal,
      items,
      ncmBranch,
      originDistrict,
      originProvince,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    if (error.status && error.status < 500) {
      console.warn("Shipping quote unavailable:", {
        code: error.code || "SHIPPING_QUOTE_UNAVAILABLE",
        message: error.message,
      });
    } else {
      console.error("Error calculating shipping fee:", error);
    }
    res.status(error.status || 500).json({
      success: false,
      code: error.code || "SHIPPING_QUOTE_FAILED",
      message: error.message,
      ...(error.stockShortages && { stockShortages: error.stockShortages }),
    });
  }
};

// Get current active shipping configuration (Public)
export const getShippingConfig = async (req, res) => {
  try {
    let config = await prisma.shippingConfig.findFirst();
    if (!config) {
      config = await prisma.shippingConfig.create({
        data: DEFAULT_CONFIG,
      });
    }
    res.json({ success: true, config });
  } catch (error) {
    console.error("Error fetching shipping config:", error);
    res.json({ success: false, message: error.message, config: DEFAULT_CONFIG });
  }
};

// Update shipping configuration (Admin only)
export const updateShippingConfig = async (req, res) => {
  try {
    const {
      sameDistrictFee,
      sameCityFee,
      differentDistrictFee,
      differentCityFee,
      sameProvinceFee,
      differentProvinceFee,
      splitShipmentFee,
      routeOverrides,
      freeShippingMin,
    } = req.body;

    const sameFeeVal = sameDistrictFee !== undefined ? sameDistrictFee : sameCityFee;
    const diffFeeVal = differentDistrictFee !== undefined ? differentDistrictFee : differentCityFee;

    if (sameFeeVal === undefined || diffFeeVal === undefined) {
      return res.json({
        success: false,
        message: "Within-district delivery fee and outside-district delivery fee are required.",
      });
    }

    const numericRates = {
      sameDistrictFee: Number(sameFeeVal),
      differentDistrictFee: Number(diffFeeVal),
    };
    const optionalRates = [
      ...(sameProvinceFee !== undefined ? [Number(sameProvinceFee)] : []),
      ...(differentProvinceFee !== undefined ? [Number(differentProvinceFee)] : []),
      ...(splitShipmentFee !== undefined ? [Number(splitShipmentFee)] : []),
      ...(freeShippingMin !== undefined ? [Number(freeShippingMin)] : []),
    ];
    if ([...Object.values(numericRates), ...optionalRates].some((value) => !Number.isFinite(value) || value < 0)) {
      return res.status(400).json({ success: false, message: "Shipping rates and the free-delivery threshold must be non-negative numbers." });
    }
    const updatedData = {
      ...numericRates,
    };
    if (sameProvinceFee !== undefined) updatedData.sameProvinceFee = Number(sameProvinceFee);
    if (differentProvinceFee !== undefined) updatedData.differentProvinceFee = Number(differentProvinceFee);
    if (splitShipmentFee !== undefined) updatedData.splitShipmentFee = Number(splitShipmentFee);
    if (freeShippingMin !== undefined) updatedData.freeShippingMin = Number(freeShippingMin);
    if (routeOverrides !== undefined) updatedData.routeOverrides = normalizeShippingRouteOverrides(routeOverrides);

    const existing = await prisma.shippingConfig.findFirst();

    let config;
    if (existing) {
      config = await prisma.shippingConfig.update({
        where: { id: existing.id },
        data: updatedData,
      });
    } else {
      config = await prisma.shippingConfig.create({
        data: {
          id: "default",
          ...updatedData,
        },
      });
    }

    res.json({
      success: true,
      message: "Shipping rates updated successfully.",
      config,
    });
  } catch (error) {
    console.error("Error updating shipping config:", error);
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    res.json({ success: false, message: error.message });
  }
};
