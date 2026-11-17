import assert from "node:assert/strict";
import test from "node:test";
import {
  getGeneralLedgerReport,
  getTrialBalanceReport,
} from "../controllers/accountingController.js";
import { prisma } from "../config/db.js";

const replaceMethod = (t, target, key, implementation) => {
  const original = target[key];
  target[key] = implementation;
  t.after(() => {
    target[key] = original;
  });
};

const mockOutboxStatus = (t) => {
  replaceMethod(t, prisma.accountingEvent, "groupBy", async () => []);
  replaceMethod(t, prisma.accountingEvent, "findMany", async () => []);
};

test("general ledger calculations preserve exact decimal strings and Kathmandu date bounds", async (t) => {
  const account = {
    id: "cash",
    accountCode: "1110",
    normalBalance: "DEBIT",
  };
  const periodLines = [
    {
      id: "debit-line",
      debit: "0.10",
      credit: "0",
      journalEntry: {
        id: "debit-entry",
        transactionDate: new Date("2026-04-15T00:00:00.000Z"),
      },
    },
    {
      id: "credit-line",
      debit: "0",
      credit: "0.01",
      journalEntry: {
        id: "credit-entry",
        transactionDate: new Date("2026-04-15T01:00:00.000Z"),
      },
    },
  ];
  let periodQuery;
  let response;

  replaceMethod(t, prisma.account, "findUnique", async () => account);
  replaceMethod(t, prisma.journalLine, "findMany", async (args) => {
    const filter = args.where.journalEntry.transactionDate;
    if (filter.lt && !filter.gte) return [{ debit: "90071992547409.91", credit: "0" }];
    periodQuery = args;
    return periodLines;
  });
  mockOutboxStatus(t);

  await getGeneralLedgerReport(
    { params: { accountId: "cash" }, query: { startDate: "2026-04-15", endDate: "2026-04-15", calendar: "AD" } },
    { json: (payload) => { response = payload; } },
  );

  assert.equal(response.success, true);
  assert.equal(periodQuery.where.journalEntry.transactionDate.lt.toISOString(), "2026-04-15T18:15:00.000Z");
  assert.equal(periodQuery.where.journalEntry.transactionDate.lte, undefined);
  assert.equal(response.metrics.openingBalance, "90071992547409.91");
  assert.equal(response.metrics.totalPeriodDebit, "0.1");
  assert.equal(response.metrics.totalPeriodCredit, "0.01");
  assert.equal(response.metrics.closingBalance, "90071992547410");
  assert.equal(response.statementLines[0].runningBalance, "90071992547410.01");
  assert.equal(response.statementLines[1].runningBalance, "90071992547410");
});

test("trial balance uses exact Decimal totals without a balance tolerance", async (t) => {
  const account = {
    id: "cash",
    accountCode: "1110",
    accountName: "Cash",
    accountType: "ASSET",
    normalBalance: "DEBIT",
  };
  let periodQuery;
  let response;

  replaceMethod(t, prisma.account, "findMany", async () => [account]);
  replaceMethod(t, prisma.journalLine, "findMany", async (args) => {
    const filter = args.where.journalEntry.transactionDate;
    if (filter.lt && !filter.gte) return [{ debit: "0.10", credit: "0.01" }];
    periodQuery = args;
    return [{ debit: "0.20", credit: "0" }];
  });
  mockOutboxStatus(t);

  await getTrialBalanceReport(
    { query: { startDate: "2026-04-15", asOfDate: "2026-04-15", calendar: "AD" } },
    { json: (payload) => { response = payload; } },
  );

  assert.equal(response.success, true);
  assert.equal(periodQuery.where.journalEntry.transactionDate.lt.toISOString(), "2026-04-15T18:15:00.000Z");
  assert.equal(periodQuery.where.journalEntry.transactionDate.lte, undefined);
  assert.equal(response.rows[0].openingDebit, "0.09");
  assert.equal(response.rows[0].periodDebit, "0.2");
  assert.equal(response.rows[0].closingDebit, "0.29");
  assert.equal(response.totals.totalClosingDebit, "0.29");
  assert.equal(response.totals.totalClosingCredit, "0");
  assert.equal(response.isBalanced, false);
});
