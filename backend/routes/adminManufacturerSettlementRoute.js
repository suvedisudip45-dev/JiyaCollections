import express from "express";
import {
  listAdminManufacturerSettlements,
  payManufacturerSettlement,
} from "../controllers/manufacturerFinanceController.js";
import { authenticate, authorize, authorizeAny } from "../middleware/unifiedAuth.js";

const adminManufacturerSettlementRouter = express.Router();
const requireAdminRole = (req, res, next) => {
  if (req.auth?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_ROLE_REQUIRED",
      message: "Only administrators can access manufacturer settlements.",
    });
  }
  return next();
};

adminManufacturerSettlementRouter.get(
  "/settlements",
  authenticate,
  requireAdminRole,
  authorizeAny("finance:payables_read", "manufacturer:admin_settlements_read"),
  listAdminManufacturerSettlements,
);
adminManufacturerSettlementRouter.patch(
  "/settlements/:id/pay",
  authenticate,
  requireAdminRole,
  authorize("finance:payable_settle"),
  payManufacturerSettlement,
);

export default adminManufacturerSettlementRouter;
