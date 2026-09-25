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
import { authAdmin } from "../middleware/auth.js";

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
deliveryRouter.get("/admin", authAdmin, adminListDeliveries);
deliveryRouter.get("/admin/settlements", authAdmin, adminListSettlements);
deliveryRouter.get("/admin/settlements/summary", authAdmin, adminSettlementSummary);
deliveryRouter.post("/admin/settlements/request", authAdmin, adminRequestSettlement);
deliveryRouter.get("/admin/logs", authAdmin, getRecentSystemLogs);
deliveryRouter.get("/admin/:id", authAdmin, getDelivery);
deliveryRouter.post("/admin/:id/reconcile", authAdmin, adminReconcileDelivery);
deliveryRouter.post("/admin/reconcile-active", authAdmin, adminReconcileActive);

export default deliveryRouter;
