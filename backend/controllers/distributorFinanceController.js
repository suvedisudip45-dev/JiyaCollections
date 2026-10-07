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
    const withVat = withVatParam !== undefined ? withVatParam === "true" || withVatParam === true : true;
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

/**
 * POST /api/distributor/finance/ask-settlement
 * Submit settlement request to Admin.
 */
export const askDistributorSettlement = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.auth?.distributorId;
    if (!distributorId) {
      return res.status(403).json({
        success: false,
        message: "An approved distributor profile is required.",
      });
    }

    const { amount, notes, idempotencyKey } = req.body;
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
    const settlementId = req.params.id || req.body.settlementId || req.body.id || null;
    const {
      distributorId,
      amount,
      financialAccountId,
      bonusAmount,
      discountsApplied,
      chargesApplied,
      adminNotes,
      notes,
    } = req.body;

    const adminAccountId = req.auth?.accountId || req.auth?.userId || req.adminId || null;

    const result = await executeAdminDistributorSettlement({
      settlementId,
      distributorId,
      amount,
      financialAccountId,
      bonusAmount,
      discountsApplied,
      chargesApplied,
      adminNotes: adminNotes || notes,
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
    const numPage = Math.max(1, Number(page || 1));
    const numLimit = Math.min(100, Math.max(1, Number(limit || 20)));
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
