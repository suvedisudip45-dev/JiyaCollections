import express from "express";
import {
  createCustomerReturn,
  getCustomerReturns,
  updateCustomerReturnStatus,
  createSupplierReturn,
  getSupplierReturns,
} from "../controllers/returnsController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const returnsRouter = express.Router();

// Customer Returns (RMA)
returnsRouter.post("/customer/create", authenticate, authorize("returns:customer_create"), createCustomerReturn);
returnsRouter.get("/customer/list", authenticate, authorize("returns:customer_read"), getCustomerReturns);
returnsRouter.post("/customer/update-status", authenticate, authorize("returns:customer_update"), updateCustomerReturnStatus);

// Supplier Returns (Debit Notes)
returnsRouter.post("/supplier/create", authenticate, authorize("returns:supplier_create"), createSupplierReturn);
returnsRouter.get("/supplier/list", authenticate, authorize("returns:supplier_read"), getSupplierReturns);

export default returnsRouter;
