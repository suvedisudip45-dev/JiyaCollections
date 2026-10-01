import { prisma } from "../config/db.js";
import { NEPAL_LOCATION_MAP, resolveLocationEntry } from "../utils/nepalLocationData.js";

const cleanKey = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const LOCATION_ALIASES = new Map([
  ["nawalparasieast", "Nawalpur"],
  ["nawalparasiwest", "Parasi"],
]);
const PROVINCE_ALIASES = new Set(["province1", "province2", "province3", "province4", "province5", "province6", "province7"]);

export const canonicalizeNepalLocation = (provinceValue, districtValue) => {
  const provinceEntry = resolveLocationEntry(provinceValue);
  const districtAlias = LOCATION_ALIASES.get(cleanKey(districtValue));
  const districtEntry = districtAlias
    ? resolveLocationEntry(districtAlias)
    : resolveLocationEntry(districtValue);
  if (!provinceEntry || provinceEntry.type !== "PROVINCE" || !districtEntry || districtEntry.type !== "DISTRICT") return null;

  const provinceMatches = cleanKey(provinceEntry.name) === cleanKey(provinceValue) ||
    cleanKey(provinceEntry.code) === cleanKey(provinceValue) ||
    PROVINCE_ALIASES.has(cleanKey(provinceValue));
  const districtMatches = cleanKey(districtEntry.name) === cleanKey(districtValue) || cleanKey(districtEntry.code) === cleanKey(districtValue) || Boolean(districtAlias);
  if (!provinceMatches || !districtMatches || cleanKey(districtEntry.province) !== cleanKey(provinceEntry.name)) return null;
  return { province: provinceEntry.name, district: districtEntry.name };
};

export const getAvailableVariantQuantity = (inventory, item = {}) => {
  if (!inventory) return 0;
  const variants = parseArray(inventory.variantsStock);
  if (!variants.length) {
    return Math.max(0, Number(inventory.quantity || 0) - Number(inventory.reservedQty || 0));
  }
  const size = cleanKey(item.size);
  const color = cleanKey(item.color);
  const matches = variants.filter((variant) =>
    (!size || cleanKey(variant.size) === size) && (!color || cleanKey(variant.color) === color)
  );
  return matches.reduce((sum, variant) =>
    sum + Math.max(0, Number(variant.quantity || 0) - Number(variant.reservedQty || 0)), 0
  );
};

export const reserveVariantQuantities = (variants, item) => {
  let remaining = Number(item.quantity || 0);
  const size = cleanKey(item.size);
  const color = cleanKey(item.color);
  const updated = variants.map((variant) => {
    const matches = (!size || cleanKey(variant.size) === size) && (!color || cleanKey(variant.color) === color);
    if (!matches || remaining <= 0) return variant;
    const available = Math.max(0, Number(variant.quantity || 0) - Number(variant.reservedQty || 0));
    const reserve = Math.min(remaining, available);
    remaining -= reserve;
    return reserve > 0 ? { ...variant, reservedQty: Number(variant.reservedQty || 0) + reserve } : variant;
  });
  if (remaining > 0) {
    throw Object.assign(new Error(`Local manufacturer stock changed for ${item.productId}. Refresh prices and try again.`), {
      code: "LOCATION_STOCK_CHANGED",
      status: 409,
    });
  }
  return updated;
};

export const resolveEffectiveProductDiscount = ({ productDiscount, locationDiscount, locationEligible }) => {
  const globalPercentage = Math.min(100, Math.max(0, Number(productDiscount || 0)));
  const localPercentage = Number(locationDiscount);
  if (locationEligible && Number.isFinite(localPercentage) && localPercentage > 0 && localPercentage <= 100) {
    return { percentage: localPercentage, source: "LOCATION" };
  }
  return { percentage: globalPercentage, source: globalPercentage > 0 ? "PRODUCT" : "BASE" };
};

const normalizeRequestItems = (items = []) => items.map((item) => ({
  productId: String(item.productId || item._id || item.id || "").trim(),
  size: String(item.size || "").trim(),
  color: String(item.color || "").trim(),
  quantity: Math.max(1, Math.floor(Number(item.quantity || 1))),
}));

const locationManufacturerHasStock = (location, items) => {
  const inventoryByProduct = new Map((location.manufacturer?.inventory || []).map((entry) => [entry.productId, entry]));
  return items.every((item) => getAvailableVariantQuantity(inventoryByProduct.get(item.productId), item) >= item.quantity);
};

const rankEligibleLocations = (locations) => [...locations].sort((left, right) => {
  const qualityDifference = Number(right.manufacturer?.qualityRating || 0) - Number(left.manufacturer?.qualityRating || 0);
  if (qualityDifference) return qualityDifference;
  const fulfillmentDifference = Number(right.manufacturer?.totalOrdersFulfilled || 0) - Number(left.manufacturer?.totalOrdersFulfilled || 0);
  if (fulfillmentDifference) return fulfillmentDifference;
  return String(left.manufacturer?.id || "").localeCompare(String(right.manufacturer?.id || ""));
});

export const findEligibleLocationManufacturer = (locations, items, { wholeBasket = true } = {}) => {
  const normalizedItems = normalizeRequestItems(items);
  if (wholeBasket) {
    return rankEligibleLocations(locations.filter((location) => locationManufacturerHasStock(location, normalizedItems)))[0] || null;
  }
  return normalizedItems.map((item) => {
    const eligible = locations.filter((location) => locationManufacturerHasStock(location, [item]));
    return rankEligibleLocations(eligible)[0] || null;
  });
};

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
  eligibilityMode = "WHOLE_BASKET",
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
      locationDiscountManufacturerId: null,
      items: normalizedItems.map((item) => {
        const product = productMap.get(item.productId);
        const percentage = Number(product.discount || 0);
        return buildResolvedLine(item, product, percentage, percentage > 0 ? "PRODUCT" : "BASE", null, null);
      }),
    };
  }

  const discountRules = await client.locationProductDiscount.findMany({
    where: { productId: { in: productIds }, province: location.province, district: location.district, isActive: true },
  });
  const rulesByProduct = new Map(discountRules.map((rule) => [rule.productId, rule]));
  if (rulesByProduct.size === 0) {
    return {
      location,
      locationDiscountManufacturerId: null,
      items: normalizedItems.map((item) => {
        const product = productMap.get(item.productId);
        const pricing = resolveEffectiveProductDiscount({ productDiscount: product.discount, locationDiscount: null, locationEligible: false });
        return buildResolvedLine(item, product, pricing.percentage, pricing.source, null, null);
      }),
    };
  }

  const useWholeBasket = eligibilityMode !== "PER_ITEM";
  const eligibleIndexes = useWholeBasket
    ? normalizedItems.map((_item, index) => index)
    : normalizedItems.map((item, index) => rulesByProduct.has(item.productId) ? index : -1).filter((index) => index >= 0);
  const eligibleItems = eligibleIndexes.map((index) => normalizedItems[index]);
  const inventoryProductIds = [...new Set((useWholeBasket ? normalizedItems : eligibleItems).map((item) => item.productId))];
  const manufacturerLocations = await client.manufacturerLocation.findMany({
    where: {
      province: location.province,
      district: location.district,
      isActive: true,
      manufacturer: { isActive: true, isAvailable: true, contractStatus: "ACTIVE" },
    },
    include: {
      manufacturer: {
        include: { inventory: { where: { productId: { in: inventoryProductIds } } } },
      },
    },
  });
  const eligibleManufacturer = findEligibleLocationManufacturer(manufacturerLocations, eligibleItems, { wholeBasket: useWholeBasket });
  const manufacturerByLine = useWholeBasket ? normalizedItems.map(() => eligibleManufacturer) : normalizedItems.map(() => null);
  if (!useWholeBasket) eligibleIndexes.forEach((itemIndex, candidateIndex) => {
    manufacturerByLine[itemIndex] = eligibleManufacturer[candidateIndex];
  });
  const locationDiscountManufacturerId = useWholeBasket ? eligibleManufacturer?.manufacturerId || null : null;

  const resolvedItems = normalizedItems.map((item, index) => {
    const product = productMap.get(item.productId);
    const rule = rulesByProduct.get(item.productId);
    const localManufacturerId = manufacturerByLine[index]?.manufacturerId || null;
    const locationPercentage = rule ? Number(rule.discountPercentage) : null;
    const pricing = resolveEffectiveProductDiscount({
      productDiscount: product.discount,
      locationDiscount: locationPercentage,
      locationEligible: Boolean(rule && localManufacturerId),
    });
    const locationApplies = pricing.source === "LOCATION";
    const percentage = pricing.percentage;
    return buildResolvedLine(
      item,
      product,
      percentage,
      pricing.source,
      locationApplies ? locationPercentage : null,
      locationApplies ? localManufacturerId : null,
    );
  });

  return {
    location,
    locationDiscountManufacturerId: resolvedItems.some((item) => item.discountSource === "LOCATION")
      ? locationDiscountManufacturerId || resolvedItems.find((item) => item.locationManufacturerId)?.locationManufacturerId || null
      : null,
    items: resolvedItems,
  };
};

const buildResolvedLine = (item, product, percentage, discountSource, locationDiscountPercentage, locationManufacturerId) => {
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
    locationManufacturerId,
    lineTotal: effectiveUnitPrice * item.quantity,
  };
};

export const reserveLocationManufacturerInventory = async (tx, manufacturerId, items) => {
  for (const item of normalizeRequestItems(items)) {
    const inventory = await tx.manufacturerInventory.findUnique({
      where: { manufacturerId_productId: { manufacturerId, productId: item.productId } },
    });
    const available = getAvailableVariantQuantity(inventory, item);
    if (!inventory || available < item.quantity) {
      throw Object.assign(new Error(`Local manufacturer stock changed for ${item.productId}. Refresh prices and try again.`), {
        code: "LOCATION_STOCK_CHANGED",
        status: 409,
      });
    }

    const variants = parseArray(inventory.variantsStock);
    const hasVariants = variants.length > 0;
    const updatedVariants = hasVariants
      ? reserveVariantQuantities(variants, item)
      : variants;
    await tx.manufacturerInventory.update({
      where: { manufacturerId_productId: { manufacturerId, productId: item.productId } },
      data: {
        reservedQty: Number(inventory.reservedQty || 0) + item.quantity,
        ...(hasVariants ? { variantsStock: updatedVariants } : {}),
      },
    });
  }
};

export const listManufacturerLocationMappings = async () => {
  const [mappings, manufacturers] = await Promise.all([
    prisma.manufacturerLocation.findMany({
      include: { manufacturer: { select: { id: true, name: true, city: true, isActive: true, isAvailable: true } } },
      orderBy: [{ province: "asc" }, { district: "asc" }, { manufacturer: { name: "asc" } }],
    }),
    prisma.manufacturer.findMany({ where: { isActive: true }, select: { id: true, name: true, city: true }, orderBy: { name: "asc" } }),
  ]);
  return { mappings, manufacturers, locations: NEPAL_LOCATION_MAP.filter((entry) => entry.type !== "NATIONWIDE") };
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
  const [discounts, products] = await Promise.all([
    prisma.locationProductDiscount.findMany({
      include: { product: { select: { id: true, name: true, price: true, discount: true, published: true } } },
      orderBy: [{ province: "asc" }, { district: "asc" }, { product: { name: "asc" } }],
    }),
    prisma.product.findMany({
      where: { published: true },
      select: { id: true, name: true, price: true, discount: true, published: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { discounts, products };
};

export const saveLocationProductDiscount = async ({ productId, province: provinceValue, district: districtValue, discountPercentage, isActive = true }) => {
  const location = canonicalizeNepalLocation(provinceValue, districtValue);
  const percentage = Number(discountPercentage);
  const active = isActive === true || String(isActive).toLowerCase() === "true";
  if (!productId || !location || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw Object.assign(new Error("Select a valid product, province, district, and discount from 0% to 100%."), { code: "INVALID_LOCATION_DISCOUNT", status: 400 });
  }
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw Object.assign(new Error("Product not found."), { code: "PRODUCT_NOT_FOUND", status: 404 });
  return prisma.locationProductDiscount.upsert({
    where: { productId_province_district: { productId, province: location.province, district: location.district } },
    create: {
      productId,
      ...location,
      discountPercentage: percentage,
      isActive: active,
    },
    update: { discountPercentage: percentage, isActive: active },
    include: { product: { select: { id: true, name: true, price: true, discount: true, published: true } } },
  });
};