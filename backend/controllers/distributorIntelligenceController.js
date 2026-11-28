import { prisma } from "../config/db.js";
import crypto from "node:crypto";
import {
  createReplenishmentDemand,
  createReplenishmentSuggestion,
  getExplainableForecast,
  getInventoryReplenishment,
  getMonthlyStatementData,
  getProfitability,
  getSalesVelocity,
  saveInventoryPolicies,
} from "../services/distributorIntelligenceService.js";

const respondError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  message: error.statusCode ? error.message : "The intelligence operation could not be completed.",
  code: error.code || "INTELLIGENCE_OPERATION_FAILED",
});
const actor = (req) => req.auth?.accountId || req.auth?.profileId || null;

export const getDistributorVelocity = async (req, res) => {
  try {
    const result = await getSalesVelocity({
      distributorId: req.distributorId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      productId: req.query.productId || null,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return respondError(res, error);
  }
};

export const getDistributorReplenishment = async (req, res) => {
  try {
    const result = await getInventoryReplenishment({ distributorId: req.distributorId });
    return res.json({ success: true, ...result });
  } catch (error) {
    return respondError(res, error);
  }
};

export const saveDistributorInventoryPolicies = async (req, res) => {
  try {
    const policies = await saveInventoryPolicies({
      distributorId: req.distributorId,
      actorAccountId: actor(req),
      policies: req.body.policies,
      client: prisma,
    });
    return res.json({ success: true, policies });
  } catch (error) {
    return respondError(res, error);
  }
};

export const generateDistributorReplenishmentSuggestion = async (req, res) => {
  try {
    const suggestion = await createReplenishmentSuggestion({
      distributorId: req.distributorId,
      actorAccountId: actor(req),
      inventorySkuId: req.params.inventorySkuId,
      client: prisma,
    });
    return res.status(201).json({ success: true, suggestion });
  } catch (error) {
    return respondError(res, error);
  }
};

export const listDistributorReplenishmentHistory = async (req, res) => {
  try {
    const suggestions = await prisma.distributorReplenishmentSuggestion.findMany({
      where: { distributorId: req.distributorId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { inventorySku: { include: { product: true } } },
    });
    return res.json({ success: true, suggestions });
  } catch (error) {
    return respondError(res, error);
  }
};

export const createDistributorReplenishmentDemand = async (req, res) => {
  try {
    const transfer = await createReplenishmentDemand({
      distributorId: req.distributorId,
      suggestionId: req.params.suggestionId,
      manufacturerId: req.body.manufacturerId,
      actorAccountId: actor(req),
      client: prisma,
    });
    return res.status(201).json({ success: true, transfer });
  } catch (error) {
    return respondError(res, error);
  }
};

export const getDistributorProfitability = async (req, res) => {
  try {
    const result = await getProfitability({
      distributorId: req.distributorId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return respondError(res, error);
  }
};

export const getDistributorForecast = async (req, res) => {
  try {
    const result = await getExplainableForecast({
      distributorId: req.distributorId,
      inventorySkuId: req.query.inventorySkuId || null,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return respondError(res, error);
  }
};

export const getDistributorMonthlyStatement = async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const format = String(req.query.format || "json").toLowerCase();
    const statement = await getMonthlyStatementData({ distributorId: req.distributorId, year, month });
    if (format === "csv") {
      const header = "effectiveAt,orderId,assignmentId,serviceType,deliveryCharge,incentiveAmount,commissionAmount,otherCharges,vatAmount,payableAmount\n";
      const rows = statement.earnings.map((row) => [
        row.effectiveAt.toISOString(),
        row.orderId,
        row.assignmentId,
        row.serviceType,
        row.deliveryCharge,
        row.incentiveAmount,
        row.commissionAmount,
        row.otherCharges,
        row.vatAmount,
        row.payableAmount,
      ].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
      const csv = `${header}${rows}\n`;
      const hash = crypto.createHash("sha256").update(csv).digest("hex");
      await prisma.distributorStatementExport.upsert({
        where: { idempotencyKey: `monthly:${req.distributorId}:${year}-${month}:csv` },
        create: {
          distributorId: req.distributorId,
          periodStart: statement.period.start,
          periodEnd: statement.period.end,
          status: "GENERATED",
          documentReference: `DIST-${req.distributorId.slice(-8)}-${year}-${String(month).padStart(2, "0")}.csv`,
          documentHash: hash,
          idempotencyKey: `monthly:${req.distributorId}:${year}-${month}:csv`,
          requestedByAccountId: actor(req),
        },
        update: { status: "GENERATED", documentReference: `DIST-${req.distributorId.slice(-8)}-${year}-${String(month).padStart(2, "0")}.csv`, documentHash: hash },
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="distributor-statement-${year}-${String(month).padStart(2, "0")}.csv"`);
      return res.send(csv);
    }
    return res.json({ success: true, statement });
  } catch (error) {
    return respondError(res, error);
  }
};
