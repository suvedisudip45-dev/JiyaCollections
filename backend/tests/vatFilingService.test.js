import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  createVatFilingDraft,
  amendVatReturn,
  fileVatReturn,
  recordVatFilingPayment,
} from "../services/vatFilingService.js";

const makeClient = ({
  overlappingRecord = null,
  priorFiledReturns = [],
  salesInvoices = [],
  purchaseExpenses = [],
  productionInvoices = [],
} = {}) => {
  const createdRecords = [];
  const reportingLines = [
    {
      debit: new Prisma.Decimal(0),
      credit: new Prisma.Decimal(1000),
      account: { accountCode: "4100", accountType: "REVENUE", accountName: "Sales", normalBalance: "CREDIT" },
      journalEntry: { transactionDate: new Date("2026-10-10T12:00:00.000Z"), sourceType: "DELIVERED_ORDER", status: "POSTED" },
    },
    {
      debit: new Prisma.Decimal(0),
      credit: new Prisma.Decimal(130),
      account: { accountCode: "2120", accountType: "LIABILITY", accountName: "Output VAT", normalBalance: "CREDIT" },
      journalEntry: { transactionDate: new Date("2026-10-10T12:00:00.000Z"), sourceType: "DELIVERED_ORDER", status: "POSTED" },
    },
    {
      debit: new Prisma.Decimal(60),
      credit: new Prisma.Decimal(0),
      account: { accountCode: "1150", accountType: "ASSET", accountName: "Input VAT", normalBalance: "DEBIT" },
      journalEntry: { transactionDate: new Date("2026-10-10T12:00:00.000Z"), sourceType: "SUPPLIER_INVOICE", status: "POSTED" },
    },
    {
      debit: new Prisma.Decimal(25),
      credit: new Prisma.Decimal(0),
      account: { accountCode: "2120", accountType: "LIABILITY", accountName: "Output VAT", normalBalance: "CREDIT" },
      journalEntry: { transactionDate: new Date("2026-10-20T12:00:00.000Z"), sourceType: "VAT_RETURN_NETTING", status: "POSTED" },
    },
    {
      debit: new Prisma.Decimal(0),
      credit: new Prisma.Decimal(25),
      account: { accountCode: "1150", accountType: "ASSET", accountName: "Input VAT", normalBalance: "DEBIT" },
      journalEntry: { transactionDate: new Date("2026-10-20T12:00:00.000Z"), sourceType: "VAT_RETURN_NETTING", status: "POSTED" },
    },
    {
      debit: new Prisma.Decimal(40),
      credit: new Prisma.Decimal(0),
      account: { accountCode: "1150", accountType: "ASSET", accountName: "Input VAT", normalBalance: "DEBIT" },
      journalEntry: { transactionDate: new Date("2026-09-20T12:00:00.000Z"), sourceType: "SUPPLIER_INVOICE", status: "POSTED" },
    },
    {
      debit: new Prisma.Decimal(10),
      credit: new Prisma.Decimal(0),
      account: { accountCode: "2120", accountType: "LIABILITY", accountName: "Output VAT", normalBalance: "CREDIT" },
      journalEntry: { transactionDate: new Date("2026-09-20T12:00:00.000Z"), sourceType: "DELIVERY_RETURN", status: "POSTED" },
    },
  ];
  const client = {
    taxFilingRecord: {
      findFirst: async ({ where }) => {
        if (where.periodStart) return overlappingRecord;
        return null;
      },
      findMany: async () => priorFiledReturns,
      create: async ({ data }) => {
        const record = { ...data, assessedAmount: null, payments: [] };
        createdRecords.push(record);
        return record;
      },
    },
    operatingExpense: { findMany: async () => purchaseExpenses },
    manufacturerProductionRequest: { findMany: async () => productionInvoices },
    journalLine: {
      findMany: async () => reportingLines,
    },
    salesInvoice: {
      findMany: async () => salesInvoices,
    },
    $transaction: async (callback) => callback(client),
  };
  return { client, createdRecords };
};

test("VAT filing draft uses full Nepal calendar dates, excludes filing settlements, and carries prior input credit", async () => {
  const { client, createdRecords } = makeClient();
  const record = await createVatFilingDraft({
    periodKey: "2026-10",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    client,
  });

  assert.equal(record.periodStart.toISOString(), "2026-09-30T18:15:00.000Z");
  assert.equal(record.periodEnd.toISOString(), "2026-10-31T18:14:59.999Z");
  assert.equal(record.taxableSales, "1000.00");
  assert.equal(record.outputVat, "130.00");
  assert.equal(record.inputVat, "60.00");
  assert.equal(record.carriedForwardInputVat, "40.00");
  assert.equal(record.carriedForwardOutputVat, "0.00");
  assert.equal(record.filingCadence, "CUSTOM");
  assert.equal(record.carriedForwardPaymentCredit, "0.00");
  assert.equal(record.vatCreditCarryForward, "0.00");
  assert.equal(record.sourceReconciliation.purchaseDocuments.status, "PARTIAL_REGISTER");
  assert.equal(record.estimateVariance, null);
  assert.equal(record.netVatPayable, "30.00");
  assert.match(record.notes, /Purchase register coverage is partial/);
  assert.equal(createdRecords.length, 1);
});

test("VAT filing workpaper reconciles verified operating and production purchase invoices", async () => {
  const { client } = makeClient({
    purchaseExpenses: [{
      date: new Date("2026-10-10T12:00:00.000Z"),
      vatAmount: new Prisma.Decimal(13),
      purchaseTaxableAmount: new Prisma.Decimal(100),
    }],
    productionInvoices: [{
      approvedVatInvoiceDate: new Date("2026-10-15T12:00:00.000Z"),
      approvedVatInvoiceEvidenceUrl: "https://example.test/production-invoice.pdf",
      approvedVatRate: new Prisma.Decimal(13),
      costLayers: [{
        unitVatAmount: new Prisma.Decimal(13),
        producedQuantity: 1,
      }],
    }],
  });
  const filing = await createVatFilingDraft({
    periodKey: "2026-10",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    client,
  });

  assert.equal(filing.taxablePurchases, "200.00");
  assert.equal(filing.sourceReconciliation.purchaseDocuments.supplierOperatingExpenses.inputVat, "13.00");
  assert.equal(filing.sourceReconciliation.purchaseDocuments.manufacturerProductionInvoices.inputVat, "13.00");
  assert.equal(filing.sourceReconciliation.purchaseDocuments.sourceInputVat, "26.00");
  assert.equal(filing.sourceReconciliation.purchaseDocuments.postedInputVat, "60.00");
  assert.equal(filing.sourceReconciliation.purchaseDocuments.inputVatVariance, "34.00");
});

test("VAT filing draft rejects unsupported cadence values", async () => {
  const { client } = makeClient();
  await assert.rejects(createVatFilingDraft({
    filingCadence: "BIMONTHLY",
    periodKey: "2026-10",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    client,
  }), (error) => error.code === "INVALID_VAT_FILING_CADENCE");
});

test("VAT filing drafts retain selected cadence and carry prior cash overpayments forward", async () => {
  const { client } = makeClient({
    priorFiledReturns: [
      {
        status: "PAID",
        assessedAmount: new Prisma.Decimal(100),
        paymentCreditApplied: new Prisma.Decimal(0),
        payments: [{ amount: new Prisma.Decimal(125) }],
        vatCreditCarryForward: new Prisma.Decimal(0),
      },
    ],
  });
  const filing = await createVatFilingDraft({
    filingCadence: "SEMIANNUAL",
    periodKey: "2027-H1",
    periodStart: "2027-01-01",
    periodEnd: "2027-06-30",
    client,
  });

  assert.equal(filing.filingCadence, "SEMIANNUAL");
  assert.equal(filing.carriedForwardPaymentCredit, "25.00");
});

test("VAT filing draft reconciles billed sales tax and unresolved credit notes against the GL", async () => {
  const { client } = makeClient({
    salesInvoices: [{
      id: "invoice-1",
      taxPoint: new Date("2026-10-10T12:00:00.000Z"),
      taxableAmount: new Prisma.Decimal(1000),
      vatAmount: new Prisma.Decimal(130),
      adjustments: [{
        adjustmentType: "CREDIT_NOTE",
        status: "CREDIT_NOTE_REQUIRED",
        vatAmount: new Prisma.Decimal(13),
      }],
    }],
  });
  const filing = await createVatFilingDraft({
    periodKey: "2026-10",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    client,
  });

  assert.equal(filing.sourceReconciliation.salesInvoices.count, 1);
  assert.equal(filing.sourceReconciliation.salesInvoices.taxableSales, "1000.00");
  assert.equal(filing.sourceReconciliation.salesAdjustments.unresolvedCount, 1);
  assert.equal(filing.sourceReconciliation.sourceOutputVatAfterAdjustments, "117.00");
  assert.equal(filing.sourceReconciliation.postedOutputVat, "130.00");
  assert.equal(filing.sourceReconciliation.outputVatVariance, "13.00");
});

test("filing an accountant-adjusted assessment requires a reason and keeps liability separate from payment", async () => {
  const record = {
    id: "return-1",
    periodType: "VAT_RETURN",
    periodKey: "2026-10",
    status: "DRAFT",
    outputVat: new Prisma.Decimal(0),
    inputVat: new Prisma.Decimal(0),
    carriedForwardInputVat: new Prisma.Decimal(0),
    carriedForwardPaymentCredit: new Prisma.Decimal(0),
    paymentCreditApplied: new Prisma.Decimal(0),
    netVatPayable: new Prisma.Decimal(10),
    taxableSales: new Prisma.Decimal(0),
    taxablePurchases: new Prisma.Decimal(0),
    carriedForwardOutputVat: new Prisma.Decimal(0),
    taxPaid: new Prisma.Decimal(0),
    assessedAmount: null,
    payments: [],
    notes: "",
  };
  const client = {
    account: {
      findUnique: async ({ where }) => where.id === "offset-account"
        ? { id: "offset-account", accountCode: "6700", accountName: "Tax adjustment expense", isActive: true }
        : null,
    },
    taxFilingRecord: {
      findUnique: async () => record,
      update: async ({ data }) => ({ ...record, ...data, payments: [] }),
    },
    $transaction: async (callback) => callback(client),
  };
  await assert.rejects(fileVatReturn({
    id: record.id,
    assessedAmount: "12.00",
    filedReference: "IRD-REF",
    paymentCreditApplied: "1.00",
    adjustmentReason: "Accountant reconciled an omitted taxable invoice.",
    client,
  }), (error) => error.code === "VAT_PAYMENT_CREDIT_EXCEEDED");
  await assert.rejects(fileVatReturn({
    id: record.id,
    assessedAmount: "12.00",
    filedReference: "IRD-REF",
    client,
  }), (error) => error.code === "VAT_ASSESSMENT_VARIANCE_REASON_REQUIRED");

  await assert.rejects(fileVatReturn({
    id: record.id,
    assessedAmount: "12.00",
    filedReference: "IRD-REF",
    adjustmentReason: "Accountant reconciled an omitted taxable invoice.",
    client,
  }), (error) => error.code === "VAT_ASSESSMENT_ACCOUNT_REQUIRED");

  const postedJournals = [];
  const filed = await fileVatReturn({
    id: record.id,
    assessedAmount: "12.00",
    filedReference: "IRD-REF",
    adjustmentReason: "Accountant reconciled an omitted taxable invoice.",
    assessmentAdjustmentAccountId: "offset-account",
    postJournal: async (journal) => {
      postedJournals.push(journal);
      return { id: "assessment-adjustment-journal" };
    },
    client,
  });
  assert.equal(filed.assessedAmount, "12.00");
  assert.equal(filed.taxPaid, "0.00");
  assert.equal(filed.outstandingAmount, "12.00");
  assert.equal(filed.estimateVariance, "2.00");
  assert.equal(filed.assessmentAdjustmentJournalId, "assessment-adjustment-journal");
  assert.equal(filed.assessmentAdjustmentAccountId, "offset-account");
  assert.equal(postedJournals.length, 1);
  assert.equal(postedJournals[0].sourceType, "VAT_ASSESSMENT_ADJUSTMENT");
  assert.equal(postedJournals[0].lines[0].accountCode, "2120");
  assert.equal(postedJournals[0].lines[0].credit.toString(), "2");
  assert.equal(postedJournals[0].lines[1].debit.toString(), "2");
});

const makePaymentClient = () => {
  const filing = {
    id: "return-payment",
    periodType: "VAT_RETURN",
    periodKey: "2026-10",
    status: "FILED",
    assessedAmount: new Prisma.Decimal(100),
    netVatPayable: new Prisma.Decimal(100),
    paymentCreditApplied: new Prisma.Decimal(0),
    carriedForwardPaymentCredit: new Prisma.Decimal(0),
    taxableSales: new Prisma.Decimal(0),
    taxablePurchases: new Prisma.Decimal(0),
    outputVat: new Prisma.Decimal(100),
    inputVat: new Prisma.Decimal(0),
    carriedForwardInputVat: new Prisma.Decimal(0),
    carriedForwardOutputVat: new Prisma.Decimal(0),
    vatCreditCarryForward: new Prisma.Decimal(0),
    taxPaid: new Prisma.Decimal(0),
    payments: [],
  };
  const payments = [];
  const client = {
    taxFilingPayment: {
      findUnique: async () => null,
      create: async ({ data }) => {
        payments.push(data);
        return data;
      },
    },
    taxFilingRecord: {
      findUnique: async () => ({ ...filing, payments: [...payments] }),
      update: async ({ data }) => ({ ...filing, ...data, payments: [...payments] }),
    },
    financialAccount: {
      findUnique: async () => ({
        id: "treasury-1",
        status: "ACTIVE",
        currency: "NPR",
        accountingAccountId: "bank-gl",
        accountingAccount: { isActive: true, accountCode: "1120" },
      }),
      updateMany: async () => ({ count: 1 }),
    },
    cashTransaction: { create: async () => ({}) },
    $transaction: async (callback) => callback(client),
  };
  return { client, filing, payments };
};

test("VAT payments allow ordinary installments and require reason only for overpayment", async () => {
  const partial = makePaymentClient();
  const partialJournals = [];
  const partialRecord = await recordVatFilingPayment({
    filingRecordId: partial.filing.id,
    amount: "40.00",
    paymentReference: "IRD-PARTIAL",
    treasuryAccountId: "treasury-1",
    idempotencyKey: "VATPAY:PARTIAL",
    client: partial.client,
    postJournal: async (journal) => {
      partialJournals.push(journal);
      return { id: "partial-journal" };
    },
  });
  assert.equal(partialRecord.taxPaid, "40.00");
  assert.equal(partialRecord.outstandingAmount, "60.00");
  assert.equal(partialRecord.status, "FILED");

  const overpaid = makePaymentClient();
  await assert.rejects(recordVatFilingPayment({
    filingRecordId: overpaid.filing.id,
    amount: "120.00",
    paymentReference: "IRD-OVERPAY",
    treasuryAccountId: "treasury-1",
    idempotencyKey: "VATPAY:OVERPAY-NO-REASON",
    client: overpaid.client,
    postJournal: async () => ({ id: "unused" }),
  }), (error) => error.code === "VAT_PAYMENT_VARIANCE_REASON_REQUIRED");

  const overpaymentJournals = [];
  const overpaymentRecord = await recordVatFilingPayment({
    filingRecordId: overpaid.filing.id,
    amount: "120.00",
    paymentReference: "IRD-OVERPAY",
    treasuryAccountId: "treasury-1",
    idempotencyKey: "VATPAY:OVERPAY",
    adjustmentReason: "IRD payment included next period's advance.",
    client: overpaid.client,
    postJournal: async (journal) => {
      overpaymentJournals.push(journal);
      return { id: "overpayment-journal" };
    },
  });
  assert.equal(overpaymentRecord.taxPaid, "120.00");
  assert.equal(overpaymentRecord.outstandingAmount, "0.00");
  assert.equal(overpaymentRecord.paymentCreditGenerated, "20.00");
  assert.equal(overpaymentRecord.status, "PAID");
  assert.equal(overpaymentJournals[0].lines.find((entry) => entry.accountCode === "1165").debit.toString(), "20");
  assert.equal(overpaymentJournals[0].lines.find((entry) => entry.accountCode === "2120").debit.toString(), "100");
});

const makeAmendmentClient = ({ amountPaid = 50, paymentCreditApplied = 0, adjustmentAccountCode = "6200" } = {}) => {
  const filing = {
    id: "return-amendment",
    periodType: "VAT_RETURN",
    periodKey: "2026-10",
    status: "FILED",
    filedDate: new Date("2026-11-20T12:00:00.000Z"),
    assessedAmount: new Prisma.Decimal(100),
    netVatPayable: new Prisma.Decimal(100),
    paymentCreditApplied: new Prisma.Decimal(paymentCreditApplied),
    carriedForwardPaymentCredit: new Prisma.Decimal(paymentCreditApplied),
    taxableSales: new Prisma.Decimal(0),
    taxablePurchases: new Prisma.Decimal(0),
    outputVat: new Prisma.Decimal(100),
    inputVat: new Prisma.Decimal(0),
    carriedForwardInputVat: new Prisma.Decimal(0),
    carriedForwardOutputVat: new Prisma.Decimal(0),
    vatCreditCarryForward: new Prisma.Decimal(0),
    taxPaid: new Prisma.Decimal(amountPaid),
    payments: amountPaid > 0 ? [{ amount: new Prisma.Decimal(amountPaid) }] : [],
    amendments: [],
  };
  const amendments = [];
  const idempotencyKeys = new Map();
  const client = {
    taxFilingAmendment: {
      findUnique: async ({ where }) => idempotencyKeys.get(where.idempotencyKey) || null,
      create: async ({ data }) => {
        amendments.push(data);
        idempotencyKeys.set(data.idempotencyKey, data);
        return data;
      },
    },
    taxFilingRecord: {
      findUnique: async () => ({ ...filing, amendments: [...amendments] }),
      update: async ({ data }) => {
        Object.assign(filing, data);
        filing.amendments = [...amendments];
        return { ...filing };
      },
    },
    account: {
      findUnique: async ({ where }) => ({
        id: where.id,
        accountCode: adjustmentAccountCode,
        accountName: "VAT adjustment offset",
        isActive: true,
      }),
    },
    $transaction: async (callback) => callback(client),
  };
  return { client, filing, amendments };
};

test("VAT amendments preserve revision history and post a balanced accountant-selected journal", async () => {
  const { client, amendments } = makeAmendmentClient();
  const journals = [];
  const input = {
    id: "return-amendment",
    amendedAssessedAmount: "80.00",
    amendedDate: "2026-11-25T12:00:00.000Z",
    amendedReference: "IRD-AMD-001",
    adjustmentAccountId: "offset-account",
    reason: "IRD reviewed the purchase documents and reduced the assessment.",
    idempotencyKey: "VATAMEND:001",
    client,
    postJournal: async (journal) => {
      journals.push(journal);
      return { id: "amendment-journal-1" };
    },
  };
  const amended = await amendVatReturn(input);
  assert.equal(amended.assessedAmount, "80.00");
  assert.equal(amended.status, "FILED");
  assert.equal(amended.amendments.length, 1);
  assert.equal(amended.amendments[0].previousAssessedAmount, "100.00");
  assert.equal(amended.amendments[0].amendedAssessedAmount, "80.00");
  assert.equal(amended.amendments[0].reason, input.reason);
  assert.equal(journals[0].sourceType, "VAT_RETURN_AMENDMENT");
  assert.equal(journals[0].lines[0].accountCode, "2120");
  assert.equal(journals[0].lines[0].debit.toString(), "20");
  assert.equal(journals[0].lines[1].credit.toString(), "20");
  assert.equal(amendments[0].revision, 1);

  const retried = await amendVatReturn(input);
  assert.equal(retried.amendments.length, 1);
  assert.equal(journals.length, 1);
});

test("VAT amendments reclassify over-settled amounts to the VAT credit asset", async () => {
  const { client } = makeAmendmentClient({ amountPaid: 100, adjustmentAccountCode: "6200" });
  const journals = [];
  const amended = await amendVatReturn({
    id: "return-amendment",
    amendedAssessedAmount: "80.00",
    amendedDate: "2026-11-25T12:00:00.000Z",
    amendedReference: "IRD-AMD-002",
    adjustmentAccountId: "offset-account",
    reason: "IRD reduced the liability after payment.",
    idempotencyKey: "VATAMEND:002",
    client,
    postJournal: async (journal) => {
      journals.push(journal);
      return { id: `amendment-journal-${journals.length}` };
    },
  });
  assert.equal(amended.status, "PAID");
  assert.equal(amended.paymentCreditGenerated, "20.00");
  assert.equal(journals.length, 2);
  assert.equal(journals[1].sourceType, "VAT_RETURN_AMENDMENT_CREDIT");
  assert.equal(journals[1].lines[0].accountCode, "1165");
  assert.equal(journals[1].lines[0].debit.toString(), "20");
  assert.equal(journals[1].lines[1].accountCode, "2120");
  assert.equal(journals[1].lines[1].credit.toString(), "20");

  const creditClient = makeAmendmentClient({ amountPaid: 0, paymentCreditApplied: 100 });
  const creditJournals = [];
  const creditAmended = await amendVatReturn({
    id: "return-amendment",
    amendedAssessedAmount: "80.00",
    amendedDate: "2026-11-25T12:00:00.000Z",
    amendedReference: "IRD-AMD-003",
    adjustmentAccountId: "vat-credit-account",
    reason: "IRD reduced the liability after applying a carried-forward credit.",
    idempotencyKey: "VATAMEND:003",
    client: creditClient.client,
    postJournal: async (journal) => {
      creditJournals.push(journal);
      return { id: `amendment-credit-journal-${creditJournals.length}` };
    },
  });
  assert.equal(creditAmended.status, "PAID");
  assert.equal(creditAmended.paymentCreditApplied, "80.00");
  assert.equal(creditAmended.carriedForwardPaymentCredit, "100.00");
  assert.equal(creditJournals.length, 2);
  assert.equal(creditJournals[1].lines[0].accountCode, "1165");
  assert.equal(creditJournals[1].lines[1].accountCode, "2120");
});

test("VAT filing draft rejects overlapping date ranges", async () => {
  const { client, createdRecords } = makeClient({ overlappingRecord: { id: "existing-return" } });

  await assert.rejects(createVatFilingDraft({
    periodKey: "2026-Q4",
    periodStart: "2026-10-01",
    periodEnd: "2026-12-31",
    client,
  }), (error) => error.code === "VAT_RETURN_PERIOD_OVERLAP");
  assert.equal(createdRecords.length, 0);
});
