import express from "express";
import {
  adminRecordDistributorRates,
  listDistributorRates,
  adminExecuteSettlement,
  listAdminDistributorSettlements,
} from "../controllers/distributorFinanceController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const adminDistributorRateRouter = express.Router();

// Rate Card Negotiation
adminDistributorRateRouter.post(
  "/",
  authenticate,
  authorize("distributor:admin_review"),
  adminRecordDistributorRates,
);
adminDistributorRateRouter.get(
  "/",
  authenticate,
  authorize("distributor:admin_list"),
  listDistributorRates,
);

export const adminDistributorFinanceRouter = express.Router();

// Settlements
adminDistributorFinanceRouter.patch(
  "/settle",
  authenticate,
  authorize("finance:payable_settle"),
  adminExecuteSettlement,
);
adminDistributorFinanceRouter.patch(
  "/settle/:id",
  authenticate,
  authorize("finance:payable_settle"),
  adminExecuteSettlement,
);
adminDistributorFinanceRouter.get(
  "/settlements",
  authenticate,
  authorize("finance:payables_read"),
  listAdminDistributorSettlements,
);

export default adminDistributorRateRouter;
