import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";
import {
  cancelFutureCorporateTaxPolicyVersion,
  createCorporateTaxPolicyVersion,
  listCorporateTaxPolicyVersions,
} from "../services/corporateIncomeTaxService.js";

const responseError = (res, error, fallbackMessage) => {
  console.error(fallbackMessage, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || fallbackMessage,
    code: error.code || "CORPORATE_TAX_POLICY_ERROR",
  });
};

export const getCorporateTaxPolicyVersionsAdmin = async (_req, res) => {
  try {
    const versions = await listCorporateTaxPolicyVersions();
    return res.status(200).json({ success: true, versions });
  } catch (error) {
    return responseError(res, error, "Failed to load corporate tax policies.");
  }
};

export const createCorporateTaxPolicyVersionAdmin = async (req, res) => {
  try {
    const actorId = req.auth?.accountId || req.auth?.userId || null;
    const version = await createCorporateTaxPolicyVersion({
      baseRate: req.body?.baseRate,
      fiscalYear: req.body?.fiscalYear,
      brackets: req.body?.brackets,
      rules: req.body?.rules,
      effectiveFrom: req.body?.effectiveFrom,
      createdBy: actorId,
      client: prisma,
      afterCreate: (created, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "CORPORATE_TAX_POLICY_VERSION_CREATED",
          entityType: "CorporateTaxPolicyVersion",
          entityId: created.id,
          afterState: {
            fiscalYear: created.fiscalYear,
            baseRate: created.baseRate.toString(),
            brackets: created.brackets,
            rules: created.rules,
            effectiveFrom: created.effectiveFrom,
            effectiveUntil: created.effectiveUntil,
          },
        },
        { client: tx },
      ),
    });
    return res.status(201).json({ success: true, message: "Corporate tax policy scheduled.", version });
  } catch (error) {
    return responseError(res, error, "Failed to schedule corporate tax policy.");
  }
};

export const cancelCorporateTaxPolicyVersionAdmin = async (req, res) => {
  try {
    const actorId = req.auth?.accountId || req.auth?.userId || null;
    const version = await cancelFutureCorporateTaxPolicyVersion({
      id: req.params.id,
      client: prisma,
      afterCancel: (cancelled, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "CORPORATE_TAX_POLICY_VERSION_CANCELLED",
          entityType: "CorporateTaxPolicyVersion",
          entityId: cancelled.id,
          beforeState: { status: "ACTIVE", effectiveFrom: cancelled.effectiveFrom },
          afterState: { status: "CANCELLED", fiscalYear: cancelled.fiscalYear },
        },
        { client: tx },
      ),
    });
    return res.status(200).json({ success: true, message: "Scheduled corporate tax policy cancelled.", version });
  } catch (error) {
    return responseError(res, error, "Failed to cancel corporate tax policy.");
  }
};
