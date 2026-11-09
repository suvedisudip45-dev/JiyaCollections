import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { recordShareBuyback } from "../services/shareBuybackService.js";

const createHarness = () => {
  const state = {
    treasury: {
      id: "treasury-bank",
      status: "ACTIVE",
      accountType: "BANK",
      currency: "NPR",
      accountingAccountId: "gl-bank",
      currentBalance: 1000000,
      reservedBalance: 0,
      accountName: "Main Bank",
    },
    partners: [
      { id: "seller", partnerName: "Seller", status: "ACTIVE", shareCount: 600, ownershipPercentage: 60, currentCapital: 600000 },
      { id: "holder", partnerName: "Holder", status: "ACTIVE", shareCount: 400, ownershipPercentage: 40, currentCapital: 400000 },
    ],
    cashTransactions: [],
    shareTransactions: [],
    journals: [],
  };
  const tx = {
    financialAccount: {
      findUnique: async () => state.treasury,
      updateMany: async ({ where, data }) => {
        if (state.treasury.id !== where.id ||
            state.treasury.status !== where.status ||
            state.treasury.currency !== where.currency ||
            state.treasury.currentBalance !== where.currentBalance ||
            state.treasury.reservedBalance !== Number(where.reservedBalance)) return { count: 0 };
        state.treasury.currentBalance -= Number(data.currentBalance.decrement);
        return { count: 1 };
      },
    },
    account: {
      findUnique: async () => ({
        id: "gl-bank",
        accountCode: "1120",
        accountType: "ASSET",
        normalBalance: "DEBIT",
        isActive: true,
        subAccounts: [],
      }),
    },
    partnerEquity: {
      findUnique: async ({ where }) => state.partners.find((partner) => partner.id === where.id) || null,
      findMany: async ({ where }) => state.partners.filter((partner) => where.status.in.includes(partner.status)),
      updateMany: async ({ where, data }) => {
        const partner = state.partners.find((row) =>
          row.id === where.id && row.shareCount === where.shareCount && row.status === where.status
        );
        if (!partner) return { count: 0 };
        Object.assign(partner, data);
        return { count: 1 };
      },
      update: async ({ where, data }) => {
        const partner = state.partners.find((row) => row.id === where.id);
        Object.assign(partner, data);
        return partner;
      },
    },
    cashTransaction: {
      create: async ({ data }) => {
        if (state.cashTransactions.some((row) => row.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error("Duplicate cash transaction"), { code: "P2002" });
        }
        state.cashTransactions.push(data);
        return data;
      },
    },
    shareTransaction: {
      create: async ({ data }) => {
        state.shareTransactions.push(data);
        return data;
      },
    },
    journalEntry: {
      findUnique: async ({ where }) => state.journals.find((journal) => journal.idempotencyKey === where.idempotencyKey) || null,
    },
  };
  const client = {
    $transaction: async (callback, options) => {
      assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
      const before = JSON.parse(JSON.stringify(state));
      try {
        return await callback(tx);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
  };
  return { client, state, tx };
};

const baseRequest = {
  sellerPartnerId: "seller",
  sharesToTransfer: "100",
  sharePrice: "1000",
  fromTreasuryAccountId: "treasury-bank",
  notes: "Approved repurchase",
  idempotencyKey: "buyback-request-1",
};

test("share buyback atomically retires shares, pays mapped Treasury, and replays idempotently", async () => {
  const { client, state, tx } = createHarness();
  const accountingCalls = [];
  const postAccounting = async (params, options) => {
    accountingCalls.push({ params, options });
    const journal = {
      id: "journal-buyback-1",
      status: "POSTED",
      sourceType: "SHARE_BUYBACK",
      idempotencyKey: params.idempotencyKey,
      referenceNumber: params.referenceNumber,
    };
    state.journals.push(journal);
    return journal;
  };

  const first = await recordShareBuyback(baseRequest, { client, postAccounting });
  assert.equal(first.alreadyProcessed, false);
  assert.equal(state.treasury.currentBalance, 900000);
  assert.equal(state.partners.find((partner) => partner.id === "seller").shareCount, 500);
  assert.equal(state.partners.find((partner) => partner.id === "seller").ownershipPercentage, 55.56);
  assert.equal(state.partners.find((partner) => partner.id === "holder").ownershipPercentage, 44.44);
  assert.equal(state.cashTransactions.length, 1);
  assert.equal(state.cashTransactions[0].amount, 100000);
  assert.equal(state.cashTransactions[0].category, "SHARE_BUYBACK");
  assert.equal(state.shareTransactions.length, 1);
  assert.equal(accountingCalls[0].params.cashAccountCode, "1120");
  assert.equal(accountingCalls[0].params.totalTransactionValue, 100000);
  assert.equal(accountingCalls[0].options.client, tx);
  assert.equal(accountingCalls[0].options.throwOnError, true);

  const replay = await recordShareBuyback(baseRequest, { client, postAccounting });
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(state.treasury.currentBalance, 900000);
  assert.equal(state.cashTransactions.length, 1);
  assert.equal(state.shareTransactions.length, 1);
  assert.equal(accountingCalls.length, 1);
});

test("share buyback rejects changed payload with the same idempotency key", async () => {
  const { client, state } = createHarness();
  const postAccounting = async (params) => {
    const journal = {
      id: "journal-buyback-1",
      status: "POSTED",
      sourceType: "SHARE_BUYBACK",
      idempotencyKey: params.idempotencyKey,
      referenceNumber: params.referenceNumber,
    };
    state.journals.push(journal);
    return journal;
  };

  await recordShareBuyback(baseRequest, { client, postAccounting });
  await assert.rejects(
    recordShareBuyback({ ...baseRequest, sharesToTransfer: "101" }, { client, postAccounting }),
    { statusCode: 409, code: "IDEMPOTENCY_KEY_REUSED" },
  );
  assert.equal(state.cashTransactions.length, 1);
  assert.equal(state.shareTransactions.length, 1);
});

test("share buyback rolls back all source changes when journal posting fails", async () => {
  const { client, state } = createHarness();
  await assert.rejects(
    recordShareBuyback(baseRequest, {
      client,
      postAccounting: async () => {
        throw new Error("journal posting failed");
      },
    }),
    /journal posting failed/,
  );
  assert.equal(state.treasury.currentBalance, 1000000);
  assert.equal(state.partners.find((partner) => partner.id === "seller").shareCount, 600);
  assert.equal(state.cashTransactions.length, 0);
  assert.equal(state.shareTransactions.length, 0);
});

test("share buyback refuses reserved-fund shortfall and missing Treasury mapping", async () => {
  const { client, state } = createHarness();
  state.treasury.currentBalance = 150000;
  state.treasury.reservedBalance = 60000;
  await assert.rejects(
    recordShareBuyback(baseRequest, { client }),
    { code: "INSUFFICIENT_TREASURY_FUNDS" },
  );
  state.treasury.currentBalance = 1000000;
  state.treasury.accountingAccountId = null;
  await assert.rejects(
    recordShareBuyback(baseRequest, { client }),
    /Select the accounting asset account/,
  );
  assert.equal(state.cashTransactions.length, 0);
  assert.equal(state.shareTransactions.length, 0);
});
