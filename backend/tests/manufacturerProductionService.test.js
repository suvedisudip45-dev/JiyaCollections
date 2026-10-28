import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateProductionLayersForOrderItem,
  calculateProductionUnitCost,
  calculateFullyLoadedUnitCogs,
  normalizeProductionRequestLines,
  validateManufacturerProductionQuote,
} from "../services/manufacturerProductionService.js";

test("VAT-exclusive manufacturer unit cost separates net cost and verified input VAT", () => {
  const cost = calculateProductionUnitCost({
    unitAmount: "1000",
    vatTreatment: "VAT_EXCLUSIVE",
    vatRate: "13",
    vatInvoiceReference: "INV-001",
    vatInvoiceVerified: true,
  });

  assert.equal(cost.netAmount.toFixed(2), "1000.00");
  assert.equal(cost.vatAmount.toFixed(2), "130.00");
  assert.equal(cost.grossAmount.toFixed(2), "1130.00");
  assert.equal(cost.recoverableVat.toFixed(2), "130.00");
  assert.equal(cost.capitalizedAmount.toFixed(2), "1000.00");
});

test("VAT-inclusive manufacturer unit cost extracts VAT from the entered gross amount", () => {
  const cost = calculateProductionUnitCost({
    unitAmount: "1130",
    vatTreatment: "VAT_INCLUSIVE",
    vatRate: "13",
    vatInvoiceReference: "INV-002",
    vatInvoiceVerified: true,
  });

  assert.equal(cost.netAmount.toFixed(2), "1000.00");
  assert.equal(cost.vatAmount.toFixed(2), "130.00");
  assert.equal(cost.grossAmount.toFixed(2), "1130.00");
  assert.equal(cost.recoverableVat.toFixed(2), "130.00");
  assert.equal(cost.capitalizedAmount.toFixed(2), "1000.00");
});

test("exempt manufacturer production has no VAT component", () => {
  const cost = calculateProductionUnitCost({ unitAmount: "1000" });

  assert.equal(cost.vatAmount.toFixed(2), "0.00");
  assert.equal(cost.recoverableVat.toFixed(2), "0.00");
  assert.equal(cost.capitalizedAmount.toFixed(2), "1000.00");
});

test("unverified manufacturer VAT invoice remains in inventory cost and is not recoverable", () => {
  const cost = calculateProductionUnitCost({
    unitAmount: "1000",
    vatTreatment: "VAT_EXCLUSIVE",
    vatRate: "13",
    vatInvoiceReference: "INV-003",
    vatInvoiceVerified: false,
  });

  assert.equal(cost.vatAmount.toFixed(2), "130.00");
  assert.equal(cost.recoverableVat.toFixed(2), "0.00");
  assert.equal(cost.capitalizedAmount.toFixed(2), "1130.00");
});

test("VAT-applicable manufacturer production requires a supplier invoice reference", () => {
  assert.throws(() => calculateProductionUnitCost({
    unitAmount: "1000",
    vatTreatment: "VAT_EXCLUSIVE",
    vatRate: "13",
  }), /invoice reference/);
});

test("manufacturer quote validates per-piece pricing and batch expenses without changing admin quantities", () => {
  const quote = validateManufacturerProductionQuote({
    unitCogs: "125.50",
    otherCost: "250",
    vatTreatment: "EXEMPT",
    manufacturerNote: "Quote for the assigned production order.",
  });

  assert.equal(quote.unitCogs.toFixed(2), "125.50");
  assert.equal(quote.otherCost.toFixed(2), "250.00");
  assert.equal(quote.manufacturerNote, "Quote for the assigned production order.");
  assert.throws(() => validateManufacturerProductionQuote({
    unitCogs: "0",
    otherCost: "0",
  }), /positive per-piece price/);
  assert.throws(() => validateManufacturerProductionQuote({
    unitCogs: "100",
    otherCost: "-1",
  }), /non-negative batch expense/);
});

test("admin-assigned size/color quantities normalize independently from manufacturer quote terms", () => {
  const assignedLines = normalizeProductionRequestLines([
    { size: "M", color: "Navy", quantity: 12 },
    { size: "L", color: "Navy", quantity: "8" },
  ]);
  assert.equal(assignedLines.totalQuantity, 20);
  assert.deepEqual(assignedLines.lines, [
    { size: "M", color: "Navy", quantity: 12 },
    { size: "L", color: "Navy", quantity: 8 },
  ]);
});

test("batch other cost is allocated across actual good production units", () => {
  const unitCogs = calculateFullyLoadedUnitCogs({
    unitCogs: "10",
    batchOtherCost: "1",
    goodQuantity: 3,
  });
  assert.equal(unitCogs.toFixed(14), "10.33333333333333");
  assert.equal(unitCogs.mul(3).toFixed(2), "31.00");
});

test("admin production quantity validation rejects duplicate variants and non-positive quantities", () => {
  assert.throws(() => normalizeProductionRequestLines([
    { size: "M", color: "Blue", quantity: 2 },
    { size: "m", color: "blue", quantity: 1 },
  ]), /unique/);
  assert.throws(() => normalizeProductionRequestLines([
    { size: "M", color: "Blue", quantity: 0 },
  ]), /positive whole number/);
});

test("production allocation reserves FIFO layers and leaves unlayered quantity as legacy stock", async () => {
  const layers = [
    { id: "layer-1", availableQuantity: 3, unitCogs: { toFixed: (digits) => (100).toFixed(digits) }, unitDeliveryCost: { toFixed: (digits) => (5).toFixed(digits) } },
    { id: "layer-2", availableQuantity: 4, unitCogs: { toFixed: (digits) => (120).toFixed(digits) }, unitDeliveryCost: { toFixed: (digits) => (8).toFixed(digits) } },
  ];
  const created = [];
  const tx = {
    manufacturerInventoryCostLayer: {
      findMany: async () => layers,
      updateMany: async ({ where, data }) => {
        const layer = layers.find((entry) => entry.id === where.id);
        if (!layer || layer.availableQuantity < where.availableQuantity.gte) return { count: 0 };
        layer.availableQuantity -= data.availableQuantity.decrement;
        return { count: 1 };
      },
    },
    manufacturerInventoryCostAllocation: {
      create: async ({ data }) => {
        const allocation = { id: `alloc-${created.length + 1}`, ...data };
        created.push(allocation);
        return allocation;
      },
    },
  };

  const result = await allocateProductionLayersForOrderItem({
    tx,
    orderId: "order-1",
    itemIndex: 0,
    manufacturerId: "manufacturer-1",
    item: { productId: "product-1", size: "M", color: "Black", quantity: 9 },
  });

  assert.deepEqual(result.productionCostAllocations.map(({ quantity, unitCogs, unitDeliveryCost }) => ({
    quantity, unitCogs, unitDeliveryCost,
  })), [
    { quantity: 3, unitCogs: "100.00000000000000", unitDeliveryCost: "5.00" },
    { quantity: 4, unitCogs: "120.00000000000000", unitDeliveryCost: "8.00" },
  ]);
  assert.equal(result.legacyCostQuantity, 2);
  assert.equal(created.length, 2);
  assert.equal(layers[0].availableQuantity, 0);
  assert.equal(layers[1].availableQuantity, 0);
});
