import assert from "node:assert/strict";
import test from "node:test";
import { buildCollaborationFeeReceivableReconciliation } from "../services/collaborationFeeReceivableReconciliationService.js";

const collaborationFeeCreditOffsetFixture = () => ({
  invoices: [
    { id: "credit-invoice", invoiceNumber: "CN-COL-1", status: "ISSUED", totalAmount: "-113.00" },
    { id: "target-invoice", invoiceNumber: "COL-2", status: "ISSUED", totalAmount: "200.00" },
  ],
  documents: [
    {
      id: "credit-document",
      documentType: "CREDIT_NOTE",
      side: "RECEIVABLE",
      sourceType: "COLLABORATION_FEE",
      sourceId: "credit-invoice",
      partyId: "partner-1",
      currency: "NPR",
      issueDate: new Date("2026-10-01T00:00:00.000Z"),
      status: "PARTIALLY_PAID",
      originalAmount: "113.00",
      allocatedAmount: "50.00",
      remainingAmount: "63.00",
    },
    {
      id: "target-document",
      documentType: "INVOICE",
      side: "RECEIVABLE",
      sourceType: "COLLABORATION_FEE",
      sourceId: "target-invoice",
      partyId: "partner-1",
      currency: "NPR",
      issueDate: new Date("2026-11-01T00:00:00.000Z"),
      status: "PARTIALLY_PAID",
      originalAmount: "200.00",
      allocatedAmount: "50.00",
      remainingAmount: "150.00",
    },
  ],
  journalLines: [
    { debit: "0.00", credit: "113.00", journalEntry: { sourceType: "COLLABORATION_FEE_INVOICE", sourceId: "credit-invoice" } },
    { debit: "200.00", credit: "0.00", journalEntry: { sourceType: "COLLABORATION_FEE_INVOICE", sourceId: "target-invoice" } },
  ],
  documentAllocations: [
    {
      documentId: "credit-document",
      journalEntryId: "credit-journal",
      allocationType: "OFFSET",
      idempotencyKey: "application-1:CREDIT",
      amount: "50.00",
    },
    {
      documentId: "target-document",
      journalEntryId: "credit-journal",
      allocationType: "OFFSET",
      idempotencyKey: "application-1:INVOICE",
      amount: "50.00",
    },
  ],
  allocations: [
    {
      documentId: "credit-document",
      journalEntryId: "credit-journal",
      allocationType: "OFFSET",
      idempotencyKey: "application-1:CREDIT",
      amount: "50.00",
    },
    {
      documentId: "target-document",
      journalEntryId: "credit-journal",
      allocationType: "OFFSET",
      idempotencyKey: "application-1:INVOICE",
      amount: "50.00",
    },
  ],
  collectionJournals: [{
    id: "credit-journal",
    status: "POSTED",
    sourceType: "COLLABORATION_FEE_INVOICE",
    sourceId: "credit-invoice",
    lines: [{ debit: "0.00", credit: "113.00" }],
  }],
  creditApplications: [{
    idempotencyKey: "application-1",
    creditDocumentId: "credit-document",
    invoiceDocumentId: "target-document",
    journalEntryId: "credit-journal",
    amount: "50.00",
  }],
});

test("collaboration fee reconciliation matches invoice, receivable document, and posted 1130 journal", () => {
  const result = buildCollaborationFeeReceivableReconciliation({
    invoices: [{
      id: "invoice-1",
      invoiceNumber: "COL-PARTNER-202610",
      status: "ISSUED",
      totalAmount: "113.00",
    }],
    documents: [{
      id: "document-1",
      side: "RECEIVABLE",
      sourceType: "COLLABORATION_FEE",
      sourceId: "invoice-1",
      originalAmount: "113.00",
      allocatedAmount: "38.00",
      remainingAmount: "75.00",
    }],
    journalLines: [{
      debit: "113.00",
      credit: "0.00",
      journalEntry: { sourceType: "COLLABORATION_FEE_INVOICE", sourceId: "invoice-1" },
    }],
    documentAllocations: [{ documentId: "document-1", journalEntryId: "receipt-1", amount: "38.00" }],
    allocations: [{ documentId: "document-1", journalEntryId: "receipt-1", amount: "38.00" }],
    collectionJournals: [{
      id: "receipt-1",
      status: "POSTED",
      lines: [{ debit: "0.00", credit: "38.00" }],
    }],
  });

  assert.equal(result.coverageStatus, "SOURCE_SCOPED");
  assert.equal(result.isReconciled, true);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.invoiceTotal, 113);
  assert.equal(result.documentOriginal, 113);
  assert.equal(result.documentAllocated, 38);
  assert.equal(result.documentOutstanding, 75);
  assert.equal(result.allocationAmount, 38);
  assert.equal(result.postedReceiptAllocationAmount, 38);
  assert.equal(result.collectionJournalCredit, 38);
  assert.equal(result.journalReceivable, 113);
  assert.equal(result.sources[0].status, "MATCH");
});

test("collaboration fee reconciliation validates paired credit offsets separately from cash receipts", () => {
  const result = buildCollaborationFeeReceivableReconciliation(collaborationFeeCreditOffsetFixture());

  assert.equal(result.isReconciled, true);
  assert.equal(result.offsetApplicationCount, 1);
  assert.equal(result.offsetApplicationAmount, 50);
  assert.equal(result.offsetApplicationInvalidCount, 0);
  assert.equal(result.postedReceiptAllocationAmount, 0);
  assert.equal(result.collectionJournalCredit, 0);
  assert.ok(result.sources.every((row) => row.isReconciled));
  assert.ok(result.sources.every((row) => row.offsetApplicationCount === 1));
});

test("collaboration fee reconciliation flags an unpaired credit offset", () => {
  const fixture = collaborationFeeCreditOffsetFixture();
  fixture.documentAllocations = fixture.documentAllocations.slice(0, 1);
  fixture.allocations = fixture.allocations.slice(0, 1);
  const result = buildCollaborationFeeReceivableReconciliation(fixture);

  assert.equal(result.isReconciled, false);
  assert.equal(result.offsetApplicationCount, 0);
  assert.equal(result.offsetApplicationInvalidCount, 1);
  assert.ok(result.sources.every((row) => row.status === "REVIEW"));
});

test("collaboration fee reconciliation flags offsets that disagree with the persisted application", () => {
  const fixture = collaborationFeeCreditOffsetFixture();
  fixture.creditApplications[0].amount = "45.00";
  const result = buildCollaborationFeeReceivableReconciliation(fixture);

  assert.equal(result.isReconciled, false);
  assert.equal(result.offsetApplicationCount, 0);
  assert.equal(result.offsetApplicationInvalidCount, 1);
  assert.ok(result.sources.every((row) => row.status === "REVIEW"));
});

test("collaboration fee reconciliation matches signed credit notes against negative invoices and receivables", () => {
  const result = buildCollaborationFeeReceivableReconciliation({
    invoices: [{
      id: "credit-invoice",
      invoiceNumber: "CN-COL-PARTNER-202610",
      status: "ISSUED",
      totalAmount: "-113.00",
    }],
    documents: [{
      id: "credit-document",
      documentType: "CREDIT_NOTE",
      side: "RECEIVABLE",
      sourceType: "COLLABORATION_FEE",
      sourceId: "credit-invoice",
      originalAmount: "113.00",
      allocatedAmount: "0.00",
      remainingAmount: "113.00",
    }],
    journalLines: [{
      debit: "0.00",
      credit: "113.00",
      journalEntry: { sourceType: "COLLABORATION_FEE_INVOICE", sourceId: "credit-invoice" },
    }],
  });

  assert.equal(result.isReconciled, true);
  assert.equal(result.invoiceTotal, -113);
  assert.equal(result.documentOriginal, -113);
  assert.equal(result.documentOutstanding, -113);
  assert.equal(result.journalReceivable, -113);
  assert.equal(result.sources[0].status, "MATCH");
});

test("collaboration fee reconciliation accepts a posted zero-net adjustment without a journal or document", () => {
  const result = buildCollaborationFeeReceivableReconciliation({
    invoices: [{
      id: "zero-invoice",
      invoiceNumber: "COL-PARTNER-202610",
      status: "ISSUED",
      totalAmount: "0.00",
    }],
  });

  assert.equal(result.isReconciled, true);
  assert.equal(result.invoiceTotal, 0);
  assert.equal(result.documentOriginal, 0);
  assert.equal(result.journalReceivable, 0);
  assert.equal(result.sources[0].status, "MATCH");
});

test("collaboration fee reconciliation flags missing documents, journals, and amount mismatches", () => {
  const result = buildCollaborationFeeReceivableReconciliation({
    invoices: [
      { id: "without-document", invoiceNumber: "COL-1", status: "ISSUED", totalAmount: "80" },
      { id: "mismatch", invoiceNumber: "COL-2", status: "ISSUED", totalAmount: "100" },
    ],
    documents: [{
      side: "RECEIVABLE",
      sourceType: "COLLABORATION_FEE",
      sourceId: "mismatch",
      originalAmount: "90",
      allocatedAmount: "0",
      remainingAmount: "90",
    }],
    journalLines: [{
      debit: "90",
      credit: "0",
      journalEntry: { sourceType: "COLLABORATION_FEE_INVOICE", sourceId: "mismatch" },
    }],
  });

  assert.equal(result.isReconciled, false);
  assert.equal(result.unmatchedCount, 2);
  assert.equal(result.invoiceToDocumentVariance, -90);
  assert.equal(result.documentToJournalVariance, 0);
  assert.ok(result.sources.every((row) => row.status === "REVIEW"));
});

test("collaboration fee reconciliation requires an issued invoice and exactly one document", () => {
  const result = buildCollaborationFeeReceivableReconciliation({
    invoices: [{ id: "pending", invoiceNumber: "COL-PENDING", status: "PENDING_POSTING", totalAmount: "20" }],
    documents: [
      { side: "RECEIVABLE", sourceType: "COLLABORATION_FEE", sourceId: "pending", originalAmount: "20", remainingAmount: "20" },
      { side: "RECEIVABLE", sourceType: "COLLABORATION_FEE", sourceId: "pending", originalAmount: "20", remainingAmount: "20" },
    ],
    journalLines: [{
      debit: "20",
      credit: "0",
      journalEntry: { sourceType: "COLLABORATION_FEE_INVOICE", sourceId: "pending" },
    }],
  });

  assert.equal(result.unmatchedCount, 1);
  assert.equal(result.sources[0].status, "REVIEW");
});

test("collaboration fee reconciliation rejects allocations without a posted linked journal", () => {
  const result = buildCollaborationFeeReceivableReconciliation({
    invoices: [{ id: "invoice-1", invoiceNumber: "COL-1", status: "ISSUED", totalAmount: "100" }],
    documents: [{
      id: "document-1",
      side: "RECEIVABLE",
      sourceType: "COLLABORATION_FEE",
      sourceId: "invoice-1",
      originalAmount: "100",
      allocatedAmount: "40",
      remainingAmount: "60",
    }],
    journalLines: [{
      debit: "100",
      credit: "0",
      journalEntry: { sourceType: "COLLABORATION_FEE_INVOICE", sourceId: "invoice-1" },
    }],
    documentAllocations: [{ documentId: "document-1", journalEntryId: "missing-journal", amount: "40" }],
    allocations: [{ documentId: "document-1", journalEntryId: "missing-journal", amount: "40" }],
    collectionJournals: [],
  });

  assert.equal(result.isReconciled, false);
  assert.equal(result.sources[0].collectionJournalInvalidCount, 1);
  assert.equal(result.sources[0].status, "REVIEW");
});

test("collaboration fee reconciliation compares a shared receipt journal with all its allocations", () => {
  const result = buildCollaborationFeeReceivableReconciliation({
    invoices: [{ id: "invoice-1", invoiceNumber: "COL-1", status: "ISSUED", totalAmount: "100" }],
    documents: [{
      id: "document-1",
      side: "RECEIVABLE",
      sourceType: "COLLABORATION_FEE",
      sourceId: "invoice-1",
      originalAmount: "100",
      allocatedAmount: "40",
      remainingAmount: "60",
    }],
    journalLines: [{
      debit: "100",
      credit: "0",
      journalEntry: { sourceType: "COLLABORATION_FEE_INVOICE", sourceId: "invoice-1" },
    }],
    documentAllocations: [{ documentId: "document-1", journalEntryId: "receipt-1", amount: "40" }],
    allocations: [
      { documentId: "document-1", journalEntryId: "receipt-1", amount: "40" },
      { documentId: "other-document", journalEntryId: "receipt-1", amount: "20" },
    ],
    collectionJournals: [{
      id: "receipt-1",
      status: "POSTED",
      lines: [{ debit: "0", credit: "60" }],
    }],
  });

  assert.equal(result.isReconciled, true);
  assert.equal(result.sources[0].allocationAmount, 40);
  assert.equal(result.sources[0].postedReceiptAllocationAmount, 40);
  assert.equal(result.sources[0].collectionJournalVariance, 0);
});

test("collaboration fee reconciliation flags an allocation-to-journal amount mismatch", () => {
  const result = buildCollaborationFeeReceivableReconciliation({
    invoices: [{ id: "invoice-1", invoiceNumber: "COL-1", status: "ISSUED", totalAmount: "100" }],
    documents: [{
      id: "document-1",
      side: "RECEIVABLE",
      sourceType: "COLLABORATION_FEE",
      sourceId: "invoice-1",
      originalAmount: "100",
      allocatedAmount: "40",
      remainingAmount: "60",
    }],
    journalLines: [{
      debit: "100",
      credit: "0",
      journalEntry: { sourceType: "COLLABORATION_FEE_INVOICE", sourceId: "invoice-1" },
    }],
    documentAllocations: [{ documentId: "document-1", journalEntryId: "receipt-1", amount: "40" }],
    allocations: [{ documentId: "document-1", journalEntryId: "receipt-1", amount: "40" }],
    collectionJournals: [{
      id: "receipt-1",
      status: "POSTED",
      lines: [{ debit: "0", credit: "35" }],
    }],
  });

  assert.equal(result.isReconciled, false);
  assert.equal(result.sources[0].collectionJournalVariance, -5);
  assert.equal(result.sources[0].collectionJournalMismatchCount, 1);
});

test("collaboration fee reconciliation does not report an empty population as reconciled", () => {
  const result = buildCollaborationFeeReceivableReconciliation();

  assert.equal(result.sourceCount, 0);
  assert.equal(result.isReconciled, false);
});
