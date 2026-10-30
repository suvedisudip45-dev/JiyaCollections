export const calculateMarketingCardDiscount = (benefitType, value, itemsSubtotal, maxDiscountAmount = null) => {
  const type = String(benefitType || "").trim().toUpperCase();
  const rewardValue = Number(value);
  const subtotal = Number(itemsSubtotal);
  if (!Number.isFinite(rewardValue) || rewardValue <= 0 || !Number.isFinite(subtotal) || subtotal < 0) {
    return null;
  }

  if (type === "DISCOUNT") {
    if (rewardValue > 100) return null;
    if (
      maxDiscountAmount !== null &&
      maxDiscountAmount !== undefined &&
      (!Number.isFinite(Number(maxDiscountAmount)) || Number(maxDiscountAmount) <= 0)
    ) return null;
    const discountCap = maxDiscountAmount === null || maxDiscountAmount === undefined
      ? Infinity
      : Number(maxDiscountAmount);
    return Math.min(subtotal, Math.round(subtotal * rewardValue / 100), discountCap);
  }

  if (type === "VOUCHER") {
    return Math.min(subtotal, rewardValue);
  }

  return null;
};
