import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  applyCollaborationFeeCreditToInvoice,
  getCollaborationFeeCreditApplications,
} from "../services/collaborationFeeCreditApplicationService.js";

const createHarness = ({
  invoiceIssueDate = "2026-11-01",
  invoicePartnerId = "partner-1",
  invoiceCurrency = "NPR",
  creditStatus = "OPEN",
} = {}) => {
  const creditDate = new Date("2026-10-01T00:00:00.000Z");
  const invoiceDate = new Date(`${invoiceIssueDate}T00:00:00.000Z`);
  const party = { id: "party-1", partyType: "MARKETING_PARTNER", sourceEntityId: "partner-1", displayName: "Partner One" };
  const targetParty = invoicePartnerId === "partner-1"
    ? party
    : { ...party, id: "party-2", sourceEntityId: invoicePartnerId, displayName: "Partner Two" };
  const documents = [
    {
      id: "credit-document",
      documentNumber: "CN-COL-202610",
      documentType: "CREDIT_NOTE",
      side: "RECEIVABLE",
      sourceType: "COLLABORATION_FEE",
      sourceId: "credit-invoice",
      partyId: party.id,
      party,
      currency: "NPR",
      issueDate: creditDate,
      originalAmount: new Prisma.Decimal("113.00"),
      allocatedAmount: new Prisma.Decimal("0.00"),
      remainingAmount: new Prisma.Decimal("113.00"),
      status: creditStatus,
    },
    {
      id: "target-document",
      documentNumber: "COL-PARTNER-202611",
      documentType: "INVOICE",
      side: "RECEIVABLE",
      sourceType: "COLLABORATION_FEE",
      sourceId: "target-invoice",
      partyId: targetParty.id,
      party: targetParty,
      currency: invoiceCurrency,
      issueDate: invoiceDate,
      originalAmount: new Prisma.Decimal("200.00"),
      allocatedAmount: new Prisma.Decimal("0.00"),
      remainingAmount: new Prisma.Decimal("200.00"),
      status: "OPEN",
    },
  ];
  const invoices = [
    {
      id: "credit-invoice",
      invoiceNumber: "COL-PARTNER-202610-CREDIT",
      partnerId: "partner-1",
      totalAmount: new Prisma.Decimal("-113.00"),
      status: "ISSUED",
      accountingDocumentId: "credit-document",
    },
    {
      id: "target-invoice",
      invoiceNumber: "COL-PARTNER-202611",
      partnerId: invoicePartnerId,
      totalAmount: new Prisma.Decimal("200.00"),
      status: "ISSUED",
      accountingDocumentId: "target-document",
    },
  ];
  const applications = [];
  const allocations = [];
  const auditRecords = [];
  const journals = {
    "credit-invoice": {
      id: "credit-journal",
      status: "POSTED",
      totalDebit: new Prisma.Decimal("113.00"),
      totalCredit: new Prisma.Decimal("113.00"),
      lines: [{
        account: { accountCode: "1130" },
        accountingParty: { partyType: "MARKETING_PARTNER", sourceEntityId: "partner-1" },
        debit: new Prisma.Decimal("0.00"),
        credit: new Prisma.Decimal("113.00"),
      }],
    },
    "target-invoice": {
      id: "target-journal",
      status: "POSTED",
      totalDebit: new Prisma.Decimal("200.00"),
      totalCredit: new Prisma.Decimal("200.00"),
      lines: [{
        account: { accountCode: "1130" },
        accountingParty: { partyType: "MARKETING_PARTNER", sourceEntityId: invoicePartnerId },
        debit: new Prisma.Decimal("200.00"),
        credit: new Prisma.Decimal("0.00"),
      }],
    },
  };
  const client = {
    accountingDocument: {
      findUnique: async ({ where }) => documents.find(({ id }) => id === where.id) || null,
      findMany: async ({ where }) => where.documentType === "CREDIT_NOTE"
        ? documents.filter(({ documentType }) => documentType === "CREDIT_NOTE")
        : documents.filter(({ documentType }) => documentType === "INVOICE"),
      updateMany: async ({ where, data }) => {
        const document = documents.find(({ id }) => id === where.id);
        const matches = document &&
          document.allocatedAmount.equals(where.allocatedAmount) &&
          document.remainingAmount.equals(where.remainingAmount) &&
          document.status === where.status;
        if (!matches) return { count: 0 };
        Object.assign(document, data);
        return { count: 1 };
      },
    },
    collaborationFeeInvoice: {
      findUnique: async ({ where }) => invoices.find(({ id }) => id === where.id) || null,
    },
    journalEntry: {
      findFirst: async ({ where }) => {
        const journal = journals[where.sourceId];
        return journal &&
          where.sourceType === "COLLABORATION_FEE_INVOICE" &&
          journal.status === where.status
          ? journal
          : null;
      },
    },
    collaborationFeeCreditApplication: {
      findUnique: async ({ where }) => applications.find(({ idempotencyKey }) => idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        const application = { id: `application-${applications.length + 1}`, ...data };
        applications.push(application);
        return application;
      },
    },
    accountingAllocation: {
      createMany: async ({ data }) => {
        allocations.push(...data);
        return { count: data.length };
      },
    },
  };
  client.$transaction = async (callback, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    return callback(client);
  };
  const writeAudit = async (...args) => { auditRecords.push(args); };

  return {
    client,
    documents,
    applications,
    allocations,
    auditRecords,
    writeAudit,
  };
};

test("partner credit application offsets both documents once and replays idempotently", async () => {
  const harness = createHarness();
  const creditOptions = await getCollaborationFeeCreditApplications({ client: harness.client });
  assert.equal(creditOptions.creditNotes.length, 1);
  assert.equal(creditOptions.creditNotes[0].invoices[0].id, "target-document");

  const input = {
    creditDocumentId: "credit-document",
    invoiceDocumentId: "target-document",
    amount: "50.00",
    idempotencyKey: "partner-credit-application:one",
    notes: "Apply return credit to November invoice",
    client: harness.client,
    writeAudit: harness.writeAudit,
  };
  const applied = await applyCollaborationFeeCreditToInvoice(input);
  const replay = await applyCollaborationFeeCreditToInvoice(input);
  await assert.rejects(
    applyCollaborationFeeCreditToInvoice({ ...input, amount: "51.00" }),
    { code: "IDEMPOTENCY_KEY_REUSED" },
  );

  assert.equal(applied.success, true);
  assert.equal(applied.journalPostedForApplication, false);
  assert.equal(replay.isReplay, true);
  assert.equal(harness.documents[0].remainingAmount.toFixed(2), "63.00");
  assert.equal(harness.documents[1].remainingAmount.toFixed(2), "150.00");
  assert.equal(harness.applications.length, 1);
  assert.equal(harness.allocations.length, 2);
  assert.ok(harness.allocations.every(({ allocationType }) => allocationType === "OFFSET"));
  assert.equal(harness.auditRecords.length, 1);
});

test("partner credit cannot be applied across partners or to an earlier invoice", async (t) => {
  await t.test("rejects a different partner", async () => {
    const harness = createHarness({ invoicePartnerId: "partner-2" });
    await assert.rejects(
      applyCollaborationFeeCreditToInvoice({
        creditDocumentId: "credit-document",
        invoiceDocumentId: "target-document",
        amount: 10,
        idempotencyKey: "partner-credit-application:wrong-partner",
        notes: "Wrong partner test",
        client: harness.client,
        writeAudit: harness.writeAudit,
      }),
      { code: "PARTNER_CREDIT_INVOICE_MISMATCH" },
    );
    assert.equal(harness.allocations.length, 0);
    assert.equal(harness.auditRecords.length, 0);
  });

  await t.test("rejects an invoice issued before the credit note", async () => {
    const harness = createHarness({ invoiceIssueDate: "2026-09-01" });
    await assert.rejects(
      applyCollaborationFeeCreditToInvoice({
        creditDocumentId: "credit-document",
        invoiceDocumentId: "target-document",
        amount: 10,
        idempotencyKey: "partner-credit-application:earlier-invoice",
        notes: "Earlier invoice test",
        client: harness.client,
        writeAudit: harness.writeAudit,
      }),
      { code: "PARTNER_CREDIT_INVOICE_MISMATCH" },
    );
    assert.equal(harness.allocations.length, 0);
    assert.equal(harness.auditRecords.length, 0);
  });

  await t.test("rejects a closed credit note", async () => {
    const harness = createHarness({ creditStatus: "CANCELLED" });
    await assert.rejects(
      applyCollaborationFeeCreditToInvoice({
        creditDocumentId: "credit-document",
        invoiceDocumentId: "target-document",
        amount: 10,
        idempotencyKey: "partner-credit-application:closed-credit",
        notes: "Closed credit test",
        client: harness.client,
        writeAudit: harness.writeAudit,
      }),
      { code: "INVALID_PARTNER_CREDIT_DOCUMENT" },
    );
    assert.equal(harness.allocations.length, 0);
    assert.equal(harness.auditRecords.length, 0);
  });

  await t.test("rejects a mismatched currency", async () => {
    const harness = createHarness({ invoiceCurrency: "USD" });
    await assert.rejects(
      applyCollaborationFeeCreditToInvoice({
        creditDocumentId: "credit-document",
        invoiceDocumentId: "target-document",
        amount: 10,
        idempotencyKey: "partner-credit-application:wrong-currency",
        notes: "Wrong currency test",
        client: harness.client,
        writeAudit: harness.writeAudit,
      }),
      { code: "PARTNER_CREDIT_INVOICE_MISMATCH" },
    );
    assert.equal(harness.allocations.length, 0);
    assert.equal(harness.auditRecords.length, 0);
  });

  await t.test("rejects an amount greater than the open credit", async () => {
    const harness = createHarness();
    await assert.rejects(
      applyCollaborationFeeCreditToInvoice({
        creditDocumentId: "credit-document",
        invoiceDocumentId: "target-document",
        amount: 114,
        idempotencyKey: "partner-credit-application:over-credit",
        notes: "Over-credit test",
        client: harness.client,
        writeAudit: harness.writeAudit,
      }),
      { code: "CREDIT_APPLICATION_EXCEEDS_BALANCE" },
    );
    assert.equal(harness.allocations.length, 0);
    assert.equal(harness.auditRecords.length, 0);
  });
});
