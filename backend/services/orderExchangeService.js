import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { createExchangeOrder, getOrderStatus } from "./ncmClient.js";
import { syncProductStock } from "./stockSyncService.js";

const ACTIVE_STATUSES = ["REQUESTED", "APPROVED", "SUBMITTING", "NCM_SUBMISSION_UNKNOWN", "NCM_REJECTED", "NCM_CREATED", "RETURN_PICKUP_COMPLETE", "RETURN_RECEIVED", "INSPECTED", "COMPLETED", "IN_PROGRESS"];
const REASONS = new Set(["SIZE_OR_FIT", "DEFECTIVE", "WRONG_ITEM", "DAMAGED_IN_TRANSIT", "OTHER"]);

const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalized = (value) => String(value || "").trim().toLowerCase();
const itemKey = (item) => [item.productId, normalized(item.size), normalized(item.color)].join("|");
const fail = (message, code, status = 400) => Object.assign(new Error(message), { code, status });

const cardHasBeenScanned = async (tx, cardId) => {
  if (!cardId) return false;
  const [customerLink, scanEvent, redemption] = await Promise.all([
    tx.marketingCardCustomer.findFirst({ where: { cardId, status: { not: "CANCELLED" } }, select: { id: true } }),
    tx.marketingCardEvent.findFirst({ where: { cardId, eventType: "CARD_SCANNED_BY_CUSTOMER" }, select: { id: true } }),
    tx.marketingBenefitRedemption.findFirst({ where: { cardId, status: "REDEEMED" }, select: { id: true } }),
  ]);
  return Boolean(customerLink || scanEvent || redemption);
};

const addEvent = (tx, {
  exchangeRequestId,
  eventType,
  fromStatus = null,
  toStatus = null,
  actorId = null,
  actorRole = "SYSTEM",
  reason = null,
  metadata = undefined,
  idempotencyKey,
}) => tx.orderExchangeEvent.create({
  data: {
    exchangeRequestId,
    eventType,
    fromStatus,
    toStatus,
    actorId,
    actorRole,
    reason,
    ...(metadata === undefined ? {} : { metadata }),
    idempotencyKey,
  },
});

export const requestHashFor = ({ orderId, reasonCode, reasonDetails, items }) => createHash("sha256")
  .update(JSON.stringify({
    orderId,
    reasonCode,
    reasonDetails: String(reasonDetails || "").trim(),
    items: (Array.isArray(items) ? items : [])
      .map((item) => ({
        productId: String(item.productId || ""),
        size: String(item.size || "").trim(),
        color: String(item.color || "").trim(),
        quantity: Number(item.quantity || 0),
      }))
      .sort((left, right) => itemKey(left).localeCompare(itemKey(right))),
  }))
  .digest("hex");

const findRequestDuplicate = async (requestKey, customerId, orderId, requestHash) => {
  const existing = await prisma.orderExchangeRequest.findUnique({ where: { requestKey } });
  if (!existing) return null;
  if (existing.customerId !== customerId || existing.orderId !== orderId) {
    throw fail("This request key was already used for a different order.", "IDEMPOTENCY_KEY_CONFLICT", 409);
  }
  if (existing.requestHash !== requestHash) {
    throw fail("This request key was already used with different exchange details.", "IDEMPOTENCY_KEY_CONFLICT", 409);
  }
  return existing;
};

const snapshotRequestedItems = (orderItems, requestedItems, priorExchanges) => {
  const purchased = new Map();
  for (const item of parseArray(orderItems)) {
    const productId = String(item.productId || item._id || item.id || "");
    if (!productId) continue;
    const snapshot = {
      productId,
      name: String(item.name || "Product"),
      size: String(item.size || ""),
      color: String(item.color || ""),
      quantity: Math.max(0, Number(item.quantity || 0)),
      unitPrice: Number(item.purchasedUnitPrice ?? item.price ?? 0),
    };
    const key = itemKey(snapshot);
    const current = purchased.get(key);
    if (current) current.quantity += snapshot.quantity;
    else purchased.set(key, snapshot);
  }

  const alreadyRequested = new Map();
  for (const exchange of priorExchanges) {
    for (const item of parseArray(exchange.items)) {
      const key = itemKey(item);
      alreadyRequested.set(key, (alreadyRequested.get(key) || 0) + Number(item.quantity || 0));
    }
  }

  const requested = new Map();
  for (const item of requestedItems) {
    const productId = String(item.productId || "");
    const key = itemKey({ productId, size: item.size, color: item.color });
    const quantity = Number(item.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
      throw fail("Choose a product and a positive whole-number quantity for each exchange item.", "INVALID_EXCHANGE_ITEMS");
    }
    requested.set(key, (requested.get(key) || 0) + quantity);
  }

  if (!requested.size) throw fail("Select at least one item to exchange.", "INVALID_EXCHANGE_ITEMS");

  return [...requested.entries()].map(([key, quantity]) => {
    const purchase = purchased.get(key);
    if (!purchase || quantity + (alreadyRequested.get(key) || 0) > purchase.quantity) {
      throw fail("The requested exchange quantity exceeds the quantity purchased or already requested.", "EXCHANGE_QUANTITY_EXCEEDED", 409);
    }
    return { ...purchase, quantity };
  });
};

export const createCustomerExchangeRequest = async ({ customerId, orderId, requestKey, reasonCode, reasonDetails, items }) => {
  const code = String(reasonCode || "").trim().toUpperCase();
  const details = String(reasonDetails || "").trim();
  const key = String(requestKey || randomUUID()).trim();
  const requestHash = requestHashFor({ orderId, reasonCode: code, reasonDetails: details, items });
  if (!customerId || !orderId || key.length > 128 || !REASONS.has(code)) {
    throw fail("Order and a valid exchange reason are required.", "INVALID_EXCHANGE_REQUEST");
  }
  if (details.length > 1000 || !Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw fail("Exchange details or item selection is invalid.", "INVALID_EXCHANGE_REQUEST");
  }
  if (code === "OTHER" && details.length < 5) {
    throw fail("Please explain the reason when selecting Other.", "EXCHANGE_REASON_REQUIRED");
  }

  const previous = await findRequestDuplicate(key, customerId, orderId, requestHash);
  if (previous) return { request: previous, duplicate: true };

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, userId: customerId },
      include: { deliveryOrder: true, marketingCardOrder: { include: { card: true } } },
    });
    if (!order) throw fail("Order not found.", "ORDER_NOT_FOUND", 404);
    const delivered = normalized(order.status) === "delivered" || order.deliveryOrder?.state === "DELIVERED";
    if (!delivered) throw fail("Exchanges can only be requested for delivered orders.", "ORDER_NOT_DELIVERED", 409);

    const cardId = order.marketingCardOrder?.cardId || null;
    if (cardId) {
      if (order.marketingCardOrder.card.exchangeLockRequestId) {
        const lockedRequest = await tx.orderExchangeRequest.findUnique({ where: { id: order.marketingCardOrder.card.exchangeLockRequestId } });
        if (lockedRequest?.customerId === customerId && lockedRequest.orderId === orderId && lockedRequest.requestHash === requestHash) {
          return { request: lockedRequest, duplicate: true };
        }
        throw fail("An exchange request is already open for this marketing card.", "EXCHANGE_ALREADY_OPEN", 409);
      }
      if (await cardHasBeenScanned(tx, cardId)) {
        throw fail("This order is no longer eligible for exchange because its marketing card was scanned.", "CARD_ALREADY_SCANNED", 409);
      }
    }

    const existingRequests = await tx.orderExchangeRequest.findMany({
      where: { orderId, status: { in: ACTIVE_STATUSES } },
      select: { items: true },
    });
    const requestedItems = snapshotRequestedItems(order.items, items || [], existingRequests);
    const [customer, manufacturer] = await Promise.all([
      tx.user.findUnique({ where: { id: customerId }, select: { name: true, phone: true } }),
      order.manufacturerId ? tx.manufacturer.findUnique({ where: { id: order.manufacturerId }, select: { name: true } }) : null,
    ]);

    const created = await tx.orderExchangeRequest.create({
      data: {
        requestKey: key,
        requestHash,
        orderId,
        customerId,
        customerName: customer?.name || "Customer",
        customerPhone: customer?.phone || "",
        manufacturerId: order.manufacturerId || null,
        manufacturerName: manufacturer?.name || null,
        cardId,
        reasonCode: code,
        reasonDetails: details || null,
        items: requestedItems,
        status: "REQUESTED",
      },
    });

    if (cardId) {
      const locked = await tx.marketingCard.updateMany({
        where: { id: cardId, exchangeLockRequestId: null },
        data: { exchangeLockRequestId: created.id },
      });
      if (locked.count !== 1) {
        throw fail("The marketing card changed while the exchange request was being submitted. Refresh and try again.", "CARD_EXCHANGE_LOCK_CONFLICT", 409);
      }
    }

    await addEvent(tx, {
      exchangeRequestId: created.id,
      eventType: "REQUESTED",
      toStatus: "REQUESTED",
      actorId: customerId,
      actorRole: "CUSTOMER",
      reason: details || code,
      metadata: { reasonCode: code, items: requestedItems },
      idempotencyKey: `EXCHANGE:${created.id}:REQUESTED`,
    });
    return { request: created, duplicate: false };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code === "P2002") {
      const duplicate = await findRequestDuplicate(key, customerId, orderId, requestHash);
      if (duplicate) return { request: duplicate, duplicate: true };
    }
    if (error.code === "P2034") {
      throw fail("The exchange request changed concurrently. Refresh and submit again.", "EXCHANGE_REQUEST_CONFLICT", 409);
    }
    throw error;
  }

  return result;
};

export const listCustomerExchangeRequests = ({ customerId, orderId }) => prisma.orderExchangeRequest.findMany({
  where: { customerId, ...(orderId ? { orderId } : {}) },
  select: {
    id: true,
    orderId: true,
    reasonCode: true,
    reasonDetails: true,
    items: true,
    status: true,
    decisionReason: true,
    decidedAt: true,
    returnPickupStatus: true,
    returnPickupCompletedAt: true,
    replacementStatus: true,
    replacementDeliveredAt: true,
    manufacturerReceivedAt: true,
    inspectionResult: true,
    inspectedAt: true,
    completedAt: true,
    createdAt: true,
    events: { select: { eventType: true, fromStatus: true, toStatus: true, reason: true, occurredAt: true }, orderBy: { occurredAt: "asc" } },
  },
  orderBy: { createdAt: "desc" },
});

export const toAdminExchangeRequestDto = (request, lifetimeReturnedUnits = 0) => ({
  ...request,
  order: request.order
    ? { ...request.order, date: request.order.date == null ? request.order.date : String(request.order.date) }
    : request.order,
  lifetimeReturnedUnits,
});

export const listAdminExchangeRequests = async ({ status, skip = 0, take = 30 }) => {
  const where = status ? { status } : {};
  const [requests, total] = await prisma.$transaction([
    prisma.orderExchangeRequest.findMany({
      where,
      include: {
        order: { select: { id: true, status: true, amount: true, date: true, items: true, deliveryOrder: { select: { ncmOrderId: true, state: true } } } },
        customer: { select: { id: true, name: true, phone: true, email: true } },
        events: { orderBy: { occurredAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.orderExchangeRequest.count({ where }),
  ]);

  const customerIds = [...new Set(requests.map((request) => request.customerId))];
  const history = customerIds.length ? await prisma.orderExchangeRequest.findMany({
    where: { customerId: { in: customerIds }, status: { in: ["RETURN_RECEIVED", "INSPECTED", "COMPLETED"] } },
    select: { customerId: true, items: true },
  }) : [];
  const returnedUnitsByCustomer = new Map();
  for (const exchange of history) {
    const returnedUnits = parseArray(exchange.items).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    returnedUnitsByCustomer.set(exchange.customerId, (returnedUnitsByCustomer.get(exchange.customerId) || 0) + returnedUnits);
  }
  if (customerIds.length) {
    const legacyReturns = await prisma.customerReturn.findMany({
      where: { userId: { in: customerIds }, refundStatus: "COMPLETED" },
      select: { userId: true, items: true },
    });
    for (const legacyReturn of legacyReturns) {
      const returnedUnits = parseArray(legacyReturn.items).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      returnedUnitsByCustomer.set(legacyReturn.userId, (returnedUnitsByCustomer.get(legacyReturn.userId) || 0) + returnedUnits);
    }
  }

  return {
    total,
    requests: requests.map((request) => toAdminExchangeRequestDto(
      request,
      returnedUnitsByCustomer.get(request.customerId) || 0,
    )),
  };
};

export const decideCustomerExchangeRequest = async ({ requestId, adminId, decision, reason }) => {
  const normalizedDecision = String(decision || "").trim().toUpperCase();
  const decisionReason = String(reason || "").trim();
  if (!requestId || !["APPROVE", "REJECT"].includes(normalizedDecision) || decisionReason.length < 3) {
    throw fail("Choose approve or reject and provide a decision reason.", "INVALID_EXCHANGE_DECISION");
  }

  const request = await prisma.$transaction(async (tx) => {
    const current = await tx.orderExchangeRequest.findUnique({
      where: { id: requestId },
      include: { order: { include: { deliveryOrder: true } } },
    });
    if (!current) throw fail("Exchange request not found.", "EXCHANGE_NOT_FOUND", 404);
    const canRejectNcmRejection = normalizedDecision === "REJECT" && current.status === "NCM_REJECTED";
    if (current.status !== "REQUESTED" && !canRejectNcmRejection) throw fail("This exchange request has already been reviewed.", "EXCHANGE_ALREADY_REVIEWED", 409);
    if (normalizedDecision === "APPROVE" && current.status !== "REQUESTED") {
      const delivered = normalized(current.order.status) === "delivered" || current.order.deliveryOrder?.state === "DELIVERED";
      if (!delivered) throw fail("The original order is no longer eligible for exchange.", "ORDER_NOT_DELIVERED", 409);
      if (current.cardId && await cardHasBeenScanned(tx, current.cardId)) {
        throw fail("The marketing card was scanned before approval, so this exchange cannot be approved.", "CARD_ALREADY_SCANNED", 409);
      }
    }

    const nextStatus = normalizedDecision === "APPROVE" ? "APPROVED" : "REJECTED";
    const claimed = await tx.orderExchangeRequest.updateMany({
      where: { id: current.id, status: current.status },
      data: { status: nextStatus, decisionActorId: adminId, decisionReason, decidedAt: new Date() },
    });
    if (claimed.count !== 1) throw fail("This exchange request was reviewed by another admin.", "EXCHANGE_ALREADY_REVIEWED", 409);
    const updated = await tx.orderExchangeRequest.findUnique({ where: { id: current.id } });
    if (normalizedDecision === "REJECT" && current.cardId) {
      await tx.marketingCard.updateMany({
        where: { id: current.cardId, exchangeLockRequestId: current.id },
        data: { exchangeLockRequestId: null },
      });
    }
    await addEvent(tx, {
      exchangeRequestId: current.id,
      eventType: normalizedDecision,
      fromStatus: current.status,
      toStatus: nextStatus,
      actorId: adminId,
      actorRole: "ADMIN",
      reason: decisionReason,
      idempotencyKey: `EXCHANGE:${current.id}:${nextStatus}`,
    });
    return updated;
  }, { isolationLevel: "Serializable" });

  if (request.status === "APPROVED") {
    const submitted = await submitApprovedExchange(request.id);
    return { request: submitted, ncmSubmission: submitted.status };
  }
  return { request, ncmSubmission: null };
};

export const submitApprovedExchange = async (requestId) => {
  const submission = await prisma.$transaction(async (tx) => {
    const request = await tx.orderExchangeRequest.findUnique({
      where: { id: requestId },
      include: { order: { include: { deliveryOrder: true } } },
    });
    if (!request) throw fail("Exchange request not found.", "EXCHANGE_NOT_FOUND", 404);
    if (!["APPROVED", "NCM_REJECTED"].includes(request.status)) {
      throw fail("Only approved exchanges with a confirmed NCM rejection can be submitted.", "EXCHANGE_NOT_SUBMITTABLE", 409);
    }
    const ncmOrderId = Number(request.order.deliveryOrder?.ncmOrderId);
    if (!Number.isInteger(ncmOrderId) || ncmOrderId <= 0) {
      throw fail("The original delivery does not have a valid NCM order ID.", "NCM_ORDER_ID_MISSING", 409);
    }
    const previousStatus = request.status;
    const attemptedAt = new Date();
    const claimed = await tx.orderExchangeRequest.updateMany({
      where: { id: request.id, status: previousStatus },
      data: {
        status: "SUBMITTING",
        ncmSubmissionAttemptedAt: attemptedAt,
        ncmSubmissionError: null,
      },
    });
    if (claimed.count !== 1) throw fail("Another NCM submission is already in progress.", "EXCHANGE_SUBMISSION_CONFLICT", 409);
    const updated = await tx.orderExchangeRequest.findUnique({ where: { id: request.id } });
    await addEvent(tx, {
      exchangeRequestId: request.id,
      eventType: "NCM_SUBMISSION_STARTED",
      fromStatus: previousStatus,
      toStatus: "SUBMITTING",
      actorRole: "SYSTEM",
      idempotencyKey: `EXCHANGE:${request.id}:SUBMISSION:${attemptedAt.getTime()}`,
    });
    return { request: updated, ncmOrderId };
  }, { isolationLevel: "Serializable" });

  try {
    const response = await createExchangeOrder({ pk: submission.ncmOrderId });
    const returnOrderId = Number(response.data?.ven_order);
    const replacementOrderId = Number(response.data?.cust_order);
    if (!Number.isInteger(returnOrderId) || returnOrderId <= 0 || !Number.isInteger(replacementOrderId) || replacementOrderId <= 0) {
      throw Object.assign(new Error("NCM returned an invalid exchange response; verify the exchange in the NCM portal before retrying."), { code: "NCM_EXCHANGE_RESPONSE_UNKNOWN" });
    }

    return await prisma.$transaction(async (tx) => {
      const current = await tx.orderExchangeRequest.findUnique({ where: { id: requestId } });
      if (!current || current.status !== "SUBMITTING") return current;
      const updated = await tx.orderExchangeRequest.update({
        where: { id: requestId },
        data: {
          status: "NCM_CREATED",
          ncmReturnOrderId: returnOrderId,
          ncmReplacementOrderId: replacementOrderId,
          returnPickupStatus: "AWAITING_PICKUP",
          replacementStatus: "CREATED",
          ncmSubmissionError: null,
        },
      });
      await addEvent(tx, {
        exchangeRequestId: requestId,
        eventType: "NCM_EXCHANGE_CREATED",
        fromStatus: "SUBMITTING",
        toStatus: "NCM_CREATED",
        metadata: { returnOrderId, replacementOrderId, ncmResponse: response.data },
        idempotencyKey: `EXCHANGE:${requestId}:NCM_CREATED`,
      });
      return updated;
    });
  } catch (error) {
    const explicitRejection = /^NCM_HTTP_4\d\d$/.test(String(error.code || ""));
    const nextStatus = explicitRejection ? "NCM_REJECTED" : "NCM_SUBMISSION_UNKNOWN";
    return prisma.$transaction(async (tx) => {
      const current = await tx.orderExchangeRequest.findUnique({ where: { id: requestId } });
      if (!current || current.status !== "SUBMITTING") return current;
      const updated = await tx.orderExchangeRequest.update({
        where: { id: requestId },
        data: { status: nextStatus, ncmSubmissionError: String(error.message || "NCM submission failed").slice(0, 4000) },
      });
      await addEvent(tx, {
        exchangeRequestId: requestId,
        eventType: nextStatus,
        fromStatus: "SUBMITTING",
        toStatus: nextStatus,
        reason: String(error.message || "NCM submission failed").slice(0, 2000),
        idempotencyKey: `EXCHANGE:${requestId}:${nextStatus}:${current.ncmSubmissionAttemptedAt?.getTime() || Date.now()}`,
      });
      return updated;
    });
  }
};

export const resolveUnknownExchangeSubmission = async ({ requestId, adminId, outcome, ncmReturnOrderId, ncmReplacementOrderId, reason }) => {
  const resolution = String(outcome || "").trim().toUpperCase();
  const resolutionReason = String(reason || "").trim();
  if (!requestId || !["FOUND", "NOT_CREATED"].includes(resolution) || resolutionReason.length < 5) {
    throw fail("Choose the verified NCM outcome and provide investigation notes.", "INVALID_NCM_RESOLUTION");
  }
  const returnId = Number(ncmReturnOrderId);
  const replacementId = Number(ncmReplacementOrderId);
  if (resolution === "FOUND" && (!Number.isInteger(returnId) || returnId <= 0 || !Number.isInteger(replacementId) || replacementId <= 0 || returnId === replacementId)) {
    throw fail("Enter the separate NCM return and replacement order IDs.", "INVALID_NCM_EXCHANGE_IDS");
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.orderExchangeRequest.findUnique({ where: { id: requestId } });
    if (!request) throw fail("Exchange request not found.", "EXCHANGE_NOT_FOUND", 404);
    if (!["SUBMITTING", "NCM_SUBMISSION_UNKNOWN"].includes(request.status)) {
      throw fail("Only an exchange with an unknown NCM result can be resolved here.", "EXCHANGE_NOT_UNKNOWN", 409);
    }
    if (request.status === "SUBMITTING" && request.ncmSubmissionAttemptedAt && Date.now() - request.ncmSubmissionAttemptedAt.getTime() < 120000) {
      throw fail("The NCM exchange request may still be in progress. Wait two minutes before resolving it manually.", "NCM_SUBMISSION_STILL_ACTIVE", 409);
    }

    const nextStatus = resolution === "FOUND" ? "NCM_CREATED" : "NCM_REJECTED";
    const claimed = await tx.orderExchangeRequest.updateMany({
      where: { id: request.id, status: request.status },
      data: resolution === "FOUND"
        ? {
            status: nextStatus,
            ncmReturnOrderId: returnId,
            ncmReplacementOrderId: replacementId,
            returnPickupStatus: "AWAITING_PICKUP",
            replacementStatus: "CREATED",
            ncmSubmissionError: null,
          }
        : {
            status: nextStatus,
            ncmSubmissionError: resolutionReason,
          },
    });
            if (claimed.count !== 1) throw fail("This NCM result was already resolved.", "EXCHANGE_NCM_RESOLUTION_CONFLICT", 409);
            const updated = await tx.orderExchangeRequest.findUnique({ where: { id: request.id } });
    await addEvent(tx, {
      exchangeRequestId: request.id,
      eventType: resolution === "FOUND" ? "NCM_OUTCOME_CONFIRMED_CREATED" : "NCM_OUTCOME_CONFIRMED_NOT_CREATED",
      fromStatus: request.status,
      toStatus: nextStatus,
      actorId: adminId,
      actorRole: "ADMIN",
      reason: resolutionReason,
      metadata: resolution === "FOUND" ? { returnOrderId: returnId, replacementOrderId: replacementId } : undefined,
      idempotencyKey: `EXCHANGE:${request.id}:NCM_RESOLUTION:${request.ncmSubmissionAttemptedAt?.getTime() || request.updatedAt.getTime()}`,
    });
    return updated;
  }, { isolationLevel: "Serializable" });
};

export const mapExchangeNcmStatus = (status, event) => {
  const value = normalized(status || event).replace(/[_-]+/g, " ");
  if (["pickup complete", "pickup completed"].includes(value)) return "PICKUP_COMPLETE";
  if (["delivered", "delivery complete", "delivery completed"].includes(value)) return "DELIVERED";
  if (["sent for pickup", "pickup order created"].includes(value)) return "PICKUP_PENDING";
  if (["sent for delivery", "dispatched", "arrived", "out for delivery"].includes(value)) return "IN_TRANSIT";
  return String(status || event || "UNKNOWN").slice(0, 64);
};

const ncmStatusRank = (status) => ({
  CREATED: 0,
  AWAITING_PICKUP: 0,
  PICKUP_PENDING: 1,
  IN_TRANSIT: 2,
  PICKUP_COMPLETE: 3,
  DELIVERED: 4,
}[String(status || "").toUpperCase()] ?? -1);

export const applyExchangeNcmStatus = async ({ ncmOrderId, status, event, timestamp, source = "NCM_WEBHOOK" }) => {
  const numericId = Number(ncmOrderId);
  if (!Number.isInteger(numericId) || numericId <= 0) return false;
  const request = await prisma.orderExchangeRequest.findFirst({
    where: { OR: [{ ncmReturnOrderId: numericId }, { ncmReplacementOrderId: numericId }] },
  });
  if (!request) return false;

  const isReturnLeg = request.ncmReturnOrderId === numericId;
  const nextLegStatus = mapExchangeNcmStatus(status, event);
  const happenedAt = timestamp && !Number.isNaN(new Date(timestamp).getTime()) ? new Date(timestamp) : new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.orderExchangeRequest.findUnique({ where: { id: request.id } });
    if (!current) return null;
    const fromStatus = current.status;
    const currentLegStatus = isReturnLeg ? current.returnPickupStatus : current.replacementStatus;
    const isStaleStatus = ncmStatusRank(nextLegStatus) >= 0 && ncmStatusRank(currentLegStatus) > ncmStatusRank(nextLegStatus);
    const appliedLegStatus = isStaleStatus ? currentLegStatus : nextLegStatus;
    const patch = isReturnLeg
      ? {
          returnPickupStatus: appliedLegStatus,
          ...(appliedLegStatus === "PICKUP_COMPLETE" ? { returnPickupCompletedAt: current.returnPickupCompletedAt || happenedAt } : {}),
          ...(appliedLegStatus === "DELIVERED" ? { manufacturerReceivedAt: current.manufacturerReceivedAt || happenedAt } : {}),
        }
      : {
          replacementStatus: appliedLegStatus,
          ...(appliedLegStatus === "DELIVERED" ? { replacementDeliveredAt: current.replacementDeliveredAt || happenedAt } : {}),
        };

    const returnReceivedAt = isReturnLeg && appliedLegStatus === "DELIVERED"
      ? current.manufacturerReceivedAt || happenedAt
      : current.manufacturerReceivedAt;
    const replacementDeliveredAt = !isReturnLeg && appliedLegStatus === "DELIVERED"
      ? current.replacementDeliveredAt || happenedAt
      : current.replacementDeliveredAt;
    let exchangeStatus = current.status;
    if (returnReceivedAt && replacementDeliveredAt && current.inspectionResult) exchangeStatus = "COMPLETED";
    else if (returnReceivedAt && current.inspectionResult) exchangeStatus = "INSPECTED";
    else if (returnReceivedAt) exchangeStatus = "RETURN_RECEIVED";
    else if (current.returnPickupCompletedAt || (isReturnLeg && appliedLegStatus === "PICKUP_COMPLETE")) exchangeStatus = "RETURN_PICKUP_COMPLETE";
    else if (["NCM_CREATED", "IN_PROGRESS"].includes(current.status)) exchangeStatus = "IN_PROGRESS";

    const result = await tx.orderExchangeRequest.update({
      where: { id: current.id },
      data: { ...patch, status: exchangeStatus, ...(exchangeStatus === "COMPLETED" ? { completedAt: current.completedAt || happenedAt } : {}) },
    });
    const eventKey = `EXCHANGE_NCM:${numericId}:${nextLegStatus}:${timestamp || "NO_TIMESTAMP"}`;
    await addEvent(tx, {
      exchangeRequestId: current.id,
      eventType: `NCM_${isReturnLeg ? "RETURN" : "REPLACEMENT"}_${nextLegStatus}`.slice(0, 64),
      fromStatus,
      toStatus: exchangeStatus,
      actorRole: source,
      metadata: { ncmOrderId: numericId, status, event, occurredAt: happenedAt.toISOString() },
      idempotencyKey: eventKey,
    }).catch((error) => {
      if (error.code !== "P2002") throw error;
    });

    if (isReturnLeg && appliedLegStatus === "PICKUP_COMPLETE" && current.cardId) {
      const card = await tx.marketingCard.findUnique({ where: { id: current.cardId } });
      if (card && card.exchangeLockRequestId === current.id && card.physicalStatus !== "CANCELLED") {
        await tx.marketingCard.update({ where: { id: card.id }, data: { physicalStatus: "CANCELLED" } });
        await tx.marketingCardEvent.create({
          data: {
            cardId: card.id,
            eventType: "CARD_RETURNED_WITH_EXCHANGE",
            actorRole: "SYSTEM",
            fromStatus: card.physicalStatus,
            toStatus: "CANCELLED",
            referenceId: current.id,
            metadata: { ncmReturnOrderId: numericId },
          },
        });
      }
    }
    return result;
  }, { isolationLevel: "Serializable" });
  return Boolean(updated);
};

export const recordExchangeInspection = async ({ requestId, adminId, result, notes }) => {
  const inspectionResult = String(result || "").trim().toUpperCase();
  const inspectionNotes = String(notes || "").trim();
  const allowedResults = new Set(["RESTOCKABLE", "DAMAGED", "MISSING", "DISPUTED"]);
  if (!requestId || !allowedResults.has(inspectionResult)) {
    throw fail("Choose a valid inspection result.", "INVALID_EXCHANGE_INSPECTION");
  }
  if (["DAMAGED", "MISSING", "DISPUTED"].includes(inspectionResult) && inspectionNotes.length < 5) {
    throw fail("Add inspection notes for damaged, missing, or disputed items.", "EXCHANGE_INSPECTION_NOTES_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.orderExchangeRequest.findUnique({ where: { id: requestId } });
    if (!request) throw fail("Exchange request not found.", "EXCHANGE_NOT_FOUND", 404);
    if (!request.manufacturerReceivedAt) {
      throw fail("The returned product must be received by the manufacturer before inspection.", "EXCHANGE_RETURN_NOT_RECEIVED", 409);
    }
    if (request.inspectedAt) throw fail("This exchange return has already been inspected.", "EXCHANGE_ALREADY_INSPECTED", 409);

    const nextStatus = request.replacementDeliveredAt ? "COMPLETED" : "INSPECTED";
    const inspectedAt = new Date();
    const claimed = await tx.orderExchangeRequest.updateMany({
      where: { id: request.id, inspectedAt: null, manufacturerReceivedAt: { not: null } },
      data: {
        status: nextStatus,
        inspectionResult,
        inspectionNotes: inspectionNotes || null,
        inspectedAt,
        ...(nextStatus === "COMPLETED" ? { completedAt: inspectedAt } : {}),
      },
    });
    if (claimed.count !== 1) throw fail("Another admin is already recording the inspection.", "EXCHANGE_INSPECTION_CONFLICT", 409);

    if (inspectionResult === "RESTOCKABLE") {
      if (!request.manufacturerId) throw fail("The exchange has no manufacturer record for inventory restocking.", "EXCHANGE_MANUFACTURER_MISSING", 409);
      for (const item of parseArray(request.items)) {
        const inventory = await tx.manufacturerInventory.findUnique({
          where: { manufacturerId_productId: { manufacturerId: request.manufacturerId, productId: item.productId } },
        });
        if (!inventory) throw fail(`Manufacturer inventory is missing for ${item.name || item.productId}.`, "EXCHANGE_INVENTORY_MISSING", 409);
        const productBefore = await tx.product.findUnique({ where: { id: item.productId }, select: { id: true, name: true, stockQuantity: true } });
        const variantsStock = parseArray(inventory.variantsStock);
        const hasVariants = variantsStock.length > 0;
        const nextVariants = hasVariants
          ? variantsStock.map((variant) => (
              normalized(variant.size || "Standard") === normalized(item.size || "Standard") &&
              normalized(variant.color || "Standard") === normalized(item.color || "Standard")
                ? { ...variant, quantity: Number(variant.quantity || 0) + Number(item.quantity || 0) }
                : variant
            ))
          : variantsStock;
        if (hasVariants && !nextVariants.some((variant) =>
          normalized(variant.size || "Standard") === normalized(item.size || "Standard") &&
          normalized(variant.color || "Standard") === normalized(item.color || "Standard")
        )) {
          throw fail(`Manufacturer inventory has no matching variant for ${item.name || item.productId}.`, "EXCHANGE_INVENTORY_VARIANT_MISSING", 409);
        }
        await tx.manufacturerInventory.update({
          where: { manufacturerId_productId: { manufacturerId: request.manufacturerId, productId: item.productId } },
          data: {
            quantity: { increment: Number(item.quantity || 0) },
            ...(hasVariants ? { variantsStock: nextVariants } : {}),
          },
        });
        const updatedProduct = await syncProductStock(item.productId, { client: tx, throwOnError: true });
        if (productBefore && updatedProduct) {
          await tx.stockLog.create({
            data: {
              productId: item.productId,
              productName: productBefore.name,
              variantLabel: item.size && item.color ? `${item.size} / ${item.color}` : "",
              previousQty: productBefore.stockQuantity,
              newQty: updatedProduct.stockQuantity,
              changeQty: Number(item.quantity || 0),
              reason: `Exchange return restocked (${request.id.slice(0, 8)})`,
              note: inspectionNotes || "Returned item passed manufacturer inspection.",
              source: "exchange_return",
              orderId: request.orderId,
            },
          });
        }
      }
    }

    const updated = await tx.orderExchangeRequest.findUnique({ where: { id: request.id } });
    await addEvent(tx, {
      exchangeRequestId: request.id,
      eventType: "MANUFACTURER_RETURN_INSPECTED",
      fromStatus: request.status,
      toStatus: nextStatus,
      actorId: adminId,
      actorRole: "ADMIN",
      reason: inspectionNotes || inspectionResult,
      metadata: { inspectionResult, items: request.items },
      idempotencyKey: `EXCHANGE:${request.id}:INSPECTED`,
    });
    return updated;
  }, { isolationLevel: "Serializable" });
};

export const reconcileCustomerExchange = async (requestId) => {
  const request = await prisma.orderExchangeRequest.findUnique({ where: { id: requestId } });
  if (!request || !request.ncmReturnOrderId || !request.ncmReplacementOrderId) {
    throw fail("NCM exchange order IDs are not available for reconciliation.", "EXCHANGE_NCM_IDS_MISSING", 409);
  }
  const [returnStatuses, replacementStatuses] = await Promise.all([
    getOrderStatus(request.ncmReturnOrderId),
    getOrderStatus(request.ncmReplacementOrderId),
  ]);
  const latestReturn = Array.isArray(returnStatuses.data) ? returnStatuses.data[0] : null;
  const latestReplacement = Array.isArray(replacementStatuses.data) ? replacementStatuses.data[0] : null;
  if (latestReturn?.status) {
    await applyExchangeNcmStatus({ ncmOrderId: request.ncmReturnOrderId, status: latestReturn.status, timestamp: latestReturn.added_time, source: "NCM_POLL" });
  }
  if (latestReplacement?.status) {
    await applyExchangeNcmStatus({ ncmOrderId: request.ncmReplacementOrderId, status: latestReplacement.status, timestamp: latestReplacement.added_time, source: "NCM_POLL" });
  }
  return prisma.orderExchangeRequest.findUnique({ where: { id: requestId }, include: { events: { orderBy: { occurredAt: "asc" } } } });
};