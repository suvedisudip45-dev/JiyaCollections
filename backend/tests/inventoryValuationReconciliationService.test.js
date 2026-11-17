import assert from "node:assert/strict";
import test from "node:test";
import { buildInventoryValuationReconciliation } from "../services/inventoryValuationReconciliationService.js";

const accounts = [{ accountCode: "1140", normalBalance: "DEBIT", currentBalance: "400.00" }];
const locations = [
  { id: "factory", kind: "FACTORY", inventoryOwner: "PLATFORM" },
  { id: "distributor", kind: "DISTRIBUTOR", inventoryOwner: "PLATFORM" },
];

test("inventory reconciliation matches layer-traced platform quantities across locations", () => {
  const result = buildInventoryValuationReconciliation({
    locations,
    accounts,
    balances: [
      { locationId: "factory", inventorySkuId: "sku", quantityOnHand: 2 },
      { locationId: "distributor", inventorySkuId: "sku", quantityOnHand: 2 },
    ],
    layerBalances: [
      { locationId: "factory", inventorySkuId: "sku", quantity: 2, unitCogs: "100.00" },
      { locationId: "distributor", inventorySkuId: "sku", quantity: 2, unitCogs: "100.00" },
    ],
  });

  assert.equal(result.coverageStatus, "SOURCE_SCOPED");
  assert.equal(result.subledgerTotal, 400);
  assert.equal(result.glBalance, 400);
  assert.equal(result.verifiedLayerQuantity, 4);
  assert.equal(result.isReconciled, true);
});

test("uncosted and quantity-mismatched stock is excluded rather than valued at product cost", () => {
  const result = buildInventoryValuationReconciliation({
    locations,
    accounts: [{ ...accounts[0], currentBalance: "500.00" }],
    balances: [
      { locationId: "factory", inventorySkuId: "uncosted", quantityOnHand: 3 },
      { locationId: "distributor", inventorySkuId: "mismatch", quantityOnHand: 2 },
      { locationId: "factory", inventorySkuId: "overage", quantityOnHand: 1 },
    ],
    layerBalances: [
      { locationId: "distributor", inventorySkuId: "mismatch", quantity: 1, unitCogs: "100.00" },
      { locationId: "factory", inventorySkuId: "overage", quantity: 2, unitCogs: "50.00" },
    ],
  });

  assert.equal(result.subledgerTotal, 0);
  assert.equal(result.uncostedQuantity, 4);
  assert.equal(result.excessLayerQuantity, 1);
  assert.equal(result.balanceMismatchCount, 3);
  assert.equal(result.isReconciled, false);
});

test("non-platform stock is excluded and lost or sensitive platform locations require review", () => {
  const result = buildInventoryValuationReconciliation({
    locations: [
      ...locations,
      { id: "lost", kind: "LOST", inventoryOwner: "PLATFORM" },
      { id: "damaged", kind: "DAMAGED", inventoryOwner: "PLATFORM" },
      { id: "consigned", kind: "DISTRIBUTOR", inventoryOwner: "DISTRIBUTOR" },
    ],
    accounts,
    balances: [
      { locationId: "lost", inventorySkuId: "lost-sku", quantityOnHand: 1 },
      { locationId: "damaged", inventorySkuId: "damaged-sku", quantityOnHand: 1 },
      { locationId: "consigned", inventorySkuId: "consigned-sku", quantityOnHand: 20 },
    ],
    layerBalances: [
      { locationId: "damaged", inventorySkuId: "damaged-sku", quantity: 1, unitCogs: "50.00" },
      { locationId: "consigned", inventorySkuId: "consigned-sku", quantity: 20, unitCogs: "10.00" },
    ],
  });

  assert.equal(result.platformOnHandQuantity, 1);
  assert.equal(result.lostLocationOnHandQuantity, 1);
  assert.equal(result.subledgerTotal, 50);
  assert.equal(result.sensitiveLocationQuantity, 1);
  assert.equal(result.isReconciled, false);
});

test("invalid cost layers, orphaned movements, and missing controls never produce a match", () => {
  const result = buildInventoryValuationReconciliation({
    locations,
    balances: [
      { locationId: "factory", inventorySkuId: "invalid-cost", quantityOnHand: 1 },
    ],
    layerBalances: [
      { locationId: "factory", inventorySkuId: "invalid-cost", quantity: 1, unitCogs: "0" },
      { locationId: "distributor", inventorySkuId: "orphan", quantity: 1, unitCogs: "25.00" },
      { locationId: "distributor", inventorySkuId: "orphan", quantity: -1, unitCogs: "25.00" },
    ],
  });

  assert.equal(result.invalidCostLayerCount, 1);
  assert.equal(result.orphanedLayerBalanceCount, 1);
  assert.equal(result.accountExists, false);
  assert.equal(result.isReconciled, false);
});

test("negative lost-location quantities are surfaced as invalid balances", () => {
  const result = buildInventoryValuationReconciliation({
    locations: [{ id: "lost", kind: "LOST", inventoryOwner: "PLATFORM" }],
    balances: [{ locationId: "lost", inventorySkuId: "sku", quantityOnHand: -2 }],
    accounts,
  });

  assert.equal(result.lostLocationOnHandQuantity, 2);
  assert.equal(result.invalidBalanceCount, 1);
  assert.equal(result.isReconciled, false);
});
