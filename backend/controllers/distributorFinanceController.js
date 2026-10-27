import {
  getDistributorFinancialStatement,
  submitDistributorSettlementRequest,
  executeAdminDistributorSettlement,
} from "../services/distributorFinanceService.js";
import {
  recordDistributorRateCard,
  getDistributorRateCards,
} from "../services/distributorRateCardService.js";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";
import {
  getDistributorCashPosition,
  listDistributorRemittances,
  listDistributorSettlementOffsets,
  netDistributorRefundPayable,
  reviewDistributorRemittance,
  submitDistributorRemittance,
} from "../services/distributorCashSettlementService.js";
import { deleteEvidenceImage, uploadEvidenceImage } from "../utils/evidenceImageUpload.js";

/**
 * GET /api/distributor/finance/statement
 * Detailed financial dashboard showing payables/receivables, itemized transactions,
 * gross earnings, incentives, discounts/charges, and VAT breakdown (With VAT or Without VAT).
 */
export const getDistributorStatement = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.auth?.distributorId;
    if (!distributorId) {
      return res.status(403).json({
        success: false,
        message: "An approved distributor profile is required.",
      });
    }

    const withVatParam = req.query.withVat;
    if (withVatParam !== undefined && !["true", "false", true, false].includes(withVatParam)) {
      return res.status(400).json({
        success: false,
        message: "withVat must be true or false.",
        code: "INVALID_VAT_MODE",
      });
    }
    const withVat = withVatParam === undefined ? true : withVatParam === true || withVatParam === "true";
    const { startDate, endDate } = req.query;

    const statement = await getDistributorFinancialStatement({
      distributorId,
      withVat,
      startDate,
      endDate,
    });

    return res.status(200).json(statement);
  } catch (error) {
    console.error("getDistributorStatement error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load financial statement.",
      code: error.code || "FINANCIAL_STATEMENT_ERROR",
    });
  }
};

export const getDistributorCashRemittances = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.auth?.distributorId;
    if (!distributorId) {
      return res.status(403).json({ success: false, message: "An approved distributor profile is required." });
    }
    const [position, remittances, offsets] = await Promise.all([
      getDistributorCashPosition({ distributorId }),
      listDistributorRemittances({ distributorId, take: req.query.limit || 50, cursor: req.query.cursor || null }),
      listDistributorSettlementOffsets({ distributorId, take: req.query.limit || 50 }),
    ]);
    return res.status(200).json({ success: true, position, remittances, offsets });
  } catch (error) {
    console.error("getDistributorCashRemittances error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load distributor COD remittances.",
      code: error.code || "DISTRIBUTOR_CASH_POSITION_ERROR",
    });
  }
};

export const getAdminDistributorCashRemittances = async (req, res) => {
  try {
    const distributorId = req.params.id;
    const [position, remittances, offsets] = await Promise.all([
      getDistributorCashPosition({ distributorId }),
      listDistributorRemittances({
        distributorId,
        take: req.query.limit || 50,
        cursor: req.query.cursor || null,
      }),
      listDistributorSettlementOffsets({ distributorId, take: req.query.limit || 50 }),
    ]);
    return res.status(200).json({ success: true, position, remittances, offsets });
  } catch (error) {
    console.error("getAdminDistributorCashRemittances error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load distributor COD remittances.",
      code: error.code || "DISTRIBUTOR_CASH_POSITION_ERROR",
    });
  }
};

export const approveDistributorRefundNetting = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, message: "A JSON netting approval body is required.", code: "INVALID_REQUEST_BODY" });
    }
    const result = await netDistributorRefundPayable({
      distributorId: req.params.id,
      amount: req.body.amount,
      idempotencyKey: req.body.idempotencyKey || req.headers?.["idempotency-key"],
      notes: req.body.notes || null,
      reviewerAccountId: req.auth?.accountId || req.auth?.userId || null,
      actorContext: {
        ipAddress: req.ip || null,
        userAgent: req.headers?.["user-agent"] || null,
        correlationId: req.correlationId || null,
      },
    });
    return res.status(result.isReplay ? 200 : 201).json(result);
  } catch (error) {
    console.error("approveDistributorRefundNetting error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to approve distributor refund netting.",
      code: error.code || "DISTRIBUTOR_NETTING_ERROR",
    });
  }
};

export const submitDistributorCashRemittance = async (req, res) => {
  let uploadedEvidence;
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, message: "A multipart remittance request body is required.", code: "INVALID_REQUEST_BODY" });
    }
    const distributorId = req.distributorId || req.auth?.distributorId;
    if (!distributorId) {
      return res.status(403).json({ success: false, message: "An approved distributor profile is required." });
    }
    uploadedEvidence = await uploadEvidenceImage(req.file, "aama_financial_evidence/remittances");
    const result = await submitDistributorRemittance({
      distributorId,
      amount: req.body.amount,
      reference: req.body.reference,
      evidenceUrl: uploadedEvidence.secure_url,
      idempotencyKey: req.body.idempotencyKey || req.headers?.["idempotency-key"],
      recordedByAccountId: req.auth?.accountId || req.auth?.userId || null,
    });
    return res.status(result.isReplay ? 200 : 201).json(result);
  } catch (error) {
    if (uploadedEvidence?.public_id) await deleteEvidenceImage(uploadedEvidence.public_id);
    console.error("submitDistributorCashRemittance error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to submit distributor COD remittance.",
      code: error.code || "DISTRIBUTOR_REMITTANCE_ERROR",
    });
  }
};

export const reviewDistributorCashRemittance = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, message: "A JSON remittance review body is required.", code: "INVALID_REQUEST_BODY" });
    }
    const result = await reviewDistributorRemittance({
      distributorId: req.params.id,
      batchId: req.params.batchId,
      decision: req.body.decision,
      financialAccountId: req.body.financialAccountId || null,
      reviewNotes: req.body.reviewNotes || null,
      reviewerAccountId: req.auth?.accountId || req.auth?.userId || null,
      actorContext: {
        ipAddress: req.ip || null,
        userAgent: req.headers?.["user-agent"] || null,
        correlationId: req.correlationId || null,
      },
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("reviewDistributorCashRemittance error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to review distributor COD remittance.",
      code: error.code || "DISTRIBUTOR_REMITTANCE_REVIEW_ERROR",
    });
  }
};

/**
 * POST /api/distributor/finance/ask-settlement
 * Submit settlement request to Admin.
 */
export const askDistributorSettlement = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({
        success: false,
        message: "A JSON settlement request body is required.",
        code: "INVALID_REQUEST_BODY",
      });
    }
    const distributorId = req.distributorId || req.auth?.distributorId;
    if (!distributorId) {
      return res.status(403).json({
        success: false,
        message: "An approved distributor profile is required.",
      });
    }

    const { amount, notes } = req.body;
    const idempotencyKey = req.body.idempotencyKey || req.headers?.["idempotency-key"] || null;
    if (amount === undefined || amount === null) {
      return res.status(400).json({
        success: false,
        message: "Settlement amount is required.",
      });
    }

    const requestedByAccountId = req.auth?.accountId || req.auth?.userId || null;
    const result = await submitDistributorSettlementRequest({
      distributorId,
      amount,
      notes,
      idempotencyKey,
      requestedByAccountId,
    });

    return res.status(result.isReplay ? 200 : 201).json(result);
  } catch (error) {
    console.error("askDistributorSettlement error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to submit settlement request.",
      code: error.code || "SETTLEMENT_REQUEST_ERROR",
    });
  }
};

/**
 * PATCH /api/admin/distributor-finance/settle
 * Admin executes settlement (applying negotiated commissions, bonuses, discounts, and charges).
 */
export const adminExecuteSettlement = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({
        success: false,
        message: "A JSON settlement payment body is required.",
        code: "INVALID_REQUEST_BODY",
      });
    }
    const settlementId = req.params.id || req.body.settlementId || req.body.id || null;
    const { amount, financialAccountId, adminNotes, notes } = req.body;

    const adminAccountId = req.auth?.accountId || req.auth?.userId || req.adminId || null;

    const result = await executeAdminDistributorSettlement({
      settlementId,
      amount,
      financialAccountId,
      adminNotes: adminNotes || notes,
      idempotencyKey: req.body.idempotencyKey || req.headers?.["idempotency-key"] || null,
      adminAccountId,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("adminExecuteSettlement error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to execute distributor settlement.",
      code: error.code || "ADMIN_SETTLEMENT_ERROR",
    });
  }
};

/**
 * GET /api/admin/distributor-finance/settlements
 * List distributor settlement requests for Admin.
 */
export const listAdminDistributorSettlements = async (req, res) => {
  try {
    const { distributorId, status, page = 1, limit = 20 } = req.query;
    if (
      (distributorId !== undefined && (typeof distributorId !== "string" || !distributorId.trim() || distributorId.length > 191)) ||
      !/^\d+$/.test(String(page)) ||
      !/^\d+$/.test(String(limit))
    ) {
      return res.status(400).json({
        success: false,
        message: "Distributor, page, or limit filter is invalid.",
        code: "INVALID_SETTLEMENT_FILTER",
      });
    }
    const numPage = Number(page);
    const numLimit = Number(limit);
    if (numPage < 1 || numLimit < 1 || numLimit > 100) {
      return res.status(400).json({
        success: false,
        message: "Page must be positive and limit must be between 1 and 100.",
        code: "INVALID_SETTLEMENT_FILTER",
      });
    }
    const allowedStatuses = ["PENDING", "PARTIALLY_PAID", "SETTLED", "REJECTED", "all"];
    if (status !== undefined && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Settlement status filter is invalid.",
        code: "INVALID_SETTLEMENT_FILTER",
      });
    }
    const skip = (numPage - 1) * numLimit;

    const where = {};
    if (distributorId) where.distributorId = distributorId;
    if (status && status !== "all") where.status = status;

    const [settlements, total] = await Promise.all([
      prisma.distributorSettlementRequest.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip,
        take: numLimit,
        include: {
          distributor: { select: { id: true, name: true, city: true, phone: true } },
        },
      }),
      prisma.distributorSettlementRequest.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      settlements,
      pagination: {
        page: numPage,
        limit: numLimit,
        total,
        pages: Math.ceil(total / numLimit),
      },
    });
  } catch (error) {
    console.error("listAdminDistributorSettlements error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to list distributor settlements.",
    });
  }
};

/**
 * POST /api/admin/distributor-rates
 * Negotiate and record charge per product delivery, return delivery fee, commission/bonus/incentive rates between Admin and Distributor.
 */
export const adminRecordDistributorRates = async (req, res) => {
  try {
    const {
      distributorId,
      productId,
      deliveryCharge,
      returnCharge,
      commissionRate,
      bonusRate,
      incentiveRate,
      vatRate,
      vatInclusive,
      status,
      effectiveFrom,
      effectiveUntil,
      notes,
    } = req.body;

    if (!distributorId) {
      return res.status(400).json({
        success: false,
        message: "Distributor ID is required.",
      });
    }

    const proposedByAccountId = req.auth?.accountId || req.auth?.userId || req.adminId || null;
    const result = await recordDistributorRateCard({
      distributorId,
      productId,
      deliveryCharge,
      returnCharge,
      commissionRate,
      bonusRate,
      incentiveRate,
      vatRate,
      vatInclusive,
      status: status || "APPROVED",
      proposedByRole: "ADMIN",
      proposedByAccountId,
      reviewedByAccountId: proposedByAccountId,
      effectiveFrom,
      effectiveUntil,
      notes,
    });

    return res.status(200).json({
      success: true,
      message: "Distributor rate card recorded and approved successfully.",
      rateCard: result,
    });
  } catch (error) {
    console.error("adminRecordDistributorRates error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to record distributor rates.",
      code: error.code || "RATE_CARD_ERROR",
    });
  }
};

/**
 * GET /api/admin/distributor-rates or GET /api/distributor/rates
 * List negotiated rate cards.
 */
export const listDistributorRates = async (req, res) => {
  try {
    const distributorId = req.query.distributorId || req.distributorId || req.auth?.distributorId;
    const { productId, status } = req.query;

    const rateCards = await getDistributorRateCards({
      distributorId,
      productId,
      status,
    });

    return res.status(200).json({
      success: true,
      rateCards,
    });
  } catch (error) {
    console.error("listDistributorRates error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to list rate cards.",
    });
  }
};

export const adminUpdateDistributorRateCard = async (req, res) => {
  try {
    const actorId = req.auth?.accountId || req.auth?.userId || req.adminId || null;
    const { prior, revised } = await prisma.$transaction(async (tx) => {
      const current = await tx.distributorDeliveryChargeNegotiation.findUnique({
        where: { id: req.params.id },
      });
      if (!current) throw Object.assign(new Error("Distributor rate card not found."), { statusCode: 404, code: "RATE_CARD_NOT_FOUND" });
      if (!["APPROVED", "PENDING"].includes(current.status)) {
        throw Object.assign(new Error("Only pending or approved rate cards can be revised."), { statusCode: 409, code: "RATE_CARD_NOT_REVISIONABLE" });
      }
      const next = await recordDistributorRateCard({
        distributorId: current.distributorId,
        productId: current.productId,
        deliveryCharge: req.body.deliveryCharge ?? current.deliveryCharge,
        returnCharge: req.body.returnCharge ?? current.returnCharge,
        commissionRate: req.body.commissionRate ?? current.commissionRate,
        bonusRate: req.body.bonusRate ?? current.bonusRate,
        incentiveRate: req.body.incentiveRate ?? current.incentiveRate,
        vatRate: req.body.vatRate ?? current.vatRate,
        vatInclusive: req.body.vatInclusive ?? current.vatInclusive,
        status: "APPROVED",
        proposedByRole: "ADMIN",
        proposedByAccountId: actorId,
        reviewedByAccountId: actorId,
        effectiveFrom: req.body.effectiveFrom || new Date(),
        effectiveUntil: req.body.effectiveUntil ?? null,
        notes: req.body.notes || `Revised from rate card ${current.id}`,
        client: tx,
      });
      await recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "DISTRIBUTOR_RATE_CARD_REVISED",
          entityType: "DistributorDeliveryChargeNegotiation",
          entityId: next.id,
          beforeState: { id: current.id, deliveryCharge: String(current.deliveryCharge), status: current.status },
          afterState: { id: next.id, deliveryCharge: String(next.deliveryCharge), supersedesRateCardId: current.id },
        },
        { client: tx },
      );
      return { prior: current, revised: next };
    });
    return res.status(201).json({ success: true, message: "A new immutable rate-card version was created.", rateCard: revised, supersedesRateCardId: prior.id });
  } catch (error) {
    console.error("adminUpdateDistributorRateCard error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to revise distributor rate card.",
      code: error.code || "RATE_CARD_ERROR",
    });
  }
};

export const adminExpireDistributorRateCard = async (req, res) => {
  try {
    const actorId = req.auth?.accountId || req.auth?.userId || req.adminId || null;
    const now = new Date();
    const { updated } = await prisma.$transaction(async (tx) => {
      const rateCard = await tx.distributorDeliveryChargeNegotiation.findUnique({
        where: { id: req.params.id },
      });
      if (!rateCard) throw Object.assign(new Error("Distributor rate card not found."), { statusCode: 404, code: "RATE_CARD_NOT_FOUND" });
      if (!["APPROVED", "PENDING"].includes(rateCard.status)) {
        throw Object.assign(new Error("This rate card is already closed."), { statusCode: 409, code: "RATE_CARD_ALREADY_CLOSED" });
      }
      const future = rateCard.effectiveFrom && rateCard.effectiveFrom > now;
      const closed = await tx.distributorDeliveryChargeNegotiation.update({
        where: { id: rateCard.id },
        data: rateCard.status === "PENDING" || future
          ? { status: "EXPIRED", reviewedByAccountId: actorId, reviewedAt: now }
          : { effectiveUntil: rateCard.effectiveUntil && rateCard.effectiveUntil < now ? rateCard.effectiveUntil : now },
      });
      await recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "DISTRIBUTOR_RATE_CARD_EXPIRED",
          entityType: "DistributorDeliveryChargeNegotiation",
          entityId: rateCard.id,
          beforeState: { status: rateCard.status, effectiveUntil: rateCard.effectiveUntil },
          afterState: { status: closed.status, effectiveUntil: closed.effectiveUntil },
        },
        { client: tx },
      );
      return { updated: closed };
    });
    return res.status(200).json({ success: true, message: "Rate card was closed without deleting its financial history.", rateCard: updated });
  } catch (error) {
    console.error("adminExpireDistributorRateCard error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to close distributor rate card.",
      code: error.code || "RATE_CARD_ERROR",
    });
  }
};
