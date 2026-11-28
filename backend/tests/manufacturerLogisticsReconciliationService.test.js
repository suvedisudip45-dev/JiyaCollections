import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManufacturerLogisticsReconciliation,
  buildManufacturerProductionReconciliation,
} from "../services/manufacturerLogisticsReconciliationService.js";

test("manufacturer logistics reconciliation matches shipment journals to payable documents", () => {
  const result = buildManufacturerLogisticsReconciliation({
    journalLines: [
      {
        debit: "0.00",
        credit: "120.00",
        supplierId: "manufacturer-1",
        accountingParty: { partyType: "MANUFACTURER", sourceEntityId: "manufacturer-1" },
        journalEntry: { sourceId: "shipment-1" },
      },
    ],
    documents: [
      {
        side: "PAYABLE",
        sourceId: "shipment-1",
        party: { partyType: "MANUFACTURER", sourceEntityId: "manufacturer-1" },
        originalAmount: "120.00",
        remainingAmount: "80.00",
      },
    ],
  });

  assert.equal(result.coverageStatus, "SOURCE_SCOPED");
  assert.equal(result.isReconciled, true);
  assert.equal(result.journalPayable, 120);
  assert.equal(result.documentOriginal, 120);
  assert.equal(result.documentOutstanding, 80);
  assert.equal(result.unmatchedCount, 0);
  assert.equal(result.sources[0].status, "MATCH");
});

test("manufacturer logistics reconciliation flags missing documents and amount mismatches", () => {
  const result = buildManufacturerLogisticsReconciliation({
    journalLines: [
      {
        debit: "0",
        credit: "100",
        supplierId: "manufacturer-1",
        journalEntry: { sourceId: "shipment-without-bill" },
      },
    ],
    documents: [
      {
        side: "PAYABLE",
        sourceId: "document-without-journal",
        party: { partyType: "MANUFACTURER", sourceEntityId: "manufacturer-1" },
        originalAmount: "50",
        remainingAmount: "50",
      },
    ],
  });

  assert.equal(result.isReconciled, false);
  assert.equal(result.unmatchedCount, 2);
  assert.equal(result.variance, -50);
  assert.ok(result.sources.every((row) => row.status === "REVIEW"));
});

test("manufacturer logistics reconciliation does not treat non-payable documents as payable support", () => {
  const result = buildManufacturerLogisticsReconciliation({
    documents: [{
      side: "RECEIVABLE",
      sourceId: "credit-note",
      party: { partyType: "MANUFACTURER", sourceEntityId: "manufacturer-1" },
      originalAmount: "25",
      remainingAmount: "25",
    }],
  });

  assert.equal(result.documentSourceCount, 1);
  assert.equal(result.documentOriginal, 0);
  assert.equal(result.unmatchedCount, 0);
  assert.equal(result.isReconciled, false);
  assert.equal(result.sourceCount, 0);
});

test("manufacturer payable reconciliation does not report an empty source population as reconciled", () => {
  const result = buildManufacturerProductionReconciliation();

  assert.equal(result.sourceCount, 0);
  assert.equal(result.isReconciled, false);
  assert.equal(result.unmatchedCount, 0);
});

test("manufacturer production reconciliation matches accepted-production journals to production bills", () => {
  const result = buildManufacturerProductionReconciliation({
    journalLines: [
      {
        debit: "0",
        credit: "113.00",
        supplierId: "manufacturer-1",
        accountingParty: { partyType: "MANUFACTURER", sourceEntityId: "manufacturer-1" },
        journalEntry: { sourceId: "production-request-1" },
      },
    ],
    documents: [
      {
        side: "PAYABLE",
        sourceId: "production-request-1",
        party: { partyType: "MANUFACTURER", sourceEntityId: "manufacturer-1" },
        originalAmount: "113.00",
        remainingAmount: "0.00",
      },
    ],
  });

  assert.equal(result.coverageStatus, "SOURCE_SCOPED");
  assert.equal(result.sourceType, "MANUFACTURER_PRODUCTION");
  assert.equal(result.isReconciled, true);
  assert.equal(result.journalPayable, 113);
  assert.equal(result.documentOriginal, 113);
  assert.equal(result.documentOutstanding, 0);
  assert.equal(result.sources[0].sourceId, "production-request-1");
});

test("manufacturer production reconciliation flags missing or mismatched production bills", () => {
  const result = buildManufacturerProductionReconciliation({
    journalLines: [{
      debit: "0",
      credit: "113",
      journalEntry: { sourceId: "production-request-without-bill" },
    }],
    documents: [{
      side: "PAYABLE",
      sourceId: "bill-without-production-journal",
      party: { partyType: "MANUFACTURER", sourceEntityId: "manufacturer-1" },
      originalAmount: "50",
      remainingAmount: "25",
    }],
  });

  assert.equal(result.isReconciled, false);
  assert.equal(result.unmatchedCount, 2);
  assert.equal(result.variance, -63);
  assert.ok(result.sources.every((row) => row.status === "REVIEW"));
  assert.match(result.coverageNote, /legacy delivery-accrued costs/);
});
