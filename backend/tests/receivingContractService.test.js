import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateReceivingQuantities,
  normalizeExactReceiptQuantity,
  validatePutAwayLine,
  validateReceivingTransition,
} from "../services/receivingContractService.js";

test("receiving lifecycle allows only defined stage transitions", () => {
  assert.deepEqual(
    validateReceivingTransition("EXPECTED", "ARRIVAL_REPORTED"),
    { currentStatus: "EXPECTED", nextStatus: "ARRIVAL_REPORTED" },
  );
  assert.deepEqual(
    validateReceivingTransition("PUT_AWAY_PENDING", "PARTIALLY_PUT_AWAY"),
    { currentStatus: "PUT_AWAY_PENDING", nextStatus: "PARTIALLY_PUT_AWAY" },
  );
  assert.throws(
    () => validateReceivingTransition("EXPECTED", "COMPLETED"),
    (error) => error.code === "INVALID_RECEIVING_TRANSITION",
  );
  assert.throws(
    () => validateReceivingTransition("UNKNOWN", "EXPECTED"),
    (error) => error.code === "INVALID_RECEIVING_STATUS",
  );
});

test("receipt quantities use exact whole numbers and reconcile inspection disposition", () => {
  assert.equal(normalizeExactReceiptQuantity("12"), 12);
  for (const value of [0.5, -1, "1.5", "", null, 2147483648]) {
    assert.throws(
      () => normalizeExactReceiptQuantity(value),
      (error) => error.code === "INVALID_RECEIVING_QUANTITY",
    );
  }
  const quantities = calculateReceivingQuantities({
    dispatchedQuantity: 10,
    arrivedQuantity: 9,
    inspectedQuantity: 9,
    acceptedQuantity: 7,
    rejectedQuantity: 1,
    damagedQuantity: 1,
    missingQuantity: 0,
    quarantinedQuantity: 0,
    excessQuantity: 0,
    putAwayQuantity: 5,
  });
  assert.equal(quantities.shortQuantity, 1);
  assert.equal(quantities.outstandingQuantity, 1);
  assert.equal(quantities.putAwayQuantity, 5);
});

test("partial receipt outstanding quantity remains separate from put-away quantity", () => {
  const quantities = calculateReceivingQuantities({
    dispatchedQuantity: 10,
    arrivedQuantity: 5,
    previouslyReceivedQuantity: 3,
    inspectedQuantity: 5,
    acceptedQuantity: 4,
    rejectedQuantity: 1,
    damagedQuantity: 0,
    missingQuantity: 0,
    quarantinedQuantity: 0,
    excessQuantity: 0,
    putAwayQuantity: 2,
  });
  assert.equal(quantities.shortQuantity, 2);
  assert.equal(quantities.outstandingQuantity, 2);
});

test("inspection mismatch, over-inspection, and put-away over accepted are rejected", () => {
  assert.throws(
    () => calculateReceivingQuantities({
      dispatchedQuantity: 10,
      arrivedQuantity: 10,
      inspectedQuantity: 9,
      acceptedQuantity: 7,
      rejectedQuantity: 1,
      damagedQuantity: 0,
      missingQuantity: 0,
      quarantinedQuantity: 0,
      excessQuantity: 0,
      putAwayQuantity: 0,
    }),
    (error) => error.code === "RECEIVING_INSPECTION_MISMATCH",
  );
  assert.throws(
    () => calculateReceivingQuantities({
      dispatchedQuantity: 10,
      arrivedQuantity: 10,
      inspectedQuantity: 11,
      acceptedQuantity: 10,
      rejectedQuantity: 1,
      damagedQuantity: 0,
      missingQuantity: 0,
      quarantinedQuantity: 0,
      excessQuantity: 0,
      putAwayQuantity: 0,
    }),
    (error) => error.code === "RECEIVING_INSPECTION_EXCEEDS_ARRIVED",
  );
  assert.throws(
    () => calculateReceivingQuantities({
      dispatchedQuantity: 10,
      arrivedQuantity: 10,
      inspectedQuantity: 10,
      acceptedQuantity: 5,
      rejectedQuantity: 0,
      damagedQuantity: 0,
      missingQuantity: 5,
      quarantinedQuantity: 0,
      excessQuantity: 0,
      putAwayQuantity: 6,
    }),
    (error) => error.code === "RECEIVING_PUT_AWAY_EXCEEDS_ACCEPTED",
  );
});

test("over-receipt is explicit and excess without over-arrival is rejected", () => {
  assert.throws(
    () => calculateReceivingQuantities({
      dispatchedQuantity: 10,
      arrivedQuantity: 10,
      inspectedQuantity: 10,
      acceptedQuantity: 10,
      rejectedQuantity: 0,
      damagedQuantity: 0,
      missingQuantity: 0,
      quarantinedQuantity: 0,
      excessQuantity: 1,
      putAwayQuantity: 0,
    }),
    (error) => error.code === "RECEIVING_EXCESS_WITHOUT_OVER_RECEIPT",
  );
  assert.throws(
    () => calculateReceivingQuantities({
      dispatchedQuantity: 10,
      arrivedQuantity: 12,
      inspectedQuantity: 12,
      acceptedQuantity: 12,
      rejectedQuantity: 0,
      damagedQuantity: 0,
      missingQuantity: 0,
      quarantinedQuantity: 0,
      excessQuantity: 1,
      putAwayQuantity: 12,
    }),
    (error) => error.code === "RECEIVING_OVER_RECEIPT",
  );
  assert.deepEqual(
    calculateReceivingQuantities({
      dispatchedQuantity: 10,
      arrivedQuantity: 12,
      inspectedQuantity: 12,
      acceptedQuantity: 12,
      rejectedQuantity: 0,
      damagedQuantity: 0,
      missingQuantity: 0,
      quarantinedQuantity: 0,
      excessQuantity: 2,
      putAwayQuantity: 12,
    }).excessQuantity,
    2,
  );
});

test("partial put-away requires separate source/destination authorization and stays within accepted quantity", () => {
  const input = {
    acceptedQuantity: 10,
    alreadyPutAwayQuantity: 4,
    putAwayQuantity: 3,
    sourceLocationId: "receive-staging-1",
    destinationLocationId: "warehouse-bin-1",
    sourceLocationAllowed: true,
    destinationLocationAllowed: true,
  };
  const snapshot = { ...input };
  assert.deepEqual(validatePutAwayLine(input), {
    acceptedQuantity: 10,
    alreadyPutAwayQuantity: 4,
    putAwayQuantity: 3,
    remainingAcceptedQuantity: 3,
  });
  assert.deepEqual(input, snapshot);
  assert.throws(
    () => validatePutAwayLine({ ...input, destinationLocationAllowed: false }),
    (error) => error.code === "PUT_AWAY_LOCATION_DENIED",
  );
  assert.throws(
    () => validatePutAwayLine({ ...input, destinationLocationId: input.sourceLocationId }),
    (error) => error.code === "PUT_AWAY_SAME_LOCATION",
  );
  assert.throws(
    () => validatePutAwayLine({ ...input, alreadyPutAwayQuantity: 8, putAwayQuantity: 3 }),
    (error) => error.code === "PUT_AWAY_EXCEEDS_ACCEPTED",
  );
});
