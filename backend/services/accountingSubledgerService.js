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
  idempotencyKey = null,
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

  const data = {
    idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : null,
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
  };
  if (data.idempotencyKey) {
    return client.accountingDocument.upsert({
      where: { idempotencyKey: data.idempotencyKey },
      create: data,
      update: {},
      include: { party: true },
    });
  }
  return client.accountingDocument.create({
    data,
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
  settlementBatchId = null,
  allocationType = null,
  targetDocumentIds = [],
  sourceTypes = [],
  notes = null,
  idempotencyKey = null,
}, { client = prisma } = {}) => {
  if (!partyId) throw new Error("partyId is required for allocation.");
  let remainingToAllocate = toNonNegativeDecimal(amount, "Allocation amount");
  if (remainingToAllocate.lessThanOrEqualTo(0)) {
    throw new Error("Allocation amount must be greater than zero.");
  }

  const normalizedSide = String(side || "").toUpperCase();
  const normalizedAllocationType = allocationType === null
    ? null
    : String(allocationType).trim().toUpperCase();
  if (normalizedAllocationType && !["CASH", "OFFSET"].includes(normalizedAllocationType)) {
    throw new Error("Allocation type must be CASH or OFFSET.");
  }

  // Load open or partially paid documents
  const where = {
    partyId,
    side: normalizedSide,
    status: { in: ["OPEN", "PARTIALLY_PAID"] },
    ...(Array.isArray(targetDocumentIds) && targetDocumentIds.length > 0
      ? { id: { in: targetDocumentIds } }
      : {}),
    ...(Array.isArray(sourceTypes) && sourceTypes.length > 0
      ? { sourceType: { in: sourceTypes.map((sourceType) => String(sourceType).toUpperCase()) } }
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
      const allocationKey = idempotencyKey ? `${String(idempotencyKey).slice(0, 130)}:${doc.id}` : null;

      if (allocationKey) {
        const existingAllocation = await client.accountingAllocation.findUnique({
          where: { idempotencyKey: allocationKey },
        });
        if (existingAllocation) {
          if (
            existingAllocation.documentId !== doc.id ||
            !new Prisma.Decimal(String(existingAllocation.amount)).equals(allocAmount)
          ) {
            throw new Error("Accounting allocation idempotency key was reused with different details.");
          }
          allocations.push(existingAllocation);
          remainingToAllocate = remainingToAllocate.minus(allocAmount);
          continue;
        }
      }

      const claimed = await client.accountingDocument.updateMany({
        where: {
          id: doc.id,
          allocatedAmount: doc.allocatedAmount,
          remainingAmount: doc.remainingAmount,
          status: doc.status,
        },
        data: {
          allocatedAmount: newAllocated,
          remainingAmount: newRemaining,
          status: newStatus,
        },
      });
      if (claimed.count !== 1) {
        throw new Error(`Accounting document ${doc.id} changed during payment allocation.`);
      }

      const allocation = await client.accountingAllocation.create({
        data: {
          documentId: doc.id,
          journalEntryId,
          settlementBatchId,
          allocationType: normalizedAllocationType,
          amount: allocAmount,
          allocatedAt: new Date(),
          notes: notes || `Payment allocation of NPR ${allocAmount.toFixed(2)}`,
          idempotencyKey: allocationKey,
        },
      });

      allocations.push(allocation);
      updatedDocs.push({ ...doc, allocatedAmount: newAllocated, remainingAmount: newRemaining, status: newStatus });
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
 * Reconciles open subledger documents against the mapped control GL account balance.
 */
export const reconcileSubledgerToControl = async ({
  side = "RECEIVABLE", // RECEIVABLE (1130, 1170, 1190) | PAYABLE (2110, 2160-2190)
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
