import { authenticate, authorize, setManufacturerContext } from "../middleware/unifiedAuth.js";
import express from "express";
import {
  getCustomerReturns,
  createSupplierReturn,
  getSupplierReturns,
} from "../controllers/returnsController.js";
import {
  adminCompleteReturnRefund,
  adminCreateReturnRequest,
  adminDecideReturnRequest,
  adminInspectReturn,
  adminListReturnRequests,
  adminRetryReturnSubmission,
  adminResolveUnknownReturn,
  customerCreateReturnRequest,
  customerListReturnRequests,
  manufacturerListReturnRequests,
} from "../controllers/customerReturnWorkflowController.js";
import {
  adminDecideExchangeRequest,
  adminCreateExchangeRequest,
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
returnsRouter.post("/exchange/admin", authenticate, authorize("exchange:admin_create"), adminCreateExchangeRequest);
returnsRouter.post("/exchange/admin/:id/decision", authenticate, authorize("exchange:admin_review"), adminDecideExchangeRequest);
returnsRouter.post("/exchange/admin/:id/retry-ncm", authenticate, authorize("exchange:admin_review"), adminRetryExchangeSubmission);
returnsRouter.post("/exchange/admin/:id/reconcile", authenticate, authorize("exchange:admin_reconcile"), adminReconcileExchange);
returnsRouter.post("/exchange/admin/:id/inspection", authenticate, authorize("exchange:admin_review"), adminRecordExchangeInspection);
returnsRouter.post("/exchange/admin/:id/resolve-ncm", authenticate, authorize("exchange:admin_review"), adminResolveUnknownExchange);

// Customer Returns (RMA)
returnsRouter.post("/customer/request", authenticate, authorize("returns:customer_create"), customerCreateReturnRequest);
returnsRouter.get("/customer/requests", authenticate, authorize("returns:customer_read"), customerListReturnRequests);
returnsRouter.get("/customer/manufacturer", authenticate, authorize("manufacturer:delivery_return"), setManufacturerContext, manufacturerListReturnRequests);
returnsRouter.get("/customer/list", authenticate, authorize("returns:admin_read"), getCustomerReturns);
returnsRouter.post("/customer/create", authenticate, authorize("returns:admin_create"), adminCreateReturnRequest);
returnsRouter.get("/customer/admin/requests", authenticate, authorize("returns:admin_read"), adminListReturnRequests);
returnsRouter.post("/customer/admin/:id/decision", authenticate, authorize("returns:admin_review"), adminDecideReturnRequest);
returnsRouter.post("/customer/admin/:id/retry-ncm", authenticate, authorize("returns:admin_review"), adminRetryReturnSubmission);
returnsRouter.post("/customer/admin/:id/resolve-ncm", authenticate, authorize("returns:admin_review"), adminResolveUnknownReturn);
returnsRouter.post("/customer/admin/:id/inspection", authenticate, authorize("returns:admin_inspect"), adminInspectReturn);
returnsRouter.post("/customer/admin/:id/refunded", authenticate, authorize("returns:admin_refund"), adminCompleteReturnRefund);

// Supplier Returns (Debit Notes)
returnsRouter.post("/supplier/create", authenticate, authorize("returns:supplier_create"), createSupplierReturn);
returnsRouter.get("/supplier/list", authenticate, authorize("returns:supplier_read"), getSupplierReturns);

export default returnsRouter;
