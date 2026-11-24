import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReceiptRequestHash,
  buildNcmStockTransferPayload,
  extractNcmOrderId,
  deriveTransferStatus,
  latestNcmStockTransferStatus,
  normalizeNcmStockTransferEvent,
  normalizeNcmStockTransferStatusHistory,
  shouldAdvanceNcmStockTransferStatus,
  isStaleNcmStockTransferEvent,
  normalizeNcmOrderId,
  normalizeNcmStockTransferPackageDetails,
  normalizeApprovalLines,
  normalizeShipmentReceiptLines,
  normalizeTransferPreparationChecklist,
  normalizeTransferRequestLines,
  isNcmBranchEligible,
  isTransferPreparationComplete,
  isStockTransferEditable,
  isSameProfileOwner,
  isPositiveLocalFreightCharge,
  planCostLayerAllocations,
  planReceivedCostLayerAllocations,
  remainingApprovedQuantity,
  validateTransferRequestAvailability,
  normalizeDispatchRequestLines,
  assertDispatchAvailability,
  planCanonicalTransferDispatch,
  validateWebhookDispatchAuthorization,
  assessLegacyDispatchProjectionConsistency,
  normalizeReceiptWholeNumber,
  evaluateTransferReceiptEligibility,
  evaluateStockTransferReceiptReplay,
  buildCanonicalStockTransferReceiptPlan,
} from "../services/stockTransferService.js";

test("stock request lines require positive quantities and unique SKUs", () => {
  assert.deepEqual(normalizeTransferRequestLines([
    { inventorySkuId: "sku-1", quantity: 5 },
  ]), [{ inventorySkuId: "sku-1", requestedQuantity: 5 }]);
  assert.throws(() => normalizeTransferRequestLines([
    { inventorySkuId: "sku-1", quantity: 2 },
    { inventorySkuId: "sku-1", quantity: 1 },
  ]), /unique/);
  assert.throws(() => normalizeTransferRequestLines([{ inventorySkuId: "sku-1", quantity: 0 }]), /positive whole number/);
});

test("stock request cannot exceed unreserved factory stock for any SKU", () => {
  const requestLines = [
    { inventorySkuId: "sku-1", requestedQuantity: 5 },
    { inventorySkuId: "sku-2", requestedQuantity: 2 },
  ];
  const factoryBalances = [
    { inventorySkuId: "sku-1", quantityOnHand: 8, reservedQuantity: 3 },
    { inventorySkuId: "sku-2", quantityOnHand: 2, reservedQuantity: 0 },
  ];

  assert.equal(validateTransferRequestAvailability(requestLines, factoryBalances), requestLines);
  assert.throws(
    () => validateTransferRequestAvailability(
      [{ inventorySkuId: "sku-1", requestedQuantity: 6 }],
      factoryBalances,
    ),
    (error) => error.code === "INSUFFICIENT_FACTORY_STOCK" &&
      error.statusCode === 409 &&
      error.message === "The manufacturer has only 5 units available for this product variant, but you requested 6. Reduce the quantity or choose another variant." &&
      !error.message.includes("sku-1"),
  );
  assert.throws(
    () => validateTransferRequestAvailability(
      [{ inventorySkuId: "missing-sku", requestedQuantity: 1 }],
      factoryBalances,
    ),
    (error) => error.code === "INSUFFICIENT_FACTORY_STOCK",
  );
});

test("manufacturer preparation checklist requires explicit pass/fail values before dispatch", () => {
  const checklist = normalizeTransferPreparationChecklist({
    availabilityPassed: true,
    qualityPassed: true,
    colorPassed: true,
    sizePassed: true,
    packagingPassed: true,
  });
  assert.equal(isTransferPreparationComplete(checklist), true);
  assert.throws(() => normalizeTransferPreparationChecklist({ availabilityPassed: true }), /must be true or false/);
  assert.equal(isTransferPreparationComplete({ ...checklist, packagingPassed: false }), false);
});

test("stock transfer edits lock after all preparation checks pass or shipment activity begins", () => {
  const transfer = {
    status: "APPROVED",
    availabilityPassed: false,
    qualityPassed: false,
    colorPassed: false,
    sizePassed: false,
    packagingPassed: false,
    lines: [{ dispatchedQuantity: 0, reservedShipmentQuantity: 0 }],
    shipments: [],
  };
  assert.equal(isStockTransferEditable(transfer), true);
  assert.equal(isStockTransferEditable({
    ...transfer,
    packagingPassed: true,
    availabilityPassed: true,
    qualityPassed: true,
    colorPassed: true,
    sizePassed: true,
  }), false);
  assert.equal(isStockTransferEditable({
    ...transfer,
    shipments: [{ id: "shipment-1" }],
  }), false);
  assert.equal(isStockTransferEditable({
    ...transfer,
    status: "IN_TRANSIT",
  }), false);
});

test("own-store delivery requires the same linked manufacturer and distributor account", () => {
  assert.equal(isSameProfileOwner("account-1", "account-1"), true);
  assert.equal(isSameProfileOwner("account-1", "account-2"), false);
  assert.equal(isSameProfileOwner(null, "account-1"), false);
});

test("NCM branch catalog validates an unverified selection but not rejected or unavailable branches", () => {
  const activeBranchNames = ["KATHMANDU", "POKHARA"];
  assert.equal(isNcmBranchEligible({
    branchName: "Pokhara",
    status: "UNVERIFIED",
    activeBranchNames,
  }), true);
  assert.equal(isNcmBranchEligible({
    branchName: "Kathmandu",
    status: "REJECTED",
    activeBranchNames,
  }), false);
  assert.equal(isNcmBranchEligible({
    branchName: "Biratnagar",
    status: "UNVERIFIED",
    activeBranchNames,
  }), false);
});

test("NCM stock transfer package details map only to documented fields", () => {
  const transfer = {
    id: "transfer-12345678",
    manufacturer: { ncmPickupBranch: "SANKHU" },
    distributor: { name: "Distributor", phone: "9800000000", address: "Pokhara", city: "Pokhara", ncmPickupBranch: "POKHARA" },
  };
  const packageDetails = normalizeNcmStockTransferPackageDetails({
    packageType: "Carton",
    productType: "Apparel",
    productDescription: "Shirts and trousers",
    packageWeight: "2.5",
    packageDimensions: "40 x 30 x 25 cm",
    deliveryInstruction: "Call on arrival",
    isFragile: true,
    packagingNotes: "Waterproof wrapping",
  });
  const payload = buildNcmStockTransferPayload({ transfer, packageDetails });
  assert.deepEqual(payload, {
    name: "Distributor",
    phone: "9800000000",
    phone2: "",
    cod_charge: "0",
    address: "Pokhara",
    fbranch: "SANKHU",
    branch: "POKHARA",
    package: "Carton",
    instruction: "Call on arrival No COD collection.",
    delivery_type: "Door2Door",
    weight: "2.5",
  });
  assert.equal("vref_id" in payload, false);
  assert.equal("packageType" in payload, false);
  assert.equal("packageDimensions" in payload, false);
});

test("NCM stock transfer payload caps long package types at 50 characters", () => {
  const transfer = {
    id: "transfer-12345678",
    manufacturer: { ncmPickupBranch: "SANKHU" },
    distributor: { name: "Distributor", phone: "9800000000", address: "Pokhara", ncmPickupBranch: "POKHARA" },
  };
  const packageDetails = normalizeNcmStockTransferPackageDetails({
    packageType: "Special reinforced shipment carton for bulk items and materials",
    productType: "Apparel",
    productDescription: "Bulk clothing",
    packageWeight: 2,
    packageDimensions: "40 x 30 x 25 cm",
  });

  assert.equal(buildNcmStockTransferPayload({ transfer, packageDetails }).package.length, 50);
});

test("NCM stock transfer package details reject missing and out-of-range values", () => {
  assert.throws(() => normalizeNcmStockTransferPackageDetails({}), /between 0.1 and 1000 kg/);
  assert.throws(() => normalizeNcmStockTransferPackageDetails({
    packageType: "Box",
    productType: "Apparel",
    productDescription: "Clothes",
    packageWeight: 1,
    packageDimensions: "",
  }), /Package dimensions is required/);
  assert.throws(() => normalizeNcmStockTransferPackageDetails({
    packageType: "Box",
    productType: "Apparel",
    productDescription: "Clothes",
    packageWeight: 1001,
    packageDimensions: "20 x 20 x 20 cm",
  }), /between 0.1 and 1000 kg/);
});

test("local logistics requires a positive freight charge", () => {
  assert.equal(isPositiveLocalFreightCharge("125.50"), true);
  assert.equal(isPositiveLocalFreightCharge(0), false);
  assert.equal(isPositiveLocalFreightCharge(""), false);
  assert.equal(isPositiveLocalFreightCharge("not-a-charge"), false);
});

test("NCM booking response extracts only a valid numeric carrier order ID", () => {
  assert.equal(extractNcmOrderId({ Message: "Order Successfully Created", orderid: 747 }), "747");
  assert.equal(extractNcmOrderId({ result: { order: { order_id: "748" } } }), "748");
  assert.equal(extractNcmOrderId({ data: { id: 749 } }), "749");
  assert.equal(extractNcmOrderId({ orderid: "VREF-123" }), null);
  assert.equal(extractNcmOrderId({ orderid: Number.MAX_SAFE_INTEGER + 1 }), null);
  assert.equal(normalizeNcmOrderId("00123"), "123");
  assert.equal(normalizeNcmOrderId(0), null);
  assert.equal(normalizeNcmOrderId("1e3"), null);
});

test("NCM transfer tracking uses the newest carrier status and documented detail fallback", () => {
  assert.equal(latestNcmStockTransferStatus({
    data: [{ status: "Delivered" }, { status: "Dispatched" }],
  }, { data: { last_delivery_status: "Dispatched" } }), "Delivered");
  assert.equal(latestNcmStockTransferStatus({ data: [] }, {
    data: { last_delivery_status: "In Transit" },
  }), "In Transit");
  assert.equal(latestNcmStockTransferStatus({ data: [] }, { data: {} }), null);
  assert.deepEqual(normalizeNcmStockTransferStatusHistory({
    data: [
      { status: "Delivered", added_time: "2026-10-10T12:00:00Z" },
      { status: "Dispatched", added_time: "2026-10-09T12:00:00Z" },
      { status: "", added_time: "2026-10-08T12:00:00Z" },
    ],
  }), [
    { status: "Delivered", addedAt: "2026-10-10T12:00:00Z" },
    { status: "Dispatched", addedAt: "2026-10-09T12:00:00Z" },
  ]);
});

test("NCM shipment lifecycle treats booking separately from pickup and ignores stale status regressions", () => {
  assert.deepEqual(normalizeNcmStockTransferEvent("", "pickup_order_created"), {
    status: "Pickup Order Created",
    rank: 1,
    custodyConfirmed: false,
  });
  assert.deepEqual(normalizeNcmStockTransferEvent("", "pickup_completed"), {
    status: "Pickup Complete",
    rank: 2,
    custodyConfirmed: true,
  });
  assert.deepEqual(normalizeNcmStockTransferEvent("Delivered", ""), {
    status: "Delivered",
    rank: 6,
    custodyConfirmed: true,
  });
  assert.deepEqual(normalizeNcmStockTransferEvent("Delivery Completed", "delivery_completed"), {
    status: "Delivered",
    rank: 6,
    custodyConfirmed: true,
  });
  assert.deepEqual(normalizeNcmStockTransferEvent("Pickup Complete", "pickup_completed"), {
    status: "Pickup Complete",
    rank: 2,
    custodyConfirmed: true,
  });
  assert.equal(normalizeNcmStockTransferEvent("Returned", "").custodyConfirmed, false);
  assert.equal(shouldAdvanceNcmStockTransferStatus("Delivered", "Pickup Complete"), false);
  assert.equal(shouldAdvanceNcmStockTransferStatus("Pickup Complete", "Dispatched"), true);
  assert.equal(shouldAdvanceNcmStockTransferStatus("BOOKED", "Delivery Completed"), true);
  assert.equal(isStaleNcmStockTransferEvent("2026-10-10T12:00:00Z", "2026-10-10T11:59:00Z"), true);
  assert.equal(isStaleNcmStockTransferEvent("2026-10-10T12:00:00Z", null), false);
  assert.equal(
    shouldAdvanceNcmStockTransferStatus(
      "Sent for Pickup",
      "Pickup Complete",
      "2026-10-10T12:00:00Z",
      "2026-10-10T11:59:00Z",
    ),
    false,
  );
  assert.equal(
    shouldAdvanceNcmStockTransferStatus(
      "Sent for Pickup",
      "Pickup Complete",
      "invalid timestamp",
      "2026-10-10T11:59:00Z",
    ),
    true,
  );
});

test("admin approval is bounded by the requested quantity and covers each line once", () => {
  const lines = [
    { id: "line-1", requestedQuantity: 5 },
    { id: "line-2", requestedQuantity: 3 },
  ];
  assert.deepEqual(normalizeApprovalLines([
    { lineId: "line-1", approvedQuantity: 4 },
    { lineId: "line-2", approvedQuantity: 0 },
  ], lines), [
    { id: "line-1", approvedQuantity: 4 },
    { id: "line-2", approvedQuantity: 0 },
  ]);
  assert.throws(() => normalizeApprovalLines([
    { lineId: "line-1", approvedQuantity: 6 },
    { lineId: "line-2", approvedQuantity: 1 },
  ], lines), /cannot exceed/);
});

test("canonical dispatch plan validates exact quantities and stable transfer references", () => {
  const transfer = {
    id: "transfer-1",
    sourceLocationId: "factory-1",
  };
  const transferLines = [{
    id: "line-1",
    inventorySkuId: "sku-1",
    approvedQuantity: 10,
    dispatchedQuantity: 4,
  }];
  const shipment = {
    id: "shipment-1",
    lines: [{ id: "shipment-line-1", stockTransferLineId: "line-1", quantity: 3 }],
  };
  assert.deepEqual(planCanonicalTransferDispatch({
    transfer,
    shipment,
    transferLines,
    transitLocationId: "transit-1",
    actorId: "manufacturer-1",
    actorRole: "MANUFACTURER",
  }), [{
    shipmentLineId: "shipment-line-1",
    transferLineId: "line-1",
    inventorySkuId: "sku-1",
    sourceLocationId: "factory-1",
    destinationLocationId: "transit-1",
    quantity: 3,
    movementType: "TRANSFER_DISPATCH",
    referenceType: "STOCK_TRANSFER",
    referenceId: "transfer-1",
    idempotencyKey: "stock-transfer:shipment-1:dispatch:sku-1",
    actorId: "manufacturer-1",
    actorRole: "MANUFACTURER",
    reason: "Bulk stock dispatched to distributor under transfer transfer-1.",
  }]);
});

test("canonical dispatch plan rejects duplicate lines, invalid quantities, and over-dispatch", () => {
  const transfer = { id: "transfer-1", sourceLocationId: "factory-1" };
  const transferLines = [{
    id: "line-1",
    inventorySkuId: "sku-1",
    approvedQuantity: 5,
    dispatchedQuantity: 2,
  }];
  const base = {
    transfer,
    transferLines,
    transitLocationId: "transit-1",
    actorId: "manufacturer-1",
    actorRole: "MANUFACTURER",
  };
  assert.throws(() => planCanonicalTransferDispatch({
    ...base,
    shipment: {
      id: "shipment-1",
      lines: [
        { id: "shipment-line-1", stockTransferLineId: "line-1", quantity: 2 },
        { id: "shipment-line-2", stockTransferLineId: "line-1", quantity: 1 },
      ],
    },
  }), (error) => error.code === "DISPATCH_LINE_CONFLICT");
  assert.throws(() => planCanonicalTransferDispatch({
    ...base,
    shipment: {
      id: "shipment-1",
      lines: [{ id: "shipment-line-1", stockTransferLineId: "line-1", quantity: 0 }],
    },
  }), (error) => error.code === "INVALID_DISPATCH_QUANTITY");
  assert.throws(() => planCanonicalTransferDispatch({
    ...base,
    shipment: {
      id: "shipment-1",
      lines: [{ id: "shipment-line-1", stockTransferLineId: "line-1", quantity: 4 }],
    },
  }), (error) => error.code === "INSUFFICIENT_APPROVED_QUANTITY");
});

test("dispatch request normalization is exact and duplicate-safe", () => {
  const transferLines = [{ id: "line-1", approvedQuantity: 5 }, { id: "line-2", approvedQuantity: 3 }];
  assert.deepEqual(normalizeDispatchRequestLines([
    { lineId: "line-1", quantity: 2 },
  ], transferLines), [
    { stockTransferLineId: "line-1", quantity: 2, line: transferLines[0] },
  ]);
  assert.throws(() => normalizeDispatchRequestLines([
    { lineId: "line-1", quantity: 2 },
    { lineId: "line-1", quantity: 1 },
  ], transferLines), /unique/);
  assert.throws(() => normalizeDispatchRequestLines([
    { lineId: "line-1", quantity: "2.5" },
  ], transferLines), /positive whole number/);
  assert.throws(() => assertDispatchAvailability([
    { line: { approvedQuantity: 5, dispatchedQuantity: 4, reservedShipmentQuantity: 0 }, quantity: 2 },
  ]), (error) => error.code === "INSUFFICIENT_APPROVED_QUANTITY");
});

const makeReceiptDispatchEvidence = (quantity) => ({
  exists: true,
  shipmentId: "shipment-1",
  shipmentLineId: "shipment-line-1",
  inventorySkuId: "sku-1",
  quantity,
  movementType: "TRANSFER_DISPATCH",
  inventoryOwner: "PLATFORM",
  referenceType: "STOCK_TRANSFER",
  referenceId: "transfer-1",
  idempotencyKey: "stock-transfer:shipment-1:dispatch:sku-1",
  sourceLocationId: "factory-1",
  destinationLocationId: "transit-1",
});

test("receipt eligibility requires dispatch evidence and resolves partial, full, and exception outcomes", () => {
  const transfer = {
    id: "transfer-1",
    status: "IN_TRANSIT",
    distributorId: "distributor-1",
    sourceLocationId: "factory-1",
    destinationLocationId: "distributor-location-1",
  };
  const shipment = {
    id: "shipment-1",
    stockTransferId: "transfer-1",
    status: "PARTIALLY_RECEIVED",
    dispatchedAt: "2026-11-24T10:00:00Z",
  };
  const shipmentLine = {
    id: "shipment-line-1",
    shipmentId: "shipment-1",
    stockTransferLineId: "line-1",
    quantity: 10,
  };
  const transferLine = {
    id: "line-1",
    stockTransferId: "transfer-1",
    inventorySkuId: "sku-1",
    approvedQuantity: 10,
    dispatchedQuantity: 10,
  };
  const dispatchEvidence = makeReceiptDispatchEvidence(10);
  const destinationLocation = {
    id: "distributor-location-1",
    kind: "DISTRIBUTOR",
    inventoryOwner: "PLATFORM",
    distributorId: "distributor-1",
    isActive: true,
  };
  const base = {
    transfer,
    shipment,
    shipmentLine,
    transferLine,
    dispatchEvidence,
    transitLocationId: "transit-1",
    destinationLocation,
    destinationLocationAuthorized: true,
  };
  assert.deepEqual(evaluateTransferReceiptEligibility({
    ...base,
    previouslyReceivedQuantity: 3,
    proposedReceipt: {
      acceptedQuantity: 4,
      damagedQuantity: 1,
      rejectedQuantity: 0,
      missingQuantity: 1,
      excessQuantity: 0,
      putAwayQuantity: 3,
    },
  }), {
    eligible: true,
    outcome: "PARTIAL_WITH_EXCEPTION",
    exceptionCode: "SHORT_RECEIPT",
    exceptionCodes: ["SHORT_RECEIPT", "DAMAGED_RECEIPT"],
    acceptedQuantity: 4,
    damagedQuantity: 1,
    rejectedQuantity: 0,
    missingQuantity: 1,
    excessQuantity: 0,
    putAwayQuantity: 3,
    outstandingAfter: 1,
    approvedQuantity: 10,
    dispatchedQuantity: 10,
    previouslyReceivedQuantity: 3,
  });
  assert.equal(evaluateTransferReceiptEligibility({
    ...base,
    previouslyReceivedQuantity: 0,
    proposedReceipt: { acceptedQuantity: 10 },
  }).outcome, "FULL_RECEIPT");

  assert.throws(() => evaluateTransferReceiptEligibility({
    ...base,
    dispatchEvidence: null,
    proposedReceipt: { acceptedQuantity: 2 },
  }), (error) => error.code === "RECEIPT_DISPATCH_EVIDENCE_MISSING");

  assert.throws(() => evaluateTransferReceiptEligibility({
    ...base,
    previouslyReceivedQuantity: 0,
    proposedReceipt: { acceptedQuantity: 11 },
  }), (error) => error.code === "RECEIPT_QUANTITY_OVER_DISPATCH");

  assert.throws(() => evaluateTransferReceiptEligibility({
    ...base,
    proposedReceipt: { acceptedQuantity: 1 },
    destinationLocationAuthorized: false,
  }), (error) => error.code === "RECEIPT_DESTINATION_UNAUTHORIZED");

  assert.throws(() => evaluateTransferReceiptEligibility({
    ...base,
    transfer: { ...transfer, status: "CANCELLED" },
    proposedReceipt: { acceptedQuantity: 1 },
  }), (error) => error.code === "RECEIPT_TRANSFER_STATE_CONFLICT");

  assert.throws(() => evaluateTransferReceiptEligibility({
    ...base,
    transfer: { ...transfer, status: "RECEIVED" },
    proposedReceipt: { acceptedQuantity: 1 },
  }), (error) => error.code === "RECEIPT_TRANSFER_STATE_CONFLICT");
  assert.throws(() => evaluateTransferReceiptEligibility({
    ...base,
    transfer: { ...transfer, status: "COMPLETED" },
    proposedReceipt: { acceptedQuantity: 1 },
  }), (error) => error.code === "RECEIPT_TRANSFER_STATE_CONFLICT");

  assert.throws(() => evaluateTransferReceiptEligibility({
    ...base,
    transferLine: { ...transferLine, approvedQuantity: 8 },
    proposedReceipt: { acceptedQuantity: 2 },
  }), (error) => error.code === "RECEIPT_APPROVED_QUANTITY_EXCEEDED");

  assert.throws(() => evaluateTransferReceiptEligibility({
    ...base,
    transferLine: { ...transferLine, dispatchedQuantity: 9 },
    proposedReceipt: { acceptedQuantity: 2 },
  }), (error) => error.code === "RECEIPT_DISPATCH_QUANTITY_EXCEEDED");
});

test("canonical receipt plan produces accepted, damaged, and missing movements only", () => {
  const plan = buildCanonicalStockTransferReceiptPlan({
    transfer: { id: "transfer-1", status: "IN_TRANSIT", distributorId: "distributor-1", sourceLocationId: "factory-1", destinationLocationId: "distributor-location-1" },
    shipment: { id: "shipment-1", stockTransferId: "transfer-1", status: "DISPATCHED", dispatchedAt: "2026-11-24T10:00:00Z" },
    shipmentLine: { id: "shipment-line-1", shipmentId: "shipment-1", stockTransferLineId: "line-1", quantity: 5 },
    transferLine: { id: "line-1", stockTransferId: "transfer-1", inventorySkuId: "sku-1", approvedQuantity: 5, dispatchedQuantity: 5 },
    dispatchEvidence: makeReceiptDispatchEvidence(5),
    receiptIdentity: "stock-transfer:shipment-1:receipt:session-1",
    transitLocationId: "transit-1",
    destinationLocation: { id: "distributor-location-1", kind: "DISTRIBUTOR", inventoryOwner: "PLATFORM", distributorId: "distributor-1", isActive: true },
    destinationLocationAuthorized: true,
    damagedLocationId: "damaged-1",
    lostLocationId: "lost-1",
    acceptedQuantity: 3,
    damagedQuantity: 1,
    missingQuantity: 1,
    rejectedQuantity: 0,
    actorId: "distributor-account-1",
    actorRole: "DISTRIBUTOR",
  });
  assert.equal(plan.acceptedQuantity, 3);
  assert.equal(plan.damagedQuantity, 1);
  assert.equal(plan.missingQuantity, 1);
  assert.deepEqual(plan.movements.map((movement) => [movement.movementType, movement.quantity]), [
    ["TRANSFER_RECEIPT", 3],
    ["DAMAGE", 1],
    ["LOSS", 1],
  ]);
  assert.equal(plan.movements[0].sourceLocationId, "transit-1");
  assert.notEqual(plan.movements[0].sourceLocationId, "factory-1");
  assert.equal(plan.movements[0].destinationLocationId, "distributor-location-1");
  assert.equal(plan.movements[1].destinationLocationId, "damaged-1");
  assert.equal(plan.movements[2].destinationLocationId, "lost-1");
  assert.equal(plan.movements.some((movement) =>
    "revenueAmount" in movement || "cogsAmount" in movement || "receivableAmount" in movement
  ), false);

  const rejectedOnly = buildCanonicalStockTransferReceiptPlan({
    transfer: { id: "transfer-1", status: "IN_TRANSIT", distributorId: "distributor-1", sourceLocationId: "factory-1", destinationLocationId: "distributor-location-1" },
    shipment: { id: "shipment-1", stockTransferId: "transfer-1", status: "DISPATCHED", dispatchedAt: "2026-11-24T10:00:00Z" },
    shipmentLine: { id: "shipment-line-1", shipmentId: "shipment-1", stockTransferLineId: "line-1", quantity: 5 },
    transferLine: { id: "line-1", stockTransferId: "transfer-1", inventorySkuId: "sku-1", approvedQuantity: 5, dispatchedQuantity: 5 },
    dispatchEvidence: makeReceiptDispatchEvidence(5),
    receiptIdentity: "stock-transfer:shipment-1:receipt:session-2",
    transitLocationId: "transit-1",
    destinationLocation: { id: "distributor-location-1", kind: "DISTRIBUTOR", inventoryOwner: "PLATFORM", distributorId: "distributor-1", isActive: true },
    destinationLocationAuthorized: true,
    acceptedQuantity: 0,
    damagedQuantity: 0,
    missingQuantity: 0,
    rejectedQuantity: 2,
    actorId: "distributor-account-1",
    actorRole: "DISTRIBUTOR",
  });
  assert.equal(rejectedOnly.rejectedQuantity, 2);
  assert.deepEqual(rejectedOnly.movements, []);
});

test("canonical receipt plan enforces prior received and approved/dispatched boundaries", () => {
  const base = {
    transfer: { id: "transfer-1", status: "IN_TRANSIT", distributorId: "distributor-1", sourceLocationId: "factory-1", destinationLocationId: "distributor-location-1" },
    shipment: { id: "shipment-1", stockTransferId: "transfer-1", status: "DISPATCHED", dispatchedAt: "2026-11-24T10:00:00Z" },
    shipmentLine: { id: "shipment-line-1", shipmentId: "shipment-1", stockTransferLineId: "line-1", quantity: 10 },
    transferLine: { id: "line-1", stockTransferId: "transfer-1", inventorySkuId: "sku-1", approvedQuantity: 10, dispatchedQuantity: 10 },
    dispatchEvidence: makeReceiptDispatchEvidence(10),
    receiptIdentity: "receipt-session-1",
    transitLocationId: "transit-1",
    destinationLocation: { id: "distributor-location-1", kind: "DISTRIBUTOR", inventoryOwner: "PLATFORM", distributorId: "distributor-1", isActive: true },
    destinationLocationAuthorized: true,
    damagedLocationId: "damaged-1",
    lostLocationId: "lost-1",
    previouslyReceivedQuantity: 3,
    actorId: "distributor-account-1",
    actorRole: "DISTRIBUTOR",
  };
  const plan = buildCanonicalStockTransferReceiptPlan({
    ...base,
    acceptedQuantity: 4,
    damagedQuantity: 1,
    missingQuantity: 1,
    rejectedQuantity: 0,
  });
  assert.equal(plan.acceptedQuantity, 4);
  assert.equal(plan.outstandingAfter, 1);
  assert.throws(() => buildCanonicalStockTransferReceiptPlan({
    ...base,
    acceptedQuantity: 8,
    damagedQuantity: 0,
    missingQuantity: 0,
    rejectedQuantity: 0,
  }), (error) => error.code === "RECEIPT_QUANTITY_OVER_DISPATCH");
  assert.throws(() => buildCanonicalStockTransferReceiptPlan({
    ...base,
    transferLine: { ...base.transferLine, dispatchedQuantity: 5 },
    acceptedQuantity: 6,
    damagedQuantity: 0,
    missingQuantity: 0,
    rejectedQuantity: 0,
  }), (error) => error.code === "RECEIPT_DISPATCH_QUANTITY_EXCEEDED");
});

test("receipt replay is exact and excess receipt remains an authorization exception", () => {
  assert.deepEqual(evaluateStockTransferReceiptReplay({
    existingReceiptIdentity: null,
    existingRequestHash: null,
    receiptIdentity: "receipt-1",
    requestHash: "hash-1",
  }), { outcome: "NEW_RECEIPT", replayed: false });
  assert.deepEqual(evaluateStockTransferReceiptReplay({
    existingReceiptIdentity: "receipt-1",
    existingRequestHash: "hash-1",
    receiptIdentity: "receipt-1",
    requestHash: "hash-1",
  }), { outcome: "REPLAY", replayed: true });
  assert.throws(() => evaluateStockTransferReceiptReplay({
    existingReceiptIdentity: "receipt-1",
    existingRequestHash: "hash-1",
    receiptIdentity: "receipt-1",
    requestHash: "hash-2",
  }), (error) => error.code === "RECEIPT_IDEMPOTENCY_CONFLICT");
  assert.throws(() => evaluateStockTransferReceiptReplay({
    existingReceiptIdentity: "receipt-1",
    existingRequestHash: "hash-1",
    receiptIdentity: "receipt-2",
    requestHash: "hash-1",
  }), (error) => error.code === "RECEIPT_IDENTITY_CONFLICT");

  const transfer = {
    id: "transfer-1",
    status: "IN_TRANSIT",
    distributorId: "distributor-1",
    sourceLocationId: "factory-1",
    destinationLocationId: "distributor-location-1",
  };
  const shipment = { id: "shipment-1", stockTransferId: "transfer-1", status: "DISPATCHED", dispatchedAt: "2026-11-24T10:00:00Z" };
  const shipmentLine = { id: "shipment-line-1", shipmentId: "shipment-1", stockTransferLineId: "line-1", quantity: 5 };
  const transferLine = { id: "line-1", stockTransferId: "transfer-1", inventorySkuId: "sku-1", approvedQuantity: 5, dispatchedQuantity: 5 };
  const dispatchEvidence = makeReceiptDispatchEvidence(5);
  const input = {
    transfer,
    shipment,
    shipmentLine,
    transferLine,
    dispatchEvidence,
    transitLocationId: "transit-1",
    proposedReceipt: { acceptedQuantity: 5, excessQuantity: 1 },
    destinationLocation: { id: "distributor-location-1", kind: "DISTRIBUTOR", inventoryOwner: "PLATFORM", distributorId: "distributor-1", isActive: true },
    destinationLocationAuthorized: true,
  };
  assert.throws(() => evaluateTransferReceiptEligibility({
    ...input,
    proposedReceipt: { acceptedQuantity: 0 },
  }), /at least one positive quantity/);
  for (const quantity of [-1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => evaluateTransferReceiptEligibility({
      ...input,
      proposedReceipt: { acceptedQuantity: quantity },
    }), /non-negative whole number/);
  }
  assert.throws(() => evaluateTransferReceiptEligibility({
    ...input,
    excessReceiptAuthorized: false,
  }), (error) => error.code === "RECEIPT_EXCESS_NOT_AUTHORIZED");
  const authorizedExcess = evaluateTransferReceiptEligibility({
    ...input,
    excessReceiptAuthorized: true,
  });
  assert.equal(authorizedExcess.outcome, "COMPLETE_WITH_EXCEPTION");
  assert.equal(authorizedExcess.exceptionCode, "EXCESS_RECEIPT");
  assert.deepEqual(authorizedExcess.exceptionCodes, ["EXCESS_RECEIPT"]);
  assert.equal(authorizedExcess.acceptedQuantity, 5);
});

test("receipt quantities reject invalid integer inputs and mismatched source/destination identity", () => {
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "", true]) {
    assert.throws(() => normalizeReceiptWholeNumber(value), /non-negative whole number/);
  }
  assert.equal(normalizeReceiptWholeNumber(0), 0);
  assert.equal(normalizeReceiptWholeNumber("3"), 3);

  const transfer = {
    id: "transfer-1",
    status: "IN_TRANSIT",
    distributorId: "distributor-1",
    sourceLocationId: "factory-1",
    destinationLocationId: "distributor-location-1",
  };
  const shipment = { id: "shipment-1", stockTransferId: "transfer-1", status: "DISPATCHED", dispatchedAt: "2026-11-24T10:00:00Z" };
  const shipmentLine = { id: "shipment-line-1", shipmentId: "shipment-1", stockTransferLineId: "line-1", quantity: 5 };
  const transferLine = { id: "line-1", stockTransferId: "transfer-1", inventorySkuId: "sku-1", approvedQuantity: 5, dispatchedQuantity: 5 };
  const dispatchEvidence = makeReceiptDispatchEvidence(5);
  const input = {
    transfer,
    shipment,
    shipmentLine,
    transferLine,
    dispatchEvidence,
    transitLocationId: "transit-1",
    proposedReceipt: { acceptedQuantity: 1 },
    destinationLocation: { id: "distributor-location-1", kind: "DISTRIBUTOR", inventoryOwner: "PLATFORM", distributorId: "distributor-1", isActive: true },
    destinationLocationAuthorized: true,
  };
  assert.throws(() => evaluateTransferReceiptEligibility({
    ...input,
    transfer: { ...transfer, destinationLocationId: "other-location" },
  }), (error) => error.code === "RECEIPT_DESTINATION_INVALID");
  assert.throws(() => evaluateTransferReceiptEligibility({
    ...input,
    destinationLocation: { ...input.destinationLocation, isActive: false },
  }), (error) => error.code === "RECEIPT_DESTINATION_INVALID");
  assert.throws(() => evaluateTransferReceiptEligibility({
    ...input,
    shipmentLine: { ...shipmentLine, stockTransferLineId: "other-line" },
  }), (error) => error.code === "RECEIPT_SOURCE_CONFLICT");
  assert.throws(() => evaluateTransferReceiptEligibility({
    ...input,
    dispatchEvidence: { ...dispatchEvidence, referenceId: "other-transfer" },
  }), (error) => error.code === "RECEIPT_DISPATCH_EVIDENCE_MISSING");
});

test("NCM webhook dispatch authorization fails closed when custody, source, or location is invalid", () => {
  const transfer = { id: "transfer-1", manufacturerId: "manufacturer-1" };
  const shipment = { id: "shipment-1", status: "BOOKING_UNKNOWN" };
  const source = {
    id: "factory-1",
    kind: "FACTORY",
    inventoryOwner: "PLATFORM",
    manufacturerId: "manufacturer-1",
    isActive: true,
  };
  assert.deepEqual(validateWebhookDispatchAuthorization({
    transfer,
    shipment,
    sourceLocation: source,
    custodyConfirmed: true,
  }), {
    transferId: "transfer-1",
    shipmentId: "shipment-1",
    sourceLocationId: "factory-1",
  });
  assert.throws(() => validateWebhookDispatchAuthorization({
    transfer,
    shipment,
    sourceLocation: source,
    custodyConfirmed: false,
  }), (error) => error.code === "WEBHOOK_DISPATCH_NOT_CONFIRMED");
  assert.throws(() => validateWebhookDispatchAuthorization({
    transfer,
    shipment,
    sourceLocation: { ...source, isActive: false },
    custodyConfirmed: true,
  }), (error) => error.code === "WEBHOOK_SOURCE_LOCATION_INVALID");
  assert.throws(() => validateWebhookDispatchAuthorization({
    transfer,
    shipment,
    sourceLocation: { ...source, manufacturerId: "manufacturer-2" },
    custodyConfirmed: true,
  }), (error) => error.code === "WEBHOOK_SOURCE_LOCATION_INVALID");
  assert.throws(() => validateWebhookDispatchAuthorization({
    transfer,
    shipment: { ...shipment, status: "DISPATCHED" },
    sourceLocation: source,
    custodyConfirmed: true,
  }), (error) => error.code === "WEBHOOK_DISPATCH_STATE_CONFLICT");
});

test("legacy projection consistency distinguishes dispatch, reserve, release, and mismatch", () => {
  assert.deepEqual(assessLegacyDispatchProjectionConsistency({
    operation: "DISPATCH",
    dispatchedQuantity: 3,
    previousQuantity: 10,
    previousReserved: 2,
    nextQuantity: 7,
    nextReserved: 2,
  }), {
    operation: "DISPATCH",
    dispatchedQuantity: 3,
    previousQuantity: 10,
    previousReserved: 2,
    nextQuantity: 7,
    nextReserved: 2,
  });
  assert.deepEqual(assessLegacyDispatchProjectionConsistency({
    operation: "RESERVE",
    dispatchedQuantity: 4,
    previousQuantity: 10,
    previousReserved: 2,
    nextQuantity: 10,
    nextReserved: 6,
  }).operation, "RESERVE");
  assert.deepEqual(assessLegacyDispatchProjectionConsistency({
    operation: "RELEASE",
    dispatchedQuantity: 4,
    previousQuantity: 10,
    previousReserved: 6,
    nextQuantity: 10,
    nextReserved: 2,
  }).operation, "RELEASE");
  assert.throws(() => assessLegacyDispatchProjectionConsistency({
    operation: "DISPATCH",
    dispatchedQuantity: 3,
    previousQuantity: 10,
    previousReserved: 2,
    nextQuantity: 8,
    nextReserved: 2,
  }), (error) => error.code === "LEGACY_DISPATCH_PROJECTION_MISMATCH");
});

test("receipt quantities support partial delivery and validate discrepancy details", () => {
  const normalized = normalizeShipmentReceiptLines([
    {
      shipmentLineId: "shipment-line-1",
      goodQuantity: 3,
      damagedQuantity: 1,
      missingQuantity: 0,
      damageType: "DELIVERY_DAMAGE",
      evidence: ["https://example.com/photo.jpg"],
    },
  ], [{ id: "shipment-line-1", remainingQuantity: 6 }]);
  assert.equal(normalized[0].goodQuantity, 3);
  assert.throws(() => normalizeShipmentReceiptLines([
    { shipmentLineId: "shipment-line-1", goodQuantity: 7 },
  ], [{ id: "shipment-line-1", remainingQuantity: 6 }]), /within the shipment balance/);
  assert.throws(() => normalizeShipmentReceiptLines([
    { shipmentLineId: "shipment-line-1", damagedQuantity: 1 },
  ], [{ id: "shipment-line-1", remainingQuantity: 6 }]), /damage type/);
});

test("receipt replay hash is independent of SKU line and evidence ordering", () => {
  const first = buildReceiptRequestHash({
    notes: "received",
    lines: [
      { shipmentLineId: "b", goodQuantity: 1, evidence: ["https://example.com/b", "https://example.com/a"] },
      { shipmentLineId: "a", goodQuantity: 2, evidence: null },
    ],
  });
  const replay = buildReceiptRequestHash({
    notes: "received",
    lines: [
      { shipmentLineId: "a", goodQuantity: 2, evidence: null },
      { shipmentLineId: "b", goodQuantity: 1, evidence: ["https://example.com/a", "https://example.com/b"] },
    ],
  });
  assert.equal(first, replay);
  assert.notEqual(first, buildReceiptRequestHash({
    notes: "different",
    lines: [{ shipmentLineId: "a", goodQuantity: 2, evidence: null }],
  }));
});

test("transfer status reflects remaining approved, in-transit, and discrepancy quantities", () => {
  assert.equal(remainingApprovedQuantity({
    approvedQuantity: 10,
    dispatchedQuantity: 4,
    reservedShipmentQuantity: 2,
  }), 4);
  assert.equal(deriveTransferStatus({
    lines: [{ approvedQuantity: 10, dispatchedQuantity: 4, reservedShipmentQuantity: 0 }],
    shipmentLines: [{ goodQuantity: 2, damagedQuantity: 0, missingQuantity: 0 }],
  }), "IN_TRANSIT");
  assert.equal(deriveTransferStatus({
    lines: [{ approvedQuantity: 4, dispatchedQuantity: 4, reservedShipmentQuantity: 0 }],
    shipmentLines: [{ goodQuantity: 3, damagedQuantity: 1, missingQuantity: 0 }],
  }), "DISCREPANCY");
});

test("shipment COGS provenance is allocated FIFO and flags unlayered legacy units", () => {
  assert.deepEqual(planCostLayerAllocations([
    { id: "layer-1", availableQuantity: 2 },
    { id: "layer-2", availableQuantity: 4 },
  ], 5), {
    allocations: [
      { costLayerId: "layer-1", quantity: 2 },
      { costLayerId: "layer-2", quantity: 3 },
    ],
    uncostedQuantity: 0,
  });
  assert.deepEqual(planCostLayerAllocations([{ id: "layer-1", availableQuantity: 2 }], 5), {
    allocations: [{ costLayerId: "layer-1", quantity: 2 }],
    uncostedQuantity: 3,
  });
});

test("partial distributor receipts map accepted units to dispatched cost layers in FIFO order", () => {
  const layers = [
    { costLayerId: "layer-1", quantity: 2 },
    { costLayerId: "layer-2", quantity: 3 },
  ];
  assert.deepEqual(planReceivedCostLayerAllocations(layers, 1), {
    allocations: [{ costLayerId: "layer-1", quantity: 1 }],
    uncostedQuantity: 0,
  });
  assert.deepEqual(planReceivedCostLayerAllocations(layers, 2, 1), {
    allocations: [
      { costLayerId: "layer-1", quantity: 1 },
      { costLayerId: "layer-2", quantity: 1 },
    ],
    uncostedQuantity: 0,
  });
  assert.deepEqual(planReceivedCostLayerAllocations(layers, 3, 5), {
    allocations: [],
    uncostedQuantity: 3,
  });
});
