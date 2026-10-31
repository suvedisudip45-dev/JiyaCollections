import { prisma } from "../config/db.js";
import { resolveLocationEntry } from "../utils/nepalLocationData.js";
import { getLocationLookupData } from "./locationLookupService.js";

const cleanKey = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const LOCATION_ALIASES = new Map([
  ["nawalparasieast", "Nawalpur"],
  ["nawalparasiwest", "Parasi"],
]);
const PROVINCE_ALIASES = new Set(["province1", "province2", "province3", "province4", "province5", "province6", "province7"]);

export const canonicalizeNepalLocation = (provinceValue, districtValue) => {
  const provinceEntry = resolveLocationEntry(provinceValue);
  const normalizedDistrict = String(districtValue || "").trim().replace(/[\s,_-]+district$/i, "").trim();
  const districtAlias = LOCATION_ALIASES.get(cleanKey(normalizedDistrict));
  const districtEntry = districtAlias
    ? resolveLocationEntry(districtAlias)
    : resolveLocationEntry(normalizedDistrict);
  if (!provinceEntry || provinceEntry.type !== "PROVINCE" || !districtEntry || districtEntry.type !== "DISTRICT") return null;

  const provinceMatches = cleanKey(provinceEntry.name) === cleanKey(provinceValue) ||
    cleanKey(provinceEntry.code) === cleanKey(provinceValue) ||
    PROVINCE_ALIASES.has(cleanKey(provinceValue));
  const districtMatches = cleanKey(districtEntry.name) === cleanKey(normalizedDistrict) ||
    cleanKey(districtEntry.code) === cleanKey(normalizedDistrict) ||
    Boolean(districtAlias);
  if (!provinceMatches || !districtMatches || cleanKey(districtEntry.province) !== cleanKey(provinceEntry.name)) return null;
  return { province: provinceEntry.name, district: districtEntry.name };
};

export const resolveEffectiveProductDiscount = ({ productDiscount, locationDiscount, hasLocationRule }) => {
  const globalPercentage = Math.min(100, Math.max(0, Number(productDiscount || 0)));
  const localPercentage = Number(locationDiscount);
  if (hasLocationRule && Number.isFinite(localPercentage) && localPercentage >= 0 && localPercentage <= 100) {
    return { percentage: localPercentage, source: "LOCATION" };
  }
  return { percentage: globalPercentage, source: globalPercentage > 0 ? "PRODUCT" : "BASE" };
};

export const selectLocationProductRule = (rules, distributorId) =>
  rules.find((rule) => rule.distributorId && rule.distributorId === distributorId) ||
  rules.find((rule) => !rule.distributorId) ||
  null;

const normalizeRequestItems = (items = []) => items.map((item) => ({
  productId: String(item.productId || item._id || item.id || "").trim(),
  size: String(item.size || "").trim(),
  color: String(item.color || "").trim(),
  quantity: Math.max(1, Math.floor(Number(item.quantity || 1))),
}));

const validateInputItems = (items) => {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw Object.assign(new Error("Provide between 1 and 100 product lines for price resolution."), { code: "INVALID_PRICE_ITEMS", status: 400 });
  }
  const normalized = normalizeRequestItems(items);
  if (normalized.some((item) => !item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0)) {
    throw Object.assign(new Error("Every price line requires a product ID and positive whole-number quantity."), { code: "INVALID_PRICE_ITEMS", status: 400 });
  }
  return normalized;
};

export const resolveLocationProductPrices = async ({
  items,
  province: provinceValue,
  district: districtValue,
  distributorId = null,
  client = prisma,
}) => {
  const normalizedItems = validateInputItems(items);
  const location = canonicalizeNepalLocation(provinceValue, districtValue);
  const productIds = [...new Set(normalizedItems.map((item) => item.productId))];
  const products = await client.product.findMany({ where: { id: { in: productIds } } });
  const productMap = new Map(products.map((product) => [product.id, product]));
  const missingProductId = productIds.find((productId) => !productMap.has(productId));
  if (missingProductId) {
    throw Object.assign(new Error(`Product not found: ${missingProductId}`), { code: "PRICE_PRODUCT_NOT_FOUND", status: 404 });
  }

  if (!location) {
    return {
      location: null,
      locationDiscountDistributorId: null,
      items: normalizedItems.map((item) => {
        const product = productMap.get(item.productId);
        const percentage = Number(product.discount || 0);
        return buildResolvedLine(item, product, percentage, percentage > 0 ? "PRODUCT" : "BASE", null, null);
      }),
    };
  }

  const discountRules = await client.locationProductDiscount.findMany({
    where: {
      productId: { in: productIds },
      province: location.province,
      district: location.district,
      isActive: true,
      ...(distributorId
        ? { OR: [{ distributorId }, { distributorId: null }] }
        : { distributorId: null }),
    },
  });

  const resolvedItems = normalizedItems.map((item) => {
    const product = productMap.get(item.productId);
    const productRules = discountRules.filter((entry) => entry.productId === item.productId);
    const rule = selectLocationProductRule(productRules, distributorId);
    const locationPercentage = rule ? Number(rule.discountPercentage) : null;
    const pricing = resolveEffectiveProductDiscount({
      productDiscount: product.discount,
      locationDiscount: locationPercentage,
      hasLocationRule: Boolean(rule),
    });
    const locationApplies = pricing.source === "LOCATION";
    const percentage = pricing.percentage;
    return buildResolvedLine(
      item,
      product,
      percentage,
      pricing.source,
      locationApplies ? locationPercentage : null,
      locationApplies ? rule.distributorId || null : null,
    );
  });

  return {
    location,
    locationDiscountDistributorId: resolvedItems.some((item) => item.discountSource === "LOCATION")
      ? distributorId
      : null,
    items: resolvedItems,
  };
};

const buildResolvedLine = (item, product, percentage, discountSource, locationDiscountPercentage, locationDiscountDistributorId) => {
  const basePrice = Number(product.price || 0);
  const effectiveUnitPrice = Math.round(basePrice * (1 - percentage / 100));
  return {
    ...item,
    basePrice,
    productDiscountPercentage: Number(product.discount || 0),
    locationDiscountPercentage,
    effectiveDiscountPercentage: percentage,
    effectiveUnitPrice,
    discountSource,
    locationDiscountDistributorId,
    lineTotal: effectiveUnitPrice * item.quantity,
  };
};

export const listManufacturerLocationMappings = async () => {
  const [mappings, manufacturers, { locations }] = await Promise.all([
    prisma.manufacturerLocation.findMany({
      include: { manufacturer: { select: { id: true, name: true, city: true, isActive: true, isAvailable: true } } },
      orderBy: [{ province: "asc" }, { district: "asc" }, { manufacturer: { name: "asc" } }],
    }),
    prisma.manufacturer.findMany({ where: { isActive: true }, select: { id: true, name: true, city: true }, orderBy: { name: "asc" } }),
    getLocationLookupData(),
  ]);
  return { mappings, manufacturers, locations: locations.filter((entry) => entry.type !== "NATIONWIDE") };
};

export const saveManufacturerLocationMappings = async ({ manufacturerId, locations }) => {
  if (!manufacturerId || !Array.isArray(locations) || locations.length > 77) {
    throw Object.assign(new Error("Select a manufacturer and provide valid district mappings."), { code: "INVALID_MANUFACTURER_LOCATIONS", status: 400 });
  }
  const manufacturer = await prisma.manufacturer.findUnique({ where: { id: manufacturerId }, select: { id: true } });
  if (!manufacturer) throw Object.assign(new Error("Manufacturer not found."), { code: "MANUFACTURER_NOT_FOUND", status: 404 });
  const canonicalLocations = new Map();
  for (const entry of locations) {
    const canonical = canonicalizeNepalLocation(entry.province, entry.district);
    if (!canonical) throw Object.assign(new Error(`Invalid province/district mapping: ${entry.province} / ${entry.district}`), { code: "INVALID_MANUFACTURER_LOCATIONS", status: 400 });
    canonicalLocations.set(`${canonical.province}|${canonical.district}`, canonical);
  }
  await prisma.$transaction(async (tx) => {
    await tx.manufacturerLocation.deleteMany({ where: { manufacturerId } });
    if (canonicalLocations.size) {
      await tx.manufacturerLocation.createMany({
        data: [...canonicalLocations.values()].map((entry) => ({ manufacturerId, ...entry, isActive: true })),
      });
    }
  }, { isolationLevel: "Serializable" });
  return listManufacturerLocationMappings();
};

export const listLocationProductDiscounts = async () => {
  const [discounts, products, distributors] = await Promise.all([
    prisma.locationProductDiscount.findMany({
      include: {
        product: { select: { id: true, name: true, price: true, discount: true, published: true } },
        distributor: {
          select: {
            id: true,
            name: true,
            city: true,
            province: true,
            district: true,
          },
        },
      },
      orderBy: [{ province: "asc" }, { district: "asc" }, { product: { name: "asc" } }],
    }),
    prisma.product.findMany({
      where: { published: true },
      select: { id: true, name: true, price: true, discount: true, published: true },
      orderBy: { name: "asc" },
    }),
    prisma.distributor.findMany({
      where: { status: "ACTIVE", isActive: true },
      select: {
        id: true,
        name: true,
        city: true,
        province: true,
        district: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);
  return { discounts, products, distributors };
};

export const saveLocationProductDiscount = async ({
  id = null,
  productId,
  distributorId = null,
  province: provinceValue,
  district: districtValue,
  discountPercentage,
  isActive = true,
}) => {
  const location = canonicalizeNepalLocation(provinceValue, districtValue);
  const percentage = Number(discountPercentage);
  const active = isActive === true || String(isActive).toLowerCase() === "true";
  if (!productId || (!id && !distributorId) || !location || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw Object.assign(new Error("Select a product, active distributor, valid province and district, and discount from 0% to 100%."), { code: "INVALID_LOCATION_DISCOUNT", status: 400 });
  }
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw Object.assign(new Error("Product not found."), { code: "PRODUCT_NOT_FOUND", status: 404 });
  if (distributorId) {
    const distributor = await prisma.distributor.findFirst({
      where: { id: distributorId, status: "ACTIVE", isActive: true },
      select: { id: true },
    });
    if (!distributor) {
      throw Object.assign(new Error("Select an active distributor."), { code: "DISTRIBUTOR_NOT_FOUND", status: 404 });
    }
  }

  const data = {
    productId,
    distributorId,
    scopeKey: distributorId || "ALL",
    ...location,
    discountPercentage: percentage,
    isActive: active,
  };
  const include = {
    product: { select: { id: true, name: true, price: true, discount: true, published: true } },
    distributor: { select: { id: true, name: true, city: true, province: true, district: true } },
  };
  if (id) {
    return prisma.locationProductDiscount.update({ where: { id }, data, include });
  }
  return prisma.locationProductDiscount.upsert({
    where: {
      productId_province_district_scopeKey: {
        productId,
        province: location.province,
        district: location.district,
        scopeKey: distributorId || "ALL",
      },
    },
    create: data,
    update: { discountPercentage: percentage, isActive: active },
    include,
  });
};