import express from "express";
import {
  createCustomerReturn,
  getCustomerReturns,
  updateCustomerReturnStatus,
  createSupplierReturn,
  getSupplierReturns,
} from "../controllers/returnsController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import {
  adminDecideExchangeRequest,
  adminListExchangeRequests,
  adminRecordExchangeInspection,
  adminResolveUnknownExchange,
  adminReconcileExchange,
  adminRetryExchangeSubmission,
  customerCreateExchangeRequest,
  customerListExchangeRequests,
} from "../controllers/orderExchangeController.js";

const returnsRouter = express.Router();

returnsRouter.post("/exchange/customer", authenticate, authorize("exchange:customer_request"), customerCreateExchangeRequest);
returnsRouter.get("/exchange/customer", authenticate, authorize("exchange:customer_read"), customerListExchangeRequests);
returnsRouter.get("/exchange/admin", authenticate, authorize("exchange:admin_read"), adminListExchangeRequests);
returnsRouter.post("/exchange/admin/:id/decision", authenticate, authorize("exchange:admin_review"), adminDecideExchangeRequest);
returnsRouter.post("/exchange/admin/:id/retry-ncm", authenticate, authorize("exchange:admin_review"), adminRetryExchangeSubmission);
returnsRouter.post("/exchange/admin/:id/reconcile", authenticate, authorize("exchange:admin_reconcile"), adminReconcileExchange);
returnsRouter.post("/exchange/admin/:id/inspection", authenticate, authorize("exchange:admin_review"), adminRecordExchangeInspection);
returnsRouter.post("/exchange/admin/:id/resolve-ncm", authenticate, authorize("exchange:admin_review"), adminResolveUnknownExchange);

// Customer Returns (RMA)
returnsRouter.post("/customer/create", authenticate, authorize("returns:customer_create"), createCustomerReturn);
returnsRouter.get("/customer/list", authenticate, authorize("returns:customer_read"), getCustomerReturns);
returnsRouter.post("/customer/update-status", authenticate, authorize("returns:customer_update"), updateCustomerReturnStatus);

// Supplier Returns (Debit Notes)
returnsRouter.post("/supplier/create", authenticate, authorize("returns:supplier_create"), createSupplierReturn);
returnsRouter.get("/supplier/list", authenticate, authorize("returns:supplier_read"), getSupplierReturns);

export default returnsRouter;
