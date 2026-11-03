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
      line("5100", "DEBIT", 0, "180.00", "2026-10-15T10:00:00.000Z", "DISTRIBUTOR_RETURN_INVENTORY"),
      line("5500", "DEBIT", "80.00", 0, "2026-10-15T10:00:00.000Z", "DISTRIBUTOR_RETURN_INVENTORY"),
      line("1140", "DEBIT", "100.00", 0, "2026-10-15T10:00:00.000Z", "DISTRIBUTOR_RETURN_INVENTORY"),
      line("6430", "DEBIT", "1200.00", 0, "2026-10-06T10:00:00.000Z"),
      line("6430", "DEBIT", "250.00", 0, "2026-10-06T10:00:00.000Z", "DELIVERY_SALE"),
      line("6440", "DEBIT", "80.00", 0, "2026-10-06T10:00:00.000Z", "DISTRIBUTOR_SERVICE_EARNING"),
      line("2120", "CREDIT", 0, "276.11", "2026-10-05T10:00:00.000Z"),
      line("1150", "DEBIT", "50.00", 0, "2026-10-05T10:00:00.000Z"),
      line("2120", "DEBIT", "25.00", 0, "2026-10-20T10:00:00.000Z", "VAT_RETURN_NETTING"),
      line("1150", "CREDIT", 0, "25.00", "2026-10-20T10:00:00.000Z", "VAT_RETURN_NETTING"),
      line("2120", "DEBIT", "30.00", 0, "2026-10-22T10:00:00.000Z", "VAT_RETURN_PAYMENT"),
      line("2120", "DEBIT", "5.00", 0, "2026-10-23T10:00:00.000Z", "VAT_PAYMENT_CREDIT_APPLIED"),
      line("2120", "CREDIT", 0, "7.00", "2026-10-24T10:00:00.000Z", "VAT_ASSESSMENT_ADJUSTMENT"),
      line("1150", "DEBIT", "20.00", 0, "2026-09-20T10:00:00.000Z"),
      line("2120", "DEBIT", "10.00", 0, "2026-09-20T10:00:00.000Z"),
      line("1140", "DEBIT", "15200.00", 0, "2026-09-01T10:00:00.000Z"),
      line("2160", "CREDIT", 0, "17200.00", "2026-09-01T10:00:00.000Z"),
      line("1190", "DEBIT", "1500.00", 0, "2026-10-07T10:00:00.000Z"),
      line("2190", "CREDIT", 0, "600.00", "2026-10-07T10:00:00.000Z"),
    ],
  });

  assert.equal(snapshot.basis, "POSTED_JOURNALS");
  assert.equal(snapshot.incomeStatement.netRevenue, 2400);
  assert.equal(snapshot.incomeStatement.totalCogs, 700);
  assert.equal(snapshot.incomeStatement.totalOperatingExpenses, 1280);
  assert.equal(snapshot.vat.outputVat, 276.11);
  assert.equal(snapshot.vat.inputVat, 50);
  assert.equal(snapshot.vat.carriedForwardInputVat, 20);
  assert.equal(snapshot.vat.carriedForwardOutputVat, 0);
  assert.equal(snapshot.vat.netVatPayable, 206.11);
  assert.equal(snapshot.balanceSheet.totalAssets, 16845);
  assert.equal(snapshot.balanceSheet.totalLiabilities, 18013.11);
  assert.equal(snapshot.balanceSheet.inventory, 15300);
  assert.equal(snapshot.balanceSheet.distributorCodReceivable, 1500);
  assert.equal(snapshot.balanceSheet.manufacturerPayable, 17200);
  assert.equal(snapshot.balanceSheet.distributorPayable, 600);
  assert.equal(snapshot.periodAccounts["4100"].balance, 2400);
  assert.equal(snapshot.periodAccounts["5500"].balance, 80);
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
