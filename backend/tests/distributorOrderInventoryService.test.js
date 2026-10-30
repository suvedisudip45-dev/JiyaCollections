import assert from "node:assert/strict";
import test from "node:test";
import { consumeDistributorOrderInventory } from "../services/distributorOrderInventoryService.js";

test("direct hub sale consumes unreserved stock and snapshots FIFO cost-layer data", async () => {
  const balance = {
    id: "balance-1",
    locationId: "location-1",
    inventorySkuId: "sku-1",
    quantityOnHand: 5,
    reservedQuantity: 1,
  };
  const costLayer = {
    id: "layer-1",
    manufacturerId: "manufacturer-1",
    unitCogs: "125.50",
    unitVatAmount: "0",
    vatInvoiceVerified: false,
    manufacturerPayableRecognizedAtProduction: true,
    unitDeliveryCost: "12.00",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
  };
  const movements = [{
    inventorySkuId: "sku-1",
    sourceLocationId: null,
    destinationLocationId: "location-1",
    quantity: 5,
    productionCostLayerId: costLayer.id,
    productionCostLayer: costLayer,
  }];
  const createdMovements = [];
  const product = { id: "product-1", variants: [] };
  const tx = {
    inventorySku: {
      findUnique: async () => ({ id: "sku-1", isActive: true }),
    },
    inventoryBalance: {
      findMany: async ({ where }) => {
        if (where.location?.distributorId) return [{ ...balance }];
        return [{
          ...balance,
          inventorySku: { size: "M", color: "Blue", sizeKey: "m", colorKey: "blue" },
        }];
      },
      updateMany: async ({ data }) => {
        balance.quantityOnHand -= data.quantityOnHand.decrement;
        if (data.reservedQuantity) balance.reservedQuantity -= data.reservedQuantity.decrement;
        return { count: 1 };
      },
    },
    inventoryLedgerEntry: {
      findMany: async ({ where }) => where.referenceType
        ? []
        : movements,
      create: async ({ data }) => {
        createdMovements.push(data);
        return data;
      },
    },
    product: {
      findUnique: async () => product,
      update: async ({ data }) => Object.assign(product, data),
    },
  };

  const result = await consumeDistributorOrderInventory({
    tx,
    orderId: "direct-order-1",
    distributorId: "distributor-1",
    assignmentId: "assignment-1",
    directSale: true,
    items: [{
      productId: "product-1",
      inventorySkuId: "sku-1",
      size: "M",
      color: "Blue",
      quantity: 2,
    }],
  });

  assert.equal(balance.quantityOnHand, 3);
  assert.equal(balance.reservedQuantity, 1);
  assert.equal(createdMovements.length, 1);
  assert.equal(createdMovements[0].referenceType, "DIRECT_DISTRIBUTOR_ORDER");
  assert.equal(createdMovements[0].productionCostLayerId, "layer-1");
  assert.deepEqual(result.accountingItems[0].productionCostAllocations, [{
    quantity: 2,
    costLayerId: "layer-1",
    manufacturerId: "manufacturer-1",
    manufacturerPayableRecognizedAtProduction: true,
    unitCogs: "125.50",
    unitVatAmount: "0",
    vatInvoiceVerified: false,
    unitDeliveryCost: "12.00",
  }]);
  assert.equal(result.accountingItems[0].legacyCostQuantity, 0);
});
