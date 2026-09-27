import { Prisma } from "@prisma/client";

const normalize = (value) => String(value || "").trim().toUpperCase();

const conflict = (message, code) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
};

export const createManufacturerCostSnapshot = ({
  items,
  inventoryRows,
  acceptedAt = new Date(),
  directSale = false,
  commissionStatus,
  agreedCommissionRate,
}) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("At least one order item is required for the cost snapshot.");
  }

  const inventoryByProduct = new Map(inventoryRows.map((row) => [row.productId, row]));
  const snapshotAt = new Date(acceptedAt).toISOString();
  const commissionRate = directSale
    ? (() => {
      if (normalize(commissionStatus) !== "APPROVED" || agreedCommissionRate === null || agreedCommissionRate === undefined) {
        throw conflict("An admin-approved manufacturer commission rate is required before accepting this direct sale.", "ACCOUNTING_APPROVED_COMMISSION_REQUIRED");
      }
      let rate;
      try {
        rate = new Prisma.Decimal(String(agreedCommissionRate));
      } catch {
        throw conflict("The approved manufacturer commission rate is invalid.", "ACCOUNTING_APPROVED_COMMISSION_REQUIRED");
      }
      if (!rate.isFinite() || rate.isNegative()) {
        throw conflict("The approved manufacturer commission rate is invalid.", "ACCOUNTING_APPROVED_COMMISSION_REQUIRED");
      }
      return rate.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);
    })()
    : null;

  return items.map((item) => {
    const productId = item.productId || item._id || item.id;
    const inventory = inventoryByProduct.get(productId);
    if (
      !inventory ||
      normalize(inventory.priceStatus) !== "APPROVED" ||
      inventory.agreedCostPrice === null ||
      inventory.agreedCostPrice === undefined
    ) {
      throw conflict(`Admin-approved agreed COGS is required before accepting product ${productId || "in this order"}.`, "ACCOUNTING_APPROVED_COGS_REQUIRED");
    }

    let agreedCogs;
    try {
      agreedCogs = new Prisma.Decimal(String(inventory.agreedCostPrice));
    } catch {
      throw conflict(`Admin-approved agreed COGS is invalid for product ${productId}.`, "ACCOUNTING_APPROVED_COGS_REQUIRED");
    }
    if (!agreedCogs.isFinite() || !agreedCogs.greaterThan(0)) {
      throw conflict(`Admin-approved agreed COGS must be greater than zero for product ${productId}.`, "ACCOUNTING_APPROVED_COGS_REQUIRED");
    }

    return {
      ...item,
      agreedUnitCogsVatInclusiveAtAcceptance: agreedCogs
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(2),
      cogsPriceStatusAtAcceptance: "APPROVED",
      cogsSnapshotAtAcceptance: snapshotAt,
      ...(directSale ? {
        agreedCommissionRateAtAcceptance: commissionRate,
        commissionStatusAtAcceptance: "APPROVED",
      } : {}),
    };
  });
};