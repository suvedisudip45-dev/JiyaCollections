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

const round = (value) => new Prisma.Decimal(value ?? 0).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const paymentTotal = (payments = []) => payments.reduce((total, payment) => total.plus(payment.amount), new Prisma.Decimal(0));
const serializeFiling = (record) => {
  const paid = record.payments?.length ? paymentTotal(record.payments) : round(record.taxPaid);
  const assessed = record.assessedAmount === null ? null : round(record.assessedAmount);
  return {
    ...record,
    taxableSales: round(record.taxableSales).toFixed(2),
    outputVat: round(record.outputVat).toFixed(2),
    taxablePurchases: round(record.taxablePurchases).toFixed(2),
    inputVat: round(record.inputVat).toFixed(2),
    carriedForwardInputVat: round(record.carriedForwardInputVat).toFixed(2),
    carriedForwardOutputVat: round(record.carriedForwardOutputVat).toFixed(2),
    netVatPayable: round(record.netVatPayable).toFixed(2),
    assessedAmount: assessed?.toFixed(2) ?? null,
    taxPaid: paid.toFixed(2),
    outstandingAmount: assessed ? Prisma.Decimal.max(assessed.minus(paid), 0).toFixed(2) : null,
    payments: (record.payments || []).map((payment) => ({
      ...payment,
      amount: round(payment.amount).toFixed(2),
    })),
  };
};

export const listVatFilingRecords = async ({ client = prisma } = {}) => {
  const records = await client.taxFilingRecord.findMany({
    where: { periodType: "VAT_RETURN" },
    include: { payments: { orderBy: { paymentDate: "asc" } } },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return records.map(serializeFiling);
};

export const createVatFilingDraft = async ({
  periodKey,
  periodStart,
  periodEnd,
  createdBy = null,
  client = prisma,
  afterCreate = null,
} = {}) => {
  const period = parsePeriod({ periodKey, periodStart, periodEnd });
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
    const outputVat = round(snapshot.vat.outputVat);
    const inputVat = round(snapshot.vat.inputVat);
    const carriedForwardInputVat = round(snapshot.vat.carriedForwardInputVat);
    const carriedForwardOutputVat = round(snapshot.vat.carriedForwardOutputVat);
    const netVatPayable = outputVat.minus(inputVat).minus(carriedForwardInputVat).minus(carriedForwardOutputVat)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const record = await tx.taxFilingRecord.create({
      data: {
        id: randomUUID(),
        periodType: "VAT_RETURN",
        periodKey: period.periodKey,
        periodStart: period.start,
        periodEnd: period.end,
        taxableSales: round(snapshot.incomeStatement.netRevenue),
        outputVat,
        taxablePurchases: new Prisma.Decimal(0),
        inputVat,
        carriedForwardInputVat,
        carriedForwardOutputVat,
        netVatPayable,
        taxPaid: new Prisma.Decimal(0),
        status: "DRAFT",
        notes: [
          createdBy ? `Draft created by ${String(createdBy).slice(0, 191)} from posted journal data.` : "Draft created from posted journal data.",
          "Taxable purchase base and invoice/credit-note registers require independent verification before filing.",
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
  filedDate = new Date(),
  filedReference,
  filingEvidenceUrl,
  adjustmentReason,
  filedBy = null,
  client = prisma,
  afterFile = null,
} = {}) => {
  const assessment = toDecimal(assessedAmount, "Assessed VAT", { allowZero: true });
  const filedAt = new Date(filedDate);
  if (Number.isNaN(filedAt.getTime())) throw fail("VAT filing date is invalid.", 400, "INVALID_VAT_FILING_DATE");
  const reference = String(filedReference ?? "").trim();
  if (!reference || reference.length > 191) {
    throw fail("An IRD filing reference is required to mark a VAT return filed.", 400, "VAT_FILING_REFERENCE_REQUIRED");
  }
  const evidence = String(filingEvidenceUrl ?? "").trim();
  const reason = String(adjustmentReason ?? "").trim();
  if (evidence.length > 5000 || reason.length > 2000) {
    throw fail("Filing evidence or adjustment reason is too long.", 400, "INVALID_VAT_FILING_METADATA");
  }

  return client.$transaction(async (tx) => {
    const record = await tx.taxFilingRecord.findUnique({
      where: { id: String(id ?? "").trim() },
      include: { payments: true },
    });
    if (!record || record.periodType !== "VAT_RETURN") throw fail("VAT return record not found.", 404, "VAT_RETURN_NOT_FOUND");
    if (record.status !== "DRAFT") throw fail("Only a draft VAT return can be marked filed.", 409, "VAT_RETURN_ALREADY_FILED");

    const expected = Prisma.Decimal.max(round(record.netVatPayable), 0);
    if (!assessment.equals(expected) && reason.length < 3) {
      throw fail("Explain the difference between the ledger estimate and the IRD-assessed amount.", 400, "VAT_ASSESSMENT_VARIANCE_REASON_REQUIRED");
    }

    const offset = Prisma.Decimal.min(
      round(record.outputVat),
      round(record.inputVat).plus(round(record.carriedForwardInputVat)),
    );
    if (offset.greaterThan(0)) {
      await postJournalEntry({
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

    const updated = await tx.taxFilingRecord.update({
      where: { id: record.id },
      data: {
        status: "FILED",
        filedDate: filedAt,
        filedReference: reference,
        filingEvidenceUrl: evidence || null,
        assessedAmount: assessment,
        notes: [
          record.notes,
          reason ? `Assessment variance: ${reason}` : null,
          filedBy ? `Filed by ${String(filedBy).slice(0, 191)}.` : null,
        ].filter(Boolean).join("\n"),
      },
      include: { payments: true },
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
  recordedBy = null,
  client = prisma,
  afterPayment = null,
} = {}) => {
  const paymentAmount = toDecimal(amount, "Payment amount", { allowZero: false });
  const paidAt = new Date(paymentDate);
  if (Number.isNaN(paidAt.getTime())) throw fail("VAT payment date is invalid.", 400, "INVALID_VAT_PAYMENT_DATE");
  const reference = String(paymentReference ?? "").trim();
  const key = String(idempotencyKey ?? "").trim();
  const evidence = String(evidenceUrl ?? "").trim();
  const financialAccountId = String(treasuryAccountId ?? "").trim();
  if (!reference || reference.length > 191 || !key || key.length > 191 || !financialAccountId || evidence.length > 5000) {
    throw fail("Payment reference, idempotency key, and mapped Treasury account are required.", 400, "VAT_PAYMENT_DETAILS_REQUIRED");
  }

  return client.$transaction(async (tx) => {
    const existing = await tx.taxFilingPayment.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (
        existing.filingRecordId !== filingRecordId ||
        !round(existing.amount).equals(paymentAmount) ||
        existing.paymentReference !== reference ||
        existing.treasuryAccountId !== financialAccountId
      ) {
        throw fail("This payment idempotency key is already associated with different payment details.", 409, "VAT_PAYMENT_IDEMPOTENCY_CONFLICT");
      }
      const current = await tx.taxFilingRecord.findUnique({
        where: { id: existing.filingRecordId },
        include: { payments: { orderBy: { paymentDate: "asc" } } },
      });
      return serializeFiling(current);
    }

    const filing = await tx.taxFilingRecord.findUnique({
      where: { id: filingRecordId },
      include: { payments: true },
    });
    if (!filing || filing.periodType !== "VAT_RETURN") throw fail("VAT return record not found.", 404, "VAT_RETURN_NOT_FOUND");
    if (!["FILED", "PAID"].includes(filing.status) || filing.assessedAmount === null) {
      throw fail("A VAT return must be filed with an assessed amount before recording payment.", 409, "VAT_RETURN_NOT_FILED");
    }
    const outstanding = round(filing.assessedAmount).minus(paymentTotal(filing.payments));
    if (paymentAmount.greaterThan(outstanding)) {
      throw fail("Payment exceeds the VAT return's outstanding assessed balance.", 409, "VAT_PAYMENT_EXCEEDS_BALANCE");
    }

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
    const journal = await postJournalEntry({
      transactionDate: paidAt,
      sourceType: "VAT_RETURN_PAYMENT",
      sourceId: paymentId,
      idempotencyKey: `VAT_RETURN_PAYMENT:${key}`,
      referenceNumber: reference,
      description: `VAT payment for return ${filing.periodKey}.`,
      createdBy: recordedBy || "admin",
      lines: [
        {
          accountCode: "2120",
          debit: paymentAmount,
          credit: 0,
          description: `Settle VAT return ${filing.periodKey}`,
        },
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
        recordedBy: recordedBy ? String(recordedBy).slice(0, 191) : null,
      },
    });
    const payments = [...filing.payments, { amount: paymentAmount }];
    const totalPaid = paymentTotal(payments);
    const updated = await tx.taxFilingRecord.update({
      where: { id: filing.id },
      data: {
        taxPaid: totalPaid,
        status: totalPaid.greaterThanOrEqualTo(filing.assessedAmount) ? "PAID" : "FILED",
      },
      include: { payments: { orderBy: { paymentDate: "asc" } } },
    });
    if (afterPayment) await afterPayment(updated, tx);
    return serializeFiling(updated);
  }, { isolationLevel: "Serializable" });
};
