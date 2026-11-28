import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { correctSettledTransaction } from "../services/settlementCorrectionService.js";

const makePayableClient = ({
  payoutStatus = "SETTLED",
  payableOverrides = {},
  supplierBill = null,
  billAllocations = [],
  reversedAllocations = [],
  failAllocationCreate = false,
} = {}) => {
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
    ...(supplierBill ? { accountingPartyId: supplierBill.partyId } : {}),
    ...payableOverrides,
  };
  const cashTransaction = {
    id: "cash-1",
    idempotencyKey: "payout-key-1",
    type: "OUTFLOW",
    amount: 100,
    fromAccountId: "bank-1",
    referenceId: "payable-1",
  };
  const payout = {
    id: "payout-1",
    idempotencyKey: "payout-key-1",
    targetType: "ACCOUNT_PAYABLE",
    targetId: "payable-1",
    status: payoutStatus,
  };
  const calls = {
    accountChanges: [],
    cashCreates: [],
    payableUpdates: [],
    documentUpdates: [],
    allocationCreates: [],
    payoutUpdates: [],
    reversionCreates: [],
    audits: [],
  };
  const transactionCalls = [];
  const tx = {
    accountPayable: {
      findUnique: async () => payable,
      updateMany: async (args) => {
        calls.payableUpdates.push(args);
        Object.assign(payable, args.data);
        return { count: 1 };
      },
    },
    accountingDocument: {
      findMany: async ({ where }) => supplierBill &&
        where.partyId === supplierBill.partyId &&
        where.sourceId === supplierBill.sourceId
        ? [supplierBill]
        : [],
      updateMany: async (args) => {
        calls.documentUpdates.push(args);
        Object.assign(supplierBill, args.data);
        return { count: 1 };
      },
    },
    accountingAllocation: {
      findUnique: async ({ where }) =>
        billAllocations.find((allocation) => allocation.idempotencyKey === where.idempotencyKey) ||
        reversedAllocations.find((allocation) => allocation.idempotencyKey === where.idempotencyKey) ||
        null,
      findMany: async ({ where }) => where.reversesAllocationId?.in
        ? reversedAllocations.filter((allocation) => where.reversesAllocationId.in.includes(allocation.reversesAllocationId))
        : billAllocations.filter((allocation) =>
            allocation.documentId === where.documentId &&
            allocation.journalEntryId === where.journalEntryId &&
            allocation.allocationType === where.allocationType
          ),
      create: async ({ data }) => {
        if (failAllocationCreate) throw new Error("Injected allocation failure.");
        calls.allocationCreates.push(data);
        return { id: "allocation-reversal-1", ...data };
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
      findUnique: async () => payout,
      updateMany: async (args) => {
        calls.payoutUpdates.push(args);
        Object.assign(payout, args.data);
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
    supplierBill,
    transactionCalls,
    client: {
      $transaction: async (callback, options) => {
        transactionCalls.push(options);
        const snapshot = {
          payable: { ...payable },
          supplierBill: supplierBill ? { ...supplierBill } : null,
          payout: { ...payout },
          callLengths: Object.fromEntries(Object.entries(calls).map(([name, entries]) => [name, entries.length])),
        };
        try {
          return await callback(tx);
        } catch (error) {
          Object.assign(payable, snapshot.payable);
          if (supplierBill) Object.assign(supplierBill, snapshot.supplierBill);
          Object.assign(payout, snapshot.payout);
          for (const [name, length] of Object.entries(snapshot.callLengths)) calls[name].length = length;
          throw error;
        }
      },
    },
  };
};

const makeSupplierBillFixture = ({
  originalAmount,
  allocatedAmount,
  settlementAllocationAmount,
}) => {
  const original = new Prisma.Decimal(originalAmount);
  const allocated = new Prisma.Decimal(allocatedAmount);
  const remaining = original.minus(allocated);
  const document = {
    id: "supplier-bill-1",
    partyId: "vendor-1",
    documentType: "BILL",
    side: "PAYABLE",
    sourceType: "OPERATING_EXPENSE",
    sourceId: "invoice-1",
    currency: "NPR",
    originalAmount: original,
    allocatedAmount: allocated,
    remainingAmount: remaining,
    status: remaining.isZero() ? "PAID" : allocated.isZero() ? "OPEN" : "PARTIALLY_PAID",
  };
  const allocation = {
    id: "allocation-target-1",
    idempotencyKey: "ACCOUNT_PAYABLE_PAYOUT:payout-1",
    documentId: document.id,
    journalEntryId: "journal-1",
    allocationType: "CASH",
    amount: new Prisma.Decimal(settlementAllocationAmount),
  };
  return { document, allocation };
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

test("supplier bill correction reverses a fully settled bill allocation and reopens its balance", async () => {
  const { document, allocation } = makeSupplierBillFixture({
    originalAmount: "150.00",
    allocatedAmount: "150.00",
    settlementAllocationAmount: "150.00",
  });
  const { client, calls } = makePayableClient({
    supplierBill: document,
    billAllocations: [allocation],
  });

  await correctSettledTransaction({
    type: "PAYABLE",
    recordId: "payable-1",
    correctionMode: "RETURNED_FUNDS",
    correctionReason: "Supplier returned the payment",
    evidenceReference: "BANK-RETURN-FULL",
    actorAccountId: "admin-checker",
    client,
    reverseJournal: async () => ({ id: "journal-reversal-1" }),
    writeAudit: async (_actor, event) => calls.audits.push(event),
  });

  assert.equal(document.allocatedAmount.toFixed(2), "0.00");
  assert.equal(document.remainingAmount.toFixed(2), "150.00");
  assert.equal(document.status, "OPEN");
  assert.equal(calls.documentUpdates[0].data.status, "OPEN");
  assert.equal(calls.allocationCreates.length, 1);
  assert.equal(calls.allocationCreates[0].allocationType, "REVERSAL");
  assert.equal(calls.allocationCreates[0].amount.toFixed(2), "150.00");
  assert.equal(calls.allocationCreates[0].reversesAllocationId, allocation.id);
  assert.equal(calls.audits[0].afterState.supplierBillDocumentId, document.id);
  assert.equal(calls.audits[0].afterState.reversedAllocationAmount, "150.00");
});

test("supplier bill correction reverses only its payout when multiple allocations remain", async () => {
  const { document, allocation } = makeSupplierBillFixture({
    originalAmount: "200.00",
    allocatedAmount: "175.00",
    settlementAllocationAmount: "75.00",
  });
  const priorAllocation = {
    id: "allocation-prior-1",
    idempotencyKey: "EXPENSE_PAYMENT:prior-payment",
    documentId: document.id,
    journalEntryId: "prior-journal-1",
    allocationType: "CASH",
    amount: new Prisma.Decimal("100.00"),
  };
  const { client, calls } = makePayableClient({
    supplierBill: document,
    billAllocations: [priorAllocation, allocation],
    payableOverrides: {
      totalAmount: new Prisma.Decimal("200.00"),
      paidAmount: new Prisma.Decimal("175.00"),
      remainingBalance: new Prisma.Decimal("25.00"),
      status: "PARTIALLY_PAID",
      settlementHistory: [{
        idempotencyKey: "payout-key-1",
        amount: "100.00",
        settlementAmount: "75.00",
      }],
    },
  });

  await correctSettledTransaction({
    type: "PAYABLE",
    recordId: "payable-1",
    correctionMode: "RETURNED_FUNDS",
    correctionReason: "Supplier returned the latest payment",
    evidenceReference: "BANK-RETURN-PARTIAL",
    actorAccountId: "admin-checker",
    client,
    reverseJournal: async () => ({ id: "journal-reversal-1" }),
    writeAudit: async () => {},
  });

  assert.equal(document.allocatedAmount.toFixed(2), "100.00");
  assert.equal(document.remainingAmount.toFixed(2), "100.00");
  assert.equal(document.status, "PARTIALLY_PAID");
  assert.equal(calls.allocationCreates.length, 1);
  assert.equal(calls.allocationCreates[0].reversesAllocationId, allocation.id);
  assert.equal(calls.allocationCreates[0].amount.toFixed(2), "75.00");
  assert.equal(priorAllocation.amount.toFixed(2), "100.00");
});

test("supplier bill correction fails closed when the linked allocation is missing", async () => {
  const { document } = makeSupplierBillFixture({
    originalAmount: "150.00",
    allocatedAmount: "150.00",
    settlementAllocationAmount: "150.00",
  });
  const { client, calls } = makePayableClient({ supplierBill: document });

  await assert.rejects(
    correctSettledTransaction({
      type: "PAYABLE",
      recordId: "payable-1",
      correctionMode: "RETURNED_FUNDS",
      correctionReason: "Supplier returned the payment",
      evidenceReference: "BANK-RETURN-MISSING",
      actorAccountId: "admin-checker",
      client,
    }),
    { code: "PAYABLE_BILL_ALLOCATION_MISSING" },
  );
  assert.equal(calls.accountChanges.length, 0);
  assert.equal(calls.cashCreates.length, 0);
  assert.equal(calls.payableUpdates.length, 0);
});

test("supplier bill correction rejects an already reversed allocation", async () => {
  const { document, allocation } = makeSupplierBillFixture({
    originalAmount: "150.00",
    allocatedAmount: "150.00",
    settlementAllocationAmount: "150.00",
  });
  const { client, calls } = makePayableClient({
    supplierBill: document,
    billAllocations: [allocation],
    reversedAllocations: [{ id: "existing-reversal", reversesAllocationId: allocation.id }],
  });

  await assert.rejects(
    correctSettledTransaction({
      type: "PAYABLE",
      recordId: "payable-1",
      correctionMode: "RETURNED_FUNDS",
      correctionReason: "Supplier returned the payment",
      evidenceReference: "BANK-RETURN-REPLAY",
      actorAccountId: "admin-checker",
      client,
    }),
    { code: "PAYABLE_BILL_ALLOCATION_ALREADY_REVERSED" },
  );
  assert.equal(calls.accountChanges.length, 0);
  assert.equal(calls.cashCreates.length, 0);
});

test("supplier bill correction rejects over-reversal and invalid allocation amounts", async () => {
  const { document, allocation } = makeSupplierBillFixture({
    originalAmount: "200.00",
    allocatedAmount: "50.00",
    settlementAllocationAmount: "75.00",
  });
  const { client, calls } = makePayableClient({
    supplierBill: document,
    billAllocations: [allocation],
    payableOverrides: {
      settlementHistory: [{
        idempotencyKey: "payout-key-1",
        amount: "100.00",
        settlementAmount: "75.00",
      }],
    },
  });

  await assert.rejects(
    correctSettledTransaction({
      type: "PAYABLE",
      recordId: "payable-1",
      correctionMode: "RETURNED_FUNDS",
      correctionReason: "Supplier returned the payment",
      evidenceReference: "BANK-RETURN-OVER",
      actorAccountId: "admin-checker",
      client,
    }),
    { code: "PAYABLE_BILL_BALANCE_MISMATCH" },
  );
  assert.equal(calls.accountChanges.length, 0);
  assert.equal(calls.cashCreates.length, 0);
  assert.equal(calls.documentUpdates.length, 0);
});

test("supplier bill correction rejects an allocation amount that differs from the settlement", async () => {
  const { document, allocation } = makeSupplierBillFixture({
    originalAmount: "150.00",
    allocatedAmount: "150.00",
    settlementAllocationAmount: "150.00",
  });
  const { client, calls } = makePayableClient({
    supplierBill: document,
    billAllocations: [allocation],
    payableOverrides: {
      settlementHistory: [{
        idempotencyKey: "payout-key-1",
        amount: "100.00",
        settlementAmount: "149.99",
      }],
    },
  });

  await assert.rejects(
    correctSettledTransaction({
      type: "PAYABLE",
      recordId: "payable-1",
      correctionMode: "RETURNED_FUNDS",
      correctionReason: "Supplier returned the payment",
      evidenceReference: "BANK-RETURN-AMOUNT-MISMATCH",
      actorAccountId: "admin-checker",
      client,
    }),
    { code: "PAYABLE_BILL_BALANCE_MISMATCH" },
  );
  assert.equal(calls.accountChanges.length, 0);
  assert.equal(calls.cashCreates.length, 0);
  assert.equal(calls.documentUpdates.length, 0);
});

test("supplier bill correction rolls back all mocked updates when reversal allocation creation fails", async () => {
  const { document, allocation } = makeSupplierBillFixture({
    originalAmount: "150.00",
    allocatedAmount: "150.00",
    settlementAllocationAmount: "150.00",
  });
  const { client, calls, payable, transactionCalls } = makePayableClient({
    supplierBill: document,
    billAllocations: [allocation],
    failAllocationCreate: true,
  });

  await assert.rejects(
    correctSettledTransaction({
      type: "PAYABLE",
      recordId: "payable-1",
      correctionMode: "RETURNED_FUNDS",
      correctionReason: "Supplier returned the payment",
      evidenceReference: "BANK-RETURN-ROLLBACK",
      actorAccountId: "admin-checker",
      client,
      reverseJournal: async () => ({ id: "journal-reversal-1" }),
      writeAudit: async (_actor, event) => calls.audits.push(event),
    }),
    /Injected allocation failure/,
  );

  assert.equal(transactionCalls[0].isolationLevel, "Serializable");
  assert.equal(payable.status, "PARTIALLY_PAID");
  assert.equal(document.allocatedAmount.toFixed(2), "150.00");
  assert.equal(document.remainingAmount.toFixed(2), "0.00");
  assert.equal(calls.accountChanges.length, 0);
  assert.equal(calls.cashCreates.length, 0);
  assert.equal(calls.payableUpdates.length, 0);
  assert.equal(calls.documentUpdates.length, 0);
  assert.equal(calls.payoutUpdates.length, 0);
  assert.equal(calls.reversionCreates.length, 0);
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
