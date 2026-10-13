import { canonicalizeNepalLocation } from "./locationPricingService.js";

const normalizeDistrict = (district = "") => String(district || "")
  .trim()
  .toLowerCase()
  .replace(/\s+district$/i, "")
  .replace(/[^a-z0-9]/g, "");

const isSameDistrict = (origin, destination) => {
  const originDistrict = normalizeDistrict(origin.district);
  const destinationDistrict = normalizeDistrict(destination.district);
  const valleyDistricts = new Set(["kathmandu", "lalitpur", "bhaktapur"]);
  return originDistrict === destinationDistrict ||
    (valleyDistricts.has(originDistrict) && valleyDistricts.has(destinationDistrict));
};

const getRouteOverride = (routeOverrides, origin, destination) => {
  if (!Array.isArray(routeOverrides)) return null;
  return routeOverrides.find((override) =>
    String(override.originProvince || "").toLowerCase() === origin.province.toLowerCase() &&
    normalizeDistrict(override.originDistrict) === normalizeDistrict(origin.district) &&
    String(override.destinationProvince || "").toLowerCase() === destination.province.toLowerCase() &&
    normalizeDistrict(override.destinationDistrict) === normalizeDistrict(destination.district)
  ) || null;
};

export const resolveRouteShippingRate = ({
  originProvince,
  originDistrict,
  destinationProvince,
  destinationDistrict,
  subtotal = 0,
  config,
}) => {
  const origin = canonicalizeNepalLocation(originProvince, originDistrict);
  const destination = canonicalizeNepalLocation(destinationProvince, destinationDistrict);
  if (!origin || !destination) return null;

  const override = getRouteOverride(config.routeOverrides, origin, destination);
  let fee;
  let tier;
  let label;
  if (override) {
    fee = Number(override.fee);
    tier = "ROUTE_OVERRIDE";
    label = `${origin.district} to ${destination.district}`;
  } else if (isSameDistrict(origin, destination)) {
    fee = Number(config.sameDistrictFee ?? 50);
    tier = "SAME_DISTRICT";
    label = "Within District";
  } else if (origin.province === destination.province) {
    fee = Number(config.sameProvinceFee ?? config.differentDistrictFee ?? 120);
    tier = "SAME_PROVINCE";
    label = "Within Province";
  } else {
    fee = Number(config.differentProvinceFee ?? config.differentDistrictFee ?? 120);
    tier = "DIFFERENT_PROVINCE";
    label = "Outside Province";
  }

  const freeShippingMin = Math.max(0, Number(config.freeShippingMin || 0));
  const isFreeShipping = freeShippingMin > 0 && Math.max(0, Number(subtotal) || 0) >= freeShippingMin;
  return {
    fee: isFreeShipping ? 0 : Math.max(0, fee),
    tier: isFreeShipping ? "FREE_SHIPPING" : tier,
    label: isFreeShipping ? "Free Delivery" : label,
    rateTier: tier,
    routeOverride: override ? {
      originDistrict: origin.district,
      destinationDistrict: destination.district,
    } : null,
    origin,
    destination,
    freeShippingMin,
    sameDistrictFee: Number(config.sameDistrictFee ?? 50),
    differentDistrictFee: Number(config.differentDistrictFee ?? 120),
    sameProvinceFee: Number(config.sameProvinceFee ?? config.differentDistrictFee ?? 120),
    differentProvinceFee: Number(config.differentProvinceFee ?? config.differentDistrictFee ?? 120),
    hasLocalHub: isSameDistrict(origin, destination),
  };
};

export const normalizeShippingRouteOverrides = (routeOverrides) => {
  if (!Array.isArray(routeOverrides) || routeOverrides.length > 50) {
    throw Object.assign(new Error("Provide no more than 50 route overrides."), { status: 400 });
  }
  const normalized = routeOverrides.map((override) => {
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      throw Object.assign(new Error("Each route override must be an object."), { status: 400 });
    }
    const origin = canonicalizeNepalLocation(override.originProvince, override.originDistrict);
    const destination = canonicalizeNepalLocation(override.destinationProvince, override.destinationDistrict);
    const fee = Number(override.fee);
    if (!origin || !destination || !Number.isFinite(fee) || fee < 0) {
      throw Object.assign(new Error("Each route override requires valid origin and destination districts and a non-negative fee."), { status: 400 });
    }
    return {
      originProvince: origin.province,
      originDistrict: origin.district,
      destinationProvince: destination.province,
      destinationDistrict: destination.district,
      fee,
    };
  });
  const keys = normalized.map((route) =>
    `${route.originProvince.toLowerCase()}:${normalizeDistrict(route.originDistrict)}:${route.destinationProvince.toLowerCase()}:${normalizeDistrict(route.destinationDistrict)}`
  );
  if (new Set(keys).size !== keys.length) {
    throw Object.assign(new Error("Route overrides must have unique origin and destination districts."), { status: 400 });
  }
  return normalized;
};
