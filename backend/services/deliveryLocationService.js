import { canonicalizeNepalLocation } from "./locationPricingService.js";
import { resolveLocationEntry } from "../utils/nepalLocationData.js";

const normalizeLocationKey = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/\s+district$/i, "")
  .replace(/[^a-z0-9]/g, "");

const normalizeProvince = (value) => {
  const entry = resolveLocationEntry(value);
  return entry?.type === "PROVINCE"
    ? normalizeLocationKey(entry.name)
    : normalizeLocationKey(value);
};

const normalizeDistrict = (value) => {
  const normalizedValue = String(value || "").trim().replace(/[\s,_-]+district$/i, "").trim();
  const entry = resolveLocationEntry(normalizedValue);
  return entry?.type === "DISTRICT"
    ? normalizeLocationKey(entry.name)
    : normalizeLocationKey(normalizedValue);
};

export const getAddressProvince = (address = {}) => address?.province || address?.state || "";

const locationsMatch = (provinceA, districtA, provinceB, districtB) => {
  const locationA = canonicalizeNepalLocation(provinceA, districtA);
  const locationB = canonicalizeNepalLocation(provinceB, districtB);
  const districtKeyA = locationA
    ? normalizeLocationKey(locationA.district)
    : normalizeDistrict(districtA);
  const districtKeyB = locationB
    ? normalizeLocationKey(locationB.district)
    : normalizeDistrict(districtB);
  const provinceKeyA = locationA ? normalizeProvince(locationA.province) : normalizeProvince(provinceA);
  const provinceKeyB = locationB ? normalizeProvince(locationB.province) : normalizeProvince(provinceB);

  return Boolean(
    districtKeyA &&
    districtKeyA === districtKeyB &&
    (!provinceKeyA || !provinceKeyB || provinceKeyA === provinceKeyB)
  );
};

export const isDistributorLocalDeliveryEligible = ({ customerAddress = {}, distributor = {} } = {}) => {
  const customerProvince = getAddressProvince(customerAddress);
  const customerDistrict = customerAddress.district || "";
  const distributorLocations = [
    { province: distributor.province, district: distributor.district },
    ...(distributor.locations || []),
  ];

  if (distributorLocations.some((location) => locationsMatch(
    customerProvince,
    customerDistrict,
    location.province,
    location.district,
  ))) {
    return true;
  }

  const customerCity = normalizeLocationKey(customerAddress.city);
  const distributorCity = normalizeLocationKey(distributor.city);
  if (!customerCity || customerCity !== distributorCity) return false;

  const customerProvinceKey = normalizeProvince(customerProvince);
  const distributorProvinceKey = normalizeProvince(distributor.province);
  return Boolean(
    customerProvinceKey &&
    distributorProvinceKey &&
    customerProvinceKey === distributorProvinceKey
  );
};
