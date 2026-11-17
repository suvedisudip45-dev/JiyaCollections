import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  recordCustomerReceipt,
  reverseCustomerReceipt,
} from "../services/customerReceiptService.js";

const makeHarness = (balances = ["20.00", "30.00"]) => {
  const documents = balances.map((remainingAmount, index) => ({
    id: `invoice-${index + 1}`,
    documentType: "INVOICE",
    documentNumber: `INV-${index + 1}`,
    side: "RECEIVABLE",
    currency: "NPR",
    partyId: "party-1",
    party: { partyType: "CUSTOMER", status: "ACTIVE", displayName: "Customer One" },
    originalAmount: new Prisma.Decimal(remainingAmount),
    allocatedAmount: new Prisma.Decimal("0"),
    remainingAmount: new Prisma.Decimal(remainingAmount),
    status: "OPEN",
    dueDate: new Date("2026-01-01T00:00:00.000Z"),
    issueDate: new Date("2025-12-01T00:00:00.000Z"),
    createdAt: new Date("2025-12-01T00:00:00.000Z"),
  }));
  const receipts = new Map();
  const allocations = [];
  const calls = { treasuryIncrement: null, journal: [], receiptCreates: [] };
  let treasuryBalance = new Prisma.Decimal("100.00");
  let receiptSequence = 0;
  let originalJournalStatus = "POSTED";
  let receiptReversion = null;
  let reversalJournal = null;
  let reversalTransaction = null;
  const reversalAllocations = [];
  const tx = {
    $transaction: null,
    cashTransaction: {
      findUnique: async ({ where }) => where.id
        ? [...receipts.values()].find((receipt) => receipt.id === where.id) || reversalTransaction
        : receipts.get(where.idempotencyKey) || null,
      create: async ({ data }) => {
        const receipt = { id: `receipt-${++receiptSequence}`, ...data };
        receipts.set(data.idempotencyKey, receipt);
        calls.receiptCreates.push(receipt);
        return receipt;
      },
    },
    journalEntry: {
      findUnique: async ({ where }) => where.id === reversalJournal?.id
        ? reversalJournal
        : {
            id: where.id,
            sourceType: "CUSTOMER_PAYMENT",
            sourceId: "receipt-1",
            idempotencyKey: "CUSTOMER_PAYMENT:customer-receipt-key-1",
            status: originalJournalStatus,
            reversedEntryId: reversalJournal?.id || null,
          },
    },
    accountingDocument: {
      findMany: async ({ where }) => documents.filter((document) =>
        (!where.id?.in || where.id.in.includes(document.id)) &&
        (!where.status?.in || where.status.in.includes(document.status)) &&
        (!where.currency || document.currency === where.currency) &&
        (!where.side || document.side === where.side) &&
        (!where.documentType?.in || where.documentType.in.includes(document.documentType)) &&
        (!where.party?.is?.partyType || document.party.partyType === where.party.is.partyType) &&
        (!where.party?.is?.status || document.party.status === where.party.is.status),
      ),
      updateMany: async ({ where, data }) => {
        const document = documents.find((candidate) =>
          candidate.id === where.id &&
          candidate.allocatedAmount.equals(where.allocatedAmount) &&
          candidate.remainingAmount.equals(where.remainingAmount) &&
          candidate.status === where.status,
        );
        if (!document) return { count: 0 };
        Object.assign(document, data);
        return { count: 1 };
      },
    },
    accountingAllocation: {
      findUnique: async ({ where }) => allocations.find((allocation) => allocation.idempotencyKey === where.idempotencyKey) || null,
      findMany: async ({ where }) => where.reversesAllocationId?.in
        ? reversalAllocations.filter((allocation) => where.reversesAllocationId.in.includes(allocation.reversesAllocationId))
        : allocations.filter((allocation) =>
            allocation.cashTransactionId === where.cashTransactionId &&
            allocation.allocationType === where.allocationType,
          ),
      create: async ({ data }) => {
        const allocation = { id: `allocation-${allocations.length + 1}`, ...data };
        allocations.push(allocation);
        return allocation;
      },
    },
    financialAccount: {
      findUnique: async () => ({
        id: "treasury-1",
        status: "ACTIVE",
        currency: "NPR",
        accountingAccountId: "gl-1",
      }),
      updateMany: async ({ data }) => {
        calls.treasuryIncrement = data.currentBalance.increment;
        treasuryBalance = treasuryBalance.plus(data.currentBalance.increment);
        return { count: 1 };
      },
    },
    account: {
      findUnique: async () => ({ id: "gl-1", accountCode: "1120", isActive: true }),
    },
    settlementReversion: {
      findFirst: async () => receiptReversion,
    },
  };
  const client = {
    $transaction: async (callback) => callback(tx),
    cashTransaction: tx.cashTransaction,
    accountingAllocation: tx.accountingAllocation,
    journalEntry: tx.journalEntry,
  };
  const postPaymentAccounting = async (input) => {
    calls.journal.push(input);
    return { id: "journal-1" };
  };
  const input = {
    invoiceIds: documents.map((document) => document.id),
    amount: "10.00",
    adjustmentType: "NONE",
    adjustmentAmount: "0",
    toAccountId: "treasury-1",
    tenderMethod: "BANK_TRANSFER",
    evidenceReference: "BANK-REF-001",
    notes: "Customer receipt",
    idempotencyKey: "customer-receipt-key-1",
    receivedByAccountId: "admin-account-1",
  };
  return {
    allocations,
    calls,
    client,
    documents,
    input,
    postPaymentAccounting,
    receipts,
    getTreasuryBalance: () => treasuryBalance,
    markReceiptReversed: (receiptId) => {
      const receipt = [...receipts.values()].find((candidate) => candidate.id === receiptId);
      originalJournalStatus = "REVERSED";
      reversalJournal = {
        id: "journal-reversal-1",
        sourceType: "REVERSAL",
        sourceId: "REV-journal-1",
        status: "POSTED",
      };
      reversalTransaction = {
        id: "refund-1",
        type: "OUTFLOW",
        category: "REFUND",
        referenceId: receiptId,
        amount: receipt.amount,
        settlementAmount: receipt.settlementAmount,
      };
      receiptReversion = {
        reversionType: "CUSTOMER_RECEIPT",
        originalRecordId: receiptId,
        cashTransactionId: receiptId,
        reversalTransactionId: reversalTransaction.id,
        reversalJournalEntryId: reversalJournal.id,
        originalAmount: receipt.amount,
      };
      for (const allocation of allocations) {
        reversalAllocations.push({
          reversesAllocationId: allocation.id,
          allocationType: "REVERSAL",
          documentId: allocation.documentId,
          cashTransactionId: reversalTransaction.id,
          journalEntryId: reversalJournal.id,
          amount: allocation.amount,
        });
      }
    },
  };
};

const record = (harness, overrides = {}) =>
  recordCustomerReceipt(
    { ...harness.input, ...overrides },
    { client: harness.client, postPaymentAccounting: harness.postPaymentAccounting },
  );

test("full and partial receipt collections preserve invoice, Treasury, and journal amounts", async () => {
  const full = makeHarness(["10.00"]);
  const fullResult = await record(full, { amount: "10.00", invoiceIds: ["invoice-1"] });
  assert.equal(fullResult.allocatedAmount, "10.00");
  assert.equal(full.documents[0].remainingAmount.toFixed(2), "0.00");
  assert.equal(full.documents[0].status, "PAID");
  assert.equal(full.getTreasuryBalance().toFixed(2), "110.00");
  assert.equal(full.calls.journal[0].amount.toFixed(2), "10.00");
  assert.equal(full.calls.journal[0].settlementAmount.toFixed(2), "10.00");
  assert.equal(full.allocations[0].amount.toFixed(2), "10.00");
  assert.equal(full.allocations[0].journalEntryId, "journal-1");

  const partial = makeHarness(["20.00"]);
  const partialResult = await record(partial, { amount: "7.25", invoiceIds: ["invoice-1"] });
  assert.equal(partialResult.allocatedAmount, "7.25");
  assert.equal(partial.documents[0].remainingAmount.toFixed(2), "12.75");
  assert.equal(partial.documents[0].status, "PARTIALLY_PAID");
});

test("a receipt is allocated deterministically across multiple invoices", async () => {
  const harness = makeHarness(["6.25", "10.00"]);
  const result = await record(harness, {
    amount: "16.25",
    invoiceIds: ["invoice-2", "invoice-1"],
  });
  assert.deepEqual(result.allocations, [
    { invoiceId: "invoice-1", amount: "6.25" },
    { invoiceId: "invoice-2", amount: "10.00" },
  ]);
  assert.equal(harness.allocations.reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0)).toFixed(2), "16.25");
});

test("receipt amounts use NPR HALF_EVEN rounding and retain decimal-string responses", async () => {
  const halfEvenDown = makeHarness(["20.00"]);
  const downResult = await record(halfEvenDown, { amount: "1.005", invoiceIds: ["invoice-1"] });
  assert.equal(downResult.amount, "1.00");
  assert.equal(downResult.allocatedAmount, "1.00");

  const halfEvenUp = makeHarness(["20.00"]);
  const upResult = await record(halfEvenUp, { amount: "1.015", invoiceIds: ["invoice-1"] });
  assert.equal(upResult.amount, "1.02");
  assert.equal(typeof upResult.amount, "string");
});

test("invalid, zero, negative, unsafe, and over-balance amounts are rejected without mutations", async () => {
  for (const amount of [0, "0", "-1.00", "not-money", "900719925474099300000"]) {
    const harness = makeHarness(["20.00"]);
    await assert.rejects(record(harness, { amount, invoiceIds: ["invoice-1"] }));
    assert.equal(harness.calls.receiptCreates.length, 0);
    assert.equal(harness.calls.journal.length, 0);
  }

  const overBalance = makeHarness(["5.00"]);
  await assert.rejects(
    record(overBalance, { amount: "5.01", invoiceIds: ["invoice-1"] }),
    { code: "RECEIPT_EXCEEDS_OUTSTANDING" },
  );
  assert.equal(overBalance.calls.receiptCreates.length, 0);
  assert.equal(overBalance.getTreasuryBalance().toFixed(2), "100.00");
});

test("same-key receipt requests replay exactly and changed payload reuse conflicts", async () => {
  const harness = makeHarness(["20.00"]);
  const first = await record(harness, { amount: "5.00", invoiceIds: ["invoice-1"] });
  const replay = await record(harness, { amount: "5.00", invoiceIds: ["invoice-1"] });
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(replay.receiptId, first.receiptId);
  assert.equal(replay.allocatedAmount, "5.00");
  assert.equal(harness.calls.receiptCreates.length, 1);
  assert.equal(harness.calls.journal.length, 1);
  await assert.rejects(
    record(harness, { amount: "6.00", invoiceIds: ["invoice-1"] }),
    { code: "IDEMPOTENCY_KEY_CONFLICT" },
  );
});

test("an exact receipt replay reports its approved reversed state without reposting", async () => {
  const harness = makeHarness(["20.00"]);
  const first = await record(harness, { amount: "5.00", invoiceIds: ["invoice-1"] });
  harness.markReceiptReversed(first.receiptId);

  const replay = await record(harness, { amount: "5.00", invoiceIds: ["invoice-1"] });

  assert.equal(replay.receiptId, first.receiptId);
  assert.equal(replay.status, "REVERSED");
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(replay.reversedAmount, "5.00");
  await assert.rejects(
    record(harness, { amount: "6.00", invoiceIds: ["invoice-1"] }),
    { code: "IDEMPOTENCY_KEY_CONFLICT" },
  );
  assert.equal(harness.calls.receiptCreates.length, 1);
  assert.equal(harness.calls.journal.length, 1);
});

test("replay fails closed when stored allocations no longer match the receipt", async () => {
  const harness = makeHarness(["20.00"]);
  await record(harness, { amount: "5.00", invoiceIds: ["invoice-1"] });
  harness.allocations[0].amount = new Prisma.Decimal("4.00");
  await assert.rejects(
    record(harness, { amount: "5.00", invoiceIds: ["invoice-1"] }),
    { code: "RECEIPT_REPLAY_INTEGRITY_ERROR" },
  );
});

test("receipt journal posting separates cash received from adjusted invoice settlement", async () => {
  const harness = makeHarness(["20.00"]);
  const result = await record(harness, {
    amount: "9.50",
    adjustmentType: "DISCOUNT",
    adjustmentAmount: "0.50",
    invoiceIds: ["invoice-1"],
  });
  const journal = harness.calls.journal[0];
  assert.equal(result.amount, "9.50");
  assert.equal(result.allocatedAmount, "10.00");
  assert.equal(journal.amount.toFixed(2), "9.50");
  assert.equal(journal.settlementAmount.toFixed(2), "10.00");
  assert.equal(journal.discountAmount.toFixed(2), "0.50");
  assert.equal(harness.allocations[0].amount.toFixed(2), "10.00");
  assert.equal(harness.calls.receiptCreates[0].settlementAmount.toFixed(2), "10.00");
});

test("receipt rejects mismatched invoice owners, unsupported currency, and missing journal posting", async () => {
  const partyMismatch = makeHarness(["10.00", "10.00"]);
  partyMismatch.documents[1].partyId = "party-2";
  await assert.rejects(
    record(partyMismatch, { amount: "10.00" }),
    { code: "RECEIPT_INVOICE_PARTY_MISMATCH" },
  );

  const currencyMismatch = makeHarness(["10.00"]);
  currencyMismatch.documents[0].currency = "USD";
  await assert.rejects(
    record(currencyMismatch, { amount: "5.00", invoiceIds: ["invoice-1"] }),
    { code: "RECEIVABLE_INVOICE_NOT_ELIGIBLE" },
  );

  const noJournal = makeHarness(["10.00"]);
  await assert.rejects(
    recordCustomerReceipt(
      { ...noJournal.input, amount: "5.00", invoiceIds: ["invoice-1"] },
      { client: noJournal.client, postPaymentAccounting: async () => null },
    ),
    { code: "RECEIPT_JOURNAL_NOT_POSTED" },
  );
});

const makeReceiptReversalHarness = () => {
  const receipt = {
    id: "receipt-reversal-1",
    idempotencyKey: "receipt-key-reversal-1",
    receiptPayloadHash: "a".repeat(64),
    category: "RECEIVABLE_COLLECTION",
    type: "INFLOW",
    currency: "NPR",
    amount: new Prisma.Decimal("29.00"),
    settlementAmount: new Prisma.Decimal("30.00"),
    toAccountId: "treasury-1",
    partyName: "Customer One",
    invoiceNumber: "INV-1, INV-2",
    receivedByAccountId: "admin-maker",
    tenderMethod: "BANK_TRANSFER",
    externalPaymentReference: "BANK-RECEIPT-1",
  };
  const documents = [
    {
      id: "invoice-1",
      documentType: "INVOICE",
      partyId: "party-1",
      party: { partyType: "CUSTOMER" },
      side: "RECEIVABLE",
      currency: "NPR",
      originalAmount: new Prisma.Decimal("12.00"),
      allocatedAmount: new Prisma.Decimal("12.00"),
      remainingAmount: new Prisma.Decimal("0.00"),
      status: "PAID",
    },
    {
      id: "invoice-2",
      documentType: "INVOICE",
      partyId: "party-1",
      party: { partyType: "CUSTOMER" },
      side: "RECEIVABLE",
      currency: "NPR",
      originalAmount: new Prisma.Decimal("50.00"),
      allocatedAmount: new Prisma.Decimal("43.00"),
      remainingAmount: new Prisma.Decimal("7.00"),
      status: "PARTIALLY_PAID",
    },
  ];
  const allocations = [
    {
      id: "allocation-1",
      documentId: "invoice-1",
      document: documents[0],
      cashTransactionId: receipt.id,
      journalEntryId: "journal-1",
      allocationType: "CASH",
      amount: new Prisma.Decimal("12.00"),
    },
    {
      id: "allocation-2",
      documentId: "invoice-2",
      document: documents[1],
      cashTransactionId: receipt.id,
      journalEntryId: "journal-1",
      allocationType: "CASH",
      amount: new Prisma.Decimal("18.00"),
    },
  ];
  const journal = {
    id: "journal-1",
    idempotencyKey: "CUSTOMER_PAYMENT:receipt-key-reversal-1",
    sourceType: "CUSTOMER_PAYMENT",
    sourceId: receipt.id,
    status: "POSTED",
    totalDebit: new Prisma.Decimal("30.00"),
    totalCredit: new Prisma.Decimal("30.00"),
    lines: [
      { accountId: "treasury-gl", accountingPartyId: null, debit: new Prisma.Decimal("29.00"), credit: new Prisma.Decimal("0.00") },
      { accountId: "discount-gl", accountingPartyId: null, debit: new Prisma.Decimal("1.00"), credit: new Prisma.Decimal("0.00") },
      { accountId: "receivable-gl", accountingPartyId: "party-1", debit: new Prisma.Decimal("0.00"), credit: new Prisma.Decimal("30.00") },
    ],
  };
  const calls = { treasuryUpdates: [], cashCreates: [], documentUpdates: [], allocationCreates: [], reversions: [], audits: [], journalReversals: [] };
  let treasuryBalance = new Prisma.Decimal("100.00");
  const tx = {
    cashTransaction: {
      findUnique: async ({ where }) => where.id === receipt.id ? receipt : null,
      create: async ({ data }) => {
        calls.cashCreates.push(data);
        return { id: "receipt-refund-1", ...data };
      },
    },
    accountingAllocation: {
      findMany: async ({ where }) => {
        if (where.cashTransactionId === receipt.id) return allocations;
        if (where.reversesAllocationId?.in) return calls.allocationCreates
          .filter((allocation) => where.reversesAllocationId.in.includes(allocation.reversesAllocationId));
        return [];
      },
      create: async ({ data }) => {
        calls.allocationCreates.push(data);
        return { id: `reversal-allocation-${calls.allocationCreates.length}`, ...data };
      },
    },
    accountingDocument: {
      findMany: async ({ where }) => documents.filter((document) => where.id.in.includes(document.id)),
      updateMany: async ({ where, data }) => {
        const document = documents.find((candidate) =>
          candidate.id === where.id &&
          candidate.allocatedAmount.equals(where.allocatedAmount) &&
          candidate.remainingAmount.equals(where.remainingAmount) &&
          candidate.status === where.status,
        );
        if (!document) return { count: 0 };
        Object.assign(document, data);
        calls.documentUpdates.push({ where, data });
        return { count: 1 };
      },
    },
    account: {
      findUnique: async ({ where }) => where.accountCode === "1130" ? { id: "receivable-gl" } : null,
    },
    journalEntry: {
      findFirst: async ({ where }) => where.id === journal.id ? journal : null,
    },
    financialAccount: {
      findUnique: async () => ({
        id: "treasury-1",
        accountName: "Main Treasury",
        currency: "NPR",
        accountingAccountId: "treasury-gl",
        currentBalance: treasuryBalance,
      }),
      updateMany: async ({ where, data }) => {
        calls.treasuryUpdates.push({ where, data });
        if (treasuryBalance.lessThan(where.currentBalance.gte)) return { count: 0 };
        treasuryBalance = treasuryBalance.minus(data.currentBalance.decrement);
        return { count: 1 };
      },
    },
    settlementReversion: {
      findFirst: async ({ where }) => calls.reversions.find((entry) =>
        entry.reversionType === where.reversionType && entry.originalRecordId === where.originalRecordId,
      ) || null,
      create: async ({ data }) => {
        calls.reversions.push(data);
        return data;
      },
    },
  };
  const client = { $transaction: async (callback) => callback(tx) };
  const reverseJournal = async (input) => {
    calls.journalReversals.push(input);
    return { id: "journal-reversal-1" };
  };
  const writeAudit = async (actor, event) => calls.audits.push({ actor, event });
  return {
    allocations,
    calls,
    client,
    documents,
    receipt,
    reverseJournal,
    treasuryBalance: () => treasuryBalance,
    writeAudit,
  };
};

test("full multi-invoice receipt reversal restores invoice balances and reverses cash/journal amounts exactly", async () => {
  const harness = makeReceiptReversalHarness();
  const result = await reverseCustomerReceipt({
    receiptId: harness.receipt.id,
    correctionMode: "RETURNED_FUNDS",
    correctionReason: "Customer refund was confirmed by the bank",
    evidenceReference: "BANK-REFUND-1",
    actorAccountId: "admin-checker",
    actorEmail: "checker@example.com",
    actorContext: { actorRole: "ADMIN", portalSource: "ADMIN" },
    client: harness.client,
    reverseJournal: harness.reverseJournal,
    writeAudit: async (actor, event) => harness.writeAudit(actor, event),
  });

  assert.equal(result.cashReversedAmount, "29.00");
  assert.equal(result.allocatedReversedAmount, "30.00");
  assert.equal(result.paidAmount, "25.00");
  assert.equal(result.remainingBalance, "37.00");
  assert.equal(typeof result.cashReversedAmount, "string");
  assert.equal(harness.treasuryBalance().toFixed(2), "71.00");
  assert.deepEqual(harness.documents.map((document) => ({
    allocated: document.allocatedAmount.toFixed(2),
    remaining: document.remainingAmount.toFixed(2),
    status: document.status,
  })), [
    { allocated: "0.00", remaining: "12.00", status: "OPEN" },
    { allocated: "25.00", remaining: "25.00", status: "PARTIALLY_PAID" },
  ]);
  assert.equal(harness.calls.cashCreates[0].amount.toFixed(2), "29.00");
  assert.equal(harness.calls.cashCreates[0].settlementAmount.toFixed(2), "30.00");
  assert.equal(harness.calls.cashCreates[0].type, "OUTFLOW");
  assert.equal(harness.calls.allocationCreates.length, 2);
  assert.deepEqual(harness.calls.allocationCreates.map((allocation) => ({
    originalId: allocation.reversesAllocationId,
    amount: allocation.amount.toFixed(2),
    type: allocation.allocationType,
    journalEntryId: allocation.journalEntryId,
  })), [
    { originalId: "allocation-1", amount: "12.00", type: "REVERSAL", journalEntryId: "journal-reversal-1" },
    { originalId: "allocation-2", amount: "18.00", type: "REVERSAL", journalEntryId: "journal-reversal-1" },
  ]);
  assert.deepEqual(harness.allocations.map((allocation) => ({
    id: allocation.id,
    type: allocation.allocationType,
    cashTransactionId: allocation.cashTransactionId,
    amount: allocation.amount.toFixed(2),
  })), [
    { id: "allocation-1", type: "CASH", cashTransactionId: harness.receipt.id, amount: "12.00" },
    { id: "allocation-2", type: "CASH", cashTransactionId: harness.receipt.id, amount: "18.00" },
  ]);
  assert.equal(harness.calls.reversions[0].reversionType, "CUSTOMER_RECEIPT");
  assert.equal(harness.calls.reversions[0].originalAmount.toFixed(2), "29.00");
  assert.equal(harness.calls.reversions[0].priorPaidAmount.toFixed(2), "55.00");
  assert.equal(harness.calls.reversions[0].priorRemainingBalance.toFixed(2), "7.00");
  assert.equal(harness.calls.journalReversals[0].expectedSourceId, harness.receipt.id);
  assert.equal(harness.calls.audits[0].actor.actorId, "admin-checker");
});

test("receipt reversal rejects repeats and invalid inputs without extra mutations", async () => {
  const harness = makeReceiptReversalHarness();
  const input = {
    receiptId: harness.receipt.id,
    correctionMode: "RETURNED_FUNDS",
    correctionReason: "Bank returned the customer funds",
    evidenceReference: "BANK-REFUND-2",
    actorAccountId: "admin-checker",
    client: harness.client,
    reverseJournal: harness.reverseJournal,
    writeAudit: harness.writeAudit,
  };
  await reverseCustomerReceipt(input);
  await assert.rejects(reverseCustomerReceipt(input), { code: "CUSTOMER_RECEIPT_ALREADY_REVERSED" });
  await assert.rejects(reverseCustomerReceipt({ ...input, reversalAmount: "1.00" }), {
    code: "PARTIAL_RECEIPT_REVERSAL_UNSUPPORTED",
  });
  await assert.rejects(reverseCustomerReceipt({ ...input, actorAccountId: "" }), {
    code: "REVERSAL_ACTOR_ID_REQUIRED",
  });
  assert.equal(harness.calls.cashCreates.length, 1);
  assert.equal(harness.calls.documentUpdates.length, 2);
  assert.equal(harness.calls.reversions.length, 1);
  assert.equal(harness.treasuryBalance().toFixed(2), "71.00");
});
