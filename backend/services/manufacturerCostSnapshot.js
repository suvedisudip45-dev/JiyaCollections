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
}) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("At least one order item is required for the cost snapshot.");
  }

  const inventoryByProduct = new Map(inventoryRows.map((row) => [row.productId, row]));
  const snapshotAt = new Date(acceptedAt).toISOString();

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
    };
  });
};