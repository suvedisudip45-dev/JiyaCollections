import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomerReceiptReconciliation,
  getCustomerReceiptReconciliation,
} from "../services/customerReceiptReconciliationService.js";

const receipt = (overrides = {}) => ({
  id: "receipt-1",
  idempotencyKey: "receipt-key-1",
  date: new Date("2026-11-16T04:00:00.000Z"),
  amount: "100.00",
  settlementAmount: "90.00",
  currency: "NPR",
  tenderMethod: "BANK_TRANSFER",
  externalPaymentReference: "BANK-REF-1",
  toAccount: {
    id: "treasury-1",
    accountName: "Operating Bank",
    currency: "NPR",
    accountingAccountId: "gl-bank",
  },
  receiptAllocations: [{
    id: "allocation-1",
    cashTransactionId: "receipt-1",
    journalEntryId: "journal-1",
    allocationType: "CASH",
    documentId: "invoice-1",
    amount: "90.00",
    document: {
      id: "invoice-1",
      documentType: "INVOICE",
      documentNumber: "INV-1",
      side: "RECEIVABLE",
      sourceType: "DIRECT_ORDER_RECEIVABLE",
      sourceId: "order-1",
      partyId: "customer-1",
      currency: "NPR",
      originalAmount: "90.00",
      allocatedAmount: "90.00",
      remainingAmount: "0.00",
      status: "PAID",
      party: { partyType: "CUSTOMER" },
    },
  }],
  ...overrides,
});

const journal = (overrides = {}) => ({
  id: "journal-1",
  sourceId: "receipt-1",
  sourceType: "CUSTOMER_PAYMENT",
  idempotencyKey: "CUSTOMER_PAYMENT:receipt-key-1",
  status: "POSTED",
  totalDebit: "100.00",
  totalCredit: "100.00",
  lines: [
    { accountId: "gl-bank", debit: "100.00", credit: "0.00", accountingPartyId: null, account: { accountCode: "1110" } },
    { accountId: "gl-ar", debit: "0.00", credit: "90.00", accountingPartyId: "customer-1", account: { accountCode: "1130" } },
    { accountId: "gl-discount", debit: "0.00", credit: "10.00", accountingPartyId: null, account: { accountCode: "5200" } },
  ],
  ...overrides,
});

test("receipt reconciliation reports internal source links without claiming bank verification", () => {
  const report = buildCustomerReceiptReconciliation({
    receipts: [receipt()],
    journals: [journal()],
  });

  assert.equal(report.summary.receiptCount, 1);
  assert.equal(report.summary.exceptionCount, 0);
  assert.equal(report.summary.bankSettlementVerifiedCount, 0);
  assert.equal(report.receipts[0].internalStatus, "INTERNAL_SOURCE_LINKS_MATCH");
  assert.equal(report.receipts[0].bankStatementStatus, "NOT_AVAILABLE");
  assert.equal(report.receipts[0].evidenceReferenceStatus, "USER_SUPPLIED_UNVERIFIED");
  assert.equal(report.receipts[0].amount, "100.00");
  assert.equal(report.receipts[0].settlementAmount, "90.00");
  assert.ok(report.limitations.some((limitation) => limitation.includes("not independent proof")));
});

test("receipt reconciliation queries a bounded repeatable-read page without a live database", async () => {
  let receiptQuery;
  const tx = {
    cashTransaction: {
      async findMany(args) {
        if (args.include) {
          receiptQuery = args;
          return [receipt()];
        }
        return [{ id: "receipt-1", externalPaymentReference: "BANK-REF-1" }];
      },
      async count() {
        return 4;
      },
    },
    journalEntry: {
      async findMany(args) {
        return args.where.sourceType === "CUSTOMER_PAYMENT" ? [journal()] : [];
      },
    },
    settlementReversion: { async findMany() { return []; } },
    financialPayout: { async findMany() { return []; } },
    accountingAllocation: { async findMany() { return []; } },
  };
  const client = {
    async $transaction(callback, options) {
      assert.equal(options.isolationLevel, "RepeatableRead");
      return callback(tx);
    },
  };

  const report = await getCustomerReceiptReconciliation({
    client,
    query: { page: "2", limit: "2" },
  });

  assert.equal(receiptQuery.skip, 2);
  assert.equal(receiptQuery.take, 2);
  assert.equal(report.pagination.total, 4);
  assert.equal(report.pagination.totalPages, 2);
  assert.equal(report.receipts[0].internalStatus, "INTERNAL_SOURCE_LINKS_MATCH");
});

test("receipt reconciliation flags missing evidence, allocation mismatch, and journal variance", () => {
  const report = buildCustomerReceiptReconciliation({
    receipts: [receipt({
      externalPaymentReference: null,
      receiptAllocations: [{
        ...receipt().receiptAllocations[0],
        amount: "89.99",
      }],
    })],
    journals: [journal({
      totalCredit: "99.99",
      lines: journal().lines.map((line) => line.accountId === "gl-bank"
        ? { ...line, debit: "99.99" }
        : line),
    })],
  });

  assert.equal(report.summary.exceptionCount, 1);
  assert.ok(report.receipts[0].issueCodes.includes("EVIDENCE_REFERENCE_MISSING"));
  assert.ok(report.receipts[0].issueCodes.includes("ALLOCATION_SETTLEMENT_MISMATCH"));
  assert.ok(report.receipts[0].issueCodes.includes("SOURCE_JOURNAL_UNBALANCED"));
  assert.ok(report.receipts[0].issueCodes.includes("TREASURY_JOURNAL_AMOUNT_MISMATCH"));
});

test("receipt reconciliation flags a supplied reference reused by another stored transaction", () => {
  const report = buildCustomerReceiptReconciliation({
    receipts: [receipt()],
    journals: [journal()],
    duplicateEvidenceReferences: ["BANK-REF-1"],
  });

  assert.ok(report.receipts[0].issueCodes.includes("DUPLICATE_EVIDENCE_REFERENCE"));
});

test("receipt reconciliation flags an active receipt missing from the invoice balance", () => {
  const sourceReceipt = receipt();
  sourceReceipt.receiptAllocations[0].document = {
    ...sourceReceipt.receiptAllocations[0].document,
    allocatedAmount: "0.00",
    remainingAmount: "90.00",
    status: "OPEN",
  };
  const report = buildCustomerReceiptReconciliation({
    receipts: [sourceReceipt],
    journals: [journal()],
  });

  assert.ok(report.receipts[0].issueCodes.includes("INVOICE_BALANCE_MISMATCH"));
});

test("receipt reconciliation recognizes only a linked internal reversal and still marks bank settlement unavailable", () => {
  const reversedReceipt = receipt();
  reversedReceipt.receiptAllocations[0].document = {
    ...reversedReceipt.receiptAllocations[0].document,
    allocatedAmount: "0.00",
    remainingAmount: "90.00",
    status: "OPEN",
  };
  const report = buildCustomerReceiptReconciliation({
    receipts: [reversedReceipt],
    journals: [journal({ status: "REVERSED", reversedEntryId: "journal-reversal-1" })],
    reversions: [{
      originalRecordId: "receipt-1",
      cashTransactionId: "receipt-1",
      reversalTransactionId: "refund-1",
      reversalJournalEntryId: "journal-reversal-1",
      originalAmount: "100.00",
    }],
    reversalTransactions: [{
      id: "refund-1",
      type: "OUTFLOW",
      category: "REFUND",
      referenceId: "receipt-1",
      amount: "100.00",
      settlementAmount: "90.00",
      currency: "NPR",
      fromAccountId: "treasury-1",
    }],
    reversalJournals: [{
      id: "journal-reversal-1",
      status: "POSTED",
      sourceType: "REVERSAL",
      sourceId: "REV-journal-1",
      lines: [
        { debit: "100.00", credit: "0.00" },
        { debit: "0.00", credit: "100.00" },
      ],
    }],
    reversalAllocations: [{
      reversesAllocationId: "allocation-1",
      allocationType: "REVERSAL",
      documentId: "invoice-1",
      cashTransactionId: "refund-1",
      journalEntryId: "journal-reversal-1",
      amount: "90.00",
    }],
  });

  assert.equal(report.receipts[0].receiptStatus, "REVERSED");
  assert.equal(report.receipts[0].internalStatus, "INTERNAL_SOURCE_LINKS_MATCH");
  assert.equal(report.receipts[0].bankStatementStatus, "NOT_AVAILABLE");
});
