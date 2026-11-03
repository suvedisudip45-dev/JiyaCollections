import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { reviewOperatingExpenseInputVat } from "../services/purchaseVatService.js";

const makeClient = ({ taxStatus = "VAT_REGISTERED" } = {}) => {
  const expense = {
    id: "expense-1",
    title: "Office supplies",
    category: "PRINTING",
    amount: 113,
    isVatBill: true,
    vatAmount: 13,
    supplierVatNumber: "123456789",
    invoiceNumber: "SUP-001",
    invoiceEvidenceUrl: "https://example.test/invoice.pdf",
    purchaseTaxableAmount: new Prisma.Decimal(100),
    purchaseVatRate: new Prisma.Decimal(13),
    purchaseVatStatus: "PENDING_REVIEW",
    date: new Date("2026-10-10T12:00:00.000Z"),
    vendorName: "Example Supplier",
  };
  const posted = [];
  const client = {
    operatingExpense: {
      findUnique: async () => ({ ...expense }),
      findFirst: async () => null,
      update: async ({ data }) => Object.assign(expense, data),
    },
    taxRegistrationVersion: {
      findFirst: async () => taxStatus === "VAT_REGISTERED" ? { taxStatus, vatNumber: "999999999" } : null,
    },
    vatRateVersion: {
      findFirst: async () => ({ vatRate: new Prisma.Decimal(13) }),
    },
    taxConfiguration: { findUnique: async () => ({ vatRate: new Prisma.Decimal(13) }) },
    journalEntry: {
      findFirst: async () => ({ id: "expense-journal" }),
    },
    $transaction: async (callback) => callback(client),
  };
  return { client, expense, posted };
};

test("input VAT is recognized only after review and a balanced journal posts in the invoice period", async () => {
  const { client, posted } = makeClient();
  const result = await reviewOperatingExpenseInputVat({
    expenseId: "expense-1",
    decision: "APPROVE",
    reason: "Original VAT invoice reviewed against supplier details.",
    reviewedBy: "finance-admin",
    client,
    postJournal: async (journal) => {
      posted.push(journal);
      return { id: "input-vat-journal" };
    },
  });

  assert.equal(result.purchaseVatStatus, "VERIFIED");
  assert.equal(result.purchaseVatJournalEntryId, "input-vat-journal");
  assert.equal(result.purchaseVatReviewReason, "Original VAT invoice reviewed against supplier details.");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].transactionDate.toISOString(), "2026-10-10T12:00:00.000Z");
  assert.equal(posted[0].lines[0].accountCode, "1150");
  assert.equal(posted[0].lines[0].debit.toString(), "13");
  assert.equal(posted[0].lines[1].accountCode, "6700");
  assert.equal(posted[0].lines[1].credit.toString(), "13");
});

test("input VAT approval rejects purchases outside the buyer VAT-registration period", async () => {
  const { client } = makeClient({ taxStatus: "PAN_ONLY" });
  await assert.rejects(reviewOperatingExpenseInputVat({
    expenseId: "expense-1",
    decision: "APPROVE",
    reason: "Invoice checked.",
    client,
    postJournal: async () => ({ id: "unused" }),
  }), (error) => error.code === "BUYER_NOT_VAT_REGISTERED_ON_PURCHASE_DATE");
});

test("input VAT approval rejects non-HTTP invoice evidence", async () => {
  const { client, expense } = makeClient();
  expense.invoiceEvidenceUrl = "javascript:alert(1)";
  await assert.rejects(reviewOperatingExpenseInputVat({
    expenseId: "expense-1",
    decision: "APPROVE",
    reason: "Invoice checked.",
    client,
    postJournal: async () => ({ id: "unused" }),
  }), (error) => error.code === "PURCHASE_VAT_DOCUMENT_INCOMPLETE");
});

test("input VAT rejection is auditable without posting a claim", async () => {
  const { client, posted } = makeClient();
  const result = await reviewOperatingExpenseInputVat({
    expenseId: "expense-1",
    decision: "REJECT",
    reason: "Supplier VAT identity could not be verified.",
    client,
    postJournal: async (journal) => {
      posted.push(journal);
      return { id: "unused" };
    },
  });

  assert.equal(result.purchaseVatStatus, "REJECTED");
  assert.equal(result.purchaseVatReviewReason, "Supplier VAT identity could not be verified.");
  assert.equal(posted.length, 0);
});
