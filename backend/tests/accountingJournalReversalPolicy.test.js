import assert from "node:assert/strict";
import test from "node:test";
import { assertManualJournalReversible } from "../services/accountingPostingEngine.js";

test("manual journals are eligible for the generic journal reversal workflow", () => {
  assert.doesNotThrow(() => assertManualJournalReversible({ sourceType: "MANUAL_JOURNAL" }));
});

test("source-backed journals require their originating correction workflow", () => {
  for (const sourceType of ["DELIVERED_SALE", "NCM_SETTLEMENT", "CUSTOMER_RETURN", "EXPENSE_PAYMENT"]) {
    assert.throws(
      () => assertManualJournalReversible({ sourceType }),
      (error) => error.code === "SOURCE_JOURNAL_REVERSAL_FORBIDDEN" && error.statusCode === 409
    );
  }
});
