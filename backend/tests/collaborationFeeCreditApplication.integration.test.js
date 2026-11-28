import "../utils/requireIntegrationDatabaseSafety.js";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../config/db.js";
import { applyCollaborationFeeCreditToInvoice } from "../services/collaborationFeeCreditApplicationService.js";
import { finalizeCollaborationFeeInvoice } from "../services/collaborationSalesService.js";

const isAuthorizedLocalSandbox = () => {
  if (process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1") return false;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must identify the authorized local accounting sandbox.");

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid MySQL URL for the authorized local accounting sandbox.");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || databaseName !== "clothing") {
    throw new Error("Refusing collaboration credit integration test outside the authorized local clothing sandbox.");
  }
  return true;
};

const skip = !isAuthorizedLocalSandbox();

test("partner credit application offsets later invoice documents atomically", { skip }, async () => {
  const partnerId = randomUUID();
  const creditInvoiceId = randomUUID();
  const targetInvoiceId = randomUUID();
  const creditInvoiceNumber = `IT-CN-${creditInvoiceId.replace(/-/g, "").slice(0, 12)}`;
  const targetInvoiceNumber = `IT-${targetInvoiceId.replace(/-/g, "").slice(0, 14)}`;
  const rollbackSignal = new Error("Rollback collaboration credit integration fixture.");

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const partner = await tx.marketingPartner.create({
        data: {
          id: partnerId,
          code: `IT${partnerId.replace(/-/g, "").slice(0, 8)}`,
          name: `Integration Partner ${partnerId.slice(0, 8)}`,
        },
      });
      const creditInvoice = await tx.collaborationFeeInvoice.create({
        data: {
          id: creditInvoiceId,
          invoiceNumber: creditInvoiceNumber,
          partnerId,
          periodStart: new Date("2026-09-01T00:00:00.000Z"),
          periodEnd: new Date("2026-09-30T23:59:59.999Z"),
          totalUnits: 1,
          netAmount: -100,
          vatAmount: -13,
          totalAmount: -113,
          status: "PENDING_POSTING",
          issuedAt: new Date("2026-10-01T00:00:00.000Z"),
        },
      });
      const targetInvoice = await tx.collaborationFeeInvoice.create({
        data: {
          id: targetInvoiceId,
          invoiceNumber: targetInvoiceNumber,
          partnerId,
          periodStart: new Date("2026-10-01T00:00:00.000Z"),
          periodEnd: new Date("2026-10-31T23:59:59.999Z"),
          totalUnits: 2,
          netAmount: 200,
          vatAmount: 26,
          totalAmount: 226,
          status: "PENDING_POSTING",
          issuedAt: new Date("2026-11-01T00:00:00.000Z"),
        },
      });

      const issuedCredit = await finalizeCollaborationFeeInvoice({ invoice: creditInvoice, partner, client: tx });
      const issuedTarget = await finalizeCollaborationFeeInvoice({ invoice: targetInvoice, partner, client: tx });
      const creditDocument = await tx.accountingDocument.findUnique({
        where: { id: issuedCredit.accountingDocumentId },
      });
      const targetDocument = await tx.accountingDocument.findUnique({
        where: { id: issuedTarget.accountingDocumentId },
      });
      const result = await applyCollaborationFeeCreditToInvoice({
        creditDocumentId: creditDocument.id,
        invoiceDocumentId: targetDocument.id,
        amount: 50,
        idempotencyKey: `integration:${randomUUID()}`,
        notes: "Rollback-only partner credit offset test",
        appliedByAccountId: null,
        client: tx,
      });

      assert.equal(result.success, true);
      assert.equal(result.journalPostedForApplication, false);
      assert.equal((await tx.accountingDocument.findUnique({ where: { id: creditDocument.id } })).remainingAmount.toFixed(2), "63.00");
      assert.equal((await tx.accountingDocument.findUnique({ where: { id: targetDocument.id } })).remainingAmount.toFixed(2), "176.00");
      assert.equal(await tx.collaborationFeeCreditApplication.count({ where: { creditDocumentId: creditDocument.id } }), 1);
      assert.equal(await tx.accountingAllocation.count({
        where: { documentId: { in: [creditDocument.id, targetDocument.id] }, allocationType: "OFFSET" },
      }), 2);
      assert.equal(await tx.journalEntry.count({
        where: { sourceType: "COLLABORATION_FEE_INVOICE", sourceId: { in: [creditInvoiceId, targetInvoiceId] } },
      }), 2);
      throw rollbackSignal;
    }),
    (error) => error === rollbackSignal,
  );

  assert.equal(await prisma.collaborationFeeCreditApplication.count({ where: { creditDocument: { sourceId: creditInvoiceId } } }), 0);
  assert.equal(await prisma.accountingDocument.count({ where: { sourceType: "COLLABORATION_FEE", sourceId: { in: [creditInvoiceId, targetInvoiceId] } } }), 0);
  assert.equal(await prisma.collaborationFeeInvoice.count({ where: { id: { in: [creditInvoiceId, targetInvoiceId] } } }), 0);
  assert.equal(await prisma.marketingPartner.count({ where: { id: partnerId } }), 0);
});
