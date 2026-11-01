import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveReturnStatus,
  normalizeCollectionLines,
  normalizeReturnInspectionLines,
  normalizeReceiptLines,
  normalizeDistributorStockReturnLines,
  normalizeStockReturnDiscrepancyReview,
  planDistributorReturnCostLayers,
  planLayerRange,
  validateReturnDiscrepancyReviewState,
} from "../services/distributorStockReturnService.js";
import { buildInventoryLocationKey } from "../services/inventoryLedgerService.js";

test("stock return lines are unique, positive, and canonicalized", () => {
  assert.deepEqual(normalizeDistributorStockReturnLines([
    { inventorySkuId: "sku-b", requestedQuantity: 2 },
    { inventorySkuId: "sku-a", requestedQuantity: "3" },
  ]), [
    { inventorySkuId: "sku-a", requestedQuantity: 3 },
    { inventorySkuId: "sku-b", requestedQuantity: 2 },
  ]);
  assert.throws(
    () => normalizeDistributorStockReturnLines([
      { inventorySkuId: "sku-a", requestedQuantity: 1 },
      { inventorySkuId: "sku-a", requestedQuantity: 2 },
    ]),
    { code: "DUPLICATE_RETURN_SKU" },
  );
  assert.throws(
    () => normalizeDistributorStockReturnLines([{ inventorySkuId: "sku-a", requestedQuantity: 0 }]),
    { code: "INVALID_RETURN_QUANTITY" },
  );
});

test("return valuation allocation preserves FIFO layers and identifies uncosted units", () => {
  const firstLayer = { id: "layer-a", unitCogs: "100.00" };
  const secondLayer = { id: "layer-b", unitCogs: "125.50" };
  assert.deepEqual(planDistributorReturnCostLayers([
    { layer: firstLayer, quantity: 2 },
    { layer: secondLayer, quantity: 3 },
  ], 7), {
    allocations: [
      { layer: firstLayer, quantity: 2 },
      { layer: secondLayer, quantity: 3 },
    ],
    uncostedQuantity: 2,
  });
  assert.deepEqual(planDistributorReturnCostLayers([{ layer: firstLayer, quantity: 2 }], 1), {
    allocations: [{ layer: firstLayer, quantity: 1 }],
    uncostedQuantity: 0,
  });
  assert.throws(
    () => planDistributorReturnCostLayers([{ layer: firstLayer, quantity: -1 }], 1),
    { code: "INVALID_RETURN_COST_LAYER_BALANCE" },
  );
});

test("return-hold locations remain scoped to a single distributor custodian", () => {
  assert.equal(
    buildInventoryLocationKey({ kind: "RETURN_HOLD", distributorId: "distributor-1" }),
    "RETURN_HOLD:DISTRIBUTOR:distributor-1",
  );
  assert.throws(
    () => buildInventoryLocationKey({ kind: "RETURN_HOLD" }),
    { code: "INVALID_LOCATION_OWNER" },
  );
  assert.equal(
    buildInventoryLocationKey({ kind: "RETURN_RECEIPT", referenceId: "return-1" }),
    "RETURN_RECEIPT:return-1",
  );
  assert.throws(
    () => buildInventoryLocationKey({ kind: "RETURN_RECEIPT" }),
    { code: "INVALID_LOCATION_OWNER" },
  );
});

test("return collection quantities are positive and limited to known approved lines", () => {
  const returnLines = [
    { id: "line-a", approvedQuantity: 4 },
    { id: "line-b", approvedQuantity: 2 },
  ];
  assert.deepEqual(normalizeCollectionLines([
    { stockReturnLineId: "line-b", collectedQuantity: "1" },
    { stockReturnLineId: "line-a", collectedQuantity: 2 },
  ], returnLines), [
    { stockReturnLineId: "line-a", collectedQuantity: 2 },
    { stockReturnLineId: "line-b", collectedQuantity: 1 },
  ]);
  assert.throws(
    () => normalizeCollectionLines([{ stockReturnLineId: "unknown", collectedQuantity: 1 }], returnLines),
    { code: "INVALID_RETURN_COLLECTION_LINES" },
  );
  assert.throws(
    () => normalizeCollectionLines([{ stockReturnLineId: "line-a", collectedQuantity: 0 }], returnLines),
    { code: "INVALID_RETURN_COLLECTION_LINES" },
  );
});

test("return receipt counts must account for each collected unit and classify damage", () => {
  const collectionLines = [{ id: "collection-line-a", collectedQuantity: 5 }];
  assert.deepEqual(normalizeReceiptLines([{
    collectionLineId: "collection-line-a",
    receivedGoodQuantity: 3,
    receivedDamagedQuantity: 1,
    missingQuantity: 1,
    damageType: "DELIVERY_DAMAGE",
    receiptNotes: "One item damaged and one missing.",
    evidence: ["https://example.test/evidence/photo.jpg"],
  }], collectionLines), [{
    collectionLineId: "collection-line-a",
    receivedGoodQuantity: 3,
    receivedDamagedQuantity: 1,
    missingQuantity: 1,
    damageType: "DELIVERY_DAMAGE",
    receiptNotes: "One item damaged and one missing.",
    evidence: ["https://example.test/evidence/photo.jpg"],
  }]);
  assert.throws(
    () => normalizeReceiptLines([{
      collectionLineId: "collection-line-a",
      receivedGoodQuantity: 4,
      missingQuantity: 0,
    }], collectionLines),
    { code: "INVALID_RETURN_RECEIPT_LINES" },
  );
  assert.throws(
    () => normalizeReceiptLines([{
      collectionLineId: "collection-line-a",
      receivedGoodQuantity: 4,
      receivedDamagedQuantity: 1,
      damageType: "UNKNOWN",
      receiptNotes: "Damage found.",
    }], collectionLines),
    { code: "INVALID_RETURN_RECEIPT_LINES" },
  );
});

test("return receipt layer ranges preserve FIFO and leave missing quantities in transit", () => {
  const layerA = { id: "layer-a", createdAt: new Date("2026-01-01") };
  const layerB = { id: "layer-b", createdAt: new Date("2026-01-02") };
  const layers = [
    { layer: layerA, quantity: 2 },
    { layer: layerB, quantity: 2 },
    { layer: null, quantity: 1 },
  ];
  assert.deepEqual(planLayerRange(layers, 0, 3), [
    { layer: layerA, quantity: 2 },
    { layer: layerB, quantity: 1 },
  ]);
  assert.deepEqual(planLayerRange(layers, 3, 2), [
    { layer: layerB, quantity: 1 },
    { layer: null, quantity: 1 },
  ]);
  assert.throws(() => planLayerRange(layers, 0, 6), { code: "RETURN_LAYER_BALANCE_MISMATCH" });
});

test("return status tracks partial collection and receipt independently", () => {
  const stockReturn = {
    lines: [{ approvedQuantity: 5 }],
    collections: [
      { status: "RECEIVED", lines: [{ collectedQuantity: 2 }] },
      { status: "IN_TRANSIT", lines: [{ collectedQuantity: 3 }] },
    ],
  };
  assert.equal(deriveReturnStatus(stockReturn), "PARTIALLY_RECEIVED");
  assert.equal(deriveReturnStatus(stockReturn, [
    ...stockReturn.collections.slice(0, 1),
    { status: "RECEIVED", lines: [{ collectedQuantity: 3 }] },
  ]), "RECEIVED");
});

test("warehouse inspection allocates all received units to a recorded recommendation", () => {
  const collectionLines = [
    { id: "line-a", receivedGoodQuantity: 3, receivedDamagedQuantity: 1, missingQuantity: 1 },
    { id: "line-b", receivedGoodQuantity: 0, receivedDamagedQuantity: 0, missingQuantity: 2 },
  ];
  assert.deepEqual(normalizeReturnInspectionLines([
    {
      collectionLineId: "line-a",
      recommendedDisposition: "RESTOCK_REVIEW",
      quantity: 3,
      conditionNotes: "Three items passed initial inspection.",
      evidence: ["https://example.test/evidence/item.jpg"],
    },
    {
      collectionLineId: "line-a",
      recommendedDisposition: "REPAIR_REVIEW",
      quantity: 1,
      conditionNotes: "One item needs a seam repair.",
    },
  ], collectionLines), [
    {
      collectionLineId: "line-a",
      recommendedDisposition: "REPAIR_REVIEW",
      quantity: 1,
      conditionNotes: "One item needs a seam repair.",
      evidence: null,
    },
    {
      collectionLineId: "line-a",
      recommendedDisposition: "RESTOCK_REVIEW",
      quantity: 3,
      conditionNotes: "Three items passed initial inspection.",
      evidence: ["https://example.test/evidence/item.jpg"],
    },
  ]);
  assert.throws(
    () => normalizeReturnInspectionLines([{
      collectionLineId: "line-a",
      recommendedDisposition: "RESTOCK_REVIEW",
      quantity: 3,
      conditionNotes: "Counts do not match.",
    }], collectionLines),
    { code: "RETURN_INSPECTION_QUANTITY_MISMATCH" },
  );
  assert.throws(
    () => normalizeReturnInspectionLines([{
      collectionLineId: "line-a",
      recommendedDisposition: "DISPOSE_NOW",
      quantity: 4,
      conditionNotes: "This must not authorize disposal.",
    }], collectionLines),
    { code: "INVALID_RETURN_INSPECTION_LINES" },
  );
});

test("return discrepancy investigation captures notes/evidence without financial resolution", () => {
  assert.deepEqual(normalizeStockReturnDiscrepancyReview({
    notes: "Carrier claim opened; awaiting response.",
    evidence: ["https://example.test/claim.pdf"],
  }), {
    notes: "Carrier claim opened; awaiting response.",
    evidence: ["https://example.test/claim.pdf"],
  });
  assert.deepEqual(normalizeStockReturnDiscrepancyReview({
    notes: "Internal recount completed; no further movement.",
  }), {
    notes: "Internal recount completed; no further movement.",
    evidence: [],
  });
  assert.throws(
    () => normalizeStockReturnDiscrepancyReview({ notes: "no" }),
    { code: "INVALID_RETURN_DISCREPANCY_REVIEW" },
  );
  assert.throws(
    () => normalizeStockReturnDiscrepancyReview({
      notes: "Investigation note has a malformed URL.",
      evidence: ["javascript:alert(1)"],
    }),
    { code: "INVALID_RETURN_EVIDENCE" },
  );
  assert.equal(validateReturnDiscrepancyReviewState({
    status: "OPEN",
    financialResponsibleParty: "UNDETERMINED",
  }), true);
  assert.equal(validateReturnDiscrepancyReviewState({
    status: "UNDER_REVIEW",
    financialResponsibleParty: "UNDETERMINED",
  }), true);
  assert.throws(
    () => validateReturnDiscrepancyReviewState({
      status: "RESOLVED",
      financialResponsibleParty: "UNDETERMINED",
    }),
    { code: "RETURN_DISCREPANCY_NOT_REVIEWABLE" },
  );
  assert.throws(
    () => validateReturnDiscrepancyReviewState({
      status: "OPEN",
      financialResponsibleParty: "PLATFORM",
    }),
    { code: "RETURN_DISCREPANCY_RESPONSIBILITY_CONFLICT" },
  );
});
