const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const normalizeCount = (value, label) => {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0 || count > 2147483647) {
    throw fail(`${label} must be a non-negative whole number.`);
  }
  return count;
};

export const normalizeDistributorStockDecrease = ({
  inventorySkuId,
  quantity,
  adjustmentType,
  reason,
  evidenceUrl,
}) => {
  const skuId = String(inventorySkuId || "").trim();
  const units = Number(quantity);
  const type = String(adjustmentType || "").trim().toUpperCase();
  const normalizedReason = String(reason || "").trim();
  const normalizedEvidenceUrl = String(evidenceUrl || "").trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedEvidenceUrl);
  } catch {
    throw fail("A valid HTTP(S) evidence URL is required.");
  }
  if (!skuId || skuId.length > 191) throw fail("A valid inventory SKU is required.");
  if (!Number.isSafeInteger(units) || units < 1 || units > 2147483647) {
    throw fail("Decrease quantity must be a positive whole number.");
  }
  if (!["DAMAGED", "LOST"].includes(type)) throw fail("Adjustment type must be DAMAGED or LOST.");
  if (normalizedReason.length < 5 || normalizedReason.length > 2000) {
    throw fail("A reason of 5 to 2000 characters is required.");
  }
  if (
    normalizedEvidenceUrl.length > 2048 ||
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    !parsedUrl.hostname
  ) {
    throw fail("A valid HTTP(S) evidence URL no longer than 2048 characters is required.");
  }
  return {
    inventorySkuId: skuId,
    quantity: units,
    adjustmentType: type,
    reason: normalizedReason,
    evidenceUrl: normalizedEvidenceUrl,
  };
};

export const normalizeDistributorInboundChecklist = (checklist, shipmentLines) => {
  if (!checklist || typeof checklist !== "object" || Array.isArray(checklist)) {
    throw fail("The inbound inspection checklist is required.");
  }
  if (checklist.qualityPassed !== true) {
    throw fail("The overall quality check must pass before distributor stock can be received.", 422);
  }
  if (!Array.isArray(checklist.lines) || checklist.lines.length !== shipmentLines.length) {
    throw fail("The checklist must include every shipment size/color variant exactly once.");
  }
  const qualityNotes = String(checklist.qualityNotes || "").trim();
  if (qualityNotes.length > 2000) throw fail("Quality-check notes cannot exceed 2000 characters.");
  const shipmentLineBySku = new Map(shipmentLines.map((line) => [
    line.stockTransferLine.inventorySkuId,
    line,
  ]));
  const seen = new Set();
  const lines = checklist.lines.map((entry) => {
    const inventorySkuId = String(entry?.inventorySkuId || "").trim();
    const shipmentLine = shipmentLineBySku.get(inventorySkuId);
    const goodQuantity = normalizeCount(entry?.goodCount, "Good product count");
    const damagedQuantity = normalizeCount(entry?.damagedCount ?? 0, "Damaged product count");
    const missingQuantity = normalizeCount(entry?.lostCount ?? 0, "Lost/missing product count");
    const key = shipmentLine?.id;
    const expectedSize = shipmentLine?.stockTransferLine.inventorySku.size;
    const expectedColor = shipmentLine?.stockTransferLine.inventorySku.color;
    const size = String(entry?.size || "").trim();
    const color = String(entry?.color || "").trim();
    const total = goodQuantity + damagedQuantity + missingQuantity;

    if (
      !shipmentLine ||
      seen.has(key) ||
      size.toLowerCase() !== expectedSize.toLowerCase() ||
      color.toLowerCase() !== expectedColor.toLowerCase() ||
      total !== shipmentLine.remainingQuantity ||
      (damagedQuantity > 0 && entry.damageType && !["STITCH_DAMAGE", "DELIVERY_DAMAGE", "OTHER_DAMAGE"].includes(String(entry.damageType).toUpperCase()))
    ) {
      throw fail("Each shipment variant must match its size/color and account for every good, damaged, and missing unit.");
    }
    seen.add(key);
    return {
      shipmentLineId: shipmentLine.id,
      goodQuantity,
      damagedQuantity,
      missingQuantity,
      damageType: damagedQuantity ? String(entry.damageType || "OTHER_DAMAGE").toUpperCase() : null,
      evidence: entry.evidence || null,
      note: String(entry.note || "").trim() || null,
    };
  });
  return {
    qualityPassed: true,
    qualityNotes,
    lines,
  };
};
