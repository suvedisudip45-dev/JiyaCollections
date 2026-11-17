import "../utils/requireIntegrationDatabaseSafety.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../config/db.js";
import { applySupplierReturnCreditToBill } from "../services/supplierReturnCreditApplicationService.js";

const isAuthorizedLocalSandbox = () => {
  if (process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1") return false;
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
      && decodeURIComponent(url.pathname.slice(1)) === "clothing";
  } catch {
    return false;
  }
};

test("supplier return credit applies to a future same-vendor bill without a second journal", {
  skip: !isAuthorizedLocalSandbox(),
}, async () => {
  const suffix = randomUUID();
  const sentinel = new Error("ROLLBACK_SUPPLIER_RETURN_CREDIT_TEST");
  let observed = null;
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const [payableAccount, inventoryAccount] = await Promise.all([
        tx.account.findUnique({ where: { accountCode: "2110" } }),
        tx.account.findUnique({ where: { accountCode: "1140" } }),
      ]);
      assert.ok(payableAccount);
      assert.ok(inventoryAccount);

      const party = await tx.accountingParty.create({
        data: {
          partyType: "VENDOR",
          sourceEntityId: `TEST-VENDOR-${suffix}`,
          displayName: `Integration Vendor ${suffix}`,
          currency: "NPR",
        },
      });
      const supplierReturn = await tx.supplierReturn.create({
        data: {
          supplierName: party.displayName,
          supplierReference: party.sourceEntityId,
          totalDebitAmount: 100,
          vatReversal: 0,
          settlementType: "CREDIT_NOTE_OFFSET_PAYABLE",
          status: "COMPLETED",
          reason: "Integration test supplier return",
        },
      });
      const journal = await tx.journalEntry.create({
        data: {
          journalNumber: `TEST-SR-CREDIT-${suffix}`,
          sourceType: "SUPPLIER_RETURN",
          sourceId: supplierReturn.id,
          idempotencyKey: `TEST-SR-CREDIT-${suffix}`,
          description: "Integration test supplier return",
          totalDebit: 100,
          totalCredit: 100,
          lines: {
            create: [
              {
                accountId: payableAccount.id,
                accountingPartyId: party.id,
                supplierName: party.displayName,
                debit: 100,
                credit: 0,
              },
              {
                accountId: inventoryAccount.id,
                accountingPartyId: party.id,
                supplierName: party.displayName,
                debit: 0,
                credit: 100,
              },
            ],
          },
        },
      });
      const credit = await tx.accountingDocument.create({
        data: {
          documentType: "CREDIT_NOTE",
          documentNumber: `TEST-SR-CN-${suffix}`,
          partyId: party.id,
          side: "PAYABLE",
          sourceType: "SUPPLIER_RETURN",
          sourceId: supplierReturn.id,
          originalAmount: 100,
          remainingAmount: 100,
          status: "OPEN",
        },
      });
      const bill = await tx.accountingDocument.create({
        data: {
          documentType: "BILL",
          documentNumber: `TEST-SR-BILL-${suffix}`,
          partyId: party.id,
          side: "PAYABLE",
          sourceType: "PROCUREMENT",
          sourceId: `TEST-SHIPMENT-${suffix}`,
          originalAmount: 160,
          remainingAmount: 160,
          status: "OPEN",
        },
      });
      await tx.supplierReturn.update({
        where: { id: supplierReturn.id },
        data: {
          accountingJournalEntryId: journal.id,
          accountingDocumentId: credit.id,
        },
      });

      const key = `TEST-SR-CREDIT-APPLICATION-${suffix}`;
      const result = await applySupplierReturnCreditToBill({
        supplierReturnId: supplierReturn.id,
        billDocumentId: bill.id,
        amount: "35.25",
        idempotencyKey: key,
        appliedByAccountId: "integration-test",
        notes: "Apply to a later vendor bill.",
        client: tx,
        writeAudit: async () => {},
      });
      assert.equal(result.journalEntryId, journal.id);
      assert.equal(result.journalPostedForApplication, false);

      const [updatedCredit, updatedBill, applications, allocations, journalCount] = await Promise.all([
        tx.accountingDocument.findUnique({ where: { id: credit.id } }),
        tx.accountingDocument.findUnique({ where: { id: bill.id } }),
        tx.supplierReturnCreditApplication.findMany({ where: { supplierReturnId: supplierReturn.id } }),
        tx.accountingAllocation.findMany({
          where: { idempotencyKey: { in: [`${key}:CREDIT`, `${key}:BILL`] } },
        }),
        tx.journalEntry.count({ where: { sourceType: "SUPPLIER_RETURN", sourceId: supplierReturn.id } }),
      ]);
      assert.equal(updatedCredit.remainingAmount.toFixed(2), "64.75");
      assert.equal(updatedBill.remainingAmount.toFixed(2), "124.75");
      assert.equal(applications.length, 1);
      assert.equal(allocations.length, 2);
      assert.ok(allocations.every(({ journalEntryId, amount }) =>
        journalEntryId === journal.id && amount.toFixed(2) === "35.25"));
      assert.equal(journalCount, 1);
      observed = { supplierReturnId: supplierReturn.id, creditId: credit.id, billId: bill.id, key };
      throw sentinel;
    }),
    (error) => error === sentinel,
  );

  assert.ok(observed);
  assert.equal(await prisma.supplierReturn.count({ where: { id: observed.supplierReturnId } }), 0);
  assert.equal(await prisma.accountingDocument.count({ where: { id: { in: [observed.creditId, observed.billId] } } }), 0);
  assert.equal(await prisma.supplierReturnCreditApplication.count({ where: { idempotencyKey: observed.key } }), 0);
});
