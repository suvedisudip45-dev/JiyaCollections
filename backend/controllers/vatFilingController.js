import { recordSystemAudit } from "../services/auditService.js";
import { prisma } from "../config/db.js";
import {
  createVatFilingDraft,
  listVatFilingRecords,
} from "../services/vatFilingService.js";
import { requestAccountingActionApproval } from "../services/accountingActionApprovalService.js";
import {
  resolveCalendarDateInput,
  resolveCalendarDateRangeInput,
} from "../services/nepaliFiscalCalendar.js";

const responseError = (res, error, fallbackMessage) => {
  console.error(fallbackMessage, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || fallbackMessage,
    code: error.code || "VAT_FILING_ERROR",
  });
};

const getActor = (req) => req.auth?.accountId || req.auth?.userId || null;
const getRequestKey = (req) => req.headers?.["idempotency-key"] || req.body?.idempotencyKey || "";
const requestVatActionApproval = async (req, res, actionType, payload) => {
  const result = await requestAccountingActionApproval({
    actionType,
    requestKey: getRequestKey(req),
    payload,
    actor: { accountId: getActor(req), role: req.auth?.role },
    auditContext: {
      ipAddress: req.ip || null,
      userAgent: req.get?.("user-agent") || null,
      correlationId: req.correlationId || null,
    },
  });
  const messages = {
    VAT_RETURN_FILE: "VAT return filing submitted for independent Admin approval.",
    VAT_RETURN_PAYMENT: "VAT payment submitted for independent Admin approval.",
    VAT_RETURN_AMENDMENT: "VAT return amendment submitted for independent Admin approval.",
  };
  return res.status(result.isReplay ? 200 : 202).json({
    success: true,
    message: result.isReplay ? "This VAT action request already exists." : messages[actionType],
    approvalRequest: result.approvalRequest,
  });
};

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
    const { startDate: periodStart, endDate: periodEnd } = await resolveCalendarDateRangeInput(
      req.body?.periodStart,
      req.body?.periodEnd,
      req.body?.calendar,
    );
    const record = await createVatFilingDraft({
      filingCadence: req.body?.filingCadence,
      periodKey: req.body?.periodKey,
      periodStart,
      periodEnd,
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
    const filedDate = await resolveCalendarDateInput(req.body?.filedDate, req.body?.calendar);
    return await requestVatActionApproval(req, res, "VAT_RETURN_FILE", {
      id: req.params.id,
      assessedAmount: req.body?.assessedAmount,
      paymentCreditApplied: req.body?.paymentCreditApplied,
      assessmentAdjustmentAccountId: req.body?.assessmentAdjustmentAccountId,
      filedDate: filedDate.toISOString(),
      filedReference: req.body?.filedReference,
      filingEvidenceUrl: req.body?.filingEvidenceUrl,
      adjustmentReason: req.body?.adjustmentReason,
      reason: req.body?.approvalReason,
    });
  } catch (error) {
    return responseError(res, error, "Failed to record VAT return filing.");
  }
};

export const createVatFilingPaymentAdmin = async (req, res) => {
  try {
    const paymentDate = await resolveCalendarDateInput(req.body?.paymentDate, req.body?.calendar);
    return await requestVatActionApproval(req, res, "VAT_RETURN_PAYMENT", {
      filingRecordId: req.params.id,
      amount: req.body?.amount,
      paymentDate: paymentDate.toISOString(),
      paymentReference: req.body?.paymentReference,
      treasuryAccountId: req.body?.treasuryAccountId,
      evidenceUrl: req.body?.evidenceUrl,
      adjustmentReason: req.body?.adjustmentReason,
      reason: req.body?.approvalReason,
    });
  } catch (error) {
    return responseError(res, error, "Failed to record VAT payment.");
  }
};

export const amendVatReturnAdmin = async (req, res) => {
  try {
    const amendedDate = await resolveCalendarDateInput(req.body?.amendedDate, req.body?.calendar);
    return await requestVatActionApproval(req, res, "VAT_RETURN_AMENDMENT", {
      id: req.params.id,
      amendedAssessedAmount: req.body?.amendedAssessedAmount,
      amendedDate: amendedDate.toISOString(),
      amendedReference: String(req.body?.amendedReference ?? "").trim(),
      adjustmentAccountId: req.body?.adjustmentAccountId,
      reason: req.body?.reason,
      evidenceUrl: req.body?.evidenceUrl,
    });
  } catch (error) {
    return responseError(res, error, "Failed to amend VAT return.");
  }
};
