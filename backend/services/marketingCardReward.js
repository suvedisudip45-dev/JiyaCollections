export const calculateMarketingCardDiscount = (benefitType, value, itemsSubtotal) => {
  const type = String(benefitType || "").trim().toUpperCase();
  const rewardValue = Number(value);
  const subtotal = Number(itemsSubtotal);
  if (!Number.isFinite(rewardValue) || rewardValue <= 0 || !Number.isFinite(subtotal) || subtotal < 0) {
    return null;
  }

  if (type === "DISCOUNT") {
    if (rewardValue > 100) return null;
    return Math.min(subtotal, Math.round(subtotal * rewardValue / 100));
  }

  if (type === "VOUCHER") {
    return Math.min(subtotal, rewardValue);
  }

  return null;
};
