import assert from "node:assert/strict";
import test from "node:test";
import { loadPlatformInventoryValuationSources } from "../services/inventoryValuationSourceService.js";

test("inventory source loader preserves dashboard scope and can include ledger-only lost locations for reconciliation", async () => {
  const locationQueries = [];
  const balanceQueries = [];
  let layerQueryCount = 0;
  const client = {
    inventoryLocation: {
      findMany: async (query) => {
        locationQueries.push(query);
        return [
          { id: "factory", kind: "FACTORY", inventoryOwner: "PLATFORM" },
          { id: "lost", kind: "LOST", inventoryOwner: "PLATFORM" },
        ];
      },
    },
    inventoryBalance: {
      findMany: async (query) => {
        balanceQueries.push(query);
        return [{ locationId: "factory", inventorySkuId: "sku", quantityOnHand: 2 }];
      },
    },
    $queryRaw: async () => {
      layerQueryCount += 1;
      return [{ locationId: "factory", inventorySkuId: "sku", quantity: 2, unitCogs: "100.00" }];
    },
  };

  const dashboardSnapshot = await loadPlatformInventoryValuationSources(client);
  assert.deepEqual(dashboardSnapshot.locations.map(({ id }) => id), ["factory"]);
  assert.deepEqual(balanceQueries[0].where.locationId.in, ["factory"]);
  assert.deepEqual(dashboardSnapshot.layerBalances.map(({ quantity }) => quantity), [2]);

  const reconciliationSnapshot = await loadPlatformInventoryValuationSources(client, {
    includeLostLocations: true,
    includeLedgerOnlyLocations: true,
  });
  assert.deepEqual(reconciliationSnapshot.locations.map(({ id }) => id), ["factory", "lost"]);
  assert.deepEqual(balanceQueries[1].where.locationId.in, ["factory", "lost"]);
  assert.equal(layerQueryCount, 2);
});
