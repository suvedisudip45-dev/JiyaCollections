import { prisma } from "../config/db.js";

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
  freeShippingMin: 0,
};

// Resolve district shipping rate authoritative calculation based purely on active manufacturer hub locations
export const resolveDistrictShippingFee = async ({ district, province = "", subtotal = 0 }) => {
  let config = await prisma.shippingConfig.findFirst();
  if (!config) {
    config = await prisma.shippingConfig.create({
      data: DEFAULT_CONFIG,
    });
  }

  const itemsTotal = Math.max(0, Number(subtotal) || 0);
  const freeMin = Number(config.freeShippingMin || 0);
  const sameFee = Number(config.sameDistrictFee || 50);
  const diffFee = Number(config.differentDistrictFee || 120);

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

    const result = await resolveDistrictShippingFee({ district, province, subtotal });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Error calculating shipping fee:", error);
    res.json({
      success: false,
      message: error.message,
      fee: 120,
      tier: "DIFFERENT_DISTRICT",
      label: "Outside District Delivery",
      sameDistrictFee: 50,
      differentDistrictFee: 120,
      hasLocalHub: false,
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

    const updatedData = {
      sameDistrictFee: Math.max(0, Number(sameFeeVal)),
      differentDistrictFee: Math.max(0, Number(diffFeeVal)),
      freeShippingMin: freeShippingMin !== undefined ? Math.max(0, Number(freeShippingMin)) : 0,
    };

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
    res.json({ success: false, message: error.message });
  }
};
