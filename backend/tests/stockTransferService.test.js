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
  normalizeNcmOrderId,
  normalizeNcmStockTransferPackageDetails,
  normalizeApprovalLines,
  normalizeShipmentReceiptLines,
  normalizeTransferPreparationChecklist,
  normalizeTransferRequestLines,
  isNcmBranchEligible,
  isTransferPreparationComplete,
  isSameProfileOwner,
  isPositiveLocalFreightCharge,
  planCostLayerAllocations,
  remainingApprovedQuantity,
  validateTransferRequestAvailability,
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
    (error) => error.code === "INSUFFICIENT_FACTORY_STOCK" && error.statusCode === 409,
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
    package: "Apparel | Shirts and trousers | Package: Carton | Dimensions: 40 x 30 x 25 cm | Fragile | Packaging: Waterproof wrapping | Stock transfer 12345678",
    instruction: "Call on arrival No COD collection.",
    delivery_type: "Door2Door",
    weight: "2.5",
  });
  assert.equal("vref_id" in payload, false);
  assert.equal("packageType" in payload, false);
  assert.equal("packageDimensions" in payload, false);
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
