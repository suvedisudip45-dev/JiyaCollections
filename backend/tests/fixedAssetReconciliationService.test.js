import assert from "node:assert/strict";
import test from "node:test";
import { buildFixedAssetReconciliation } from "../services/fixedAssetReconciliationService.js";

const accounts = [
  { accountCode: "1510", normalBalance: "DEBIT", currentBalance: "1400.00" },
  { accountCode: "1520", normalBalance: "DEBIT", currentBalance: "500.00" },
  { accountCode: "1530", normalBalance: "DEBIT", currentBalance: "2000.00" },
  { accountCode: "1590", normalBalance: "CREDIT", currentBalance: "390.00" },
];

const assets = [
  {
    id: "it-asset",
    category: "COMPUTERS_IT",
    status: "ACTIVE",
    purchaseCost: 1000,
    accumulatedDepreciation: 100,
    currentBookValue: 900,
  },
  {
    id: "machine-asset",
    category: "MACHINERY_EQUIPMENT",
    status: "ACTIVE",
    purchaseCost: 400,
    accumulatedDepreciation: 40,
    currentBookValue: 360,
  },
  {
    id: "furniture-asset",
    category: "FURNITURE_FIXTURES",
    status: "ACTIVE",
    purchaseCost: 500,
    accumulatedDepreciation: 50,
    currentBookValue: 450,
  },
  {
    id: "vehicle-asset",
    category: "VEHICLES",
    status: "ACTIVE",
    purchaseCost: 2000,
    accumulatedDepreciation: 200,
    currentBookValue: 1800,
  },
  {
    id: "disposed-asset",
    category: "COMPUTERS_IT",
    status: "WRITTEN_OFF",
    purchaseCost: 300,
    accumulatedDepreciation: 100,
    currentBookValue: 0,
  },
];

test("fixed-asset reconciliation matches active register balances to mapped GL controls", () => {
  const result = buildFixedAssetReconciliation({ assets, accounts });

  assert.equal(result.isReconciled, true);
  assert.equal(result.activeAssetCount, 4);
  assert.equal(result.grossCost, 3900);
  assert.equal(result.accumulatedDepreciation, 390);
  assert.equal(result.netBookValue, 3510);
  assert.equal(result.controls.find((row) => row.accountCode === "1510").registerBalance, 1400);
  assert.equal(result.controls.find((row) => row.accountCode === "1590").registerBalance, 390);
  assert.equal(result.controls.find((row) => row.accountCode === "1590").assetCount, 4);
});

test("fixed-asset reconciliation flags a register book-value mismatch even when GL totals match", () => {
  const result = buildFixedAssetReconciliation({
    assets: [{
      id: "mismatched-asset",
      category: "COMPUTERS_IT",
      status: "ACTIVE",
      purchaseCost: 1000,
      accumulatedDepreciation: 100,
      currentBookValue: 800,
    }],
    accounts: [
      { accountCode: "1510", normalBalance: "DEBIT", currentBalance: "1000.00" },
      { accountCode: "1520", normalBalance: "DEBIT", currentBalance: "0.00" },
      { accountCode: "1530", normalBalance: "DEBIT", currentBalance: "0.00" },
      { accountCode: "1590", normalBalance: "CREDIT", currentBalance: "100.00" },
    ],
  });

  assert.equal(result.isReconciled, false);
  assert.equal(result.assetBookMismatchCount, 1);
  assert.equal(result.controls.find((row) => row.accountCode === "1510").variance, 0);
  assert.equal(result.controls.find((row) => row.accountCode === "1510").isReconciled, false);
});

test("fixed-asset reconciliation flags inactive book values and unrecognized categories", () => {
  const result = buildFixedAssetReconciliation({
    assets: [
      {
        id: "unknown-category",
        category: "UNRECOGNIZED",
        status: "ACTIVE",
        purchaseCost: 100,
        accumulatedDepreciation: 0,
        currentBookValue: 100,
      },
      {
        id: "disposed-with-book-value",
        category: "VEHICLES",
        status: "WRITTEN_OFF",
        purchaseCost: 200,
        accumulatedDepreciation: 100,
        currentBookValue: 100,
      },
    ],
    accounts: [
      { accountCode: "1510", normalBalance: "DEBIT", currentBalance: "100.00" },
      { accountCode: "1520", normalBalance: "DEBIT", currentBalance: "0.00" },
      { accountCode: "1530", normalBalance: "DEBIT", currentBalance: "0.00" },
      { accountCode: "1590", normalBalance: "CREDIT", currentBalance: "0.00" },
    ],
  });

  assert.equal(result.isReconciled, false);
  assert.equal(result.unsupportedCategoryCount, 1);
  assert.equal(result.inactiveAssetBookValueCount, 1);
  assert.equal(result.controls.find((row) => row.accountCode === "1510").isReconciled, false);
});

test("fixed-asset reconciliation never treats missing GL controls as a match", () => {
  const result = buildFixedAssetReconciliation();

  assert.equal(result.isReconciled, false);
  assert.equal(result.controlUnmatchedCount, 4);
  assert.ok(result.controls.every((row) => !row.accountExists && !row.isReconciled));
});
