import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";
import { parseNprAmountString } from "./accountingDecimal.js";

const fail = (message, statusCode = 400, code = "SUPPLIER_CREDIT_APPLICATION_INVALID") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const parseAmount = (value) => {
  try {
    return parseNprAmountString(value, "Credit application amount", { allowZero: false });
  } catch (error) {
    throw fail(error.message || "Credit application amount must be greater than zero.", 400, "INVALID_AMOUNT");
  }
};

const validateApplicationOwnership = ({ application, supplierReturnId, creditDocumentId, billDocumentId, amount }) => {
  if (
    application.supplierReturnId !== supplierReturnId ||
    application.creditDocumentId !== creditDocumentId ||
    application.billDocumentId !== billDocumentId ||
    !new Prisma.Decimal(String(application.amount)).equals(amount)
  ) {
    throw fail("This idempotency key was already used for a different supplier credit application.", 409, "IDEMPOTENCY_KEY_REUSED");
  }
};

const findCreditContext = async (tx, supplierReturnId) => {
  const supplierReturn = await tx.supplierReturn.findUnique({ where: { id: supplierReturnId } });
  if (!supplierReturn || supplierReturn.status !== "COMPLETED") {
    throw fail("A completed supplier return is required.", 404, "SUPPLIER_RETURN_NOT_FOUND");
  }
  if (
    supplierReturn.settlementType !== "CREDIT_NOTE_OFFSET_PAYABLE" ||
    !supplierReturn.accountingDocumentId ||
    !supplierReturn.accountingJournalEntryId
  ) {
    throw fail("This supplier return has no verified payable credit note to apply.", 409, "SUPPLIER_CREDIT_NOT_APPLICABLE");
  }

  const [credit, journal] = await Promise.all([
    tx.accountingDocument.findUnique({
      where: { id: supplierReturn.accountingDocumentId },
      include: { party: true },
    }),
    tx.journalEntry.findUnique({
      where: { id: supplierReturn.accountingJournalEntryId },
      include: {
        lines: {
          include: {
            account: { select: { accountCode: true } },
            accountingParty: { select: { partyType: true, sourceEntityId: true } },
          },
        },
      },
    }),
  ]);
  const returnAmount = new Prisma.Decimal(String(supplierReturn.totalDebitAmount));
  const validApLine = journal?.lines?.some((line) =>
    line.account?.accountCode === "2110" &&
    line.accountingParty?.partyType === "VENDOR" &&
    line.accountingParty.sourceEntityId === supplierReturn.supplierReference &&
    new Prisma.Decimal(String(line.debit || 0)).equals(returnAmount)
  );
  if (
    !credit ||
    credit.documentType !== "CREDIT_NOTE" ||
    credit.side !== "PAYABLE" ||
    credit.sourceType !== "SUPPLIER_RETURN" ||
    credit.sourceId !== supplierReturn.id ||
    credit.party?.partyType !== "VENDOR" ||
    credit.party.sourceEntityId !== supplierReturn.supplierReference ||
    !new Prisma.Decimal(String(credit.originalAmount)).equals(returnAmount) ||
    !journal ||
    journal.status !== "POSTED" ||
    journal.sourceType !== "SUPPLIER_RETURN" ||
    journal.sourceId !== supplierReturn.id ||
    !new Prisma.Decimal(String(journal.totalDebit)).equals(returnAmount) ||
    !new Prisma.Decimal(String(journal.totalCredit)).equals(returnAmount) ||
    !validApLine
  ) {
    throw fail("The supplier credit note and its posted payable reversal do not match the return record.", 409, "SUPPLIER_RETURN_ACCOUNTING_MISMATCH");
  }
  return { supplierReturn, credit, journal };
};

export const getSupplierReturnApplicableBills = async ({ supplierReturnId, client = prisma } = {}) => {
  const { supplierReturn, credit } = await findCreditContext(client, supplierReturnId);
  const creditSummary = {
    id: credit.id,
    documentNumber: credit.documentNumber,
    remainingAmount: credit.remainingAmount,
    currency: credit.currency,
    status: credit.status,
  };
  if (!["OPEN", "PARTIALLY_PAID"].includes(credit.status) || !new Prisma.Decimal(String(credit.remainingAmount)).isPositive()) {
    return { credit: creditSummary, bills: [] };
  }
  const bills = await client.accountingDocument.findMany({
    where: {
      partyId: credit.partyId,
      documentType: "BILL",
      side: "PAYABLE",
      currency: credit.currency,
      issueDate: { gte: supplierReturn.returnDate },
      status: { in: ["OPEN", "PARTIALLY_PAID"] },
      remainingAmount: { gt: 0 },
      NOT: { sourceType: "SUPPLIER_RETURN", sourceId: supplierReturnId },
    },
    select: {
      id: true,
      documentNumber: true,
      issueDate: true,
      currency: true,
      originalAmount: true,
      remainingAmount: true,
      status: true,
      sourceType: true,
      sourceId: true,
    },
    orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
  });
  return {
    credit: creditSummary,
    bills,
  };
};

export const applySupplierReturnCreditToBill = async ({
  supplierReturnId,
  billDocumentId,
  amount,
  idempotencyKey,
  appliedByAccountId = null,
  notes,
  client = prisma,
  writeAudit = recordSystemAudit,
} = {}) => {
  const key = String(idempotencyKey || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,170}$/.test(key)) {
    throw fail("A valid credit-application idempotency key is required.", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  if (!supplierReturnId || !billDocumentId) {
    throw fail("A supplier return and bill must be selected.", 400, "INVALID_CREDIT_APPLICATION_DOCUMENTS");
  }
  const applicationAmount = parseAmount(amount);
  const normalizedNotes = String(notes || "").trim();
  if (!normalizedNotes || normalizedNotes.length > 1000) {
    throw fail("Application notes are required and must be 1000 characters or fewer.", 400, "APPLICATION_NOTES_REQUIRED");
  }

  const execute = async (tx) => {
    const existing = await tx.supplierReturnCreditApplication.findUnique({ where: { idempotencyKey: key } });
    const { supplierReturn, credit, journal } = await findCreditContext(tx, supplierReturnId);
    if (existing) {
      validateApplicationOwnership({
        application: existing,
        supplierReturnId,
        creditDocumentId: credit.id,
        billDocumentId,
        amount: applicationAmount,
      });
      return { success: true, application: existing, isReplay: true };
    }

    const bill = await tx.accountingDocument.findUnique({
      where: { id: billDocumentId },
      include: { party: true },
    });
    if (
      !bill ||
      bill.documentType !== "BILL" ||
      bill.side !== "PAYABLE" ||
      !["OPEN", "PARTIALLY_PAID"].includes(bill.status) ||
      bill.partyId !== credit.partyId ||
      bill.party?.partyType !== "VENDOR" ||
      bill.party.sourceEntityId !== supplierReturn.supplierReference ||
      bill.currency !== credit.currency ||
      bill.issueDate < supplierReturn.returnDate ||
      (bill.sourceType === "SUPPLIER_RETURN" && bill.sourceId === supplierReturn.id)
    ) {
      throw fail("Select an open bill issued on or after this return for the same supplier and currency.", 409, "SUPPLIER_BILL_PARTY_MISMATCH");
    }

    const creditRemaining = new Prisma.Decimal(String(credit.remainingAmount));
    const billRemaining = new Prisma.Decimal(String(bill.remainingAmount));
    if (
      !["OPEN", "PARTIALLY_PAID"].includes(credit.status) ||
      !creditRemaining.isPositive() ||
      applicationAmount.greaterThan(creditRemaining) ||
      applicationAmount.greaterThan(billRemaining)
    ) {
      throw fail("Application cannot exceed the remaining credit or bill balance.", 409, "CREDIT_APPLICATION_EXCEEDS_BALANCE");
    }
    const payable = bill.sourceType === "OPERATING_EXPENSE"
      ? await tx.accountPayable.findFirst({
        where: {
          referenceType: "EXPENSE",
          referenceId: bill.sourceId,
          accountingPartyId: bill.partyId,
        },
      })
      : null;
    if (
      bill.sourceType === "OPERATING_EXPENSE" &&
      (
        !payable ||
        !["UNPAID", "PARTIALLY_PAID"].includes(payable.status) ||
        !new Prisma.Decimal(String(payable.remainingBalance)).equals(billRemaining)
      )
    ) {
      throw fail("The operating-expense payable and supplier bill are not reconciled; reconcile them before applying credit.", 409, "SUPPLIER_AP_RECONCILIATION_REQUIRED");
    }

    const newCreditAllocated = new Prisma.Decimal(String(credit.allocatedAmount)).plus(applicationAmount);
    const newCreditRemaining = creditRemaining.minus(applicationAmount);
    const newBillAllocated = new Prisma.Decimal(String(bill.allocatedAmount)).plus(applicationAmount);
    const newBillRemaining = billRemaining.minus(applicationAmount);
    const nextCreditStatus = newCreditRemaining.isZero() ? "PAID" : "PARTIALLY_PAID";
    const nextBillStatus = newBillRemaining.isZero() ? "PAID" : "PARTIALLY_PAID";
    const newPayableCreditApplied = payable
      ? new Prisma.Decimal(String(payable.creditAppliedAmount || 0)).plus(applicationAmount)
      : null;
    const newPayableRemaining = payable
      ? new Prisma.Decimal(String(payable.remainingBalance)).minus(applicationAmount)
      : null;
    const nextPayableStatus = payable
      ? newPayableRemaining.isZero()
        ? "SETTLED"
        : new Prisma.Decimal(String(payable.paidAmount || 0)).isPositive() || newPayableCreditApplied.isPositive()
          ? "PARTIALLY_PAID"
          : "UNPAID"
      : null;

    const [creditClaim, billClaim, payableClaim] = await Promise.all([
      tx.accountingDocument.updateMany({
        where: {
          id: credit.id,
          allocatedAmount: credit.allocatedAmount,
          remainingAmount: credit.remainingAmount,
          status: credit.status,
        },
        data: {
          allocatedAmount: newCreditAllocated,
          remainingAmount: newCreditRemaining,
          status: nextCreditStatus,
        },
      }),
      tx.accountingDocument.updateMany({
        where: {
          id: bill.id,
          allocatedAmount: bill.allocatedAmount,
          remainingAmount: bill.remainingAmount,
          status: bill.status,
        },
        data: {
          allocatedAmount: newBillAllocated,
          remainingAmount: newBillRemaining,
          status: nextBillStatus,
        },
      }),
      payable
        ? tx.accountPayable.updateMany({
          where: {
            id: payable.id,
            remainingBalance: payable.remainingBalance,
            creditAppliedAmount: payable.creditAppliedAmount,
            status: payable.status,
          },
          data: {
            remainingBalance: newPayableRemaining,
            creditAppliedAmount: newPayableCreditApplied,
            status: nextPayableStatus,
          },
        })
        : Promise.resolve({ count: 1 }),
    ]);
    if (creditClaim.count !== 1 || billClaim.count !== 1 || payableClaim.count !== 1) {
      throw fail("Supplier credit or bill changed during application; refresh and retry.", 409, "CREDIT_APPLICATION_CONCURRENCY_CONFLICT");
    }

    const application = await tx.supplierReturnCreditApplication.create({
      data: {
        id: randomUUID(),
        idempotencyKey: key,
        supplierReturnId,
        creditDocumentId: credit.id,
        billDocumentId: bill.id,
        journalEntryId: journal.id,
        amount: applicationAmount,
        appliedByAccountId,
        notes: normalizedNotes,
      },
    });
    await tx.accountingAllocation.createMany({
      data: [
        {
          documentId: credit.id,
          journalEntryId: journal.id,
          allocationType: "OFFSET",
          amount: applicationAmount,
          notes: `Applied to supplier bill ${bill.documentNumber}: ${normalizedNotes}`,
          idempotencyKey: `${key}:CREDIT`,
        },
        {
          documentId: bill.id,
          journalEntryId: journal.id,
          allocationType: "OFFSET",
          amount: applicationAmount,
          notes: `Settled by supplier credit ${credit.documentNumber}: ${normalizedNotes}`,
          idempotencyKey: `${key}:BILL`,
        },
      ],
    });
    await writeAudit(
      { actorId: appliedByAccountId, actorRole: "ADMIN", portalSource: "ADMIN" },
      {
        action: "SUPPLIER_RETURN_CREDIT_APPLIED",
        entityType: "SupplierReturnCreditApplication",
        entityId: application.id,
        beforeState: {
          creditRemaining: creditRemaining.toFixed(2),
          billRemaining: billRemaining.toFixed(2),
        },
        afterState: {
          supplierReturnId,
          creditDocumentId: credit.id,
          billDocumentId: bill.id,
          journalEntryId: journal.id,
          amount: applicationAmount.toFixed(2),
          creditRemaining: newCreditRemaining.toFixed(2),
          billRemaining: newBillRemaining.toFixed(2),
          payableRemaining: newPayableRemaining?.toFixed(2) || null,
          journalPostedForApplication: false,
        },
      },
      { client: tx },
    );

    return {
      success: true,
      application,
      credit: { id: credit.id, remainingAmount: newCreditRemaining, status: nextCreditStatus },
      bill: { id: bill.id, remainingAmount: newBillRemaining, status: nextBillStatus },
      payable: payable
        ? { id: payable.id, remainingBalance: newPayableRemaining, creditAppliedAmount: newPayableCreditApplied, status: nextPayableStatus }
        : null,
      journalEntryId: journal.id,
      journalPostedForApplication: false,
    };
  };

  for (let attempt = 0; ; attempt += 1) {
    try {
      return typeof client.$transaction === "function"
        ? await client.$transaction(execute, { isolationLevel: "Serializable" })
        : await execute(client);
    } catch (error) {
      if (["P2002", "P2034"].includes(error?.code)) {
        const existing = await client.supplierReturnCreditApplication.findUnique({ where: { idempotencyKey: key } });
        if (existing) {
          const { credit } = await findCreditContext(client, supplierReturnId);
          validateApplicationOwnership({
            application: existing,
            supplierReturnId,
            creditDocumentId: credit.id,
            billDocumentId,
            amount: applicationAmount,
          });
          return { success: true, application: existing, isReplay: true };
        }
      }
      if (error?.code !== "P2034" || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
};

const decimalEquals = (left, right) => {
  try {
    return new Prisma.Decimal(String(left ?? 0)).equals(new Prisma.Decimal(String(right ?? 0)));
  } catch {
    return false;
  }
};

export const getSupplierReturnReconciliation = async ({ client = prisma } = {}) => {
  const returns = await client.supplierReturn.findMany({ orderBy: [{ returnDate: "asc" }, { id: "asc" }] });
  if (!returns.length) return { total: 0, summary: {}, records: [] };
  const ids = returns.map(({ id }) => id);
  const journalIds = returns.map(({ accountingJournalEntryId }) => accountingJournalEntryId).filter(Boolean);
  const documentIds = returns.map(({ accountingDocumentId }) => accountingDocumentId).filter(Boolean);
  const cashIds = returns.map(({ cashTransactionId }) => cashTransactionId).filter(Boolean);
  const [documents, journals, cashTransactions, legacyReceivables] = await Promise.all([
    client.accountingDocument.findMany({
      where: { OR: [{ id: { in: documentIds } }, { sourceType: "SUPPLIER_RETURN", sourceId: { in: ids } }] },
      include: { party: { select: { partyType: true, sourceEntityId: true } } },
    }),
    client.journalEntry.findMany({
      where: { OR: [{ id: { in: journalIds } }, { sourceType: "SUPPLIER_RETURN", sourceId: { in: ids } }] },
      include: {
        lines: {
          include: {
            account: { select: { accountCode: true } },
            accountingParty: { select: { partyType: true, sourceEntityId: true } },
          },
        },
      },
    }),
    client.cashTransaction.findMany({
      where: { OR: [{ id: { in: cashIds } }, { referenceId: { in: ids } }] },
      include: { toAccount: { select: { accountingAccountId: true } } },
    }),
    client.accountReceivable.findMany({
      where: { referenceType: "SUPPLIER_RETURN", referenceId: { in: ids } },
      select: { id: true, referenceId: true, totalAmount: true, remainingBalance: true, status: true, category: true },
    }),
  ]);
  const findCandidates = (records, linkedId, matchesSource) => {
    const candidates = records.filter((record) =>
      (linkedId && record.id === linkedId) || matchesSource(record));
    return [...new Map(candidates.map((record) => [record.id, record])).values()];
  };
  const receivablesByReturnId = new Map();
  for (const receivable of legacyReceivables) {
    const candidates = receivablesByReturnId.get(receivable.referenceId) || [];
    candidates.push(receivable);
    receivablesByReturnId.set(receivable.referenceId, candidates);
  }
  const records = returns.map((record) => {
    const documentCandidates = findCandidates(
      documents,
      record.accountingDocumentId,
      (document) => document.sourceType === "SUPPLIER_RETURN" && document.sourceId === record.id,
    );
    const journalCandidates = findCandidates(
      journals,
      record.accountingJournalEntryId,
      (journal) => journal.sourceType === "SUPPLIER_RETURN" && journal.sourceId === record.id,
    );
    const cashCandidates = findCandidates(
      cashTransactions,
      record.cashTransactionId,
      (transaction) => transaction.referenceId === record.id,
    );
    const document = documentCandidates.length === 1 ? documentCandidates[0] : null;
    const journal = journalCandidates.length === 1 ? journalCandidates[0] : null;
    const cashTransaction = cashCandidates.length === 1 ? cashCandidates[0] : null;
    const legacyReceivableCandidates = receivablesByReturnId.get(record.id) || [];
    const legacyReceivable = legacyReceivableCandidates[0] || null;
    const amount = record.totalDebitAmount;
    const issues = [];
    if (documentCandidates.length > 1) issues.push("DUPLICATE_SUPPLIER_RETURN_CREDIT_NOTES");
    if (journalCandidates.length > 1) issues.push("DUPLICATE_SUPPLIER_RETURN_JOURNALS");
    if (cashCandidates.length > 1) issues.push("DUPLICATE_SUPPLIER_RETURN_CASH_TRANSACTIONS");
    if (legacyReceivableCandidates.length > 1) issues.push("DUPLICATE_LEGACY_RECEIVABLES");
    if (!record.supplierReference) issues.push("STABLE_SUPPLIER_REFERENCE_MISSING");
    if (new Prisma.Decimal(String(record.vatReversal || 0)).isPositive() && !record.supplierInvoiceNumber) {
      issues.push("VAT_SUPPORT_REFERENCE_MISSING");
    }
    if (legacyReceivable) issues.push("LEGACY_RECEIVABLE_REQUIRES_REVIEW");
    const settlementDebitMatches = record.settlementType === "CREDIT_NOTE_OFFSET_PAYABLE"
      ? journal?.lines?.some((line) =>
        line.account?.accountCode === "2110" &&
        line.accountingParty?.partyType === "VENDOR" &&
        line.accountingParty.sourceEntityId === record.supplierReference &&
        decimalEquals(line.debit, amount))
      : journal?.lines?.some((line) =>
        line.accountId === cashTransaction?.toAccount?.accountingAccountId &&
        line.accountingParty?.partyType === "VENDOR" &&
        line.accountingParty.sourceEntityId === record.supplierReference &&
        decimalEquals(line.debit, amount));
    const journalMatches = Boolean(journal &&
      journal.status === "POSTED" &&
      journal.sourceType === "SUPPLIER_RETURN" &&
      journal.sourceId === record.id &&
      decimalEquals(journal.totalDebit, amount) &&
      decimalEquals(journal.totalCredit, amount) &&
      settlementDebitMatches);
    const documentMatches = Boolean(document &&
      document.documentType === "CREDIT_NOTE" &&
      document.side === "PAYABLE" &&
      document.sourceType === "SUPPLIER_RETURN" &&
      document.sourceId === record.id &&
      decimalEquals(document.originalAmount, amount) &&
      document.party?.partyType === "VENDOR" &&
      document.party.sourceEntityId === record.supplierReference);
    const cashMatches = Boolean(cashTransaction &&
      cashTransaction.type === "INFLOW" &&
      cashTransaction.category === "SUPPLIER_PAYMENT" &&
      cashTransaction.referenceId === record.id &&
      decimalEquals(cashTransaction.amount, amount));
    let status;
    if (record.status === "CANCELLED") {
      status = "CANCELLED";
    } else if (
      documentCandidates.length > 1 ||
      journalCandidates.length > 1 ||
      cashCandidates.length > 1 ||
      legacyReceivableCandidates.length > 1
    ) {
      status = "DUPLICATE_SOURCE_EVIDENCE_REVIEW";
    } else if (record.settlementType === "CASH_REFUND" && cashMatches && journalMatches) {
      status = issues.length ? "RECONCILED_WITH_REVIEW" : "RECONCILED_CASH_REFUND";
    } else if (
      record.settlementType === "CREDIT_NOTE_OFFSET_PAYABLE" &&
      documentMatches &&
      journalMatches
    ) {
      status = legacyReceivable ? "DUPLICATE_LEGACY_RECEIVABLE_REVIEW" : "RECONCILED_SUPPLIER_CREDIT";
    } else if (
      record.settlementType === "CASH_REFUND" &&
      cashMatches &&
      !journalMatches
    ) {
      status = "LEGACY_CASH_REFUND_MISSING_JOURNAL";
    } else if (legacyReceivable) {
      status = decimalEquals(legacyReceivable.totalAmount, amount)
        ? "LEGACY_RECEIVABLE_RECLASSIFICATION_REVIEW"
        : "LEGACY_RECEIVABLE_AMOUNT_MISMATCH";
    } else if (cashTransaction || journal || document) {
      status = "ACCOUNTING_EVIDENCE_MISMATCH";
    } else {
      status = "MISSING_ACCOUNTING_EVIDENCE";
    }
    return {
      id: record.id,
      returnDate: record.returnDate,
      supplierName: record.supplierName,
      supplierReference: record.supplierReference,
      settlementType: record.settlementType,
      amount,
      status,
      issues,
      evidence: {
        journalEntryId: journal?.id || null,
        accountingDocumentId: document?.id || null,
        cashTransactionId: cashTransaction?.id || null,
        legacyReceivableId: legacyReceivable?.id || null,
        legacyReceivableCount: legacyReceivableCandidates.length,
        legacyReceivableRemaining: legacyReceivable?.remainingBalance ?? null,
      },
    };
  });
  const summary = records.reduce((counts, record) => {
    counts[record.status] = (counts[record.status] || 0) + 1;
    return counts;
  }, {});
  return { total: records.length, summary, records };
};
