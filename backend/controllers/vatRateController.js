import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";
import {
  cancelFutureVatRateVersion,
  createVatRateVersion,
  listVatRateVersions,
} from "../services/vatRateService.js";

const responseError = (res, error, fallbackMessage) => {
  console.error(fallbackMessage, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || fallbackMessage,
    code: error.code || "VAT_RATE_ERROR",
  });
};

export const getVatRateVersions = async (_req, res) => {
  try {
    const versions = await listVatRateVersions();
    return res.status(200).json({ success: true, versions });
  } catch (error) {
    return responseError(res, error, "Failed to load VAT rate versions.");
  }
};

export const createVatRateVersionAdmin = async (req, res) => {
  try {
    const actorId = req.auth?.accountId || req.auth?.userId || null;
    const version = await createVatRateVersion({
      vatRate: req.body?.vatRate,
      effectiveFrom: req.body?.effectiveFrom,
      createdBy: actorId,
      client: prisma,
      afterCreate: (created, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "VAT_RATE_VERSION_CREATED",
          entityType: "VatRateVersion",
          entityId: created.id,
          afterState: {
            vatRate: created.vatRate.toString(),
            effectiveFrom: created.effectiveFrom,
            effectiveUntil: created.effectiveUntil,
          },
        },
        { client: tx },
      ),
    });
    return res.status(201).json({ success: true, message: "Future VAT rate version scheduled.", version });
  } catch (error) {
    return responseError(res, error, "Failed to schedule VAT rate version.");
  }
};

export const cancelVatRateVersionAdmin = async (req, res) => {
  try {
    const actorId = req.auth?.accountId || req.auth?.userId || null;
    const version = await cancelFutureVatRateVersion({
      id: req.params.id,
      client: prisma,
      afterCancel: (cancelled, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "VAT_RATE_VERSION_CANCELLED",
          entityType: "VatRateVersion",
          entityId: cancelled.id,
          beforeState: { status: "ACTIVE", effectiveFrom: cancelled.effectiveFrom },
          afterState: { status: "CANCELLED", vatRate: cancelled.vatRate.toString() },
        },
        { client: tx },
      ),
    });
    return res.status(200).json({ success: true, message: "Scheduled VAT rate version cancelled.", version });
  } catch (error) {
    return responseError(res, error, "Failed to cancel VAT rate version.");
  }
};
