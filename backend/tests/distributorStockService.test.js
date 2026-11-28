import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDistributorInboundChecklist,
  normalizeDistributorStockDecrease,
} from "../services/distributorStockService.js";

const shipmentLines = [
  {
    id: "shipment-line-1",
    remainingQuantity: 5,
    stockTransferLine: {
      inventorySkuId: "sku-1",
      inventorySku: { size: "Medium", color: "Navy" },
    },
  },
  {
    id: "shipment-line-2",
    remainingQuantity: 3,
    stockTransferLine: {
      inventorySkuId: "sku-2",
      inventorySku: { size: "Large", color: "Navy" },
    },
  },
];

test("distributor receipt checklist maps verified variant counts for all shipped units", () => {
  const checklist = normalizeDistributorInboundChecklist({
    qualityPassed: true,
    qualityNotes: "Stitch and shade inspected.",
    lines: [
      { inventorySkuId: "sku-1", size: "Medium", color: "Navy", goodCount: 3, damagedCount: 1, lostCount: 1 },
      { inventorySkuId: "sku-2", size: "Large", color: "Navy", goodCount: 3, damagedCount: 0, lostCount: 0 },
    ],
  }, shipmentLines);

  assert.equal(checklist.qualityPassed, true);
  assert.equal(checklist.lines[0].shipmentLineId, "shipment-line-1");
  assert.equal(checklist.lines[0].damageType, "OTHER_DAMAGE");
  assert.equal(checklist.lines[0].missingQuantity, 1);
  assert.equal(checklist.lines[1].goodQuantity, 3);
});

test("distributor receipt rejects failed quality gates and incomplete or mismatched counts", () => {
  assert.throws(() => normalizeDistributorInboundChecklist({
    qualityPassed: false,
    lines: [],
  }, shipmentLines), /quality check must pass/);
  assert.throws(() => normalizeDistributorInboundChecklist({
    qualityPassed: true,
    lines: [{ inventorySkuId: "sku-1", size: "Medium", color: "Navy", goodCount: 5 }],
  }, shipmentLines), /every shipment size\/color variant/);
  assert.throws(() => normalizeDistributorInboundChecklist({
    qualityPassed: true,
    lines: [
      { inventorySkuId: "sku-1", size: "Small", color: "Navy", goodCount: 5 },
      { inventorySkuId: "sku-2", size: "Large", color: "Navy", goodCount: 3 },
    ],
  }, shipmentLines), /account for every good/);
});

test("distributor stock decrease requires positive quantity, reason, type, and HTTP evidence", () => {
  const input = normalizeDistributorStockDecrease({
    inventorySkuId: "sku-1",
    quantity: 2,
    adjustmentType: "damaged",
    reason: "Water damage found during storage.",
    evidenceUrl: "https://evidence.example/photo.jpg",
  });
  assert.equal(input.adjustmentType, "DAMAGED");
  assert.equal(input.quantity, 2);

  for (const invalid of [
    { quantity: 0 },
    { adjustmentType: "INCREASE" },
    { reason: "" },
    { evidenceUrl: "file:///photo.jpg" },
  ]) {
    assert.throws(() => normalizeDistributorStockDecrease({
      inventorySkuId: "sku-1",
      quantity: 1,
      adjustmentType: "LOST",
      reason: "Counted missing.",
      evidenceUrl: "https://evidence.example/photo.jpg",
      ...invalid,
    }));
  }
});
