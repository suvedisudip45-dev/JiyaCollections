import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { correctSettledTransaction } from "../services/settlementCorrectionService.js";

const makePayableClient = ({ payoutStatus = "SETTLED" } = {}) => {
  const payable = {
    id: "payable-1",
    title: "Test supplier bill",
    payeeName: "Supplier",
    referenceId: "invoice-1",
    totalAmount: 200,
    paidAmount: 100,
    remainingBalance: 50,
    status: "PARTIALLY_PAID",
    settlementHistory: [{
      idempotencyKey: "payout-key-1",
      amount: "100.00",
      settlementAmount: "150.00",
    }],
  };
  const cashTransaction = {
    id: "cash-1",
    idempotencyKey: "payout-key-1",
    type: "OUTFLOW",
    amount: 100,
    fromAccountId: "bank-1",
    referenceId: "payable-1",
  };
  const calls = { accountChanges: [], cashCreates: [], payableUpdates: [], payoutUpdates: [], reversionCreates: [], audits: [] };
  const tx = {
    accountPayable: {
      findUnique: async () => payable,
      updateMany: async (args) => {
        calls.payableUpdates.push(args);
        return { count: 1 };
      },
    },
    cashTransaction: {
      findUnique: async ({ where }) => where.idempotencyKey === cashTransaction.idempotencyKey ? cashTransaction : null,
      create: async ({ data }) => {
        calls.cashCreates.push(data);
        return { id: "cash-reversal-1", ...data };
      },
    },
    settlementReversion: {
      findFirst: async () => null,
      create: async ({ data }) => calls.reversionCreates.push(data),
    },
    journalEntry: {
      findFirst: async () => ({ id: "journal-1", status: "POSTED" }),
    },
    financialPayout: {
      findUnique: async () => ({ id: "payout-1", targetType: "ACCOUNT_PAYABLE", targetId: "payable-1", status: payoutStatus }),
      updateMany: async (args) => {
        calls.payoutUpdates.push(args);
        return { count: 1 };
      },
    },
    financialAccount: {
      update: async (args) => calls.accountChanges.push(args),
      updateMany: async (args) => calls.accountChanges.push(args),
      findUnique: async () => ({ accountName: "Main bank" }),
    },
  };
  return {
    calls,
    payable,
    client: { $transaction: async (callback) => callback(tx) },
  };
};

const makeReceivableClient = () => {
  const receivable = {
    id: "receivable-1",
    referenceId: "order-1",
    payerName: "Customer",
    totalAmount: 300,
    receivedAmount: 100,
    remainingBalance: 200,
    status: "PARTIALLY_RECEIVED",
    collectionHistory: [{
      idempotencyKey: "collection-key-1",
      amount: "100.00",
      settlementAmount: "100.00",
    }],
  };
  const cashTransaction = {
    id: "collection-cash-1",
    idempotencyKey: "collection-key-1",
    type: "INFLOW",
    amount: 100,
    toAccountId: "bank-1",
    referenceId: "receivable-1",
  };
  const calls = { accountChanges: [], cashCreates: [], receivableUpdates: [], reversionCreates: [] };
  const tx = {
    accountReceivable: {
      findUnique: async () => receivable,
      updateMany: async (args) => {
        calls.receivableUpdates.push(args);
        return { count: 1 };
      },
    },
    cashTransaction: {
      findUnique: async ({ where }) => where.idempotencyKey === cashTransaction.idempotencyKey ? cashTransaction : null,
      create: async ({ data }) => {
        calls.cashCreates.push(data);
        return { id: "collection-reversal-1", ...data };
      },
    },
    settlementReversion: {
      findFirst: async () => null,
      create: async ({ data }) => calls.reversionCreates.push(data),
    },
    journalEntry: {
      findFirst: async () => ({ id: "collection-journal-1", status: "POSTED" }),
    },
    financialAccount: {
      update: async (args) => calls.accountChanges.push(args),
      updateMany: async (args) => {
        calls.accountChanges.push(args);
        return { count: 1 };
      },
      findUnique: async () => ({ accountName: "Main bank" }),
    },
  };
  return {
    calls,
    client: { $transaction: async (callback) => callback(tx) },
  };
};

const makeMarketingCpaClient = ({ hasPendingPayout = false } = {}) => {
  const document = {
    id: "cpa-bill-1",
    documentType: "BILL",
    side: "PAYABLE",
    sourceType: "MARKETING_CPA",
    currency: "NPR",
    originalAmount: new Prisma.Decimal("100.00"),
    allocatedAmount: new Prisma.Decimal("40.00"),
    remainingAmount: new Prisma.Decimal("60.00"),
    status: "PARTIALLY_PAID",
    party: { partyType: "MARKETING_PARTNER", displayName: "Partner One" },
  };
  const payout = {
    id: "payout-1",
    idempotencyKey: "cpa-payout-key-1",
    targetType: "MARKETING_CPA_PAYABLE",
    targetId: "cpa-bill-1",
    amount: new Prisma.Decimal("40.00"),
    status: "SETTLED",
    bankEvidenceReference: "BANK-EVIDENCE-1",
  };
  const cashTransaction = {
    id: "cpa-cash-1",
    idempotencyKey: payout.idempotencyKey,
    type: "OUTFLOW",
    category: "MARKETING_CPA_PAYOUT",
    amount: new Prisma.Decimal("40.00"),
    fromAccountId: "bank-1",
    referenceId: document.id,
  };
  const allocation = {
    idempotencyKey: `MARKETING_CPA_PAYOUT:${payout.id}`,
    documentId: document.id,
    allocationType: "CASH",
    amount: new Prisma.Decimal("40.00"),
  };
  const calls = { accountChanges: [], cashCreates: [], documentUpdates: [], allocationCreates: [], payoutUpdates: [], reversionCreates: [], audits: [] };
  const tx = {
    accountingDocument: {
      findUnique: async () => ({ ...document, party: { ...document.party } }),
      updateMany: async (args) => {
        calls.documentUpdates.push(args);
        Object.assign(document, args.data);
        return { count: 1 };
      },
    },
    financialPayout: {
      findFirst: async ({ where }) => where.status === "INITIATED"
        ? (hasPendingPayout ? { id: "payout-pending-1", status: "INITIATED" } : null)
        : payout,
      findUnique: async ({ where }) => where.id === payout.id ? payout : null,
      updateMany: async (args) => {
        calls.payoutUpdates.push(args);
        Object.assign(payout, args.data);
        return { count: 1 };
      },
    },
    cashTransaction: {
      findUnique: async ({ where }) => where.idempotencyKey === cashTransaction.idempotencyKey ? cashTransaction : null,
      create: async ({ data }) => {
        calls.cashCreates.push(data);
        return { id: "cpa-cash-reversal-1", ...data };
      },
    },
    accountingAllocation: {
      findUnique: async ({ where }) => where.idempotencyKey === allocation.idempotencyKey ? allocation : null,
      create: async ({ data }) => calls.allocationCreates.push(data),
    },
    settlementReversion: {
      findFirst: async () => null,
      create: async ({ data }) => calls.reversionCreates.push(data),
    },
    journalEntry: {
      findFirst: async () => ({ id: "cpa-journal-1", sourceType: "MARKETING_CPA_PAYMENT", sourceId: payout.id, status: "POSTED" }),
    },
    financialAccount: {
      update: async (args) => calls.accountChanges.push(args),
      findUnique: async () => ({ accountName: "Main bank" }),
    },
  };
  return {
    calls,
    client: { $transaction: async (callback) => callback(tx) },
  };
};

test("returned payable funds atomically restore source, treasury, payout and source journal", async () => {
  const { client, calls } = makePayableClient();
  const reverseJournalCalls = [];
  const result = await correctSettledTransaction({
    type: "PAYABLE",
    recordId: "payable-1",
    correctionMode: "RETURNED_FUNDS",
    correctionReason: "Supplier returned duplicate payment",
    evidenceReference: "BANK-RETURN-123",
    actorAccountId: "admin-1",
    actorEmail: "owner@example.com",
    client,
    reverseJournal: async (input) => {
      reverseJournalCalls.push(input);
      return { id: "journal-reversal-1" };
    },
    writeAudit: async (_actor, event) => calls.audits.push(event),
  });

  assert.equal(result.restoredStatus, "UNPAID");
  assert.equal(result.paidAmount, "0.00");
  assert.equal(result.remainingBalance, "200.00");
  assert.equal(result.reversalTransactionId, "cash-reversal-1");
  assert.equal(reverseJournalCalls[0].expectedSourceType, "SUPPLIER_PAYMENT");
  assert.equal(reverseJournalCalls[0].expectedSourceId, "payable-1");
  assert.equal(calls.accountChanges[0].data.currentBalance.increment.toString(), "100");
  assert.equal(calls.cashCreates[0].type, "INFLOW");
  assert.equal(calls.cashCreates[0].externalPaymentReference, "BANK-RETURN-123");
  assert.equal(calls.payableUpdates[0].data.settlementHistory.length, 0);
  assert.equal(calls.payoutUpdates[0].data.status, "REVERSED");
  assert.equal(calls.reversionCreates.length, 1);
  assert.equal(calls.audits[0].afterState.correctionMode, "RETURNED_FUNDS");
});

test("returned Marketing CPA payout restores bill, Treasury, allocation, and linked journal", async () => {
  const { client, calls } = makeMarketingCpaClient();
  const reverseJournalCalls = [];
  const result = await correctSettledTransaction({
    type: "MARKETING_CPA_PAYABLE",
    recordId: "cpa-bill-1",
    payoutId: "payout-1",
    correctionMode: "RETURNED_FUNDS",
    correctionReason: "Partner returned the duplicate payment",
    evidenceReference: "BANK-RETURN-789",
    actorAccountId: "admin-1",
    actorEmail: "finance@example.com",
    client,
    reverseJournal: async (input) => {
      reverseJournalCalls.push(input);
      return { id: "cpa-journal-reversal-1" };
    },
    writeAudit: async (_actor, event) => calls.audits.push(event),
  });

  assert.equal(result.restoredStatus, "OPEN");
  assert.equal(result.paidAmount, "0.00");
  assert.equal(result.remainingBalance, "100.00");
  assert.equal(calls.accountChanges[0].data.currentBalance.increment.toString(), "40");
  assert.equal(calls.cashCreates[0].type, "INFLOW");
  assert.equal(calls.cashCreates[0].referenceId, "cpa-bill-1");
  assert.equal(reverseJournalCalls[0].expectedSourceType, "MARKETING_CPA_PAYMENT");
  assert.equal(reverseJournalCalls[0].expectedSourceId, "payout-1");
  assert.equal(calls.documentUpdates[0].data.allocatedAmount.toString(), "0");
  assert.equal(calls.allocationCreates[0].allocationType, "REVERSAL");
  assert.equal(calls.payoutUpdates[0].data.status, "REVERSED");
  assert.equal(calls.reversionCreates[0].originalRecordId, "cpa-bill-1");
  assert.equal(calls.audits[0].action, "MARKETING_CPA_PAYOUT_CORRECTED");
});

test("Marketing CPA payout cannot be voided after confirmation", async () => {
  const { client, calls } = makeMarketingCpaClient();
  await assert.rejects(
    correctSettledTransaction({
      type: "MARKETING_CPA_PAYABLE",
      recordId: "cpa-bill-1",
      payoutId: "payout-1",
      correctionMode: "VOID_NOT_EXECUTED",
      correctionReason: "Bank confirmation was entered in error",
      evidenceReference: "BANK-TRACE-123",
      actorAccountId: "admin-1",
      client,
    }),
    { code: "CPA_PAYOUT_CANNOT_BE_VOIDED" },
  );
  assert.equal(calls.accountChanges.length, 0);
  assert.equal(calls.cashCreates.length, 0);
});

test("Marketing CPA payout cannot be corrected while another payout is pending", async () => {
  const { client, calls } = makeMarketingCpaClient({ hasPendingPayout: true });
  await assert.rejects(
    correctSettledTransaction({
      type: "MARKETING_CPA_PAYABLE",
      recordId: "cpa-bill-1",
      payoutId: "payout-1",
      correctionMode: "RETURNED_FUNDS",
      correctionReason: "Partner returned the duplicate payment",
      evidenceReference: "BANK-RETURN-789",
      actorAccountId: "admin-1",
      client,
    }),
    { code: "CPA_PAYOUT_PENDING" },
  );
  assert.equal(calls.accountChanges.length, 0);
  assert.equal(calls.cashCreates.length, 0);
});

test("returned receivable funds atomically reduce treasury and reverse the linked customer journal", async () => {
  const { client, calls } = makeReceivableClient();
  const reverseJournalCalls = [];
  const result = await correctSettledTransaction({
    type: "RECEIVABLE",
    recordId: "receivable-1",
    correctionMode: "RETURNED_FUNDS",
    correctionReason: "Customer payment was returned",
    evidenceReference: "BANK-RETURN-456",
    actorAccountId: "admin-1",
    client,
    reverseJournal: async (input) => {
      reverseJournalCalls.push(input);
      return { id: "customer-journal-reversal-1" };
    },
    writeAudit: async () => {},
  });

  assert.equal(result.restoredStatus, "UNPAID");
  assert.equal(result.paidAmount, "0.00");
  assert.equal(result.remainingBalance, "300.00");
  assert.equal(calls.accountChanges[0].where.currentBalance.gte.toString(), "100");
  assert.equal(calls.accountChanges[0].data.currentBalance.decrement.toString(), "100");
  assert.equal(calls.cashCreates[0].type, "OUTFLOW");
  assert.equal(calls.cashCreates[0].fromAccountId, "bank-1");
  assert.equal(calls.cashCreates[0].externalPaymentReference, "BANK-RETURN-456");
  assert.equal(reverseJournalCalls[0].expectedSourceType, "CUSTOMER_PAYMENT");
  assert.equal(reverseJournalCalls[0].expectedSourceId, "order-1");
  assert.equal(calls.receivableUpdates[0].data.collectionHistory.length, 0);
  assert.equal(calls.reversionCreates[0].reversalJournalEntryId, "customer-journal-reversal-1");
});

test("a confirmed payout cannot be corrected as if no money moved", async () => {
  const { client, calls } = makePayableClient();
  await assert.rejects(
    correctSettledTransaction({
      type: "PAYABLE",
      recordId: "payable-1",
      correctionMode: "VOID_NOT_EXECUTED",
      correctionReason: "Transfer did not occur",
      evidenceReference: "BANK-TRACE-123",
      actorAccountId: "admin-1",
      client,
      reverseJournal: async () => {
        throw new Error("Must not reverse before payout mode validation.");
      },
    }),
    { code: "SETTLED_PAYOUT_CANNOT_BE_VOIDED" },
  );
  assert.equal(calls.accountChanges.length, 0);
  assert.equal(calls.cashCreates.length, 0);
  assert.equal(calls.payableUpdates.length, 0);
});

test("source-linked receipt corrections dispatch by receipt ID with the authenticated reviewer", async () => {
  const receipt = { id: "receipt-1", category: "RECEIVABLE_COLLECTION" };
  const calls = [];
  const tx = {
    cashTransaction: {
      findUnique: async ({ where }) => where.id === receipt.id ? receipt : null,
    },
  };
  const client = { $transaction: async (callback) => callback(tx) };
  const result = await correctSettledTransaction({
    type: "RECEIVABLE",
    recordId: receipt.id,
    cashTransactionId: receipt.id,
    correctionMode: "RETURNED_FUNDS",
    correctionReason: "Customer funds were returned",
    evidenceReference: "BANK-RETURN-RECEIPT-1",
    actorAccountId: "admin-checker",
    actorEmail: "checker@example.com",
    actorContext: { actorId: "admin-checker", actorRole: "ADMIN" },
    client,
    reverseReceipt: async (input) => {
      calls.push(input);
      return { restoredStatus: "REVERSED", reversalTransactionId: "refund-1" };
    },
  });

  assert.equal(result.restoredStatus, "REVERSED");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].receiptId, receipt.id);
  assert.equal(calls[0].actorAccountId, "admin-checker");
  assert.equal(calls[0].actorEmail, "checker@example.com");
  assert.equal(calls[0].evidenceReference, "BANK-RETURN-RECEIPT-1");
  assert.equal(calls[0].client, tx);
  await assert.rejects(
    correctSettledTransaction({
      type: "RECEIVABLE",
      recordId: "invoice-1",
      cashTransactionId: receipt.id,
      correctionMode: "RETURNED_FUNDS",
      correctionReason: "Customer funds were returned",
      evidenceReference: "BANK-RETURN-RECEIPT-1",
      actorAccountId: "admin-checker",
      client,
      reverseReceipt: async () => {
        throw new Error("A mismatched invoice ID must not dispatch the receipt reversal.");
      },
    }),
    { code: "CUSTOMER_RECEIPT_ID_MISMATCH" },
  );
  assert.equal(calls.length, 1);
});
