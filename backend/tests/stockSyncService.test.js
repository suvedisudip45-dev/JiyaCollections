import assert from "node:assert/strict";
import test from "node:test";
import { aggregateDistributorStock, syncAllProductsStock } from "../services/stockSyncService.js";

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

test("full stock synchronization pages products and bounds concurrent database work", async () => {
  const ids = Array.from({ length: 7 }, (_, index) => `product-${index + 1}`);
  const updatedProducts = [];
  let activeBalanceQueries = 0;
  let maximumBalanceQueries = 0;
  let pageQueries = 0;
  const client = {
    product: {
      findMany: async ({ cursor, take }) => {
        pageQueries += 1;
        const start = cursor ? ids.indexOf(cursor.id) + 1 : 0;
        return ids.slice(start, start + take).map((id) => ({ id }));
      },
      findUnique: async ({ where }) => ({ id: where.id, variants: [] }),
      update: async ({ where, data }) => {
        updatedProducts.push({ id: where.id, data });
        return { id: where.id, ...data };
      },
    },
    inventoryBalance: {
      findMany: async () => {
        activeBalanceQueries += 1;
        maximumBalanceQueries = Math.max(maximumBalanceQueries, activeBalanceQueries);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeBalanceQueries -= 1;
        return [];
      },
    },
  };

  const syncedCount = await syncAllProductsStock({ client, pageSize: 3, concurrency: 2 });

  assert.equal(syncedCount, ids.length);
  assert.equal(updatedProducts.length, ids.length);
  assert.equal(pageQueries, 3);
  assert.ok(maximumBalanceQueries > 1);
  assert.ok(maximumBalanceQueries <= 2);
});

test("full stock synchronization rejects invalid batching options", async () => {
  await assert.rejects(syncAllProductsStock({ pageSize: 0 }), /pageSize must be a positive/);
  await assert.rejects(syncAllProductsStock({ concurrency: 0 }), /concurrency must be a positive/);
});
