const RECEIVING_MAX_QUANTITY = 2147483647;

export const RECEIVING_STATUSES = Object.freeze([
  "EXPECTED",
  "ARRIVAL_REPORTED",
  "RECEIPT_INITIATED",
  "INSPECTION_PENDING",
  "INSPECTED",
  "DISCREPANCY_OPEN",
  "PUT_AWAY_PENDING",
  "PARTIALLY_PUT_AWAY",
  "COMPLETED",
  "CANCELLED",
  "BLOCKED",
]);

const allowedTransitions = Object.freeze({
  EXPECTED: ["ARRIVAL_REPORTED", "CANCELLED", "BLOCKED"],
  ARRIVAL_REPORTED: ["RECEIPT_INITIATED", "CANCELLED", "BLOCKED"],
  RECEIPT_INITIATED: ["INSPECTION_PENDING", "CANCELLED", "BLOCKED"],
  INSPECTION_PENDING: ["INSPECTED", "DISCREPANCY_OPEN", "CANCELLED", "BLOCKED"],
  INSPECTED: ["DISCREPANCY_OPEN", "PUT_AWAY_PENDING", "CANCELLED", "BLOCKED"],
  DISCREPANCY_OPEN: ["INSPECTED", "PUT_AWAY_PENDING", "CANCELLED", "BLOCKED"],
  PUT_AWAY_PENDING: ["PARTIALLY_PUT_AWAY", "COMPLETED", "CANCELLED", "BLOCKED"],
  PARTIALLY_PUT_AWAY: ["PARTIALLY_PUT_AWAY", "COMPLETED", "CANCELLED", "BLOCKED"],
  COMPLETED: ["COMPLETED"],
  CANCELLED: ["CANCELLED"],
  BLOCKED: ["BLOCKED", "EXPECTED", "ARRIVAL_REPORTED", "RECEIPT_INITIATED", "INSPECTION_PENDING", "INSPECTED", "DISCREPANCY_OPEN", "PUT_AWAY_PENDING"],
});

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

export const normalizeExactReceiptQuantity = (value, fieldName = "Quantity") => {
  let quantity;
  if (typeof value === "number") {
    quantity = value;
  } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    quantity = Number(value.trim());
  } else {
    throw fail(`${fieldName} must be an exact whole number.`, "INVALID_RECEIVING_QUANTITY");
  }
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > RECEIVING_MAX_QUANTITY) {
    throw fail(`${fieldName} is outside the supported receipt quantity range.`, "INVALID_RECEIVING_QUANTITY");
  }
  return quantity;
};

export const validateReceivingTransition = (currentStatus, nextStatus) => {
  const current = String(currentStatus || "").trim().toUpperCase();
  const next = String(nextStatus || "").trim().toUpperCase();
  if (!RECEIVING_STATUSES.includes(current)) {
    throw fail("The current receiving status is unsupported.", "INVALID_RECEIVING_STATUS");
  }
  if (!RECEIVING_STATUSES.includes(next)) {
    throw fail("The next receiving status is unsupported.", "INVALID_RECEIVING_STATUS");
  }
  if (!allowedTransitions[current]?.includes(next)) {
    throw fail(`Receiving status transition ${current} -> ${next} is not allowed.`, "INVALID_RECEIVING_TRANSITION", 409);
  }
  return { currentStatus: current, nextStatus: next };
};

export const calculateReceivingQuantities = ({
  dispatchedQuantity,
  arrivedQuantity,
  inspectedQuantity,
  acceptedQuantity,
  rejectedQuantity,
  damagedQuantity,
  missingQuantity,
  quarantinedQuantity,
  excessQuantity,
  putAwayQuantity,
  previouslyReceivedQuantity = 0,
}) => {
  const values = {
    dispatchedQuantity: normalizeExactReceiptQuantity(dispatchedQuantity, "Dispatched quantity"),
    arrivedQuantity: normalizeExactReceiptQuantity(arrivedQuantity, "Arrived quantity"),
    inspectedQuantity: normalizeExactReceiptQuantity(inspectedQuantity, "Inspected quantity"),
    acceptedQuantity: normalizeExactReceiptQuantity(acceptedQuantity, "Accepted quantity"),
    rejectedQuantity: normalizeExactReceiptQuantity(rejectedQuantity, "Rejected quantity"),
    damagedQuantity: normalizeExactReceiptQuantity(damagedQuantity, "Damaged quantity"),
    missingQuantity: normalizeExactReceiptQuantity(missingQuantity, "Missing quantity"),
    quarantinedQuantity: normalizeExactReceiptQuantity(quarantinedQuantity, "Quarantined quantity"),
    excessQuantity: normalizeExactReceiptQuantity(excessQuantity, "Excess quantity"),
    putAwayQuantity: normalizeExactReceiptQuantity(putAwayQuantity, "Put-away quantity"),
    previouslyReceivedQuantity: normalizeExactReceiptQuantity(previouslyReceivedQuantity, "Previously received quantity"),
  };

  const inspectedDisposition =
    values.acceptedQuantity +
    values.rejectedQuantity +
    values.damagedQuantity +
    values.missingQuantity +
    values.quarantinedQuantity;
  if (inspectedDisposition !== values.inspectedQuantity) {
    throw fail(
      "Accepted, rejected, damaged, missing, and quarantined quantities must reconcile to inspected quantity.",
      "RECEIVING_INSPECTION_MISMATCH",
      409,
    );
  }
  if (values.putAwayQuantity > values.acceptedQuantity) {
    throw fail("Put-away quantity cannot exceed accepted quantity.", "RECEIVING_PUT_AWAY_EXCEEDS_ACCEPTED", 409);
  }
  if (values.inspectedQuantity > values.arrivedQuantity) {
    throw fail("Inspected quantity cannot exceed arrived quantity.", "RECEIVING_INSPECTION_EXCEEDS_ARRIVED", 409);
  }
  if (values.excessQuantity > 0 && values.arrivedQuantity <= values.dispatchedQuantity) {
    throw fail("Excess quantity requires arrived quantity above the dispatched quantity.", "RECEIVING_EXCESS_WITHOUT_OVER_RECEIPT", 409);
  }
  if (values.arrivedQuantity + values.previouslyReceivedQuantity > values.dispatchedQuantity + values.excessQuantity) {
    throw fail("Received quantity exceeds the dispatched and approved over-received range.", "RECEIVING_OVER_RECEIPT", 409);
  }

  return {
    ...values,
    shortQuantity: Math.max(
      0,
      values.dispatchedQuantity - values.previouslyReceivedQuantity - values.arrivedQuantity,
    ),
    outstandingQuantity: Math.max(
      0,
      values.dispatchedQuantity - values.previouslyReceivedQuantity - values.arrivedQuantity,
    ),
  };
};

export const validatePutAwayLine = ({
  acceptedQuantity,
  alreadyPutAwayQuantity = 0,
  putAwayQuantity,
  sourceLocationId,
  destinationLocationId,
  sourceLocationAllowed,
  destinationLocationAllowed,
}) => {
  const accepted = normalizeExactReceiptQuantity(acceptedQuantity, "Accepted quantity");
  const alreadyPutAway = normalizeExactReceiptQuantity(alreadyPutAwayQuantity, "Previously put-away quantity");
  const putAway = normalizeExactReceiptQuantity(putAwayQuantity, "Put-away quantity");
  if (putAway <= 0) {
    throw fail("Put-away quantity must be positive.", "INVALID_PUT_AWAY_QUANTITY");
  }
  if (alreadyPutAway + putAway > accepted) {
    throw fail("Partial put-away quantities cannot exceed accepted quantity.", "PUT_AWAY_EXCEEDS_ACCEPTED", 409);
  }
  if (!String(sourceLocationId || "").trim()) {
    throw fail("A receiving staging location is required.", "RECEIVING_LOCATION_REQUIRED");
  }
  if (!String(destinationLocationId || "").trim()) {
    throw fail("A put-away destination location is required.", "PUT_AWAY_LOCATION_REQUIRED");
  }
  if (sourceLocationId === destinationLocationId) {
    throw fail("Put-away source and destination locations must differ.", "PUT_AWAY_SAME_LOCATION", 409);
  }
  if (!sourceLocationAllowed) {
    throw fail("The receiving staging location is not authorized.", "RECEIVING_LOCATION_DENIED", 403);
  }
  if (!destinationLocationAllowed) {
    throw fail("The put-away destination location is not authorized.", "PUT_AWAY_LOCATION_DENIED", 403);
  }
  return {
    acceptedQuantity: accepted,
    alreadyPutAwayQuantity: alreadyPutAway,
    putAwayQuantity: putAway,
    remainingAcceptedQuantity: accepted - alreadyPutAway - putAway,
  };
};
