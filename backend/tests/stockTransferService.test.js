import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReceiptRequestHash,
  deriveTransferStatus,
  normalizeApprovalLines,
  normalizeShipmentReceiptLines,
  normalizeTransferPreparationChecklist,
  normalizeTransferRequestLines,
  isTransferPreparationComplete,
  isSameProfileOwner,
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
