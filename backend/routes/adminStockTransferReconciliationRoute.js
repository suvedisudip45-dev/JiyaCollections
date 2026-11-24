import express from "express";
import {
  getStockTransferReconciliation,
} from "../controllers/stockTransferReconciliationController.js";
import { authenticate, authorize, requireRole } from "../middleware/unifiedAuth.js";

export const STOCK_TRANSFER_RECONCILIATION_PERMISSION = "inventory:ledger_read";

export const createAdminStockTransferReconciliationRouter = ({
  authenticateMiddleware = authenticate,
  requireAdminRole = requireRole("ADMIN"),
  authorizeMiddleware = authorize,
  controller = getStockTransferReconciliation,
} = {}) => {
  const router = express.Router();
  router.get(
    "/stock-transfer-reconciliation",
    authenticateMiddleware,
    requireAdminRole,
    authorizeMiddleware(STOCK_TRANSFER_RECONCILIATION_PERMISSION),
    controller,
  );
  return router;
};

const adminStockTransferReconciliationRouter = createAdminStockTransferReconciliationRouter();

export default adminStockTransferReconciliationRouter;
