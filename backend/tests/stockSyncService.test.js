import assert from "node:assert/strict";
import test from "node:test";
import { aggregateDistributorStock } from "../services/stockSyncService.js";

test("storefront stock aggregates only available distributor ledger quantities by variant", () => {
  const stock = aggregateDistributorStock([
    {
      quantityOnHand: 8,
      reservedQuantity: 3,
      inventorySku: { size: "Medium", color: "Navy", sizeKey: "medium", colorKey: "navy" },
    },
    {
      quantityOnHand: 5,
      reservedQuantity: 0,
      inventorySku: { size: "M", color: "Navy", sizeKey: "m", colorKey: "navy" },
    },
    {
      quantityOnHand: 3,
      reservedQuantity: 4,
      inventorySku: { size: "S", color: "Navy", sizeKey: "s", colorKey: "navy" },
    },
  ]);

  assert.equal(stock.stockQuantity, 10);
  assert.equal(stock.variantAvailableMap.get(JSON.stringify(["medium", "navy"])), 5);
  assert.equal(stock.variantAvailableMap.get(JSON.stringify(["m", "navy"])), 5);
  assert.equal(stock.variantAvailableMap.get(JSON.stringify(["s", "navy"])), 0);
});

test("storefront stock remains zero when the product has no distributor balance", () => {
  assert.equal(aggregateDistributorStock([]).stockQuantity, 0);
});
