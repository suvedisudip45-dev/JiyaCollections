import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { postJournalEntry } from "./accountingPostingEngine.js";
import { getPostedFinanceSnapshot } from "./accountingReportingService.js";

const fail = (message, statusCode = 400, code = "VAT_FILING_ERROR") =>
  Object.assign(new Error(message), { statusCode, code });

const toDecimal = (value, fieldName, { allowZero = true } = {}) => {
  const amount = new Prisma.Decimal(String(value ?? ""));
  if (!amount.isFinite() || amount.isNegative() || (!allowZero && amount.isZero())) {
    throw fail(`${fieldName} must be a ${allowZero ? "non-negative" : "positive"} valid amount.`, 400, "INVALID_VAT_FILING_AMOUNT");
  }
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

const parsePeriod = ({ periodKey, periodStart, periodEnd }) => {
  const key = String(periodKey ?? "").trim();
  const parseNepalDate = (value, endOfDay) => {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-").map(Number);
      const calendarDate = new Date(Date.UTC(year, month - 1, day));
      if (
        calendarDate.getUTCFullYear() !== year ||
        calendarDate.getUTCMonth() !== month - 1 ||
        calendarDate.getUTCDate() !== day
      ) {
        return new Date(Number.NaN);
      }
      return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}+05:45`);
    }
    return new Date(value);
  };
  const start = parseNepalDate(periodStart, false);
  const end = parseNepalDate(periodEnd, true);
  if (!key || key.length > 64 || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw fail("Enter a period label and a valid inclusive start/end date range.", 400, "INVALID_VAT_FILING_PERIOD");
  }
  return { periodKey: key, start, end };
};

const parseFilingCadence = (value) => {
  const cadence = String(value ?? "CUSTOM").trim().toUpperCase();
  if (!["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "CUSTOM"].includes(cadence)) {
    throw fail("Choose a supported VAT filing cadence.", 400, "INVALID_VAT_FILING_CADENCE");
  }
  return cadence;
};

const round = (value) => new Prisma.Decimal(value ?? 0).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const paymentTotal = (payments = []) => payments.reduce((total, payment) => total.plus(payment.amount), new Prisma.Decimal(0));
const amountOrZero = (value) => round(value ?? 0);

const calculateVatCreditCarryForward = (record) =>
  Prisma.Decimal.max(
    amountOrZero(record.carriedForwardInputVat)
      .plus(amountOrZero(record.carriedForwardOutputVat))
      .plus(amountOrZero(record.inputVat))
      .minus(amountOrZero(record.outputVat)),
    0,
  ).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

const calculateAvailablePaymentCredit = (records = []) => {
  let credit = new Prisma.Decimal(0);
  for (const record of records) {
    const applied = amountOrZero(record.paymentCreditApplied);
    credit = Prisma.Decimal.max(credit.minus(applied), 0);
    const assessed = amountOrZero(record.assessedAmount);
    const dueAfterCredit = Prisma.Decimal.max(assessed.minus(applied), 0);
    const excessPaid = Prisma.Decimal.max(paymentTotal(record.payments).minus(dueAfterCredit), 0);
    credit = credit.plus(excessPaid);
  }
  return credit.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

const buildSalesInvoiceReconciliation = (invoices, outputVat, period) => {
  let taxableSales = new Prisma.Decimal(0);
  let invoiceVat = new Prisma.Decimal(0);
  let creditNoteVat = new Prisma.Decimal(0);
  let debitNoteVat = new Prisma.Decimal(0);
  let adjustmentCount = 0;
  let unresolvedAdjustmentCount = 0;

  for (const invoice of invoices) {
    if (invoice.taxPoint && invoice.taxPoint >= period.start && invoice.taxPoint <= period.end) {
      taxableSales = taxableSales.plus(amountOrZero(invoice.taxableAmount));
      invoiceVat = invoiceVat.plus(amountOrZero(invoice.vatAmount));
    }
    for (const adjustment of invoice.adjustments || []) {
      if (adjustment.status === "REVERSED") continue;
      adjustmentCount += 1;
      if (adjustment.status?.includes("REQUIRED")) unresolvedAdjustmentCount += 1;
      if (adjustment.adjustmentType === "CREDIT_NOTE") creditNoteVat = creditNoteVat.plus(amountOrZero(adjustment.vatAmount));
      if (adjustment.adjustmentType === "DEBIT_NOTE") debitNoteVat = debitNoteVat.plus(amountOrZero(adjustment.vatAmount));
    }
  }
  const sourceVat = invoiceVat.minus(creditNoteVat).plus(debitNoteVat);
  return {
    salesInvoices: {
      count: invoices.filter((invoice) => invoice.taxPoint && invoice.taxPoint >= period.start && invoice.taxPoint <= period.end).length,
      taxableSales: taxableSales.toFixed(2),
      outputVat: invoiceVat.toFixed(2),
    },
    salesAdjustments: {
      count: adjustmentCount,
      creditNoteVat: creditNoteVat.toFixed(2),
      debitNoteVat: debitNoteVat.toFixed(2),
      unresolvedCount: unresolvedAdjustmentCount,
    },
    sourceOutputVatAfterAdjustments: sourceVat.toFixed(2),
    postedOutputVat: amountOrZero(outputVat).toFixed(2),
    outputVatVariance: amountOrZero(outputVat).minus(sourceVat).toFixed(2),
    purchaseDocuments: {
      status: "NOT_RECONCILED",
      note: "The current purchase/inbound records do not provide a complete verified VAT purchase register.",
    },
  };
};

const buildPurchaseDocumentReconciliation = (expenses, productionRequests, postedInputVat, period) => {
  const expenseDocuments = (expenses || []).filter((expense) =>
    expense.date && expense.date >= period.start && expense.date <= period.end
  );
  const productionDocuments = (productionRequests || []).filter((request) =>
    request.approvedVatInvoiceDate &&
    request.approvedVatInvoiceDate >= period.start &&
    request.approvedVatInvoiceDate <= period.end
  );
  const expenseInputVat = expenseDocuments.reduce(
    (total, expense) => total.plus(amountOrZero(expense.vatAmount)),
    new Prisma.Decimal(0),
  );
  const expenseTaxableAmount = expenseDocuments.reduce(
    (total, expense) => total.plus(amountOrZero(expense.purchaseTaxableAmount)),
    new Prisma.Decimal(0),
  );
  const productionInputVat = productionDocuments.reduce((total, request) =>
    total.plus((request.costLayers || []).reduce((layerTotal, layer) =>
      layerTotal.plus(amountOrZero(layer.unitVatAmount).mul(Number(layer.producedQuantity || 0))),
    new Prisma.Decimal(0))),
  new Prisma.Decimal(0));
  const productionTaxableAmount = productionDocuments.reduce((total, request) => {
    const requestVat = (request.costLayers || []).reduce(
      (layerTotal, layer) => layerTotal.plus(amountOrZero(layer.unitVatAmount).mul(Number(layer.producedQuantity || 0))),
      new Prisma.Decimal(0),
    );
    const rate = amountOrZero(request.approvedVatRate);
    return total.plus(rate.greaterThan(0) ? requestVat.mul(100).div(rate) : 0);
  }, new Prisma.Decimal(0));
  const sourceInputVat = expenseInputVat.plus(productionInputVat).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const posted = amountOrZero(postedInputVat);
  return {
    status: "PARTIAL_REGISTER",
    coverage: "VERIFIED_OPERATING_EXPENSES_AND_COMPLETED_PRODUCTION",
    supplierOperatingExpenses: {
      count: expenseDocuments.length,
      taxablePurchases: expenseTaxableAmount.toFixed(2),
      inputVat: expenseInputVat.toFixed(2),
    },
    manufacturerProductionInvoices: {
      count: productionDocuments.length,
      taxablePurchases: productionTaxableAmount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
      inputVat: productionInputVat.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
    },
    taxablePurchases: expenseTaxableAmount.plus(productionTaxableAmount)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
    sourceInputVat: sourceInputVat.toFixed(2),
    postedInputVat: posted.toFixed(2),
    inputVatVariance: posted.minus(sourceInputVat).toFixed(2),
    note: "The register covers verified operating-expense invoices and completed manufacturer production invoices only. Other purchases, purchase returns/adjustments, timing differences, and opening input VAT still require review.",
  };
};

const serializeFiling = (record) => {
  const paid = record.payments?.length ? paymentTotal(record.payments) : round(record.taxPaid);
  const assessed = record.assessedAmount === null ? null : round(record.assessedAmount);
  const paymentCreditApplied = amountOrZero(record.paymentCreditApplied);
  const outstanding = assessed
    ? Prisma.Decimal.max(assessed.minus(paymentCreditApplied).minus(paid), 0)
    : null;
  const paymentCreditGenerated = assessed
    ? Prisma.Decimal.max(paid.minus(Prisma.Decimal.max(assessed.minus(paymentCreditApplied), 0)), 0)
    : new Prisma.Decimal(0);
  return {
    ...record,
    taxableSales: round(record.taxableSales).toFixed(2),
    outputVat: round(record.outputVat).toFixed(2),
    taxablePurchases: round(record.taxablePurchases).toFixed(2),
    inputVat: round(record.inputVat).toFixed(2),
    carriedForwardInputVat: round(record.carriedForwardInputVat).toFixed(2),
    carriedForwardOutputVat: round(record.carriedForwardOutputVat).toFixed(2),
    vatCreditCarryForward: amountOrZero(record.vatCreditCarryForward).toFixed(2),
    carriedForwardPaymentCredit: amountOrZero(record.carriedForwardPaymentCredit).toFixed(2),
    paymentCreditApplied: paymentCreditApplied.toFixed(2),
    netVatPayable: round(record.netVatPayable).toFixed(2),
    assessedAmount: assessed?.toFixed(2) ?? null,
    taxPaid: paid.toFixed(2),
    outstandingAmount: outstanding?.toFixed(2) ?? null,
    paymentCreditGenerated: paymentCreditGenerated.toFixed(2),
    estimateVariance: assessed
      ? assessed.minus(Prisma.Decimal.max(round(record.netVatPayable), 0)).toFixed(2)
      : null,
    payments: (record.payments || []).map((payment) => ({
      ...payment,
      amount: round(payment.amount).toFixed(2),
    })),
    amendments: (record.amendments || []).map((amendment) => ({
      ...amendment,
      previousAssessedAmount: round(amendment.previousAssessedAmount).toFixed(2),
      amendedAssessedAmount: round(amendment.amendedAssessedAmount).toFixed(2),
      adjustmentAmount: round(amendment.adjustmentAmount).toFixed(2),
    })),
  };
};

export const listVatFilingRecords = async ({ client = prisma } = {}) => {
  const records = await client.taxFilingRecord.findMany({
    where: { periodType: "VAT_RETURN" },
    include: {
      payments: { orderBy: { paymentDate: "asc" } },
      amendments: { orderBy: { revision: "asc" } },
    },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return records.map(serializeFiling);
};

export const createVatFilingDraft = async ({
  filingCadence = "CUSTOM",
  periodKey,
  periodStart,
  periodEnd,
  createdBy = null,
  client = prisma,
  afterCreate = null,
} = {}) => {
  const period = parsePeriod({ periodKey, periodStart, periodEnd });
  const cadence = parseFilingCadence(filingCadence);
  return client.$transaction(async (tx) => {
    const existing = await tx.taxFilingRecord.findFirst({
      where: { periodType: "VAT_RETURN", periodKey: period.periodKey },
      include: { payments: true },
    });
    if (existing) {
      throw fail("A VAT return already exists for this period key.", 409, "VAT_RETURN_PERIOD_EXISTS");
    }
    const overlapping = await tx.taxFilingRecord.findFirst({
      where: {
        periodType: "VAT_RETURN",
        periodStart: { lte: period.end },
        periodEnd: { gte: period.start },
      },
    });
    if (overlapping) {
      throw fail("This date range overlaps an existing VAT return. Use non-overlapping filing periods.", 409, "VAT_RETURN_PERIOD_OVERLAP");
    }
    const unfiledEarlierReturn = await tx.taxFilingRecord.findFirst({
      where: {
        periodType: "VAT_RETURN",
        periodEnd: { lt: period.start },
        OR: [
          { status: "DRAFT" },
          { filedDate: null },
          { filedDate: { gt: period.start } },
        ],
      },
    });
    if (unfiledEarlierReturn) {
      throw fail("File earlier VAT returns before preparing a later period, and ensure the filing date precedes the next period.", 409, "EARLIER_VAT_RETURN_UNFILED");
    }

    const snapshot = await getPostedFinanceSnapshot({
      startDate: period.start,
      endDate: period.end,
      client: tx,
    });
    const priorFiledReturns = await tx.taxFilingRecord.findMany({
      where: {
        periodType: "VAT_RETURN",
        status: { in: ["FILED", "PAID"] },
        periodEnd: { lt: period.start },
      },
      include: { payments: true },
      orderBy: [{ periodEnd: "asc" }, { createdAt: "asc" }],
    });
    const carriedForwardPaymentCredit = calculateAvailablePaymentCredit(priorFiledReturns);
    const carriedForwardVatCredit = priorFiledReturns.length
      ? amountOrZero(priorFiledReturns[priorFiledReturns.length - 1].vatCreditCarryForward)
      : amountOrZero(snapshot.vat.carriedForwardInputVat);
    const openingVatGlBalance = amountOrZero(snapshot.vat.carriedForwardInputVat);
    const outputVat = round(snapshot.vat.outputVat);
    const inputVat = round(snapshot.vat.inputVat);
    const carriedForwardInputVat = carriedForwardVatCredit;
    const carriedForwardOutputVat = new Prisma.Decimal(0);
    const netVatPayable = outputVat.minus(inputVat).minus(carriedForwardVatCredit)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const salesInvoices = await tx.salesInvoice.findMany({
      where: {
        documentType: "VAT_TAX_INVOICE",
        OR: [
          { taxPoint: { gte: period.start, lte: period.end } },
          { adjustments: { some: { occurredAt: { gte: period.start, lte: period.end } } } },
        ],
      },
      select: {
        id: true,
        taxPoint: true,
        taxableAmount: true,
        vatAmount: true,
        adjustments: {
          where: { occurredAt: { gte: period.start, lte: period.end } },
          select: { adjustmentType: true, status: true, vatAmount: true },
        },
      },
    });
    const sourceReconciliation = buildSalesInvoiceReconciliation(salesInvoices, outputVat, period);
    const [verifiedOperatingExpenseInvoices, completedProductionInvoices] = await Promise.all([
      tx.operatingExpense.findMany({
        where: {
          purchaseVatStatus: "VERIFIED",
          date: { gte: period.start, lte: period.end },
        },
        select: {
          date: true,
          vatAmount: true,
          purchaseTaxableAmount: true,
        },
      }),
      tx.manufacturerProductionRequest.findMany({
        where: {
          status: "COMPLETED",
          approvedVatInvoiceVerified: true,
          approvedVatTreatment: { not: "EXEMPT" },
          approvedVatInvoiceEvidenceUrl: { not: null },
          approvedVatInvoiceDate: { gte: period.start, lte: period.end },
          costLayers: { some: { inputVatRecoverable: true } },
        },
        select: {
          approvedVatInvoiceDate: true,
          approvedVatInvoiceEvidenceUrl: true,
          approvedVatRate: true,
          costLayers: {
            where: { inputVatRecoverable: true },
            select: { unitVatAmount: true, producedQuantity: true },
          },
        },
      }),
    ]);
    sourceReconciliation.purchaseDocuments = buildPurchaseDocumentReconciliation(
      verifiedOperatingExpenseInvoices,
      completedProductionInvoices,
      inputVat,
      period,
    );
    sourceReconciliation.openingVatCredit = {
      status: priorFiledReturns.length && openingVatGlBalance.minus(carriedForwardVatCredit).abs().lessThanOrEqualTo("0.01")
        ? "RECONCILED"
        : carriedForwardVatCredit.isZero() && openingVatGlBalance.isZero()
          ? "RECONCILED"
          : "GL_OPENING_BALANCE_REQUIRES_ACCOUNTANT_REVIEW",
      glBalance: openingVatGlBalance.toFixed(2),
      filingCarryForward: carriedForwardVatCredit.toFixed(2),
      difference: openingVatGlBalance.minus(carriedForwardVatCredit).toFixed(2),
    };
    const record = await tx.taxFilingRecord.create({
      data: {
        id: randomUUID(),
        periodType: "VAT_RETURN",
        filingCadence: cadence,
        periodKey: period.periodKey,
        periodStart: period.start,
        periodEnd: period.end,
        taxableSales: round(snapshot.incomeStatement.netRevenue),
        outputVat,
        taxablePurchases: amountOrZero(sourceReconciliation.purchaseDocuments.taxablePurchases),
        inputVat,
        carriedForwardInputVat,
        carriedForwardOutputVat,
        vatCreditCarryForward: new Prisma.Decimal(0),
        sourceReconciliation,
        carriedForwardPaymentCredit,
        paymentCreditApplied: new Prisma.Decimal(0),
        netVatPayable,
        taxPaid: new Prisma.Decimal(0),
        status: "DRAFT",
        notes: [
          createdBy ? `Draft created by ${String(createdBy).slice(0, 191)} from posted journal data.` : "Draft created from posted journal data.",
          "Purchase register coverage is partial; verify supplier documents, timing, adjustments, and opening balances before filing.",
        ].join(" "),
      },
      include: { payments: true },
    });
    if (afterCreate) await afterCreate(record, tx);
    return serializeFiling(record);
  }, { isolationLevel: "Serializable" });
};

export const fileVatReturn = async ({
  id,
  assessedAmount,
  paymentCreditApplied = 0,
  assessmentAdjustmentAccountId,
  filedDate = new Date(),
  filedReference,
  filingEvidenceUrl,
  adjustmentReason,
  filedBy = null,
  client = prisma,
  postJournal = postJournalEntry,
  afterFile = null,
} = {}) => {
  const assessment = toDecimal(assessedAmount, "Assessed VAT", { allowZero: true });
  const creditApplied = toDecimal(paymentCreditApplied, "Carried-forward tax credit", { allowZero: true });
  const filedAt = new Date(filedDate);
  if (Number.isNaN(filedAt.getTime())) throw fail("VAT filing date is invalid.", 400, "INVALID_VAT_FILING_DATE");
  const reference = String(filedReference ?? "").trim();
  if (!reference || reference.length > 191) {
    throw fail("An IRD filing reference is required to mark a VAT return filed.", 400, "VAT_FILING_REFERENCE_REQUIRED");
  }
  const evidence = String(filingEvidenceUrl ?? "").trim();
  const reason = String(adjustmentReason ?? "").trim();
  const adjustmentAccountId = String(assessmentAdjustmentAccountId ?? "").trim();
  if (evidence.length > 5000 || reason.length > 2000) {
    throw fail("Filing evidence or adjustment reason is too long.", 400, "INVALID_VAT_FILING_METADATA");
  }

  return client.$transaction(async (tx) => {
    const record = await tx.taxFilingRecord.findUnique({
      where: { id: String(id ?? "").trim() },
      include: { payments: true, amendments: true },
    });
    if (!record || record.periodType !== "VAT_RETURN") throw fail("VAT return record not found.", 404, "VAT_RETURN_NOT_FOUND");
    if (record.status !== "DRAFT") throw fail("Only a draft VAT return can be marked filed.", 409, "VAT_RETURN_ALREADY_FILED");

    const expected = Prisma.Decimal.max(round(record.netVatPayable), 0);
    if (!assessment.equals(expected) && reason.length < 3) {
      throw fail("Explain the difference between the ledger estimate and the IRD-assessed amount.", 400, "VAT_ASSESSMENT_VARIANCE_REASON_REQUIRED");
    }
    if (creditApplied.greaterThan(amountOrZero(record.carriedForwardPaymentCredit))) {
      throw fail("Applied tax credit exceeds the available carried-forward VAT payment credit.", 400, "VAT_PAYMENT_CREDIT_EXCEEDED");
    }
    if (creditApplied.greaterThan(assessment)) {
      throw fail("Applied tax credit cannot exceed the filed VAT liability.", 400, "VAT_PAYMENT_CREDIT_EXCEEDED");
    }
    if (!assessment.equals(expected) && !adjustmentAccountId) {
      throw fail("Select the GL account approved by the accountant for the assessment difference.", 400, "VAT_ASSESSMENT_ACCOUNT_REQUIRED");
    }

    const offset = Prisma.Decimal.min(
      round(record.outputVat),
      round(record.inputVat).plus(round(record.carriedForwardInputVat)),
    );
    if (offset.greaterThan(0)) {
      await postJournal({
        transactionDate: filedAt,
        sourceType: "VAT_RETURN_NETTING",
        sourceId: record.id,
        idempotencyKey: `VAT_RETURN_NETTING:${record.id}`,
        referenceNumber: reference,
        description: `Net input VAT against output VAT for return ${record.periodKey}.`,
        createdBy: filedBy || "admin",
        lines: [
          {
            accountCode: "2120",
            debit: offset,
            credit: 0,
            description: `Output VAT offset for ${record.periodKey}`,
          },
          {
            accountCode: "1150",
            debit: 0,
            credit: offset,
            description: `Input VAT applied to return ${record.periodKey}`,
          },
        ],
        client: tx,
      });
    }
    let assessmentAdjustmentJournalId = null;
    if (!assessment.equals(expected)) {
      const adjustmentAccount = await tx.account.findUnique({
        where: { id: adjustmentAccountId },
        select: { id: true, accountCode: true, accountName: true, isActive: true },
      });
      if (
        !adjustmentAccount ||
        !adjustmentAccount.isActive ||
        ["1110", "1120", "2120"].includes(adjustmentAccount.accountCode)
      ) {
        throw fail("Select an active non-cash GL account other than Output VAT Payable for the accountant-approved offset.", 400, "INVALID_VAT_ASSESSMENT_ACCOUNT");
      }
      const variance = assessment.minus(expected).abs();
      const assessmentAdjustment = await postJournal({
        transactionDate: filedAt,
        sourceType: "VAT_ASSESSMENT_ADJUSTMENT",
        sourceId: record.id,
        idempotencyKey: `VAT_ASSESSMENT_ADJUSTMENT:${record.id}`,
        referenceNumber: reference,
        description: `Accountant-approved assessment difference for VAT return ${record.periodKey}: ${reason}`,
        createdBy: filedBy || "admin",
        lines: assessment.greaterThan(expected)
          ? [
              {
                accountCode: "2120",
                debit: 0,
                credit: variance,
                description: `Increase filed VAT liability for ${record.periodKey}`,
              },
              {
                accountId: adjustmentAccount.id,
                debit: variance,
                credit: 0,
                description: `Accountant-approved VAT assessment offset: ${reason}`,
              },
            ]
          : [
              {
                accountCode: "2120",
                debit: variance,
                credit: 0,
                description: `Reduce filed VAT liability for ${record.periodKey}`,
              },
              {
                accountId: adjustmentAccount.id,
                debit: 0,
                credit: variance,
                description: `Accountant-approved VAT assessment offset: ${reason}`,
              },
            ],
        client: tx,
      });
      assessmentAdjustmentJournalId = assessmentAdjustment.id;
    }
    if (creditApplied.greaterThan(0)) {
      await postJournal({
        transactionDate: filedAt,
        sourceType: "VAT_PAYMENT_CREDIT_APPLIED",
        sourceId: record.id,
        idempotencyKey: `VAT_PAYMENT_CREDIT_APPLIED:${record.id}`,
        referenceNumber: reference,
        description: `Apply prior VAT overpayment credit to return ${record.periodKey}.`,
        createdBy: filedBy || "admin",
        lines: [
          {
            accountCode: "2120",
            debit: creditApplied,
            credit: 0,
            description: `Apply VAT payment credit to ${record.periodKey}`,
          },
          {
            accountCode: "1165",
            debit: 0,
            credit: creditApplied,
            description: `Use carried-forward VAT payment credit for ${record.periodKey}`,
          },
        ],
        client: tx,
      });
    }

    const updated = await tx.taxFilingRecord.update({
      where: { id: record.id },
      data: {
        status: creditApplied.greaterThanOrEqualTo(assessment) ? "PAID" : "FILED",
        filedDate: filedAt,
        filedReference: reference,
        filingEvidenceUrl: evidence || null,
        assessedAmount: assessment,
        paymentCreditApplied: creditApplied,
        vatCreditCarryForward: calculateVatCreditCarryForward(record),
        assessmentAdjustmentJournalId,
        assessmentAdjustmentAccountId: assessmentAdjustmentJournalId ? adjustmentAccountId : null,
        notes: [
          record.notes,
          reason ? `Assessment variance: ${reason}` : null,
          filedBy ? `Filed by ${String(filedBy).slice(0, 191)}.` : null,
        ].filter(Boolean).join("\n"),
      },
      include: { payments: true, amendments: true },
    });
    if (afterFile) await afterFile(updated, tx);
    return serializeFiling(updated);
  }, { isolationLevel: "Serializable" });
};

export const recordVatFilingPayment = async ({
  filingRecordId,
  amount,
  paymentDate = new Date(),
  paymentReference,
  treasuryAccountId,
  idempotencyKey,
  evidenceUrl,
  adjustmentReason,
  recordedBy = null,
  client = prisma,
  postJournal = postJournalEntry,
  afterPayment = null,
} = {}) => {
  const paymentAmount = toDecimal(amount, "Payment amount", { allowZero: false });
  const paidAt = new Date(paymentDate);
  if (Number.isNaN(paidAt.getTime())) throw fail("VAT payment date is invalid.", 400, "INVALID_VAT_PAYMENT_DATE");
  const reference = String(paymentReference ?? "").trim();
  const key = String(idempotencyKey ?? "").trim();
  const evidence = String(evidenceUrl ?? "").trim();
  const reason = String(adjustmentReason ?? "").trim();
  const financialAccountId = String(treasuryAccountId ?? "").trim();
  if (!reference || reference.length > 191 || !key || key.length > 191 || !financialAccountId || evidence.length > 5000 || reason.length > 2000) {
    throw fail("Payment reference, idempotency key, and mapped Treasury account are required.", 400, "VAT_PAYMENT_DETAILS_REQUIRED");
  }

  return client.$transaction(async (tx) => {
    const existing = await tx.taxFilingPayment.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (
        existing.filingRecordId !== filingRecordId ||
        !round(existing.amount).equals(paymentAmount) ||
        existing.paymentReference !== reference ||
        existing.treasuryAccountId !== financialAccountId ||
        (existing.adjustmentReason || "") !== reason
      ) {
        throw fail("This payment idempotency key is already associated with different payment details.", 409, "VAT_PAYMENT_IDEMPOTENCY_CONFLICT");
      }
      const current = await tx.taxFilingRecord.findUnique({
        where: { id: existing.filingRecordId },
        include: {
          payments: { orderBy: { paymentDate: "asc" } },
          amendments: { orderBy: { revision: "asc" } },
        },
      });
      return serializeFiling(current);
    }

    const filing = await tx.taxFilingRecord.findUnique({
      where: { id: filingRecordId },
      include: { payments: true, amendments: { orderBy: { revision: "asc" } } },
    });
    if (!filing || filing.periodType !== "VAT_RETURN") throw fail("VAT return record not found.", 404, "VAT_RETURN_NOT_FOUND");
    if (!["FILED", "PAID"].includes(filing.status) || filing.assessedAmount === null) {
      throw fail("A VAT return must be filed with an assessed amount before recording payment.", 409, "VAT_RETURN_NOT_FILED");
    }
    const dueBeforePayment = Prisma.Decimal.max(
      round(filing.assessedAmount)
        .minus(amountOrZero(filing.paymentCreditApplied))
        .minus(paymentTotal(filing.payments)),
      0,
    );
    if (paymentAmount.greaterThan(dueBeforePayment) && reason.length < 3) {
      throw fail("Explain why the recorded VAT payment differs from the remaining assessed balance.", 400, "VAT_PAYMENT_VARIANCE_REASON_REQUIRED");
    }
    const liabilityPayment = Prisma.Decimal.min(paymentAmount, dueBeforePayment);
    const overpayment = Prisma.Decimal.max(paymentAmount.minus(dueBeforePayment), 0);

    const treasury = await tx.financialAccount.findUnique({
      where: { id: financialAccountId },
      include: { accountingAccount: true },
    });
    if (
      !treasury ||
      treasury.status !== "ACTIVE" ||
      treasury.currency !== "NPR" ||
      !treasury.accountingAccountId ||
      !treasury.accountingAccount?.isActive ||
      !["1110", "1120"].includes(treasury.accountingAccount.accountCode)
    ) {
      throw fail("Select an active NPR cash or bank Treasury account mapped to an active GL account.", 400, "INVALID_VAT_PAYMENT_TREASURY_ACCOUNT");
    }
    const debit = await tx.financialAccount.updateMany({
      where: {
        id: treasury.id,
        status: "ACTIVE",
        currency: "NPR",
        currentBalance: { gte: paymentAmount },
      },
      data: { currentBalance: { decrement: paymentAmount } },
    });
    if (debit.count !== 1) throw fail("Treasury balance is insufficient or changed. Refresh and retry.", 409, "VAT_PAYMENT_TREASURY_CONFLICT");

    const paymentId = randomUUID();
    const journalLines = [];
    if (liabilityPayment.greaterThan(0)) {
      journalLines.push({
        accountCode: "2120",
        debit: liabilityPayment,
        credit: 0,
        description: `Settle VAT return ${filing.periodKey}`,
      });
    }
    if (overpayment.greaterThan(0)) {
      journalLines.push({
        accountCode: "1165",
        debit: overpayment,
        credit: 0,
        description: `Carry forward VAT overpayment for ${filing.periodKey}`,
      });
    }
    const journal = await postJournal({
      transactionDate: paidAt,
      sourceType: "VAT_RETURN_PAYMENT",
      sourceId: paymentId,
      idempotencyKey: `VAT_RETURN_PAYMENT:${key}`,
      referenceNumber: reference,
      description: `VAT payment for return ${filing.periodKey}.`,
      createdBy: recordedBy || "admin",
      lines: [
        ...journalLines,
        {
          accountId: treasury.accountingAccountId,
          debit: 0,
          credit: paymentAmount,
          description: `VAT payment to IRD (${reference})`,
        },
      ],
      client: tx,
    });
    await tx.cashTransaction.create({
      data: {
        idempotencyKey: `VAT_RETURN_PAYMENT:${key}`,
        date: paidAt,
        amount: paymentAmount,
        type: "OUTFLOW",
        fromAccountId: treasury.id,
        category: "TAX_PAYMENT",
        partyName: "Inland Revenue Department",
        invoiceNumber: filing.filedReference || filing.periodKey,
        referenceId: filing.id,
        description: `VAT payment for return ${filing.periodKey}`,
      },
    });
    await tx.taxFilingPayment.create({
      data: {
        id: paymentId,
        filingRecordId: filing.id,
        idempotencyKey: key,
        amount: paymentAmount,
        paymentDate: paidAt,
        paymentReference: reference,
        treasuryAccountId: treasury.id,
        journalEntryId: journal.id,
        evidenceUrl: evidence || null,
        adjustmentReason: reason || null,
        recordedBy: recordedBy ? String(recordedBy).slice(0, 191) : null,
      },
    });
    const payments = [...filing.payments, { amount: paymentAmount }];
    const totalPaid = paymentTotal(payments);
    const updated = await tx.taxFilingRecord.update({
      where: { id: filing.id },
      data: {
        taxPaid: totalPaid,
        status: totalPaid.plus(amountOrZero(filing.paymentCreditApplied)).greaterThanOrEqualTo(filing.assessedAmount) ? "PAID" : "FILED",
      },
      include: {
        payments: { orderBy: { paymentDate: "asc" } },
        amendments: { orderBy: { revision: "asc" } },
      },
    });
    if (afterPayment) await afterPayment(updated, tx);
    return serializeFiling(updated);
  }, { isolationLevel: "Serializable" });
};

export const amendVatReturn = async ({
  id,
  amendedAssessedAmount,
  amendedDate,
  amendedReference,
  adjustmentAccountId,
  reason,
  evidenceUrl,
  idempotencyKey,
  recordedBy = null,
  client = prisma,
  postJournal = postJournalEntry,
  afterAmendment = null,
} = {}) => {
  const amendedAmount = toDecimal(amendedAssessedAmount, "Amended assessed VAT", { allowZero: true });
  const amendedAt = new Date(amendedDate);
  const reference = String(amendedReference ?? "").trim();
  const accountId = String(adjustmentAccountId ?? "").trim();
  const note = String(reason ?? "").trim();
  const evidence = String(evidenceUrl ?? "").trim();
  const key = String(idempotencyKey ?? "").trim();
  if (
    Number.isNaN(amendedAt.getTime()) ||
    !reference || reference.length > 191 ||
    !accountId ||
    note.length < 3 || note.length > 2000 ||
    evidence.length > 5000 ||
    !key || key.length > 191
  ) {
    throw fail("Amendment date, reference, reason, idempotency key, and adjustment account are required.", 400, "VAT_AMENDMENT_DETAILS_REQUIRED");
  }

  return client.$transaction(async (tx) => {
    const existing = await tx.taxFilingAmendment.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (
        existing.filingRecordId !== id ||
        !round(existing.amendedAssessedAmount).equals(amendedAmount) ||
        existing.amendedDate.getTime() !== amendedAt.getTime() ||
        existing.amendedReference !== reference ||
        existing.adjustmentAccountId !== accountId ||
        existing.reason !== note ||
        (existing.evidenceUrl || "") !== evidence
      ) {
        throw fail("This amendment idempotency key is already associated with different amendment details.", 409, "VAT_AMENDMENT_IDEMPOTENCY_CONFLICT");
      }
      const current = await tx.taxFilingRecord.findUnique({
        where: { id: existing.filingRecordId },
        include: {
          payments: { orderBy: { paymentDate: "asc" } },
          amendments: { orderBy: { revision: "asc" } },
        },
      });
      return serializeFiling(current);
    }

    const filing = await tx.taxFilingRecord.findUnique({
      where: { id: String(id ?? "").trim() },
      include: {
        payments: true,
        amendments: { orderBy: { revision: "asc" } },
      },
    });
    if (!filing || filing.periodType !== "VAT_RETURN") throw fail("VAT return record not found.", 404, "VAT_RETURN_NOT_FOUND");
    if (!["FILED", "PAID"].includes(filing.status) || filing.assessedAmount === null) {
      throw fail("Only a filed VAT return can be amended.", 409, "VAT_RETURN_NOT_FILED");
    }
    const previousAmendment = filing.amendments?.at(-1);
    const lastFilingActionDate = previousAmendment?.amendedDate || filing.filedDate;
    if (lastFilingActionDate && amendedAt < lastFilingActionDate) {
      throw fail("An amendment date cannot precede the previous filing or amendment.", 400, "INVALID_VAT_AMENDMENT_DATE");
    }
    const previousAmount = round(filing.assessedAmount);
    if (previousAmount.equals(amendedAmount)) {
      throw fail("The amended assessed amount must differ from the current filed amount.", 400, "VAT_AMENDMENT_NO_CHANGE");
    }

    const adjustmentAccount = await tx.account.findUnique({
      where: { id: accountId },
      select: { id: true, accountCode: true, accountName: true, isActive: true },
    });
    if (
      !adjustmentAccount ||
      !adjustmentAccount.isActive ||
      ["1110", "1120", "2120"].includes(adjustmentAccount.accountCode)
    ) {
      throw fail("Select an active non-cash GL account other than Output VAT Payable for the amendment offset.", 400, "INVALID_VAT_ASSESSMENT_ACCOUNT");
    }

    const creditApplied = amountOrZero(filing.paymentCreditApplied);
    const amountPaid = paymentTotal(filing.payments);
    const delta = amendedAmount.minus(previousAmount);
    const amendmentId = randomUUID();
    const journal = await postJournal({
      transactionDate: amendedAt,
      sourceType: "VAT_RETURN_AMENDMENT",
      sourceId: amendmentId,
      idempotencyKey: `VAT_RETURN_AMENDMENT:${key}`,
      referenceNumber: reference,
      description: `Amend VAT return ${filing.periodKey}: ${note}`,
      createdBy: recordedBy || "admin",
      lines: delta.greaterThan(0)
        ? [
            {
              accountCode: "2120",
              debit: 0,
              credit: delta,
              description: `Increase amended VAT liability for ${filing.periodKey}`,
            },
            {
              accountId: adjustmentAccount.id,
              debit: delta,
              credit: 0,
              description: `Accountant-approved VAT amendment offset: ${note}`,
            },
          ]
        : [
            {
              accountCode: "2120",
              debit: delta.abs(),
              credit: 0,
              description: `Reduce amended VAT liability for ${filing.periodKey}`,
            },
            {
              accountId: adjustmentAccount.id,
              debit: 0,
              credit: delta.abs(),
              description: `Accountant-approved VAT amendment offset: ${note}`,
            },
          ],
      client: tx,
    });
    const paymentCreditAmount = delta.isNegative()
      ? Prisma.Decimal.min(
          delta.abs(),
          Prisma.Decimal.max(amountPaid.plus(creditApplied).minus(amendedAmount), 0),
        )
      : new Prisma.Decimal(0);
    let paymentCreditJournal = null;
    if (paymentCreditAmount.greaterThan(0)) {
      paymentCreditJournal = await postJournal({
        transactionDate: amendedAt,
        sourceType: "VAT_RETURN_AMENDMENT_CREDIT",
        sourceId: amendmentId,
        idempotencyKey: `VAT_RETURN_AMENDMENT_CREDIT:${key}`,
        referenceNumber: reference,
        description: `Reclassify the over-settled VAT amount for amended return ${filing.periodKey}.`,
        createdBy: recordedBy || "admin",
        lines: [
          {
            accountCode: "1165",
            debit: paymentCreditAmount,
            credit: 0,
            description: `Recognize VAT payment credit from amendment ${reference}`,
          },
          {
            accountCode: "2120",
            debit: 0,
            credit: paymentCreditAmount,
            description: `Reclassify amended VAT liability to a payment credit`,
          },
        ],
        client: tx,
      });
    }
    const amendment = await tx.taxFilingAmendment.create({
      data: {
        id: amendmentId,
        filingRecordId: filing.id,
        revision: (filing.amendments?.length || 0) + 1,
        idempotencyKey: key,
        previousAssessedAmount: previousAmount,
        amendedAssessedAmount: amendedAmount,
        adjustmentAmount: delta.abs(),
        amendedDate: amendedAt,
        amendedReference: reference,
        reason: note,
        evidenceUrl: evidence || null,
        adjustmentAccountId: adjustmentAccount.id,
        journalEntryId: journal.id,
        paymentCreditJournalEntryId: paymentCreditJournal?.id || null,
        recordedBy: recordedBy ? String(recordedBy).slice(0, 191) : null,
      },
    });
    const totalPaid = paymentTotal(filing.payments);
    const updatedCreditApplied = Prisma.Decimal.min(creditApplied, amendedAmount);
    const updated = await tx.taxFilingRecord.update({
      where: { id: filing.id },
      data: {
        assessedAmount: amendedAmount,
        paymentCreditApplied: updatedCreditApplied,
        status: totalPaid.plus(updatedCreditApplied).greaterThanOrEqualTo(amendedAmount) ? "PAID" : "FILED",
      },
      include: {
        payments: { orderBy: { paymentDate: "asc" } },
        amendments: { orderBy: { revision: "asc" } },
      },
    });
    if (afterAmendment) await afterAmendment(updated, amendment, tx);
    return serializeFiling(updated);
  }, { isolationLevel: "Serializable" });
};
