import assert from "node:assert/strict";
import test from "node:test";
import { buildPostedFinanceSnapshot, getPostedFinanceSnapshot } from "../services/accountingReportingService.js";

const line = (accountCode, normalBalance, debit, credit, transactionDate, sourceType = "TEST") => ({
  debit,
  credit,
  account: { accountCode, accountName: accountCode, accountType: "EXPENSE", normalBalance },
  journalEntry: { transactionDate: new Date(transactionDate), sourceType, status: "POSTED" },
});

test("posted finance snapshot uses period journals and cumulative closing balances", () => {
  const snapshot = buildPostedFinanceSnapshot({
    startDate: "2026-10-01T00:00:00.000Z",
    endDate: "2026-10-31T23:59:59.999Z",
    lines: [
      line("4100", "CREDIT", 0, "1000.00", "2026-09-30T10:00:00.000Z"),
      line("4100", "CREDIT", 0, "2400.00", "2026-10-05T10:00:00.000Z"),
      line("5100", "DEBIT", "800.00", 0, "2026-10-05T10:00:00.000Z"),
      line("6430", "DEBIT", "1200.00", 0, "2026-10-06T10:00:00.000Z"),
      line("6430", "DEBIT", "250.00", 0, "2026-10-06T10:00:00.000Z", "DELIVERY_SALE"),
      line("6440", "DEBIT", "80.00", 0, "2026-10-06T10:00:00.000Z", "DISTRIBUTOR_SERVICE_EARNING"),
      line("2120", "CREDIT", 0, "276.11", "2026-10-05T10:00:00.000Z"),
      line("1150", "DEBIT", "50.00", 0, "2026-10-05T10:00:00.000Z"),
      line("1140", "DEBIT", "15200.00", 0, "2026-09-01T10:00:00.000Z"),
      line("2160", "CREDIT", 0, "17200.00", "2026-09-01T10:00:00.000Z"),
      line("1190", "DEBIT", "1500.00", 0, "2026-10-07T10:00:00.000Z"),
      line("2190", "CREDIT", 0, "600.00", "2026-10-07T10:00:00.000Z"),
    ],
  });

  assert.equal(snapshot.basis, "POSTED_JOURNALS");
  assert.equal(snapshot.incomeStatement.netRevenue, 2400);
  assert.equal(snapshot.incomeStatement.totalCogs, 800);
  assert.equal(snapshot.incomeStatement.totalOperatingExpenses, 1280);
  assert.equal(snapshot.vat.outputVat, 276.11);
  assert.equal(snapshot.vat.inputVat, 50);
  assert.equal(snapshot.vat.netVatPayable, 226.11);
  assert.equal(snapshot.balanceSheet.totalAssets, 16750);
  assert.equal(snapshot.balanceSheet.totalLiabilities, 18076.11);
  assert.equal(snapshot.balanceSheet.inventory, 15200);
  assert.equal(snapshot.balanceSheet.distributorCodReceivable, 1500);
  assert.equal(snapshot.balanceSheet.manufacturerPayable, 17200);
  assert.equal(snapshot.balanceSheet.distributorPayable, 600);
  assert.equal(snapshot.periodAccounts["4100"].balance, 2400);
  assert.equal(snapshot.closingAccounts["4100"].balance, 3400);
});

test("posted finance query restricts lines to posted journals through requested end date", async () => {
  let query;
  const client = {
    journalLine: {
      findMany: async (args) => {
        query = args;
        return [line("4100", "CREDIT", 0, "500.00", "2026-10-05T10:00:00.000Z")];
      },
    },
  };

  const snapshot = await getPostedFinanceSnapshot({
    startDate: "2026-10-01T00:00:00.000Z",
    endDate: "2026-10-31T23:59:59.999Z",
    client,
  });

  assert.equal(query.where.journalEntry.status, "POSTED");
  assert.equal(new Date(query.where.journalEntry.transactionDate.lte).toISOString(), "2026-10-31T23:59:59.999Z");
  assert.equal(snapshot.incomeStatement.netRevenue, 500);
});
