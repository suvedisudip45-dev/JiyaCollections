const MAX_QUANTITY = 2147483647;
const MIN_INT32 = -2147483648;

const TRANSFER_STATUSES = new Set([
  "PENDING_ADMIN_APPROVAL",
  "APPROVED",
  "REJECTED",
  "IN_TRANSIT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "DISCREPANCY",
  "CANCELLED",
]);
const DISPATCH_STATUSES = new Set([
  "DISPATCHED",
  "PARTIALLY_RECEIVED",
  "DELIVERED",
  "DISCREPANCY",
  "LOST",
]);
const BOOKING_STATUSES = new Set([
  "PREPARING",
  "BOOKING_PENDING",
  "BOOKING_UNKNOWN",
  "BOOKED",
]);
const RECEIPT_STATUSES = new Set(["CONFIRMED", "DISPUTED"]);
const COST_EVIDENCE_CLASSIFICATIONS = new Set([
  "VERIFIED_RECEIVED_COST",
  "HISTORICAL_COST_SNAPSHOT",
  "REFERENCE_OR_CATALOG_COST",
  "ESTIMATE",
  "UNRECONCILED",
  "MISSING",
]);
const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
const REQUIRED_SOURCES = [
  "transfers",
  "shipments",
  "receipts",
  "discrepancies",
  "ledgerEntries",
  "balances",
  "locations",
];

const readQuantity = (value, { signed = false, positive = false } = {}) => {
  let integer;
  if (typeof value === "bigint") {
    integer = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return null;
    integer = BigInt(value);
  } else if (typeof value === "string" && /^-?(0|[1-9]\d*)$/.test(value)) {
    try {
      integer = BigInt(value);
    } catch {
      return null;
    }
  } else {
    return null;
  }

  const minimum = signed ? BigInt(MIN_INT32) : BigInt(0);
  if (integer < minimum || integer > BigInt(MAX_QUANTITY) || (positive && integer <= 0n)) {
    return null;
  }
  return Number(integer);
};

const cleanId = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const cleanStatus = (value) => String(value || "").trim().toUpperCase();
const hasTimestamp = (value) => value instanceof Date
  ? Number.isFinite(value.getTime())
  : typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
const canonicalTimestamp = (value) => {
  const timestamp = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
};
const validCostAmount = (value) => (
  /^(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(
    typeof value === "string" || typeof value === "number" ||
      (value && typeof value.toString === "function" && value.constructor?.name === "Decimal")
      ? String(value)
      : ""
  )
);
const quantitySum = (values) => {
  let total = 0n;
  for (const value of values) total += BigInt(value);
  return total >= BigInt(Number.MIN_SAFE_INTEGER) && total <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(total)
    : null;
};
const strictQuantitySum = (values) => (
  values.some((value) => value === null || value === undefined) ? null : quantitySum(values)
);
const locationSkuKey = (locationId, inventorySkuId) => JSON.stringify([locationId, inventorySkuId]);

const validMovementFields = (entry, expected) => (
  entry.movementType === expected.movementType &&
  entry.inventorySkuId === expected.inventorySkuId &&
  entry.sourceLocationId === expected.sourceLocationId &&
  entry.destinationLocationId === expected.destinationLocationId &&
  entry.referenceType === expected.referenceType &&
  entry.referenceId === expected.referenceId &&
  entry.inventoryOwner === "PLATFORM" &&
  readQuantity(entry.quantity, { positive: true }) !== null
);

/**
 * Reconciles already-loaded StockTransfer records against their shipment,
 * receipt, ledger, location, and balance snapshots. Quantities follow Prisma
 * Int semantics; all required source-completeness flags must be supplied.
 */
export const reconcileStockTransfers = (input = {}) => {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const missingSources = REQUIRED_SOURCES.filter((name) => !Array.isArray(source[name]));
  const arrays = Object.fromEntries(REQUIRED_SOURCES.map((name) => [
    name,
    Array.isArray(source[name]) ? source[name] : [],
  ]));
  const sourceErrors = Array.isArray(source.sourceErrors)
    ? source.sourceErrors.map((value) => cleanId(value)).filter(Boolean).sort()
    : [];
  const coverage = Object.fromEntries(REQUIRED_SOURCES.map((name) => [
    name,
    Array.isArray(source[name]) && source.coverage?.[name] === true,
  ]));
  coverage.costLayers = Array.isArray(source.costLayers) && source.coverage?.costLayers === true;
  coverage.costEvidence = Array.isArray(source.costEvidence) && source.coverage?.costEvidence === true;
  const coverageComplete = () => REQUIRED_SOURCES.every((name) => coverage[name]);
  let incomplete = missingSources.length > 0 || !coverageComplete();

  const exceptionsByKey = new Map();
  const matchedLedgerIds = new Set();
  const addException = ({
    code,
    severity = "MEDIUM",
    transferId = null,
    transferLineId = null,
    shipmentId = null,
    shipmentLineId = null,
    receiptId = null,
    receiptLineId = null,
    relatedTransferIds = [],
    relatedShipmentIds = [],
    discrepancyIds = [],
    ledgerEntryIds = [],
    expectedQuantity = null,
    actualQuantity = null,
    explanation,
  }) => {
    const sources = [...new Set(ledgerEntryIds.filter(Boolean))].sort();
    const discrepancies = [...new Set(discrepancyIds.filter(Boolean))].sort();
    const relatedTransfers = [...new Set(relatedTransferIds.filter(Boolean))].sort();
    const relatedShipments = [...new Set(relatedShipmentIds.filter(Boolean))].sort();
    const exceptionKey = [
      code,
      transferId || "",
      transferLineId || "",
      shipmentId || "",
      shipmentLineId || "",
      receiptId || "",
      receiptLineId || "",
      relatedTransfers.join(","),
      relatedShipments.join(","),
      discrepancies.join(","),
      sources.join(","),
    ].join("|");
    if (!exceptionsByKey.has(exceptionKey)) {
      exceptionsByKey.set(exceptionKey, {
        exceptionKey,
        code,
        severity,
        transferId,
        transferLineId,
        shipmentId,
        shipmentLineId,
        receiptId,
        receiptLineId,
        ...(relatedTransfers.length ? { relatedTransferIds: relatedTransfers } : {}),
        ...(relatedShipments.length ? { relatedShipmentIds: relatedShipments } : {}),
        discrepancyIds: discrepancies,
        ledgerEntryIds: sources,
        expectedQuantity,
        actualQuantity,
        explanation,
        investigationStatus: code === "INSUFFICIENT_EVIDENCE" ? "INCOMPLETE" : "REQUIRES_INVESTIGATION",
      });
    }
    if (code === "INSUFFICIENT_EVIDENCE" || code === "DUPLICATE_TRANSFER_IDENTIFIER") {
      incomplete = true;
    }
  };

  for (const name of missingSources) {
    addException({
      code: "INSUFFICIENT_EVIDENCE",
      severity: "MEDIUM",
      explanation: `The ${name} source was not supplied; no quantity was assumed for that source.`,
    });
  }
  for (const name of REQUIRED_SOURCES.filter((item) => !coverage[item] && !missingSources.includes(item))) {
    addException({
      code: "INSUFFICIENT_EVIDENCE",
      severity: "MEDIUM",
      explanation: `The ${name} snapshot is not declared complete; comparisons depending on it are incomplete.`,
    });
  }
  for (const name of sourceErrors) {
    addException({
      code: "INSUFFICIENT_EVIDENCE",
      severity: "HIGH",
      explanation: `The ${name} source was unavailable; its values were not treated as zero.`,
    });
  }

  const transferById = new Map();
  const transferLineById = new Map();
  const duplicateTransferIds = new Set();
  const transferRecordsById = new Map();
  for (const transfer of arrays.transfers) {
    const transferId = cleanId(transfer?.id);
    if (!transferId) continue;
    const records = transferRecordsById.get(transferId) || [];
    records.push(transfer);
    transferRecordsById.set(transferId, records);
  }
  for (const [transferId, records] of transferRecordsById) {
    if (records.length > 1) {
      duplicateTransferIds.add(transferId);
      addException({
        code: "DUPLICATE_TRANSFER_IDENTIFIER",
        severity: "HIGH",
        transferId,
        relatedTransferIds: [transferId],
        actualQuantity: records.length,
        explanation: "The supplied transfer snapshot contains multiple records with the same stable transfer identifier; their contents are not merged.",
      });
    }
  }
  for (const transfer of arrays.transfers) {
    const transferId = cleanId(transfer?.id);
    if (!transferId) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        explanation: "A transfer record has no stable identifier.",
      });
      continue;
    }
    if (duplicateTransferIds.has(transferId)) continue;
    if (transferById.has(transferId)) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        explanation: "More than one transfer snapshot has the same identifier.",
      });
      continue;
    }
    transferById.set(transferId, transfer);
    if (!Array.isArray(transfer.lines)) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        explanation: "Transfer lines were not supplied.",
      });
      continue;
    }

    if (transfer.lines.length === 0) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        explanation: "The transfer has no authorization lines to reconcile.",
      });
    }
    for (const line of transfer.lines) {
      const transferLineId = cleanId(line?.id);
      if (!transferLineId) {
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          transferId,
          explanation: "A transfer line has no stable identifier.",
        });
        continue;
      }
      if (transferLineById.has(transferLineId)) {
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          transferId,
          transferLineId,
          explanation: "More than one transfer line snapshot has the same identifier.",
        });
        continue;
      }
      transferLineById.set(transferLineId, { transfer, line });
    }
  }

  const duplicateCandidates = new Map();
  for (const [transferId, transfer] of transferById) {
    const requestedAt = canonicalTimestamp(transfer.requestedAt);
    const requesterId = cleanId(transfer.requestedByAccountId);
    const lines = Array.isArray(transfer.lines) ? transfer.lines : null;
    const normalizedLines = lines?.map((line) => ({
      inventorySkuId: cleanId(line?.inventorySkuId),
      requestedQuantity: readQuantity(line?.requestedQuantity, { positive: true }),
    }));
    const duplicateFieldsComplete = Boolean(
      requestedAt &&
      requesterId &&
      cleanId(transfer.manufacturerId) &&
      cleanId(transfer.distributorId) &&
      cleanId(transfer.sourceLocationId) &&
      cleanId(transfer.destinationLocationId) &&
      normalizedLines?.length &&
      normalizedLines.every((line) => line.inventorySkuId && line.requestedQuantity !== null) &&
      new Set(normalizedLines.map((line) => line.inventorySkuId)).size === normalizedLines.length
    );
    if (!duplicateFieldsComplete) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        relatedTransferIds: [transferId],
        explanation: "Potential-duplicate comparison requires request time, requester, both parties, source/destination locations, and complete unique SKU/quantity lines.",
      });
      continue;
    }
    normalizedLines.sort((left, right) =>
      left.inventorySkuId.localeCompare(right.inventorySkuId) ||
      left.requestedQuantity - right.requestedQuantity
    );
    const fingerprint = JSON.stringify([
      requestedAt,
      requesterId,
      cleanId(transfer.manufacturerId),
      cleanId(transfer.distributorId),
      cleanId(transfer.sourceLocationId),
      cleanId(transfer.destinationLocationId),
      normalizedLines,
    ]);
    const matches = duplicateCandidates.get(fingerprint) || [];
    matches.push(transferId);
    duplicateCandidates.set(fingerprint, matches);
  }
  for (const transferIds of duplicateCandidates.values()) {
    if (transferIds.length < 2) continue;
    addException({
      code: "POSSIBLE_DUPLICATE_TRANSFER",
      severity: "LOW",
      transferId: [...transferIds].sort()[0],
      relatedTransferIds: transferIds,
      explanation: "Transfers have identical requester, request timestamp, parties, locations, source references, and requested SKU quantities. This is a review candidate only; it is not proof of duplication.",
    });
  }

  const shipmentById = new Map();
  const shipmentLineById = new Map();
  const shipmentLinesByTransferLine = new Map();
  for (const shipment of arrays.shipments) {
    const shipmentId = cleanId(shipment?.id);
    const transferId = cleanId(shipment?.stockTransferId);
    if (!shipmentId || !transferId) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        shipmentId,
        explanation: "A shipment is missing its stable shipment or transfer identifier.",
      });
      continue;
    }
    if (shipmentById.has(shipmentId)) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        shipmentId,
        explanation: "More than one shipment snapshot has the same identifier.",
      });
      continue;
    }
    shipmentById.set(shipmentId, shipment);
    if (!transferById.has(transferId)) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        shipmentId,
        explanation: "The shipment references a transfer absent from the supplied transfer snapshot.",
      });
    }
    if (!Array.isArray(shipment.lines)) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        shipmentId,
        explanation: "Shipment lines were not supplied.",
      });
      continue;
    }
    for (const shipmentLine of shipment.lines) {
      const shipmentLineId = cleanId(shipmentLine?.id);
      const transferLineId = cleanId(shipmentLine?.stockTransferLineId);
      const transferLineRecord = transferLineById.get(transferLineId);
      if (!shipmentLineId || !transferLineId || shipmentLineById.has(shipmentLineId)) {
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          transferId,
          shipmentId,
          shipmentLineId,
          ...(relatedTransferIds.length ? { relatedTransferIds: [...new Set(relatedTransferIds)].sort() } : {}),
          ...(relatedShipmentIds.length ? { relatedShipmentIds: [...new Set(relatedShipmentIds)].sort() } : {}),
          explanation: "A shipment line has a missing or duplicate stable identifier/link.",
        });
        continue;
      }
      if (!transferLineRecord || transferLineRecord.transfer.id !== transferId) {
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          transferId,
          transferLineId,
          shipmentId,
          shipmentLineId,
          explanation: "The shipment line cannot be linked to a line on its stated transfer.",
        });
      }
      const state = {
        shipment,
        shipmentLine,
        transferId,
        shipmentId,
        shipmentLineId,
        transferLineId,
        transfer: transferLineRecord?.transfer || transferById.get(transferId) || null,
        transferLine: transferLineRecord?.line || null,
        receiptLines: [],
        receivedCostLayerLinks: [],
        receiptSourceComplete: true,
        receiptMovementComplete: true,
        reportedGood: 0n,
        reportedDamaged: 0n,
        reportedMissing: 0n,
        receiptLedgerQuantity: 0n,
      };
      shipmentLineById.set(shipmentLineId, state);
      const linked = shipmentLinesByTransferLine.get(transferLineId) || [];
      linked.push(state);
      shipmentLinesByTransferLine.set(transferLineId, linked);
    }
  }

  const shipmentsByBookingKey = new Map();
  for (const shipment of coverage.shipments ? arrays.shipments : []) {
    const bookingKey = cleanId(shipment?.bookingIdempotencyKey);
    if (!bookingKey) continue;
    const records = shipmentsByBookingKey.get(bookingKey) || [];
    records.push(shipment);
    shipmentsByBookingKey.set(bookingKey, records);
  }
  for (const [bookingKey, records] of shipmentsByBookingKey) {
    if (records.length < 2) continue;
    const transferIds = records.map((record) => cleanId(record.stockTransferId)).filter(Boolean);
    const shipmentIds = records.map((record) => cleanId(record.id)).filter(Boolean);
    const conflictingPayloads = new Set(records.map((record) => JSON.stringify([
      cleanId(record.stockTransferId),
      cleanId(record.bookingRequestHash),
      ...(Array.isArray(record.lines) ? record.lines.map((line) => [
        cleanId(line.stockTransferLineId),
        readQuantity(line.quantity, { positive: true }),
      ]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))) : []),
    ])));
    addException({
      code: "TRANSFER_IDEMPOTENCY_CONFLICT",
      severity: "HIGH",
      transferId: [...new Set(transferIds)].sort()[0] || null,
      relatedTransferIds: transferIds,
      relatedShipmentIds: shipmentIds,
      actualQuantity: records.length,
      explanation: conflictingPayloads.size > 1
        ? "A shipment booking idempotency key is associated with conflicting shipment payloads."
        : "A shipment booking idempotency key appears on multiple shipment records despite the schema's unique-key constraint.",
    });
  }

  const receiptById = new Map();
  const receiptLineById = new Map();
  const receiptLinkIncompleteTransferIds = new Set();
  for (const receipt of arrays.receipts) {
    const receiptId = cleanId(receipt?.id);
    const shipmentId = cleanId(receipt?.shipmentId);
    const receiptTransferId = cleanId(shipmentById.get(shipmentId)?.stockTransferId);
    if (!receiptId || !shipmentId || receiptById.has(receiptId)) {
      if (receiptTransferId) receiptLinkIncompleteTransferIds.add(receiptTransferId);
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        receiptId,
        shipmentId,
        explanation: "A receipt has a missing or duplicate stable identifier/link.",
      });
      continue;
    }
    receiptById.set(receiptId, receipt);
    const shipment = shipmentById.get(shipmentId);
    const linkedTransferId = cleanId(shipment?.stockTransferId);
    if (!shipment) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        receiptId,
        shipmentId,
        explanation: "The receipt references a shipment absent from the supplied snapshot.",
      });
    }
    if (!Array.isArray(receipt.lines)) {
      if (linkedTransferId) receiptLinkIncompleteTransferIds.add(linkedTransferId);
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        receiptId,
        shipmentId,
        explanation: "Receipt lines were not supplied.",
      });
      continue;
    }
    if (receipt.lines.length === 0 && linkedTransferId) {
      receiptLinkIncompleteTransferIds.add(linkedTransferId);
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId: linkedTransferId,
        receiptId,
        shipmentId,
        explanation: "The receipt has no receipt-line quantity records.",
      });
    }
    for (const receiptLine of receipt.lines) {
      const receiptLineId = cleanId(receiptLine?.id);
      const shipmentLineId = cleanId(receiptLine?.shipmentLineId);
      const shipmentLineState = shipmentLineById.get(shipmentLineId);
      if (!receiptLineId || !shipmentLineId || receiptLineById.has(receiptLineId)) {
        if (linkedTransferId) receiptLinkIncompleteTransferIds.add(linkedTransferId);
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          receiptId,
          shipmentId,
          receiptLineId,
          shipmentLineId,
          explanation: "A receipt line has a missing or duplicate stable identifier/link.",
        });
        continue;
      }
      if (!shipmentLineState || shipmentLineState.shipmentId !== shipmentId) {
        if (linkedTransferId) receiptLinkIncompleteTransferIds.add(linkedTransferId);
        if (shipmentLineState?.transferId) {
          receiptLinkIncompleteTransferIds.add(shipmentLineState.transferId);
        }
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          receiptId,
          shipmentId,
          receiptLineId,
          shipmentLineId,
          explanation: "The receipt line cannot be linked to a shipment line on its stated shipment.",
        });
      } else {
        shipmentLineState.receiptLines.push({ receipt, receiptLine });
      }
      receiptLineById.set(receiptLineId, { receipt, receiptLine, shipmentLineState });
    }
  }

  const locationById = new Map();
  const locationByKey = new Map();
  const ambiguousLocationKeys = new Set();
  for (const location of arrays.locations) {
    const locationId = cleanId(location?.id);
    if (!locationId || locationById.has(locationId)) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        explanation: "A location has a missing or duplicate stable identifier.",
      });
      continue;
    }
    locationById.set(locationId, location);
    const locationKey = cleanId(location.locationKey);
    if (locationKey) {
      if (locationByKey.has(locationKey) || ambiguousLocationKeys.has(locationKey)) {
        locationByKey.delete(locationKey);
        ambiguousLocationKeys.add(locationKey);
      } else {
        locationByKey.set(locationKey, location);
      }
    }
  }

  const costLayerById = new Map();
  const conflictingCostLayerIds = new Set();
  for (const layer of Array.isArray(source.costLayers) ? source.costLayers : []) {
    const costLayerId = cleanId(layer?.id);
    if (!costLayerId) continue;
    if (!costLayerById.has(costLayerId)) {
      costLayerById.set(costLayerId, layer);
      continue;
    }
    const existing = costLayerById.get(costLayerId);
    const layerIdentity = JSON.stringify([
      cleanId(layer.inventorySkuId),
      cleanId(layer.manufacturerId),
      String(layer.unitCogs ?? ""),
      readQuantity(layer.producedQuantity),
    ]);
    const existingIdentity = JSON.stringify([
      cleanId(existing.inventorySkuId),
      cleanId(existing.manufacturerId),
      String(existing.unitCogs ?? ""),
      readQuantity(existing.producedQuantity),
    ]);
    if (layerIdentity !== existingIdentity) {
      costLayerById.delete(costLayerId);
      conflictingCostLayerIds.add(costLayerId);
    }
  }
  for (const costLayerId of conflictingCostLayerIds) {
    addException({
      code: "INSUFFICIENT_EVIDENCE",
      explanation: `Cost layer ${costLayerId} has conflicting source records; it was not used for coverage.`,
    });
  }
  const validCostLayerFor = (costLayerId, transfer, transferLine) => {
    if (conflictingCostLayerIds.has(cleanId(costLayerId))) return null;
    const layer = costLayerById.get(cleanId(costLayerId));
    if (!layer || !transfer || !transferLine ||
        cleanId(layer.inventorySkuId) !== cleanId(transferLine.inventorySkuId) ||
        cleanId(layer.manufacturerId) !== cleanId(transfer.manufacturerId) ||
        !validCostAmount(layer.unitCogs)) {
      return null;
    }
    return layer;
  };

  const ledgerEntriesByKey = new Map();
  const ledgerRows = [];
  for (const entry of arrays.ledgerEntries) {
    const ledgerEntryId = cleanId(entry?.id);
    const idempotencyKey = cleanId(entry?.idempotencyKey);
    const parsedQuantity = readQuantity(entry?.quantity, { positive: true });
    const row = { entry, ledgerEntryId, idempotencyKey, quantity: parsedQuantity };
    ledgerRows.push(row);
    if (idempotencyKey) {
      const records = ledgerEntriesByKey.get(idempotencyKey) || [];
      records.push(row);
      ledgerEntriesByKey.set(idempotencyKey, records);
    }
    if (!ledgerEntryId || !idempotencyKey) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        ledgerEntryIds: [ledgerEntryId],
        explanation: "A ledger movement is missing its stable record or idempotency identifier.",
      });
    }
    if (parsedQuantity === null) {
      incomplete = true;
      addException({
        code: "QUANTITY_MISMATCH",
        transferId: cleanId(entry?.referenceType) === "STOCK_TRANSFER" ? cleanId(entry?.referenceId) : null,
        receiptId: cleanId(entry?.referenceType) === "STOCK_TRANSFER_RECEIPT" ? cleanId(entry?.referenceId) : null,
        ledgerEntryIds: [ledgerEntryId],
        actualQuantity: null,
        explanation: "A ledger movement quantity is not a positive Prisma Int quantity.",
      });
    }
  }

  for (const [idempotencyKey, rows] of ledgerEntriesByKey) {
    if (rows.length > 1) {
      const transferRow = rows.find(({ entry }) => cleanId(entry.referenceType) === "STOCK_TRANSFER");
      const receiptRow = rows.find(({ entry }) => cleanId(entry.referenceType) === "STOCK_TRANSFER_RECEIPT");
      addException({
        code: "DUPLICATE_MOVEMENT",
        transferId: transferRow ? cleanId(transferRow.entry.referenceId) : null,
        receiptId: receiptRow ? cleanId(receiptRow.entry.referenceId) : null,
        ledgerEntryIds: rows.map((row) => row.ledgerEntryId),
        actualQuantity: quantitySum(rows.map((row) => row.quantity).filter((value) => value !== null)),
        explanation: `Idempotency key ${idempotencyKey} appears more than once in the supplied ledger snapshot.`,
      });
    }
  }

  const balanceByKey = new Map();
  for (const balance of arrays.balances) {
    const locationId = cleanId(balance?.locationId);
    const inventorySkuId = cleanId(balance?.inventorySkuId);
    const key = locationSkuKey(locationId, inventorySkuId);
    const entries = balanceByKey.get(key) || [];
    entries.push(balance);
    balanceByKey.set(key, entries);
    const quantity = readQuantity(balance?.quantityOnHand, { signed: true });
    const reservedQuantity = readQuantity(balance?.reservedQuantity);
    if (!locationId || !inventorySkuId || quantity === null || reservedQuantity === null) {
      incomplete = true;
      addException({
        code: "QUANTITY_MISMATCH",
        actualQuantity: quantity,
        explanation: "A balance snapshot has a missing key or an invalid on-hand/reserved Prisma Int quantity.",
      });
    }
    if (quantity !== null && quantity < 0) {
      addException({
        code: "BALANCE_MISMATCH",
        actualQuantity: quantity,
        explanation: "A current inventory balance is negative.",
      });
    }
  }
  for (const [key, rows] of balanceByKey) {
    if (rows.length > 1) {
      const [locationId, inventorySkuId] = JSON.parse(key);
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        explanation: `More than one balance snapshot exists for location ${locationId} and SKU ${inventorySkuId}.`,
      });
    }
  }

  const dispatchLink = (shipmentState) => {
    const { transfer, transferLine, shipment, shipmentLine, shipmentId, shipmentLineId } = shipmentState;
    const transferId = cleanId(shipment.stockTransferId);
    const skuId = cleanId(transferLine?.inventorySkuId);
    const transit = locationByKey.get(`IN_TRANSIT:${shipmentId}`);
    const sourceLocation = locationById.get(cleanId(transfer?.sourceLocationId));
    const transferDestination = locationById.get(cleanId(transfer?.destinationLocationId));
    const status = cleanStatus(shipment.status);
    const statusSuggestsDispatch = DISPATCH_STATUSES.has(status);
    const key = skuId ? `stock-transfer:${shipmentId}:dispatch:${skuId}` : null;
    const keyRows = key ? (ledgerEntriesByKey.get(key) || []) : [];
    const transitId = cleanId(transit?.id);
    const expected = {
      movementType: "TRANSFER_DISPATCH",
      inventorySkuId: skuId,
      sourceLocationId: cleanId(transfer?.sourceLocationId),
      destinationLocationId: transitId,
      referenceType: "STOCK_TRANSFER",
      referenceId: transferId,
    };
    const validRows = keyRows.filter((row) => (
      row.quantity !== null &&
      validMovementFields(row.entry, expected) &&
      row.idempotencyKey === key
    ));
    const semanticRows = transitId
      ? ledgerRows.filter(({ entry }) => (
          entry.movementType === "TRANSFER_DISPATCH" &&
          entry.inventorySkuId === skuId &&
          entry.sourceLocationId === expected.sourceLocationId &&
          entry.destinationLocationId === transitId &&
          entry.referenceType === "STOCK_TRANSFER" &&
          entry.referenceId === transferId
        ))
      : [];
    const duplicate = semanticRows.length > 1 || validRows.length > 1;
    if (duplicate) {
      for (const row of semanticRows) matchedLedgerIds.add(row.ledgerEntryId);
      addException({
        code: "DUPLICATE_MOVEMENT",
        severity: "HIGH",
        transferId,
        transferLineId: shipmentState.transferLineId,
        shipmentId,
        shipmentLineId,
        ledgerEntryIds: semanticRows.map(({ ledgerEntryId }) => ledgerEntryId),
        expectedQuantity: readQuantity(shipmentLine.quantity, { positive: true }),
        actualQuantity: quantitySum(semanticRows.map((row) => row.quantity).filter((value) => value !== null)),
        explanation: "Multiple dispatch movements match one shipment-line movement slot; they were not summed as a valid dispatch.",
      });
    }
    if (semanticRows.length > 0 && validRows.length === 0 && !duplicate) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        transferLineId: shipmentState.transferLineId,
        shipmentId,
        shipmentLineId,
        ledgerEntryIds: semanticRows.map(({ ledgerEntryId }) => ledgerEntryId),
        explanation: "A dispatch movement references this transfer and SKU but cannot be assigned by the expected shipment idempotency key.",
      });
    }
    if (!transit || transit.kind !== "IN_TRANSIT" || transit.inventoryOwner !== "PLATFORM") {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        transferLineId: shipmentState.transferLineId,
        shipmentId,
        shipmentLineId,
        explanation: "The shipment-specific PLATFORM transit location cannot be verified from the supplied location snapshot.",
      });
    }
    if (!sourceLocation || sourceLocation.kind !== "FACTORY" ||
        sourceLocation.inventoryOwner !== "PLATFORM" ||
        !transferDestination || transferDestination.kind !== "DISTRIBUTOR" ||
        transferDestination.inventoryOwner !== "PLATFORM") {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        transferLineId: shipmentState.transferLineId,
        shipmentId,
        shipmentLineId,
        explanation: "The PLATFORM factory source or PLATFORM distributor destination cannot be verified.",
      });
    }
    if (keyRows.some((row) => row.quantity === null || !validMovementFields(row.entry, expected))) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        transferLineId: shipmentState.transferLineId,
        shipmentId,
        shipmentLineId,
        ledgerEntryIds: keyRows.map((row) => row.ledgerEntryId),
        explanation: "A movement with the expected dispatch key has conflicting SKU, location, owner, reference, type, or quantity fields.",
      });
    }
    const entry = !duplicate && validRows.length === 1 ? validRows[0] : null;
    if (entry) {
      matchedLedgerIds.add(entry.ledgerEntryId);
      if (!hasTimestamp(shipment.dispatchedAt)) {
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          transferId,
          transferLineId: shipmentState.transferLineId,
          shipmentId,
          shipmentLineId,
          ledgerEntryIds: [entry.ledgerEntryId],
          explanation: "A dispatch movement is linked, but the shipment dispatch timestamp is absent.",
        });
      }
      if (!cleanId(entry.entry.actorId) || !cleanId(entry.entry.actorRole)) {
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          transferId,
          transferLineId: shipmentState.transferLineId,
          shipmentId,
          shipmentLineId,
          ledgerEntryIds: [entry.ledgerEntryId],
          explanation: "The linked dispatch movement has no actor identity or role.",
        });
      }
    }
    if (entry && coverage.receipts && shipmentState.receiptLines.length === 0 &&
        !receiptLinkIncompleteTransferIds.has(transferId)) {
      addException({
        code: "MISSING_RECEIPT",
        severity: "MEDIUM",
        transferId,
        transferLineId: shipmentState.transferLineId,
        shipmentId,
        shipmentLineId,
        expectedQuantity: entry.quantity,
        actualQuantity: 0,
        ledgerEntryIds: [entry.ledgerEntryId],
        explanation: "A uniquely linked dispatch movement has no linked receipt-line record.",
      });
    }
    if (hasTimestamp(shipment.dispatchedAt) && !entry && coverage.ledgerEntries) {
      addException({
        code: "DISPATCH_WITHOUT_LEDGER_ENTRY",
        severity: "HIGH",
        transferId,
        transferLineId: shipmentState.transferLineId,
        shipmentId,
        shipmentLineId,
        expectedQuantity: readQuantity(shipmentLine.quantity, { positive: true }),
        actualQuantity: 0,
        ledgerEntryIds: keyRows.map((row) => row.ledgerEntryId),
        explanation: "The shipment has a dispatch timestamp but no uniquely matched dispatch movement.",
      });
    } else if (statusSuggestsDispatch && !hasTimestamp(shipment.dispatchedAt) && !entry) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        transferLineId: shipmentState.transferLineId,
        shipmentId,
        shipmentLineId,
        explanation: "Shipment status suggests dispatch, but status alone does not establish a dispatch movement or timestamp.",
      });
    }
    if (entry && entry.quantity !== readQuantity(shipmentLine.quantity, { positive: true })) {
      addException({
        code: "QUANTITY_MISMATCH",
        transferId,
        transferLineId: shipmentState.transferLineId,
        shipmentId,
        shipmentLineId,
        ledgerEntryIds: [entry.ledgerEntryId],
        expectedQuantity: readQuantity(shipmentLine.quantity, { positive: true }),
        actualQuantity: entry.quantity,
        explanation: "The matched dispatch movement quantity differs from the shipment-line quantity.",
      });
    }
    if (status === "CANCELLED" && (entry || hasTimestamp(shipment.dispatchedAt))) {
      addException({
        code: "CANCELLED_WITH_RECORDED_MOVEMENT",
        severity: "HIGH",
        transferId,
        transferLineId: shipmentState.transferLineId,
        shipmentId,
        shipmentLineId,
        ledgerEntryIds: entry ? [entry.ledgerEntryId] : [],
        expectedQuantity: readQuantity(shipmentLine.quantity, { positive: true }),
        actualQuantity: entry?.quantity ?? null,
        explanation: "A cancelled shipment retains evidence of dispatch; cancellation does not reverse or erase stock movement.",
      });
    }
    if (BOOKING_STATUSES.has(status) && (entry || hasTimestamp(shipment.dispatchedAt))) {
      addException({
        code: "INVALID_STATUS_TRANSITION",
        severity: "HIGH",
        transferId,
        transferLineId: shipmentState.transferLineId,
        shipmentId,
        shipmentLineId,
        ledgerEntryIds: entry ? [entry.ledgerEntryId] : [],
        expectedQuantity: 0,
        actualQuantity: entry?.quantity ?? null,
        explanation: "A booking-only shipment status conflicts with recorded dispatch evidence.",
      });
    }
    return {
      quantity: readQuantity(shipmentLine.quantity, { positive: true }),
      entry,
      duplicate,
      evidence: Boolean(entry) || hasTimestamp(shipment.dispatchedAt),
      linkComplete: Boolean(entry) && !duplicate,
    };
  };

  const receiptMovementLink = (receiptState) => {
    const { receipt, receiptLine, shipmentLineState } = receiptState;
    const receiptId = cleanId(receipt.id);
    const shipmentId = cleanId(receipt.shipmentId);
    const shipmentLineId = cleanId(receiptLine.shipmentLineId);
    const transfer = shipmentLineState?.transfer;
    const transferLine = shipmentLineState?.transferLine;
    const transferId = cleanId(transfer?.id);
    const transferLineId = cleanId(transferLine?.id);
    const skuId = cleanId(transferLine?.inventorySkuId);
    const transit = locationByKey.get(`IN_TRANSIT:${shipmentId}`);
    const destination = transfer?.destinationLocationId
      ? locationById.get(transfer.destinationLocationId)
      : null;
    const findUniqueLocation = (kind) => {
      const matches = arrays.locations.filter((location) =>
        location.kind === kind &&
        location.distributorId === transfer?.distributorId &&
        location.inventoryOwner === "PLATFORM"
      );
      return matches.length === 1 ? matches[0] : null;
    };
    const damageLocation = findUniqueLocation("DAMAGED");
    const lostLocation = findUniqueLocation("LOST");
    const transitId = cleanId(transit?.id);
    const expectedSource = transitId;
    const expectedDest = cleanId(destination?.id);
    if (!transit || transit.kind !== "IN_TRANSIT" || transit.inventoryOwner !== "PLATFORM" ||
        !destination || destination.kind !== "DISTRIBUTOR" || destination.inventoryOwner !== "PLATFORM") {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        transferLineId,
        shipmentId,
        shipmentLineId,
        receiptId,
        receiptLineId: cleanId(receiptLine.id),
        explanation: "The receipt transit or PLATFORM distributor destination location cannot be verified.",
      });
      if (shipmentLineState) shipmentLineState.receiptMovementComplete = false;
    }
    const quantities = {
      good: readQuantity(receiptLine.goodQuantity),
      damaged: readQuantity(receiptLine.damagedQuantity),
      missing: readQuantity(receiptLine.missingQuantity),
    };
    const parsedReceipt = Object.values(quantities).every((value) => value !== null)
      ? quantities
      : null;
    if (!parsedReceipt) {
      addException({
        code: "QUANTITY_MISMATCH",
        transferId,
        transferLineId,
        shipmentId,
        shipmentLineId,
        receiptId,
        receiptLineId: cleanId(receiptLine.id),
        explanation: "A receipt quantity is not a non-negative Prisma Int quantity.",
      });
      if (shipmentLineState) shipmentLineState.receiptSourceComplete = false;
    }
    if (!cleanId(receipt.receivedBy) || !hasTimestamp(receipt.receivedAt)) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        transferLineId,
        shipmentId,
        shipmentLineId,
        receiptId,
        receiptLineId: cleanId(receiptLine.id),
        explanation: "The receipt is missing a receiving actor or valid receipt timestamp.",
      });
    }
    const status = cleanStatus(receipt.status);
    if (!RECEIPT_STATUSES.has(status)) {
      addException({
        code: "INVALID_STATUS_TRANSITION",
        severity: "HIGH",
        transferId,
        transferLineId,
        shipmentId,
        shipmentLineId,
        receiptId,
        receiptLineId: cleanId(receiptLine.id),
        explanation: `Receipt status ${status || "(missing)"} is not a supported receipt state.`,
      });
    }
    if (parsedReceipt) {
      const total = parsedReceipt.good + parsedReceipt.damaged + parsedReceipt.missing;
      if (total <= 0) {
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          shipmentId,
          shipmentLineId,
          receiptId,
          receiptLineId: cleanId(receiptLine.id),
          expectedQuantity: 1,
          actualQuantity: total,
          explanation: "A stored receipt line must record at least one good, damaged, or missing unit.",
        });
      }
      const shouldBeDisputed = parsedReceipt.damaged > 0 || parsedReceipt.missing > 0;
      if ((status === "DISPUTED") !== shouldBeDisputed) {
        addException({
          code: "INVALID_STATUS_TRANSITION",
          severity: "HIGH",
          transferId,
          transferLineId,
          shipmentId,
          shipmentLineId,
          receiptId,
          receiptLineId: cleanId(receiptLine.id),
          expectedQuantity: total,
          actualQuantity: total,
          explanation: "Receipt status does not agree with the recorded damaged/missing quantities.",
        });
      }
      if (shipmentLineState) {
        shipmentLineState.reportedGood += BigInt(parsedReceipt.good);
        shipmentLineState.reportedDamaged += BigInt(parsedReceipt.damaged);
        shipmentLineState.reportedMissing += BigInt(parsedReceipt.missing);
      }
    } else if (shipmentLineState) {
        shipmentLineState.receiptSourceComplete = false;
    }

    const movementSpecs = [
      {
        category: "good",
        quantity: parsedReceipt?.good ?? null,
        movementType: "TRANSFER_RECEIPT",
        destinationLocationId: expectedDest,
        prefixes: [
          `stock-transfer:${receiptId}:${shipmentLineId}:good:`,
          `stock-transfer:${receiptId}:${shipmentLineId}:own-store:`,
        ],
      },
      {
        category: "damaged",
        quantity: parsedReceipt?.damaged ?? null,
        movementType: "DAMAGE",
        destinationLocationId: cleanId(damageLocation?.id),
        exactKey: `stock-transfer:${receiptId}:${shipmentLineId}:damaged`,
      },
      {
        category: "missing",
        quantity: parsedReceipt?.missing ?? null,
        movementType: "LOSS",
        destinationLocationId: cleanId(lostLocation?.id),
        exactKey: `stock-transfer:${receiptId}:${shipmentLineId}:missing`,
      },
    ];
    let totalLedgerQuantity = 0n;
    let movementComplete = Boolean(
      parsedReceipt && expectedSource && expectedDest &&
      coverage.ledgerEntries && coverage.locations
    );
    for (const spec of movementSpecs) {
      if (spec.quantity === null) {
        movementComplete = false;
        continue;
      }
      const prefixMatches = spec.prefixes
        ? ledgerRows.filter(({ idempotencyKey }) => spec.prefixes.some((prefix) => idempotencyKey?.startsWith(prefix)))
        : ledgerEntriesByKey.get(spec.exactKey) || [];
      const matchingKeyRows = prefixMatches.filter(({ entry }) => (
        entry.referenceType === "STOCK_TRANSFER_RECEIPT" &&
        entry.referenceId === receiptId &&
        entry.inventorySkuId === skuId
      ));
      for (const row of matchingKeyRows) matchedLedgerIds.add(row.ledgerEntryId);
      const validRows = matchingKeyRows.filter(({ entry, quantity, idempotencyKey }) => (
        quantity !== null &&
        spec.destinationLocationId &&
        validMovementFields(entry, {
          movementType: spec.movementType,
          inventorySkuId: skuId,
          sourceLocationId: expectedSource,
          destinationLocationId: spec.destinationLocationId,
          referenceType: "STOCK_TRANSFER_RECEIPT",
          referenceId: receiptId,
        }) &&
        (spec.prefixes
          ? spec.prefixes.some((prefix) => idempotencyKey?.startsWith(prefix))
          : idempotencyKey === spec.exactKey)
      ));
      const expectedDuplicateKey = new Map();
      for (const row of validRows) {
        const duplicatePart = spec.category === "good"
          ? row.entry.productionCostLayerId || "uncosted"
          : spec.category;
        const group = expectedDuplicateKey.get(duplicatePart) || [];
        group.push(row);
        expectedDuplicateKey.set(duplicatePart, group);
      }
      const duplicateRows = [...expectedDuplicateKey.values()].flatMap((rows) => rows.length > 1 ? rows : []);
      if (duplicateRows.length) {
        addException({
          code: "DUPLICATE_MOVEMENT",
          severity: "HIGH",
          transferId,
          transferLineId,
          shipmentId,
          shipmentLineId,
          receiptId,
          receiptLineId: cleanId(receiptLine.id),
          ledgerEntryIds: duplicateRows.map((row) => row.ledgerEntryId),
          expectedQuantity: spec.quantity,
          actualQuantity: quantitySum(duplicateRows.map((row) => row.quantity).filter((value) => value !== null)),
          explanation: `Multiple ${spec.category} receipt movements occupy the same idempotency/cost-layer slot.`,
        });
        movementComplete = false;
      }
      if (matchingKeyRows.some((row) => row.quantity === null ||
          !validMovementFields(row.entry, {
            movementType: spec.movementType,
            inventorySkuId: skuId,
            sourceLocationId: expectedSource,
            destinationLocationId: spec.destinationLocationId,
            referenceType: "STOCK_TRANSFER_RECEIPT",
            referenceId: receiptId,
          }))) {
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          transferId,
          transferLineId,
          shipmentId,
          shipmentLineId,
          receiptId,
          receiptLineId: cleanId(receiptLine.id),
          ledgerEntryIds: matchingKeyRows.map((row) => row.ledgerEntryId),
          explanation: `A ${spec.category} receipt movement has conflicting type, SKU, location, owner, reference, or quantity fields.`,
        });
        movementComplete = false;
      }
      const usableRows = duplicateRows.length
        ? []
        : validRows;
      const actual = quantitySum(usableRows.map((row) => row.quantity));
      if (coverage.ledgerEntries && spec.quantity > 0 && (actual === null || actual !== spec.quantity)) {
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          shipmentId,
          shipmentLineId,
          receiptId,
          receiptLineId: cleanId(receiptLine.id),
          ledgerEntryIds: usableRows.map((row) => row.ledgerEntryId),
          expectedQuantity: spec.quantity,
          actualQuantity: actual,
          explanation: `The ${spec.category} receipt movement quantity does not match the recorded receipt quantity.`,
        });
        movementComplete = false;
      } else if (coverage.ledgerEntries && spec.quantity === 0 && usableRows.length > 0) {
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          shipmentId,
          shipmentLineId,
          receiptId,
          receiptLineId: cleanId(receiptLine.id),
          ledgerEntryIds: usableRows.map((row) => row.ledgerEntryId),
          expectedQuantity: 0,
          actualQuantity: actual,
          explanation: `A ${spec.category} movement exists although the receipt records zero units for that disposition.`,
        });
        movementComplete = false;
      }
      for (const row of usableRows) {
        matchedLedgerIds.add(row.ledgerEntryId);
        if (spec.category === "good" && cleanId(row.entry.productionCostLayerId)) {
          shipmentLineState?.receivedCostLayerLinks.push({
            costLayerId: cleanId(row.entry.productionCostLayerId),
            quantity: row.quantity,
            ledgerEntryId: row.ledgerEntryId,
          });
        }
      }
      if (actual !== null) totalLedgerQuantity += BigInt(actual);
    }
    if (shipmentLineState) {
      shipmentLineState.receiptMovementComplete = shipmentLineState.receiptMovementComplete && movementComplete;
      shipmentLineState.receiptLedgerQuantity += totalLedgerQuantity;
    }
  };

  const receiptStates = [];
  for (const [receiptLineId, record] of receiptLineById) {
    receiptStates.push({ ...record, receiptLineId });
  }

  const dispatchResults = new Map();
  for (const shipmentState of shipmentLineById.values()) {
    dispatchResults.set(shipmentState.shipmentLineId, dispatchLink(shipmentState));
  }
  for (const receiptState of receiptStates) receiptMovementLink(receiptState);

  const discrepancyByLine = new Map();
  const discrepancyQuantityIncompleteLines = new Set();
  const discrepancyIds = new Set();
  for (const discrepancy of arrays.discrepancies) {
    const discrepancyId = cleanId(discrepancy?.id);
    const transferId = cleanId(discrepancy?.stockTransferId);
    const shipmentId = cleanId(discrepancy?.shipmentId);
    const receiptId = cleanId(discrepancy?.receiptId);
    const inventorySkuId = cleanId(discrepancy?.inventorySkuId);
    if (!discrepancyId || discrepancyIds.has(discrepancyId)) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        shipmentId,
        receiptId,
        discrepancyIds: [discrepancyId],
        explanation: "A discrepancy record has a missing or duplicate stable identifier.",
      });
      continue;
    }
    discrepancyIds.add(discrepancyId);
    if (!transferId || !transferById.has(transferId)) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        shipmentId,
        receiptId,
        discrepancyIds: [discrepancyId],
        explanation: "A discrepancy references no transfer in the supplied snapshot.",
      });
      continue;
    }
    const line = (transferById.get(transferId).lines || []).find((item) =>
      item.inventorySkuId === inventorySkuId
    );
    if (!line) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        shipmentId,
        receiptId,
        discrepancyIds: [discrepancyId],
        explanation: "A discrepancy SKU does not identify a line on its stated transfer.",
      });
      continue;
    }
    const state = String(discrepancy.status || "").toUpperCase();
    if (!["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"].includes(state)) {
      discrepancyQuantityIncompleteLines.add(cleanId(line.id));
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferId,
        transferLineId: cleanId(line.id),
        shipmentId,
        receiptId,
        discrepancyIds: [discrepancyId],
        explanation: "A discrepancy has an unsupported status.",
      });
    }
    if (state === "OPEN" || state === "UNDER_REVIEW") {
      const quantity = readQuantity(discrepancy.quantity, { positive: true });
      if (quantity === null) {
        discrepancyQuantityIncompleteLines.add(cleanId(line.id));
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId: cleanId(line.id),
          shipmentId,
          receiptId,
          discrepancyIds: [discrepancyId],
          explanation: "An open discrepancy has an invalid or non-positive quantity.",
        });
      } else {
        const key = cleanId(line.id);
        const records = discrepancyByLine.get(key) || [];
        records.push({ discrepancy, quantity });
        discrepancyByLine.set(key, records);
      }
    }
  }

  const supplementalCostEvidenceByLine = new Map();
  for (const evidence of Array.isArray(source.costEvidence) ? source.costEvidence : []) {
    const transferLineId = cleanId(evidence?.transferLineId);
    const evidenceId = cleanId(evidence?.evidenceId);
    const classification = cleanStatus(evidence?.classification);
    const quantity = readQuantity(evidence?.quantity);
    if (!transferLineId || !evidenceId || !COST_EVIDENCE_CLASSIFICATIONS.has(classification) ||
        classification === "VERIFIED_RECEIVED_COST" || classification === "MISSING" ||
        quantity === null) {
      addException({
        code: "INSUFFICIENT_EVIDENCE",
        transferLineId,
        explanation: "Supplemental cost evidence requires a line ID, source evidence ID, supported non-authoritative classification, and valid whole-unit quantity.",
      });
      continue;
    }
    const records = supplementalCostEvidenceByLine.get(transferLineId) || [];
    records.push({ evidenceId, classification, quantity });
    supplementalCostEvidenceByLine.set(transferLineId, records);
  }

  const transferResults = [];
  for (const [transferId, transfer] of transferById) {
    const transferStatus = cleanStatus(transfer.status);
    const lines = [];
    for (const line of transfer.lines || []) {
      let transferHasUnknownQuantity = false;
      const transferLineId = cleanId(line.id);
      const inventorySkuId = cleanId(line.inventorySkuId);
      const requestedQuantity = readQuantity(line.requestedQuantity, { positive: true });
      const approvalPending = transferStatus === "PENDING_ADMIN_APPROVAL" &&
        line.approvedQuantity == null;
      const authorizedQuantity = approvalPending ? null : readQuantity(line.approvedQuantity);
      const reservedQuantity = readQuantity(line.reservedShipmentQuantity);
      const dispatchedCounterQuantity = readQuantity(line.dispatchedQuantity);
      const lineShipmentStates = shipmentLinesByTransferLine.get(transferLineId) || [];
      const matchingStates = lineShipmentStates.filter((state) => state.transferId === transferId);

      if (requestedQuantity === null || (!approvalPending && authorizedQuantity === null) ||
          reservedQuantity === null || dispatchedCounterQuantity === null) {
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          expectedQuantity: requestedQuantity,
          actualQuantity: authorizedQuantity,
          explanation: "A transfer-line quantity is missing, negative, malformed, or outside Prisma Int range.",
        });
        transferHasUnknownQuantity = true;
      }
      if (!inventorySkuId) {
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          transferId,
          transferLineId,
          explanation: "A transfer line has no inventory SKU identifier.",
        });
        transferHasUnknownQuantity = true;
      }
      if (authorizedQuantity !== null && requestedQuantity !== null &&
          authorizedQuantity > requestedQuantity) {
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          expectedQuantity: requestedQuantity,
          actualQuantity: authorizedQuantity,
          explanation: "Approved quantity exceeds requested quantity.",
        });
      }

      const activeReservationStates = matchingStates.filter((state) =>
        BOOKING_STATUSES.has(cleanStatus(state.shipment.status))
      );
      const activeReservationQuantities = activeReservationStates.map((state) =>
        readQuantity(state.shipmentLine.quantity, { positive: true })
      );
      const activeReservations = activeReservationQuantities.some((quantity) => quantity === null)
        ? null
        : quantitySum(activeReservationQuantities);
      if (activeReservations === null) {
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          transferId,
          transferLineId,
          explanation: "At least one active booking shipment has an invalid reserved quantity.",
        });
      }
      if (coverage.shipments && reservedQuantity !== null && activeReservations !== reservedQuantity) {
        if (activeReservations !== null) {
          addException({
            code: "QUANTITY_MISMATCH",
            transferId,
            transferLineId,
            expectedQuantity: activeReservations,
            actualQuantity: reservedQuantity,
            explanation: "Transfer-line reservedShipmentQuantity differs from quantities in active booking shipments.",
          });
        }
      }

      const shipmentDispatchQuantities = [];
      const ledgerDispatchQuantities = [];
      let shipmentEvidenceComplete = coverage.shipments;
      let dispatchLinkCoverageComplete = true;
      let anyDispatchReported = false;
      let anyDispatchLinked = false;
      let anyReceiptReported = matchingStates.some((state) => state.receiptLines.length > 0);
      let receiptSourceComplete = coverage.receipts &&
        !receiptLinkIncompleteTransferIds.has(transferId);
      let receiptMovementComplete = coverage.ledgerEntries && coverage.locations &&
        receiptSourceComplete;
      const reportedGoodQuantities = [];
      const reportedDamagedQuantities = [];
      const reportedMissingQuantities = [];
      const ledgerReceiptQuantities = [];
      for (const state of matchingStates) {
        const dispatchResult = dispatchResults.get(state.shipmentLineId);
        if (!dispatchResult) {
          shipmentEvidenceComplete = false;
          dispatchLinkCoverageComplete = false;
          continue;
        }
        if (dispatchResult.evidence && dispatchResult.quantity !== null) {
          shipmentDispatchQuantities.push(dispatchResult.quantity);
          anyDispatchReported = true;
        } else if (DISPATCH_STATUSES.has(cleanStatus(state.shipment.status)) ||
                   (dispatchedCounterQuantity !== null && dispatchedCounterQuantity > 0)) {
          shipmentEvidenceComplete = false;
          dispatchLinkCoverageComplete = false;
          transferHasUnknownQuantity = true;
        }
        if (dispatchResult.linkComplete && dispatchResult.entry) {
          ledgerDispatchQuantities.push(dispatchResult.entry.quantity);
          anyDispatchLinked = true;
        } else if (dispatchResult.evidence) {
          dispatchLinkCoverageComplete = false;
          transferHasUnknownQuantity = true;
        } else if (dispatchedCounterQuantity > 0) {
          dispatchLinkCoverageComplete = false;
          transferHasUnknownQuantity = true;
          addException({
            code: "INSUFFICIENT_EVIDENCE",
            transferId,
            transferLineId,
            shipmentId: state.shipmentId,
            shipmentLineId: state.shipmentLineId,
            expectedQuantity: dispatchedCounterQuantity,
            explanation: "The dispatched counter is positive, but no timestamp or uniquely linked shipment movement allocates it to this shipment line.",
          });
        }
        if (state.receiptLines.length && !dispatchResult.linkComplete) {
          for (const { receipt, receiptLine } of state.receiptLines) {
            const receiptQuantities = [
              readQuantity(receiptLine.goodQuantity),
              readQuantity(receiptLine.damagedQuantity),
              readQuantity(receiptLine.missingQuantity),
            ];
            addException({
              code: "RECEIPT_WITHOUT_DISPATCH",
              severity: "HIGH",
              transferId,
              transferLineId,
              shipmentId: state.shipmentId,
              shipmentLineId: state.shipmentLineId,
              receiptId: cleanId(receipt.id),
              receiptLineId: cleanId(receiptLine.id),
              actualQuantity: receiptQuantities.some((quantity) => quantity === null)
                ? null
                : quantitySum(receiptQuantities),
              explanation: "Receipt records cannot be used as evidence that the stock was dispatched; this shipment line has no defensibly linked dispatch movement.",
            });
          }
        }
        if (state.receiptSourceComplete) {
          reportedGoodQuantities.push(state.reportedGood);
          reportedDamagedQuantities.push(state.reportedDamaged);
          reportedMissingQuantities.push(state.reportedMissing);
        } else {
          receiptSourceComplete = false;
        }
        if (state.receiptMovementComplete) {
          ledgerReceiptQuantities.push(state.receiptLedgerQuantity);
        } else {
          receiptMovementComplete = false;
        }
      }
      const reportedGood = quantitySum(reportedGoodQuantities);
      const reportedDamaged = quantitySum(reportedDamagedQuantities);
      const reportedMissing = quantitySum(reportedMissingQuantities);
      const ledgerReceiptQuantity = quantitySum(ledgerReceiptQuantities);
      if (reportedGood === null || reportedDamaged === null || reportedMissing === null) {
        receiptSourceComplete = false;
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          explanation: "Receipt source quantity total exceeds JavaScript's exact integer range.",
        });
      }
      if (ledgerReceiptQuantity === null) {
        receiptMovementComplete = false;
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          explanation: "Receipt ledger quantity total exceeds JavaScript's exact integer range.",
        });
      }
      const shipmentDispatchQuantity = shipmentEvidenceComplete
        ? quantitySum(shipmentDispatchQuantities)
        : null;
      const ledgerDispatchQuantity = coverage.transfers && coverage.shipments &&
        coverage.ledgerEntries && coverage.locations && dispatchLinkCoverageComplete
        ? quantitySum(ledgerDispatchQuantities)
        : null;
      const reportedReceivedQuantity = receiptSourceComplete
        ? quantitySum([reportedGood, reportedDamaged, reportedMissing])
        : null;
      const costRelevantShipmentStates = matchingStates.filter((state) =>
        dispatchResults.get(state.shipmentLineId)?.evidence ||
        DISPATCH_STATUSES.has(cleanStatus(state.shipment.status))
      );
      const dispatchedShipmentStates = costRelevantShipmentStates.filter((state) =>
        dispatchResults.get(state.shipmentLineId)?.evidence
      );
      let authoritativeCostQuantities = [];
      let receivedCostQuantities = [];
      let costAllocationSnapshotComplete = coverage.costLayers &&
        costRelevantShipmentStates.length === dispatchedShipmentStates.length;
      const uncostedShipments = [];
      for (const state of dispatchedShipmentStates) {
        const shipmentLineQuantity = readQuantity(state.shipmentLine.quantity, { positive: true });
        const uncostedQuantity = readQuantity(state.shipmentLine.uncostedQuantity);
        const allocations = state.shipmentLine.costLayerAllocations;
        if (uncostedQuantity !== null && uncostedQuantity > 0 &&
            shipmentLineQuantity !== null && uncostedQuantity <= shipmentLineQuantity) {
          uncostedShipments.push({ state, quantity: uncostedQuantity });
        }
        if (!coverage.costLayers || !Array.isArray(allocations) ||
            uncostedQuantity === null || shipmentLineQuantity === null) {
          costAllocationSnapshotComplete = false;
          continue;
        }
        let allocationQuantities = [];
        let validAllocations = true;
        for (const allocation of allocations) {
          const allocationQuantity = readQuantity(allocation?.quantity, { positive: true });
          const layerId = cleanId(allocation?.costLayerId);
          const layer = validCostLayerFor(layerId, state.transfer, state.transferLine);
          if (cleanStatus(allocation?.status) !== "DISPATCHED" ||
              allocationQuantity === null || !layer) {
            validAllocations = false;
            addException({
              code: "INSUFFICIENT_EVIDENCE",
              transferId,
              transferLineId,
              shipmentId: state.shipmentId,
              shipmentLineId: state.shipmentLineId,
              explanation: "A dispatched shipment cost allocation lacks a verifiable matching production cost layer, SKU, manufacturer, status, or quantity.",
            });
            continue;
          }
          allocationQuantities.push(allocationQuantity);
        }
        const allocationTotal = validAllocations ? quantitySum(allocationQuantities) : null;
        if (allocationTotal === null ||
            allocationTotal + uncostedQuantity !== shipmentLineQuantity) {
          costAllocationSnapshotComplete = false;
          addException({
            code: "INSUFFICIENT_EVIDENCE",
            transferId,
            transferLineId,
            shipmentId: state.shipmentId,
            shipmentLineId: state.shipmentLineId,
            expectedQuantity: shipmentLineQuantity,
            actualQuantity: allocationTotal === null
              ? null
              : allocationTotal + uncostedQuantity,
            explanation: "Dispatched quantity is not fully accounted for by validated cost-layer allocations plus the recorded uncosted quantity.",
          });
        } else {
          authoritativeCostQuantities.push(allocationTotal);
        }
        if (uncostedQuantity > 0 &&
            !uncostedShipments.some((record) => record.state.shipmentLineId === state.shipmentLineId)) {
          uncostedShipments.push({ state, quantity: uncostedQuantity });
        }
      }
      for (const state of matchingStates) {
        const validReceivedLayerLinks = state.receivedCostLayerLinks.filter((link) =>
          validCostLayerFor(link.costLayerId, state.transfer, state.transferLine)
        );
        receivedCostQuantities.push(...validReceivedLayerLinks.map((link) => link.quantity));
        if (state.receivedCostLayerLinks.length !== validReceivedLayerLinks.length) {
          costAllocationSnapshotComplete = false;
          addException({
            code: "INSUFFICIENT_EVIDENCE",
            transferId,
            transferLineId,
            shipmentId: state.shipmentId,
            shipmentLineId: state.shipmentLineId,
            ledgerEntryIds: state.receivedCostLayerLinks
              .filter((link) => !validCostLayerFor(link.costLayerId, state.transfer, state.transferLine))
              .map((link) => link.ledgerEntryId),
            explanation: "A receipt movement references a production cost layer that cannot be verified against the transfer SKU and manufacturer.",
          });
        }
      }
      for (const { state, quantity } of uncostedShipments) {
        addException({
          code: "UNCOSTED_TRANSFER_QUANTITY",
          severity: "MEDIUM",
          transferId,
          transferLineId,
          shipmentId: state.shipmentId,
          shipmentLineId: state.shipmentLineId,
          expectedQuantity: readQuantity(state.shipmentLine.quantity, { positive: true }),
          actualQuantity: quantity,
          explanation: "The shipment line explicitly records this dispatched quantity as uncosted because it could not be allocated to an existing production cost layer.",
        });
      }
      const supplementalEvidence = supplementalCostEvidenceByLine.get(transferLineId) || [];
      const supplementalClassifications = supplementalEvidence.map((evidence) => ({
        classification: evidence.classification,
        quantity: evidence.quantity,
        evidenceId: evidence.evidenceId,
      })).sort((left, right) =>
        left.classification.localeCompare(right.classification) ||
        left.evidenceId.localeCompare(right.evidenceId)
      );
      const authoritativeCostLayerQuantity = costAllocationSnapshotComplete
        ? quantitySum(authoritativeCostQuantities)
        : null;
      const verifiedReceivedCostQuantity = coverage.costLayers && coverage.ledgerEntries
        ? quantitySum(receivedCostQuantities)
        : null;
      const hasCostEvidence = authoritativeCostLayerQuantity > 0 ||
        verifiedReceivedCostQuantity > 0 ||
        supplementalClassifications.length > 0 ||
        uncostedShipments.length > 0;
      const costEvidenceStatus = !dispatchedShipmentStates.length
        ? costRelevantShipmentStates.length
          ? "UNRECONCILED"
          : "NOT_APPLICABLE"
        : !costAllocationSnapshotComplete
          ? "UNRECONCILED"
          : uncostedShipments.length
            ? "PARTIAL"
            : hasCostEvidence
              ? "COVERED"
              : "MISSING";
      const validDispatchQuantity = ledgerDispatchQuantity;
      const outstandingTransitQuantity = validDispatchQuantity !== null && receiptMovementComplete
        ? Math.max(0, validDispatchQuantity - ledgerReceiptQuantity)
        : null;
      const authorizationValid = authorizedQuantity !== null &&
        (authorizedQuantity === 0 || (
          Boolean(cleanId(transfer.reviewedByAccountId)) &&
          hasTimestamp(transfer.reviewedAt)
        ));

      if (authorizedQuantity !== null && authorizedQuantity > 0 && !authorizationValid) {
        addException({
          code: "MISSING_AUTHORIZATION",
          severity: "HIGH",
          transferId,
          transferLineId,
          expectedQuantity: authorizedQuantity,
          actualQuantity: null,
          explanation: "Positive approved quantity lacks a recorded reviewer or approval timestamp.",
        });
      }

      if ((anyDispatchReported || anyReceiptReported || anyDispatchLinked) && !authorizationValid) {
        addException({
          code: "MISSING_AUTHORIZATION",
          severity: "HIGH",
          transferId,
          transferLineId,
          expectedQuantity: authorizedQuantity,
          actualQuantity: shipmentDispatchQuantity,
          explanation: "Dispatch or receipt evidence exists without verifiable transfer authorization.",
        });
      }

      if (authorizedQuantity !== null && reservedQuantity !== null &&
          dispatchedCounterQuantity !== null &&
          dispatchedCounterQuantity + reservedQuantity > authorizedQuantity) {
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          expectedQuantity: authorizedQuantity,
          actualQuantity: dispatchedCounterQuantity + reservedQuantity,
          explanation: "Dispatched counter plus reserved quantity exceeds approved quantity.",
        });
      }
      const dispatchedShipmentQuantity = matchingStates
        .filter((state) => dispatchResults.get(state.shipmentLineId)?.evidence)
        .map((state) => readQuantity(state.shipmentLine.quantity, { positive: true }))
        .filter((quantity) => quantity !== null);
      const shipmentTotal = quantitySum(dispatchedShipmentQuantity);
      if (authorizedQuantity !== null && shipmentTotal !== null && activeReservations !== null &&
          shipmentTotal + activeReservations > authorizedQuantity) {
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          expectedQuantity: authorizedQuantity,
          actualQuantity: shipmentTotal + activeReservations,
          explanation: "Shipment quantities plus active booking reservations exceed approved quantity.",
        });
      }
      if (coverage.shipments && dispatchedCounterQuantity !== null &&
          shipmentDispatchQuantity !== null &&
          dispatchedCounterQuantity !== shipmentDispatchQuantity) {
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          expectedQuantity: shipmentDispatchQuantity,
          actualQuantity: dispatchedCounterQuantity,
          explanation: "Transfer-line dispatchedQuantity differs from shipment quantities with dispatch evidence.",
        });
      }
      if (coverage.ledgerEntries && dispatchedCounterQuantity !== null &&
          ledgerDispatchQuantity !== null &&
          dispatchedCounterQuantity !== ledgerDispatchQuantity) {
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          expectedQuantity: dispatchedCounterQuantity,
          actualQuantity: ledgerDispatchQuantity,
          explanation: "Transfer-line dispatchedQuantity differs from uniquely linked dispatch-ledger quantities.",
        });
      }
      if (reportedReceivedQuantity !== null && shipmentTotal !== null &&
          reportedReceivedQuantity > shipmentTotal) {
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          expectedQuantity: shipmentTotal,
          actualQuantity: reportedReceivedQuantity,
          explanation: "Receipt-line quantities exceed the linked shipment-line quantities.",
        });
      }
      if (validDispatchQuantity !== null && receiptMovementComplete &&
          ledgerReceiptQuantity > validDispatchQuantity) {
        addException({
          code: "QUANTITY_MISMATCH",
          transferId,
          transferLineId,
          expectedQuantity: validDispatchQuantity,
          actualQuantity: ledgerReceiptQuantity,
          explanation: "Linked receipt movements exceed linked dispatch movements.",
        });
      }
      if (outstandingTransitQuantity !== null && outstandingTransitQuantity > 0) {
        addException({
          code: "UNRESOLVED_IN_TRANSIT",
          severity: "MEDIUM",
          transferId,
          transferLineId,
          expectedQuantity: validDispatchQuantity,
          actualQuantity: outstandingTransitQuantity,
          explanation: "Matched dispatch movements exceed matched receipt movements; this is unresolved transit, not proof of physical custody or loss.",
        });
      }
      if (receiptSourceComplete && reportedReceivedQuantity !== null && shipmentTotal !== null &&
          reportedReceivedQuantity > 0 && reportedReceivedQuantity < shipmentTotal) {
        addException({
          code: "PARTIAL_RECEIPT",
          severity: "INFO",
          transferId,
          transferLineId,
          expectedQuantity: shipmentTotal,
          actualQuantity: reportedReceivedQuantity,
          explanation: "Recorded receipt disposition is partial; the remainder is not assumed received.",
        });
      }
      if (transferStatus === "CANCELLED" &&
          ((ledgerDispatchQuantity || 0) > 0 || (reportedReceivedQuantity || 0) > 0 ||
            (dispatchedCounterQuantity || 0) > 0)) {
        addException({
          code: "CANCELLED_WITH_RECORDED_MOVEMENT",
          severity: "HIGH",
          transferId,
          transferLineId,
          expectedQuantity: authorizedQuantity,
          actualQuantity: ledgerDispatchQuantity,
          explanation: "A cancelled transfer retains dispatch or receipt movement evidence; cancellation does not erase stock history.",
        });
      }

      const openDiscrepancies = discrepancyByLine.get(transferLineId) || [];
      const disputedQuantity = discrepancyQuantityIncompleteLines.has(transferLineId)
        ? null
        : quantitySum(openDiscrepancies.map(({ quantity }) => quantity));
      const transferHasMovement = Boolean(ledgerDispatchQuantity) ||
        Boolean(reportedReceivedQuantity) ||
        Boolean(dispatchedCounterQuantity);
      const remainingApproved = authorizedQuantity !== null && dispatchedCounterQuantity !== null &&
        reservedQuantity !== null
        ? authorizedQuantity - dispatchedCounterQuantity - reservedQuantity
        : null;
      const statusConflict = (
        (transferStatus === "PENDING_ADMIN_APPROVAL" &&
          ((authorizedQuantity || 0) > 0 || transferHasMovement || (activeReservations || 0) > 0)) ||
        (transferStatus === "REJECTED" &&
          ((authorizedQuantity || 0) > 0 || transferHasMovement || (activeReservations || 0) > 0)) ||
        (transferStatus === "APPROVED" && (transferHasMovement || (activeReservations || 0) > 0)) ||
        (transferStatus === "PARTIALLY_RECEIVED" &&
          !(reportedReceivedQuantity > 0 && shipmentDispatchQuantity > reportedReceivedQuantity)) ||
        (transferStatus === "RECEIVED" &&
          !(authorizedQuantity > 0 &&
            dispatchedCounterQuantity === authorizedQuantity &&
            reportedReceivedQuantity === dispatchedCounterQuantity &&
            reportedDamaged === 0 && reportedMissing === 0)) ||
        (transferStatus === "DISCREPANCY" &&
          !(dispatchedCounterQuantity > 0 &&
            reportedReceivedQuantity === dispatchedCounterQuantity &&
            reportedDamaged + reportedMissing > 0)) ||
        (transferStatus === "IN_TRANSIT" &&
          !(activeReservations > 0 || (remainingApproved > 0) ||
            (outstandingTransitQuantity !== null && outstandingTransitQuantity > 0)))
      );
      if (!TRANSFER_STATUSES.has(transferStatus) || statusConflict) {
        addException({
          code: "INVALID_STATUS_TRANSITION",
          severity: "HIGH",
          transferId,
          transferLineId,
          expectedQuantity: dispatchedCounterQuantity,
          actualQuantity: reportedReceivedQuantity,
          explanation: `Transfer status ${transferStatus || "(missing)"} conflicts with recorded authorization, reservation, dispatch, or receipt quantities.`,
        });
      }
      if (disputedQuantity === null) transferHasUnknownQuantity = true;
      if (!coverage.discrepancies) {
        transferHasUnknownQuantity = true;
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          transferId,
          transferLineId,
          explanation: "Discrepancy data is incomplete; unresolved/disputed quantity cannot be determined.",
        });
      }

      if (shipmentDispatchQuantity === null || reportedReceivedQuantity === null ||
          outstandingTransitQuantity === null || disputedQuantity === null) {
        transferHasUnknownQuantity = true;
      }
      lines.push({
        transferLineId,
        inventorySkuId,
        requestedQuantity,
        authorizedQuantity,
        reservedQuantity,
        dispatchedCounterQuantity,
        dispatchedShipmentQuantity: shipmentDispatchQuantity,
        dispatchedLedgerQuantity: ledgerDispatchQuantity,
        receivedGoodQuantity: receiptSourceComplete ? reportedGood : null,
        receivedDamagedQuantity: receiptSourceComplete ? reportedDamaged : null,
        receivedMissingQuantity: receiptSourceComplete ? reportedMissing : null,
        receivedReportedQuantity: reportedReceivedQuantity,
        receivedLedgerQuantity: receiptMovementComplete ? ledgerReceiptQuantity : null,
        costEvidence: {
          status: costEvidenceStatus,
          dispatchedQuantity: shipmentDispatchQuantity,
          authoritativeCostLayerQuantity,
          verifiedReceivedCostQuantity,
          uncostedQuantity: costAllocationSnapshotComplete
            ? quantitySum(uncostedShipments.map((record) => record.quantity))
            : uncostedShipments.length
              ? quantitySum(uncostedShipments.map((record) => record.quantity))
              : null,
          classifications: [
            ...(authoritativeCostLayerQuantity > 0
              ? [{ classification: "AUTHORITATIVE_COST_LAYER", quantity: authoritativeCostLayerQuantity }]
              : []),
            ...(verifiedReceivedCostQuantity > 0
              ? [{ classification: "VERIFIED_RECEIVED_COST", quantity: verifiedReceivedCostQuantity }]
              : []),
            ...supplementalClassifications,
            ...(uncostedShipments.length
              ? [{
                  classification: "MISSING",
                  quantity: quantitySum(uncostedShipments.map((record) => record.quantity)),
                  evidenceIds: uncostedShipments.map((record) => record.state.shipmentLineId).sort(),
                }]
              : []),
            ...(!coverage.costLayers
              ? [{ classification: "UNRECONCILED", quantity: null }]
              : []),
          ],
        },
        authorizedUnshippedQuantity: remainingApproved,
        outstandingInTransitQuantity: outstandingTransitQuantity,
        unresolvedDiscrepancyQuantity: coverage.discrepancies ? disputedQuantity : null,
        comparisonStatus: transferHasUnknownQuantity ? "INCOMPLETE" : "COMPLETE",
        exceptionKeys: [],
      });
    }
    lines.sort((left, right) =>
      String(left.inventorySkuId || "").localeCompare(String(right.inventorySkuId || "")) ||
      String(left.transferLineId || "").localeCompare(String(right.transferLineId || ""))
    );
    transferResults.push({
      transferId,
      status: transfer.status ?? null,
      inventoryOwner: "PLATFORM",
      sourceLocationId: cleanId(transfer.sourceLocationId),
      destinationLocationId: cleanId(transfer.destinationLocationId),
    authorizedQuantity: lines.length
      ? strictQuantitySum(lines.map((line) => line.authorizedQuantity))
      : null,
    dispatchedShipmentQuantity: lines.length
      ? strictQuantitySum(lines.map((line) => line.dispatchedShipmentQuantity))
      : null,
    receivedReportedQuantity: lines.length
      ? strictQuantitySum(lines.map((line) => line.receivedReportedQuantity))
      : null,
    outstandingInTransitQuantity: lines.length
      ? strictQuantitySum(lines.map((line) => line.outstandingInTransitQuantity))
      : null,
    comparisonStatus: lines.length === 0 ||
      lines.some((line) => line.comparisonStatus === "INCOMPLETE")
      ? "INCOMPLETE"
      : "COMPLETE",
      lines,
    });
  }

  const ledgerRowsByBalance = new Map();
  for (const row of ledgerRows) {
    const { entry } = row;
    for (const locationId of [cleanId(entry.sourceLocationId), cleanId(entry.destinationLocationId)].filter(Boolean)) {
      const key = locationSkuKey(locationId, cleanId(entry.inventorySkuId));
      const records = ledgerRowsByBalance.get(key) || [];
      records.push({ ...row, locationId });
      ledgerRowsByBalance.set(key, records);
    }
  }
  const balanceKeys = new Set([...balanceByKey.keys(), ...ledgerRowsByBalance.keys()]);
  if (coverage.balances && coverage.ledgerEntries && coverage.locations) {
    for (const key of balanceKeys) {
      const [locationId, inventorySkuId] = JSON.parse(key);
      const balanceRows = balanceByKey.get(key) || [];
      const location = locationById.get(locationId);
      if (!location) {
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          explanation: `Location ${locationId} for SKU ${inventorySkuId} is absent from the complete location snapshot.`,
        });
        continue;
      }
      if (location.inventoryOwner !== "PLATFORM") {
        addException({
          code: "INSUFFICIENT_EVIDENCE",
          explanation: `Location ${locationId} has owner ${location.inventoryOwner || "(missing)"}, not the governing PLATFORM owner.`,
        });
        continue;
      }
      const ledgerRowsForKey = ledgerRowsByBalance.get(key) || [];
      if (ledgerRowsForKey.some((row) => row.quantity === null)) continue;
      const ledgerQuantity = quantitySum(ledgerRowsForKey.map((row) =>
        (row.entry.destinationLocationId === locationId ? row.quantity : 0) -
        (row.entry.sourceLocationId === locationId ? row.quantity : 0)
      ));
      if (balanceRows.length !== 1) {
        addException({
          code: "BALANCE_MISMATCH",
          severity: "HIGH",
          actualQuantity: null,
          expectedQuantity: ledgerQuantity,
          explanation: `No unique current balance snapshot exists for location ${locationId} and SKU ${inventorySkuId}.`,
        });
        continue;
      }
      const actualBalance = readQuantity(balanceRows[0].quantityOnHand, { signed: true });
      if (ledgerQuantity === null || actualBalance === null || actualBalance !== ledgerQuantity) {
        addException({
          code: "BALANCE_MISMATCH",
          severity: "HIGH",
          expectedQuantity: ledgerQuantity,
          actualQuantity: actualBalance,
          explanation: `All-history ledger quantity does not match the supplied on-hand balance for location ${locationId} and SKU ${inventorySkuId}.`,
        });
      }
    }
  } else if (balanceKeys.size) {
    addException({
      code: "INSUFFICIENT_EVIDENCE",
      explanation: "Balance-to-ledger comparisons require complete balance, ledger-history, and location snapshots.",
    });
  }

  for (const row of ledgerRows) {
    const { entry, ledgerEntryId } = row;
    const referenceType = cleanStatus(entry.referenceType);
    const referenceId = cleanId(entry.referenceId);
    if (referenceType === "STOCK_TRANSFER") {
      if (coverage.transfers && coverage.shipments &&
          (!referenceId || !transferById.has(referenceId) || !matchedLedgerIds.has(ledgerEntryId))) {
        addException({
          code: "ORPHAN_LEDGER_ENTRY",
          severity: "HIGH",
          transferId: referenceId,
          ledgerEntryIds: [ledgerEntryId],
          actualQuantity: row.quantity,
          explanation: "A STOCK_TRANSFER ledger entry has no uniquely matched transfer/shipment-line source.",
        });
      }
    } else if (referenceType === "STOCK_TRANSFER_RECEIPT") {
      const receipt = receiptById.get(referenceId);
      if (coverage.receipts && coverage.shipments &&
          (!receipt || !matchedLedgerIds.has(ledgerEntryId))) {
        addException({
          code: "ORPHAN_LEDGER_ENTRY",
          severity: "HIGH",
          receiptId: referenceId,
          ledgerEntryIds: [ledgerEntryId],
          actualQuantity: row.quantity,
          explanation: "A STOCK_TRANSFER_RECEIPT ledger entry has no uniquely matched receipt-line source.",
        });
      }
    }
  }

  const exceptions = [...exceptionsByKey.values()].sort((left, right) =>
    (SEVERITY_ORDER[left.severity] ?? 9) - (SEVERITY_ORDER[right.severity] ?? 9) ||
    left.code.localeCompare(right.code) ||
    String(left.transferId || "").localeCompare(String(right.transferId || "")) ||
    left.exceptionKey.localeCompare(right.exceptionKey)
  );
  transferResults.sort((left, right) => left.transferId.localeCompare(right.transferId));
  for (const transferResult of transferResults) {
    for (const line of transferResult.lines) {
      line.exceptionKeys = exceptions
        .filter((exception) => exception.transferLineId === line.transferLineId)
        .map((exception) => exception.exceptionKey);
    }
  }
  if (transferResults.some((transfer) =>
    transfer.lines.some((line) => line.comparisonStatus === "INCOMPLETE")
  )) {
    incomplete = true;
  }
  const reportStatus = sourceErrors.length
    ? "DATA_UNAVAILABLE"
    : incomplete
      ? "RECONCILIATION_INCOMPLETE"
      : exceptions.length
        ? "EXCEPTION_DETECTED"
        : "NO_EXCEPTION_DETECTED";

  return {
    reportStatus,
    coverage,
    unavailableSources: sourceErrors,
    transfers: transferResults,
    exceptions,
  };
};
