import express from "express";
import {
  adminListDeliveries,
  adminListSettlements,
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
import authUser from "../middleware/auth.js";
import authManufacturer from "../middleware/manufacturerAuth.js";
import { authAdmin } from "../middleware/auth.js";

const deliveryRouter = express.Router();

deliveryRouter.post("/webhook/ncm", receiveOrderStatusWebhook);
deliveryRouter.post("/webhook/ncm/order-status", receiveOrderStatusWebhook);
deliveryRouter.post("/webhook/ncm/order-comment", receiveOrderCommentWebhook);
deliveryRouter.post("/manufacturer/ready", authManufacturer, readyForDelivery);
deliveryRouter.post("/job/ready/:id", authManufacturer, readyForDeliveryByAssignment);
deliveryRouter.post("/job/ready-for-pickup/:id", authManufacturer, readyForDeliveryByAssignment);
deliveryRouter.post("/ready/:id", authManufacturer, readyForDeliveryByAssignment);
deliveryRouter.post("/ready-for-pickup/:id", authManufacturer, readyForDeliveryByAssignment);
deliveryRouter.post("/manufacturer/return", authManufacturer, requestReturn);
deliveryRouter.get("/customer/:id", authUser, getCustomerDelivery);
deliveryRouter.get("/admin", authAdmin, adminListDeliveries);
deliveryRouter.get("/admin/settlements", authAdmin, adminListSettlements);
deliveryRouter.get("/admin/logs", authAdmin, getRecentSystemLogs);
deliveryRouter.get("/admin/:id", authAdmin, getDelivery);
deliveryRouter.post("/admin/:id/reconcile", authAdmin, adminReconcileDelivery);
deliveryRouter.post("/admin/reconcile-active", authAdmin, adminReconcileActive);

export default deliveryRouter;
