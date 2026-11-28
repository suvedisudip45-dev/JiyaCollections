import "../utils/requireIntegrationDatabaseSafety.js";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../config/db.js";
import { postCollaborationFeeInvoiceAccounting } from "../services/accountingPostingEngine.js";
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
    throw new Error("Refusing collaboration invoice integration test outside the authorized local clothing sandbox.");
  }
  return true;
};

const skip = !isAuthorizedLocalSandbox();

const createInvoiceFixture = (partnerId, invoiceId, overrides = {}) => ({
  id: invoiceId,
  invoiceNumber: `IT-${invoiceId.replace(/-/g, "").slice(0, 14)}`,
  partnerId,
  periodStart: new Date("2026-09-01T00:00:00.000Z"),
  periodEnd: new Date("2026-09-30T23:59:59.999Z"),
  totalUnits: 1,
  netAmount: 100,
  vatAmount: 13,
  totalAmount: 113,
  status: "PENDING_POSTING",
  ...overrides,
});

const createPartnerFixture = (partnerId) => ({
  id: partnerId,
  code: `IT${partnerId.replace(/-/g, "").slice(0, 8)}`,
  name: `Integration Partner ${partnerId.slice(0, 8)}`,
});

const createFixture = async (tx, partnerId, invoiceId) => {
  const partner = createPartnerFixture(partnerId);
  const invoiceData = createInvoiceFixture(partner.id, invoiceId);
  await tx.marketingPartner.create({ data: partner });
  const invoice = await tx.collaborationFeeInvoice.create({ data: invoiceData });
  return { partner, invoice };
};

test("collaboration invoice journal, subledger document, status, and lines share one transaction", { skip }, async () => {
  const partnerId = randomUUID();
  const invoiceId = randomUUID();
  const invoiceNumber = `IT-${invoiceId.replace(/-/g, "").slice(0, 14)}`;
  const journalKey = `COLLABORATION_FEE_INVOICE:${invoiceId}`;
  const rollbackSignal = new Error("Rollback collaboration invoice integration fixture.");

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const partner = createPartnerFixture(partnerId);
      await tx.marketingPartner.create({ data: partner });
      const invoice = await tx.collaborationFeeInvoice.create({
        data: createInvoiceFixture(partnerId, invoiceId),
      });

      const issued = await finalizeCollaborationFeeInvoice({
        invoice,
        partner,
        client: tx,
      });
      assert.equal(issued.status, "ISSUED");
      assert.ok(issued.accountingDocumentId);

      const persistedInvoice = await tx.collaborationFeeInvoice.findUnique({
        where: { id: invoiceId },
      });
      assert.equal(persistedInvoice.status, "ISSUED");
      const document = await tx.accountingDocument.findUnique({
        where: { id: issued.accountingDocumentId },
      });
      assert.equal(document.sourceType, "COLLABORATION_FEE");
      assert.equal(document.sourceId, invoiceId);
      assert.equal(document.originalAmount.toFixed(2), "113.00");

      const journal = await tx.journalEntry.findUnique({
        where: { idempotencyKey: journalKey },
        include: { lines: { include: { account: true } } },
      });
      assert.ok(journal);
      assert.equal(journal.status, "POSTED");
      assert.equal(journal.totalDebit.toFixed(2), "113.00");
      assert.equal(journal.totalCredit.toFixed(2), "113.00");
      assert.deepEqual(
        journal.lines.map(({ account, debit, credit }) => ({
          accountCode: account.accountCode,
          debit: debit.toFixed(2),
          credit: credit.toFixed(2),
        })).sort((left, right) => left.accountCode.localeCompare(right.accountCode)),
        [
          { accountCode: "1130", debit: "113.00", credit: "0.00" },
          { accountCode: "2120", debit: "0.00", credit: "13.00" },
          { accountCode: "4300", debit: "0.00", credit: "100.00" },
        ],
      );

      await finalizeCollaborationFeeInvoice({ invoice, partner, client: tx });
      assert.equal(await tx.journalEntry.count({ where: { idempotencyKey: journalKey } }), 1);
      throw rollbackSignal;
    }),
    (error) => error === rollbackSignal,
  );

  assert.equal(await prisma.collaborationFeeInvoice.count({ where: { id: invoiceId } }), 0);
  assert.equal(await prisma.accountingDocument.count({
    where: { sourceType: "COLLABORATION_FEE", sourceId: invoiceId },
  }), 0);
  assert.equal(await prisma.journalEntry.count({ where: { idempotencyKey: journalKey } }), 0);
  assert.equal(await prisma.marketingPartner.count({ where: { id: partnerId } }), 0);
});

test("collaboration invoice failure after journal creation rolls back its document and journal", { skip }, async () => {
  const partnerId = randomUUID();
  const invoiceId = randomUUID();
  const journalKey = `COLLABORATION_FEE_INVOICE:${invoiceId}`;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const { partner, invoice } = await createFixture(tx, partnerId, invoiceId);
      await finalizeCollaborationFeeInvoice({
        invoice,
        partner,
        client: tx,
        postAccounting: async (params) => {
          await postCollaborationFeeInvoiceAccounting(params);
          throw new Error("Injected collaboration invoice completion failure.");
        },
      });
    }),
    /Injected collaboration invoice completion failure/,
  );

  assert.equal(await prisma.collaborationFeeInvoice.count({ where: { id: invoiceId } }), 0);
  assert.equal(await prisma.accountingDocument.count({
    where: { sourceType: "COLLABORATION_FEE", sourceId: invoiceId },
  }), 0);
  assert.equal(await prisma.journalEntry.count({ where: { idempotencyKey: journalKey } }), 0);
});

test("collaboration return credit creates a signed journal and positive credit-note document", { skip }, async () => {
  const partnerId = randomUUID();
  const invoiceId = randomUUID();
  const journalKey = `COLLABORATION_FEE_INVOICE:${invoiceId}`;
  const rollbackSignal = new Error("Rollback collaboration credit-note integration fixture.");

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const partner = createPartnerFixture(partnerId);
      await tx.marketingPartner.create({ data: partner });
      const invoice = await tx.collaborationFeeInvoice.create({
        data: createInvoiceFixture(partnerId, invoiceId, {
          invoiceNumber: `IT-CN-${invoiceId.replace(/-/g, "").slice(0, 12)}`,
          netAmount: -100,
          vatAmount: -13,
          totalAmount: -113,
        }),
      });

      const issued = await finalizeCollaborationFeeInvoice({ invoice, partner, client: tx });
      assert.equal(issued.status, "ISSUED");
      const document = await tx.accountingDocument.findUnique({
        where: { id: issued.accountingDocumentId },
      });
      assert.equal(document.documentType, "CREDIT_NOTE");
      assert.equal(document.documentNumber, `CN-${invoice.invoiceNumber}`);
      assert.equal(document.originalAmount.toFixed(2), "113.00");

      const journal = await tx.journalEntry.findUnique({
        where: { idempotencyKey: journalKey },
        include: { lines: { include: { account: true } } },
      });
      assert.ok(journal);
      assert.equal(journal.totalDebit.toFixed(2), "113.00");
      assert.equal(journal.totalCredit.toFixed(2), "113.00");
      assert.deepEqual(
        journal.lines.map(({ account, debit, credit }) => ({
          accountCode: account.accountCode,
          debit: debit.toFixed(2),
          credit: credit.toFixed(2),
        })).sort((left, right) => left.accountCode.localeCompare(right.accountCode)),
        [
          { accountCode: "1130", debit: "0.00", credit: "113.00" },
          { accountCode: "2120", debit: "13.00", credit: "0.00" },
          { accountCode: "4300", debit: "100.00", credit: "0.00" },
        ],
      );
      throw rollbackSignal;
    }),
    (error) => error === rollbackSignal,
  );

  assert.equal(await prisma.collaborationFeeInvoice.count({ where: { id: invoiceId } }), 0);
  assert.equal(await prisma.accountingDocument.count({
    where: { sourceType: "COLLABORATION_FEE", sourceId: invoiceId },
  }), 0);
  assert.equal(await prisma.journalEntry.count({ where: { idempotencyKey: journalKey } }), 0);
  assert.equal(await prisma.marketingPartner.count({ where: { id: partnerId } }), 0);
});

test("zero-net collaboration invoice is issued without a zero-value document or journal", { skip }, async () => {
  const partnerId = randomUUID();
  const invoiceId = randomUUID();
  const journalKey = `COLLABORATION_FEE_INVOICE:${invoiceId}`;
  const rollbackSignal = new Error("Rollback zero-net collaboration invoice fixture.");

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const partner = createPartnerFixture(partnerId);
      await tx.marketingPartner.create({ data: partner });
      const invoice = await tx.collaborationFeeInvoice.create({
        data: createInvoiceFixture(partnerId, invoiceId, {
          netAmount: 0,
          vatAmount: 0,
          totalAmount: 0,
        }),
      });

      const issued = await finalizeCollaborationFeeInvoice({ invoice, partner, client: tx });
      assert.equal(issued.status, "ISSUED");
      assert.equal(issued.accountingDocumentId, null);
      assert.equal(await tx.accountingDocument.count({
        where: { sourceType: "COLLABORATION_FEE", sourceId: invoiceId },
      }), 0);
      assert.equal(await tx.journalEntry.count({ where: { idempotencyKey: journalKey } }), 0);
      throw rollbackSignal;
    }),
    (error) => error === rollbackSignal,
  );

  assert.equal(await prisma.collaborationFeeInvoice.count({ where: { id: invoiceId } }), 0);
  assert.equal(await prisma.marketingPartner.count({ where: { id: partnerId } }), 0);
});
