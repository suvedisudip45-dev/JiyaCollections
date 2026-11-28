import { prisma } from "../config/db.js";
import {
  acknowledgeDistributorReconciliationFinding,
  getDistributorReconciliationDashboard,
  runDistributorReconciliation,
} from "../services/distributorReconciliationService.js";

const actorContext = (req) => ({
  actorId: req.auth?.accountId || req.auth?.profileId || null,
  actorRole: req.auth?.role || "DISTRIBUTOR",
  portalSource: "distributor",
  ipAddress: req.ip || null,
  userAgent: req.get("user-agent") || null,
  correlationId: req.id || null,
});

const respondError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  message: error.statusCode ? error.message : "The distributor reconciliation operation could not be completed.",
  code: error.code || "DISTRIBUTOR_RECONCILIATION_FAILED",
});

export const getDistributorReconciliation = async (req, res) => {
  try {
    const report = await getDistributorReconciliationDashboard({
      distributorId: req.distributorId,
      filters: {
        category: req.query.category,
        severity: req.query.severity,
        state: req.query.state,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit,
        cursor: req.query.cursor,
      },
      client: prisma,
    });
    return res.json({ success: true, ...report });
  } catch (error) {
    return respondError(res, error);
  }
};

export const runDistributorReconciliationNow = async (req, res) => {
  try {
    const report = await runDistributorReconciliation({
      distributorId: req.distributorId,
      actorContext: actorContext(req),
      client: prisma,
    });
    return res.json({ success: true, ...report });
  } catch (error) {
    return respondError(res, error);
  }
};

export const acknowledgeDistributorReconciliation = async (req, res) => {
  try {
    const result = await acknowledgeDistributorReconciliationFinding({
      distributorId: req.distributorId,
      findingId: req.params.findingId,
      actorContext: actorContext(req),
      client: prisma,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return respondError(res, error);
  }
};
