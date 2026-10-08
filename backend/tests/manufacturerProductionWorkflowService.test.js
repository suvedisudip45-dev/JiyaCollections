import assert from "node:assert/strict";
import test from "node:test";
import {
  validateAdminProductionPlan,
  validatePostProductionChecklist,
  validatePreProductionChecklist,
  summarizeManufacturerProductionDashboard,
} from "../services/manufacturerProductionWorkflowService.js";

const requestedLines = [
  { size: "S", color: "Navy", quantity: 10 },
  { size: "M", color: "Navy", quantity: 8 },
];

test("admin production plan validates required specifications and batch quantities", () => {
  const plan = validateAdminProductionPlan({
    fabricType: "Cotton",
    gsm: "180",
    targetCompletionDate: "2026-11-30",
    batches: [
      { batchNumber: "A", plannedQuantity: 10 },
      { batchNumber: "B", plannedQuantity: 8 },
    ],
  });

  assert.equal(plan.fabricType, "Cotton");
  assert.equal(plan.gsm.toFixed(2), "180.00");
  assert.equal(plan.batchQuantity, 18);
  const partialPlan = validateAdminProductionPlan({
    fabricType: "Cotton",
    gsm: 180,
    targetCompletionDate: "2026-11-30",
    batches: [{ batchNumber: "A", plannedQuantity: 17 }],
  });
  assert.equal(partialPlan.batchQuantity, 17);
});

test("pre-production check passes only when every required gate is true", () => {
  assert.equal(validatePreProductionChecklist({
    fabricPassed: true,
    qualitySamplePassed: true,
    colorShadeMatched: true,
  }).passed, true);
  assert.equal(validatePreProductionChecklist({
    fabricPassed: true,
    qualitySamplePassed: false,
    colorShadeMatched: true,
  }).passed, false);
  assert.throws(() => validatePreProductionChecklist({
    fabricPassed: true,
    qualitySamplePassed: 1,
    colorShadeMatched: true,
  }), /must be true or false/);
});

test("pre-production check accepts the existing client field names and normalizes them", () => {
  const checklist = validatePreProductionChecklist({
    fabricCheckPassed: true,
    sampleCheckPassed: true,
    colorShadeCheckPassed: true,
    notes: "Verified",
  });

  assert.deepEqual(checklist, {
    fabricPassed: true,
    qualitySamplePassed: true,
    colorShadeMatched: true,
    notes: "Verified",
    passed: true,
  });
});

test("manufacturer dashboard separates factory stock, inspected output, accepted goods, and damage", () => {
  const dashboard = summarizeManufacturerProductionDashboard({
    factoryBalances: [
      {
        inventorySkuId: "sku-1",
        quantityOnHand: 7,
        reservedQuantity: 2,
        inventorySku: { productId: "product-1" },
      },
      {
        inventorySkuId: "sku-2",
        quantityOnHand: 4,
        reservedQuantity: 0,
        inventorySku: { productId: "product-1" },
      },
      {
        inventorySkuId: "sku-3",
        quantityOnHand: 0,
        reservedQuantity: 0,
        inventorySku: { productId: "product-2" },
      },
    ],
    productionRequests: [
      {
        status: "COMPLETED",
        lines: [
          { actualQuantity: 10, damagedQuantity: 1 },
          { actualQuantity: 5, damagedQuantity: 0 },
        ],
      },
      {
        status: "POST_CHECK_FAILED",
        lines: [{ actualQuantity: 8, damagedQuantity: 3 }],
      },
      {
        status: "IN_PRODUCTION",
        lines: [{ actualQuantity: null, damagedQuantity: 0 }],
      },
    ],
  });

  assert.deepEqual(dashboard, {
    factoryProductCount: 1,
    factorySkuCount: 2,
    factoryUnitsOnHand: 11,
    factoryUnitsAvailable: 9,
    factoryUnitsReserved: 2,
    producedUnits: 23,
    goodUnitsProduced: 14,
    damagedUnits: 4,
    completedBatches: 1,
    failedQaBatches: 1,
    activeBatches: 2,
  });
});

test("post-production counts cover each requested variant and exclude damaged units from good stock", () => {
  const checklist = validatePostProductionChecklist({
    stitchingPassed: true,
    qualityPassed: true,
    colorPassed: true,
    sizeCountVerified: true,
    actualCounts: [
      { size: "S", color: "Navy", quantity: 9, damagedQuantity: 1 },
      { size: "M", color: "Navy", quantity: 8, damagedQuantity: 0 },
    ],
  }, requestedLines);

  assert.equal(checklist.passed, true);
  assert.equal(checklist.actualCounts.reduce((total, line) => total + line.quantity - line.damagedQuantity, 0), 16);
});

test("post-production validation rejects duplicated, missing, and excessive variant counts", () => {
  const checklist = {
    stitchingPassed: true,
    qualityPassed: true,
    colorPassed: true,
    sizeCountVerified: true,
  };
  assert.throws(() => validatePostProductionChecklist({
    ...checklist,
    actualCounts: [
      { size: "S", color: "Navy", quantity: 4 },
      { size: "s", color: "navy", quantity: 3 },
    ],
  }, requestedLines), /unknown or duplicate/);
  assert.throws(() => validatePostProductionChecklist({
    ...checklist,
    actualCounts: [{ size: "S", color: "Navy", quantity: 4 }],
  }, requestedLines), /every requested/);
  assert.throws(() => validatePostProductionChecklist({
    ...checklist,
    actualCounts: [
      { size: "S", color: "Navy", quantity: 11 },
      { size: "M", color: "Navy", quantity: 8 },
    ],
  }, requestedLines), /within the requested quantity/);
});
