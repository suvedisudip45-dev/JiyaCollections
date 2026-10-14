import express from "express";
import {
  getAdminManufacturerFinance,
  getAdminManufacturerFinancialTransactions,
  getAdminManufacturerInventory,
} from "../controllers/adminManufacturerDetailController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const adminManufacturerDetailRouter = express.Router();

const requireAdminRole = (req, res, next) => {
  if (req.auth?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_ROLE_REQUIRED",
      message: "Only administrators can access manufacturer details.",
    });
  }
  return next();
};

adminManufacturerDetailRouter.use(authenticate, requireAdminRole);
adminManufacturerDetailRouter.get("/:id/inventory", authorize("manufacturer:admin_inventory_read"), getAdminManufacturerInventory);
adminManufacturerDetailRouter.get("/:id/finance", authorize("manufacturer:admin_finance_read"), getAdminManufacturerFinance);
adminManufacturerDetailRouter.get("/:id/finance/transactions", authorize("manufacturer:admin_finance_read"), getAdminManufacturerFinancialTransactions);

export default adminManufacturerDetailRouter;
