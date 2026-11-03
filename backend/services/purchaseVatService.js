import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { getOperatingExpenseAccountCode, postJournalEntry } from "./accountingPostingEngine.js";
import { resolveSellerTaxTreatment } from "./sellerTaxProfileService.js";
import { hasValidVatSupplierIdentity } from "./manufacturerTaxIdentity.js";

const fail = (message, statusCode = 400, code = "PURCHASE_VAT_REVIEW_ERROR") =>
  Object.assign(new Error(message), { statusCode, code });

const amount = (value) => new Prisma.Decimal(String(value ?? 0))
  .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

const isHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

export const reviewOperatingExpenseInputVat = async ({
  expenseId,
  decision,
  reason,
  reviewedBy,
  client = prisma,
  postJournal = postJournalEntry,
  afterReview = null,
} = {}) => {
  const id = String(expenseId ?? "").trim();
  const action = String(decision ?? "").trim().toUpperCase();
  const note = String(reason ?? "").trim();
  if (!id || !["APPROVE", "REJECT"].includes(action) || note.length < 3 || note.length > 2000) {
    throw fail("Expense ID, review decision, and a reason of 3 to 2,000 characters are required.", 400, "INVALID_PURCHASE_VAT_REVIEW");
  }

  return client.$transaction(async (tx) => {
    const expense = await tx.operatingExpense.findUnique({ where: { id } });
    if (!expense) throw fail("Operating expense was not found.", 404, "OPERATING_EXPENSE_NOT_FOUND");
    const nextStatus = action === "APPROVE" ? "VERIFIED" : "REJECTED";
    if (expense.purchaseVatStatus === nextStatus) return expense;
    if (expense.purchaseVatStatus !== "PENDING_REVIEW") {
      throw fail("Only a purchase VAT invoice pending review can be approved or rejected.", 409, "PURCHASE_VAT_NOT_PENDING");
    }

    if (action === "REJECT") {
      const rejected = await tx.operatingExpense.update({
        where: { id },
        data: {
          purchaseVatStatus: "REJECTED",
          purchaseVatVerifiedAt: new Date(),
          purchaseVatVerifiedBy: reviewedBy ? String(reviewedBy).slice(0, 191) : null,
          purchaseVatReviewReason: note,
        },
      });
      if (afterReview) await afterReview(expense, rejected, tx);
      return rejected;
    }

    const supplierIdentity = {
      taxIdType: "VAT",
      taxIdNumber: expense.supplierVatNumber,
    };
    if (
      !expense.isVatBill ||
      !hasValidVatSupplierIdentity(supplierIdentity) ||
      !String(expense.invoiceNumber || "").trim() ||
      !String(expense.invoiceEvidenceUrl || "").trim() ||
      String(expense.invoiceEvidenceUrl).length > 5000 ||
      !isHttpUrl(String(expense.invoiceEvidenceUrl))
    ) {
      throw fail("A VAT invoice reference, supplier's 9-digit VAT number, and invoice evidence are required before approval.", 400, "PURCHASE_VAT_DOCUMENT_INCOMPLETE");
    }

    const grossAmount = amount(expense.amount);
    const inputVat = amount(expense.vatAmount);
    const taxableAmount = amount(expense.purchaseTaxableAmount ?? grossAmount.minus(inputVat));
    const rate = amount(expense.purchaseVatRate ?? 13);
    if (
      grossAmount.lessThanOrEqualTo(0) ||
      inputVat.lessThanOrEqualTo(0) ||
      taxableAmount.lessThanOrEqualTo(0) ||
      inputVat.greaterThanOrEqualTo(grossAmount) ||
      rate.lessThanOrEqualTo(0) ||
      rate.greaterThan(100) ||
      taxableAmount.plus(inputVat).minus(grossAmount).abs().greaterThan("0.02") ||
      taxableAmount.mul(rate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).minus(inputVat).abs().greaterThan("0.02")
    ) {
      throw fail("The supplier invoice taxable base, VAT amount, rate, and gross total do not reconcile.", 400, "PURCHASE_VAT_AMOUNT_MISMATCH");
    }

    const taxPoint = new Date(expense.date);
    if (Number.isNaN(taxPoint.getTime()) || taxPoint > new Date()) {
      throw fail("Purchase invoice date must be valid and cannot be in the future.", 400, "INVALID_PURCHASE_VAT_DATE");
    }
    const buyerTreatment = await resolveSellerTaxTreatment(taxPoint, { client: tx });
    if (buyerTreatment.taxStatus !== "VAT_REGISTERED") {
      throw fail("The business was not VAT-registered on the supplier invoice date; input VAT cannot be claimed.", 409, "BUYER_NOT_VAT_REGISTERED_ON_PURCHASE_DATE");
    }

    const duplicate = await tx.operatingExpense.findFirst({
      where: {
        id: { not: expense.id },
        supplierVatNumber: expense.supplierVatNumber,
        invoiceNumber: expense.invoiceNumber,
        purchaseVatStatus: { in: ["PENDING_REVIEW", "VERIFIED"] },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw fail("This supplier VAT number and invoice reference are already recorded on another expense.", 409, "DUPLICATE_PURCHASE_VAT_INVOICE");
    }

    const baseJournal = await tx.journalEntry.findFirst({
      where: { sourceType: "EXPENSE_PAYMENT", sourceId: expense.id, status: "POSTED" },
      select: { id: true },
    });
    if (!baseJournal) {
      throw fail("The expense's original accounting journal must be posted before input VAT can be recognized.", 409, "EXPENSE_LEDGER_NOT_POSTED");
    }

    const journal = await postJournal({
      transactionDate: taxPoint,
      sourceType: "PURCHASE_INPUT_VAT_VERIFIED",
      sourceId: expense.id,
      idempotencyKey: `PURCHASE_INPUT_VAT:${expense.id}`,
      referenceNumber: expense.invoiceNumber,
      description: `Recognize verified supplier input VAT for ${expense.vendorName || expense.title}. ${note}`,
      createdBy: reviewedBy || "admin",
      lines: [
        {
          accountCode: "1150",
          debit: inputVat,
          credit: 0,
          description: `Recoverable input VAT on supplier invoice ${expense.invoiceNumber}`,
          supplierName: expense.vendorName || "",
        },
        {
          accountCode: getOperatingExpenseAccountCode(expense.category),
          debit: 0,
          credit: inputVat,
          description: `Reclassify verified VAT from expense ${expense.title}`,
          supplierName: expense.vendorName || "",
        },
      ],
      client: tx,
    });
    const verified = await tx.operatingExpense.update({
      where: { id: expense.id },
      data: {
        purchaseTaxableAmount: taxableAmount,
        purchaseVatStatus: "VERIFIED",
        purchaseVatVerifiedAt: new Date(),
        purchaseVatVerifiedBy: reviewedBy ? String(reviewedBy).slice(0, 191) : null,
        purchaseVatReviewReason: note,
        purchaseVatJournalEntryId: journal.id,
      },
    });
    if (afterReview) await afterReview(expense, verified, tx);
    return verified;
  }, { isolationLevel: "Serializable" });
};
