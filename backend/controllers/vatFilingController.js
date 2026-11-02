import { recordSystemAudit } from "../services/auditService.js";
import {
  createVatFilingDraft,
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

export const createVatFilingDraftAdmin = async (req, res) => {
  try {
    const actorId = getActor(req);
    const record = await createVatFilingDraft({
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
            outputVat: created.outputVat.toString(),
            inputVat: created.inputVat.toString(),
            carriedForwardInputVat: created.carriedForwardInputVat.toString(),
            carriedForwardOutputVat: created.carriedForwardOutputVat.toString(),
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
            status: updated.status,
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
