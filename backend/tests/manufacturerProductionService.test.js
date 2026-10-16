import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateProductionLayersForOrderItem,
  calculateProductionUnitCost,
  calculateFullyLoadedUnitCogs,
  validateProductionRequestInput,
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

test("batch other cost is allocated across actual good production units", () => {
  const unitCogs = calculateFullyLoadedUnitCogs({
    unitCogs: "10",
    batchOtherCost: "1",
    goodQuantity: 3,
  });
  assert.equal(unitCogs.toFixed(14), "10.33333333333333");
  assert.equal(unitCogs.mul(3).toFixed(2), "31.00");
});

test("production pricing keeps batch other cost separate and MOQ does not constrain requested quantity", () => {
  const normalized = validateProductionRequestInput({
    lines: [{ size: "S", color: "Black", quantity: 20 }],
    unitCogs: "200",
    minimumOrderQuantity: "50",
    otherCost: "150",
  });

  assert.equal(normalized.totalQuantity, 20);
  assert.equal(normalized.unitCogs.toFixed(2), "200.00");
  assert.equal(normalized.minimumOrderQuantity, 50);
  assert.equal(normalized.otherCost.toFixed(2), "150.00");
});

test("production request validation rejects duplicate variants and non-positive COGS", () => {
  assert.throws(() => validateProductionRequestInput({
    lines: [
      { size: "M", color: "Blue", quantity: 2 },
      { size: "m", color: "blue", quantity: 1 },
    ],
    unitCogs: "10",
    minimumOrderQuantity: 1,
  }), /unique/);

  assert.throws(() => validateProductionRequestInput({
    lines: [{ size: "M", color: "Blue", quantity: 2 }],
    unitCogs: "0",
    minimumOrderQuantity: 1,
  }), /greater than zero/);
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
