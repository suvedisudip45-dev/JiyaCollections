import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";
import { resolveCalendarDateInput } from "../services/nepaliFiscalCalendar.js";
import {
  cancelFutureVatRateVersion,
  createVatRateVersion,
  listVatRateVersions,
} from "../services/vatRateService.js";
import {
  cancelFutureTaxRegistrationVersion,
  getSellerTaxProfile,
  listTaxRegistrationVersions,
  scheduleTaxRegistrationVersion,
  updateSellerTaxProfile,
} from "../services/sellerTaxProfileService.js";

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
    const effectiveFrom = await resolveCalendarDateInput(req.body?.effectiveFrom, req.body?.calendar);
    const version = await createVatRateVersion({
      vatRate: req.body?.vatRate,
      effectiveFrom,
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

export const getSellerTaxProfileAdmin = async (_req, res) => {
  try {
    const result = await getSellerTaxProfile();
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return responseError(res, error, "Failed to load seller tax profile.");
  }
};

export const updateSellerTaxProfileAdmin = async (req, res) => {
  try {
    const actorId = req.auth?.accountId || req.auth?.userId || null;
    const profile = await updateSellerTaxProfile({
      legalName: req.body?.legalName,
      panNumber: req.body?.panNumber,
      address: req.body?.address,
      afterUpdate: (updated, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "SELLER_TAX_PROFILE_UPDATED",
          entityType: "SellerTaxProfile",
          entityId: updated.id,
          afterState: {
            legalName: updated.legalName,
            panNumber: updated.panNumber,
            address: updated.address,
          },
        },
        { client: tx },
      ),
    });
    return res.status(200).json({ success: true, message: "Seller tax profile saved.", profile });
  } catch (error) {
    return responseError(res, error, "Failed to save seller tax profile.");
  }
};

export const getTaxRegistrationVersionsAdmin = async (_req, res) => {
  try {
    const versions = await listTaxRegistrationVersions();
    return res.status(200).json({ success: true, versions });
  } catch (error) {
    return responseError(res, error, "Failed to load tax registration history.");
  }
};

export const createTaxRegistrationVersionAdmin = async (req, res) => {
  try {
    const actorId = req.auth?.accountId || req.auth?.userId || null;
    const effectiveFrom = await resolveCalendarDateInput(req.body?.effectiveFrom, req.body?.calendar);
    const version = await scheduleTaxRegistrationVersion({
      taxStatus: req.body?.taxStatus,
      vatNumber: req.body?.vatNumber,
      effectiveFrom,
      createdBy: actorId,
      afterCreate: (created, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "TAX_REGISTRATION_VERSION_CREATED",
          entityType: "TaxRegistrationVersion",
          entityId: created.id,
          afterState: {
            taxStatus: created.taxStatus,
            vatNumber: created.vatNumber,
            effectiveFrom: created.effectiveFrom,
          },
        },
        { client: tx },
      ),
    });
    return res.status(201).json({ success: true, message: "Tax registration change scheduled.", version });
  } catch (error) {
    return responseError(res, error, "Failed to schedule tax registration change.");
  }
};

export const cancelTaxRegistrationVersionAdmin = async (req, res) => {
  try {
    const actorId = req.auth?.accountId || req.auth?.userId || null;
    const version = await cancelFutureTaxRegistrationVersion({
      id: req.params.id,
      afterCancel: (cancelled, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "TAX_REGISTRATION_VERSION_CANCELLED",
          entityType: "TaxRegistrationVersion",
          entityId: cancelled.id,
          beforeState: {
            taxStatus: cancelled.taxStatus,
            effectiveFrom: cancelled.effectiveFrom,
          },
          afterState: { status: "CANCELLED" },
        },
        { client: tx },
      ),
    });
    return res.status(200).json({ success: true, message: "Scheduled tax registration change cancelled.", version });
  } catch (error) {
    return responseError(res, error, "Failed to cancel tax registration change.");
  }
};
