import assert from "node:assert/strict";
import test from "node:test";
import { getRealtimeFinancialStatements } from "../controllers/accountingController.js";
import { prisma } from "../config/db.js";

const replaceMethod = (t, target, key, implementation) => {
  const original = target[key];
  target[key] = implementation;
  t.after(() => {
    target[key] = original;
  });
};

const runReport = async (t, query, lines = []) => {
  const accounts = [
    { id: "cash", accountCode: "1110", accountType: "ASSET", normalBalance: "DEBIT" },
    { id: "sales", accountCode: "4100", accountType: "REVENUE", normalBalance: "CREDIT" },
  ];
  let journalQuery;
  let response;
  let statusCode = 200;

  replaceMethod(t, prisma.account, "findMany", async () => accounts);
  replaceMethod(t, prisma.journalLine, "findMany", async (args) => {
    journalQuery = args;
    const filter = args.where.journalEntry.transactionDate;
    const boundary = filter.lt || filter.lte;
    return lines.filter((line) => {
      const date = line.journalEntry.transactionDate;
      return filter.lt ? date < boundary : date <= boundary;
    });
  });
  replaceMethod(t, prisma.nepaliCalendarYear, "findMany", async () => []);
  replaceMethod(t, prisma.accountingEvent, "groupBy", async () => []);
  replaceMethod(t, prisma.accountingEvent, "findMany", async () => []);

  await getRealtimeFinancialStatements(
    { query },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        response = payload;
      },
    },
  );

  return { journalQuery, response, statusCode };
};

const cashReceipt = (id, transactionDate, amount) => [
  {
    id: `${id}-cash`,
    journalEntryId: id,
    accountId: "cash",
    account: { accountCode: "1110", accountType: "ASSET", normalBalance: "DEBIT" },
    debit: amount,
    credit: "0",
    journalEntry: { id, transactionDate, sourceType: "TEST" },
  },
  {
    id: `${id}-sales`,
    journalEntryId: id,
    accountId: "sales",
    account: { accountCode: "4100", accountType: "REVENUE", normalBalance: "CREDIT" },
    debit: "0",
    credit: amount,
    journalEntry: { id, transactionDate, sourceType: "TEST" },
  },
];

test("realtime balance sheet includes distributor COD receivables and distributor payables", async (t) => {
  const accounts = [
    { id: "account-1190", accountCode: "1190", accountType: "ASSET", normalBalance: "DEBIT" },
    { id: "account-2190", accountCode: "2190", accountType: "LIABILITY", normalBalance: "CREDIT" },
    { id: "account-4100", accountCode: "4100", accountType: "REVENUE", normalBalance: "CREDIT" },
    { id: "account-2120", accountCode: "2120", accountType: "LIABILITY", normalBalance: "CREDIT" },
    { id: "account-6430", accountCode: "6430", accountType: "EXPENSE", normalBalance: "DEBIT" },
  ];
  const transactionDate = new Date("2026-10-30T12:00:00.000Z");
  const entries = [
    { accountCode: "1190", debit: "1500", credit: "0" },
    { accountCode: "4100", debit: "0", credit: "1327.43" },
    { accountCode: "2120", debit: "0", credit: "172.57" },
    { accountCode: "6430", debit: "350", credit: "0" },
    { accountCode: "2190", debit: "0", credit: "350" },
  ];
  const lines = entries.map((entry) => {
    const account = accounts.find((item) => item.accountCode === entry.accountCode);
    return {
      accountId: account.id,
      account,
      debit: entry.debit,
      credit: entry.credit,
      journalEntry: { transactionDate, sourceType: "TEST" },
    };
  });

  replaceMethod(t, prisma.account, "findMany", async () => accounts);
  replaceMethod(t, prisma.journalLine, "findMany", async () => lines);
  replaceMethod(t, prisma.nepaliCalendarYear, "findMany", async () => []);
  replaceMethod(t, prisma.accountingEvent, "groupBy", async () => []);
  replaceMethod(t, prisma.accountingEvent, "findMany", async () => []);

  let response;
  await getRealtimeFinancialStatements(
    { query: { startDate: "2026-10-30", endDate: "2026-10-30" } },
    { json: (payload) => { response = payload; } },
  );

  assert.equal(response.success, true);
  assert.equal(response.reportBasis.classification, "POSTED_JOURNAL_LEDGER");
  assert.deepEqual(response.reportBasis.includedJournalStatuses, ["POSTED", "REVERSED"]);
  assert.equal(response.reportBasis.sourceCompleteness, "NOT_ESTABLISHED");
  assert.equal(response.balanceSheet.assets.currentAssets.distributorCodReceivable, "1500");
  assert.equal(response.balanceSheet.assets.currentAssets.totalCurrentAssets, "1500");
  assert.equal(response.balanceSheet.liabilities.currentLiabilities.distributorPayable, "350");
  assert.equal(response.balanceSheet.liabilities.currentLiabilities.totalCurrentLiabilities, "522.57");
  assert.equal(response.balanceSheet.assets.totalAssets, "1500");
  assert.equal(response.balanceSheet.totalLiabilitiesAndEquity, "1500");
  assert.equal(response.balanceSheet.isBalanceSheetBalanced, true);
  assert.equal(response.cashFlowStatement.basis, "POSTED_GL_CASH_EQUIVALENTS");
  assert.equal(response.cashFlowStatement.isReconciled, true);
  assert.equal(response.cashFlowStatement.netCashFlow, "0.00");
});

test("date-only report bounds use Kathmandu local days and exclude next-day midnight", async (t) => {
  const lines = [
    ...cashReceipt("before", new Date("2026-04-14T18:14:59.999Z"), "10"),
    ...cashReceipt("start", new Date("2026-04-14T18:15:00.000Z"), "20"),
    ...cashReceipt("last-instant", new Date("2026-04-15T18:14:59.999Z"), "30"),
    ...cashReceipt("next-midnight", new Date("2026-04-15T18:15:00.000Z"), "40"),
  ];
  const { journalQuery, response } = await runReport(
    t,
    { startDate: "2026-04-15", endDate: "2026-04-15", calendar: "AD" },
    lines,
  );

  assert.equal(response.success, true);
  assert.equal(journalQuery.where.journalEntry.transactionDate.lt.toISOString(), "2026-04-15T18:15:00.000Z");
  assert.equal(journalQuery.where.journalEntry.transactionDate.lte, undefined);
  assert.equal(response.cashFlowStatement.beginningCash, "10.00");
  assert.equal(response.cashFlowStatement.details.cashReceivedFromCustomers, "50.00");
  assert.equal(response.cashFlowStatement.endingCash, "60.00");
});

test("explicit report timestamps retain their instants", async (t) => {
  const start = "2026-04-15T00:00:00.001+05:45";
  const end = "2026-04-15T00:00:00.789+05:45";
  const lines = [
    ...cashReceipt("before-start", new Date("2026-04-14T18:15:00.000Z"), "10"),
    ...cashReceipt("at-start", new Date("2026-04-14T18:15:00.001Z"), "20"),
    ...cashReceipt("at-end", new Date("2026-04-14T18:15:00.789Z"), "30"),
    ...cashReceipt("after-end", new Date("2026-04-14T18:15:00.790Z"), "40"),
  ];
  const { journalQuery, response } = await runReport(t, { startDate: start, endDate: end }, lines);

  assert.equal(response.success, true);
  assert.equal(journalQuery.where.journalEntry.transactionDate.lte.toISOString(), "2026-04-14T18:15:00.789Z");
  assert.equal(journalQuery.where.journalEntry.transactionDate.lt, undefined);
  assert.equal(response.cashFlowStatement.beginningCash, "10.00");
  assert.equal(response.cashFlowStatement.details.cashReceivedFromCustomers, "50.00");
});

test("posted-ledger statement totals and balance checks use exact Decimal amounts", async (t) => {
  const { response } = await runReport(
    t,
    { startDate: "2026-04-15", endDate: "2026-04-15", calendar: "AD" },
    [
      ...cashReceipt("fractional-one", new Date("2026-04-15T00:00:00.000Z"), "0.10"),
      ...cashReceipt("fractional-two", new Date("2026-04-15T00:00:00.000Z"), "0.20"),
    ],
  );

  assert.equal(response.success, true);
  assert.equal(response.incomeStatement.revenue.grossSales, "0.3");
  assert.equal(response.incomeStatement.revenue.netRevenue, "0.3");
  assert.equal(response.balanceSheet.assets.totalAssets, "0.3");
  assert.equal(response.balanceSheet.equity.currentFiscalYearNetProfit, "0.3");
  assert.equal(response.balanceSheet.isBalanceSheetBalanced, true);
});

test("reversed timestamp ranges are rejected", async (t) => {
  replaceMethod(t, console, "error", () => {});
  const reversed = await runReport(t, {
    startDate: "2026-04-15T00:00:00.789+05:45",
    endDate: "2026-04-15T00:00:00.001+05:45",
  });
  assert.equal(reversed.statusCode, 400);
  assert.equal(reversed.response.success, false);
});
