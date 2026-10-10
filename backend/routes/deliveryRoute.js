import express from "express";
import {
  adminConfirmSettlement,
  adminListDeliveries,
  adminRequestNcmDeliveryByAssignment,
  adminListSettlements,
  adminSettlementSummary,
  adminRequestSettlement,
  adminReconcileActive,
  adminReconcileDelivery,
  adminResolveNcmHandoff,
  getCustomerDelivery,
  getDelivery,
  getRecentSystemLogs,
  readyForDelivery,
  readyForDeliveryByAssignment,
  receiveWebhook,
  receiveOrderCommentWebhook,
  receiveOrderStatusWebhook,
  requestReturn,
} from "../controllers/deliveryController.js";
import {
  authenticate,
  authorize,
  authorizeAny,
  setManufacturerContext,
  setFulfillmentContext,
} from "../middleware/unifiedAuth.js";

const deliveryRouter = express.Router();

deliveryRouter.post("/webhook/ncm", receiveOrderStatusWebhook);
deliveryRouter.post("/ncm", receiveOrderStatusWebhook);
deliveryRouter.post("/", receiveOrderStatusWebhook);
deliveryRouter.post("/webhook/ncm/order-status", receiveOrderStatusWebhook);
deliveryRouter.post("/webhook/ncm/order-comment", receiveOrderCommentWebhook);
deliveryRouter.post("/ncm-webhook", receiveOrderStatusWebhook);
deliveryRouter.post("/webhook", receiveOrderStatusWebhook);
deliveryRouter.post("/manufacturer/ready", authenticate, authorizeAny("distributor:delivery_ready", "manufacturer:delivery_ready"), setFulfillmentContext, readyForDelivery);
deliveryRouter.post("/job/ready/:id", authenticate, authorizeAny("distributor:delivery_ready", "manufacturer:delivery_ready"), setFulfillmentContext, readyForDeliveryByAssignment);
deliveryRouter.post("/job/ready-for-pickup/:id", authenticate, authorizeAny("distributor:delivery_ready", "manufacturer:delivery_ready"), setFulfillmentContext, readyForDeliveryByAssignment);
deliveryRouter.post("/ready/:id", authenticate, authorizeAny("distributor:delivery_ready", "manufacturer:delivery_ready"), setFulfillmentContext, readyForDeliveryByAssignment);
deliveryRouter.post("/ready-for-pickup/:id", authenticate, authorizeAny("distributor:delivery_ready", "manufacturer:delivery_ready"), setFulfillmentContext, readyForDeliveryByAssignment);
deliveryRouter.post("/manufacturer/return", authenticate, authorizeAny("distributor:delivery_return", "manufacturer:delivery_return"), setFulfillmentContext, requestReturn);
deliveryRouter.get("/customer/:id", authenticate, authorize("customer:delivery_read"), getCustomerDelivery);
deliveryRouter.get("/admin", authenticate, authorize("delivery:admin_list"), adminListDeliveries);
deliveryRouter.post("/admin/assignment/:id/ncm", authenticate, authorize("assignment:admin_list"), adminRequestNcmDeliveryByAssignment);
deliveryRouter.get("/admin/settlements", authenticate, authorize("delivery:settlements_read"), adminListSettlements);
deliveryRouter.get("/admin/settlements/summary", authenticate, authorize("delivery:settlement_summary"), adminSettlementSummary);
deliveryRouter.post("/admin/settlements/request", authenticate, authorize("delivery:settlement_request"), adminRequestSettlement);
deliveryRouter.post("/admin/settlements/confirm", authenticate, authorize("delivery:settlement_request"), adminConfirmSettlement);
deliveryRouter.get("/admin/logs", authenticate, authorize("delivery:logs_read"), getRecentSystemLogs);
deliveryRouter.get("/admin/:id", authenticate, authorize("delivery:admin_detail"), getDelivery);
deliveryRouter.post("/admin/:id/reconcile", authenticate, authorize("delivery:reconcile"), adminReconcileDelivery);
deliveryRouter.post("/admin/:id/resolve-ncm-handoff", authenticate, authorize("delivery:ncm_handoff_recover"), adminResolveNcmHandoff);
deliveryRouter.post("/admin/reconcile-active", authenticate, authorize("delivery:reconcile"), adminReconcileActive);


export default deliveryRouter;
