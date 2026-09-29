import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { postJournalEntry } from "../services/accountingPostingEngine.js";

const createHarness = ({ periodStatus = "OPEN" } = {}) => {
  const state = {
    accounts: [
      { id: "cash-account", accountCode: "1000", normalBalance: "DEBIT", currentBalance: new Prisma.Decimal(0) },
      { id: "revenue-account", accountCode: "4000", normalBalance: "CREDIT", currentBalance: new Prisma.Decimal(0) },
    ],
    fiscalYears: new Map(),
    periods: new Map(),
    sequences: new Map(),
    events: [],
    entries: [],
  };

  const client = {
    fiscalYear: {
      upsert: async ({ where, create }) => {
        if (!state.fiscalYears.has(where.name)) state.fiscalYears.set(where.name, { id: `fy-${where.name}`, ...create });
        return state.fiscalYears.get(where.name);
      },
    },
    accountingPeriod: {
      upsert: async ({ where, create }) => {
        const key = `${where.fiscalYearId_periodName.fiscalYearId}:${where.fiscalYearId_periodName.periodName}`;
        if (!state.periods.has(key)) {
          state.periods.set(key, { id: `period-${key}`, ...create, status: periodStatus });
        }
        return state.periods.get(key);
      },
    },
    journalSequence: {
      upsert: async ({ where, create }) => {
        let sequence = state.sequences.get(where.fiscalYear);
        if (!sequence) {
          sequence = { fiscalYear: where.fiscalYear, nextNumber: create.nextNumber };
          state.sequences.set(where.fiscalYear, sequence);
        } else {
          sequence.nextNumber += 1;
        }
        return { ...sequence };
      },
    },
    account: {
      findUnique: async ({ where }) => state.accounts.find((account) =>
        (where.id && account.id === where.id) || (where.accountCode && account.accountCode === where.accountCode)) || null,
      update: async ({ where, data }) => {
        const account = state.accounts.find((item) => item.id === where.id);
        account.currentBalance = account.currentBalance.plus(data.currentBalance.increment);
        return account;
      },
    },
    accountingAccountMapping: {
      findUnique: async ({ where }) => {
        const accountCode = { TEST_CASH: "1000", TEST_REVENUE: "4000" }[where.mappingKey];
        const account = state.accounts.find((item) => item.accountCode === accountCode);
        return account ? { id: `mapping-${where.mappingKey}`, accountId: account.id, account } : null;
      },
    },
    journalEntry: {
      findUnique: async ({ where }) => state.entries.find((entry) => entry.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        if (data.idempotencyKey && state.entries.some((entry) => entry.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const entry = {
          id: `journal-${state.entries.length + 1}`,
          ...data,
          lines: data.lines.create.map((line, index) => ({ id: `line-${index + 1}`, ...line })),
        };
        state.entries.push(entry);
        return entry;
      },
    },
    accountingEvent: {
      create: async ({ data }) => {
        if (state.events.some((event) => event.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const event = { id: `event-${state.events.length + 1}`, ...data };
        state.events.push(event);
        return event;
      },
      update: async ({ where, data }) => {
        const event = state.events.find((item) => item.id === where.id);
        Object.assign(event, data);
        return event;
      },
    },
    $transaction: async (callback) => callback(client),
  };

  return { client, state };
};

const lines = [
  { accountCode: "1000", debit: "10.10", credit: 0 },
  { accountCode: "4000", debit: 0, credit: "10.10" },
];

test("posting writes an exactly balanced journal and updates Decimal account balances", async () => {
  const { client, state } = createHarness();
  const entry = await postJournalEntry({
    client,
    transactionDate: new Date("2026-09-28T12:00:00.000Z"),
    sourceType: "UNIT_TEST",
    sourceId: "source-1",
    idempotencyKey: "UNIT_TEST:source-1",
    description: "Unit posting",
    lines,
  });

  assert.equal(entry.journalNumber, "JE-2083-00001");
  assert.equal(entry.totalDebit.toFixed(2), "10.10");
  assert.equal(entry.totalCredit.toFixed(2), "10.10");
  assert.equal(entry.accountingEventId, state.events[0].id);
  assert.equal(state.events[0].status, "POSTED");
  assert.equal(state.events[0].payloadHash.length, 64);
  assert.equal(state.accounts[0].currentBalance.toFixed(2), "10.10");
  assert.equal(state.accounts[1].currentBalance.toFixed(2), "10.10");
});

test("posting resolves semantic account mapping keys", async () => {
  const { client, state } = createHarness();
  const entry = await postJournalEntry({
    client,
    sourceType: "UNIT_TEST",
    sourceId: "mapped-source",
    lines: [
      { mappingKey: "TEST_CASH", debit: "5.00", credit: 0 },
      { mappingKey: "TEST_REVENUE", debit: 0, credit: "5.00" },
    ],
  });

  assert.equal(entry.lines[0].accountId, "cash-account");
  assert.equal(entry.lines[1].accountId, "revenue-account");
  assert.equal(state.entries.length, 1);
});

test("a duplicate source returns the original journal without another sequence or balance update", async () => {
  const { client, state } = createHarness();
  const first = await postJournalEntry({ client, sourceType: "UNIT_TEST", sourceId: "duplicate-source", lines });
  const second = await postJournalEntry({
    client,
    sourceType: "UNIT_TEST",
    sourceId: "duplicate-source",
    lines: [
      { accountCode: "1000", debit: "99.00", credit: 0 },
      { accountCode: "4000", debit: 0, credit: "99.00" },
    ],
  });

  assert.equal(second.id, first.id);
  assert.equal(state.entries.length, 1);
  assert.equal(state.events.length, 1);
  assert.equal(state.accounts[0].currentBalance.toFixed(2), "10.10");
  assert.equal(state.sequences.get(2083).nextNumber, 2);
});

test("closed accounting periods reject posting before journal or sequence creation", async () => {
  const { client, state } = createHarness({ periodStatus: "CLOSED" });
  await assert.rejects(() => postJournalEntry({ client, sourceType: "UNIT_TEST", sourceId: "closed-period", lines }), /closed period/);
  assert.equal(state.entries.length, 0);
  assert.equal(state.sequences.size, 0);
});