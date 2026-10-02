const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeVariantLabel = (value) => String(value || "").trim();
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const getSharedComboBundleVariants = (products = [], requestedQuantity = 1) => {
  if (!Array.isArray(products) || products.length === 0) return [];
  const requiredQuantity = Math.max(1, Number(requestedQuantity) || 1);

  const perProductVariants = products.map((product) => {
    const variants = parseArray(product?.variants);
    const availability = new Map();
    const assignedColor = normalizeVariantLabel(product?.comboBundleColor).toLowerCase();

    for (const variant of variants) {
      const size = normalizeVariantLabel(variant?.size);
      const color = normalizeVariantLabel(variant?.color);
      if (!size || !color) continue;
      if (assignedColor && color.toLowerCase() !== assignedColor) continue;
      const availableQuantity = Math.max(
        0,
        Number(variant?.quantity || 0) - Number(variant?.reservedQty || 0)
      );
      if (availableQuantity < requiredQuantity) continue;

      const key = size.toLowerCase();
      const colors = availability.get(key) || new Map();
      const colorKey = color.toLowerCase();
      const existing = colors.get(colorKey);
      colors.set(colorKey, {
        size: existing?.size || size,
        color: existing?.color || color,
        availableQuantity: (existing?.availableQuantity || 0) + availableQuantity,
      });
      availability.set(key, colors);
    }

    if (variants.length === 0) {
      const sizes = parseArray(product?.sizes).map((entry) => normalizeVariantLabel(entry?.name || entry)).filter(Boolean);
      const colors = parseArray(product?.colors).map((entry) => normalizeVariantLabel(entry?.name || entry)).filter(Boolean);
      const availableQuantity = Math.max(0, Number(product?.stockQuantity || 0) - Number(product?.reservedQty || 0));
      if (availableQuantity >= requiredQuantity) {
        for (const size of sizes) {
          const sizeKey = size.toLowerCase();
          const colorOptions = availability.get(sizeKey) || new Map();
          for (const color of colors) {
            if (!color) continue;
            if (assignedColor && color.toLowerCase() !== assignedColor) continue;
            colorOptions.set(color.toLowerCase(), { size, color, availableQuantity });
          }
          availability.set(sizeKey, colorOptions);
        }
      }
    }

    return availability;
  });

  const first = perProductVariants[0];
  return [...first.keys()]
    .filter((sizeKey) => perProductVariants.every((variants) => {
      const colors = variants.get(sizeKey);
      return colors && [...colors.values()].some((option) => option.availableQuantity >= requiredQuantity);
    }))
    .map((sizeKey) => {
      const productVariants = perProductVariants.map((variants) => [...variants.get(sizeKey).values()]
        .filter((option) => option.availableQuantity >= requiredQuantity)
        .sort((a, b) => b.availableQuantity - a.availableQuantity || a.color.localeCompare(b.color))[0]);
      return {
        size: productVariants[0].size,
        availableQuantity: Math.min(...productVariants.map((variant) => variant.availableQuantity)),
        productVariants: productVariants.map((variant) => ({ size: variant.size, color: variant.color, availableQuantity: variant.availableQuantity })),
      };
    })
    .filter((variant) => variant.availableQuantity >= requiredQuantity)
    .sort((a, b) => a.size.localeCompare(b.size));
};

export const calculateComboBundlePrice = ({
  products = [],
  discountPercentage = 0,
  manualPriceOverride = false,
  sellingPrice = 0,
} = {}) => {
  const calculatedPrice = roundMoney(products.reduce((total, product) => {
    const price = Math.max(0, Number(product?.price || 0));
    const discount = Math.min(100, Math.max(0, Number(product?.discount || 0)));
    return total + Math.round(price * (1 - discount / 100));
  }, 0));
  const normalizedDiscount = Math.min(100, Math.max(0, Number(discountPercentage || 0)));
  const discountedPrice = roundMoney(calculatedPrice * (1 - normalizedDiscount / 100));
  const overridePrice = Math.max(0, Number(sellingPrice || 0));
  const useManualPrice = Boolean(manualPriceOverride) && overridePrice > 0;

  return {
    calculatedPrice,
    sellingPrice: useManualPrice ? overridePrice : discountedPrice,
    discountPercentage: normalizedDiscount,
    manualPriceOverride: useManualPrice,
  };
};

export const allocateComboBundleComponentPrices = (components = [], bundlePrice = 0) => {
  if (!components.length) return [];
  const targetCents = Math.max(0, Math.round(Number(bundlePrice || 0) * 100));
  const weights = components.map((component) => Math.max(0, Number(component?.purchasedUnitPrice || component?.price || 0)));
  const weightTotal = weights.reduce((total, weight) => total + weight, 0);
  let allocatedCents = 0;

  return components.map((_, index) => {
    const cents = index === components.length - 1
      ? targetCents - allocatedCents
      : weightTotal > 0
      ? Math.round(targetCents * weights[index] / weightTotal)
      : Math.floor(targetCents / components.length);
    allocatedCents += cents;
    return roundMoney(cents / 100);
  });
};
