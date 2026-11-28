import assert from "node:assert/strict";
import test from "node:test";
import { runFixedAssetDepreciationBatch } from "../services/fixedAssetDepreciationService.js";
import { getConfiguredNepaliFiscalPeriod } from "../services/nepaliFiscalCalendar.js";

const createHarness = (initialAssets = [], conflictOnUpdate = false) => {
  const state = {
    assets: structuredClone(initialAssets),
    entries: [],
    transactionOptions: null,
  };
  const client = {
    async $transaction(callback, options) {
      state.transactionOptions = options;
      const transactionState = {
        assets: structuredClone(state.assets),
        entries: structuredClone(state.entries),
      };
      const tx = {
        nepaliCalendarYear: {
          findMany: async () => [],
        },
        fixedAsset: {
          findMany: async ({ where }) => transactionState.assets.filter((asset) => asset.status === where.status),
          updateMany: async ({ where, data }) => {
            if (conflictOnUpdate) return { count: 0 };
            const asset = transactionState.assets.find((item) =>
              item.id === where.id &&
              item.status === where.status &&
              item.currentBookValue === where.currentBookValue &&
              item.accumulatedDepreciation === where.accumulatedDepreciation
            );
            if (!asset) return { count: 0 };
            Object.assign(asset, data);
            return { count: 1 };
          },
        },
        journalEntry: {
          findUnique: async ({ where }) => transactionState.entries.find((entry) =>
            entry.idempotencyKey === where.idempotencyKey
          ) || null,
          findFirst: async ({ where }) => transactionState.entries.find((entry) => {
            if (entry.sourceType !== where.sourceType) return false;
            if (where.sourceId) return entry.sourceId === where.sourceId;
            return entry.transactionDate >= where.transactionDate.gte &&
              entry.transactionDate <= where.transactionDate.lte;
          }) || null,
          create: async ({ data }) => {
            const entry = { ...data, status: "POSTED" };
            transactionState.entries.push(entry);
            return entry;
          },
        },
      };
      const result = await callback(tx);
      state.assets = transactionState.assets;
      state.entries = transactionState.entries;
      return result;
    },
  };
  return { client, state };
};

const asset = {
  id: "asset-1",
  assetTag: "AST-1",
  status: "ACTIVE",
  depreciationMethod: "WRITTEN_DOWN_VALUE_SLAB",
  depreciationRate: 12,
  currentBookValue: 1000,
  accumulatedDepreciation: 0,
  salvageValue: 100,
  purchaseCost: 1000,
  usefulLifeMonths: 60,
};

test("depreciation updates asset books and posts one journal for the configured BS period", async () => {
  const { client, state } = createHarness([asset]);
  const transactionDate = new Date("2026-03-31T18:30:00.000Z");
  const periodKey = (await getConfiguredNepaliFiscalPeriod(transactionDate, [])).periodName;
  let postedInput;
  const result = await runFixedAssetDepreciationBatch({
    client,
    transactionDate,
    postAccounting: async (input) => {
      postedInput = input;
      const entry = {
        status: "POSTED",
        sourceType: "ASSET_DEPRECIATION",
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        totalDebit: input.totalDepreciation,
      };
      await input.client.journalEntry.create({ data: entry });
      return entry;
    },
  });

  assert.equal(result.totalDepreciated, 10);
  assert.equal(result.count, 1);
  assert.equal(postedInput.periodName, periodKey);
  assert.equal(postedInput.idempotencyKey, `ASSET_DEPRECIATION:${periodKey}`);
  assert.equal(postedInput.client.fixedAsset !== undefined, true);
  assert.equal(state.assets[0].currentBookValue, 990);
  assert.equal(state.assets[0].accumulatedDepreciation, 10);
  assert.equal(state.transactionOptions.isolationLevel, "Serializable");
});

test("depreciation posting failure rolls back asset book values", async () => {
  const { client, state } = createHarness([asset]);
  await assert.rejects(runFixedAssetDepreciationBatch({
    client,
    transactionDate: new Date("2026-04-15T00:00:00.000Z"),
    postAccounting: async () => {
      throw new Error("GL unavailable");
    },
  }), /GL unavailable/);

  assert.equal(state.assets[0].currentBookValue, 1000);
  assert.equal(state.assets[0].accumulatedDepreciation, 0);
});

test("depreciation source conflict aborts before journal posting", async () => {
  const { client, state } = createHarness([asset], true);
  let posterCalled = false;
  await assert.rejects(runFixedAssetDepreciationBatch({
    client,
    transactionDate: new Date("2026-04-15T00:00:00.000Z"),
    postAccounting: async () => {
      posterCalled = true;
    },
  }), { code: "FIXED_ASSET_BALANCE_CONFLICT" });

  assert.equal(state.assets[0].currentBookValue, 1000);
  assert.equal(state.assets[0].accumulatedDepreciation, 0);
  assert.equal(posterCalled, false);
});

test("depreciation retry for an already-posted BS period does not update assets", async () => {
  const { client, state } = createHarness([asset]);
  const periodKey = (await getConfiguredNepaliFiscalPeriod(new Date("2026-04-15T00:00:00.000Z"), [])).periodName;
  state.entries.push({
    status: "POSTED",
    sourceType: "ASSET_DEPRECIATION",
    sourceId: `DEP-${periodKey}`,
    idempotencyKey: `ASSET_DEPRECIATION:${periodKey}`,
    transactionDate: new Date("2026-04-15T00:00:00.000Z"),
    totalDebit: 10,
  });
  let posterCalled = false;
  const result = await runFixedAssetDepreciationBatch({
    client,
    transactionDate: new Date("2026-04-15T00:00:00.000Z"),
    postAccounting: async () => {
      posterCalled = true;
    },
  });

  assert.equal(result.alreadyProcessed, true);
  assert.equal(result.totalDepreciated, 10);
  assert.equal(state.assets[0].currentBookValue, 1000);
  assert.equal(posterCalled, false);
});

test("depreciation does not repeat a legacy batch already posted in the BS period", async () => {
  const { client, state } = createHarness([asset]);
  state.entries.push({
    status: "POSTED",
    sourceType: "ASSET_DEPRECIATION",
    sourceId: "DEP-2026-04",
    idempotencyKey: "ASSET_DEPRECIATION:2026-04:10",
    transactionDate: new Date("2026-04-15T00:00:00.000Z"),
    totalDebit: 10,
  });
  let posterCalled = false;
  const result = await runFixedAssetDepreciationBatch({
    client,
    transactionDate: new Date("2026-04-15T00:00:00.000Z"),
    postAccounting: async () => {
      posterCalled = true;
    },
  });

  assert.equal(result.alreadyProcessed, true);
  assert.equal(state.assets[0].currentBookValue, 1000);
  assert.equal(posterCalled, false);
});

test("depreciation rejects multi-month batches to preserve period identity", async () => {
  const { client } = createHarness([asset]);
  await assert.rejects(runFixedAssetDepreciationBatch({
    client,
    monthsCount: 2,
  }), { code: "INVALID_DEPRECIATION_PERIOD" });
});
