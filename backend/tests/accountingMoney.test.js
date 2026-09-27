import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBalancedJournalLines } from "../services/accountingMoney.js";

test("balanced journal amounts use decimal arithmetic and two-place rounding", () => {
  const result = normalizeBalancedJournalLines([
    { accountCode: "1000", debit: "0.10", credit: 0 },
    { accountCode: "4000", debit: 0, credit: "0.1" },
  ]);

  assert.equal(result.totalDebit.toFixed(2), "0.10");
  assert.equal(result.totalCredit.toFixed(2), "0.10");
  assert.equal(result.lines[0].debit.toFixed(2), "0.10");
});

test("journal amounts round half up to NPR paisa before balancing", () => {
  const result = normalizeBalancedJournalLines([
    { accountCode: "1000", debit: "1.005", credit: 0 },
    { accountCode: "4000", debit: 0, credit: "1.01" },
  ]);
  assert.equal(result.totalDebit.toFixed(2), "1.01");
  assert.equal(result.totalCredit.toFixed(2), "1.01");
});

test("unbalanced or negative journal lines are rejected", () => {
  assert.throws(() => normalizeBalancedJournalLines([
    { accountCode: "1000", debit: "1.01", credit: 0 },
    { accountCode: "4000", debit: 0, credit: "1.00" },
  ]), /Unbalanced Journal Entry/);
  assert.throws(() => normalizeBalancedJournalLines([
    { accountCode: "1000", debit: "-1", credit: 0 },
    { accountCode: "4000", debit: 0, credit: "1" },
  ]), /cannot be negative/);
  assert.throws(() => normalizeBalancedJournalLines([
    { accountCode: "1000", debit: 1, credit: 1 },
    { accountCode: "4000", debit: 0, credit: 2 },
  ]), /both debit and credit/);
});