import { prisma } from "../config/db.js";
import {
  accountingDecimal,
  addDecimals,
  compareDecimals,
} from "./accountingDecimal.js";
import { getPagination, getPaginationMeta } from "../utils/pagination.js";

const RECEIPT_FILTER = {
  type: "INFLOW",
  category: "RECEIVABLE_COLLECTION",
};

const sum = (values) => values.reduce(
  (total, value) => addDecimals(total, value ?? "0"),
  accountingDecimal("0"),
);

export const buildCustomerReceiptReconciliation = ({
  receipts = [],
  journals = [],
  reversions = [],
  reversalTransactions = [],
  reversalJournals = [],
  reversalAllocations = [],
  duplicateEvidenceReferences = [],
} = {}) => {
  const journalsBySourceId = new Map();
  for (const journal of journals) {
    const sourceJournals = journalsBySourceId.get(journal.sourceId) || [];
    sourceJournals.push(journal);
    journalsBySourceId.set(journal.sourceId, sourceJournals);
  }
  const reversionsByReceiptId = new Map();
  for (const reversion of reversions) {
    const receiptReversions = reversionsByReceiptId.get(reversion.originalRecordId) || [];
    receiptReversions.push(reversion);
    reversionsByReceiptId.set(reversion.originalRecordId, receiptReversions);
  }
  const reversalTransactionsById = new Map(reversalTransactions.map((transaction) => [transaction.id, transaction]));
  const reversalJournalsById = new Map(reversalJournals.map((journal) => [journal.id, journal]));
  const reversalAllocationsByOriginalId = new Map(
    reversalAllocations.map((allocation) => [allocation.reversesAllocationId, allocation]),
  );
  const duplicateReferences = new Set(duplicateEvidenceReferences);

  const rows = receipts.map((receipt) => {
    const issues = new Set();
    const receiptReversions = reversionsByReceiptId.get(receipt.id) || [];
    const reversal = receiptReversions[0];
    if (receiptReversions.length > 1) issues.add("DUPLICATE_REVERSAL_RECORDS");
    const allocations = receipt.receiptAllocations || [];
    const amount = accountingDecimal(receipt.amount, "Receipt amount");
    const settlementAmount = accountingDecimal(receipt.settlementAmount ?? "0", "Receipt settlement amount");
    const allocatedAmount = sum(allocations.map((allocation) => allocation.amount));
    const invoiceIds = [...new Set(allocations.map((allocation) => allocation.documentId))];
    const sourceDocuments = allocations.map((allocation) => allocation.document).filter(Boolean);
    const partyIds = new Set(sourceDocuments.map((document) => document.partyId));
    const evidenceReference = typeof receipt.externalPaymentReference === "string"
      ? receipt.externalPaymentReference.trim()
      : "";

    if (!evidenceReference) issues.add("EVIDENCE_REFERENCE_MISSING");
    else if (duplicateReferences.has(evidenceReference)) issues.add("DUPLICATE_EVIDENCE_REFERENCE");
    if (
      String(receipt.currency || "").toUpperCase() !== "NPR" ||
      String(receipt.toAccount?.currency || "").toUpperCase() !== "NPR"
    ) {
      issues.add("RECEIPT_CURRENCY_MISMATCH");
    }
    if (!receipt.toAccount?.id || !receipt.toAccount.accountingAccountId) {
      issues.add("TREASURY_ACCOUNT_OR_GL_MAPPING_MISSING");
    }
    if (
      !allocations.length ||
      !accountingDecimal(allocatedAmount).equals(settlementAmount) ||
      allocations.some((allocation) =>
        allocation.cashTransactionId !== receipt.id ||
        allocation.allocationType !== "CASH" ||
        !allocation.journalEntryId
      )
    ) {
      issues.add("ALLOCATION_SETTLEMENT_MISMATCH");
    }
    if (
      sourceDocuments.length !== allocations.length ||
      partyIds.size !== 1 ||
      sourceDocuments.some((document) =>
        document.side !== "RECEIVABLE" ||
        document.currency !== "NPR" ||
        document.party?.partyType !== "CUSTOMER" ||
        !["INVOICE", "DEBIT_NOTE"].includes(document.documentType)
      )
    ) {
      issues.add("SOURCE_DOCUMENT_MISMATCH");
    }
    const receiptAllocationByDocument = new Map();
    for (const allocation of allocations) {
      receiptAllocationByDocument.set(
        allocation.documentId,
        addDecimals(receiptAllocationByDocument.get(allocation.documentId) || "0", allocation.amount),
      );
    }
    for (const [documentId, receiptAllocationAmount] of receiptAllocationByDocument) {
      const document = sourceDocuments.find((source) => source.id === documentId);
      if (!document) continue;
      const originalAmount = accountingDecimal(document.originalAmount);
      const allocatedNow = accountingDecimal(document.allocatedAmount);
      const remainingNow = accountingDecimal(document.remainingAmount);
      const expectedStatus = remainingNow.isZero()
        ? "PAID"
        : allocatedNow.isZero()
          ? "OPEN"
          : "PARTIALLY_PAID";
      if (
        !addDecimals(allocatedNow, remainingNow).equals(originalAmount) ||
        (!reversal && compareDecimals(allocatedNow, receiptAllocationAmount) < 0) ||
        document.status !== expectedStatus
      ) {
        issues.add("INVOICE_BALANCE_MISMATCH");
      }
    }

    const sourceJournals = journalsBySourceId.get(receipt.id) || [];
    const journal = sourceJournals[0];
    if (sourceJournals.length > 1) issues.add("DUPLICATE_SOURCE_JOURNALS");
    if (!journal) {
      issues.add("SOURCE_JOURNAL_MISSING");
    } else {
      const expectedStatus = reversal ? "REVERSED" : "POSTED";
      if (
        journal.sourceType !== "CUSTOMER_PAYMENT" ||
        journal.idempotencyKey !== `CUSTOMER_PAYMENT:${receipt.idempotencyKey}`
      ) {
        issues.add("SOURCE_JOURNAL_IDENTITY_MISMATCH");
      }
      if (journal.status !== expectedStatus) issues.add("SOURCE_JOURNAL_STATUS_MISMATCH");
      const debits = sum((journal.lines || []).map((line) => line.debit));
      const credits = sum((journal.lines || []).map((line) => line.credit));
      if (
        !debits.equals(credits) ||
        !debits.equals(journal.totalDebit ?? "0") ||
        !credits.equals(journal.totalCredit ?? "0")
      ) {
        issues.add("SOURCE_JOURNAL_UNBALANCED");
      }
      const treasuryLines = (journal.lines || []).filter((line) =>
        line.accountId === receipt.toAccount?.accountingAccountId &&
        accountingDecimal(line.debit).equals(amount) &&
        compareDecimals(line.credit, "0") === 0
      );
      if (treasuryLines.length !== 1) issues.add("TREASURY_JOURNAL_AMOUNT_MISMATCH");
      const partyId = sourceDocuments[0]?.partyId;
      const receivableCredit = sum((journal.lines || [])
        .filter((line) => line.account?.accountCode === "1130" && line.accountingPartyId === partyId)
        .map((line) => accountingDecimal(line.credit).minus(line.debit)));
      if (!receivableCredit.equals(settlementAmount)) {
        issues.add("RECEIVABLE_JOURNAL_AMOUNT_MISMATCH");
      }
      if (allocations.some((allocation) => allocation.journalEntryId !== journal.id)) {
        issues.add("ALLOCATION_JOURNAL_MISMATCH");
      }
    }

    let reversalTransaction = null;
    let reversalJournal = null;
    if (reversal) {
      reversalTransaction = reversalTransactionsById.get(reversal.reversalTransactionId);
      reversalJournal = reversalJournalsById.get(reversal.reversalJournalEntryId);
      if (
        reversal.cashTransactionId !== receipt.id ||
        !reversalTransaction ||
        !reversalJournal ||
        reversalTransaction.type !== "OUTFLOW" ||
        reversalTransaction.category !== "REFUND" ||
        reversalTransaction.referenceId !== receipt.id ||
        reversalTransaction.fromAccountId !== receipt.toAccount?.id ||
        String(reversalTransaction.currency || "").toUpperCase() !== "NPR" ||
        !accountingDecimal(reversalTransaction.amount ?? "0").equals(amount) ||
        !accountingDecimal(reversalTransaction.settlementAmount ?? "0").equals(settlementAmount) ||
        !accountingDecimal(reversal.originalAmount ?? "0").equals(amount) ||
        reversalJournal.status !== "POSTED" ||
        reversalJournal.sourceType !== "REVERSAL" ||
        reversalJournal.sourceId !== `REV-${journal?.id || ""}` ||
        journal?.reversedEntryId !== reversalJournal.id ||
        !sum((reversalJournal.lines || []).map((line) => line.debit)).equals(
          sum((reversalJournal.lines || []).map((line) => line.credit)),
        ) ||
        reversalAllocations.length < allocations.length ||
        allocations.some((allocation) => {
          const reversalAllocation = reversalAllocationsByOriginalId.get(allocation.id);
          return !reversalAllocation ||
            reversalAllocation.allocationType !== "REVERSAL" ||
            reversalAllocation.documentId !== allocation.documentId ||
            reversalAllocation.cashTransactionId !== reversalTransaction?.id ||
            reversalAllocation.journalEntryId !== reversalJournal?.id ||
            !accountingDecimal(reversalAllocation.amount).equals(allocation.amount);
        })
      ) {
        issues.add("REVERSAL_LINK_MISMATCH");
      }
    } else if (journal?.status === "REVERSED") {
      issues.add("REVERSAL_RECORD_MISSING");
    }

    const issueCodes = [...issues].sort();
    return {
      receiptId: receipt.id,
      receiptDate: receipt.date?.toISOString?.() || null,
      invoiceIds,
      sourceDocuments: allocations.map((allocation) => ({
        invoiceId: allocation.documentId,
        documentNumber: allocation.document?.documentNumber || null,
        sourceType: allocation.document?.sourceType || null,
        sourceId: allocation.document?.sourceId || null,
        invoiceAmount: allocation.document
          ? accountingDecimal(allocation.document.originalAmount).toFixed(2)
          : null,
        allocationAmount: accountingDecimal(allocation.amount).toFixed(2),
      })),
      amount: amount.toFixed(2),
      settlementAmount: settlementAmount.toFixed(2),
      allocatedAmount: allocatedAmount.toFixed(2),
      currency: receipt.currency || null,
      tenderMethod: receipt.tenderMethod || null,
      treasuryAccount: receipt.toAccount
        ? {
            id: receipt.toAccount.id,
            name: receipt.toAccount.accountName,
            currency: receipt.toAccount.currency,
            glAccountId: receipt.toAccount.accountingAccountId,
          }
        : null,
      evidenceReference: evidenceReference || null,
      evidenceReferenceStatus: evidenceReference ? "USER_SUPPLIED_UNVERIFIED" : "MISSING",
      bankStatementStatus: "NOT_AVAILABLE",
      receiptStatus: reversal ? "REVERSED" : "ACTIVE",
      journalEntryId: journal?.id || null,
      reversalTransactionId: reversalTransaction?.id || null,
      reversalJournalEntryId: reversalJournal?.id || null,
      internalStatus: issueCodes.length ? "EXCEPTION" : "INTERNAL_SOURCE_LINKS_MATCH",
      issueCodes,
    };
  });

  const exceptionCount = rows.filter((row) => row.internalStatus === "EXCEPTION").length;
  return {
    summary: {
      receiptCount: rows.length,
      exceptionCount,
      internalSourceLinksMatchCount: rows.length - exceptionCount,
      bankSettlementVerifiedCount: 0,
    },
    receipts: rows,
    limitations: [
      "No bank-statement line or independent bank-evidence record is stored for this receipt population.",
      "A caller-supplied payment reference is not independent proof of bank settlement.",
      "Unmatched bank evidence, statement amount/date/currency differences, and bank-to-Treasury variances cannot be detected until statement data is imported and independently reviewed.",
    ],
  };
};

export const getCustomerReceiptReconciliation = async ({
  client = prisma,
  query = {},
} = {}) => {
  const pagination = getPagination(query);
  const receiptWhere = RECEIPT_FILTER;

  const run = async (tx) => {
    const [receipts, total] = await Promise.all([
      tx.cashTransaction.findMany({
        where: receiptWhere,
        include: {
          toAccount: {
            select: { id: true, accountName: true, currency: true, accountingAccountId: true },
          },
          receiptAllocations: {
            where: { allocationType: "CASH" },
            orderBy: [{ allocatedAt: "asc" }, { id: "asc" }],
            include: {
              document: {
                select: {
                  id: true,
                  documentType: true,
                  documentNumber: true,
                  side: true,
                  sourceType: true,
                  sourceId: true,
                  partyId: true,
                  currency: true,
                  originalAmount: true,
                  allocatedAmount: true,
                  remainingAmount: true,
                  status: true,
                  party: { select: { partyType: true } },
                },
              },
            },
          },
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
      tx.cashTransaction.count({ where: receiptWhere }),
    ]);

    const receiptIds = receipts.map((receipt) => receipt.id);
    const references = [...new Set(receipts
      .map((receipt) => receipt.externalPaymentReference?.trim())
      .filter(Boolean))];
    if (!receiptIds.length) {
      return {
        ...buildCustomerReceiptReconciliation(),
        pagination: getPaginationMeta({ ...pagination, total }),
      };
    }
    const [journals, reversions, duplicateCashReferences, duplicatePayoutReferences] = await Promise.all([
      tx.journalEntry.findMany({
        where: { sourceType: "CUSTOMER_PAYMENT", sourceId: { in: receiptIds } },
        include: { lines: { include: { account: { select: { accountCode: true } } } } },
      }),
      tx.settlementReversion.findMany({
        where: { reversionType: "CUSTOMER_RECEIPT", originalRecordId: { in: receiptIds } },
      }),
      references.length
        ? tx.cashTransaction.findMany({
            where: { externalPaymentReference: { in: references } },
            select: { id: true, externalPaymentReference: true },
          })
        : Promise.resolve([]),
      references.length
        ? tx.financialPayout.findMany({
            where: { bankEvidenceReference: { in: references } },
            select: { id: true, bankEvidenceReference: true },
          })
        : Promise.resolve([]),
    ]);
    const duplicateCounts = new Map();
    for (const reference of [
      ...duplicateCashReferences.map((row) => row.externalPaymentReference),
      ...duplicatePayoutReferences.map((row) => row.bankEvidenceReference),
    ]) {
      if (!reference) continue;
      duplicateCounts.set(reference, (duplicateCounts.get(reference) || 0) + 1);
    }
    const duplicateEvidenceReferences = [...duplicateCounts]
      .filter(([, count]) => count > 1)
      .map(([reference]) => reference);
    const reversalTransactionIds = reversions.map((reversion) => reversion.reversalTransactionId).filter(Boolean);
    const reversalJournalIds = reversions.map((reversion) => reversion.reversalJournalEntryId).filter(Boolean);
    const originalAllocationIds = receipts.flatMap((receipt) =>
      (receipt.receiptAllocations || []).map((allocation) => allocation.id),
    );
    const [reversalTransactions, reversalJournals, reversalAllocations] = await Promise.all([
      reversalTransactionIds.length
        ? tx.cashTransaction.findMany({ where: { id: { in: reversalTransactionIds } } })
        : Promise.resolve([]),
      reversalJournalIds.length
        ? tx.journalEntry.findMany({
            where: { id: { in: reversalJournalIds } },
            include: { lines: { select: { debit: true, credit: true } } },
          })
        : Promise.resolve([]),
      originalAllocationIds.length
        ? tx.accountingAllocation.findMany({
            where: { reversesAllocationId: { in: originalAllocationIds } },
          })
        : Promise.resolve([]),
    ]);
    return {
      ...buildCustomerReceiptReconciliation({
        receipts,
        journals,
        reversions,
        reversalTransactions,
        reversalJournals,
        reversalAllocations,
        duplicateEvidenceReferences,
      }),
      pagination: getPaginationMeta({ ...pagination, total }),
    };
  };

  return typeof client.$transaction === "function"
    ? client.$transaction(run, { isolationLevel: "RepeatableRead" })
    : run(client);
};
