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
  sameProvinceDoorToDoorFee: 120,
  sameProvinceDoorToHubFee: 120,
  differentProvinceDoorToDoorFee: 120,
  differentProvinceDoorToHubFee: 120,
  routeOverrides: [],
  splitShipmentFee: 200,
  splitShipmentDoorToDoorFee: 200,
  splitShipmentDoorToHubFee: 200,
  freeShippingMin: 0,
  ncmReturnSettlementRate: 0,
  ncmExchangeSettlementRate: 0,
  distributorReturnSettlementRate: 0,
  distributorExchangeSettlementRate: 0,
  customerReturnChargeRate: 0,
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
  deliveryType = "Door2Door",
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
  const requestedDeliveryType = String(deliveryType || "Door2Door");
  if (!["Door2Door", "Door2Branch"].includes(requestedDeliveryType)) {
    throw Object.assign(new Error("Choose door-to-door or door-to-hub delivery."), {
      status: 400,
      code: "INVALID_DELIVERY_TYPE",
    });
  }

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
        status: allocation.code === "PRICE_PRODUCT_NOT_FOUND" ? 404 : 409,
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
    const deliveryOptionsAvailable = splitShipments.some(({ distributor }) =>
      !isSameDistrict(distributor.district, district)
    );
    const resolvedDeliveryType = deliveryOptionsAvailable ? requestedDeliveryType : "Door2Door";
    const feeForDeliveryType = (type) => {
      const configuredFee = type === "Door2Branch"
        ? Number(config.splitShipmentDoorToHubFee ?? config.splitShipmentFee ?? DEFAULT_CONFIG.splitShipmentFee)
        : Number(config.splitShipmentDoorToDoorFee ?? config.splitShipmentFee ?? DEFAULT_CONFIG.splitShipmentFee);
      return freeMin > 0 && itemsTotal >= freeMin ? 0 : configuredFee;
    };
    const deliveryOptions = deliveryOptionsAvailable
      ? [
          { type: "Door2Door", label: "Door to door", fee: feeForDeliveryType("Door2Door") },
          { type: "Door2Branch", label: "Door to hub", fee: feeForDeliveryType("Door2Branch") },
        ]
      : [];
    const isFreeShipping = freeMin > 0 && itemsTotal >= freeMin;
    const fee = feeForDeliveryType(resolvedDeliveryType);
    return {
      fee,
      tier: isFreeShipping ? "FREE_SHIPPING" : "SPLIT_SHIPMENT",
      rateTier: "SPLIT_SHIPMENT",
      label: isFreeShipping ? "Free Split Delivery" : "Split Delivery",
      splitShipment: true,
      deliveryType: resolvedDeliveryType,
      deliveryOptionsAvailable,
      deliveryOptions,
      shipmentCount: splitShipments.reduce((count, { items: shipmentItems }) =>
        count + new Set(shipmentItems.map((item) => item.productId)).size, 0),
      splitShipmentFee: fee,
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
      const deliveryOptionsAvailable = !routeRate.hasLocalHub;
      const resolvedDeliveryType = deliveryOptionsAvailable ? requestedDeliveryType : "Door2Door";
      const feeForDeliveryType = (type) => {
        if (routeRate.hasLocalHub || routeRate.tier === "ROUTE_OVERRIDE") return routeRate.fee;
        const sameProvince = routeRate.origin.province === routeRate.destination.province;
        const configuredFee = sameProvince
          ? type === "Door2Branch"
            ? Number(config.sameProvinceDoorToHubFee ?? config.sameProvinceFee ?? diffFee)
            : Number(config.sameProvinceDoorToDoorFee ?? config.sameProvinceFee ?? diffFee)
          : type === "Door2Branch"
            ? Number(config.differentProvinceDoorToHubFee ?? config.differentProvinceFee ?? diffFee)
            : Number(config.differentProvinceDoorToDoorFee ?? config.differentProvinceFee ?? diffFee);
        const isFreeShipping = freeMin > 0 && itemsTotal >= freeMin;
        return isFreeShipping ? 0 : Math.max(0, configuredFee);
      };
      const deliveryOptions = deliveryOptionsAvailable
        ? [
            { type: "Door2Door", label: "Door to door", fee: feeForDeliveryType("Door2Door") },
            { type: "Door2Branch", label: "Door to hub", fee: feeForDeliveryType("Door2Branch") },
          ]
        : [];
      return {
        ...routeRate,
        fee: feeForDeliveryType(resolvedDeliveryType),
        tier: freeMin > 0 && itemsTotal >= freeMin ? "FREE_SHIPPING" : routeRate.rateTier,
        label: freeMin > 0 && itemsTotal >= freeMin ? "Free Delivery" : routeRate.label,
        hasLocalHub: routeRate.hasLocalHub,
        deliveryType: resolvedDeliveryType,
        deliveryOptionsAvailable,
        deliveryOptions,
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
    const deliveryType = req.query.deliveryType || req.body.deliveryType || "Door2Door";
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
      deliveryType,
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
      ncmReturnSettlementRate,
      ncmExchangeSettlementRate,
      distributorReturnSettlementRate,
      distributorExchangeSettlementRate,
      customerReturnChargeRate,
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
      ...(req.body.sameProvinceDoorToDoorFee !== undefined ? [Number(req.body.sameProvinceDoorToDoorFee)] : []),
      ...(req.body.sameProvinceDoorToHubFee !== undefined ? [Number(req.body.sameProvinceDoorToHubFee)] : []),
      ...(req.body.differentProvinceDoorToDoorFee !== undefined ? [Number(req.body.differentProvinceDoorToDoorFee)] : []),
      ...(req.body.differentProvinceDoorToHubFee !== undefined ? [Number(req.body.differentProvinceDoorToHubFee)] : []),
      ...(req.body.splitShipmentDoorToDoorFee !== undefined ? [Number(req.body.splitShipmentDoorToDoorFee)] : []),
      ...(req.body.splitShipmentDoorToHubFee !== undefined ? [Number(req.body.splitShipmentDoorToHubFee)] : []),
      ...(sameProvinceFee !== undefined ? [Number(sameProvinceFee)] : []),
      ...(differentProvinceFee !== undefined ? [Number(differentProvinceFee)] : []),
      ...(splitShipmentFee !== undefined ? [Number(splitShipmentFee)] : []),
      ...(freeShippingMin !== undefined ? [Number(freeShippingMin)] : []),
      ...(ncmReturnSettlementRate !== undefined ? [Number(ncmReturnSettlementRate)] : []),
      ...(ncmExchangeSettlementRate !== undefined ? [Number(ncmExchangeSettlementRate)] : []),
      ...(distributorReturnSettlementRate !== undefined ? [Number(distributorReturnSettlementRate)] : []),
      ...(distributorExchangeSettlementRate !== undefined ? [Number(distributorExchangeSettlementRate)] : []),
      ...(customerReturnChargeRate !== undefined ? [Number(customerReturnChargeRate)] : []),
    ];
    if ([...Object.values(numericRates), ...optionalRates].some((value) => !Number.isFinite(value) || value < 0)) {
      return res.status(400).json({ success: false, message: "Shipping rates and the free-delivery threshold must be non-negative numbers." });
    }
    if (customerReturnChargeRate !== undefined && Number(customerReturnChargeRate) > 100) {
      return res.status(400).json({ success: false, message: "Customer return charge must be between 0 and 100 percent." });
    }
    const updatedData = {
      ...numericRates,
      ...(req.body.sameProvinceDoorToDoorFee !== undefined && { sameProvinceDoorToDoorFee: Number(req.body.sameProvinceDoorToDoorFee) }),
      ...(req.body.sameProvinceDoorToHubFee !== undefined && { sameProvinceDoorToHubFee: Number(req.body.sameProvinceDoorToHubFee) }),
      ...(req.body.differentProvinceDoorToDoorFee !== undefined && { differentProvinceDoorToDoorFee: Number(req.body.differentProvinceDoorToDoorFee) }),
      ...(req.body.differentProvinceDoorToHubFee !== undefined && { differentProvinceDoorToHubFee: Number(req.body.differentProvinceDoorToHubFee) }),
      ...(req.body.splitShipmentDoorToDoorFee !== undefined && { splitShipmentDoorToDoorFee: Number(req.body.splitShipmentDoorToDoorFee) }),
      ...(req.body.splitShipmentDoorToHubFee !== undefined && { splitShipmentDoorToHubFee: Number(req.body.splitShipmentDoorToHubFee) }),
    };
    if (sameProvinceFee !== undefined) updatedData.sameProvinceFee = Number(sameProvinceFee);
    if (differentProvinceFee !== undefined) updatedData.differentProvinceFee = Number(differentProvinceFee);
    if (splitShipmentFee !== undefined) updatedData.splitShipmentFee = Number(splitShipmentFee);
    if (freeShippingMin !== undefined) updatedData.freeShippingMin = Number(freeShippingMin);
    if (ncmReturnSettlementRate !== undefined) updatedData.ncmReturnSettlementRate = Number(ncmReturnSettlementRate);
    if (ncmExchangeSettlementRate !== undefined) updatedData.ncmExchangeSettlementRate = Number(ncmExchangeSettlementRate);
    if (distributorReturnSettlementRate !== undefined) updatedData.distributorReturnSettlementRate = Number(distributorReturnSettlementRate);
    if (distributorExchangeSettlementRate !== undefined) updatedData.distributorExchangeSettlementRate = Number(distributorExchangeSettlementRate);
    if (customerReturnChargeRate !== undefined) updatedData.customerReturnChargeRate = Number(customerReturnChargeRate);
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
