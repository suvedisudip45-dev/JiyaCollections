import assert from "node:assert/strict";
import test from "node:test";
import {
  BALANCE_REPORT_JOURNAL_STATUSES,
  buildGeneralLedgerBalanceReconciliation,
} from "../services/accountingLedgerIntegrityService.js";

test("journal-derived balance reconciliation compares every GL account using its normal balance", () => {
  const result = buildGeneralLedgerBalanceReconciliation({
    accounts: [
      { id: "cash", accountCode: "1120", accountName: "Cash", normalBalance: "DEBIT", currentBalance: "125.00" },
      { id: "revenue", accountCode: "4100", accountName: "Revenue", normalBalance: "CREDIT", currentBalance: "250.00" },
      { id: "opening", accountCode: "3100", accountName: "Opening Balance", normalBalance: "CREDIT", currentBalance: "10.00" },
    ],
    journalLineGroups: [
      { accountId: "cash", _sum: { debit: "150.00", credit: "25.00" } },
      { accountId: "revenue", _sum: { debit: "0.00", credit: "250.00" } },
    ],
  });

  assert.equal(result.coverageStatus, "ALL_GL_ACCOUNTS");
  assert.equal(result.accountCount, 3);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.isReconciled, false);
  assert.equal(result.accounts[0].variance, 0);
  assert.equal(result.accounts[1].variance, 0);
  assert.equal(result.accounts[2].journalDerivedBalance, 0);
  assert.equal(result.accounts[2].variance, 10);
  assert.match(result.coverageNote, /Opening balances must be represented by posted journals/);
});

test("balance reports include original reversed journals and their reversal entries", () => {
  assert.deepEqual(BALANCE_REPORT_JOURNAL_STATUSES, ["POSTED", "REVERSED"]);
});

test("invalid account normal balances remain unresolved", () => {
  const result = buildGeneralLedgerBalanceReconciliation({
    accounts: [{ id: "unknown", normalBalance: "UNKNOWN", currentBalance: 0 }],
  });

  assert.equal(result.isReconciled, false);
  assert.equal(result.accounts[0].journalDerivedBalance, null);
  assert.equal(result.accounts[0].variance, null);
});
