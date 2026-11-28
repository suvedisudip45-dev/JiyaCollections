import { createHash } from "node:crypto";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";
import {
  accountingDecimal,
  addDecimals,
  compareDecimals,
  parseNprAmountString,
  quantizeNprAmount,
  subtractDecimals,
} from "./accountingDecimal.js";
import { allocatePaymentToDocuments } from "./accountingSubledgerService.js";
import {
  postCustomerPaymentAccounting,
  reverseSettlementJournalEntry,
} from "./accountingPostingEngine.js";
import { requireExternalPaymentReference } from "../utils/externalPaymentReference.js";

const fail = (message, statusCode = 400, code = "CUSTOMER_RECEIPT_INVALID") => {
  throw Object.assign(new Error(message), { statusCode, code });
};

const normalizedText = (value, fieldName, { required = false, maxLength = 191 } = {}) => {
  if (value === undefined || value === null) {
    if (required) fail(`${fieldName} is required.`, 400, `${fieldName.toUpperCase().replace(/ /g, "_")}_REQUIRED`);
    return "";
  }
  if (typeof value !== "string") fail(`${fieldName} must be a string.`);
  const text = value.trim();
  if (required && !text) fail(`${fieldName} is required.`, 400, `${fieldName.toUpperCase().replace(/ /g, "_")}_REQUIRED`);
  if (text.length > maxLength) fail(`${fieldName} is too long.`);
  return text;
};

const normalizeInvoiceIds = (input) => {
  const values = Array.isArray(input) ? input : [input];
  if (!values.length || values.length > 20) {
    fail("Select between one and twenty receivable invoices.");
  }
  const ids = values.map((value) => normalizedText(value, "Invoice ID", { required: true }));
  if (new Set(ids).size !== ids.length) fail("An invoice can only be selected once.");
  return [...ids].sort();
};

const amountForJournal = (value, label, { allowZero = true } = {}) => {
  try {
    return parseNprAmountString(value, label, { allowZero });
  } catch (error) {
    fail(error.message, 400, error.code || "INVALID_RECEIPT_AMOUNT");
  }
};

const requestFingerprint = (payload) =>
  createHash("sha256").update(JSON.stringify(payload)).digest("hex");

const loadReceiptReplay = async (tx, existing, fingerprint) => {
  if (
    existing.category !== "RECEIVABLE_COLLECTION" ||
    existing.type !== "INFLOW" ||
    existing.receiptPayloadHash !== fingerprint
  ) {
    fail("This idempotency key was already used for a different receipt.", 409, "IDEMPOTENCY_KEY_CONFLICT");
  }
  const allocations = await tx.accountingAllocation.findMany({
    where: { cashTransactionId: existing.id, allocationType: "CASH" },
    include: { document: true },
    orderBy: { allocatedAt: "asc" },
  });
  const allocatedAmount = allocations.reduce(
    (total, allocation) => addDecimals(total, allocation.amount),
    accountingDecimal("0"),
  );
  const journalEntryIds = new Set(allocations.map((allocation) => allocation.journalEntryId));
  if (
    !existing.settlementAmount ||
    allocations.length === 0 ||
    !allocatedAmount.equals(existing.settlementAmount) ||
    journalEntryIds.size !== 1 ||
    journalEntryIds.has(null)
  ) {
    fail("The stored receipt allocations do not match the recorded settlement amount.", 409, "RECEIPT_REPLAY_INTEGRITY_ERROR");
  }
  const journal = await tx.journalEntry.findUnique({
    where: { id: [...journalEntryIds][0] },
    select: { id: true, sourceType: true, sourceId: true, idempotencyKey: true, status: true, reversedEntryId: true },
  });
  if (
    !journal ||
    journal.sourceType !== "CUSTOMER_PAYMENT" ||
    journal.sourceId !== existing.id ||
    journal.idempotencyKey !== `CUSTOMER_PAYMENT:${existing.idempotencyKey}`
  ) {
    fail("The stored receipt does not have its expected posted customer-payment journal.", 409, "RECEIPT_REPLAY_INTEGRITY_ERROR");
  }
  const reversal = await tx.settlementReversion.findFirst({
    where: { reversionType: "CUSTOMER_RECEIPT", originalRecordId: existing.id },
  });
  if (reversal) {
    if (
      journal.status !== "REVERSED" ||
      journal.reversedEntryId !== reversal.reversalJournalEntryId ||
      reversal.cashTransactionId !== existing.id ||
      !reversal.reversalJournalEntryId ||
      !reversal.reversalTransactionId
    ) {
      fail("The stored receipt reversal does not match its original journal.", 409, "RECEIPT_REPLAY_INTEGRITY_ERROR");
    }
    const [reversalJournal, reversalTransaction, reversalAllocations] = await Promise.all([
      tx.journalEntry.findUnique({
        where: { id: reversal.reversalJournalEntryId },
        select: { id: true, status: true, sourceType: true, sourceId: true },
      }),
      tx.cashTransaction.findUnique({
        where: { id: reversal.reversalTransactionId },
        select: { id: true, type: true, category: true, referenceId: true, amount: true, settlementAmount: true },
      }),
      tx.accountingAllocation.findMany({
        where: { reversesAllocationId: { in: allocations.map((allocation) => allocation.id) } },
      }),
    ]);
    const reversalAllocationByOriginalId = new Map(
      reversalAllocations.map((allocation) => [allocation.reversesAllocationId, allocation]),
    );
    if (
      reversalJournal?.status !== "POSTED" ||
      reversalJournal.sourceType !== "REVERSAL" ||
      reversalJournal.sourceId !== `REV-${journal.id}` ||
      !reversalTransaction ||
      reversalTransaction.amount === null ||
      reversalTransaction.settlementAmount === null ||
      reversalTransaction.type !== "OUTFLOW" ||
      reversalTransaction.category !== "REFUND" ||
      reversalTransaction.referenceId !== existing.id ||
      !accountingDecimal(reversal.originalAmount).equals(existing.amount) ||
      !accountingDecimal(reversalTransaction.amount).equals(existing.amount) ||
      !accountingDecimal(reversalTransaction.settlementAmount).equals(allocatedAmount) ||
      reversalAllocations.length !== allocations.length ||
      allocations.some((allocation) => {
        const reversalAllocation = reversalAllocationByOriginalId.get(allocation.id);
        return !reversalAllocation ||
          reversalAllocation.allocationType !== "REVERSAL" ||
          reversalAllocation.documentId !== allocation.documentId ||
          reversalAllocation.cashTransactionId !== reversalTransaction.id ||
          reversalAllocation.journalEntryId !== reversalJournal.id ||
          !accountingDecimal(reversalAllocation.amount).equals(allocation.amount);
      })
    ) {
      fail("The stored receipt reversal does not match its cash, invoice allocations, and journal.", 409, "RECEIPT_REPLAY_INTEGRITY_ERROR");
    }
    return {
      receiptId: existing.id,
      status: "REVERSED",
      amount: accountingDecimal(existing.amount).toFixed(2),
      allocatedAmount: allocatedAmount.toFixed(2),
      unallocatedAmount: "0.00",
      reversedAmount: accountingDecimal(reversalTransaction.amount).toFixed(2),
      alreadyProcessed: true,
      allocations: allocations.map((allocation) => ({
        invoiceId: allocation.documentId,
        amount: accountingDecimal(allocation.amount).toFixed(2),
      })),
    };
  }
  if (journal.status !== "POSTED") {
    fail("The stored receipt does not have its expected posted customer-payment journal.", 409, "RECEIPT_REPLAY_INTEGRITY_ERROR");
  }
  return {
    receiptId: existing.id,
    status: "CONFIRMED",
    amount: accountingDecimal(existing.amount).toFixed(2),
    allocatedAmount: allocatedAmount.toFixed(2),
    unallocatedAmount: "0.00",
    reversedAmount: "0.00",
    alreadyProcessed: true,
    allocations: allocations.map((allocation) => ({
      invoiceId: allocation.documentId,
      amount: accountingDecimal(allocation.amount).toFixed(2),
    })),
  };
};

export const recordCustomerReceipt = async ({
  invoiceIds,
  amount: amountInput,
  adjustmentType: adjustmentTypeInput = "NONE",
  adjustmentAmount: adjustmentInput = "0",
  toAccountId: toAccountIdInput,
  tenderMethod: tenderMethodInput,
  evidenceReference: evidenceInput,
  notes: notesInput,
  idempotencyKey: idempotencyKeyInput,
  receivedByAccountId: receivedByAccountIdInput,
}, {
  client = prisma,
  postPaymentAccounting = postCustomerPaymentAccounting,
  writeAudit = recordSystemAudit,
  auditContext = {},
} = {}) => {
  const targets = normalizeInvoiceIds(invoiceIds);
  const idempotencyKey = normalizedText(idempotencyKeyInput, "Idempotency key", { required: true });
  if (idempotencyKey.length > 120 || /\s/.test(idempotencyKey)) {
    fail("A valid idempotency key of at most 120 characters is required.", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  const toAccountId = normalizedText(toAccountIdInput, "Treasury account ID", { required: true });
  const receivedByAccountId = normalizedText(receivedByAccountIdInput, "Receiving actor ID", { required: true });
  const evidenceReference = normalizedText(evidenceInput, "Evidence reference", { required: true });
  const notes = normalizedText(notesInput, "Notes", { maxLength: 2000 });
  const tenderMethod = normalizedText(tenderMethodInput, "Tender method", { required: true }).toUpperCase();
  if (!["CASH", "BANK_TRANSFER", "WALLET", "CARD", "OTHER"].includes(tenderMethod)) {
    fail("Tender method is not supported.", 400, "INVALID_TENDER_METHOD");
  }

  const amount = amountForJournal(amountInput, "Actual received amount", { allowZero: false });
  const adjustmentAmount = amountForJournal(adjustmentInput, "Adjustment amount");
  const adjustmentType = String(adjustmentTypeInput || "NONE").trim().toUpperCase();
  if (!["NONE", "DISCOUNT", "FINE"].includes(adjustmentType) ||
      compareDecimals(adjustmentAmount, "0") < 0 ||
      (adjustmentType === "NONE" && compareDecimals(adjustmentAmount, "0") > 0) ||
      (adjustmentType !== "NONE" && compareDecimals(adjustmentAmount, "0") === 0)) {
    fail("Choose a valid discount or fine amount, or select no adjustment.", 400, "INVALID_RECEIPT_ADJUSTMENT");
  }

  const settlementAmount = quantizeNprAmount(
    adjustmentType === "DISCOUNT"
      ? addDecimals(amount, adjustmentAmount)
      : adjustmentType === "FINE"
        ? subtractDecimals(amount, adjustmentAmount)
        : amount,
  );
  if (compareDecimals(settlementAmount, "0") <= 0) {
    fail("The receipt must settle a positive amount.", 400, "INVALID_RECEIPT_SETTLEMENT");
  }

  const payload = {
    invoiceIds: targets,
    amount: amount.toFixed(2),
    adjustmentType,
    adjustmentAmount: adjustmentAmount.toFixed(2),
    settlementAmount: settlementAmount.toFixed(2),
    toAccountId,
    tenderMethod,
    evidenceReference,
    notes,
    receivedByAccountId,
    currency: "NPR",
  };
  const fingerprint = requestFingerprint(payload);

  try {
    return await client.$transaction(async (tx) => {
    const existing = await tx.cashTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) return loadReceiptReplay(tx, existing, fingerprint);

    const documents = await tx.accountingDocument.findMany({
      where: {
        id: { in: targets },
        documentType: { in: ["INVOICE", "DEBIT_NOTE"] },
        side: "RECEIVABLE",
        currency: "NPR",
        party: { is: { partyType: "CUSTOMER", status: "ACTIVE" } },
      },
      include: { party: true },
      orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    if (documents.length !== targets.length) {
      fail("One or more selected customer invoices are missing, unsupported, or not eligible for collection.", 409, "RECEIVABLE_INVOICE_NOT_ELIGIBLE");
    }
    if (documents.some((document) => !["OPEN", "PARTIALLY_PAID"].includes(document.status))) {
      fail("One or more selected invoices are closed or not eligible for collection.", 409, "RECEIVABLE_INVOICE_CLOSED");
    }
    const partyId = documents[0].partyId;
    if (documents.some((document) => document.partyId !== partyId || document.currency !== "NPR")) {
      fail("Selected invoices must belong to the same customer and currency.", 409, "RECEIPT_INVOICE_PARTY_MISMATCH");
    }

    const availableBalance = documents.reduce(
      (total, document) => addDecimals(total, document.remainingAmount),
      accountingDecimal("0"),
    );
    if (compareDecimals(settlementAmount, availableBalance) > 0) {
      fail("Receipt settlement exceeds the selected invoices' outstanding balance.", 409, "RECEIPT_EXCEEDS_OUTSTANDING");
    }

    const treasury = await tx.financialAccount.findUnique({ where: { id: toAccountId } });
    if (!treasury || treasury.status !== "ACTIVE") {
      fail("An active Treasury account is required.", 404, "TREASURY_ACCOUNT_NOT_FOUND");
    }
    if (String(treasury.currency || "NPR").toUpperCase() !== "NPR") {
      fail("Customer receipts can only be recorded into an NPR Treasury account.", 409, "RECEIPT_CURRENCY_MISMATCH");
    }
    if (!treasury.accountingAccountId) {
      fail("Map the destination Treasury account to a GL account first.", 409, "TREASURY_GL_MAPPING_REQUIRED");
    }
    const glAccount = await tx.account.findUnique({
      where: { id: treasury.accountingAccountId },
      select: { id: true, accountCode: true, isActive: true },
    });
    if (!glAccount?.isActive) fail("The Treasury GL mapping is unavailable.", 409, "TREASURY_GL_MAPPING_REQUIRED");

    const balanceUpdate = await tx.financialAccount.updateMany({
      where: { id: toAccountId, status: "ACTIVE", currency: treasury.currency || "NPR" },
      data: { currentBalance: { increment: amount } },
    });
    if (balanceUpdate.count !== 1) {
      fail("The Treasury account changed before receipt posting; refresh and retry.", 409, "TREASURY_ACCOUNT_CHANGED");
    }

    const firstDocument = documents[0];
    const receipt = await tx.cashTransaction.create({
      data: {
        idempotencyKey,
        externalPaymentReference: evidenceReference,
        receiptPayloadHash: fingerprint,
        settlementAmount,
        receivedByAccountId,
        tenderMethod,
        currency: "NPR",
        amount,
        type: "INFLOW",
        toAccountId,
        category: "RECEIVABLE_COLLECTION",
        partyName: firstDocument.party.displayName,
        invoiceNumber: documents.map((document) => document.documentNumber).join(", ").slice(0, 191),
        referenceId: targets.length === 1 ? firstDocument.sourceId : receiptReference(targets),
        description: `Customer receipt against ${documents.length} invoice(s)${notes ? ` - ${notes}` : ""}`,
        receiptUrl: "",
      },
    });

    const journal = await postPaymentAccounting({
      id: receipt.id,
      orderId: receipt.id,
      customerName: firstDocument.party.displayName,
      accountingPartyId: partyId,
      amount,
      settlementAmount,
      discountAmount: adjustmentType === "DISCOUNT" ? adjustmentAmount : "0",
      fineAmount: adjustmentType === "FINE" ? adjustmentAmount : "0",
      depositAccountCode: glAccount.accountCode,
      idempotencyKey: `CUSTOMER_PAYMENT:${idempotencyKey}`,
      referenceNumber: `RCPT-${receipt.id.slice(-8)}`,
      client: tx,
    });
    if (!journal?.id) {
      fail("The customer receipt journal was not posted.", 409, "RECEIPT_JOURNAL_NOT_POSTED");
    }

    const allocation = await allocatePaymentToDocuments({
      partyId,
      side: "RECEIVABLE",
      amount: settlementAmount,
      journalEntryId: journal?.id || null,
      cashTransactionId: receipt.id,
      allocationType: "CASH",
      targetDocumentIds: targets,
      notes: notes || `Receipt ${receipt.id}`,
      idempotencyKey: `CUSTOMER_RECEIPT:${idempotencyKey}`,
    }, { client: tx });
    if (
      !allocation.unallocatedAmount.isZero() ||
      !allocation.totalAllocated.equals(settlementAmount)
    ) {
      fail("Receipt could not be fully allocated to the selected invoices.", 409, "RECEIPT_ALLOCATION_INCOMPLETE");
    }

    await writeAudit({ ...auditContext, actorId: receivedByAccountId }, {
      action: "CUSTOMER_RECEIPT_RECORDED",
      entityType: "CashTransaction",
      entityId: receipt.id,
      afterState: {
        sourceInvoiceIds: targets,
        amount: amount.toFixed(2),
        settlementAmount: settlementAmount.toFixed(2),
        adjustmentType,
        adjustmentAmount: adjustmentAmount.toFixed(2),
        currency: "NPR",
        treasuryAccountId: toAccountId,
        tenderMethod,
        journalEntryId: journal.id,
        allocations: allocation.allocations.map((entry) => ({
          invoiceId: entry.documentId,
          amount: accountingDecimal(entry.amount).toFixed(2),
        })),
      },
    }, { client: tx });

    return {
      receiptId: receipt.id,
      status: "CONFIRMED",
      amount: amount.toFixed(2),
      allocatedAmount: settlementAmount.toFixed(2),
      unallocatedAmount: "0.00",
      reversedAmount: "0.00",
      alreadyProcessed: false,
      allocations: allocation.allocations.map((entry) => ({
        invoiceId: entry.documentId,
        amount: accountingDecimal(entry.amount).toFixed(2),
      })),
    };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const existing = await client.cashTransaction.findUnique({ where: { idempotencyKey } });
    if (!existing) throw error;
    return loadReceiptReplay(client, existing, fingerprint);
  }
};

export const reverseCustomerReceipt = async ({
  receiptId: receiptIdInput,
  correctionMode: correctionModeInput,
  correctionReason: reasonInput,
  evidenceReference: evidenceInput,
  actorAccountId: actorAccountIdInput,
  actorEmail = null,
  actorContext = {},
  reversalAmount,
  client = prisma,
  reverseJournal = reverseSettlementJournalEntry,
  writeAudit = recordSystemAudit,
} = {}) => {
  const receiptId = normalizedText(receiptIdInput, "Receipt ID", { required: true });
  const actorAccountId = normalizedText(actorAccountIdInput, "Reversal actor ID", { required: true });
  const reason = normalizedText(reasonInput, "Correction reason", { required: true, maxLength: 2000 });
  if (reason.length < 3) fail("A correction reason of at least three characters is required.", 400, "SETTLEMENT_CORRECTION_REASON_REQUIRED");
  if (reversalAmount !== undefined && reversalAmount !== null && reversalAmount !== "") {
    fail("Partial customer-receipt reversals are not supported.", 400, "PARTIAL_RECEIPT_REVERSAL_UNSUPPORTED");
  }
  const correctionMode = normalizedText(correctionModeInput, "Correction mode", { required: true }).toUpperCase();
  if (!["VOID_NOT_EXECUTED", "RETURNED_FUNDS"].includes(correctionMode)) {
    fail("Choose whether the original receipt was not executed or the funds were actually returned.", 400, "SETTLEMENT_CORRECTION_MODE_REQUIRED");
  }
  const evidenceReference = requireExternalPaymentReference(evidenceInput);

  const execute = async (tx) => {
    const receipt = await tx.cashTransaction.findUnique({ where: { id: receiptId } });
    if (
      !receipt ||
      receipt.category !== "RECEIVABLE_COLLECTION" ||
      receipt.type !== "INFLOW" ||
      receipt.currency !== "NPR" ||
      !receipt.idempotencyKey ||
      !receipt.receiptPayloadHash ||
      !receipt.receivedByAccountId ||
      !receipt.tenderMethod ||
      !receipt.externalPaymentReference ||
      !receipt.amount ||
      !receipt.settlementAmount
    ) {
      fail("A confirmed source-linked NPR customer receipt is required.", 409, "CUSTOMER_RECEIPT_NOT_REVERSIBLE");
    }

    const existingReversal = await tx.settlementReversion.findFirst({
      where: { reversionType: "CUSTOMER_RECEIPT", originalRecordId: receipt.id },
    });
    if (existingReversal) {
      fail("This customer receipt has already been reversed.", 409, "CUSTOMER_RECEIPT_ALREADY_REVERSED");
    }

    const cashAmount = accountingDecimal(receipt.amount, "Original cash receipt");
    const settlementAmount = accountingDecimal(receipt.settlementAmount, "Original receipt settlement");
    if (
      compareDecimals(cashAmount, "0") <= 0 ||
      compareDecimals(settlementAmount, "0") <= 0 ||
      !receipt.toAccountId
    ) {
      fail("The original customer receipt has invalid amount or Treasury linkage.", 409, "CUSTOMER_RECEIPT_SOURCE_MISMATCH");
    }

    const originalAllocations = await tx.accountingAllocation.findMany({
      where: { cashTransactionId: receipt.id, allocationType: "CASH" },
      include: { document: true },
      orderBy: [{ allocatedAt: "asc" }, { id: "asc" }],
    });
    if (!originalAllocations.length) {
      fail("The original receipt has no invoice allocations to reverse.", 409, "CUSTOMER_RECEIPT_ALLOCATION_MISSING");
    }
    const allocatedAmount = originalAllocations.reduce(
      (total, allocation) => addDecimals(total, allocation.amount),
      accountingDecimal("0"),
    );
    const journalEntryIds = new Set(originalAllocations.map((allocation) => allocation.journalEntryId));
    if (
      !allocatedAmount.equals(settlementAmount) ||
      journalEntryIds.size !== 1 ||
      journalEntryIds.has(null) ||
      originalAllocations.some((allocation) =>
        allocation.cashTransactionId !== receipt.id ||
        allocation.allocationType !== "CASH" ||
        compareDecimals(allocation.amount, "0") <= 0
      )
    ) {
      fail("The receipt allocations do not match its recorded settlement amount.", 409, "CUSTOMER_RECEIPT_ALLOCATION_MISMATCH");
    }
    const originalJournalId = [...journalEntryIds][0];
    const originalJournal = await tx.journalEntry.findFirst({
      where: {
        id: originalJournalId,
        idempotencyKey: `CUSTOMER_PAYMENT:${receipt.idempotencyKey}`,
        sourceType: "CUSTOMER_PAYMENT",
        sourceId: receipt.id,
        status: "POSTED",
      },
      include: {
        lines: { include: { account: { select: { accountCode: true } } } },
      },
    });
    if (!originalJournal) {
      fail("The original posted customer-payment journal is missing or does not match the receipt.", 409, "SETTLEMENT_JOURNAL_NOT_POSTED");
    }
    const journalDebits = originalJournal.lines.reduce(
      (total, line) => addDecimals(total, line.debit),
      accountingDecimal("0"),
    );
    const journalCredits = originalJournal.lines.reduce(
      (total, line) => addDecimals(total, line.credit),
      accountingDecimal("0"),
    );
    if (
      !journalDebits.equals(journalCredits) ||
      !journalDebits.equals(originalJournal.totalDebit) ||
      !journalCredits.equals(originalJournal.totalCredit)
    ) {
      fail("The original customer-payment journal is not balanced; reconcile it before reversing.", 409, "CUSTOMER_RECEIPT_JOURNAL_MISMATCH");
    }
    const receivableAccount = await tx.account.findUnique({
      where: { accountCode: "1130" },
      select: { id: true },
    });
    const partyId = originalAllocations[0].document?.partyId;
    if (!receivableAccount?.id || !partyId) {
      fail("The customer receivable control account or invoice party is unavailable.", 409, "CUSTOMER_RECEIPT_SOURCE_MISMATCH");
    }
    const receivableCredits = originalJournal.lines.reduce((total, line) =>
      line.accountId === receivableAccount.id && line.accountingPartyId === partyId
        ? addDecimals(total, subtractDecimals(line.credit, line.debit))
        : total,
    accountingDecimal("0"));
    if (!receivableCredits.equals(settlementAmount)) {
      fail("The posted journal does not reduce the selected customer receivable by the allocated amount.", 409, "CUSTOMER_RECEIPT_JOURNAL_MISMATCH");
    }

    const documentIds = [...new Set(originalAllocations.map((allocation) => allocation.documentId))];
    const documents = await tx.accountingDocument.findMany({
      where: { id: { in: documentIds } },
      include: { party: true },
    });
    if (documents.length !== documentIds.length) {
      fail("One or more original invoice sources are missing.", 409, "CUSTOMER_RECEIPT_SOURCE_MISMATCH");
    }
    const documentsById = new Map(documents.map((document) => [document.id, document]));
    if (documents.some((document) =>
      document.side !== "RECEIVABLE" ||
      !["INVOICE", "DEBIT_NOTE"].includes(document.documentType) ||
      document.currency !== "NPR" ||
      document.party?.partyType !== "CUSTOMER" ||
      document.partyId !== partyId ||
      !["OPEN", "PARTIALLY_PAID", "PAID"].includes(document.status)
    )) {
      fail("The original receipt no longer points only to eligible customer NPR invoices.", 409, "CUSTOMER_RECEIPT_SOURCE_MISMATCH");
    }

    const alreadyReversed = await tx.accountingAllocation.findMany({
      where: { reversesAllocationId: { in: originalAllocations.map((allocation) => allocation.id) } },
      select: { id: true, reversesAllocationId: true },
    });
    if (alreadyReversed.length) {
      fail("One or more original invoice allocations have already been reversed.", 409, "CUSTOMER_RECEIPT_ALREADY_REVERSED");
    }

    const allocationsByDocument = new Map();
    for (const allocation of originalAllocations) {
      const current = allocationsByDocument.get(allocation.documentId) || accountingDecimal("0");
      allocationsByDocument.set(allocation.documentId, addDecimals(current, allocation.amount));
    }
    for (const [documentId, reversalAmountForDocument] of allocationsByDocument) {
      const document = documentsById.get(documentId);
      const originalAmount = accountingDecimal(document.originalAmount);
      const allocatedNow = accountingDecimal(document.allocatedAmount);
      const remainingNow = accountingDecimal(document.remainingAmount);
      if (
        !addDecimals(allocatedNow, remainingNow).equals(originalAmount) ||
        compareDecimals(allocatedNow, reversalAmountForDocument) < 0 ||
        compareDecimals(addDecimals(remainingNow, reversalAmountForDocument), originalAmount) > 0
      ) {
        fail("Invoice balances no longer support the original receipt reversal.", 409, "CUSTOMER_RECEIPT_BALANCE_MISMATCH");
      }
    }
    const priorPaidAmount = documents.reduce(
      (total, document) => addDecimals(total, document.allocatedAmount),
      accountingDecimal("0"),
    );
    const priorRemainingBalance = documents.reduce(
      (total, document) => addDecimals(total, document.remainingAmount),
      accountingDecimal("0"),
    );

    const treasury = await tx.financialAccount.findUnique({
      where: { id: receipt.toAccountId },
      select: { id: true, accountName: true, currency: true, currentBalance: true, accountingAccountId: true },
    });
    if (!treasury || String(treasury.currency || "NPR").toUpperCase() !== "NPR" || !treasury.accountingAccountId) {
      fail("The original NPR Treasury account is unavailable or no longer mapped.", 409, "SETTLEMENT_TREASURY_ACCOUNT_MISSING");
    }
    const cashJournalLines = originalJournal.lines.filter((line) =>
      line.accountId === treasury.accountingAccountId &&
      accountingDecimal(line.debit).equals(cashAmount) &&
      compareDecimals(line.credit, "0") === 0
    );
    if (cashJournalLines.length !== 1) {
      fail("The original journal does not contain the exact cash receipt on its linked Treasury account.", 409, "CUSTOMER_RECEIPT_JOURNAL_MISMATCH");
    }

    const reversalKey = `CUSTOMER_RECEIPT_REVERSAL:${createHash("sha256").update(receipt.id).digest("hex")}`;
    const treasuryUpdate = await tx.financialAccount.updateMany({
      where: { id: treasury.id, currency: treasury.currency || "NPR", currentBalance: { gte: cashAmount } },
      data: { currentBalance: { decrement: cashAmount } },
    });
    if (treasuryUpdate.count !== 1) {
      fail("Treasury does not have enough balance to record the receipt reversal.", 409, "INSUFFICIENT_TREASURY_BALANCE");
    }
    const reversalTransaction = await tx.cashTransaction.create({
      data: {
        idempotencyKey: reversalKey,
        externalPaymentReference: evidenceReference,
        amount: cashAmount,
        settlementAmount,
        currency: "NPR",
        type: "OUTFLOW",
        fromAccountId: treasury.id,
        category: "REFUND",
        referenceId: receipt.id,
        partyName: receipt.partyName || "",
        invoiceNumber: receipt.invoiceNumber || "",
        description: `${correctionMode}: customer receipt reversal. Evidence: ${evidenceReference}. Reason: ${reason}`,
      },
    });
    const reversalJournal = await reverseJournal({
      journalEntryId: originalJournal.id,
      expectedSourceType: "CUSTOMER_PAYMENT",
      expectedSourceId: receipt.id,
      reversalReason: reason,
      reversedBy: actorAccountId,
      actorContext,
      client: tx,
    });
    if (!reversalJournal?.id) {
      fail("The original customer-payment journal was not reversed.", 409, "CUSTOMER_RECEIPT_JOURNAL_REVERSAL_FAILED");
    }

    let restoredPaidAmount = accountingDecimal("0");
    let restoredRemainingBalance = accountingDecimal("0");
    for (const [documentId, reversalAmountForDocument] of allocationsByDocument) {
      const document = documentsById.get(documentId);
      const allocatedNow = accountingDecimal(document.allocatedAmount);
      const remainingNow = accountingDecimal(document.remainingAmount);
      const originalAmount = accountingDecimal(document.originalAmount);
      const nextAllocated = subtractDecimals(allocatedNow, reversalAmountForDocument);
      const nextRemaining = addDecimals(remainingNow, reversalAmountForDocument);
      const nextStatus = nextRemaining.isZero() ? "PAID" : nextAllocated.isZero() ? "OPEN" : "PARTIALLY_PAID";
      const updated = await tx.accountingDocument.updateMany({
        where: {
          id: document.id,
          allocatedAmount: document.allocatedAmount,
          remainingAmount: document.remainingAmount,
          status: document.status,
        },
        data: { allocatedAmount: nextAllocated, remainingAmount: nextRemaining, status: nextStatus },
      });
      if (updated.count !== 1) {
        fail("An invoice changed during receipt reversal; refresh and retry.", 409, "CUSTOMER_RECEIPT_BALANCE_CONFLICT");
      }
      if (compareDecimals(nextRemaining, originalAmount) > 0) {
        fail("Receipt reversal would over-restore an invoice balance.", 409, "CUSTOMER_RECEIPT_BALANCE_MISMATCH");
      }
      restoredPaidAmount = addDecimals(restoredPaidAmount, nextAllocated);
      restoredRemainingBalance = addDecimals(restoredRemainingBalance, nextRemaining);
    }

    for (const allocation of originalAllocations) {
      const reversalAllocationKey = `CUSTOMER_RECEIPT_REVERSAL_ALLOCATION:${createHash("sha256")
        .update(`${receipt.id}:${allocation.id}`).digest("hex")}`;
      await tx.accountingAllocation.create({
        data: {
          documentId: allocation.documentId,
          cashTransactionId: reversalTransaction.id,
          journalEntryId: reversalJournal.id,
          allocationType: "REVERSAL",
          amount: accountingDecimal(allocation.amount),
          reversesAllocationId: allocation.id,
          notes: `Reverses receipt ${receipt.id}; evidence ${evidenceReference}; reason ${reason}`,
          idempotencyKey: reversalAllocationKey,
        },
      });
    }

    await tx.settlementReversion.create({
      data: {
        reversionType: "CUSTOMER_RECEIPT",
        originalRecordId: receipt.id,
        cashTransactionId: receipt.id,
        reversalTransactionId: reversalTransaction.id,
        reversalJournalEntryId: reversalJournal.id,
        originalAmount: cashAmount,
        partyName: receipt.partyName || "",
        accountId: treasury.id,
        accountName: treasury.accountName || null,
        priorStatus: "CONFIRMED",
        restoredStatus: "REVERSED",
        priorPaidAmount,
        priorRemainingBalance,
        revertedByAdminId: actorAccountId,
        revertedByEmail: actorEmail,
        revertReason: reason,
        correctionMode,
        evidenceReference,
      },
    });
    await writeAudit({ ...actorContext, actorId: actorAccountId }, {
      action: "CUSTOMER_RECEIPT_REVERSED",
      entityType: "CashTransaction",
      entityId: receipt.id,
      beforeState: {
        status: "CONFIRMED",
        amount: cashAmount.toFixed(2),
        settlementAmount: settlementAmount.toFixed(2),
        allocationIds: originalAllocations.map((allocation) => allocation.id),
      },
      afterState: {
        status: "REVERSED",
        correctionMode,
        evidenceReference,
        reversalTransactionId: reversalTransaction.id,
        reversalJournalEntryId: reversalJournal.id,
        reason,
      },
    }, { client: tx });

    return {
      correctionMode,
      restoredStatus: "REVERSED",
      paidAmount: restoredPaidAmount.toFixed(2),
      remainingBalance: restoredRemainingBalance.toFixed(2),
      cashReversedAmount: cashAmount.toFixed(2),
      allocatedReversedAmount: settlementAmount.toFixed(2),
      reversalTransactionId: reversalTransaction.id,
      reversalJournalEntryId: reversalJournal.id,
    };
  };

  try {
    return typeof client.$transaction === "function"
      ? await client.$transaction(execute, { isolationLevel: "Serializable" })
      : await execute(client);
  } catch (error) {
    if (error.code === "P2002") {
      fail("This customer receipt has already been reversed.", 409, "CUSTOMER_RECEIPT_ALREADY_REVERSED");
    }
    throw error;
  }
};

const receiptReference = (ids) =>
  createHash("sha256").update(ids.join("\0")).digest("hex").slice(0, 24).toUpperCase();
