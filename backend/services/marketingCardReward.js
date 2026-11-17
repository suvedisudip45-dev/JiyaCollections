import { Prisma } from "@prisma/client";
import {
  compareDecimals,
  divideDecimals,
  multiplyDecimals,
  quantizeDecimal,
} from "./accountingDecimal.js";
import { decimalFromStoredFloat } from "./checkoutPricingService.js";

export const calculateMarketingCardDiscount = (benefitType, value, itemsSubtotal, maxDiscountAmount = null) => {
  const type = String(benefitType || "").trim().toUpperCase();
  if (
    (typeof value === "number" && !Number.isFinite(value)) ||
    (typeof itemsSubtotal === "number" && !Number.isFinite(itemsSubtotal)) ||
    (typeof maxDiscountAmount === "number" && !Number.isFinite(maxDiscountAmount))
  ) {
    return null;
  }
  const rewardValue = decimalFromStoredFloat(value, "Marketing reward value");
  const subtotal = decimalFromStoredFloat(itemsSubtotal, "Order subtotal");
  if (!rewardValue.greaterThan(0) || subtotal.isNegative()) return null;

  if (type === "DISCOUNT") {
    if (rewardValue.greaterThan(100)) return null;
    if (
      maxDiscountAmount !== null &&
      maxDiscountAmount !== undefined &&
      !decimalFromStoredFloat(maxDiscountAmount, "Maximum marketing discount").greaterThan(0)
    ) return null;
    const percentageDiscount = quantizeDecimal(
      divideDecimals(
        multiplyDecimals(subtotal, rewardValue),
        "100",
        { significantDigits: 40, roundingMode: Prisma.Decimal.ROUND_HALF_UP },
      ),
      0,
      Prisma.Decimal.ROUND_HALF_UP,
    );
    const discount = compareDecimals(percentageDiscount, subtotal) > 0 ? subtotal : percentageDiscount;
    const capped = maxDiscountAmount === null || maxDiscountAmount === undefined
      ? discount
      : compareDecimals(discount, decimalFromStoredFloat(maxDiscountAmount, "Maximum marketing discount")) > 0
        ? decimalFromStoredFloat(maxDiscountAmount, "Maximum marketing discount")
        : discount;
    return Number(capped.toString());
  }

  if (type === "VOUCHER") {
    return Number((compareDecimals(subtotal, rewardValue) < 0 ? subtotal : rewardValue).toString());
  }

  return null;
};
