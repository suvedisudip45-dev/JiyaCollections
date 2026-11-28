import { canonicalizeNepalLocation } from "./locationPricingService.js";
import {
  compareDecimals,
  quantizeCurrencyAmount,
  serializeAccountingDecimal,
} from "./accountingDecimal.js";
import { decimalFromStoredFloat } from "./checkoutPricingService.js";

const normalizeDistrict = (district = "") => String(district || "")
  .trim()
  .toLowerCase()
  .replace(/\s+district$/i, "")
  .replace(/[^a-z0-9]/g, "");

export const isSameDistrict = (origin, destination) => {
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
    fee = decimalFromStoredFloat(override.fee, "Route shipping fee");
    tier = "ROUTE_OVERRIDE";
    label = `${origin.district} to ${destination.district}`;
  } else if (isSameDistrict(origin, destination)) {
    fee = decimalFromStoredFloat(config.sameDistrictFee ?? 50, "Same-district shipping fee");
    tier = "SAME_DISTRICT";
    label = "Within District";
  } else if (origin.province === destination.province) {
    fee = decimalFromStoredFloat(config.sameProvinceFee ?? config.differentDistrictFee ?? 120, "Same-province shipping fee");
    tier = "SAME_PROVINCE";
    label = "Within Province";
  } else {
    fee = decimalFromStoredFloat(config.differentProvinceFee ?? config.differentDistrictFee ?? 120, "Different-province shipping fee");
    tier = "DIFFERENT_PROVINCE";
    label = "Outside Province";
  }

  const freeShippingMin = decimalFromStoredFloat(config.freeShippingMin || 0, "Free-shipping minimum");
  const exactSubtotal = decimalFromStoredFloat(subtotal, "Order subtotal");
  const isFreeShipping = freeShippingMin.greaterThan(0) && compareDecimals(exactSubtotal, freeShippingMin) >= 0;
  const exactFee = quantizeCurrencyAmount(
    isFreeShipping || fee.isNegative() ? "0" : fee,
    "NPR",
  );
  return {
    fee: Number(exactFee.toString()),
    feeDecimal: serializeAccountingDecimal(exactFee),
    tier: isFreeShipping ? "FREE_SHIPPING" : tier,
    label: isFreeShipping ? "Free Delivery" : label,
    rateTier: tier,
    routeOverride: override ? {
      originDistrict: origin.district,
      destinationDistrict: destination.district,
    } : null,
    origin,
    destination,
    freeShippingMin: Number(freeShippingMin.toString()),
    sameDistrictFee: Number(decimalFromStoredFloat(config.sameDistrictFee ?? 50).toString()),
    differentDistrictFee: Number(decimalFromStoredFloat(config.differentDistrictFee ?? 120).toString()),
    sameProvinceFee: Number(decimalFromStoredFloat(config.sameProvinceFee ?? config.differentDistrictFee ?? 120).toString()),
    differentProvinceFee: Number(decimalFromStoredFloat(config.differentProvinceFee ?? config.differentDistrictFee ?? 120).toString()),
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
