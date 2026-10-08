import { createHash } from "node:crypto";

const fail = (message, code = "INVALID_STOCK_TRANSFER", statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

const normalizeQuantity = (value, label) => {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647) {
    throw fail(`${label} must be a positive whole number.`);
  }
  return quantity;
};

export const normalizeTransferRequestLines = (lines) => {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) {
    throw fail("A stock request must contain between 1 and 100 SKU lines.");
  }
  const seen = new Set();
  return lines.map((line) => {
    const inventorySkuId = String(line?.inventorySkuId || "").trim();
    if (!inventorySkuId || inventorySkuId.length > 191 || seen.has(inventorySkuId)) {
      throw fail("Each stock request line must have a unique valid inventory SKU.");
    }
    seen.add(inventorySkuId);
    return {
      inventorySkuId,
      requestedQuantity: normalizeQuantity(line.quantity, "Requested quantity"),
    };
  });
};

export const validateTransferRequestAvailability = (requestLines, balances) => {
  const availableBySku = new Map(balances.map((balance) => [
    balance.inventorySkuId,
    Math.max(0, Number(balance.quantityOnHand) - Number(balance.reservedQuantity)),
  ]));
  for (const line of requestLines) {
    const available = availableBySku.get(line.inventorySkuId) || 0;
    if (line.requestedQuantity > available) {
      throw fail(
        `Requested quantity for SKU ${line.inventorySkuId} exceeds the manufacturer's available factory stock (${available}).`,
        "INSUFFICIENT_FACTORY_STOCK",
        409,
      );
    }
  }
  return requestLines;
};

const TRANSFER_PREPARATION_CHECKS = [
  "availabilityPassed",
  "qualityPassed",
  "colorPassed",
  "sizePassed",
  "packagingPassed",
];

export const normalizeTransferPreparationChecklist = (checklist) => {
  if (!checklist || typeof checklist !== "object" || Array.isArray(checklist)) {
    throw fail("A manufacturer preparation checklist is required.");
  }
  for (const field of TRANSFER_PREPARATION_CHECKS) {
    if (typeof checklist[field] !== "boolean") {
      throw fail(`Preparation checklist field ${field} must be true or false.`);
    }
  }
  return Object.fromEntries(TRANSFER_PREPARATION_CHECKS.map((field) => [field, checklist[field]]));
};

export const isTransferPreparationComplete = (transfer) =>
  TRANSFER_PREPARATION_CHECKS.every((field) => transfer[field] === true);

export const isSameProfileOwner = (manufacturerAccountId, distributorAccountId) =>
  Boolean(manufacturerAccountId && distributorAccountId && manufacturerAccountId === distributorAccountId);

export const normalizeApprovalLines = (lines, transferLines) => {
  if (!Array.isArray(lines) || lines.length !== transferLines.length) {
    throw fail("An approval quantity is required for every requested SKU line.");
  }
  const requestedById = new Map(transferLines.map((line) => [line.id, line]));
  const seen = new Set();
  return lines.map((line) => {
    const lineId = String(line?.lineId || "").trim();
    const requestedLine = requestedById.get(lineId);
    const approvedQuantity = Number(line?.approvedQuantity);
    if (
      !requestedLine ||
      seen.has(lineId) ||
      !Number.isSafeInteger(approvedQuantity) ||
      approvedQuantity < 0 ||
      approvedQuantity > requestedLine.requestedQuantity
    ) {
      throw fail("Approval quantities must be valid and cannot exceed requested quantities.");
    }
    seen.add(lineId);
    return { id: lineId, approvedQuantity };
  });
};

const normalizeEvidence = (evidence) => {
  if (evidence === undefined || evidence === null) return null;
  if (!Array.isArray(evidence) || evidence.length > 10) {
    throw fail("Evidence must be a list of up to 10 HTTP(S) URLs.");
  }
  return evidence.map((value) => {
    const url = String(value || "").trim();
    if (url.length > 2048 || !/^https?:\/\/\S+$/i.test(url)) {
      throw fail("Each evidence item must be a valid HTTP(S) URL no longer than 2048 characters.");
    }
    return url;
  });
};

export const normalizeShipmentReceiptLines = (lines, shipmentLines) => {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > shipmentLines.length) {
    throw fail("A receipt must include at least one shipment SKU line.");
  }
  const shipmentLineById = new Map(shipmentLines.map((line) => [line.id, line]));
  const seen = new Set();
  return lines.map((line) => {
    const shipmentLineId = String(line?.shipmentLineId || "").trim();
    const shipmentLine = shipmentLineById.get(shipmentLineId);
    const goodQuantity = Number(line?.goodQuantity || 0);
    const damagedQuantity = Number(line?.damagedQuantity || 0);
    const missingQuantity = Number(line?.missingQuantity || 0);
    const damageType = String(line?.damageType || "").trim().toUpperCase() || null;
    const total = goodQuantity + damagedQuantity + missingQuantity;
    if (
      !shipmentLine ||
      seen.has(shipmentLineId) ||
      [goodQuantity, damagedQuantity, missingQuantity].some((quantity) =>
        !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647
      ) ||
      total <= 0 ||
      total > shipmentLine.remainingQuantity ||
      (damagedQuantity > 0 && !["STITCH_DAMAGE", "DELIVERY_DAMAGE", "OTHER_DAMAGE"].includes(damageType)) ||
      (damagedQuantity === 0 && damageType)
    ) {
      throw fail("Receipt quantities must be valid, within the shipment balance, and include a valid damage type.");
    }
    seen.add(shipmentLineId);
    const note = String(line?.note || "").trim();
    if (note.length > 4000) throw fail("Receipt line notes cannot exceed 4000 characters.");
    return {
      shipmentLineId,
      goodQuantity,
      damagedQuantity,
      missingQuantity,
      damageType,
      evidence: normalizeEvidence(line?.evidence),
      note: note || null,
    };
  });
};

export const buildReceiptRequestHash = ({ notes, lines }) => createHash("sha256")
  .update(JSON.stringify({
    notes: String(notes || "").trim(),
    lines: [...lines]
      .sort((left, right) => left.shipmentLineId.localeCompare(right.shipmentLineId))
      .map((line) => ({
        ...line,
        evidence: line.evidence ? [...line.evidence].sort() : null,
      })),
  }))
  .digest("hex");

export const buildShipmentRequestHash = (payload) =>
  createHash("sha256").update(JSON.stringify(payload)).digest("hex");

export const remainingApprovedQuantity = (line) =>
  Math.max(0, Number(line.approvedQuantity || 0) - Number(line.dispatchedQuantity || 0) - Number(line.reservedShipmentQuantity || 0));

export const planCostLayerAllocations = (layers, quantity) => {
  const requestedQuantity = Number(quantity);
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0) {
    throw fail("Cost-layer allocation quantity must be a positive whole number.");
  }
  let remaining = requestedQuantity;
  const allocations = [];
  for (const layer of layers) {
    const availableQuantity = Number(layer.availableQuantity);
    if (!Number.isSafeInteger(availableQuantity) || availableQuantity < 0) {
      throw fail("Cost-layer availability must be a non-negative whole number.", "INVALID_COST_LAYER", 409);
    }
    const allocatedQuantity = Math.min(remaining, availableQuantity);
    if (allocatedQuantity > 0) {
      allocations.push({ costLayerId: layer.id, quantity: allocatedQuantity });
      remaining -= allocatedQuantity;
    }
    if (!remaining) break;
  }
  return { allocations, uncostedQuantity: remaining };
};

export const deriveTransferStatus = ({ lines, shipmentLines }) => {
  const hasDispatched = lines.some((line) => Number(line.dispatchedQuantity || 0) > 0);
  const hasPendingBooking = lines.some((line) => Number(line.reservedShipmentQuantity || 0) > 0);
  const hasApprovedRemaining = lines.some((line) => remainingApprovedQuantity(line) > 0);
  const totalDispatched = lines.reduce((sum, line) => sum + Number(line.dispatchedQuantity || 0), 0);
  const totalAccounted = shipmentLines.reduce(
    (sum, line) => sum + Number(line.goodQuantity || 0) + Number(line.damagedQuantity || 0) + Number(line.missingQuantity || 0),
    0,
  );
  const hasOpenDiscrepancy = shipmentLines.some((line) => Number(line.damagedQuantity || 0) + Number(line.missingQuantity || 0) > 0);
  if (hasPendingBooking) return "IN_TRANSIT";
  if (hasApprovedRemaining) return hasDispatched ? "IN_TRANSIT" : "APPROVED";
  if (totalAccounted < totalDispatched) return totalAccounted > 0 ? "PARTIALLY_RECEIVED" : "IN_TRANSIT";
  if (hasOpenDiscrepancy) return "DISCREPANCY";
  return "RECEIVED";
};
