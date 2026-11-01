import express from "express";
import {
  getAdminDistributorExchanges,
  getAdminDistributorFinance,
  getAdminDistributorSettlementPositions,
  getAdminDistributorFinanceTransactions,
  getAdminDistributorInventory,
  getAdminDistributorProfile,
  getAdminDistributorReturns,
  getAdminDistributorLoginHistory,
  getAdminDistributorSettlements,
  listAdminDistributors,
} from "../controllers/adminDistributorDetailController.js";
import {
  collectDistributorStockReturn,
  createDistributorStockReturnRequest,
  getDistributorStockReturnAuditReportController,
  getDistributorStockReturns,
  inspectDistributorStockReturn,
  receiveDistributorStockReturn,
  reviewDistributorStockReturnDiscrepancy,
  reviewDistributorStockReturnRequest,
} from "../controllers/distributorStockReturnController.js";
import {
  getAdminDistributorCashRemittances,
  reviewDistributorCashRemittance,
  approveDistributorRefundNetting,
  reviewAdminDistributorSettlementRequest,
  recordAdminDistributorSettlementPayout,
  settleAdminDistributorBalances,
} from "../controllers/distributorFinanceController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import { secureEvidenceUpload } from "../middleware/secureUpload.js";

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
adminDistributorDetailRouter.get("/settlement-positions", authorize("finance:payables_read"), getAdminDistributorSettlementPositions);
adminDistributorDetailRouter.get("/", authorize("distributor:admin_list"), listAdminDistributors);
adminDistributorDetailRouter.get("/:id/profile", authorize("distributor:admin_detail"), getAdminDistributorProfile);
adminDistributorDetailRouter.get("/:id/login-history", authorize("distributor:admin_sessions_read"), getAdminDistributorLoginHistory);
adminDistributorDetailRouter.get("/:id/inventory", authorize("distributor:admin_inventory_read"), getAdminDistributorInventory);
adminDistributorDetailRouter.get("/:id/stock-returns", authorize("distributor:admin_inventory_read"), getDistributorStockReturns);
adminDistributorDetailRouter.get("/:id/stock-returns/:returnId/audit-report", authorize("distributor:admin_inventory_read"), getDistributorStockReturnAuditReportController);
adminDistributorDetailRouter.post("/:id/stock-returns", authorize("distributor:admin_stock_return"), createDistributorStockReturnRequest);
adminDistributorDetailRouter.patch("/:id/stock-returns/:returnId/review", authorize("distributor:admin_stock_return"), reviewDistributorStockReturnRequest);
adminDistributorDetailRouter.post("/:id/stock-returns/:returnId/collections", authorize("distributor:admin_stock_return"), collectDistributorStockReturn);
adminDistributorDetailRouter.post("/:id/stock-returns/:returnId/collections/:collectionId/receipt", authorize("distributor:admin_stock_return"), receiveDistributorStockReturn);
adminDistributorDetailRouter.post("/:id/stock-returns/:returnId/collections/:collectionId/inspection", authorize("distributor:admin_stock_return"), inspectDistributorStockReturn);
adminDistributorDetailRouter.post("/:id/stock-returns/:returnId/discrepancies/:discrepancyId/reviews", authorize("distributor:admin_stock_return"), reviewDistributorStockReturnDiscrepancy);
adminDistributorDetailRouter.get("/:id/returns", authorize("distributor:admin_returns_read"), getAdminDistributorReturns);
adminDistributorDetailRouter.get("/:id/exchanges", authorize("distributor:admin_exchanges_read"), getAdminDistributorExchanges);
adminDistributorDetailRouter.get("/:id/finance", authorize("distributor:admin_finance_read"), getAdminDistributorFinance);
adminDistributorDetailRouter.get("/:id/finance/transactions", authorize("distributor:admin_finance_read"), getAdminDistributorFinanceTransactions);
adminDistributorDetailRouter.get("/:id/finance/settlements", authorize("distributor:admin_finance_read"), getAdminDistributorSettlements);
adminDistributorDetailRouter.post(
  "/:id/finance/settlements",
  authorize("finance:receivable_collect"),
  authorize("finance:payable_settle"),
  settleAdminDistributorBalances,
);
adminDistributorDetailRouter.post(
  "/:id/finance/settlement-requests/:requestId/review",
  authorize("finance:receivable_collect"),
  reviewAdminDistributorSettlementRequest,
);
adminDistributorDetailRouter.post(
  "/:id/finance/settlement-requests/:requestId/payout",
  authorize("finance:payable_settle"),
  ...secureEvidenceUpload("evidence"),
  recordAdminDistributorSettlementPayout,
);
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
