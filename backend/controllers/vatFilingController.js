import { recordSystemAudit } from "../services/auditService.js";
import { prisma } from "../config/db.js";
import {
  createVatFilingDraft,
  amendVatReturn,
  fileVatReturn,
  listVatFilingRecords,
  recordVatFilingPayment,
} from "../services/vatFilingService.js";

const responseError = (res, error, fallbackMessage) => {
  console.error(fallbackMessage, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || fallbackMessage,
    code: error.code || "VAT_FILING_ERROR",
  });
};

const getActor = (req) => req.auth?.accountId || req.auth?.userId || null;

export const getVatFilingRecordsAdmin = async (_req, res) => {
  try {
    const records = await listVatFilingRecords();
    return res.status(200).json({ success: true, records });
  } catch (error) {
    return responseError(res, error, "Failed to load VAT filing records.");
  }
};

export const getVatAssessmentAdjustmentAccountsAdmin = async (_req, res) => {
  try {
    const accounts = await prisma.account.findMany({
      where: {
        isActive: true,
        accountCode: { notIn: ["1110", "1120", "2120"] },
      },
      select: { id: true, accountCode: true, accountName: true, accountType: true },
      orderBy: { accountCode: "asc" },
    });
    return res.status(200).json({ success: true, accounts });
  } catch (error) {
    return responseError(res, error, "Failed to load VAT adjustment accounts.");
  }
};

export const createVatFilingDraftAdmin = async (req, res) => {
  try {
    const actorId = getActor(req);
    const record = await createVatFilingDraft({
      filingCadence: req.body?.filingCadence,
      periodKey: req.body?.periodKey,
      periodStart: req.body?.periodStart,
      periodEnd: req.body?.periodEnd,
      createdBy: actorId,
      afterCreate: (created, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "VAT_RETURN_DRAFT_CREATED",
          entityType: "TaxFilingRecord",
          entityId: created.id,
          afterState: {
            periodKey: created.periodKey,
            periodStart: created.periodStart,
            periodEnd: created.periodEnd,
            filingCadence: created.filingCadence,
            outputVat: created.outputVat.toString(),
            inputVat: created.inputVat.toString(),
            carriedForwardInputVat: created.carriedForwardInputVat.toString(),
            carriedForwardOutputVat: created.carriedForwardOutputVat.toString(),
            carriedForwardPaymentCredit: created.carriedForwardPaymentCredit.toString(),
            sourceReconciliation: created.sourceReconciliation,
            netVatPayable: created.netVatPayable.toString(),
          },
        },
        { client: tx },
      ),
    });
    return res.status(201).json({ success: true, message: "VAT return draft prepared from posted journal data.", record });
  } catch (error) {
    return responseError(res, error, "Failed to prepare VAT return draft.");
  }
};

export const fileVatReturnAdmin = async (req, res) => {
  try {
    const actorId = getActor(req);
    const record = await fileVatReturn({
      id: req.params.id,
      assessedAmount: req.body?.assessedAmount,
      paymentCreditApplied: req.body?.paymentCreditApplied,
      assessmentAdjustmentAccountId: req.body?.assessmentAdjustmentAccountId,
      filedDate: req.body?.filedDate,
      filedReference: req.body?.filedReference,
      filingEvidenceUrl: req.body?.filingEvidenceUrl,
      adjustmentReason: req.body?.adjustmentReason,
      filedBy: actorId,
      afterFile: (updated, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "VAT_RETURN_MARKED_FILED",
          entityType: "TaxFilingRecord",
          entityId: updated.id,
          afterState: {
            status: updated.status,
            assessedAmount: updated.assessedAmount?.toString() || "0",
            paymentCreditApplied: updated.paymentCreditApplied?.toString() || "0",
            assessmentAdjustmentJournalId: updated.assessmentAdjustmentJournalId,
            assessmentAdjustmentAccountId: updated.assessmentAdjustmentAccountId,
            filedReference: updated.filedReference,
            filedDate: updated.filedDate,
          },
        },
        { client: tx },
      ),
    });
    return res.status(200).json({ success: true, message: "VAT return filing recorded.", record });
  } catch (error) {
    return responseError(res, error, "Failed to record VAT return filing.");
  }
};

export const createVatFilingPaymentAdmin = async (req, res) => {
  try {
    const actorId = getActor(req);
    const record = await recordVatFilingPayment({
      filingRecordId: req.params.id,
      amount: req.body?.amount,
      paymentDate: req.body?.paymentDate,
      paymentReference: req.body?.paymentReference,
      treasuryAccountId: req.body?.treasuryAccountId,
      idempotencyKey: req.body?.idempotencyKey,
      evidenceUrl: req.body?.evidenceUrl,
      adjustmentReason: req.body?.adjustmentReason,
      recordedBy: actorId,
      afterPayment: (updated, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "VAT_RETURN_PAYMENT_RECORDED",
          entityType: "TaxFilingRecord",
          entityId: updated.id,
          afterState: {
            periodKey: updated.periodKey,
            taxPaid: updated.taxPaid.toString(),
            paymentCreditApplied: updated.paymentCreditApplied?.toString() || "0",
            status: updated.status,
            latestPayment: updated.payments?.at(-1)
              ? {
                  amount: updated.payments.at(-1).amount.toString(),
                  adjustmentReason: updated.payments.at(-1).adjustmentReason,
                }
              : null,
          },
        },
        { client: tx },
      ),
    });
    return res.status(201).json({ success: true, message: "VAT payment recorded and posted to accounting.", record });
  } catch (error) {
    return responseError(res, error, "Failed to record VAT payment.");
  }
};

export const amendVatReturnAdmin = async (req, res) => {
  try {
    const actorId = getActor(req);
    const amendedReference = String(req.body?.amendedReference ?? "").trim();
    const record = await amendVatReturn({
      id: req.params.id,
      amendedAssessedAmount: req.body?.amendedAssessedAmount,
      amendedDate: req.body?.amendedDate,
      amendedReference,
      adjustmentAccountId: req.body?.adjustmentAccountId,
      reason: req.body?.reason,
      evidenceUrl: req.body?.evidenceUrl,
      idempotencyKey: req.body?.idempotencyKey,
      recordedBy: actorId,
      afterAmendment: (updated, amendment, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "VAT_RETURN_AMENDED",
          entityType: "TaxFilingRecord",
          entityId: updated.id,
          afterState: {
            status: updated.status,
            periodKey: updated.periodKey,
            previousAssessedAmount: amendment.previousAssessedAmount.toString(),
            amendedAssessedAmount: amendment.amendedAssessedAmount.toString(),
            amendedReference: amendment.amendedReference,
            adjustmentReason: amendment.reason,
            adjustmentAccountId: amendment.adjustmentAccountId,
            journalEntryId: amendment.journalEntryId,
            paymentCreditJournalEntryId: amendment.paymentCreditJournalEntryId,
          },
        },
        { client: tx },
      ),
    });
    return res.status(200).json({ success: true, message: "VAT return amendment recorded and posted to accounting.", record });
  } catch (error) {
    return responseError(res, error, "Failed to amend VAT return.");
  }
};
