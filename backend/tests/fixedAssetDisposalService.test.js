import assert from "node:assert/strict";
import test from "node:test";
import { recordFixedAssetDisposal } from "../services/fixedAssetDisposalService.js";

const createClient = () => {
  const state = {
    asset: {
      id: "asset-1",
      status: "ACTIVE",
      currentBookValue: 2400,
      accumulatedDepreciation: 600,
    },
    journalEntry: null,
  };
  const client = {
    journalEntry: {
      findUnique: async () => state.journalEntry,
    },
    fixedAsset: {
      findUnique: async () => ({ ...state.asset }),
      updateMany: async ({ where, data }) => {
        if (state.asset.id !== where.id || state.asset.status !== where.status ||
            state.asset.currentBookValue !== where.currentBookValue ||
            state.asset.accumulatedDepreciation !== where.accumulatedDepreciation) return { count: 0 };
        state.asset = { ...state.asset, ...data };
        return { count: 1 };
      },
    },
  };
  return { state, client };
};

test("fixed asset write-off posts only through the transaction client and replays idempotently", async () => {
  const { state, client } = createClient();
  let accountingPosts = 0;
  const postDisposalAccounting = async (asset, details) => {
    accountingPosts += 1;
    state.journalEntry = {
      status: "POSTED",
      sourceId: asset.id,
      referenceNumber: details.payloadHash,
    };
  };

  const first = await recordFixedAssetDisposal({
    assetId: "asset-1",
    status: "WRITTEN_OFF",
    damageNotes: "Equipment is beyond repair.",
    reason: "Write-off approved after inspection.",
    idempotencyKey: "approval-request-1",
    client,
    postDisposalAccounting,
  });
  assert.equal(first.alreadyProcessed, false);
  assert.equal(first.scrapLoss, 2400);
  assert.equal(first.asset.status, "WRITTEN_OFF");
  assert.equal(accountingPosts, 1);

  const replay = await recordFixedAssetDisposal({
    assetId: "asset-1",
    status: "WRITTEN_OFF",
    damageNotes: "Equipment is beyond repair.",
    idempotencyKey: "approval-request-1",
    client,
    postDisposalAccounting,
  });
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(accountingPosts, 1);
});

test("fixed asset disposal rejects proceeds and unsupported statuses", async () => {
  const { client } = createClient();
  await assert.rejects(recordFixedAssetDisposal({
    assetId: "asset-1",
    status: "SOLD",
    disposalAmount: 100,
    idempotencyKey: "asset-sale-request",
    client,
  }), (error) => error.code === "ASSET_SALE_TAX_FLOW_REQUIRED");
});
