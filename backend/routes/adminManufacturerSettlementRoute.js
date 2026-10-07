import express from "express";
import {
  listAdminManufacturerSettlements,
  payManufacturerSettlement,
} from "../controllers/manufacturerFinanceController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const adminManufacturerSettlementRouter = express.Router();

adminManufacturerSettlementRouter.get(
  "/settlements",
  authenticate,
  authorize("finance:payables_read"),
  listAdminManufacturerSettlements,
);
adminManufacturerSettlementRouter.patch(
  "/settlements/:id/pay",
  authenticate,
  authorize("finance:payable_settle"),
  payManufacturerSettlement,
);

export default adminManufacturerSettlementRouter;
