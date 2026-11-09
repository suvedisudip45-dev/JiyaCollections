import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { saveNcmSupportTicket } from "../services/ncmSupportTicketService.js";
import { readRecentLogs } from "../utils/logger.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
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
  validateNcmWebhookPayload,
} from "../services/deliveryService.js";
import {
  confirmNcmSettlementBatch,
  listNcmSettlementBatches,
  listNcmSettlementCandidates,
  resolveNcmSettlementVariance,
  validateNcmSettlementSelection,
} from "../services/ncmSettlementService.js";
import { applyNcmStockTransferWebhook } from "./stockTransferController.js";
import { validateCodTransferBankDetails } from "../services/ncmClient.js";


const webhookSecret = process.env.NCM_WEBHOOK_SECRET || "";

const findNcmSimulationOrderMatch = async (numericOrderId) => {
  const stringOrderId = String(numericOrderId);
  const [delivery, stockTransfer, customerReturn, exchange] = await Promise.all([
    prisma.deliveryOrder.findFirst({
      where: {
        OR: [
          { ncmOrderId: numericOrderId },
          { vendorReference: stringOrderId },
          { orderId: stringOrderId },
          { id: stringOrderId },
        ],
      },
      select: { id: true },
    }),
    prisma.stockTransferShipment.findFirst({
      where: {
        bookingMode: "NCM",
        OR: [{ ncmOrderId: stringOrderId }, { externalReference: stringOrderId }],
      },
      select: { id: true },
    }),
    prisma.customerReturn.findFirst({
      where: { OR: [{ originalNcmOrderId: numericOrderId }, { ncmReturnOrderId: numericOrderId }] },
      select: { id: true },
    }),
    prisma.orderExchangeRequest.findFirst({
      where: { OR: [{ ncmReturnOrderId: numericOrderId }, { ncmReplacementOrderId: numericOrderId }] },
      select: { id: true },
    }),
  ]);
  return delivery || stockTransfer || customerReturn || exchange;
};

export const getNcmSettlementFailureMessage = (error, submittedBankDetails) => {
  const response = error?.response;
  const providerHttpError = /^NCM_HTTP_\d{3}$/.test(String(error?.code || ""));
  if (!providerHttpError) {
    return error?.message || "Failed to request NCM COD settlement.";
  }

  const readProviderMessage = (value) => {
    if (Array.isArray(value)) {
      const messages = value.map(readProviderMessage).filter(Boolean);
      return messages.length ? messages.join(" ") : null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") return readProviderMessage(parsed);
      } catch {
        return trimmed;
      }
      return trimmed;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    for (const key of ["message", "detail", "error", "errors", "non_field_errors"]) {
      if (value[key] !== undefined) {
        const message = readProviderMessage(value[key]);
        if (message) return message;
      }
    }
    const fieldErrors = Object.entries(value)
      .filter(([key]) => /^(bank_?name|bank_?account_?name|bank_?account_?number)$/i.test(key))
      .map(([key, fieldMessage]) => `${key.replace(/([A-Z])/g, " $1")}: ${readProviderMessage(fieldMessage) || "Invalid value"}`);
    return fieldErrors.length ? fieldErrors.join(" ") : null;
  };

  if (!/^NCM_HTTP_4\d\d$/.test(String(error.code || ""))) {
    return "NCM is temporarily unavailable. Please try again later.";
  }

  const allowedFields = /^(detail|message|error|errors|non_field_errors|bank_?name|bank_?account_?name|bank_?account_?number)$/i;
  let details = response;
  if (typeof details === "string") {
    try {
      details = JSON.parse(details);
    } catch {
      details = { message: details };
    }
  }
  if (response && typeof response === "object" && !Array.isArray(response)) {
    details = Object.fromEntries(
      Object.entries(response).filter(([key]) => allowedFields.test(key)),
    );
    if (!Object.keys(details).length) details = null;
  }

  let message = readProviderMessage(details)
    || "NCM rejected the COD transfer request. Check the bank details or contact NCM support.";
  const valuesToRedact = [
    ...Object.values(submittedBankDetails || {}),
    process.env.NCM_API_TOKEN,
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const value of valuesToRedact) {
    message = message.split(value).join("[REDACTED]");
  }
  return message.slice(0, 1200);
};

const safeCompare = (left, right) => {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const isWebhookAuthorized = (req) => {
  if (!webhookSecret) return process.env.NODE_ENV !== "production";
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

  return safeCompare(provided, webhookSecret);
};

export const readyForDelivery = async (req, res) => {
  try {
    const result = await prepareReadyDelivery({
      orderId: req.body.orderId,
      distributorId: req.distributorId,
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
    const status = ["DELIVERY_NOT_FOUND", "DELIVERY_ASSIGNMENT_NOT_FOUND"].includes(error.code)
      ? 404
      : error.code === "DELIVERY_METHOD_CHANGED"
        ? 409
        : 400;
    const userMessage = typeof error.code === "string" && error.code.startsWith("NCM_") || error.code === "NCM_SUBMISSION_UNKNOWN"
      ? `Failed to book courier. ${error.message}`
      : error.message;
    res.status(status).json({ success: false, message: userMessage, code: error.code || "DELIVERY_FAILED" });
  }
};

export const readyForDeliveryByAssignment = async (req, res) => {
  const assignment = await prisma.orderAssignment.findUnique({ where: { id: req.params.id } });
  const isOwner =
    (req.distributorId && assignment?.distributorId === req.distributorId) ||
    (req.manufacturerId && assignment?.manufacturerId === req.manufacturerId) ||
    req.adminId;

  if (!assignment || !isOwner) {
    return res.status(404).json({ success: false, message: "Assignment not found" });
  }
  req.body.orderId = assignment.orderId;
  return readyForDelivery(req, res);
};

export const adminRequestNcmDeliveryByAssignment = async (req, res) => {
  try {
    const assignment = await prisma.orderAssignment.findUnique({ where: { id: req.params.id } });
    if (!assignment) return res.status(404).json({ success: false, message: "Assignment not found" });
    const result = await prepareReadyDelivery({
      orderId: assignment.orderId,
      adminId: req.adminId,
      packageWeight: req.body.packageWeight,
      packageDimensions: req.body.packageDimensions,
      packagingNotes: req.body.packagingNotes,
      productType: req.body.productType,
      productDescription: req.body.productDescription,
      packageType: req.body.packageType,
      isFragile: req.body.isFragile,
      deliveryInstruction: req.body.deliveryInstruction,
      instruction: req.body.instruction,
    });
    if (result.alreadySubmitted) {
      return res.json({ success: true, delivery: result.delivery, duplicate: true });
    }
    const delivery = await submitDeliveryToNcm(result.delivery.id);
    return res.status(202).json({ success: true, delivery });
  } catch (error) {
    const status = ["DELIVERY_NOT_FOUND", "DELIVERY_ASSIGNMENT_NOT_FOUND"].includes(error.code)
      ? 404
      : error.code === "DELIVERY_METHOD_CHANGED"
        ? 409
        : 400;
    const userMessage = typeof error.code === "string" && error.code.startsWith("NCM_") || error.code === "NCM_SUBMISSION_UNKNOWN"
      ? `Failed to book courier. ${error.message}`
      : error.message;
    return res.status(status).json({ success: false, message: userMessage, code: error.code || "DELIVERY_FAILED" });
  }
};

export const requestReturn = async (req, res) => {
  try {
    const result = await requestDeliveryReturn({ deliveryId: req.body.deliveryId, manufacturerId: req.manufacturerId, distributorId: req.distributorId, reason: req.body.reason });
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
  const validation = validateNcmWebhookPayload(req.body);
  if (!validation.valid) {
    const status = validation.statusCode || 400;
    return res.status(status).json({
      status: status === 413 ? "payload_too_large" : "bad_request",
      success: false,
      message: validation.message,
    });
  }

  try {
    const result = await storeAndApplyWebhook(req.body, { onStockTransferStatus: applyNcmStockTransferWebhook });
    const matchedIdentifiers = new Set((result.updated || []).map((entry) => entry.ncmId));
    const ambiguousIdentifiers = new Set((result.updated || [])
      .filter((entry) => entry.ambiguous)
      .map((entry) => entry.ncmId));
    return res.status(200).json({
      status: "received",
      success: true,
      accepted: true,
      duplicate: result.duplicate,
      updates: result.updated,
      ambiguousOrderIds: [...ambiguousIdentifiers],
      invalidOrderIdCount: validation.invalidIdentifierCount,
      unmatchedOrderIds: validation.identifiers.filter((identifier) =>
        !matchedIdentifiers.has(identifier) && !ambiguousIdentifiers.has(identifier)),
    });
  } catch (error) {
    console.error("NCM webhook processing failed:", error.message);
    return res.status(500).json({ status: "error", success: false, message: "Webhook status could not be saved. NCM may retry." });
  }
};

export const receiveOrderStatusWebhook = (req, res) => receiveWebhook(req, res);

export const adminSimulateNcmWebhook = async (req, res) => {
  const simulatorEnabled = process.env.NCM_WEBHOOK_SIMULATOR_ENABLED === "true";
  const isProduction = process.env.NODE_ENV === "production" && process.env.APP_ENV !== "staging";
  if (!simulatorEnabled || isProduction) {
    return res.status(404).json({ success: false, message: "NCM webhook simulation is disabled." });
  }

  const { type, payload } = req.body || {};
  if (type === "status") {
    const validation = validateNcmWebhookPayload(payload);
    if (!validation.valid) {
      return res.status(validation.statusCode || 400).json({
        success: false,
        message: validation.message,
      });
    }
    if (validation.identifiers.length !== 1 || !/^\d+$/.test(validation.identifiers[0])) {
      return res.status(400).json({ success: false, message: "Simulation requires exactly one numeric NCM order ID." });
    }

    try {
      const numericOrderId = Number(validation.identifiers[0]);
      if (await findNcmSimulationOrderMatch(numericOrderId)) {
        return res.status(409).json({
          success: false,
          message: "Simulation is restricted to unmatched test order IDs and cannot alter a linked delivery, transfer, return, or exchange.",
        });
      }
      const result = await storeAndApplyWebhook(payload, {
        onStockTransferStatus: applyNcmStockTransferWebhook,
        source: "ADMIN_WEBHOOK_SIMULATION",
        actorId: req.auth?.accountId || null,
      });
      return res.json({
        success: true,
        simulated: true,
        duplicate: result.duplicate,
        updates: result.updated,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Unable to apply simulated NCM status.",
      });
    }
  }

  if (type === "comment") {
    const commentPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const orderId = Number(commentPayload.order_id ?? commentPayload.orderid ?? commentPayload.id);
    const rawComment = commentPayload.comments ?? commentPayload.comment ?? commentPayload.message;
    const comments = typeof rawComment === "string" ? rawComment.trim() : "";
    if (!Number.isSafeInteger(orderId) || orderId <= 0 || !comments || comments.length > 2000) {
      return res.status(400).json({ success: false, message: "Simulation requires a numeric order ID and comment of 1–2000 characters." });
    }
    try {
      if (await findNcmSimulationOrderMatch(orderId)) {
        return res.status(409).json({
          success: false,
          message: "Simulation is restricted to unmatched test order IDs and cannot alter a linked delivery, transfer, return, or exchange.",
        });
      }
      const result = await storeOrderCommentWebhook({
        ...commentPayload,
        order_id: orderId,
        comments,
        addedBy: "ADMIN_WEBHOOK_SIMULATION",
      });
      return res.json({ success: true, simulated: true, duplicate: result.duplicate, matchedDelivery: result.matchedDelivery });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Unable to store simulated NCM comment.",
      });
    }
  }

  return res.status(400).json({ success: false, message: "Simulation type must be status or comment." });
};

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
    const delivery = await reconcileDelivery(req.params.id, { actorId: req.auth?.accountId || null });
    res.json({ success: true, delivery });
  } catch (error) {
    res.status(error.code === "DELIVERY_NOT_FOUND" ? 404 : 502).json({
      success: false,
      code: error.code || "NCM_RECONCILIATION_FAILED",
      message: error.message,
    });
  }
};

export const adminResolveNcmDeliveryReconciliation = async (req, res) => {
  const decision = String(req.body?.decision || "").trim().toUpperCase();
  const note = String(req.body?.note || "").trim();
  if (!["CONFIRM_DELIVERED", "CONFIRM_NOT_DELIVERED"].includes(decision) || note.length < 10 || note.length > 2000) {
    return res.status(400).json({
      success: false,
      code: "INVALID_NCM_RECONCILIATION_DECISION",
      message: "Choose a resolution and provide an investigation note between 10 and 2000 characters.",
    });
  }

  try {
    const delivery = await prisma.deliveryOrder.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        orderId: true,
        ncmOrderId: true,
        state: true,
        deliveredAt: true,
        ncmReconciliationRequired: true,
      },
    });
    if (!delivery) return res.status(404).json({ success: false, message: "Delivery not found." });
    if (!delivery.ncmReconciliationRequired) {
      return res.status(409).json({ success: false, message: "This delivery is no longer awaiting NCM reconciliation." });
    }
    if (decision === "CONFIRM_NOT_DELIVERED" && (delivery.state === "DELIVERED" || delivery.deliveredAt)) {
      return res.status(409).json({
        success: false,
        message: "A delivery already recorded as delivered cannot be marked not delivered here; use the return workflow if appropriate.",
      });
    }

    const actorId = req.auth?.accountId || null;
    if (decision === "CONFIRM_DELIVERED") {
      await applyNcmStatus({
        payload: {
          order_id: String(delivery.ncmOrderId || delivery.id),
          status: "Delivered",
          event: "ADMIN_CONFIRMED_DELIVERY",
          timestamp: new Date().toISOString(),
          resolution_note: note,
        },
        source: "ADMIN_RECONCILIATION_DECISION",
        actorId,
      });
    } else {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        const current = await tx.deliveryOrder.findUnique({ where: { id: delivery.id } });
        if (!current?.ncmReconciliationRequired) {
          throw Object.assign(new Error("This delivery is no longer awaiting NCM reconciliation."), { statusCode: 409 });
        }
        if (current.state === "DELIVERED" || current.deliveredAt) {
          throw Object.assign(new Error("A delivery already recorded as delivered cannot be marked not delivered here."), { statusCode: 409 });
        }
        await tx.deliveryOrder.update({
          where: { id: delivery.id },
          data: {
            ncmReconciliationRequired: false,
            ncmReconciliationReason: null,
            lastSyncError: null,
            lastSyncedAt: now,
          },
        });
        await tx.deliveryEvent.create({
          data: {
            deliveryOrderId: delivery.id,
            orderId: delivery.orderId,
            source: "ADMIN",
            eventType: "NCM_RECONCILIATION_CONFIRMED_NOT_DELIVERED",
            fromState: current.state,
            toState: current.state,
            ncmStatus: current.ncmStatus,
            payloadJson: { decision, note },
            actorId,
            occurredAt: now,
            idempotencyKey: `NCM_RECONCILIATION_DECISION:${delivery.id}:${crypto.randomUUID()}`,
          },
        });
      });
    }

    return res.json({
      success: true,
      decision,
      delivery: await prisma.deliveryOrder.findUnique({
        where: { id: delivery.id },
        include: { events: { orderBy: { occurredAt: "desc" }, take: 100 } },
      }),
    });
  } catch (error) {
    const status = error.statusCode || (error.code === "DELIVERY_NOT_FOUND" ? 404 : 500);
    return res.status(status).json({
      success: false,
      code: error.code || "NCM_RECONCILIATION_DECISION_FAILED",
      message: error.message || "Unable to record the reconciliation decision.",
    });
  }
};

export const adminReconcileActive = async (req, res) => {
  const afterId = req.query.afterId;
  if (afterId !== undefined && (typeof afterId !== "string" || !afterId.trim() || afterId.length > 191)) {
    return res.status(400).json({ success: false, message: "afterId must be a non-empty delivery ID of at most 191 characters." });
  }
  try {
    const result = await reconcileActiveDeliveries({
      actorId: req.auth?.accountId || null,
      afterId: afterId?.trim() || null,
    });
    res.status(result.failedCount > 0 ? 207 : 200).json({ success: result.failedCount === 0, ...result });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
};

export const adminResolveNcmHandoff = async (req, res) => {
  const { outcome, ncmOrderId, reason } = req.body || {};
  const normalizedOutcome = String(outcome || "").trim().toUpperCase();
  const resolutionReason = String(reason || "").trim();
  const numericNcmOrderId = Number(ncmOrderId);
  if (!["CREATED", "NOT_CREATED"].includes(normalizedOutcome) || resolutionReason.length < 5 ||
    (normalizedOutcome === "CREATED" && (!Number.isInteger(numericNcmOrderId) || numericNcmOrderId <= 0))) {
    return res.status(400).json({ success: false, message: "Choose a verified NCM outcome and provide investigation notes." });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const delivery = await tx.deliveryOrder.findUnique({ where: { id: req.params.id } });
      if (!delivery) return { error: "Delivery not found", status: 404 };
      if (!["NCM_SUBMISSION_STARTED", "SUBMISSION_FAILED"].includes(delivery.state) || delivery.ncmOrderId) {
        return { error: "This delivery is not awaiting an NCM handoff resolution", status: 409 };
      }
      const attempt = await tx.ncmRequestAttempt.findFirst({
        where: { deliveryOrderId: delivery.id, operation: "CREATE_ORDER" },
        orderBy: { attemptNumber: "desc" },
      });
      if (!attempt || !["STARTED", "UNKNOWN", "FAILED"].includes(attempt.result)) {
        return { error: "No unresolved NCM create attempt exists for this delivery", status: 409 };
      }
      if (attempt.result === "STARTED" && Date.now() - attempt.startedAt.getTime() < 120000) {
        return { error: "The NCM create request may still be in progress. Wait two minutes before resolving it manually.", status: 409 };
      }

      if (normalizedOutcome === "CREATED") {
        const claim = await tx.deliveryOrder.updateMany({
          where: { id: delivery.id, state: delivery.state, ncmOrderId: null },
          data: {
            state: "NCM_CREATED",
            ncmOrderId: numericNcmOrderId,
            ncmStatus: "Pickup Order Created",
            ncmCreatedAt: new Date(),
            lastSyncError: null,
          },
        });
        if (claim.count !== 1) return { error: "Delivery changed during resolution", status: 409 };
        await tx.order.update({
          where: { id: delivery.orderId },
          data: { fulfillmentStatus: "ncm_created", deliveryJobId: delivery.id },
        });
        await tx.ncmRequestAttempt.update({
          where: { id: attempt.id },
          data: {
            result: "SUCCESS",
            httpStatus: 200,
            responseJson: { orderid: numericNcmOrderId, resolvedByAdminId: req.adminId, resolutionReason },
            errorCode: null,
            errorMessage: null,
            finishedAt: new Date(),
          },
        });
      } else {
        const claim = await tx.deliveryOrder.updateMany({
          where: { id: delivery.id, state: delivery.state, ncmOrderId: null },
          data: { state: "SUBMISSION_FAILED", lastSyncError: resolutionReason },
        });
        if (claim.count !== 1) return { error: "Delivery changed during resolution", status: 409 };
        await tx.order.update({ where: { id: delivery.orderId }, data: { fulfillmentStatus: "ready_for_pickup" } });
        await tx.ncmRequestAttempt.update({
          where: { id: attempt.id },
          data: {
            result: "RESOLVED_NOT_CREATED",
            httpStatus: 400,
            errorCode: "ADMIN_CONFIRMED_NCM_NOT_CREATED",
            errorMessage: resolutionReason,
            finishedAt: new Date(),
          },
        });
      }

      await tx.deliveryEvent.create({
        data: {
          deliveryOrderId: delivery.id,
          orderId: delivery.orderId,
          source: "ADMIN",
          eventType: normalizedOutcome === "CREATED" ? "NCM_HANDOFF_CONFIRMED_CREATED" : "NCM_HANDOFF_CONFIRMED_NOT_CREATED",
          fromState: delivery.state,
          toState: normalizedOutcome === "CREATED" ? "NCM_CREATED" : "SUBMISSION_FAILED",
          payloadJson: { ncmOrderId: normalizedOutcome === "CREATED" ? numericNcmOrderId : null, reason: resolutionReason },
          actorId: req.adminId,
          idempotencyKey: `NCM_HANDOFF_RESOLUTION:${delivery.id}:${attempt.attemptNumber}:${normalizedOutcome}`,
        },
      });
      return { success: true, deliveryId: delivery.id, outcome: normalizedOutcome };
    }, { isolationLevel: "Serializable" });

    if (result.error) return res.status(result.status).json({ success: false, message: result.error });
    return res.json({ success: true, message: "NCM handoff resolution recorded.", ...result });
  } catch (error) {
    const status = error.code === "P2002" ? 409 : 500;
    return res.status(status).json({ success: false, message: error.code === "P2002" ? "This NCM order ID is already linked to another delivery." : error.message });
  }
};

export const adminListDeliveries = async (req, res) => {
  const pagination = getPagination(req.query);
  const where = {};
  if (req.query.state) where.state = req.query.state;
  if (req.query.manufacturerId) where.manufacturerId = req.query.manufacturerId;
  const [deliveries, total] = await prisma.$transaction([
    prisma.deliveryOrder.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        order: { select: { id: true, address: true, amount: true, paymentMethod: true, payment: true, status: true, fulfillmentStatus: true } },
        events: { orderBy: { occurredAt: "desc" }, take: 5 },
      },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.deliveryOrder.count({ where }),
  ]);
  res.json(paginatedResponse("deliveries", deliveries, pagination, total));
};

export const getRecentSystemLogs = async (_req, res) => {
  try {
    const logs = await readRecentLogs(80);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "Failed to read log file" });
  }
};

export const adminSettlementSummary = async (_req, res) => {
    const [settlements, deliveries] = await Promise.all([
      prisma.deliveryFinancialSettlement.findMany({ select: { codExpected: true, codCollected: true, deliveryFeeExpected: true, deliveryFeeActual: true, deliveryFeeDiscount: true, settlementState: true } }),
      prisma.deliveryOrder.findMany({ select: { customerDeliveryCharge: true, ncmDeliveryCharge: true, state: true } }),
    ]);
    const totalDeliveryChargeExpected = deliveries.reduce((sum, item) => sum + Number(item.customerDeliveryCharge || 0), 0);
    const totalCarrierFees = settlements.reduce((sum, item) => sum + Number(item.deliveryFeeActual || 0), 0);
    const totalCarrierDiscounts = settlements.reduce((sum, item) => sum + Number(item.deliveryFeeDiscount || 0), 0);
    const totalDeliveryChargePaid = settlements
      .filter((item) => item.settlementState === "SETTLED")
      .reduce((sum, item) => sum + Number(item.deliveryFeeActual || 0), 0);
    const codExpected = settlements.reduce((sum, item) => sum + Number(item.codExpected || 0), 0);
    const codReceived = settlements.reduce((sum, item) => sum + Number(item.codCollected || 0), 0);
    res.json({
      success: true,
      summary: {
        totalDeliveryChargeExpected,
        totalCarrierDiscounts,
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

export const adminListSettlementCandidates = async (req, res) => {
  try {
    return res.json(await listNcmSettlementCandidates(req.query));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "NCM_SETTLEMENT_ERROR",
      message: error.message || "Failed to list NCM settlement candidates.",
    });
  }
};

export const adminListSettlementBatches = async (_req, res) => {
  try {
    return res.json(await listNcmSettlementBatches());
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "NCM_SETTLEMENT_ERROR",
      message: error.message || "Failed to list NCM settlement batches.",
    });
  }
};

export const adminResolveSettlementVariance = async (req, res) => {
  try {
    const result = await resolveNcmSettlementVariance({
      ...req.body,
      batchId: req.params.batchId,
      createdBy: req.auth?.email || "ADMIN",
    });
    return res.status(200).json({
      ...result,
      message: result.alreadyProcessed
        ? "This NCM variance resolution was already recorded."
        : "NCM variance resolution recorded and accounted for.",
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "NCM_SETTLEMENT_ERROR",
      message: error.message || "Failed to resolve NCM settlement variance.",
    });
  }
};

export const adminRequestSettlement = async (req, res) => {
    const {
      bankName,
      bankAccountName,
      bankAccountNumber,
      settlementIds,
      startDate,
      endDate,
    } = req.body || {};
    const submittedBankDetails = { bankName, bankAccountName, bankAccountNumber };
    try {
      const bankDetails = validateCodTransferBankDetails(submittedBankDetails);
      const { ids } = await validateNcmSettlementSelection({ settlementIds, startDate, endDate });
      const selectedSettlements = await prisma.deliveryFinancialSettlement.findMany({
        where: { id: { in: ids } },
        select: { id: true, ncmTicketId: true, settlementState: true },
      });
      if (selectedSettlements.length !== ids.length) {
        return res.status(409).json({
          success: false,
          code: "SETTLEMENTS_CHANGED",
          message: "One or more selected deliveries changed before the NCM request could be created. Refresh and retry.",
        });
      }
      if (selectedSettlements.some(({ ncmTicketId, settlementState }) =>
        ncmTicketId != null || settlementState === "REQUESTED"
      )) {
        return res.status(409).json({
          success: false,
          code: "SETTLEMENT_ALREADY_REQUESTED",
          message: "One or more selected deliveries already have an NCM settlement request. Reconcile the existing request instead of creating another.",
        });
      }
      if (selectedSettlements.some(({ settlementState }) => !["PENDING", "COD_RECEIVED"].includes(settlementState))) {
        return res.status(409).json({
          success: false,
          code: "SETTLEMENTS_CHANGED",
          message: "One or more selected deliveries are no longer requestable. Refresh and retry.",
        });
      }
      const ticket = await requestCodSettlement(bankDetails);
      const savedTicket = await saveNcmSupportTicket(ticket, {
        ticketType: "COD Transfer",
        message: "COD transfer request",
        addedOn: new Date(),
        recordedByAccountId: req.auth?.accountId || null,
      });
      const ticketId = savedTicket.ncmTicketId;
      const claimed = await prisma.deliveryFinancialSettlement.updateMany({
        where: {
          id: { in: ids },
          ncmTicketId: null,
          settlementState: { in: ["PENDING", "COD_RECEIVED"] },
        },
        data: { ncmTicketId: ticketId, settlementState: "REQUESTED" },
      });
      if (claimed.count !== ids.length) {
        return res.status(409).json({
          success: false,
          code: "SETTLEMENT_REQUEST_LINK_CONFLICT",
          message: `NCM ticket ${ticketId} was created, but the selected deliveries changed before they could be linked. Reconcile this ticket in NCM support before retrying.`,
          ticketId,
        });
      }
      res.status(201).json({ success: true, ticket, ticketId, selectedCount: ids.length });
    } catch (error) {
      res.status(error.statusCode || 502).json({
        success: false,
        code: error.code || "NCM_SETTLEMENT_REQUEST_FAILED",
        message: getNcmSettlementFailureMessage(error, submittedBankDetails),
      });
    }
};

export const adminListSettlements = async (req, res) => {
  const pagination = getPagination(req.query);
  const where = req.query.state
    ? { settlementState: req.query.state }
    : { settlementState: { in: ["PENDING", "COD_RECEIVED", "REQUESTED"] } };
  const [settlements, total] = await prisma.$transaction([
    prisma.deliveryFinancialSettlement.findMany({ where, orderBy: { updatedAt: "desc" }, skip: pagination.skip, take: pagination.limit }),
    prisma.deliveryFinancialSettlement.count({ where }),
  ]);
  res.json(paginatedResponse("settlements", settlements, pagination, total));
};

export const adminConfirmSettlement = async (req, res) => {
  const {
    settlementIds,
    settlementId,
    financialAccountId,
    reference,
    notes,
    actualNetDeposit,
    varianceType,
    varianceReason,
    startDate,
    endDate,
    ncmTicketId,
  } = req.body || {};
  const ids = settlementIds || (settlementId ? [settlementId] : []);
  if (!ids.length) {
    return res.status(400).json({ success: false, message: "Please select at least one settlement to confirm." });
  }
  try {
    const result = await confirmNcmSettlementBatch({
      settlementIds: ids,
      financialAccountId,
      reference,
      notes,
      actualNetDeposit,
      varianceType,
      varianceReason,
      periodStart: startDate,
      periodEnd: endDate,
      ncmTicketId: ncmTicketId == null ? null : Number(ncmTicketId),
      createdBy: req.auth?.email || "ADMIN",
    });
    return res.status(200).json({
      ...result,
      message: result.alreadyProcessed
        ? "This NCM remittance batch was already posted."
        : `NPR ${Number(result.netDeposit).toLocaleString()} net COD remittance posted.`,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "NCM_SETTLEMENT_ERROR",
      message: error.message || "Failed to confirm COD settlement.",
    });
  }
};

export { applyNcmStatus };
