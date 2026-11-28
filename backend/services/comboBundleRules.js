import { Prisma } from "@prisma/client";
import {
  addDecimals,
  allocateDecimal,
  divideDecimals,
  multiplyDecimals,
  quantizeDecimal,
  serializeAccountingDecimal,
  subtractDecimals,
} from "./accountingDecimal.js";
import {
  applyPercentagePriceDiscount,
  decimalFromStoredFloat,
} from "./checkoutPricingService.js";

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
const roundMoneyDecimal = (value) => quantizeDecimal(value, 2, Prisma.Decimal.ROUND_HALF_UP);

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
  const componentPrices = products.map((product) => {
    const price = decimalFromStoredFloat(product?.price, "Combo product price");
    const discount = decimalFromStoredFloat(product?.discount || 0, "Combo product discount");
    if (price.isNegative() || discount.isNegative() || discount.greaterThan(100)) {
      throw Object.assign(new TypeError("Combo product prices and discounts must be non-negative with discount at most 100%."), {
        code: "INVALID_ORDER_PRICE",
      });
    }
    return applyPercentagePriceDiscount(price.toString(), discount.toString(), "Combo product discount");
  });
  const calculatedPrice = roundMoneyDecimal(addDecimals(...componentPrices));
  const normalizedDiscount = decimalFromStoredFloat(discountPercentage || 0, "Combo discount percentage");
  if (normalizedDiscount.isNegative() || normalizedDiscount.greaterThan(100)) {
    throw Object.assign(new TypeError("Combo discount must be between 0 and 100%."), { code: "INVALID_ORDER_DISCOUNT" });
  }
  const discountedPrice = roundMoneyDecimal(divideDecimals(
    multiplyDecimals(calculatedPrice, subtractDecimals("100", normalizedDiscount.toString())),
    "100",
    { significantDigits: 40, roundingMode: Prisma.Decimal.ROUND_HALF_UP },
  ));
  const overridePrice = decimalFromStoredFloat(sellingPrice || 0, "Combo selling price");
  if (overridePrice.isNegative()) {
    throw Object.assign(new TypeError("Combo selling price cannot be negative."), { code: "INVALID_ORDER_PRICE" });
  }
  const useManualPrice = Boolean(manualPriceOverride) && overridePrice.greaterThan(0);
  const exactSellingPrice = useManualPrice ? overridePrice : discountedPrice;

  return {
    calculatedPrice: Number(calculatedPrice.toString()),
    sellingPrice: Number(exactSellingPrice.toString()),
    discountPercentage: Number(normalizedDiscount.toString()),
    manualPriceOverride: useManualPrice,
    calculatedPriceDecimal: serializeAccountingDecimal(calculatedPrice),
    sellingPriceDecimal: serializeAccountingDecimal(exactSellingPrice),
    discountPercentageDecimal: serializeAccountingDecimal(normalizedDiscount),
  };
};

export const allocateComboBundleComponentPriceDecimals = (components = [], bundlePrice = "0") => {
  if (!components.length) return [];
  const amount = decimalFromStoredFloat(bundlePrice, "Combo bundle price");
  if (amount.isNegative()) {
    throw Object.assign(new TypeError("Combo bundle price cannot be negative."), { code: "INVALID_ORDER_PRICE" });
  }
  const weights = components.map((component) => {
    const weight = decimalFromStoredFloat(
      component?._pricingDecimal?.unitPrice ??
        component?.purchasedUnitPrice ??
        component?.price ??
        0,
      "Combo component price",
    );
    if (weight.isNegative()) {
      throw Object.assign(new TypeError("Combo component prices cannot be negative."), { code: "INVALID_ORDER_PRICE" });
    }
    return weight;
  });
  const roundedAmount = roundMoneyDecimal(amount);

  if (weights.every((weight) => weight.isZero())) {
    const equalWeights = components.map(() => "1");
    return allocateDecimal(roundedAmount, equalWeights, {
      scale: 2,
      roundingMode: Prisma.Decimal.ROUND_HALF_UP,
      residualTargetIndex: components.length - 1,
      divisionSignificantDigits: 40,
    }).allocations.map(serializeAccountingDecimal);
  }
  return allocateDecimal(roundedAmount, weights, {
    scale: 2,
    roundingMode: Prisma.Decimal.ROUND_HALF_UP,
    residualTargetIndex: components.length - 1,
    divisionSignificantDigits: 40,
  }).allocations.map(serializeAccountingDecimal);
};

export const allocateComboBundleComponentPrices = (components = [], bundlePrice = 0) =>
  allocateComboBundleComponentPriceDecimals(components, bundlePrice).map(Number);
