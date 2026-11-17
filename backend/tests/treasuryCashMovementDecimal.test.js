import assert from "node:assert/strict";
import test from "node:test";
import { accountingDecimal, compareDecimals } from "../services/accountingDecimal.js";
import financialRouter from "../routes/financialRoute.js";
import {
  createRecordCashTransferHandler,
  recordCashTransfer,
} from "../controllers/treasuryAccountingController.js";

const createHarness = ({ startingBalance = "100.00" } = {}) => {
  const state = {
    accounts: new Map([["treasury-1", {
      id: "treasury-1",
      accountName: "Treasury",
      accountingAccountId: "gl-treasury",
      currentBalance: accountingDecimal(startingBalance),
    }]]),
    transactions: new Map(),
    journals: [],
    accountReads: 0,
  };
  const client = {
    cashTransaction: {
      async findUnique({ where }) {
        return state.transactions.get(where.idempotencyKey) || null;
      },
      async create({ data }) {
        const transaction = { id: `cash-${state.transactions.size + 1}`, ...data };
        state.transactions.set(data.idempotencyKey, transaction);
        return transaction;
      },
    },
    financialAccount: {
      async findUnique({ where }) {
        return state.accounts.get(where.id) || null;
      },
      async updateMany({ where, data }) {
        const account = state.accounts.get(where.id);
        if (!account || compareDecimals(account.currentBalance, where.currentBalance.gte) < 0) {
          return { count: 0 };
        }
        account.currentBalance = account.currentBalance.minus(data.currentBalance.decrement);
        return { count: 1 };
      },
      async update({ where, data }) {
        const account = state.accounts.get(where.id);
        account.currentBalance = account.currentBalance.plus(data.currentBalance.increment);
        return account;
      },
    },
    account: {
      async findUnique() {
        state.accountReads += 1;
        return { id: "offset-account", isActive: true };
      },
    },
    distributorStockReturn: {
      async findUnique() {
        return null;
      },
    },
    async $transaction(callback) {
      return callback(client);
    },
  };
  const handler = createRecordCashTransferHandler({
    client,
    postJournal: async (journal) => {
      state.journals.push(journal);
      return { id: `journal-${state.journals.length}` };
    },
  });
  const invoke = async (body, headers = {}) => {
    let status = 200;
    let responseBody;
    await handler({ body, headers, auth: { email: "finance@example.test" } }, {
      status(value) {
        status = value;
        return this;
      },
      json(value) {
        responseBody = value;
        return this;
      },
    });
    return { status, body: responseBody };
  };
  return { state, invoke };
};

test("the mounted Treasury cash-transfer route uses the Decimal-safe production handler", () => {
  const route = financialRouter.stack.find((layer) => layer.route?.path === "/cash-transfer");
  assert.ok(route);
  assert.equal(route.route.stack.at(-1).handle, recordCashTransfer);
});

test("Treasury inflows quantize fractional NPR amounts with HALF_EVEN and post the same Decimal amount", async () => {
  const { state, invoke } = createHarness({ startingBalance: "0.00" });

  const first = await invoke({
    type: "INFLOW",
    category: "MISC_INFLOW",
    toAccountId: "treasury-1",
    amount: "1.005",
    idempotencyKey: "treasury-in-1",
  });
  const second = await invoke({
    type: "INFLOW",
    category: "MISC_INFLOW",
    toAccountId: "treasury-1",
    amount: "0.015",
    idempotencyKey: "treasury-in-2",
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(state.accounts.get("treasury-1").currentBalance.toFixed(2), "1.02");
  assert.equal(state.transactions.size, 2);
  assert.deepEqual(
    [...state.transactions.values()].map((transaction) => transaction.amount.toFixed(2)),
    ["1.00", "0.02"],
  );
  assert.deepEqual(
    state.journals.map((entry) => entry.lines[0].debit.toFixed(2)),
    ["1.00", "0.02"],
  );
  assert.equal(state.journals[0].lines[1].credit.toFixed(2), "1.00");
});

test("Treasury movements reject Number, non-positive, and out-of-range money inputs before persistence", async () => {
  const { state, invoke } = createHarness();
  for (const amount of [1.25, 0, "-0.01", "9999999999999999999.99"]) {
    const result = await invoke({
      type: "INFLOW",
      category: "MISC_INFLOW",
      toAccountId: "treasury-1",
      amount,
      idempotencyKey: `invalid-${String(amount)}`,
    });
    assert.equal(result.status, 400);
  }
  assert.equal(state.transactions.size, 0);
  assert.equal(state.journals.length, 0);
  assert.equal(state.accountReads, 0);
});

test("Treasury duplicate replay compares normalized Decimals and rejects changed amounts", async () => {
  const { state, invoke } = createHarness({ startingBalance: "0.00" });
  const input = {
    type: "INFLOW",
    category: "MISC_INFLOW",
    toAccountId: "treasury-1",
    amount: "12.345",
    idempotencyKey: "treasury-replay",
  };
  assert.equal((await invoke(input)).status, 200);
  const replay = await invoke({ ...input, amount: "12.34" });
  const conflict = await invoke({ ...input, amount: "12.35" });

  assert.equal(replay.status, 200);
  assert.equal(replay.body.alreadyProcessed, true);
  assert.equal(conflict.status, 409);
  assert.equal(state.transactions.size, 1);
  assert.equal(state.journals.length, 1);
});

test("Treasury outflow records the exact Decimal amount in balance, cash, and journal", async () => {
  const { state, invoke } = createHarness({ startingBalance: "1.00" });
  const result = await invoke({
    type: "OUTFLOW",
    category: "EXPENSE",
    fromAccountId: "treasury-1",
    amount: "1.005",
    idempotencyKey: "treasury-exact-outflow",
  });

  assert.equal(result.status, 200);
  assert.equal(state.accounts.get("treasury-1").currentBalance.toFixed(2), "0.00");
  assert.equal([...state.transactions.values()][0].amount.toFixed(2), "1.00");
  assert.equal(state.journals[0].lines[0].debit.toFixed(2), "1.00");
  assert.equal(state.journals[0].lines[1].credit.toFixed(2), "1.00");
});

test("Treasury outflow prevents overdraw using Decimal balance comparison", async () => {
  const { state, invoke } = createHarness({ startingBalance: "1.00" });
  const result = await invoke({
    type: "OUTFLOW",
    category: "EXPENSE",
    fromAccountId: "treasury-1",
    amount: "1.01",
    idempotencyKey: "treasury-overdraw",
  });

  assert.equal(result.status, 400);
  assert.equal(state.accounts.get("treasury-1").currentBalance.toFixed(2), "1.00");
  assert.equal(state.transactions.size, 0);
  assert.equal(state.journals.length, 0);
});
