import express from "express";
import {
  adminRecordDistributorRates,
  listDistributorRates,
  adminExecuteSettlement,
  listAdminDistributorSettlements,
} from "../controllers/distributorFinanceController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const adminDistributorRateRouter = express.Router();
const requireAdminRole = (req, res, next) => {
  if (req.auth?.role !== "ADMIN") {
    return res.status(403).json({ success: false, code: "ADMIN_ROLE_REQUIRED", message: "Only administrators can manage distributor rates." });
  }
  return next();
};

// Rate Card Negotiation
adminDistributorRateRouter.post(
  "/",
  authenticate,
  requireAdminRole,
  authorize("distributor:admin_review"),
  adminRecordDistributorRates,
);
adminDistributorRateRouter.get(
  "/",
  authenticate,
  requireAdminRole,
  authorize("distributor:admin_list"),
  listDistributorRates,
);

export const adminDistributorFinanceRouter = express.Router();

// Settlements
adminDistributorFinanceRouter.patch(
  "/settle",
  authenticate,
  requireAdminRole,
  authorize("finance:payable_settle"),
  adminExecuteSettlement,
);
adminDistributorFinanceRouter.patch(
  "/settle/:id",
  authenticate,
  requireAdminRole,
  authorize("finance:payable_settle"),
  adminExecuteSettlement,
);
adminDistributorFinanceRouter.get(
  "/settlements",
  authenticate,
  requireAdminRole,
  authorize("finance:payables_read"),
  listAdminDistributorSettlements,
);

export default adminDistributorRateRouter;
