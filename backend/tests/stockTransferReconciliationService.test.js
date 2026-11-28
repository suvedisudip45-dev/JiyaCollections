import assert from "node:assert/strict";
import test from "node:test";
import { reconcileStockTransfers } from "../services/stockTransferReconciliationService.js";

const sourceNames = [
  "transfers",
  "shipments",
  "receipts",
  "discrepancies",
  "ledgerEntries",
  "balances",
  "locations",
];
const completeCoverage = Object.fromEntries(sourceNames.map((name) => [name, true]));

const makeMovement = ({
  id,
  key,
  type,
  skuId = "sku",
  sourceLocationId = null,
  destinationLocationId = null,
  referenceType,
  referenceId,
  quantity,
  extra = {},
}) => ({
  id,
  idempotencyKey: key,
  movementType: type,
  inventorySkuId: skuId,
  sourceLocationId,
  destinationLocationId,
  referenceType,
  referenceId,
  inventoryOwner: "PLATFORM",
  quantity,
  actorId: "actor",
  actorRole: "ADMIN",
  ...extra,
});

const makeFixture = ({
  transferId = "transfer",
  shipmentId = "shipment",
  receiptId = "receipt",
  shipmentLineId = "shipment-line",
  receiptLineId = "receipt-line",
  quantity = 5,
  authorizedQuantity = quantity,
  receivedQuantity = quantity,
  transferStatus = receivedQuantity === quantity ? "RECEIVED" : "IN_TRANSIT",
  requestedAt,
  requestedByAccountId = "requester",
  sourceLocationId = "factory",
  destinationLocationId = "distributor",
  inventorySkuId = "sku",
} = {}) => {
  const transitId = `transit-${shipmentId}`;
  const timestampOffset = [...transferId].reduce((total, character) => total + character.charCodeAt(0), 0) % 60;
  const transferRequestedAt = requestedAt || new Date(
    Date.parse("2026-01-01T00:00:00.000Z") + timestampOffset * 1000
  ).toISOString();
  const hasReceipt = receivedQuantity !== null;
  const receiptAmount = hasReceipt ? receivedQuantity : 0;
  const transfer = {
    id: transferId,
    status: transferStatus,
    manufacturerId: "manufacturer",
    distributorId: "distributor-account",
    sourceLocationId,
    destinationLocationId,
    requestedByAccountId,
    requestedAt: transferRequestedAt,
    reviewedByAccountId: "admin",
    reviewedAt: "2026-01-01T00:00:00.000Z",
    lines: [{
      id: `line-${transferId}`,
      inventorySkuId,
      requestedQuantity: authorizedQuantity,
      approvedQuantity: authorizedQuantity,
      dispatchedQuantity: quantity,
      reservedShipmentQuantity: 0,
    }],
  };
  const shipment = {
    id: shipmentId,
    stockTransferId: transferId,
    status: "DELIVERED",
    dispatchedAt: "2026-01-02T00:00:00.000Z",
    lines: [{
      id: shipmentLineId,
      stockTransferLineId: `line-${transferId}`,
      quantity,
    }],
  };
  const receipt = hasReceipt
    ? {
        id: receiptId,
        shipmentId,
        status: "CONFIRMED",
        receivedBy: "distributor-user",
        receivedAt: "2026-01-03T00:00:00.000Z",
        lines: [{
          id: receiptLineId,
          shipmentLineId,
          goodQuantity: receiptAmount,
          damagedQuantity: 0,
          missingQuantity: 0,
        }],
      }
    : null;
  const ledgerEntries = [
    makeMovement({
      id: `opening-${transferId}`,
      key: `opening:${transferId}`,
      type: "OPENING_BALANCE",
      destinationLocationId: "factory",
      referenceType: "OPENING_BALANCE",
      referenceId: transferId,
      quantity,
    }),
    makeMovement({
      id: `dispatch-${shipmentId}`,
      key: `stock-transfer:${shipmentId}:dispatch:sku`,
      type: "TRANSFER_DISPATCH",
      sourceLocationId: "factory",
      destinationLocationId: transitId,
      referenceType: "STOCK_TRANSFER",
      referenceId: transferId,
      quantity,
    }),
  ];
  if (hasReceipt && receiptAmount > 0) {
    ledgerEntries.push(makeMovement({
      id: `receipt-${receiptId}`,
      key: `stock-transfer:${receiptId}:${shipmentLineId}:good:uncosted`,
      type: "TRANSFER_RECEIPT",
      sourceLocationId: transitId,
      destinationLocationId: "distributor",
      referenceType: "STOCK_TRANSFER_RECEIPT",
      referenceId: receiptId,
      quantity: receiptAmount,
    }));
  }

  return {
    coverage: { ...completeCoverage },
    transfers: [transfer],
    shipments: [shipment],
    receipts: receipt ? [receipt] : [],
    discrepancies: [],
    ledgerEntries,
    balances: [
      { locationId: "factory", inventorySkuId: "sku", quantityOnHand: 0, reservedQuantity: 0 },
      {
        locationId: transitId,
        inventorySkuId,
        quantityOnHand: quantity - receiptAmount,
        reservedQuantity: 0,
      },
      {
        locationId: "distributor",
        inventorySkuId,
        quantityOnHand: receiptAmount,
        reservedQuantity: 0,
      },
      { locationId: "damaged-distributor", inventorySkuId: "sku", quantityOnHand: 0, reservedQuantity: 0 },
      { locationId: "lost-distributor", inventorySkuId: "sku", quantityOnHand: 0, reservedQuantity: 0 },
    ],
    locations: [
      { id: "factory", locationKey: "FACTORY:factory", kind: "FACTORY", inventoryOwner: "PLATFORM" },
      {
        id: transitId,
        locationKey: `IN_TRANSIT:${shipmentId}`,
        kind: "IN_TRANSIT",
        distributorId: "distributor-account",
        inventoryOwner: "PLATFORM",
      },
      {
        id: "distributor",
        locationKey: "DISTRIBUTOR:distributor-account",
        kind: "DISTRIBUTOR",
        distributorId: "distributor-account",
        inventoryOwner: "PLATFORM",
      },
      {
        id: "damaged-distributor",
        locationKey: "DAMAGED:distributor-account",
        kind: "DAMAGED",
        distributorId: "distributor-account",
        inventoryOwner: "PLATFORM",
      },
      {
        id: "lost-distributor",
        locationKey: "LOST:distributor-account",
        kind: "LOST",
        distributorId: "distributor-account",
        inventoryOwner: "PLATFORM",
      },
    ],
  };
};

const codes = (input) => reconcileStockTransfers(input).exceptions.map(({ code }) => code);
const hasCode = (input, code) => codes(input).includes(code);
const clone = (value) => structuredClone(value);

test("fully authorized dispatch and receipt reconcile without exceptions", () => {
  const result = reconcileStockTransfers(makeFixture());

  assert.equal(result.reportStatus, "NO_EXCEPTION_DETECTED");
  assert.equal(result.transfers[0].lines[0].authorizedQuantity, 5);
  assert.equal(result.transfers[0].lines[0].dispatchedLedgerQuantity, 5);
  assert.equal(result.transfers[0].lines[0].receivedReportedQuantity, 5);
  assert.equal(result.transfers[0].lines[0].outstandingInTransitQuantity, 0);
  assert.deepEqual(result.exceptions, []);
});

test("partial dispatch remains separate from authorization and transit", () => {
  const input = makeFixture({
    quantity: 4,
    authorizedQuantity: 10,
    receivedQuantity: null,
    transferStatus: "IN_TRANSIT",
  });
  const line = reconcileStockTransfers(input).transfers[0].lines[0];

  assert.equal(line.authorizedQuantity, 10);
  assert.equal(line.dispatchedShipmentQuantity, 4);
  assert.equal(line.dispatchedLedgerQuantity, 4);
  assert.equal(line.authorizedUnshippedQuantity, 6);
  assert.equal(line.outstandingInTransitQuantity, 4);
  assert.ok(hasCode(input, "UNRESOLVED_IN_TRANSIT"));
});

test("partial receipt is reported without treating the remainder as received", () => {
  const input = makeFixture({
    quantity: 5,
    receivedQuantity: 3,
    transferStatus: "PARTIALLY_RECEIVED",
  });
  const line = reconcileStockTransfers(input).transfers[0].lines[0];

  assert.equal(line.receivedReportedQuantity, 3);
  assert.equal(line.receivedLedgerQuantity, 3);
  assert.equal(line.outstandingInTransitQuantity, 2);
  assert.ok(hasCode(input, "PARTIAL_RECEIPT"));
  assert.ok(hasCode(input, "UNRESOLVED_IN_TRANSIT"));
});

test("shipment status alone does not establish dispatch quantity", () => {
  const input = makeFixture({ receivedQuantity: null, transferStatus: "IN_TRANSIT" });
  input.shipments[0].dispatchedAt = null;
  input.shipments[0].status = "DISPATCHED";
  input.ledgerEntries = input.ledgerEntries.filter((entry) => entry.movementType !== "TRANSFER_DISPATCH");
  input.transfers[0].lines[0].dispatchedQuantity = 0;

  const result = reconcileStockTransfers(input);
  assert.equal(result.reportStatus, "RECONCILIATION_INCOMPLETE");
  assert.ok(hasCode(input, "INSUFFICIENT_EVIDENCE"));
  assert.ok(!hasCode(input, "DISPATCH_WITHOUT_LEDGER_ENTRY"));
});

test("dispatch timestamp without a linked dispatch movement is explicit", () => {
  const input = makeFixture({ receivedQuantity: null, transferStatus: "IN_TRANSIT" });
  input.ledgerEntries = input.ledgerEntries.filter((entry) => entry.movementType !== "TRANSFER_DISPATCH");

  assert.ok(hasCode(input, "DISPATCH_WITHOUT_LEDGER_ENTRY"));
});

test("a receipt record remains visible when its receipt ledger movement is missing", () => {
  const input = makeFixture();
  input.ledgerEntries = input.ledgerEntries.filter((entry) => entry.movementType !== "TRANSFER_RECEIPT");
  const line = reconcileStockTransfers(input).transfers[0].lines[0];

  assert.equal(line.receivedReportedQuantity, 5);
  assert.equal(line.receivedLedgerQuantity, null);
  assert.ok(hasCode(input, "QUANTITY_MISMATCH"));
});

test("receipt quantities never substitute for dispatch evidence", () => {
  const input = makeFixture();
  input.ledgerEntries = input.ledgerEntries.filter((entry) => entry.movementType !== "TRANSFER_DISPATCH");

  assert.ok(hasCode(input, "RECEIPT_WITHOUT_DISPATCH"));
});

test("receipt without dispatch is found per shipment line even when another line was dispatched", () => {
  const input = makeFixture({
    quantity: 2,
    authorizedQuantity: 5,
    receivedQuantity: null,
    transferStatus: "IN_TRANSIT",
  });
  input.shipments.push({
    id: "shipment-2",
    stockTransferId: "transfer",
    status: "DELIVERED",
    dispatchedAt: "2026-01-02T00:00:00.000Z",
    lines: [{
      id: "shipment-line-2",
      stockTransferLineId: "line-transfer",
      quantity: 3,
    }],
  });
  input.receipts.push({
    id: "receipt-2",
    shipmentId: "shipment-2",
    status: "CONFIRMED",
    receivedBy: "distributor-user",
    receivedAt: "2026-01-03T00:00:00.000Z",
    lines: [{
      id: "receipt-line-2",
      shipmentLineId: "shipment-line-2",
      goodQuantity: 3,
      damagedQuantity: 0,
      missingQuantity: 0,
    }],
  });
  input.locations.push({
    id: "transit-shipment-2",
    locationKey: "IN_TRANSIT:shipment-2",
    kind: "IN_TRANSIT",
    distributorId: "distributor-account",
    inventoryOwner: "PLATFORM",
  });
  input.ledgerEntries.push(makeMovement({
    id: "receipt-ledger-2",
    key: "stock-transfer:receipt-2:shipment-line-2:good:uncosted",
    type: "TRANSFER_RECEIPT",
    sourceLocationId: "transit-shipment-2",
    destinationLocationId: "distributor",
    referenceType: "STOCK_TRANSFER_RECEIPT",
    referenceId: "receipt-2",
    quantity: 3,
  }));

  assert.ok(hasCode(input, "RECEIPT_WITHOUT_DISPATCH"));
});

test("duplicate dispatch movements are detected and not summed as a valid dispatch", () => {
  const input = makeFixture();
  input.ledgerEntries.push({
    ...clone(input.ledgerEntries.find((entry) => entry.movementType === "TRANSFER_DISPATCH")),
    id: "duplicate-dispatch",
  });

  const result = reconcileStockTransfers(input);
  assert.ok(result.exceptions.some((exception) =>
    exception.code === "DUPLICATE_MOVEMENT" && exception.ledgerEntryIds.length === 2
  ));
  assert.equal(result.transfers[0].lines[0].dispatchedLedgerQuantity, null);
});

test("duplicate receipt movements are detected rather than counted twice", () => {
  const input = makeFixture();
  input.ledgerEntries.push({
    ...clone(input.ledgerEntries.find((entry) => entry.movementType === "TRANSFER_RECEIPT")),
    id: "duplicate-receipt",
  });

  assert.ok(hasCode(input, "DUPLICATE_MOVEMENT"));
  assert.equal(reconcileStockTransfers(input).transfers[0].lines[0].receivedLedgerQuantity, null);
});

test("unreferenced transfer ledger movements are reported as orphans", () => {
  const input = makeFixture();
  input.ledgerEntries.push(makeMovement({
    id: "orphan",
    key: "orphan-key",
    type: "TRANSFER_DISPATCH",
    sourceLocationId: "factory",
    destinationLocationId: "transit-shipment",
    referenceType: "STOCK_TRANSFER",
    referenceId: "unknown-transfer",
    quantity: 1,
  }));

  assert.ok(hasCode(input, "ORPHAN_LEDGER_ENTRY"));
});

test("ledger movements with no exact shipment key remain explicitly unlinked", () => {
  const input = makeFixture({ receivedQuantity: null, transferStatus: "IN_TRANSIT" });
  const dispatch = input.ledgerEntries.find((entry) => entry.movementType === "TRANSFER_DISPATCH");
  dispatch.idempotencyKey = "legacy-dispatch-key";

  assert.ok(hasCode(input, "INSUFFICIENT_EVIDENCE"));
  assert.ok(hasCode(input, "ORPHAN_LEDGER_ENTRY"));
});

test("ledger-to-balance differences are surfaced", () => {
  const input = makeFixture();
  input.balances.find((balance) => balance.locationId === "distributor").quantityOnHand = 4;

  assert.ok(hasCode(input, "BALANCE_MISMATCH"));
});

test("cancellation does not erase dispatch movement evidence", () => {
  const input = makeFixture();
  input.transfers[0].status = "CANCELLED";

  assert.ok(hasCode(input, "CANCELLED_WITH_RECORDED_MOVEMENT"));
});

test("positive approval without reviewer and approval time is unauthorized", () => {
  const input = makeFixture();
  input.transfers[0].reviewedByAccountId = null;
  input.transfers[0].reviewedAt = null;

  assert.ok(hasCode(input, "MISSING_AUTHORIZATION"));
});

test("status conflicts with incomplete received quantity are reported", () => {
  const input = makeFixture({ quantity: 5, receivedQuantity: 4, transferStatus: "RECEIVED" });

  assert.ok(hasCode(input, "INVALID_STATUS_TRANSITION"));
});

test("dispatch quantities above authorization are reported", () => {
  const input = makeFixture({
    quantity: 5,
    authorizedQuantity: 4,
    receivedQuantity: null,
    transferStatus: "IN_TRANSIT",
  });

  assert.ok(hasCode(input, "QUANTITY_MISMATCH"));
});

test("receipt quantities above dispatched quantities are reported", () => {
  const input = makeFixture({ quantity: 5, receivedQuantity: 6, transferStatus: "DISCREPANCY" });
  const receiptEntry = input.ledgerEntries.find((entry) => entry.movementType === "TRANSFER_RECEIPT");
  receiptEntry.quantity = 6;

  assert.ok(hasCode(input, "QUANTITY_MISMATCH"));
});

test("incomplete source coverage never produces a reconciled result", () => {
  const input = makeFixture();
  input.coverage.ledgerEntries = false;

  assert.equal(reconcileStockTransfers(input).reportStatus, "RECONCILIATION_INCOMPLETE");
  assert.ok(hasCode(input, "INSUFFICIENT_EVIDENCE"));
});

test("unavailable source data has a distinct report status", () => {
  const input = makeFixture();
  input.sourceErrors = ["ledgerEntries"];

  const result = reconcileStockTransfers(input);
  assert.equal(result.reportStatus, "DATA_UNAVAILABLE");
  assert.deepEqual(result.unavailableSources, ["ledgerEntries"]);
});

test("same SKU and locations across transfers retain independent movement attribution", () => {
  const first = makeFixture({
    transferId: "transfer-a",
    shipmentId: "shipment-a",
    receiptId: "receipt-a",
    shipmentLineId: "shipment-line-a",
    receiptLineId: "receipt-line-a",
  });
  const second = makeFixture({
    transferId: "transfer-b",
    shipmentId: "shipment-b",
    receiptId: "receipt-b",
    shipmentLineId: "shipment-line-b",
    receiptLineId: "receipt-line-b",
  });
  const input = clone(first);
  input.transfers.push(...second.transfers);
  input.shipments.push(...second.shipments);
  input.receipts.push(...second.receipts);
  input.ledgerEntries.push(...second.ledgerEntries);
  input.locations.push(...second.locations.filter((location) =>
    location.id.startsWith("transit-")
  ));
  input.balances = [
    { locationId: "factory", inventorySkuId: "sku", quantityOnHand: 0, reservedQuantity: 0 },
    { locationId: "distributor", inventorySkuId: "sku", quantityOnHand: 10, reservedQuantity: 0 },
    ...input.locations
      .filter((location) => location.kind === "IN_TRANSIT")
      .map((location) => ({
        locationId: location.id,
        inventorySkuId: "sku",
        quantityOnHand: 0,
        reservedQuantity: 0,
      })),
  ];

  const result = reconcileStockTransfers(input);
  assert.equal(result.transfers.length, 2);
  assert.deepEqual(
    result.transfers.map((transfer) => transfer.dispatchedShipmentQuantity),
    [5, 5]
  );
  assert.equal(result.reportStatus, "NO_EXCEPTION_DETECTED");
});

test("pending transfers may have no approved quantity without becoming invalid", () => {
  const input = makeFixture({ receivedQuantity: null, transferStatus: "PENDING_ADMIN_APPROVAL" });
  input.transfers[0].lines[0].approvedQuantity = null;
  input.transfers[0].lines[0].dispatchedQuantity = 0;
  input.shipments = [];
  input.ledgerEntries = [];
  input.balances = [];

  const result = reconcileStockTransfers(input);
  assert.equal(result.transfers[0].lines[0].authorizedQuantity, null);
  assert.ok(!result.exceptions.some((exception) => exception.code === "QUANTITY_MISMATCH"));
});

test("Prisma Int boundary quantities remain exact and malformed quantities are rejected", () => {
  const input = makeFixture({ receivedQuantity: null, transferStatus: "APPROVED" });
  input.transfers[0].lines[0].requestedQuantity = "2147483647";
  input.transfers[0].lines[0].approvedQuantity = 2147483647n;
  input.transfers[0].lines[0].dispatchedQuantity = 0;
  input.shipments = [];
  input.ledgerEntries = [];
  input.balances = [];

  assert.equal(reconcileStockTransfers(input).transfers[0].lines[0].authorizedQuantity, 2147483647);

  input.transfers[0].lines[0].requestedQuantity = "1.5";
  const invalid = reconcileStockTransfers(input);
  assert.ok(invalid.exceptions.some((exception) => exception.code === "QUANTITY_MISMATCH"));
  assert.equal(invalid.transfers[0].lines[0].requestedQuantity, null);
});

test("invalid out-of-range quantities are not silently accepted", () => {
  const input = makeFixture({ receivedQuantity: null, transferStatus: "APPROVED" });
  input.transfers[0].lines[0].requestedQuantity = 2147483648;
  input.transfers[0].lines[0].approvedQuantity = 2147483648;
  input.transfers[0].lines[0].dispatchedQuantity = 0;
  input.shipments = [];
  input.ledgerEntries = [];
  input.balances = [];

  assert.ok(hasCode(input, "QUANTITY_MISMATCH"));
});

test("input records are not mutated", () => {
  const input = makeFixture();
  const before = clone(input);
  const freeze = (value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    return value;
  };

  assert.doesNotThrow(() => reconcileStockTransfers(freeze(input)));
  assert.deepEqual(input, before);
});

test("identical and repeated calls produce identical results without side effects", () => {
  const input = makeFixture();
  const before = clone(input);
  const first = reconcileStockTransfers(input);
  const second = reconcileStockTransfers(input);

  assert.deepEqual(second, first);
  assert.deepEqual(input, before);
});

test("a receipt missing its shipment-line linkage is incomplete, not a missing receipt", () => {
  const input = makeFixture();
  input.receipts[0].lines[0].shipmentLineId = "unknown-shipment-line";

  const result = reconcileStockTransfers(input);
  assert.equal(result.reportStatus, "RECONCILIATION_INCOMPLETE");
  assert.ok(result.exceptions.some((exception) => exception.code === "INSUFFICIENT_EVIDENCE"));
  assert.ok(!result.exceptions.some((exception) => exception.code === "MISSING_RECEIPT"));
  assert.ok(!result.exceptions.some((exception) => exception.code === "RECEIPT_WITHOUT_DISPATCH"));
});

test("reserved quantities are distinct from dispatch quantities", () => {
  const input = makeFixture({
    quantity: 3,
    authorizedQuantity: 5,
    receivedQuantity: null,
    transferStatus: "IN_TRANSIT",
  });
  input.transfers[0].lines[0].dispatchedQuantity = 0;
  input.transfers[0].lines[0].reservedShipmentQuantity = 3;
  input.shipments[0].status = "BOOKED";
  input.shipments[0].dispatchedAt = null;
  input.shipments[0].lines[0].quantity = 3;
  input.ledgerEntries = [];
  input.balances = [];

  const line = reconcileStockTransfers(input).transfers[0].lines[0];
  assert.equal(line.reservedQuantity, 3);
  assert.equal(line.dispatchedLedgerQuantity, 0);
  assert.equal(line.outstandingInTransitQuantity, 0);
});

test("reservation counter mismatches are reported independently of dispatch", () => {
  const input = makeFixture({
    quantity: 3,
    authorizedQuantity: 5,
    receivedQuantity: null,
    transferStatus: "IN_TRANSIT",
  });
  input.transfers[0].lines[0].dispatchedQuantity = 0;
  input.transfers[0].lines[0].reservedShipmentQuantity = 2;
  input.shipments[0].status = "BOOKED";
  input.shipments[0].dispatchedAt = null;
  input.ledgerEntries = [];
  input.balances = [];

  assert.ok(hasCode(input, "QUANTITY_MISMATCH"));
});

const duplicateCandidateFixture = (transferId, overrides = {}) => makeFixture({
  transferId,
  shipmentId: `shipment-${transferId}`,
  receiptId: `receipt-${transferId}`,
  shipmentLineId: `shipment-line-${transferId}`,
  receiptLineId: `receipt-line-${transferId}`,
  requestedAt: "2026-02-01T10:00:00.000Z",
  ...overrides,
});

const appendTransfer = (input, candidate) => {
  input.transfers.push(candidate.transfers[0]);
  return input;
};

test("repeated transfer identifiers are distinguished from business-level candidates", () => {
  const input = makeFixture();
  input.transfers.push(clone(input.transfers[0]));

  const result = reconcileStockTransfers(input);
  assert.ok(result.exceptions.some((exception) => exception.code === "DUPLICATE_TRANSFER_IDENTIFIER"));
  assert.ok(!result.exceptions.some((exception) => exception.code === "POSSIBLE_DUPLICATE_TRANSFER"));
});

test("conflicting shipment booking idempotency keys are reported with all record IDs", () => {
  const input = makeFixture();
  input.shipments[0].bookingIdempotencyKey = "booking-key";
  input.shipments[0].bookingRequestHash = "hash-a";
  input.shipments.push({
    id: "shipment-collision",
    stockTransferId: "transfer",
    status: "BOOKING_UNKNOWN",
    bookingIdempotencyKey: "booking-key",
    bookingRequestHash: "hash-b",
    lines: [],
  });

  const exception = reconcileStockTransfers(input).exceptions.find((item) =>
    item.code === "TRANSFER_IDEMPOTENCY_CONFLICT"
  );
  assert.deepEqual(exception.relatedShipmentIds, ["shipment", "shipment-collision"]);
  assert.deepEqual(exception.relatedTransferIds, ["transfer"]);
});

test("same exact business fingerprint is a possible duplicate, not a confirmed duplicate", () => {
  const first = duplicateCandidateFixture("transfer-one");
  const second = duplicateCandidateFixture("transfer-two");
  const input = appendTransfer(clone(first), second);

  const candidates = reconcileStockTransfers(input).exceptions.filter((item) =>
    item.code === "POSSIBLE_DUPLICATE_TRANSFER"
  );
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].relatedTransferIds, ["transfer-one", "transfer-two"]);
  assert.equal(candidates[0].investigationStatus, "REQUIRES_INVESTIGATION");
});

test("same locations and quantity with different request times remain separate transfers", () => {
  const first = duplicateCandidateFixture("transfer-one");
  const second = duplicateCandidateFixture("transfer-two", {
    requestedAt: "2026-02-01T10:00:01.000Z",
  });
  const input = appendTransfer(clone(first), second);

  assert.ok(!hasCode(input, "POSSIBLE_DUPLICATE_TRANSFER"));
});

test("different requested quantities are not grouped as possible duplicates", () => {
  const first = duplicateCandidateFixture("transfer-one");
  const second = duplicateCandidateFixture("transfer-two", { quantity: 4, authorizedQuantity: 4 });

  assert.ok(!hasCode(appendTransfer(clone(first), second), "POSSIBLE_DUPLICATE_TRANSFER"));
});

test("different product variants are not grouped as possible duplicates", () => {
  const first = duplicateCandidateFixture("transfer-one");
  const second = duplicateCandidateFixture("transfer-two", { inventorySkuId: "sku-other" });

  assert.ok(!hasCode(appendTransfer(clone(first), second), "POSSIBLE_DUPLICATE_TRANSFER"));
});

test("different source locations are not grouped as possible duplicates", () => {
  const first = duplicateCandidateFixture("transfer-one");
  const second = duplicateCandidateFixture("transfer-two", { sourceLocationId: "factory-other" });

  assert.ok(!hasCode(appendTransfer(clone(first), second), "POSSIBLE_DUPLICATE_TRANSFER"));
});

test("missing duplicate-comparison fields produce insufficient evidence, not a guess", () => {
  const input = makeFixture();
  input.transfers[0].requestedByAccountId = null;
  input.transfers[0].requestedAt = null;

  assert.ok(hasCode(input, "INSUFFICIENT_EVIDENCE"));
  assert.ok(!hasCode(input, "POSSIBLE_DUPLICATE_TRANSFER"));
});

test("one duplicate candidate group contains every matching transfer exactly once", () => {
  const first = duplicateCandidateFixture("transfer-one");
  const second = duplicateCandidateFixture("transfer-two");
  const third = duplicateCandidateFixture("transfer-three");
  const input = appendTransfer(appendTransfer(clone(first), second), third);

  const candidates = reconcileStockTransfers(input).exceptions.filter((item) =>
    item.code === "POSSIBLE_DUPLICATE_TRANSFER"
  );
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].relatedTransferIds, [
    "transfer-one",
    "transfer-three",
    "transfer-two",
  ].sort());
});

test("duplicate candidate exception is stable when transfer input order changes", () => {
  const first = duplicateCandidateFixture("transfer-one");
  const second = duplicateCandidateFixture("transfer-two");
  const third = duplicateCandidateFixture("transfer-three");
  const forward = appendTransfer(appendTransfer(clone(first), second), third);
  const reverse = clone(forward);
  reverse.transfers.reverse();
  const extract = (input) => reconcileStockTransfers(input).exceptions
    .filter((item) => item.code === "POSSIBLE_DUPLICATE_TRANSFER");

  assert.deepEqual(extract(reverse), extract(forward));
});

test("transfers without duplicate evidence preserve normal P5-R16 results", () => {
  const input = makeFixture();
  const result = reconcileStockTransfers(input);

  assert.equal(result.reportStatus, "NO_EXCEPTION_DETECTED");
  assert.deepEqual(result.exceptions, []);
});

const addAuthoritativeLayerEvidence = (input, { allocations, uncostedQuantity = 0 } = {}) => {
  const layer = {
    id: "cost-layer",
    inventorySkuId: "sku",
    manufacturerId: "manufacturer",
    productId: "product",
    unitCogs: "12.50000000000000",
    producedQuantity: 10,
  };
  input.coverage.costLayers = true;
  input.costLayers = [layer];
  input.shipments[0].lines[0].uncostedQuantity = uncostedQuantity;
  input.shipments[0].lines[0].costLayerAllocations = allocations || [{
    id: "shipment-cost-allocation",
    costLayerId: layer.id,
    quantity: input.shipments[0].lines[0].quantity - uncostedQuantity,
    status: "DISPATCHED",
    costLayer: layer,
  }];
  return layer;
};

test("valid dispatched cost-layer allocations establish authoritative cost coverage", () => {
  const input = makeFixture();
  addAuthoritativeLayerEvidence(input);
  const line = reconcileStockTransfers(input).transfers[0].lines[0];

  assert.equal(line.costEvidence.status, "COVERED");
  assert.equal(line.costEvidence.authoritativeCostLayerQuantity, 5);
  assert.equal(line.costEvidence.uncostedQuantity, 0);
  assert.ok(line.costEvidence.classifications.some((item) =>
    item.classification === "AUTHORITATIVE_COST_LAYER" && item.quantity === 5
  ));
});

test("receipt movement linked to a valid cost layer is classified as verified received cost", () => {
  const input = makeFixture();
  const layer = addAuthoritativeLayerEvidence(input);
  input.ledgerEntries.find((entry) => entry.movementType === "TRANSFER_RECEIPT")
    .productionCostLayerId = layer.id;
  const line = reconcileStockTransfers(input).transfers[0].lines[0];

  assert.equal(line.costEvidence.verifiedReceivedCostQuantity, 5);
  assert.ok(line.costEvidence.classifications.some((item) =>
    item.classification === "VERIFIED_RECEIVED_COST" && item.quantity === 5
  ));
});

for (const classification of [
  "HISTORICAL_COST_SNAPSHOT",
  "REFERENCE_OR_CATALOG_COST",
  "ESTIMATE",
  "UNRECONCILED",
]) {
  test(`${classification} remains separately classified supplemental evidence`, () => {
    const input = makeFixture();
    input.coverage.costEvidence = true;
    input.costEvidence = [{
      transferLineId: "line-transfer",
      evidenceId: `evidence-${classification}`,
      classification,
      quantity: 5,
    }];

    const line = reconcileStockTransfers(input).transfers[0].lines[0];
    assert.ok(line.costEvidence.classifications.some((item) => item.classification === classification));
    assert.equal(line.costEvidence.authoritativeCostLayerQuantity, null);
  });
}

test("explicit uncosted shipment quantity is reported as missing cost coverage, not zero value", () => {
  const input = makeFixture();
  addAuthoritativeLayerEvidence(input, { allocations: [], uncostedQuantity: 5 });
  const result = reconcileStockTransfers(input);
  const line = result.transfers[0].lines[0];

  assert.ok(result.exceptions.some((item) =>
    item.code === "UNCOSTED_TRANSFER_QUANTITY" && item.actualQuantity === 5
  ));
  assert.ok(line.costEvidence.classifications.some((item) =>
    item.classification === "MISSING" && item.quantity === 5
  ));
  assert.equal(line.costEvidence.status, "PARTIAL");
});

test("partial quantity coverage reports authoritative and uncosted quantities separately", () => {
  const input = makeFixture();
  const layer = addAuthoritativeLayerEvidence(input, { uncostedQuantity: 2 });
  input.shipments[0].lines[0].costLayerAllocations = [{
    id: "layer-allocation",
    costLayerId: layer.id,
    quantity: 3,
    status: "DISPATCHED",
    costLayer: layer,
  }];
  const line = reconcileStockTransfers(input).transfers[0].lines[0];

  assert.equal(line.costEvidence.authoritativeCostLayerQuantity, 3);
  assert.equal(line.costEvidence.uncostedQuantity, 2);
  assert.equal(line.costEvidence.status, "PARTIAL");
});

test("multiple production cost layers can cover one shipment line exactly", () => {
  const input = makeFixture();
  const firstLayer = addAuthoritativeLayerEvidence(input, {
    allocations: [
      { id: "allocation-a", costLayerId: "layer-a", quantity: 2, status: "DISPATCHED" },
      { id: "allocation-b", costLayerId: "layer-b", quantity: 3, status: "DISPATCHED" },
    ],
  });
  firstLayer.id = "layer-a";
  const secondLayer = {
    ...firstLayer,
    id: "layer-b",
    unitCogs: "14.00",
  };
  input.costLayers = [firstLayer, secondLayer];
  input.shipments[0].lines[0].costLayerAllocations[0].costLayer = firstLayer;
  input.shipments[0].lines[0].costLayerAllocations[1].costLayer = secondLayer;

  assert.equal(
    reconcileStockTransfers(input).transfers[0].lines[0].costEvidence.authoritativeCostLayerQuantity,
    5
  );
});

test("a missing cost-layer record leaves cost evidence unreconciled", () => {
  const input = makeFixture();
  addAuthoritativeLayerEvidence(input, {
    allocations: [{
      id: "allocation",
      costLayerId: "missing-layer",
      quantity: 5,
      status: "DISPATCHED",
    }],
  });
  input.costLayers = [];

  const result = reconcileStockTransfers(input);
  assert.equal(result.transfers[0].lines[0].costEvidence.status, "UNRECONCILED");
  assert.ok(hasCode(input, "INSUFFICIENT_EVIDENCE"));
  assert.ok(!hasCode(input, "UNCOSTED_TRANSFER_QUANTITY"));
});

test("catalog or estimate evidence does not establish authoritative cost and absent cost is not zero", () => {
  const input = makeFixture();
  input.coverage.costEvidence = true;
  input.costEvidence = [
    { transferLineId: "line-transfer", evidenceId: "catalog", classification: "REFERENCE_OR_CATALOG_COST", quantity: 5 },
    { transferLineId: "line-transfer", evidenceId: "estimate", classification: "ESTIMATE", quantity: 5 },
  ];
  const line = reconcileStockTransfers(input).transfers[0].lines[0];

  assert.equal(line.costEvidence.authoritativeCostLayerQuantity, null);
  assert.equal(line.costEvidence.status, "UNRECONCILED");
  assert.ok(!line.costEvidence.classifications.some((item) =>
    item.classification === "AUTHORITATIVE_COST_LAYER" && item.quantity === 0
  ));
});

test("stock transfer cost assessment does not create a COGS event or change ownership", () => {
  const input = makeFixture();
  addAuthoritativeLayerEvidence(input);
  const result = reconcileStockTransfers(input);

  assert.equal(result.transfers[0].inventoryOwner, "PLATFORM");
  assert.ok(!result.transfers[0].lines[0].cogs);
  assert.ok(input.ledgerEntries.every((entry) => entry.movementType !== "COGS"));
});

test("duplicate and cost evidence inputs stay immutable across repeated calculations", () => {
  const first = duplicateCandidateFixture("transfer-one");
  const second = duplicateCandidateFixture("transfer-two");
  const input = appendTransfer(clone(first), second);
  addAuthoritativeLayerEvidence(input, { uncostedQuantity: 1 });
  input.shipments[0].lines[0].quantity = 5;
  input.shipments[0].lines[0].costLayerAllocations[0].quantity = 4;
  input.costEvidence = [{
    transferLineId: "line-transfer-one",
    evidenceId: "historical-snapshot",
    classification: "HISTORICAL_COST_SNAPSHOT",
    quantity: 5,
  }];
  input.coverage.costEvidence = true;
  const before = clone(input);
  const freeze = (value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    return value;
  };
  freeze(input);

  assert.deepEqual(reconcileStockTransfers(input), reconcileStockTransfers(input));
  assert.deepEqual(input, before);
});
