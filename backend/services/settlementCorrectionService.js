import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";
import { reverseSettlementJournalEntry } from "./accountingPostingEngine.js";
import { reverseCustomerReceipt } from "./customerReceiptService.js";
import { requireExternalPaymentReference } from "../utils/externalPaymentReference.js";

const createCorrectionError = (message, statusCode = 409, code = "SETTLEMENT_CORRECTION_REJECTED") => {
  return Object.assign(new Error(message), { statusCode, code });
};

const fail = (message, statusCode = 409, code = "SETTLEMENT_CORRECTION_REJECTED") => {
  throw createCorrectionError(message, statusCode, code);
};

const parseHistory = (value, label) => {
  let history;
  try {
    history = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw createCorrectionError(`${label} history is invalid; reconcile it before proceeding.`, 409, "INVALID_SETTLEMENT_HISTORY");
  }
  if (!Array.isArray(history)) {
    throw createCorrectionError(`${label} history is invalid; reconcile it before proceeding.`, 409, "INVALID_SETTLEMENT_HISTORY");
  }
  return history;
};

const correctionDecimal = (value, label) => {
  let amount;
  try {
    amount = new Prisma.Decimal(String(value));
  } catch {
    fail(`${label} is invalid; reconcile it before proceeding.`, 409, "SETTLEMENT_BALANCE_MISMATCH");
  }
  if (!amount.isFinite()) {
    fail(`${label} is invalid; reconcile it before proceeding.`, 409, "SETTLEMENT_BALANCE_MISMATCH");
  }
  return amount;
};

const resolvePayableBillAllocation = async ({
  tx,
  payable,
  payout,
  cashTransaction,
  originalJournal,
  settlementAmount,
}) => {
  if (!payable.accountingPartyId) return null;

  const documents = await tx.accountingDocument.findMany({
    where: {
      partyId: payable.accountingPartyId,
      side: "PAYABLE",
      documentType: "BILL",
      sourceType: "OPERATING_EXPENSE",
      sourceId: payable.referenceId,
    },
    select: {
      id: true,
      partyId: true,
      side: true,
      documentType: true,
      sourceType: true,
      sourceId: true,
      originalAmount: true,
      allocatedAmount: true,
      remainingAmount: true,
      status: true,
    },
  });
  if (documents.length !== 1) {
    fail(
      documents.length
        ? "More than one supplier bill matches this payable; reconcile the source before correcting it."
        : "The supplier bill linked to this expense payable is missing.",
      409,
      documents.length ? "PAYABLE_BILL_DOCUMENT_AMBIGUOUS" : "EXPENSE_BILL_DOCUMENT_MISSING",
    );
  }
  const document = documents[0];
  const allocationKey = payout ? `ACCOUNT_PAYABLE_PAYOUT:${payout.id}` : null;
  let allocations;
  if (allocationKey) {
    const allocation = await tx.accountingAllocation.findUnique({
      where: { idempotencyKey: allocationKey },
    });
    allocations = allocation ? [allocation] : [];
  } else {
    allocations = await tx.accountingAllocation.findMany({
      where: {
        documentId: document.id,
        journalEntryId: originalJournal.id,
        allocationType: "CASH",
      },
    });
  }
  if (allocations.length !== 1) {
    fail(
      allocations.length
        ? "The supplier bill has ambiguous allocations for this settlement; reconcile it before correcting."
        : "The supplier bill allocation for this settlement is missing; reconcile it before correcting.",
      409,
      allocations.length ? "PAYABLE_BILL_ALLOCATION_AMBIGUOUS" : "PAYABLE_BILL_ALLOCATION_MISSING",
    );
  }

  const allocation = allocations[0];
  const allocationAmount = correctionDecimal(allocation.amount, "Supplier bill allocation amount");
  const originalAmount = correctionDecimal(document.originalAmount, "Supplier bill original amount");
  const allocatedAmount = correctionDecimal(document.allocatedAmount, "Supplier bill allocated amount");
  const remainingAmount = correctionDecimal(document.remainingAmount, "Supplier bill remaining amount");
  const expectedStatus = remainingAmount.isZero()
    ? "PAID"
    : allocatedAmount.isZero()
      ? "OPEN"
      : "PARTIALLY_PAID";
  if (
    allocation.documentId !== document.id ||
    allocation.journalEntryId !== originalJournal.id ||
    allocation.allocationType !== "CASH" ||
    (allocation.idempotencyKey && allocationKey && allocation.idempotencyKey !== allocationKey) ||
    (allocation.cashTransactionId && allocation.cashTransactionId !== cashTransaction.id) ||
    !allocationAmount.isPositive() ||
    !allocationAmount.equals(settlementAmount) ||
    !originalAmount.isPositive() ||
    allocatedAmount.isNegative() ||
    remainingAmount.isNegative() ||
    !allocatedAmount.plus(remainingAmount).equals(originalAmount) ||
    allocatedAmount.lessThan(allocationAmount) ||
    remainingAmount.plus(allocationAmount).greaterThan(originalAmount) ||
    !["OPEN", "PARTIALLY_PAID", "PAID"].includes(document.status) ||
    document.status !== expectedStatus
  ) {
    fail("Supplier bill allocation and current document balances do not match this settlement.", 409, "PAYABLE_BILL_BALANCE_MISMATCH");
  }

  const priorReversal = await tx.accountingAllocation.findMany({
    where: { reversesAllocationId: { in: [allocation.id] } },
    select: { id: true },
  });
  const reversalKey = `SETTLEMENT_CORRECTION_ALLOCATION:${cashTransaction.id}`;
  const keyedReversal = await tx.accountingAllocation.findUnique({
    where: { idempotencyKey: reversalKey },
  });
  if (priorReversal.length || keyedReversal) {
    fail("The supplier bill allocation has already been reversed.", 409, "PAYABLE_BILL_ALLOCATION_ALREADY_REVERSED");
  }

  return {
    document,
    allocation,
    allocationAmount,
    originalAmount,
    allocatedAmount,
    remainingAmount,
    reversalKey,
  };
};

const correctMarketingCpaPayableTransaction = async ({
  tx,
  recordId,
  payoutId,
  correctionMode,
  reason,
  proofReference,
  actorAccountId,
  actorEmail,
  actorContext,
  reverseJournal,
  writeAudit,
}) => {
  if (correctionMode !== "RETURNED_FUNDS") {
    fail("A confirmed Marketing CPA payout can only be corrected after returned funds are evidenced.", 409, "CPA_PAYOUT_CANNOT_BE_VOIDED");
  }
  const document = await tx.accountingDocument.findUnique({
    where: { id: recordId },
    include: { party: true },
  });
  if (
    !document ||
    document.documentType !== "BILL" ||
    document.side !== "PAYABLE" ||
    document.sourceType !== "MARKETING_CPA" ||
    document.currency !== "NPR" ||
    document.party?.partyType !== "MARKETING_PARTNER" ||
    !["OPEN", "PARTIALLY_PAID", "PAID"].includes(document.status)
  ) {
    fail("Marketing CPA payable bill was not found or is unsupported.", 404, "CPA_PAYABLE_NOT_FOUND");
  }
  if (!payoutId) {
    fail("Select the specific Marketing CPA payout to correct.", 400, "CPA_PAYOUT_ID_REQUIRED");
  }
  const pendingPayout = await tx.financialPayout.findFirst({
    where: {
      targetType: "MARKETING_CPA_PAYABLE",
      targetId: document.id,
      status: "INITIATED",
    },
  });
  if (pendingPayout) {
    fail("An initiated Marketing CPA payout must be confirmed or marked failed before correcting a prior payment.", 409, "CPA_PAYOUT_PENDING");
  }

  const payout = await tx.financialPayout.findUnique({ where: { id: payoutId } });
  if (
    !payout ||
    payout.targetType !== "MARKETING_CPA_PAYABLE" ||
    payout.targetId !== document.id ||
    payout.status !== "SETTLED" ||
    !payout.bankEvidenceReference
  ) {
    fail("No evidenced settled Marketing CPA payout is available to correct.", 409, "CPA_PAYOUT_NOT_SETTLED");
  }
  const cashTransaction = await tx.cashTransaction.findUnique({
    where: { idempotencyKey: payout.idempotencyKey },
  });
  if (
    !cashTransaction ||
    cashTransaction.type !== "OUTFLOW" ||
    cashTransaction.category !== "MARKETING_CPA_PAYOUT" ||
    cashTransaction.referenceId !== document.id
  ) {
    fail("The Marketing CPA payout cash transaction does not match the bill.", 409, "SETTLEMENT_CASH_TRANSACTION_MISMATCH");
  }
  const existing = await tx.settlementReversion.findFirst({
    where: {
      reversionType: "MARKETING_CPA_PAYABLE",
      cashTransactionId: cashTransaction.id,
    },
  });
  if (existing) fail("This Marketing CPA payout has already been corrected.", 409, "SETTLEMENT_ALREADY_CORRECTED");

  const allocation = await tx.accountingAllocation.findUnique({
    where: { idempotencyKey: `MARKETING_CPA_PAYOUT:${payout.id}` },
  });
  if (
    !allocation ||
    allocation.documentId !== document.id ||
    allocation.allocationType !== "CASH"
  ) {
    fail("The bill's cash allocation does not match the payout; reconcile it before correcting.", 409, "CPA_PAYOUT_ALLOCATION_MISMATCH");
  }
  const cashAmount = new Prisma.Decimal(String(cashTransaction.amount));
  const allocatedAmount = new Prisma.Decimal(String(document.allocatedAmount));
  const priorRemaining = new Prisma.Decimal(String(document.remainingAmount));
  const originalAmount = new Prisma.Decimal(String(document.originalAmount));
  if (
    !cashAmount.isFinite() ||
    cashAmount.lessThanOrEqualTo(0) ||
    !new Prisma.Decimal(String(payout.amount)).equals(cashAmount) ||
    !new Prisma.Decimal(String(allocation.amount)).equals(cashAmount) ||
    allocatedAmount.lessThan(cashAmount) ||
    priorRemaining.plus(cashAmount).greaterThan(originalAmount)
  ) {
    fail("Marketing CPA payout amounts do not match the current bill balance.", 409, "SETTLEMENT_BALANCE_MISMATCH");
  }
  const originalJournal = await tx.journalEntry.findFirst({
    where: {
      idempotencyKey: `MARKETING_CPA_PAYMENT:${payout.id}`,
      sourceType: "MARKETING_CPA_PAYMENT",
      sourceId: payout.id,
      status: "POSTED",
    },
    select: { id: true, sourceType: true, sourceId: true, status: true },
  });
  if (!originalJournal) {
    fail("A posted payout journal is required; reconcile the accounting event before correcting it.", 409, "SETTLEMENT_JOURNAL_NOT_POSTED");
  }

  const accountId = cashTransaction.fromAccountId;
  if (!accountId) fail("The original payout has no linked Treasury account.", 409, "SETTLEMENT_TREASURY_ACCOUNT_MISSING");
  await tx.financialAccount.update({
    where: { id: accountId },
    data: { currentBalance: { increment: cashAmount } },
  });
  const reversalTransaction = await tx.cashTransaction.create({
    data: {
      idempotencyKey: `SETTLEMENT_CORRECTION:${cashTransaction.id}`,
      externalPaymentReference: proofReference,
      amount: cashAmount,
      type: "INFLOW",
      toAccountId: accountId,
      category: "REFUND",
      referenceId: document.id,
      partyName: document.party.displayName,
      description: `RETURNED FUNDS: Marketing CPA payout correction. Evidence: ${proofReference}. Reason: ${reason}`,
    },
  });
  const reversalJournal = await reverseJournal({
    journalEntryId: originalJournal.id,
    expectedSourceType: "MARKETING_CPA_PAYMENT",
    expectedSourceId: payout.id,
    reversalReason: reason,
    reversedBy: actorAccountId,
    actorContext,
    client: tx,
  });
  const nextAllocated = allocatedAmount.minus(cashAmount);
  const nextRemaining = priorRemaining.plus(cashAmount);
  const nextStatus = nextRemaining.isZero() ? "PAID" : nextAllocated.isZero() ? "OPEN" : "PARTIALLY_PAID";
  const updatedDocument = await tx.accountingDocument.updateMany({
    where: {
      id: document.id,
      allocatedAmount: document.allocatedAmount,
      remainingAmount: document.remainingAmount,
      status: document.status,
    },
    data: {
      allocatedAmount: nextAllocated,
      remainingAmount: nextRemaining,
      status: nextStatus,
    },
  });
  if (updatedDocument.count !== 1) {
    fail("Marketing CPA bill changed during correction; refresh and retry.", 409, "SETTLEMENT_CORRECTION_CONFLICT");
  }
  await tx.accountingAllocation.create({
    data: {
      documentId: document.id,
      journalEntryId: reversalJournal.id,
      allocationType: "REVERSAL",
      amount: cashAmount,
      notes: `Reverses payout ${payout.id}; evidence ${proofReference}`,
      idempotencyKey: `MARKETING_CPA_PAYOUT_REVERSAL:${payout.id}`,
    },
  });
  const payoutUpdate = await tx.financialPayout.updateMany({
    where: { id: payout.id, status: "SETTLED" },
    data: { status: "REVERSED" },
  });
  if (payoutUpdate.count !== 1) {
    fail("The linked payout changed during correction; refresh and retry.", 409, "SETTLEMENT_PAYOUT_CONFLICT");
  }
  const account = await tx.financialAccount.findUnique({
    where: { id: accountId },
    select: { accountName: true },
  });
  await tx.settlementReversion.create({
    data: {
      reversionType: "MARKETING_CPA_PAYABLE",
      originalRecordId: document.id,
      cashTransactionId: cashTransaction.id,
      reversalTransactionId: reversalTransaction.id,
      reversalJournalEntryId: reversalJournal.id,
      originalAmount: cashAmount,
      partyName: document.party.displayName,
      accountId,
      accountName: account?.accountName || null,
      priorStatus: document.status,
      restoredStatus: nextStatus,
      priorPaidAmount: allocatedAmount,
      priorRemainingBalance: priorRemaining,
      revertedByAdminId: actorAccountId,
      revertedByEmail: actorEmail || null,
      revertReason: reason,
      correctionMode,
      evidenceReference: proofReference,
    },
  });
  await writeAudit({ ...actorContext, actorId: actorAccountId }, {
    action: "MARKETING_CPA_PAYOUT_CORRECTED",
    entityType: "AccountingDocument",
    entityId: document.id,
    beforeState: {
      status: document.status,
      allocatedAmount: allocatedAmount.toFixed(2),
      remainingAmount: priorRemaining.toFixed(2),
    },
    afterState: {
      status: nextStatus,
      allocatedAmount: nextAllocated.toFixed(2),
      remainingAmount: nextRemaining.toFixed(2),
      payoutId: payout.id,
      correctionMode,
      evidenceReference: proofReference,
      reversalTransactionId: reversalTransaction.id,
      reversalJournalEntryId: reversalJournal.id,
      reason,
    },
  }, { client: tx });

  return {
    correctionMode,
    restoredStatus: nextStatus,
    paidAmount: nextAllocated.toFixed(2),
    remainingBalance: nextRemaining.toFixed(2),
    reversalTransactionId: reversalTransaction.id,
    reversalJournalEntryId: reversalJournal.id,
  };
};

export const correctSettledTransaction = async ({
  type,
  recordId,
  payoutId = null,
  correctionMode,
  correctionReason,
  evidenceReference,
  actorAccountId,
  actorEmail,
  actorContext = {},
  cashTransactionId = null,
  client = prisma,
  reverseJournal = reverseSettlementJournalEntry,
  reverseReceipt = reverseCustomerReceipt,
  writeAudit = recordSystemAudit,
} = {}) => {
  if (!["PAYABLE", "RECEIVABLE", "MARKETING_CPA_PAYABLE"].includes(type)) {
    fail("This settlement type cannot use the correction workflow.", 400, "UNSUPPORTED_SETTLEMENT_TYPE");
  }
  if (!["VOID_NOT_EXECUTED", "RETURNED_FUNDS"].includes(correctionMode)) {
    fail("Choose whether the original cash movement was not executed or the funds were actually returned.", 400, "SETTLEMENT_CORRECTION_MODE_REQUIRED");
  }
  const reason = typeof correctionReason === "string" ? correctionReason.trim() : "";
  if (reason.length < 3) {
    fail("A correction reason of at least three characters is required.", 400, "SETTLEMENT_CORRECTION_REASON_REQUIRED");
  }
  const proofReference = requireExternalPaymentReference(evidenceReference);
  if (!actorAccountId) {
    fail("An authenticated Admin account is required to correct a settlement.", 401, "SETTLEMENT_CORRECTION_ACTOR_REQUIRED");
  }
  if (!recordId) {
    fail("A settlement record ID is required.", 400, "SETTLEMENT_RECORD_REQUIRED");
  }

  const execute = async (tx) => {
    if (type === "RECEIVABLE" && cashTransactionId && tx.cashTransaction?.findUnique) {
      const receipt = await tx.cashTransaction.findUnique({ where: { id: cashTransactionId } });
      if (receipt?.category === "RECEIVABLE_COLLECTION") {
        if (recordId !== receipt.id) {
          fail("A customer receipt correction must reference the same receipt ID as its source transaction.", 400, "CUSTOMER_RECEIPT_ID_MISMATCH");
        }
        return reverseReceipt({
          receiptId: receipt.id,
          correctionMode,
          correctionReason: reason,
          evidenceReference: proofReference,
          actorAccountId,
          actorEmail,
          actorContext,
          client: tx,
          reverseJournal,
          writeAudit,
        });
      }
    }
    if (type === "MARKETING_CPA_PAYABLE") {
      return correctMarketingCpaPayableTransaction({
        tx,
        recordId,
        payoutId,
        correctionMode,
        reason,
        proofReference,
        actorAccountId,
        actorEmail,
        actorContext,
        reverseJournal,
        writeAudit,
      });
    }
    if (type === "RECEIVABLE" && tx.accountingDocument?.findUnique) {
      const document = await tx.accountingDocument.findUnique({
        where: { id: recordId },
        select: {
          side: true,
          party: { select: { partyType: true } },
          allocations: {
            where: { allocationType: "CASH" },
            select: { cashTransaction: { select: { category: true } } },
          },
        },
      });
      if (
        document?.side === "RECEIVABLE" &&
        document.party?.partyType === "CUSTOMER" &&
        document.allocations.some((allocation) => allocation.cashTransaction?.category === "RECEIVABLE_COLLECTION")
      ) {
        fail(
          "Correct a source-linked customer receipt by its receipt ID, not by its invoice ID.",
          409,
          "CUSTOMER_RECEIPT_ID_REQUIRED",
        );
      }
    }
    const model = type === "PAYABLE" ? tx.accountPayable : tx.accountReceivable;
    const record = await model.findUnique({ where: { id: recordId } });
    if (!record) fail(`${type === "PAYABLE" ? "Payable" : "Receivable"} record was not found.`, 404, "SETTLEMENT_RECORD_NOT_FOUND");

    const existing = await tx.settlementReversion.findFirst({
      where: {
        reversionType: type,
        originalRecordId: record.id,
      },
    });
    if (existing) fail("This settlement record has already been reverted or corrected.", 409, "SETTLEMENT_ALREADY_CORRECTED");

    const historyField = type === "PAYABLE" ? "settlementHistory" : "collectionHistory";
    const history = parseHistory(record[historyField], type === "PAYABLE" ? "Payable settlement" : "Receivable collection");
    const expectedCashType = type === "PAYABLE" ? "OUTFLOW" : "INFLOW";
    const historyEntry = [...history].reverse().find((entry) => entry?.idempotencyKey);
    if (!historyEntry?.idempotencyKey) {
      fail("The latest settlement has no transaction reference and cannot be safely corrected.", 409, "SETTLEMENT_REFERENCE_MISSING");
    }

    const cashTransaction = cashTransactionId
      ? await tx.cashTransaction.findUnique({ where: { id: cashTransactionId } })
      : await tx.cashTransaction.findUnique({ where: { idempotencyKey: historyEntry.idempotencyKey } });
    if (
      !cashTransaction ||
      cashTransaction.type !== expectedCashType ||
      cashTransaction.idempotencyKey !== historyEntry.idempotencyKey ||
      ![record.id, record.referenceId].includes(cashTransaction.referenceId)
    ) {
      fail("The settlement cash transaction does not match the selected source record.", 409, "SETTLEMENT_CASH_TRANSACTION_MISMATCH");
    }

    const cashAmount = new Prisma.Decimal(String(cashTransaction.amount));
    const settlementAmount = new Prisma.Decimal(String(historyEntry.settlementAmount ?? historyEntry.amount ?? cashTransaction.amount));
    const total = new Prisma.Decimal(String(record.totalAmount));
    const priorPaid = new Prisma.Decimal(String(type === "PAYABLE" ? record.paidAmount : record.receivedAmount));
    const priorRemaining = new Prisma.Decimal(String(record.remainingBalance));
    if (
      !cashAmount.isFinite() || cashAmount.lessThanOrEqualTo(0) ||
      !settlementAmount.isFinite() || settlementAmount.lessThanOrEqualTo(0) ||
      cashAmount.greaterThan(priorPaid) ||
      settlementAmount.greaterThan(total.minus(priorRemaining))
    ) {
      fail("Settlement history no longer matches the current source balance; reconcile it before correcting.", 409, "SETTLEMENT_BALANCE_MISMATCH");
    }

    const expectedJournalSource = type === "PAYABLE" ? "SUPPLIER_PAYMENT" : "CUSTOMER_PAYMENT";
    const expectedJournalSourceId = type === "PAYABLE" ? record.id : (record.referenceId || record.id);
    const originalJournal = await tx.journalEntry.findFirst({
      where: {
        idempotencyKey: `${expectedJournalSource}:${cashTransaction.idempotencyKey}`,
        sourceType: expectedJournalSource,
        sourceId: expectedJournalSourceId,
        status: "POSTED",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, sourceType: true, sourceId: true, status: true },
    });
    if (!originalJournal || originalJournal.status !== "POSTED") {
      fail("A posted source-linked accounting journal is required; reconcile the accounting event before correcting this settlement.", 409, "SETTLEMENT_JOURNAL_NOT_POSTED");
    }

    let payout = null;
    if (type === "PAYABLE") {
      payout = await tx.financialPayout.findUnique({
        where: { idempotencyKey: cashTransaction.idempotencyKey },
      });
      if (payout && (payout.targetType !== "ACCOUNT_PAYABLE" || payout.targetId !== record.id || payout.status !== "SETTLED")) {
        fail("The linked financial payout is not in a correctable settled state.", 409, "SETTLEMENT_PAYOUT_STATE_INVALID");
      }
      if (correctionMode === "VOID_NOT_EXECUTED" && payout?.status === "SETTLED") {
        fail("This payout has confirmed bank evidence; record returned funds instead of voiding it as unexecuted.", 409, "SETTLED_PAYOUT_CANNOT_BE_VOIDED");
      }
    }
    const payableBillAllocation = type === "PAYABLE"
      ? await resolvePayableBillAllocation({
          tx,
          payable: record,
          payout,
          cashTransaction,
          originalJournal,
          settlementAmount,
        })
      : null;

    const accountId = type === "PAYABLE" ? cashTransaction.fromAccountId : cashTransaction.toAccountId;
    if (!accountId) fail("The original settlement has no linked treasury account.", 409, "SETTLEMENT_TREASURY_ACCOUNT_MISSING");
    if (type === "PAYABLE") {
      await tx.financialAccount.update({
        where: { id: accountId },
        data: { currentBalance: { increment: cashAmount } },
      });
    } else {
      const debited = await tx.financialAccount.updateMany({
        where: { id: accountId, currentBalance: { gte: cashAmount } },
        data: { currentBalance: { decrement: cashAmount } },
      });
      if (debited.count !== 1) {
        fail("The treasury account does not have enough balance to record the returned collection.", 409, "INSUFFICIENT_TREASURY_BALANCE");
      }
    }

    const reversalType = type === "PAYABLE" ? "INFLOW" : "OUTFLOW";
    const reversalTransaction = await tx.cashTransaction.create({
      data: {
        idempotencyKey: `SETTLEMENT_CORRECTION:${cashTransaction.id}`,
        externalPaymentReference: proofReference,
        amount: cashAmount,
        type: reversalType,
        ...(type === "PAYABLE" ? { toAccountId: accountId } : { fromAccountId: accountId }),
        category: "REFUND",
        referenceId: record.id,
        partyName: type === "PAYABLE" ? record.payeeName : record.payerName,
        description: `${correctionMode === "VOID_NOT_EXECUTED" ? "VOID" : "RETURNED FUNDS"}: ${type} settlement correction. Evidence: ${proofReference}. Reason: ${reason}`,
      },
    });

    const reversalJournal = await reverseJournal({
      journalEntryId: originalJournal.id,
      expectedSourceType: expectedJournalSource,
      expectedSourceId: expectedJournalSourceId,
      reversalReason: reason,
      reversedBy: actorAccountId,
      actorContext,
      client: tx,
    });

    const nextPaid = priorPaid.minus(cashAmount);
    const nextRemaining = priorRemaining.plus(settlementAmount);
    const nextStatus = nextRemaining.greaterThanOrEqualTo(total)
      ? "UNPAID"
      : (type === "PAYABLE" ? "PARTIALLY_PAID" : "PARTIALLY_RECEIVED");
    const nextHistory = [...history];
    const historyIndex = nextHistory.findIndex((entry) => entry?.idempotencyKey === cashTransaction.idempotencyKey);
    if (historyIndex < 0) fail("The settlement history changed during correction.", 409, "SETTLEMENT_HISTORY_CONFLICT");
    nextHistory.splice(historyIndex, 1);
    const updated = await model.updateMany({
      where: {
        id: record.id,
        ...(type === "PAYABLE" ? { paidAmount: record.paidAmount } : { receivedAmount: record.receivedAmount }),
        remainingBalance: record.remainingBalance,
        status: record.status,
      },
      data: type === "PAYABLE"
        ? { paidAmount: nextPaid, remainingBalance: nextRemaining, status: nextStatus, settlementHistory: nextHistory }
        : { receivedAmount: nextPaid, remainingBalance: nextRemaining, status: nextStatus, collectionHistory: nextHistory },
    });
    if (updated.count !== 1) fail("Settlement source changed during correction; refresh and retry.", 409, "SETTLEMENT_CORRECTION_CONFLICT");

    if (payableBillAllocation) {
      const {
        document,
        allocation,
        allocationAmount,
        originalAmount,
        allocatedAmount,
        remainingAmount,
        reversalKey,
      } = payableBillAllocation;
      const nextAllocatedAmount = allocatedAmount.minus(allocationAmount);
      const nextRemainingAmount = remainingAmount.plus(allocationAmount);
      const nextDocumentStatus = nextRemainingAmount.isZero()
        ? "PAID"
        : nextAllocatedAmount.isZero()
          ? "OPEN"
          : "PARTIALLY_PAID";
      const documentUpdate = await tx.accountingDocument.updateMany({
        where: {
          id: document.id,
          allocatedAmount: document.allocatedAmount,
          remainingAmount: document.remainingAmount,
          status: document.status,
        },
        data: {
          allocatedAmount: nextAllocatedAmount,
          remainingAmount: nextRemainingAmount,
          status: nextDocumentStatus,
        },
      });
      if (documentUpdate.count !== 1 || nextRemainingAmount.greaterThan(originalAmount)) {
        fail("Supplier bill changed during correction; refresh and retry.", 409, "PAYABLE_BILL_BALANCE_CONFLICT");
      }
      await tx.accountingAllocation.create({
        data: {
          documentId: document.id,
          cashTransactionId: reversalTransaction.id,
          journalEntryId: reversalJournal.id,
          allocationType: "REVERSAL",
          amount: allocationAmount,
          reversesAllocationId: allocation.id,
          notes: `Reverses payable settlement ${cashTransaction.id}; evidence ${proofReference}; reason ${reason}`,
          idempotencyKey: reversalKey,
        },
      });
    }

    if (payout && correctionMode === "RETURNED_FUNDS") {
      const payoutUpdated = await tx.financialPayout.updateMany({
        where: { id: payout.id, status: "SETTLED" },
        data: { status: "REVERSED" },
      });
      if (payoutUpdated.count !== 1) fail("The linked payout changed during correction; refresh and retry.", 409, "SETTLEMENT_PAYOUT_CONFLICT");
    }

    const account = await tx.financialAccount.findUnique({
      where: { id: accountId },
      select: { accountName: true },
    });
    await tx.settlementReversion.create({
      data: {
        reversionType: type,
        originalRecordId: record.id,
        cashTransactionId: cashTransaction.id,
        reversalTransactionId: reversalTransaction.id,
        reversalJournalEntryId: reversalJournal.id,
        originalAmount: cashAmount,
        partyName: type === "PAYABLE" ? record.payeeName : record.payerName,
        accountId,
        accountName: account?.accountName || null,
        priorStatus: record.status,
        restoredStatus: nextStatus,
        priorPaidAmount: priorPaid,
        priorRemainingBalance: priorRemaining,
        revertedByAdminId: actorAccountId,
        revertedByEmail: actorEmail || null,
        revertReason: reason,
        correctionMode,
        evidenceReference: proofReference,
      },
    });

    await writeAudit({ ...actorContext, actorId: actorAccountId }, {
      action: "SETTLEMENT_CORRECTED",
      entityType: type === "PAYABLE" ? "AccountPayable" : "AccountReceivable",
      entityId: record.id,
      beforeState: {
        status: record.status,
        paidAmount: priorPaid.toFixed(2),
        remainingBalance: priorRemaining.toFixed(2),
      },
      afterState: {
        status: nextStatus,
        paidAmount: nextPaid.toFixed(2),
        remainingBalance: nextRemaining.toFixed(2),
        correctionMode,
        evidenceReference: proofReference,
        cashTransactionId: cashTransaction.id,
        reversalTransactionId: reversalTransaction.id,
        reversalJournalEntryId: reversalJournal.id,
        ...(payableBillAllocation
          ? {
              supplierBillDocumentId: payableBillAllocation.document.id,
              reversedAllocationId: payableBillAllocation.allocation.id,
              reversedAllocationAmount: payableBillAllocation.allocationAmount.toFixed(2),
            }
          : {}),
        reason,
      },
    }, { client: tx });

    return {
      correctionMode,
      restoredStatus: nextStatus,
      paidAmount: nextPaid.toFixed(2),
      remainingBalance: nextRemaining.toFixed(2),
      reversalTransactionId: reversalTransaction.id,
      reversalJournalEntryId: reversalJournal.id,
    };
  };

  return typeof client.$transaction === "function"
    ? client.$transaction(execute, { isolationLevel: "Serializable" })
    : execute(client);
};
