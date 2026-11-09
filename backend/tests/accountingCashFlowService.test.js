import assert from "node:assert/strict";
import test from "node:test";
import { buildDirectCashFlowStatement } from "../services/accountingCashFlowService.js";

const journal = (id, transactionDate, entries) => entries.map((entry) => ({
  journalEntryId: id,
  journalEntry: { transactionDate: new Date(transactionDate) },
  account: { accountCode: entry.code, accountType: entry.type || "ASSET" },
  debit: entry.debit || 0,
  credit: entry.credit || 0,
}));

test("direct cash flow classifies actual manufacturer payout and reconciles cash", () => {
  const journalLines = [
    ...journal("opening", "2025-12-31T00:00:00.000Z", [
      { code: "1110", debit: 1000 },
      { code: "3100", type: "EQUITY", credit: 1000 },
    ]),
    ...journal("customer-payment", "2026-01-10T00:00:00.000Z", [
      { code: "1120", debit: 500 },
      { code: "1130", credit: 500 },
    ]),
    ...journal("manufacturer-payout", "2026-01-15T00:00:00.000Z", [
      { code: "2160", type: "LIABILITY", debit: 250 },
      { code: "1120", credit: 250 },
    ]),
    ...journal("asset-purchase", "2026-01-18T00:00:00.000Z", [
      { code: "1510", debit: 100 },
      { code: "1120", credit: 100 },
    ]),
    ...journal("loan-disbursement", "2026-01-20T00:00:00.000Z", [
      { code: "1120", debit: 200 },
      { code: "2510", type: "LIABILITY", credit: 200 },
    ]),
    ...journal("cash-transfer", "2026-01-22T00:00:00.000Z", [
      { code: "1110", debit: 50 },
      { code: "1120", credit: 50 },
    ]),
  ];

  const statement = buildDirectCashFlowStatement({
    journalLines,
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-31T23:59:59.999Z",
  });

  assert.equal(statement.details.cashReceivedFromCustomers, 500);
  assert.equal(statement.details.supplierPayments, 250);
  assert.equal(statement.operatingActivities, 250);
  assert.equal(statement.details.investingOutflows, 100);
  assert.equal(statement.investingActivities, -100);
  assert.equal(statement.details.financingInflows, 200);
  assert.equal(statement.financingActivities, 200);
  assert.equal(statement.netCashFlow, 350);
  assert.equal(statement.beginningCash, 1000);
  assert.equal(statement.endingCash, 1350);
  assert.equal(statement.reconciliationDifference, 0);
  assert.equal(statement.isReconciled, true);
});

test("cash transfers between cash and bank are excluded from cash flows", () => {
  const statement = buildDirectCashFlowStatement({
    journalLines: journal("transfer", "2026-01-10T00:00:00.000Z", [
      { code: "1110", debit: 125 },
      { code: "1120", credit: 125 },
    ]),
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-31T23:59:59.999Z",
  });

  assert.equal(statement.netCashFlow, 0);
  assert.equal(statement.endingCash, 0);
  assert.equal(statement.isReconciled, true);
});

test("wallet payouts and gateway settlements reconcile across account 1180", () => {
  const journalLines = [
    ...journal("wallet-opening", "2025-12-31T00:00:00.000Z", [
      { code: "1180", debit: 400 },
      { code: "3100", type: "EQUITY", credit: 400 },
    ]),
    ...journal("wallet-payout", "2026-01-10T00:00:00.000Z", [
      { code: "2160", type: "LIABILITY", debit: 125 },
      { code: "1180", credit: 125 },
    ]),
    ...journal("gateway-settlement", "2026-01-12T00:00:00.000Z", [
      { code: "1120", debit: 75 },
      { code: "1180", credit: 75 },
    ]),
  ];

  const statement = buildDirectCashFlowStatement({
    journalLines,
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-31T23:59:59.999Z",
  });

  assert.equal(statement.details.supplierPayments, 125);
  assert.equal(statement.operatingActivities, -125);
  assert.equal(statement.netCashFlow, -125);
  assert.equal(statement.beginningCash, 400);
  assert.equal(statement.endingCash, 275);
  assert.equal(statement.reconciliationDifference, 0);
  assert.equal(statement.isReconciled, true);
  assert.deepEqual(statement.cashEquivalentAccountCodes, ["1110", "1120", "1180"]);
});
