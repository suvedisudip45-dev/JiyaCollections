import { createHash } from "node:crypto";
import { normalizeNcmPackageName } from "./ncmClient.js";

const fail = (message, code = "INVALID_STOCK_TRANSFER", statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

const normalizeQuantity = (value, label) => {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647) {
    throw fail(`${label} must be a positive whole number.`);
  }
  return quantity;
};

export const normalizeReceiptWholeNumber = (value, label = "Receipt quantity") => {
  if (typeof value !== "number" &&
      !(typeof value === "string" && /^\d+$/.test(value.trim()))) {
    throw fail(`${label} must be a non-negative whole number.`);
  }
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647) {
    throw fail(`${label} must be a non-negative whole number.`);
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
        `The manufacturer has only ${available} units available for this product variant, but you requested ${line.requestedQuantity}. Reduce the quantity or choose another variant.`,
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

export const isStockTransferEditable = (transfer) => (
  Boolean(transfer) &&
  ["PENDING_ADMIN_APPROVAL", "APPROVED"].includes(transfer.status) &&
  !isTransferPreparationComplete(transfer) &&
  !(transfer.shipments || []).length &&
  !(transfer.lines || []).some((line) => line.dispatchedQuantity > 0 || line.reservedShipmentQuantity > 0)
);

export const isSameProfileOwner = (manufacturerAccountId, distributorAccountId) =>
  Boolean(manufacturerAccountId && distributorAccountId && manufacturerAccountId === distributorAccountId);

export const validateWebhookDispatchAuthorization = ({
  transfer,
  shipment,
  sourceLocation,
  custodyConfirmed,
}) => {
  if (!custodyConfirmed) {
    throw fail("NCM custody is not confirmed for stock-transfer dispatch.", "WEBHOOK_DISPATCH_NOT_CONFIRMED", 409);
  }
  if (!transfer?.id || !shipment?.id) {
    throw fail("A verified transfer and shipment source is required.", "WEBHOOK_DISPATCH_SOURCE_REQUIRED", 409);
  }
  if (!sourceLocation?.id) {
    throw fail("The stock-transfer factory source location is missing.", "WEBHOOK_SOURCE_LOCATION_REQUIRED", 409);
  }
  if (
    sourceLocation.kind !== "FACTORY" ||
    sourceLocation.inventoryOwner !== "PLATFORM" ||
    sourceLocation.manufacturerId !== transfer.manufacturerId ||
    sourceLocation.isActive !== true
  ) {
    throw fail("The NCM dispatch source location is inactive, mismatched, or not platform-owned.", "WEBHOOK_SOURCE_LOCATION_INVALID", 409);
  }
  if (shipment.status && !["BOOKED", "BOOKING_UNKNOWN"].includes(shipment.status)) {
    throw fail("The NCM shipment is no longer eligible for custody-confirmed dispatch.", "WEBHOOK_DISPATCH_STATE_CONFLICT", 409);
  }
  return {
    transferId: transfer.id,
    shipmentId: shipment.id,
    sourceLocationId: sourceLocation.id,
  };
};

export const assessLegacyDispatchProjectionConsistency = ({
  operation = "DISPATCH",
  dispatchedQuantity = 0,
  previousQuantity,
  previousReserved,
  nextQuantity,
  nextReserved,
}) => {
  const normalizeWholeNonNegative = (value, label) => {
    const normalized = Number(value);
    if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > 2147483647) {
      throw fail(`${label} must be a non-negative whole number.`);
    }
    return normalized;
  };
  const quantity = normalizeWholeNonNegative(dispatchedQuantity, "Dispatched quantity");
  const beforeQuantity = normalizeWholeNonNegative(previousQuantity, "Previous quantity");
  const beforeReserved = normalizeWholeNonNegative(previousReserved, "Previous reserved quantity");
  const afterQuantity = normalizeWholeNonNegative(nextQuantity, "Next quantity");
  const afterReserved = normalizeWholeNonNegative(nextReserved, "Next reserved quantity");

  if (beforeReserved > beforeQuantity || afterReserved > afterQuantity) {
    throw fail("Legacy reserved quantity cannot exceed legacy on-hand quantity.", "LEGACY_RESERVATION_CONFLICT", 409);
  }

  const normalizedOperation = String(operation || "").trim().toUpperCase();
  if (normalizedOperation === "DISPATCH") {
    if (quantity <= 0) throw fail("Dispatched quantity must be positive.", "INVALID_LEGACY_DISPATCH_QUANTITY");
    if (afterQuantity !== beforeQuantity - quantity || afterReserved !== beforeReserved) {
      throw fail("Legacy dispatch projection does not match the canonical dispatch quantity.", "LEGACY_DISPATCH_PROJECTION_MISMATCH", 409);
    }
  } else if (normalizedOperation === "RESERVE") {
    if (afterQuantity !== beforeQuantity || afterReserved !== beforeReserved + quantity) {
      throw fail("Legacy reservation projection does not match the reservation quantity.", "LEGACY_RESERVATION_PROJECTION_MISMATCH", 409);
    }
  } else if (normalizedOperation === "RELEASE") {
    if (afterQuantity !== beforeQuantity || afterReserved !== beforeReserved - quantity) {
      throw fail("Legacy reservation release does not match the reserved quantity.", "LEGACY_RESERVATION_RELEASE_MISMATCH", 409);
    }
  } else {
    throw fail("Unsupported legacy dispatch projection operation.", "INVALID_LEGACY_PROJECTION_OPERATION");
  }

  return {
    operation: normalizedOperation,
    dispatchedQuantity: normalizedOperation === "DISPATCH" ? quantity : 0,
    previousQuantity: beforeQuantity,
    previousReserved: beforeReserved,
    nextQuantity: afterQuantity,
    nextReserved: afterReserved,
  };
};

export const isNcmBranchEligible = ({ branchName, status, activeBranchNames }) => {
  const normalizedBranch = String(branchName || "").trim().toUpperCase();
  if (!normalizedBranch || String(status || "").trim().toUpperCase() === "REJECTED") return false;
  const activeBranches = new Set((activeBranchNames || []).map((name) => String(name || "").trim().toUpperCase()));
  return activeBranches.has(normalizedBranch);
};

const cleanPackageField = (value, label, maxLength, { required = false } = {}) => {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) throw fail(`${label} is required for NCM booking.`);
  if (normalized.length > maxLength) throw fail(`${label} cannot exceed ${maxLength} characters.`);
  return normalized;
};

export const normalizeNcmStockTransferPackageDetails = (input = {}) => {
  const details = input && typeof input === "object" ? input : {};
  const weight = Number(details.packageWeight ?? details.weight);
  if (!Number.isFinite(weight) || weight < 0.1 || weight > 1000) {
    throw fail("Package weight must be between 0.1 and 1000 kg.");
  }
  if (details.isFragile !== undefined && typeof details.isFragile !== "boolean") {
    throw fail("Fragile must be true or false.");
  }
  return {
    packageWeight: weight,
    packageType: cleanPackageField(details.packageType, "Package type", 64, { required: true }),
    productType: cleanPackageField(details.productType, "Product type", 120, { required: true }),
    productDescription: cleanPackageField(details.productDescription, "Product description", 300, { required: true }),
    packageDimensions: cleanPackageField(details.packageDimensions, "Package dimensions", 120, { required: true }),
    isFragile: details.isFragile === true,
    deliveryInstruction: cleanPackageField(details.deliveryInstruction ?? details.instruction, "Delivery instructions", 480),
    packagingNotes: cleanPackageField(details.packagingNotes, "Packaging notes", 500),
  };
};

export const buildNcmStockTransferPayload = ({ transfer, packageDetails }) => {
  const instruction = [
    packageDetails.deliveryInstruction,
    "No COD collection.",
  ].filter(Boolean).join(" ").slice(0, 500);

  return {
    name: transfer.distributor.name,
    phone: transfer.distributor.phone,
    phone2: "",
    cod_charge: "0",
    address: transfer.distributor.address,
    fbranch: transfer.manufacturer.ncmPickupBranch,
    branch: transfer.distributor.ncmPickupBranch,
    package: normalizeNcmPackageName(packageDetails.packageType),
    instruction,
    delivery_type: "Door2Door",
    weight: String(packageDetails.packageWeight),
  };
};

export const isPositiveLocalFreightCharge = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
};

export const normalizeNcmOrderId = (value) => {
  const id = String(value ?? "").trim();
  if (!/^\d+$/.test(id)) return null;
  const numericId = Number(id);
  return Number.isSafeInteger(numericId) && numericId > 0 ? String(numericId) : null;
};

export const extractNcmOrderId = (payload) => {
  const candidates = [
    payload,
    payload?.data,
    payload?.result,
    payload?.order,
    payload?.data?.order,
    payload?.result?.order,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    for (const key of ["orderid", "order_id", "id"]) {
      const orderId = normalizeNcmOrderId(candidate[key]);
      if (orderId) return orderId;
    }
  }
  return null;
};

export const latestNcmStockTransferStatus = (statusResponse, detailResponse) => {
  const statusRows = Array.isArray(statusResponse?.data) ? statusResponse.data : [];
  const latestStatus = String(statusRows[0]?.status || detailResponse?.data?.last_delivery_status || "").trim();
  return latestStatus || null;
};

export const normalizeNcmStockTransferStatusHistory = (statusResponse) => {
  if (!Array.isArray(statusResponse?.data)) return [];
  return statusResponse.data
    .map((entry) => ({
      status: String(entry?.status || "").trim().slice(0, 191),
      addedAt: String(entry?.added_time || "").trim().slice(0, 64) || null,
    }))
    .filter((entry) => entry.status)
    .slice(0, 50);
};

export const normalizeNcmStockTransferEvent = (status = "", event = "") => {
  const normalize = (value) => String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedStatus = normalize(status);
  const normalizedEvent = normalize(event);
  const combined = `${normalizedEvent} ${normalizedStatus}`.trim();
  if (
    combined.includes("delivery completed") ||
    combined.includes("delivery complete") ||
    combined.includes("delivered")
  ) {
    return { status: "Delivered", rank: 6, custodyConfirmed: true };
  }
  if (combined.includes("return")) {
    return { status: "Returned", rank: 7, custodyConfirmed: false };
  }
  if (combined.includes("sent for delivery") || combined.includes("out for delivery")) {
    return { status: "Sent for Delivery", rank: 5, custodyConfirmed: true };
  }
  if (combined.includes("order arrived") || combined.includes("arrived")) {
    return { status: "Arrived", rank: 4, custodyConfirmed: true };
  }
  if (combined.includes("dispatched") || combined.includes("dispached") || combined.includes("in transit")) {
    return { status: "Dispatched", rank: 3, custodyConfirmed: true };
  }
  if (combined.includes("pickup completed") || combined.includes("pickup complete") || combined.includes("picked up")) {
    return { status: "Pickup Complete", rank: 2, custodyConfirmed: true };
  }
  if (combined.includes("pickup order created") || combined.includes("sent for pickup") || combined.includes("drop off order created")) {
    return { status: "Pickup Order Created", rank: 1, custodyConfirmed: false };
  }
  return {
    status: String(status || event || "").trim().slice(0, 191),
    rank: 0,
    custodyConfirmed: false,
  };
};

export const isStaleNcmStockTransferEvent = (currentEventAt, incomingEventAt) => {
  if (!currentEventAt || !incomingEventAt) return false;
  const currentTimestamp = new Date(currentEventAt).getTime();
  const incomingTimestamp = new Date(incomingEventAt).getTime();
  return Number.isFinite(currentTimestamp) &&
    Number.isFinite(incomingTimestamp) &&
    incomingTimestamp < currentTimestamp;
};

export const shouldAdvanceNcmStockTransferStatus = (
  currentStatus,
  incomingStatus,
  currentEventAt = null,
  incomingEventAt = null,
) => !isStaleNcmStockTransferEvent(currentEventAt, incomingEventAt) &&
  normalizeNcmStockTransferEvent(incomingStatus).rank >= normalizeNcmStockTransferEvent(currentStatus).rank;

const isCanonicalTransferDispatchEvidence = ({
  transfer,
  shipment,
  shipmentLine,
  transferLine,
  dispatchEvidence,
  transitLocationId,
}) => Boolean(
  dispatchEvidence &&
  dispatchEvidence.exists === true &&
  dispatchEvidence.shipmentId === shipment.id &&
  dispatchEvidence.shipmentLineId === shipmentLine.id &&
  dispatchEvidence.inventorySkuId === transferLine.inventorySkuId &&
  dispatchEvidence.movementType === "TRANSFER_DISPATCH" &&
  dispatchEvidence.inventoryOwner === "PLATFORM" &&
  dispatchEvidence.referenceType === "STOCK_TRANSFER" &&
  dispatchEvidence.referenceId === transfer.id &&
  dispatchEvidence.idempotencyKey === `stock-transfer:${shipment.id}:dispatch:${transferLine.inventorySkuId}` &&
  dispatchEvidence.sourceLocationId === transfer.sourceLocationId &&
  dispatchEvidence.destinationLocationId === transitLocationId &&
  dispatchEvidence.quantity === Number(shipmentLine.quantity) &&
  Boolean(transitLocationId)
);

export const evaluateTransferReceiptEligibility = ({
  transfer,
  shipment,
  shipmentLine,
  transferLine,
  dispatchEvidence,
  transitLocationId,
  previouslyReceivedQuantity = 0,
  proposedReceipt,
  destinationLocation,
  destinationLocationAuthorized = false,
  excessReceiptAuthorized = false,
}) => {
  if (!transfer?.id || !shipment?.id || !shipmentLine?.id || !transferLine?.id) {
    throw fail("Transfer, shipment, and shipment-line identities are required.", "RECEIPT_SOURCE_REQUIRED");
  }
  if (shipment.stockTransferId !== transfer.id ||
      shipmentLine.shipmentId !== shipment.id ||
      shipmentLine.stockTransferLineId !== transferLine.id ||
      transferLine.stockTransferId !== transfer.id) {
    throw fail("Transfer, shipment, and shipment-line identities do not link consistently.", "RECEIPT_SOURCE_CONFLICT", 409);
  }
  if (["CANCELLED", "COMPLETED", "REJECTED", "RECEIVED"].includes(String(transfer.status || "").toUpperCase())) {
    throw fail("A completed or cancelled transfer cannot accept a new receipt.", "RECEIPT_TRANSFER_STATE_CONFLICT", 409);
  }
  if (!["DISPATCHED", "PARTIALLY_RECEIVED"].includes(String(shipment.status || "").toUpperCase())) {
    throw fail("Receipt requires verifiable dispatch evidence.", "RECEIPT_DISPATCH_REQUIRED", 409);
  }
  if (!shipment.dispatchedAt) {
    throw fail("Receipt requires a dispatch timestamp.", "RECEIPT_DISPATCH_EVIDENCE_MISSING", 409);
  }

  if (!isCanonicalTransferDispatchEvidence({
    transfer,
    shipment,
    shipmentLine,
    transferLine,
    dispatchEvidence,
    transitLocationId,
  })) {
    throw fail("A verified canonical dispatch movement is required before receipt.", "RECEIPT_DISPATCH_EVIDENCE_MISSING", 409);
  }

  if (!destinationLocationAuthorized) {
    throw fail("The authenticated distributor cannot receive at the destination location.", "RECEIPT_DESTINATION_UNAUTHORIZED", 403);
  }
  if (!destinationLocation?.id || destinationLocation.isActive !== true ||
      destinationLocation.inventoryOwner !== "PLATFORM" ||
      destinationLocation.kind !== "DISTRIBUTOR" ||
      destinationLocation.distributorId !== transfer.distributorId ||
      destinationLocation.id !== transfer.destinationLocationId) {
    throw fail("The receipt destination is inactive, mismatched, or not platform-owned.", "RECEIPT_DESTINATION_INVALID", 409);
  }

  const dispatchedQuantity = normalizeReceiptWholeNumber(
    Number(shipmentLine.quantity),
    "Dispatched quantity",
  );
  const approvedQuantity = normalizeReceiptWholeNumber(
    transferLine.approvedQuantity || 0,
    "Approved quantity",
  );
  const recordedDispatchedQuantity = normalizeReceiptWholeNumber(
    transferLine.dispatchedQuantity ?? 0,
    "Recorded dispatched quantity",
  );
  if (dispatchedQuantity > approvedQuantity) {
    throw fail("Shipment quantity exceeds approved transfer quantity.", "RECEIPT_APPROVED_QUANTITY_EXCEEDED", 409);
  }
  if (dispatchedQuantity > recordedDispatchedQuantity) {
    throw fail("The shipment line quantity exceeds recorded transfer dispatch quantity.", "RECEIPT_DISPATCH_QUANTITY_EXCEEDED", 409);
  }
  const previousReceived = normalizeReceiptWholeNumber(
    previouslyReceivedQuantity,
    "Previously received quantity",
  );
  if (previousReceived > dispatchedQuantity) {
    throw fail("Previously received quantity exceeds dispatched quantity.", "RECEIPT_PREVIOUSLY_OVER_RECEIVED", 409);
  }

  const acceptedQuantity = normalizeReceiptWholeNumber(proposedReceipt?.acceptedQuantity ?? proposedReceipt?.goodQuantity ?? 0, "Accepted quantity");
  const damagedQuantity = normalizeReceiptWholeNumber(proposedReceipt?.damagedQuantity ?? 0, "Damaged quantity");
  const rejectedQuantity = normalizeReceiptWholeNumber(proposedReceipt?.rejectedQuantity ?? 0, "Rejected quantity");
  const missingQuantity = normalizeReceiptWholeNumber(proposedReceipt?.missingQuantity ?? 0, "Missing quantity");
  const excessQuantity = normalizeReceiptWholeNumber(proposedReceipt?.excessQuantity ?? 0, "Excess quantity");
  const putAwayQuantity = normalizeReceiptWholeNumber(proposedReceipt?.putAwayQuantity ?? 0, "Put-away quantity");

  if (acceptedQuantity + damagedQuantity + rejectedQuantity + missingQuantity > dispatchedQuantity - previousReceived) {
    throw fail("The proposed receipt exceeds the outstanding dispatched quantity.", "RECEIPT_QUANTITY_OVER_DISPATCH", 409);
  }
  if (acceptedQuantity + damagedQuantity + rejectedQuantity + missingQuantity === 0) {
    throw fail("A receipt must account for at least one positive quantity.", "RECEIPT_QUANTITY_REQUIRED");
  }
  if (putAwayQuantity > acceptedQuantity) {
    throw fail("Put-away quantity cannot exceed accepted quantity.", "RECEIPT_PUT_AWAY_EXCEEDS_ACCEPTED", 409);
  }
  if (excessQuantity > 0 && !excessReceiptAuthorized) {
    throw fail("Excess receipt requires a separately authorized exception.", "RECEIPT_EXCESS_NOT_AUTHORIZED", 409);
  }

  const outstandingBefore = dispatchedQuantity - previousReceived;
  const accountedThisReceipt = acceptedQuantity + damagedQuantity + rejectedQuantity + missingQuantity;
  const outstandingAfter = outstandingBefore - accountedThisReceipt;
  const exceptionCodes = [
    ...(missingQuantity > 0 ? ["SHORT_RECEIPT"] : []),
    ...(damagedQuantity > 0 ? ["DAMAGED_RECEIPT"] : []),
    ...(rejectedQuantity > 0 ? ["REJECTED_RECEIPT"] : []),
    ...(excessQuantity > 0 ? ["EXCESS_RECEIPT"] : []),
  ];
  if (exceptionCodes.length > 0) {
    return {
      eligible: true,
      outcome: outstandingAfter > 0 ? "PARTIAL_WITH_EXCEPTION" : "COMPLETE_WITH_EXCEPTION",
      exceptionCode: exceptionCodes[0],
      exceptionCodes,
      acceptedQuantity,
      damagedQuantity,
      rejectedQuantity,
      missingQuantity,
      excessQuantity,
      putAwayQuantity,
      outstandingAfter,
      approvedQuantity,
      dispatchedQuantity,
      previouslyReceivedQuantity: previousReceived,
    };
  }
  if (outstandingAfter > 0) {
    return {
      eligible: true,
      outcome: "PARTIAL_RECEIPT",
      exceptionCode: null,
      exceptionCodes: [],
      acceptedQuantity,
      damagedQuantity,
      rejectedQuantity,
      missingQuantity,
      excessQuantity,
      putAwayQuantity,
      outstandingAfter,
      approvedQuantity,
      dispatchedQuantity,
      previouslyReceivedQuantity: previousReceived,
    };
  }
  return {
    eligible: true,
    outcome: "FULL_RECEIPT",
    exceptionCode: null,
    exceptionCodes: [],
    acceptedQuantity,
    damagedQuantity,
    rejectedQuantity,
    missingQuantity,
    excessQuantity,
    putAwayQuantity,
    outstandingAfter,
    approvedQuantity,
    dispatchedQuantity,
    previouslyReceivedQuantity: previousReceived,
  };
};

export const evaluateStockTransferReceiptReplay = ({
  existingReceiptIdentity,
  existingRequestHash,
  receiptIdentity,
  requestHash,
}) => {
  const existingIdentity = String(existingReceiptIdentity || "").trim();
  const identity = String(receiptIdentity || "").trim();
  const existingHash = String(existingRequestHash || "").trim();
  const hash = String(requestHash || "").trim();
  if (!identity || !hash) throw fail("Receipt identity and request hash are required.", "RECEIPT_IDENTITY_REQUIRED");
  if (!existingIdentity) return { outcome: "NEW_RECEIPT", replayed: false };
  if (existingIdentity !== identity) throw fail("Receipt identity conflicts with an existing receipt.", "RECEIPT_IDENTITY_CONFLICT", 409);
  if (existingHash !== hash) throw fail("Receipt identity was reused for conflicting receipt details.", "RECEIPT_IDEMPOTENCY_CONFLICT", 409);
  return { outcome: "REPLAY", replayed: true };
};

export const buildCanonicalStockTransferReceiptPlan = ({
  transfer,
  shipment,
  shipmentLine,
  transferLine,
  dispatchEvidence,
  receiptIdentity,
  transitLocationId,
  destinationLocation,
  destinationLocationAuthorized = false,
  damagedLocationId,
  lostLocationId,
  acceptedQuantity,
  damagedQuantity,
  missingQuantity,
  rejectedQuantity,
  previouslyReceivedQuantity = 0,
  actorId,
  actorRole,
}) => {
  const normalizedReceiptIdentity = String(receiptIdentity || "").trim();
  if (!normalizedReceiptIdentity) throw fail("A stable receipt identity is required.", "RECEIPT_IDENTITY_REQUIRED");
  if (!transfer?.id || !shipment?.id || !shipmentLine?.id || !transferLine?.id || !transferLine?.inventorySkuId) {
    throw fail("Stable transfer, shipment, shipment-line and SKU identities are required.", "RECEIPT_SOURCE_REQUIRED");
  }
  if (shipment.stockTransferId !== transfer.id ||
      shipmentLine.shipmentId !== shipment.id ||
      shipmentLine.stockTransferLineId !== transferLine.id ||
      transferLine.stockTransferId !== transfer.id) {
    throw fail("Transfer, shipment, and shipment-line identities do not link consistently.", "RECEIPT_SOURCE_CONFLICT", 409);
  }
  if (!["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(String(transfer.status || "").toUpperCase()) ||
      !["DISPATCHED", "PARTIALLY_RECEIVED"].includes(String(shipment.status || "").toUpperCase()) ||
      !shipment.dispatchedAt) {
    throw fail("Receipt planning requires an active dispatched transfer and shipment.", "RECEIPT_TRANSFER_STATE_CONFLICT", 409);
  }
  if (!transitLocationId || !destinationLocation?.id) {
    throw fail("Transit and destination locations are required.", "RECEIPT_LOCATION_REQUIRED");
  }
  if (!isCanonicalTransferDispatchEvidence({
    transfer,
    shipment,
    shipmentLine,
    transferLine,
    dispatchEvidence,
    transitLocationId,
  })) {
    throw fail("A verified canonical dispatch movement is required before receipt planning.", "RECEIPT_DISPATCH_EVIDENCE_MISSING", 409);
  }
  if (!destinationLocationAuthorized) {
    throw fail("The destination must be authorized before receipt planning.", "RECEIPT_DESTINATION_UNAUTHORIZED", 403);
  }
  if (destinationLocation.isActive !== true ||
      destinationLocation.inventoryOwner !== "PLATFORM" ||
      destinationLocation.kind !== "DISTRIBUTOR" ||
      destinationLocation.id !== transfer.destinationLocationId ||
      !transfer.distributorId ||
      destinationLocation.distributorId !== transfer.distributorId) {
    throw fail("The receipt destination is inactive, mismatched, or not platform-owned.", "RECEIPT_DESTINATION_INVALID", 409);
  }
  if (!String(actorId || "").trim() || !String(actorRole || "").trim()) {
    throw fail("A receipt actor and role are required.", "RECEIPT_ACTOR_REQUIRED");
  }

  const accepted = normalizeReceiptWholeNumber(acceptedQuantity, "Accepted quantity");
  const damaged = normalizeReceiptWholeNumber(damagedQuantity, "Damaged quantity");
  const missing = normalizeReceiptWholeNumber(missingQuantity, "Missing quantity");
  const rejected = normalizeReceiptWholeNumber(rejectedQuantity, "Rejected quantity");
  const previouslyReceived = normalizeReceiptWholeNumber(previouslyReceivedQuantity, "Previously received quantity");
  const shipmentLineQuantity = normalizeReceiptWholeNumber(shipmentLine.quantity, "Shipment line quantity");
  const approvedQuantity = normalizeReceiptWholeNumber(transferLine.approvedQuantity, "Approved quantity");
  const dispatchedQuantity = normalizeReceiptWholeNumber(transferLine.dispatchedQuantity, "Transfer dispatched quantity");
  if (shipmentLineQuantity > approvedQuantity) {
    throw fail("Shipment line quantity exceeds approved transfer quantity.", "RECEIPT_APPROVED_QUANTITY_EXCEEDED", 409);
  }
  if (shipmentLineQuantity > dispatchedQuantity) {
    throw fail("Shipment line quantity exceeds recorded transfer dispatch quantity.", "RECEIPT_DISPATCH_QUANTITY_EXCEEDED", 409);
  }
  if (accepted + damaged + missing + rejected <= 0) {
    throw fail("A canonical receipt plan must account for a positive quantity.", "RECEIPT_QUANTITY_REQUIRED");
  }
  if (previouslyReceived > shipmentLineQuantity) {
    throw fail("Previously received quantity cannot exceed the shipment line quantity.", "RECEIPT_PREVIOUSLY_OVER_RECEIVED", 409);
  }
  if (previouslyReceived + accepted + damaged + missing + rejected > shipmentLineQuantity) {
    throw fail("Canonical receipt quantities cannot exceed the shipment line quantity.", "RECEIPT_QUANTITY_OVER_DISPATCH", 409);
  }

  const movements = [];
  if (accepted > 0) {
    movements.push({
      inventorySkuId: transferLine.inventorySkuId,
      sourceLocationId: transitLocationId,
      destinationLocationId: destinationLocation.id,
      quantity: accepted,
      movementType: "TRANSFER_RECEIPT",
      referenceType: "STOCK_TRANSFER_RECEIPT",
      referenceId: normalizedReceiptIdentity,
      idempotencyKey: `${normalizedReceiptIdentity}:${shipmentLine.id}:accepted`,
      actorId: String(actorId).trim(),
      actorRole: String(actorRole).trim().toUpperCase(),
      reason: `Accepted stock received for stock transfer ${transfer.id}.`,
    });
  }
  if (damaged > 0) {
    if (!damagedLocationId) throw fail("A damaged location is required for damaged receipt quantity.", "RECEIPT_DAMAGED_LOCATION_REQUIRED");
    movements.push({
      inventorySkuId: transferLine.inventorySkuId,
      sourceLocationId: transitLocationId,
      destinationLocationId: damagedLocationId,
      quantity: damaged,
      movementType: "DAMAGE",
      referenceType: "STOCK_TRANSFER_RECEIPT",
      referenceId: normalizedReceiptIdentity,
      idempotencyKey: `${normalizedReceiptIdentity}:${shipmentLine.id}:damaged`,
      actorId: String(actorId).trim(),
      actorRole: String(actorRole).trim().toUpperCase(),
      reason: `Damaged stock received for stock transfer ${transfer.id}.`,
    });
  }
  if (missing > 0) {
    if (!lostLocationId) throw fail("A lost location is required for missing receipt quantity.", "RECEIPT_LOST_LOCATION_REQUIRED");
    movements.push({
      inventorySkuId: transferLine.inventorySkuId,
      sourceLocationId: transitLocationId,
      destinationLocationId: lostLocationId,
      quantity: missing,
      movementType: "LOSS",
      referenceType: "STOCK_TRANSFER_RECEIPT",
      referenceId: normalizedReceiptIdentity,
      idempotencyKey: `${normalizedReceiptIdentity}:${shipmentLine.id}:missing`,
      actorId: String(actorId).trim(),
      actorRole: String(actorRole).trim().toUpperCase(),
      reason: `Missing stock recorded for stock transfer ${transfer.id}.`,
    });
  }

  return {
    transferId: transfer.id,
    shipmentId: shipment.id,
    shipmentLineId: shipmentLine.id,
    inventorySkuId: transferLine.inventorySkuId,
    acceptedQuantity: accepted,
    damagedQuantity: damaged,
    rejectedQuantity: rejected,
    missingQuantity: missing,
    previouslyReceivedQuantity: previouslyReceived,
    outstandingAfter: shipmentLineQuantity - previouslyReceived - accepted - damaged - missing - rejected,
    movements,
  };
};

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

export const normalizeDispatchRequestLines = (requestedLines, transferLines) => {
  if (!Array.isArray(requestedLines) || requestedLines.length < 1 || requestedLines.length > transferLines.length) {
    throw fail("A shipment must contain at least one approved SKU line.");
  }
  const byId = new Map(transferLines.map((line) => [line.id, line]));
  const seen = new Set();
  return requestedLines.map((requested) => {
    const lineId = String(requested?.lineId || "").trim();
    const line = byId.get(lineId);
    const quantity = Number(requested?.quantity);
    if (
      !line ||
      seen.has(lineId) ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      quantity > 2147483647
    ) {
      throw fail("Shipment quantities must be positive whole numbers for unique transfer lines.");
    }
    seen.add(lineId);
    return { stockTransferLineId: lineId, quantity, line };
  });
};

export const assertDispatchAvailability = (lines) => {
  for (const { line, quantity } of lines) {
    const eligibleQuantity = remainingApprovedQuantity(line);
    if (quantity > eligibleQuantity) {
      throw fail("Shipment quantities must be within each approved, undispatched line.", "INSUFFICIENT_APPROVED_QUANTITY", 409);
    }
  }
  return lines;
};

export const planCanonicalTransferDispatch = ({
  transfer,
  shipment,
  transferLines,
  transitLocationId,
  actorId,
  actorRole,
}) => {
  if (!transfer?.id || !shipment?.id) throw fail("Transfer and shipment source identities are required.", "DISPATCH_SOURCE_REQUIRED");
  if (!transitLocationId) throw fail("A verified in-transit destination location is required.", "TRANSIT_LOCATION_REQUIRED");
  if (!Array.isArray(shipment?.lines) || shipment.lines.length < 1) {
    throw fail("A dispatch shipment must contain at least one line.", "DISPATCH_LINES_REQUIRED");
  }
  if (!String(actorId || "").trim() || !String(actorRole || "").trim()) {
    throw fail("An authenticated dispatch actor and role are required.", "DISPATCH_ACTOR_REQUIRED");
  }

  const transferLinesById = new Map((transferLines || []).map((line) => [line.id, line]));
  const seen = new Set();
  const movements = [];
  for (const shipmentLine of shipment.lines) {
    const transferLineId = shipmentLine.stockTransferLineId;
    const transferLine = transferLinesById.get(transferLineId);
    const quantity = Number(shipmentLine.quantity);
    if (!transferLine || seen.has(transferLineId)) {
      throw fail("A shipment line must reference one unique approved transfer line.", "DISPATCH_LINE_CONFLICT", 409);
    }
    seen.add(transferLineId);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647) {
      throw fail("Dispatch quantity must be a positive whole number.", "INVALID_DISPATCH_QUANTITY");
    }
    const approvedQuantity = Number(transferLine.approvedQuantity || 0);
    const alreadyDispatched = Number(transferLine.dispatchedQuantity || 0);
    if (!Number.isSafeInteger(approvedQuantity) || approvedQuantity < 0 ||
        !Number.isSafeInteger(alreadyDispatched) || alreadyDispatched < 0 ||
        quantity > approvedQuantity - alreadyDispatched) {
      throw fail("Dispatch quantities must not exceed approved, undispatched transfer quantities.", "INSUFFICIENT_APPROVED_QUANTITY", 409);
    }
    if (!transferLine.inventorySkuId) throw fail("A dispatch line must identify an inventory SKU.", "DISPATCH_SKU_REQUIRED");

    movements.push({
      shipmentLineId: shipmentLine.id,
      transferLineId: transferLine.id,
      inventorySkuId: transferLine.inventorySkuId,
      sourceLocationId: transfer.sourceLocationId,
      destinationLocationId: transitLocationId,
      quantity,
      movementType: "TRANSFER_DISPATCH",
      referenceType: "STOCK_TRANSFER",
      referenceId: transfer.id,
      idempotencyKey: `stock-transfer:${shipment.id}:dispatch:${transferLine.inventorySkuId}`,
      actorId: String(actorId).trim(),
      actorRole: String(actorRole).trim().toUpperCase(),
      reason: `Bulk stock dispatched to distributor under transfer ${transfer.id}.`,
    });
  }
  return movements;
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

export const planReceivedCostLayerAllocations = (layers, quantity, alreadyReceivedQuantity = 0) => {
  const receivedQuantity = Number(quantity);
  const offsetQuantity = Number(alreadyReceivedQuantity);
  if (!Number.isSafeInteger(receivedQuantity) || receivedQuantity < 0
    || !Number.isSafeInteger(offsetQuantity) || offsetQuantity < 0) {
    throw fail("Receipt cost-layer quantities must be non-negative whole numbers.", "INVALID_COST_LAYER", 409);
  }
  let skip = offsetQuantity;
  let remaining = receivedQuantity;
  const allocations = [];
  for (const layer of layers) {
    const layerQuantity = Number(layer.quantity);
    if (!Number.isSafeInteger(layerQuantity) || layerQuantity < 0) {
      throw fail("Dispatched cost-layer quantities must be non-negative whole numbers.", "INVALID_COST_LAYER", 409);
    }
    const skipped = Math.min(skip, layerQuantity);
    skip -= skipped;
    const available = layerQuantity - skipped;
    const allocatedQuantity = Math.min(remaining, available);
    if (allocatedQuantity > 0) {
      allocations.push({ costLayerId: layer.costLayerId, quantity: allocatedQuantity });
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
