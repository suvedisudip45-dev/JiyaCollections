const STOCK_ADJUSTMENT_REASONS = new Set([
  "RECEIVED",
  "COUNT_CORRECTION",
  "DAMAGED",
  "LOST",
  "CUSTOMER_RETURN",
  "OTHER",
]);

export const normalizeStockAdjustmentReason = (reason, note) => {
  const normalizedReason = String(reason || "").trim().toUpperCase();
  const normalizedNote = String(note || "").trim();
  if (!STOCK_ADJUSTMENT_REASONS.has(normalizedReason)) {
    throw new Error("Select a valid reason for the stock adjustment.");
  }
  if (normalizedNote.length > 1000) {
    throw new Error("Stock adjustment note cannot exceed 1000 characters.");
  }
  if (normalizedReason === "OTHER" && !normalizedNote) {
    throw new Error("Add a note when selecting Other as the stock adjustment reason.");
  }
  return { reason: normalizedReason, note: normalizedNote || null };
};

const variantKey = ({ size, color }) => JSON.stringify([
  String(size || "Standard").trim(),
  String(color || "Standard").trim(),
]);

export const buildManufacturerStockMovements = ({
  previousVariants = [],
  nextVariants = [],
  productId,
  productName,
  manufacturerId,
  actorId,
  reason,
  note,
}) => {
  const previousByVariant = new Map(previousVariants.map((variant) => [variantKey(variant), variant]));
  const nextByVariant = new Map(nextVariants.map((variant) => [variantKey(variant), variant]));
  const keys = new Set([...previousByVariant.keys(), ...nextByVariant.keys()]);
  const movements = [];

  for (const key of keys) {
    const previous = previousByVariant.get(key);
    const next = nextByVariant.get(key);
    const previousQty = Number(previous?.quantity || 0);
    const newQty = Number(next?.quantity || 0);
    const changeQty = newQty - previousQty;
    if (changeQty === 0) continue;

    const [size, color] = JSON.parse(key);
    movements.push({
      manufacturerId,
      productId,
      productName,
      variantLabel: color === "Standard" ? size : `${size} / ${color}`,
      previousQty,
      newQty,
      changeQty,
      movementType: changeQty > 0 ? "STOCK_IN" : "STOCK_OUT",
      reason,
      note,
      actorId: actorId || null,
      actorRole: "MANUFACTURER",
      source: "MANUFACTURER_PORTAL",
    });
  }

  return movements;
};
