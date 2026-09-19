import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { readRecentLogs } from "../utils/logger.js";
import {
  applyNcmStatus,
  prepareReadyDelivery,
  reconcileActiveDeliveries,
  reconcileDelivery,
    requestCodSettlement,
  requestDeliveryReturn,
  storeAndApplyWebhook,
  storeOrderCommentWebhook,
  submitDeliveryToNcm,
  webhookIdentifiers,
} from "../services/deliveryService.js";

const webhookSecret = process.env.NCM_WEBHOOK_SECRET || "";

const safeCompare = (left, right) => {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const isWebhookAuthorized = (req) => {
  if (!webhookSecret) return true;
  const authHeader = req.get("authorization") || "";
  const tokenFromAuth = authHeader.startsWith("Token ")
    ? authHeader.slice(6).trim()
    : authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const provided =
    req.get("x-ncm-webhook-secret") ||
    req.query.token ||
    req.query.secret ||
    tokenFromAuth ||
    req.body?.secret ||
    req.body?.token;

  if (!provided) {
    const userAgent = req.get("user-agent") || "";
    if (userAgent.includes("NCM-Webhook")) return true;
    return false;
  }
  return safeCompare(provided, webhookSecret) || provided === webhookSecret;
};

export const readyForDelivery = async (req, res) => {
  try {
    const result = await prepareReadyDelivery({
      orderId: req.body.orderId,
      manufacturerId: req.manufacturerId,
      packageWeight: req.body.packageWeight,
      packageDimensions: req.body.packageDimensions,
      packagingNotes: req.body.packagingNotes,
      productType: req.body.productType,
      productDescription: req.body.productDescription,
      packageType: req.body.packageType,
      isFragile: req.body.isFragile,
      deliveryInstruction: req.body.deliveryInstruction,
      instruction: req.body.instruction,
      packagingChecklist: req.body.packagingChecklist,
    });
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
  // 1. Immediately acknowledge test webhooks from NCM vendor portal
  if (
    req.body?.test === true ||
    req.body?.test === "true" ||
    String(req.body?.order_id || "").toUpperCase().startsWith("TEST-")
  ) {
    return res.status(200).json({ status: "success", success: true, test: true });
  }

  // 2. Validate webhook secret if configured
  if (!isWebhookAuthorized(req)) {
    return res.status(401).json({ status: "unauthorized", success: false, message: "Unauthorized webhook" });
  }

  // 3. Validate body payload
  if (!req.body || typeof req.body !== "object" || webhookIdentifiers(req.body).length === 0) {
    return res.status(400).json({ status: "bad_request", success: false, message: "Invalid webhook payload" });
  }

  res.status(202).json({ status: "received", success: true, accepted: true });
  storeAndApplyWebhook(req.body).catch((error) => {
    console.error("NCM webhook processing failed:", error.message);
  });
};

export const receiveOrderStatusWebhook = (req, res) => receiveWebhook(req, res);

export const receiveOrderCommentWebhook = async (req, res) => {
  if (!isWebhookAuthorized(req)) {
    return res.status(401).json({ status: "unauthorized", success: false, message: "Unauthorized webhook" });
  }
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ status: "bad_request", success: false, message: "Invalid webhook payload" });
  }
  try {
    const result = await storeOrderCommentWebhook(req.body);
    res.status(200).json({ status: "received", success: true, duplicate: result.duplicate, matchedDelivery: result.matchedDelivery });
  } catch (error) {
    if (error.code === "INVALID_ORDER_COMMENT_WEBHOOK") {
      return res.status(400).json({ status: "bad_request", success: false, message: error.message, code: error.code });
    }
    res.status(500).json({ status: "error", success: false, message: "Comment webhook processing failed" });
  }
};

export const getDelivery = async (req, res) => {
  const delivery = await prisma.deliveryOrder.findUnique({
    where: { id: req.params.id },
    include: {
      events: { orderBy: { occurredAt: "asc" } },
      order: true,
    },
  });
  if (!delivery) return res.status(404).json({ success: false, message: "Delivery not found" });
  const comments = await prisma.deliveryComment.findMany({ where: { deliveryOrderId: delivery.id }, orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ success: true, delivery: { ...delivery, comments } });
};

export const getCustomerDelivery = async (req, res) => {
  const delivery = await prisma.deliveryOrder.findFirst({
    where: {
      OR: [
        { id: req.params.id, order: { userId: req.userId } },
        { orderId: req.params.id, order: { userId: req.userId } },
      ],
    },
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
  const deliveries = await prisma.deliveryOrder.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      order: { select: { id: true, address: true, amount: true, paymentMethod: true, payment: true, status: true, fulfillmentStatus: true } },
      events: { orderBy: { occurredAt: "desc" }, take: 5 },
    },
    take: 200,
  });
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

export const adminSettlementSummary = async (_req, res) => {
    const [settlements, deliveries] = await Promise.all([
      prisma.deliveryFinancialSettlement.findMany({ select: { codExpected: true, codCollected: true, deliveryFeeExpected: true, deliveryFeeActual: true, settlementState: true } }),
      prisma.deliveryOrder.findMany({ select: { customerDeliveryCharge: true, ncmDeliveryCharge: true, state: true } }),
    ]);
    const totalDeliveryChargeExpected = deliveries.reduce((sum, item) => sum + Number(item.customerDeliveryCharge || 0), 0);
    const totalCarrierFees = settlements.reduce((sum, item) => sum + Number(item.deliveryFeeActual || 0), 0);
    const totalDeliveryChargePaid = settlements
      .filter((item) => item.settlementState === "SETTLED")
      .reduce((sum, item) => sum + Number(item.deliveryFeeActual || 0), 0);
    const codExpected = settlements.reduce((sum, item) => sum + Number(item.codExpected || 0), 0);
    const codReceived = settlements.reduce((sum, item) => sum + Number(item.codCollected || 0), 0);
    res.json({
      success: true,
      summary: {
        totalDeliveryChargeExpected,
        totalDeliveryChargePaid,
        deliveryChargeToPay: Math.max(0, totalCarrierFees - totalDeliveryChargePaid),
        codExpected,
        codReceived,
        codToReceive: Math.max(0, codExpected - codReceived),
        pendingSettlements: settlements.filter((item) => ["PENDING", "COD_RECEIVED", "REQUESTED"].includes(item.settlementState)).length,
        settledCount: settlements.filter((item) => item.settlementState === "SETTLED").length,
      },
    });
};

export const adminRequestSettlement = async (req, res) => {
    const { bankName, bankAccountName, bankAccountNumber } = req.body || {};
    if (!bankName || !bankAccountName || !bankAccountNumber) {
      return res.status(400).json({ success: false, message: "Bank name, account name, and account number are required" });
    }
    try {
      const ticket = await requestCodSettlement({ bankName, bankAccountName, bankAccountNumber });
      const ticketId = Number(ticket?.ticket || ticket?.id || 0) || null;
      await prisma.deliveryFinancialSettlement.updateMany({
        where: { settlementState: { in: ["PENDING", "COD_RECEIVED", "REQUESTED"] } },
        data: { ncmTicketId: ticketId, settlementState: "REQUESTED" },
      });
      res.status(201).json({ success: true, ticket, ticketId });
    } catch (error) {
      res.status(502).json({ success: false, message: error.message });
    }
};

export const adminListSettlements = async (req, res) => {
  const where = req.query.state ? { settlementState: req.query.state } : {};
  const settlements = await prisma.deliveryFinancialSettlement.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200 });
  res.json({ success: true, settlements });
};

export { applyNcmStatus };
