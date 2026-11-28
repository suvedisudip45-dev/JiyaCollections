import assert from "node:assert/strict";
import test from "node:test";
import { buildNcmCarrierFeeReconciliation } from "../services/ncmCarrierFeeReconciliationService.js";

test("NCM carrier fee reconciliation matches accrual, bill, allocation, and remittance payable debit", () => {
  const result = buildNcmCarrierFeeReconciliation({
    accrualJournalLines: [{
      debit: "0.00",
      credit: "42.00",
      journalEntry: { sourceType: "NCM_CARRIER_FEE_ACCRUAL", sourceId: "batch-hash-1" },
    }],
    documents: [{
      side: "PAYABLE",
      sourceType: "NCM_CARRIER_FEE",
      sourceId: "batch-hash-1",
      originalAmount: "42.00",
      remainingAmount: "0.00",
      allocations: [{ amount: "42.00", journalEntryId: "remittance-journal-1" }],
    }],
    settlementJournalLines: [{
      debit: "42.00",
      credit: "0.00",
      journalEntry: {
        id: "remittance-journal-1",
        sourceType: "PAYMENT",
        sourceId: "NCM-REMIT-batch-hash-1",
      },
    }],
  });

  assert.equal(result.coverageStatus, "SOURCE_SCOPED");
  assert.equal(result.isReconciled, true);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.accrualPayable, 42);
  assert.equal(result.documentOriginal, 42);
  assert.equal(result.allocationAmount, 42);
  assert.equal(result.settlementJournalDebit, 42);
  assert.equal(result.documentOutstanding, 0);
  assert.equal(result.sources[0].status, "MATCH");
});

test("NCM carrier fee reconciliation flags missing documents and unapplied payable balances", () => {
  const result = buildNcmCarrierFeeReconciliation({
    accrualJournalLines: [{
      debit: "0",
      credit: "60",
      journalEntry: { sourceType: "NCM_CARRIER_FEE_ACCRUAL", sourceId: "batch-without-bill" },
    }],
    documents: [{
      side: "PAYABLE",
      sourceType: "NCM_CARRIER_FEE",
      sourceId: "partially-open-batch",
      originalAmount: "50",
      remainingAmount: "20",
      allocations: [{ amount: "30", journalEntryId: "partial-remittance" }],
    }],
    settlementJournalLines: [{
      debit: "30",
      credit: "0",
      journalEntry: {
        id: "partial-remittance",
        sourceType: "PAYMENT",
        sourceId: "NCM-REMIT-partially-open-batch",
      },
    }],
  });

  assert.equal(result.isReconciled, false);
  assert.equal(result.unmatchedCount, 2);
  assert.ok(result.sources.every((row) => row.status === "REVIEW"));
});

test("NCM carrier fee reconciliation detects settlement journals that do not clear allocated 2180", () => {
  const result = buildNcmCarrierFeeReconciliation({
    accrualJournalLines: [{
      debit: "0",
      credit: "42",
      journalEntry: { sourceType: "NCM_CARRIER_FEE_ACCRUAL", sourceId: "batch-1" },
    }],
    documents: [{
      side: "PAYABLE",
      sourceType: "NCM_CARRIER_FEE",
      sourceId: "batch-1",
      originalAmount: "42",
      remainingAmount: "0",
      allocations: [{ amount: "42", journalEntryId: "wrong-entry" }],
    }],
    settlementJournalLines: [{
      debit: "0",
      credit: "42",
      journalEntry: { id: "wrong-entry", sourceType: "PAYMENT", sourceId: "NCM-REMIT-batch-1" },
    }],
  });

  assert.equal(result.isReconciled, false);
  assert.equal(result.sources[0].allocationToSettlementVariance, -84);
  assert.equal(result.sources[0].status, "REVIEW");
});

test("NCM carrier fee reconciliation does not mark an empty population reconciled", () => {
  const result = buildNcmCarrierFeeReconciliation();

  assert.equal(result.sourceCount, 0);
  assert.equal(result.isReconciled, false);
});
