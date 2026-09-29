import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";

const toNonNegativeDecimal = (val, fieldName) => {
  let d;
  try {
    d = new Prisma.Decimal(String(val));
  } catch {
    throw new Error(`${fieldName} must be a valid decimal amount.`);
  }
  if (!d.isFinite() || d.isNegative()) {
    throw new Error(`${fieldName} must be a positive decimal amount.`);
  }
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

/**
 * Creates an AR/AP subledger tracking document (Invoice, Bill, Credit Note, Debit Note).
 */
export const createAccountingDocument = async ({
  documentType = "INVOICE",
  documentNumber,
  partyId,
  side = "RECEIVABLE", // RECEIVABLE | PAYABLE
  sourceType,
  sourceId,
  issueDate = new Date(),
  dueDate = null,
  currency = "NPR",
  amount,
  notes = null,
}, { client = prisma } = {}) => {
  if (!partyId) throw new Error("Accounting document requires a valid partyId.");
  if (!documentNumber) throw new Error("Accounting document requires a unique documentNumber.");
  const decAmount = toNonNegativeDecimal(amount, "Document amount");
  if (decAmount.lessThanOrEqualTo(0)) {
    throw new Error("Document amount must be greater than zero.");
  }

  const normalizedSide = String(side || "").toUpperCase();
  if (!["RECEIVABLE", "PAYABLE"].includes(normalizedSide)) {
    throw new Error("Document side must be RECEIVABLE or PAYABLE.");
  }

  return client.accountingDocument.create({
    data: {
      documentType: String(documentType).toUpperCase(),
      documentNumber: String(documentNumber).trim(),
      partyId,
      side: normalizedSide,
      sourceType: String(sourceType || "MANUAL"),
      sourceId: String(sourceId || documentNumber),
      issueDate: new Date(issueDate),
      dueDate: dueDate ? new Date(dueDate) : null,
      currency: String(currency || "NPR").toUpperCase(),
      originalAmount: decAmount,
      allocatedAmount: new Prisma.Decimal(0),
      remainingAmount: decAmount,
      status: "OPEN",
      notes: notes ? String(notes) : null,
    },
    include: { party: true },
  });
};

/**
 * Allocates a payment or receipt amount against open documents for a party.
 * Supports targeted document allocation or FIFO (oldest due first).
 */
export const allocatePaymentToDocuments = async ({
  partyId,
  side = "RECEIVABLE", // RECEIVABLE (Receipt) | PAYABLE (Disbursement)
  amount,
  journalEntryId = null,
  targetDocumentIds = [],
  notes = null,
}, { client = prisma } = {}) => {
  if (!partyId) throw new Error("partyId is required for allocation.");
  let remainingToAllocate = toNonNegativeDecimal(amount, "Allocation amount");
  if (remainingToAllocate.lessThanOrEqualTo(0)) {
    throw new Error("Allocation amount must be greater than zero.");
  }

  const normalizedSide = String(side || "").toUpperCase();

  // Load open or partially paid documents
  const where = {
    partyId,
    side: normalizedSide,
    status: { in: ["OPEN", "PARTIALLY_PAID"] },
    ...(Array.isArray(targetDocumentIds) && targetDocumentIds.length > 0
      ? { id: { in: targetDocumentIds } }
      : {}),
  };

  const openDocs = await client.accountingDocument.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }, { createdAt: "asc" }],
  });

  const allocations = [];
  const updatedDocs = [];

  for (const doc of openDocs) {
    if (remainingToAllocate.lessThanOrEqualTo(0)) break;

    const docRemaining = new Prisma.Decimal(String(doc.remainingAmount));
    const allocAmount = Prisma.Decimal.min(remainingToAllocate, docRemaining);

    if (allocAmount.greaterThan(0)) {
      const newAllocated = new Prisma.Decimal(String(doc.allocatedAmount)).plus(allocAmount);
      const newRemaining = docRemaining.minus(allocAmount);
      const newStatus = newRemaining.equals(0) ? "PAID" : "PARTIALLY_PAID";

      const allocation = await client.accountingAllocation.create({
        data: {
          documentId: doc.id,
          journalEntryId,
          amount: allocAmount,
          allocatedAt: new Date(),
          notes: notes || `Payment allocation of NPR ${allocAmount.toFixed(2)}`,
        },
      });

      const updated = await client.accountingDocument.update({
        where: { id: doc.id },
        data: {
          allocatedAmount: newAllocated,
          remainingAmount: newRemaining,
          status: newStatus,
        },
      });

      allocations.push(allocation);
      updatedDocs.push(updated);
      remainingToAllocate = remainingToAllocate.minus(allocAmount);
    }
  }

  return {
    totalAllocated: toNonNegativeDecimal(amount, "Total").minus(remainingToAllocate),
    unallocatedAmount: remainingToAllocate, // Advance or credit balance
    allocations,
    updatedDocuments: updatedDocs,
  };
};

/**
 * Reconciles open subledger documents against the control GL account balance.
 */
export const reconcileSubledgerToControl = async ({
  side = "RECEIVABLE", // RECEIVABLE (1130) | PAYABLE (2160 / 2110)
  accountCode,
  partyType = null,
}, { client = prisma } = {}) => {
  const normalizedSide = String(side).toUpperCase();
  const code = accountCode || (normalizedSide === "RECEIVABLE" ? "1130" : "2160");

  const glAccount = await client.account.findUnique({
    where: { accountCode: code },
  });
  if (!glAccount) {
    throw new Error(`Control GL account ${code} not found.`);
  }

  const openDocuments = await client.accountingDocument.findMany({
    where: {
      side: normalizedSide,
      status: { in: ["OPEN", "PARTIALLY_PAID"] },
      ...(partyType ? { party: { partyType: String(partyType).toUpperCase() } } : {}),
    },
    include: { party: true },
  });

  const subledgerTotal = openDocuments.reduce(
    (acc, doc) => acc.plus(new Prisma.Decimal(String(doc.remainingAmount))),
    new Prisma.Decimal(0)
  );

  const glBalance = new Prisma.Decimal(String(glAccount.currentBalance));
  const variance = glBalance.minus(subledgerTotal);

  return {
    side: normalizedSide,
    controlAccountCode: code,
    controlAccountName: glAccount.accountName,
    glBalance: glBalance.toFixed(2),
    subledgerTotal: subledgerTotal.toFixed(2),
    openDocumentCount: openDocuments.length,
    variance: variance.toFixed(2),
    isBalanced: variance.equals(0),
    reconciledAt: new Date().toISOString(),
  };
};
