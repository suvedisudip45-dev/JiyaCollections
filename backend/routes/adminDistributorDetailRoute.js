import express from "express";
import {
  getAdminDistributorExchanges,
  getAdminDistributorFinance,
  getAdminDistributorFinanceTransactions,
  getAdminDistributorInventory,
  getAdminDistributorProfile,
  getAdminDistributorReturns,
  getAdminDistributorLoginHistory,
  getAdminDistributorSettlements,
  listAdminDistributors,
} from "../controllers/adminDistributorDetailController.js";
import {
  getAdminDistributorCashRemittances,
  reviewDistributorCashRemittance,
  approveDistributorRefundNetting,
} from "../controllers/distributorFinanceController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const adminDistributorDetailRouter = express.Router();

const requireAdminRole = (req, res, next) => {
  if (req.auth?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_ROLE_REQUIRED",
      message: "Only administrators can access distributor records.",
    });
  }
  return next();
};

adminDistributorDetailRouter.use(authenticate, requireAdminRole);
adminDistributorDetailRouter.get("/", authorize("distributor:admin_list"), listAdminDistributors);
adminDistributorDetailRouter.get("/:id/profile", authorize("distributor:admin_detail"), getAdminDistributorProfile);
adminDistributorDetailRouter.get("/:id/login-history", authorize("distributor:admin_sessions_read"), getAdminDistributorLoginHistory);
adminDistributorDetailRouter.get("/:id/inventory", authorize("distributor:admin_inventory_read"), getAdminDistributorInventory);
adminDistributorDetailRouter.get("/:id/returns", authorize("distributor:admin_returns_read"), getAdminDistributorReturns);
adminDistributorDetailRouter.get("/:id/exchanges", authorize("distributor:admin_exchanges_read"), getAdminDistributorExchanges);
adminDistributorDetailRouter.get("/:id/finance", authorize("distributor:admin_finance_read"), getAdminDistributorFinance);
adminDistributorDetailRouter.get("/:id/finance/transactions", authorize("distributor:admin_finance_read"), getAdminDistributorFinanceTransactions);
adminDistributorDetailRouter.get("/:id/finance/settlements", authorize("distributor:admin_finance_read"), getAdminDistributorSettlements);
adminDistributorDetailRouter.get(
  "/:id/finance/remittances",
  authorize("distributor:admin_finance_read"),
  getAdminDistributorCashRemittances,
);
adminDistributorDetailRouter.post(
  "/:id/finance/remittances/:batchId/review",
  authorize("finance:receivable_collect"),
  reviewDistributorCashRemittance,
);
adminDistributorDetailRouter.post(
  "/:id/finance/refund-netting",
  authorize("finance:receivable_collect"),
  approveDistributorRefundNetting,
);

export default adminDistributorDetailRouter;
