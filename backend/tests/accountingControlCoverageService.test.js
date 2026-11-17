import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountingControlCoverage } from "../services/accountingControlCoverageService.js";

test("control coverage explicitly lists operational, legacy, treasury-only, and unreconciled controls", () => {
  const result = buildAccountingControlCoverage({
    accounts: [
      { id: "ncm", accountCode: "1170", currentBalance: "150.00" },
      { id: "ar", accountCode: "1130", currentBalance: "50.00" },
      { id: "cash", accountCode: "1110", currentBalance: "25.00" },
      { id: "inventory", accountCode: "1140", currentBalance: "300.00" },
      { id: "marketing-partner-ap", accountCode: "2170", currentBalance: "75.00" },
      { id: "fixed-assets", accountCode: "1510", currentBalance: "0.00" },
    ],
  });

  assert.equal(result.coverageStatus, "PARTIAL");
  assert.equal(result.controlAccountCount, 23);
  assert.equal(result.unreconciledCount, result.controlAccountCount);
  assert.equal(result.controls.find((row) => row.accountCode === "1170").status, "SOURCE_SCOPED");
  assert.equal(result.controls.find((row) => row.accountCode === "1130").status, "LEGACY_PARTIAL");
  assert.equal(result.controls.find((row) => row.accountCode === "1110").status, "TREASURY_REGISTER_ONLY");
  assert.equal(result.controls.find((row) => row.accountCode === "1140").status, "SOURCE_SCOPED");
  assert.equal(result.controls.find((row) => row.accountCode === "1510").status, "SOURCE_SCOPED");
  assert.equal(result.controls.find((row) => row.accountCode === "2170").status, "NOT_RECONCILED");
  assert.match(result.controls.find((row) => row.accountCode === "2170").gap, /full control balance remain unreconciled/);
  assert.equal(result.controls.find((row) => row.accountCode === "1170").glBalance, 150);
});

test("missing configured control accounts are surfaced and never count as reconciled", () => {
  const result = buildAccountingControlCoverage();

  assert.equal(result.coverageStatus, "PARTIAL");
  assert.ok(result.controls.every((row) => row.status === "ACCOUNT_MISSING"));
  assert.ok(result.controls.every((row) => row.accountExists === false));
});
