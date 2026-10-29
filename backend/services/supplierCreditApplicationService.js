import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";

const toNonNegativeDecimal = (value, label) => {
  let amount;
  try { amount = new Prisma.Decimal(String(value)); } catch {
    throw Object.assign(new Error(`${label} must be a valid decimal amount.`), { statusCode: 400, code: "INVALID_AMOUNT" });
  }
  if (!amount.isFinite() || amount.isNegative()) {
    throw Object.assign(new Error(`${label} must be a non-negative decimal amount.`), { statusCode: 400, code: "INVALID_AMOUNT" });
  }
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

export const applyManufacturerCreditToBill = async ({
  manufacturerId,
  creditDocumentId,
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
    throw Object.assign(new Error("A valid credit-application idempotency key is required."), {
      statusCode: 400,
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  }
  if (!manufacturerId || !creditDocumentId || !billDocumentId || creditDocumentId === billDocumentId) {
    throw Object.assign(new Error("Select different supplier credit and bill documents."), {
      statusCode: 400,
      code: "INVALID_CREDIT_APPLICATION_DOCUMENTS",
    });
  }
  const applicationAmount = toNonNegativeDecimal(amount, "Credit application amount");
  if (applicationAmount.lessThanOrEqualTo(0)) {
    throw Object.assign(new Error("Credit application amount must be greater than zero."), {
      statusCode: 400,
      code: "INVALID_CREDIT_APPLICATION_AMOUNT",
    });
  }
  const normalizedNotes = String(notes || "").trim();
  if (!normalizedNotes || normalizedNotes.length > 1000) {
    throw Object.assign(new Error("Credit application notes are required and must be 1000 characters or fewer."), {
      statusCode: 400,
      code: "CREDIT_APPLICATION_NOTES_REQUIRED",
    });
  }

  const execute = async (tx) => {
    const existing = await tx.supplierCreditApplication.findUnique({ where: { idempotencyKey: key } });
    const [credit, bill] = await Promise.all([
      tx.accountingDocument.findUnique({ where: { id: creditDocumentId }, include: { party: true } }),
      tx.accountingDocument.findUnique({ where: { id: billDocumentId }, include: { party: true } }),
    ]);
    if (existing) {
      if (
        existing.creditDocumentId !== creditDocumentId ||
        existing.billDocumentId !== billDocumentId ||
        !new Prisma.Decimal(String(existing.amount)).equals(applicationAmount)
      ) {
        throw Object.assign(new Error("This idempotency key was already used for a different credit application."), {
          statusCode: 409,
          code: "IDEMPOTENCY_KEY_REUSED",
        });
      }
      if (
        credit?.party?.partyType !== "MANUFACTURER" ||
        bill?.party?.partyType !== "MANUFACTURER" ||
        credit.party.sourceEntityId !== manufacturerId ||
        bill.party.sourceEntityId !== manufacturerId
      ) {
        throw Object.assign(new Error("The selected documents do not belong to this manufacturer."), {
          statusCode: 409,
          code: "CREDIT_BILL_PARTY_MISMATCH",
        });
      }
      return { success: true, application: existing, isReplay: true };
    }

    if (
      !credit ||
      credit.documentType !== "CREDIT_NOTE" ||
      credit.side !== "RECEIVABLE" ||
      credit.sourceType !== "MANUFACTURER_DELIVERY_RETURN" ||
      !["OPEN", "PARTIALLY_PAID"].includes(credit.status)
    ) {
      throw Object.assign(new Error("The selected document is not an open manufacturer return credit note."), {
        statusCode: 409,
        code: "INVALID_SUPPLIER_CREDIT_DOCUMENT",
      });
    }
    if (
      !bill ||
      bill.documentType !== "BILL" ||
      bill.side !== "PAYABLE" ||
      bill.sourceType !== "MANUFACTURER_DELIVERY_COGS" ||
      !["OPEN", "PARTIALLY_PAID"].includes(bill.status)
    ) {
      throw Object.assign(new Error("The selected document is not an open manufacturer delivery bill."), {
        statusCode: 409,
        code: "INVALID_MANUFACTURER_BILL",
      });
    }
    if (
      credit.partyId !== bill.partyId ||
      credit.party?.partyType !== "MANUFACTURER" ||
      bill.party?.partyType !== "MANUFACTURER" ||
      credit.party.sourceEntityId !== manufacturerId ||
      bill.party.sourceEntityId !== manufacturerId ||
      credit.currency !== bill.currency
    ) {
      throw Object.assign(new Error("Supplier credit and bill must belong to the same manufacturer and currency."), {
        statusCode: 409,
        code: "CREDIT_BILL_PARTY_MISMATCH",
      });
    }

    const returnRecord = await tx.customerReturn.findUnique({
      where: { id: credit.sourceId },
      select: { id: true, orderId: true, manufacturerId: true },
    });
    if (
      !returnRecord ||
      !returnRecord.orderId ||
      returnRecord.orderId !== bill.sourceId ||
      returnRecord.manufacturerId !== credit.party.sourceEntityId
    ) {
      throw Object.assign(new Error("The supplier credit is not linked to the selected bill's confirmed manufacturer return."), {
        statusCode: 409,
        code: "CREDIT_RETURN_BILL_MISMATCH",
      });
    }

    const returnJournal = await tx.journalEntry.findFirst({
      where: { sourceType: "DELIVERY_RETURN", sourceId: credit.sourceId, status: "POSTED" },
      include: {
        lines: {
          include: {
            account: { select: { accountCode: true } },
            accountingParty: { select: { partyType: true, sourceEntityId: true } },
          },
        },
      },
    });
    const hasManufacturerPayableReversal = returnJournal?.lines?.some((line) =>
      line.account?.accountCode === "2160" &&
      new Prisma.Decimal(String(line.debit || 0)).greaterThan(0) &&
      (
        line.supplierId === credit.party.sourceEntityId ||
        (line.accountingParty?.partyType === "MANUFACTURER" &&
          line.accountingParty.sourceEntityId === credit.party.sourceEntityId)
      )
    );
    if (!returnJournal || !hasManufacturerPayableReversal) {
      throw Object.assign(new Error("A posted return journal reversing this manufacturer's payable is required before credit application."), {
        statusCode: 409,
        code: "RETURN_PAYABLE_REVERSAL_NOT_FOUND",
      });
    }

    const creditRemaining = new Prisma.Decimal(String(credit.remainingAmount));
    const billRemaining = new Prisma.Decimal(String(bill.remainingAmount));
    if (applicationAmount.greaterThan(creditRemaining) || applicationAmount.greaterThan(billRemaining)) {
      throw Object.assign(new Error("Credit application cannot exceed the remaining credit or bill balance."), {
        statusCode: 409,
        code: "CREDIT_APPLICATION_EXCEEDS_BALANCE",
      });
    }
    const newCreditAllocated = new Prisma.Decimal(String(credit.allocatedAmount)).plus(applicationAmount);
    const newCreditRemaining = creditRemaining.minus(applicationAmount);
    const newBillAllocated = new Prisma.Decimal(String(bill.allocatedAmount)).plus(applicationAmount);
    const newBillRemaining = billRemaining.minus(applicationAmount);
    const nextCreditStatus = newCreditRemaining.isZero() ? "PAID" : "PARTIALLY_PAID";
    const nextBillStatus = newBillRemaining.isZero() ? "PAID" : "PARTIALLY_PAID";

    const [creditClaim, billClaim] = await Promise.all([
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
    ]);
    if (creditClaim.count !== 1 || billClaim.count !== 1) {
      throw Object.assign(new Error("Supplier credit or bill changed during application; refresh and retry."), {
        statusCode: 409,
        code: "CREDIT_APPLICATION_CONCURRENCY_CONFLICT",
      });
    }

    const application = await tx.supplierCreditApplication.create({
      data: {
        id: randomUUID(),
        idempotencyKey: key,
        creditDocumentId: credit.id,
        billDocumentId: bill.id,
        journalEntryId: returnJournal.id,
        amount: applicationAmount,
        appliedByAccountId,
        notes: normalizedNotes,
      },
    });
    await tx.accountingAllocation.createMany({
      data: [
        {
          documentId: credit.id,
          journalEntryId: returnJournal.id,
          amount: applicationAmount,
          notes: `Applied to manufacturer bill ${bill.documentNumber}: ${normalizedNotes}`,
          idempotencyKey: `${key}:CREDIT`,
        },
        {
          documentId: bill.id,
          journalEntryId: returnJournal.id,
          amount: applicationAmount,
          notes: `Settled by manufacturer credit ${credit.documentNumber}: ${normalizedNotes}`,
          idempotencyKey: `${key}:BILL`,
        },
      ],
    });
    await writeAudit(
      { actorId: appliedByAccountId, actorRole: "ADMIN", portalSource: "ADMIN" },
      {
        action: "MANUFACTURER_SUPPLIER_CREDIT_APPLIED",
        entityType: "SupplierCreditApplication",
        entityId: application.id,
        beforeState: {
          creditRemaining: creditRemaining.toFixed(2),
          billRemaining: billRemaining.toFixed(2),
        },
        afterState: {
          creditDocumentId: credit.id,
          billDocumentId: bill.id,
          returnJournalId: returnJournal.id,
          amount: applicationAmount.toFixed(2),
          creditRemaining: newCreditRemaining.toFixed(2),
          billRemaining: newBillRemaining.toFixed(2),
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
      journalEntryId: returnJournal.id,
      journalPostedForApplication: false,
    };
  };

  try {
    return typeof client.$transaction === "function"
      ? await client.$transaction(execute, { isolationLevel: "Serializable" })
      : await execute(client);
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const existing = await client.supplierCreditApplication.findUnique({ where: { idempotencyKey: key } });
    const [credit, bill] = existing
      ? await Promise.all([
          client.accountingDocument.findUnique({ where: { id: creditDocumentId }, include: { party: true } }),
          client.accountingDocument.findUnique({ where: { id: billDocumentId }, include: { party: true } }),
        ])
      : [null, null];
    if (
      !existing ||
      existing.creditDocumentId !== creditDocumentId ||
      existing.billDocumentId !== billDocumentId ||
      !new Prisma.Decimal(String(existing.amount)).equals(applicationAmount) ||
      credit?.party?.sourceEntityId !== manufacturerId ||
      bill?.party?.sourceEntityId !== manufacturerId
    ) {
      throw error;
    }
    return { success: true, application: existing, isReplay: true };
  }
};
