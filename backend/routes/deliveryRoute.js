import express from "express";
import {
  adminListDeliveries,
  adminListSettlements,
    adminSettlementSummary,
    adminRequestSettlement,
  adminReconcileActive,
  adminReconcileDelivery,
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
import { authenticate, authorize, setManufacturerContext } from "../middleware/unifiedAuth.js";

const deliveryRouter = express.Router();

deliveryRouter.post("/webhook/ncm", receiveOrderStatusWebhook);
deliveryRouter.post("/ncm", receiveOrderStatusWebhook);
deliveryRouter.post("/", receiveOrderStatusWebhook);
deliveryRouter.post("/webhook/ncm/order-status", receiveOrderStatusWebhook);
deliveryRouter.post("/webhook/ncm/order-comment", receiveOrderCommentWebhook);
deliveryRouter.post("/ncm-webhook", receiveOrderStatusWebhook);
deliveryRouter.post("/webhook", receiveOrderStatusWebhook);
deliveryRouter.post("/manufacturer/ready", authenticate, authorize("manufacturer:delivery_ready"), setManufacturerContext, readyForDelivery);
deliveryRouter.post("/job/ready/:id", authenticate, authorize("manufacturer:delivery_ready"), setManufacturerContext, readyForDeliveryByAssignment);
deliveryRouter.post("/job/ready-for-pickup/:id", authenticate, authorize("manufacturer:delivery_ready"), setManufacturerContext, readyForDeliveryByAssignment);
deliveryRouter.post("/ready/:id", authenticate, authorize("manufacturer:delivery_ready"), setManufacturerContext, readyForDeliveryByAssignment);
deliveryRouter.post("/ready-for-pickup/:id", authenticate, authorize("manufacturer:delivery_ready"), setManufacturerContext, readyForDeliveryByAssignment);
deliveryRouter.post("/manufacturer/return", authenticate, authorize("manufacturer:delivery_return"), setManufacturerContext, requestReturn);
deliveryRouter.get("/customer/:id", authenticate, authorize("customer:delivery_read"), getCustomerDelivery);
deliveryRouter.get("/admin", authenticate, authorize("delivery:admin_list"), adminListDeliveries);
deliveryRouter.get("/admin/settlements", authenticate, authorize("delivery:settlements_read"), adminListSettlements);
deliveryRouter.get("/admin/settlements/summary", authenticate, authorize("delivery:settlement_summary"), adminSettlementSummary);
deliveryRouter.post("/admin/settlements/request", authenticate, authorize("delivery:settlement_request"), adminRequestSettlement);
deliveryRouter.get("/admin/logs", authenticate, authorize("delivery:logs_read"), getRecentSystemLogs);
deliveryRouter.get("/admin/:id", authenticate, authorize("delivery:admin_detail"), getDelivery);
deliveryRouter.post("/admin/:id/reconcile", authenticate, authorize("delivery:reconcile"), adminReconcileDelivery);
deliveryRouter.post("/admin/reconcile-active", authenticate, authorize("delivery:reconcile"), adminReconcileActive);

export default deliveryRouter;
