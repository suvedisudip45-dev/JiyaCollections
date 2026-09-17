import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { readRecentLogs } from "../utils/logger.js";
import {
  applyNcmStatus,
  prepareReadyDelivery,
  reconcileActiveDeliveries,
  reconcileDelivery,
  requestDeliveryReturn,
  storeAndApplyWebhook,
  storeOrderCommentWebhook,
  submitDeliveryToNcm,
} from "../services/deliveryService.js";

const webhookSecret = process.env.NCM_WEBHOOK_SECRET || "";

const safeCompare = (left, right) => {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const readyForDelivery = async (req, res) => {
  try {
    const result = await prepareReadyDelivery({ orderId: req.body.orderId, manufacturerId: req.manufacturerId, packageWeight: req.body.packageWeight });
    if (result.alreadySubmitted) return res.json({ success: true, delivery: result.delivery, duplicate: true });
    const delivery = await submitDeliveryToNcm(result.delivery.id);
    res.status(202).json({ success: true, delivery });
  } catch (error) {
    const status = ["DELIVERY_NOT_FOUND", "DELIVERY_ASSIGNMENT_NOT_FOUND"].includes(error.code) ? 404 : 400;
    res.status(status).json({ success: false, message: error.message, code: error.code || "DELIVERY_FAILED" });
  }
};

export const readyForDeliveryByAssignment = async (req, res) => {
  const assignment = await prisma.orderAssignment.findUnique({ where: { id: req.params.id } });
  if (!assignment || assignment.manufacturerId !== req.manufacturerId) {
    return res.status(404).json({ success: false, message: "Assignment not found" });
  }
  req.body.orderId = assignment.orderId;
  return readyForDelivery(req, res);
};

export const requestReturn = async (req, res) => {
  try {
    const result = await requestDeliveryReturn({ deliveryId: req.body.deliveryId, manufacturerId: req.manufacturerId, reason: req.body.reason });
    res.json({ success: true, return: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const receiveWebhook = async (req, res) => {
  const provided = req.get("x-ncm-webhook-secret") || req.query.secret;
  if (!safeCompare(provided, webhookSecret)) return res.status(401).json({ success: false, message: "Unauthorized webhook" });
  if (!req.body || typeof req.body !== "object" || (!req.body.order_id && !Array.isArray(req.body.order_ids))) {
    return res.status(400).json({ success: false, message: "Invalid webhook payload" });
  }
  try {
    const result = await storeAndApplyWebhook(req.body);
    res.status(200).json({ success: true, duplicate: result.duplicate });
  } catch (error) {
    res.status(500).json({ success: false, message: "Webhook processing failed" });
  }
};

export const receiveOrderStatusWebhook = (req, res) => receiveWebhook(req, res);

export const receiveOrderCommentWebhook = async (req, res) => {
  const provided = req.get("x-ncm-webhook-secret") || req.query.secret;
  if (!safeCompare(provided, webhookSecret)) return res.status(401).json({ success: false, message: "Unauthorized webhook" });
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ success: false, message: "Invalid webhook payload" });
  }
  try {
    const result = await storeOrderCommentWebhook(req.body);
    res.status(200).json({ success: true, duplicate: result.duplicate, matchedDelivery: result.matchedDelivery });
  } catch (error) {
    if (error.code === "INVALID_ORDER_COMMENT_WEBHOOK") {
      return res.status(400).json({ success: false, message: error.message, code: error.code });
    }
    res.status(500).json({ success: false, message: "Comment webhook processing failed" });
  }
};

export const getDelivery = async (req, res) => {
  const delivery = await prisma.deliveryOrder.findUnique({ where: { id: req.params.id } });
  if (!delivery) return res.status(404).json({ success: false, message: "Delivery not found" });
  res.json({ success: true, delivery });
};

export const getCustomerDelivery = async (req, res) => {
  const delivery = await prisma.deliveryOrder.findFirst({
    where: { id: req.params.id, order: { userId: req.userId } },
    include: { events: { orderBy: { occurredAt: "asc" }, select: { eventType: true, toState: true, ncmStatus: true, occurredAt: true } } },
  });
  if (!delivery) return res.status(404).json({ success: false, message: "Delivery not found" });
  res.json({ success: true, delivery: { id: delivery.id, state: delivery.state, ncmStatus: delivery.ncmStatus, events: delivery.events } });
};

export const adminReconcileDelivery = async (req, res) => {
  try {
    const delivery = await reconcileDelivery(req.params.id);
    res.json({ success: true, delivery });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
};

export const adminReconcileActive = async (_req, res) => {
  try {
    const deliveries = await reconcileActiveDeliveries();
    res.json({ success: true, count: deliveries.length });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
};

export const adminListDeliveries = async (req, res) => {
  const where = {};
  if (req.query.state) where.state = req.query.state;
  if (req.query.manufacturerId) where.manufacturerId = req.query.manufacturerId;
  const deliveries = await prisma.deliveryOrder.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200 });
  res.json({ success: true, deliveries });
};

export const getRecentSystemLogs = async (_req, res) => {
  try {
    const logs = readRecentLogs(80);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "Failed to read log file" });
  }
};

export const adminListSettlements = async (req, res) => {
  const where = req.query.state ? { settlementState: req.query.state } : {};
  const settlements = await prisma.deliveryFinancialSettlement.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200 });
  res.json({ success: true, settlements });
};

export { applyNcmStatus };
