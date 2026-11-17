import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";

const fail = (message, statusCode = 400, code = "COLLABORATION_CREDIT_APPLICATION_INVALID") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const parseAmount = (value) => {
  let amount;
  try {
    amount = new Prisma.Decimal(String(value ?? ""));
  } catch {
    throw fail("Credit application amount must be a valid decimal amount.", 400, "INVALID_AMOUNT");
  }
  if (!amount.isFinite() || !amount.isPositive()) {
    throw fail("Credit application amount must be greater than zero.", 400, "INVALID_AMOUNT");
  }
  const rounded = amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (!rounded.isPositive()) {
    throw fail("Credit application amount must be greater than zero.", 400, "INVALID_AMOUNT");
  }
  return rounded;
};

const getPostedReceivableJournal = async (tx, invoice, amount, direction) => {
  const journal = await tx.journalEntry.findFirst({
    where: {
      sourceType: "COLLABORATION_FEE_INVOICE",
      sourceId: invoice.id,
      status: "POSTED",
    },
    include: {
      lines: {
        include: {
          account: { select: { accountCode: true } },
          accountingParty: { select: { partyType: true, sourceEntityId: true } },
        },
      },
    },
  });
  const receivableLine = journal?.lines?.find((line) =>
    line.account?.accountCode === "1130" &&
    line.accountingParty?.partyType === "MARKETING_PARTNER" &&
    line.accountingParty.sourceEntityId === invoice.partnerId
  );
  const receivableAmount = direction === "DEBIT" ? receivableLine?.debit : receivableLine?.credit;
  if (
    !journal ||
    journal.status !== "POSTED" ||
    !new Prisma.Decimal(String(journal.totalDebit)).equals(amount) ||
    !new Prisma.Decimal(String(journal.totalCredit)).equals(amount) ||
    !receivableLine ||
    !new Prisma.Decimal(String(receivableAmount || 0)).equals(amount)
  ) {
    throw fail("A balanced posted partner receivable journal matching the document is required.", 409, "COLLABORATION_JOURNAL_MISMATCH");
  }
  return journal;
};

const getCreditContext = async (tx, creditDocumentId) => {
  const credit = await tx.accountingDocument.findUnique({
    where: { id: creditDocumentId },
    include: { party: true },
  });
  if (
    !credit ||
    credit.documentType !== "CREDIT_NOTE" ||
    credit.side !== "RECEIVABLE" ||
    credit.sourceType !== "COLLABORATION_FEE" ||
    !["OPEN", "PARTIALLY_PAID"].includes(credit.status)
  ) {
    throw fail("The selected document is not a collaboration-fee credit note.", 409, "INVALID_PARTNER_CREDIT_DOCUMENT");
  }

  const invoice = await tx.collaborationFeeInvoice.findUnique({ where: { id: credit.sourceId } });
  const amount = new Prisma.Decimal(String(credit.originalAmount));
  if (
    !invoice ||
    invoice.status !== "ISSUED" ||
    invoice.accountingDocumentId !== credit.id ||
    !new Prisma.Decimal(String(invoice.totalAmount)).isNegative() ||
    !new Prisma.Decimal(String(invoice.totalAmount)).abs().equals(amount) ||
    credit.party?.partyType !== "MARKETING_PARTNER" ||
    credit.party.sourceEntityId !== invoice.partnerId
  ) {
    throw fail("The partner credit note does not match an issued collaboration-fee credit source.", 409, "PARTNER_CREDIT_SOURCE_MISMATCH");
  }

  const journal = await getPostedReceivableJournal(tx, invoice, amount, "CREDIT");
  return { credit, invoice, journal };
};

const getInvoiceContext = async (tx, invoiceDocumentId) => {
  const document = await tx.accountingDocument.findUnique({
    where: { id: invoiceDocumentId },
    include: { party: true },
  });
  if (
    !document ||
    document.documentType !== "INVOICE" ||
    document.side !== "RECEIVABLE" ||
    document.sourceType !== "COLLABORATION_FEE" ||
    !["OPEN", "PARTIALLY_PAID"].includes(document.status)
  ) {
    throw fail("The selected target must be an open collaboration-fee invoice.", 409, "INVALID_PARTNER_INVOICE_DOCUMENT");
  }

  const invoice = await tx.collaborationFeeInvoice.findUnique({ where: { id: document.sourceId } });
  const amount = new Prisma.Decimal(String(document.originalAmount));
  if (
    !invoice ||
    invoice.status !== "ISSUED" ||
    invoice.accountingDocumentId !== document.id ||
    !new Prisma.Decimal(String(invoice.totalAmount)).isPositive() ||
    !new Prisma.Decimal(String(invoice.totalAmount)).equals(amount) ||
    document.party?.partyType !== "MARKETING_PARTNER" ||
    document.party.sourceEntityId !== invoice.partnerId
  ) {
    throw fail("The target invoice does not match an issued collaboration-fee invoice.", 409, "PARTNER_INVOICE_SOURCE_MISMATCH");
  }

  const journal = await getPostedReceivableJournal(tx, invoice, amount, "DEBIT");
  return { document, invoice, journal };
};

const getEligibleInvoices = async (client, credit, sourceInvoice) => {
  const candidates = await client.accountingDocument.findMany({
    where: {
      partyId: credit.partyId,
      documentType: "INVOICE",
      side: "RECEIVABLE",
      sourceType: "COLLABORATION_FEE",
      currency: credit.currency,
      issueDate: { gte: credit.issueDate },
      status: { in: ["OPEN", "PARTIALLY_PAID"] },
      remainingAmount: { gt: 0 },
      NOT: { id: credit.id },
    },
    select: {
      id: true,
      documentNumber: true,
      issueDate: true,
      currency: true,
      originalAmount: true,
      remainingAmount: true,
      status: true,
      sourceId: true,
    },
    orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
  });
  const invoices = [];
  for (const candidate of candidates) {
    if (candidate.sourceId === sourceInvoice.id) continue;
    await getInvoiceContext(client, candidate.id);
    invoices.push(candidate);
  }
  return invoices;
};

export const getCollaborationFeeCreditApplications = async ({ client = prisma } = {}) => {
  const documents = await client.accountingDocument.findMany({
    where: {
      documentType: "CREDIT_NOTE",
      side: "RECEIVABLE",
      sourceType: "COLLABORATION_FEE",
      status: { in: ["OPEN", "PARTIALLY_PAID"] },
      remainingAmount: { gt: 0 },
    },
    orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
  });
  const credits = [];
  for (const document of documents) {
    const { credit, invoice, journal } = await getCreditContext(client, document.id);
    const invoices = await getEligibleInvoices(client, credit, invoice);
    if (invoices.length > 0) {
      credits.push({
        id: credit.id,
        documentNumber: credit.documentNumber,
        sourceInvoiceNumber: invoice.invoiceNumber,
        issueDate: credit.issueDate,
        currency: credit.currency,
        remainingAmount: credit.remainingAmount,
        status: credit.status,
        partnerId: invoice.partnerId,
        partnerName: credit.party.displayName,
        journalEntryId: journal.id,
        invoices,
      });
    }
  }
  return { creditNotes: credits };
};

const validateReplay = ({ existing, creditDocumentId, invoiceDocumentId, amount }) => {
  if (
    existing.creditDocumentId !== creditDocumentId ||
    existing.invoiceDocumentId !== invoiceDocumentId ||
    !new Prisma.Decimal(String(existing.amount)).equals(amount)
  ) {
    throw fail("This idempotency key was already used for a different partner credit application.", 409, "IDEMPOTENCY_KEY_REUSED");
  }
  return { success: true, application: existing, isReplay: true };
};

export const applyCollaborationFeeCreditToInvoice = async ({
  creditDocumentId,
  invoiceDocumentId,
  amount,
  idempotencyKey,
  appliedByAccountId = null,
  notes,
  client = prisma,
  writeAudit = recordSystemAudit,
} = {}) => {
  const key = String(idempotencyKey || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(key)) {
    throw fail("A valid credit-application idempotency key is required.", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  if (!creditDocumentId || !invoiceDocumentId || creditDocumentId === invoiceDocumentId) {
    throw fail("Select a partner credit note and a different later invoice.", 400, "INVALID_CREDIT_APPLICATION_DOCUMENTS");
  }
  const applicationAmount = parseAmount(amount);
  const normalizedNotes = String(notes || "").trim();
  if (!normalizedNotes || normalizedNotes.length > 1000) {
    throw fail("Application notes are required and must be 1000 characters or fewer.", 400, "APPLICATION_NOTES_REQUIRED");
  }

  const execute = async (tx) => {
    const existing = await tx.collaborationFeeCreditApplication.findUnique({ where: { idempotencyKey: key } });
    if (existing) return validateReplay({ existing, creditDocumentId, invoiceDocumentId, amount: applicationAmount });

    const { credit, invoice: sourceInvoice, journal } = await getCreditContext(tx, creditDocumentId);
    const { document: target, invoice: targetInvoice } = await getInvoiceContext(tx, invoiceDocumentId);
    if (
      credit.partyId !== target.partyId ||
      credit.party?.partyType !== "MARKETING_PARTNER" ||
      target.party?.partyType !== "MARKETING_PARTNER" ||
      credit.party.sourceEntityId !== sourceInvoice.partnerId ||
      target.party.sourceEntityId !== sourceInvoice.partnerId ||
      credit.currency !== target.currency ||
      target.issueDate < credit.issueDate ||
      targetInvoice.id === sourceInvoice.id
    ) {
      throw fail("Credit and target invoice must belong to the same partner and currency, and the invoice must not precede the credit note.", 409, "PARTNER_CREDIT_INVOICE_MISMATCH");
    }

    const creditRemaining = new Prisma.Decimal(String(credit.remainingAmount));
    const invoiceRemaining = new Prisma.Decimal(String(target.remainingAmount));
    if (
      !creditRemaining.isPositive() ||
      !invoiceRemaining.isPositive() ||
      applicationAmount.greaterThan(creditRemaining) ||
      applicationAmount.greaterThan(invoiceRemaining)
    ) {
      throw fail("Application cannot exceed the remaining credit or invoice balance.", 409, "CREDIT_APPLICATION_EXCEEDS_BALANCE");
    }

    const nextCreditAllocated = new Prisma.Decimal(String(credit.allocatedAmount)).plus(applicationAmount);
    const nextCreditRemaining = creditRemaining.minus(applicationAmount);
    const nextInvoiceAllocated = new Prisma.Decimal(String(target.allocatedAmount)).plus(applicationAmount);
    const nextInvoiceRemaining = invoiceRemaining.minus(applicationAmount);
    const nextCreditStatus = nextCreditRemaining.isZero() ? "PAID" : "PARTIALLY_PAID";
    const nextInvoiceStatus = nextInvoiceRemaining.isZero() ? "PAID" : "PARTIALLY_PAID";
    const [creditClaim, invoiceClaim] = await Promise.all([
      tx.accountingDocument.updateMany({
        where: {
          id: credit.id,
          allocatedAmount: credit.allocatedAmount,
          remainingAmount: credit.remainingAmount,
          status: credit.status,
        },
        data: {
          allocatedAmount: nextCreditAllocated,
          remainingAmount: nextCreditRemaining,
          status: nextCreditStatus,
        },
      }),
      tx.accountingDocument.updateMany({
        where: {
          id: target.id,
          allocatedAmount: target.allocatedAmount,
          remainingAmount: target.remainingAmount,
          status: target.status,
        },
        data: {
          allocatedAmount: nextInvoiceAllocated,
          remainingAmount: nextInvoiceRemaining,
          status: nextInvoiceStatus,
        },
      }),
    ]);
    if (creditClaim.count !== 1 || invoiceClaim.count !== 1) {
      throw fail("Partner credit or invoice changed during application; refresh and retry.", 409, "CREDIT_APPLICATION_CONCURRENCY_CONFLICT");
    }

    const application = await tx.collaborationFeeCreditApplication.create({
      data: {
        id: randomUUID(),
        idempotencyKey: key,
        creditDocumentId: credit.id,
        invoiceDocumentId: target.id,
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
          notes: `Applied to collaboration-fee invoice ${target.documentNumber}: ${normalizedNotes}`,
          idempotencyKey: `${key}:CREDIT`,
        },
        {
          documentId: target.id,
          journalEntryId: journal.id,
          allocationType: "OFFSET",
          amount: applicationAmount,
          notes: `Settled by collaboration-fee credit ${credit.documentNumber}: ${normalizedNotes}`,
          idempotencyKey: `${key}:INVOICE`,
        },
      ],
    });
    await writeAudit(
      { actorId: appliedByAccountId, actorRole: "ADMIN", portalSource: "ADMIN" },
      {
        action: "COLLABORATION_FEE_CREDIT_APPLIED",
        entityType: "CollaborationFeeCreditApplication",
        entityId: application.id,
        beforeState: {
          creditRemaining: creditRemaining.toFixed(2),
          invoiceRemaining: invoiceRemaining.toFixed(2),
        },
        afterState: {
          creditDocumentId: credit.id,
          invoiceDocumentId: target.id,
          sourceJournalEntryId: journal.id,
          amount: applicationAmount.toFixed(2),
          creditRemaining: nextCreditRemaining.toFixed(2),
          invoiceRemaining: nextInvoiceRemaining.toFixed(2),
          journalPostedForApplication: false,
        },
      },
      { client: tx },
    );

    return {
      success: true,
      application,
      credit: { id: credit.id, remainingAmount: nextCreditRemaining, status: nextCreditStatus },
      invoice: { id: target.id, remainingAmount: nextInvoiceRemaining, status: nextInvoiceStatus },
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
      if (!["P2002", "P2034"].includes(error?.code)) throw error;
      const existing = await client.collaborationFeeCreditApplication.findUnique({ where: { idempotencyKey: key } });
      if (existing) return validateReplay({ existing, creditDocumentId, invoiceDocumentId, amount: applicationAmount });
      if (error.code !== "P2034" || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
};
