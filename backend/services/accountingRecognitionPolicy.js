import { Prisma } from "@prisma/client";

const normalize = (value) => String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");

const toDecimal = (value, fieldName) => {
  let amount;
  try {
    amount = new Prisma.Decimal(String(value));
  } catch {
    throw new Error(`${fieldName} must be a valid decimal amount.`);
  }
  if (!amount.isFinite()) throw new Error(`${fieldName} must be a finite decimal amount.`);
  return amount;
};

const toNonNegativeDecimal = (value, fieldName) => {
  const amount = toDecimal(value, fieldName);
  if (amount.isNegative()) throw new Error(`${fieldName} cannot be negative.`);
  return amount;
};

export const classifySaleChannel = (order = {}) => {
  const orderType = normalize(order.orderType);
  const directOrderType = normalize(order.directOrderType);

  if (orderType === "DIRECT_MANUFACTURER" && ["PHONE_ORDER", "HUB_VISIT"].includes(directOrderType)) {
    return "MANUFACTURER_DIRECT";
  }
  if (orderType === "DIRECT_DISTRIBUTOR" && ["PHONE_ORDER", "HUB_VISIT"].includes(directOrderType)) {
    return "DISTRIBUTOR_DIRECT";
  }
  if (orderType === "ONLINE_STORE") return "ONLINE_STORE";
  if (orderType === "ADMIN_DIRECT") return "ADMIN_DIRECT";
  return "UNKNOWN";
};

export const isDeliveredAndNotReturnedToManufacturer = ({
  order = {},
  deliveryState,
  returnedToManufacturer = false,
}) => {
  if (returnedToManufacturer) return false;

  const deliveredStatuses = [
    normalize(deliveryState),
    normalize(order.fulfillmentStatus),
    normalize(order.status),
  ];
  return deliveredStatuses.includes("DELIVERED");
};

export const isManufacturerCommissionEligible = ({ order, deliveryState, returnedToManufacturer }) =>
  classifySaleChannel(order) === "MANUFACTURER_DIRECT" &&
  isDeliveredAndNotReturnedToManufacturer({ order, deliveryState, returnedToManufacturer });

export const calculateManufacturerCommission = ({
  productRevenueExVat,
  agreedCogsVatInclusive,
  recoverableInputVat = 0,
  commissionRatePercent,
}) => {
  const revenue = toNonNegativeDecimal(productRevenueExVat, "Product revenue");
  const grossCogs = toNonNegativeDecimal(agreedCogsVatInclusive, "Agreed COGS");
  const inputVat = toNonNegativeDecimal(recoverableInputVat, "Recoverable input VAT");
  const commissionRate = toNonNegativeDecimal(commissionRatePercent, "Commission rate");

  if (inputVat.greaterThan(grossCogs)) {
    throw new Error("Recoverable input VAT cannot exceed VAT-inclusive agreed COGS.");
  }

  const grossProfit = revenue.minus(grossCogs.minus(inputVat));
  const commission = grossProfit.greaterThan(0)
    ? grossProfit.mul(commissionRate).div(100)
    : new Prisma.Decimal(0);

  return {
    grossProfit: grossProfit.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
    commissionAmount: commission.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
  };
};