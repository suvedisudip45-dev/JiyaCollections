import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateProductionLayersForOrderItem,
  validateProductionRequestInput,
} from "../services/manufacturerProductionService.js";

test("production pricing is per unit and MOQ does not constrain the requested quantity", () => {
  const normalized = validateProductionRequestInput({
    lines: [{ size: "S", color: "Black", quantity: 20 }],
    unitCogs: "200",
    minimumOrderQuantity: "50",
    deliveryCost: "15",
  });

  assert.equal(normalized.totalQuantity, 20);
  assert.equal(normalized.unitCogs.toFixed(2), "200.00");
  assert.equal(normalized.minimumOrderQuantity, 50);
  assert.equal(normalized.deliveryCost.toFixed(2), "15.00");
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
    { id: "layer-1", availableQuantity: 3, unitCogs: { toFixed: () => "100.00" }, unitDeliveryCost: { toFixed: () => "5.00" } },
    { id: "layer-2", availableQuantity: 4, unitCogs: { toFixed: () => "120.00" }, unitDeliveryCost: { toFixed: () => "8.00" } },
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
    { quantity: 3, unitCogs: "100.00", unitDeliveryCost: "5.00" },
    { quantity: 4, unitCogs: "120.00", unitDeliveryCost: "8.00" },
  ]);
  assert.equal(result.legacyCostQuantity, 2);
  assert.equal(created.length, 2);
  assert.equal(layers[0].availableQuantity, 0);
  assert.equal(layers[1].availableQuantity, 0);
});
