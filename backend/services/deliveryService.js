import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import {
  createOrder as createNcmOrder,
  getBulkOrderStatuses,
  getOrder,
  getOrderStatus,
  getShippingRate,
  requestOrderReturn,
} from "./ncmClient.js";

const VALID_READY_STATES = new Set(["packed"]);
const STATUS_MAP = {
  "Pickup Order Created": "NCM_CREATED",
  "Drop off Order Created": "NCM_CREATED",
  "Sent for Pickup": "NCM_CREATED",
  "Pickup Complete": "PICKUP_CONFIRMED",
  "Sent for Delivery": "OUT_FOR_DELIVERY",
  Dispatched: "IN_TRANSIT",
  Arrived: "ARRIVED_AT_DESTINATION",
  Delivered: "DELIVERED",
  Returned: "RETURN_REQUESTED",
};

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeBranch = (value) => String(value || "").trim().toUpperCase();

const branchForCity = (city) => {
  const mapping = parseJson(process.env.NCM_BRANCH_MAP_JSON, {});
  const key = String(city || "").trim().toLowerCase();
  return normalizeBranch(mapping[key] || "");
};

const resolvePickupBranch = (manufacturer) => {
  const direct = normalizeBranch(manufacturer?.ncmPickupBranch || manufacturer?.pickupBranch || "");
  return direct;
};

const deliveryTypeForNcm = (deliveryType = "Door2Door") => {
  const allowed = new Set(["Door2Door", "Branch2Door", "Branch2Branch", "Door2Branch"]);
  return allowed.has(deliveryType) ? deliveryType : "Door2Door";
};

const statusEventKey = ({ orderId, status, timestamp, event }) =>
  crypto.createHash("sha256").update(JSON.stringify({ orderId, status, timestamp, event })).digest("hex");

const sanitizePayload = (payload) => {
  if (!payload || typeof payload !== "object") return {};
  return JSON.parse(JSON.stringify(payload));
};

const createEvent = async (tx, data) => {
  try {
    return await tx.deliveryEvent.create({ data });
  } catch (error) {
    if (error.code === "P2002") return null;
    throw error;
  }
};

const syncSummary = (state) => {
  const summary = {
    NCM_CREATED: "ncm_created",
    PICKUP_CONFIRMED: "picked_up",
    IN_TRANSIT: "in_transit",
    ARRIVED_AT_DESTINATION: "arrived_at_destination",
    OUT_FOR_DELIVERY: "out_for_delivery",
    DELIVERED: "delivered",
    RETURN_REQUESTED: "return_requested",
  };
  return summary[state] || null;
};

const buildDeliveryInput = ({ order, assignment, manufacturer }) => {
  const address = parseJson(order.address, {});
  const items = parseJson(order.items, []);
  const origin = resolvePickupBranch(manufacturer);
  const destination = branchForCity(address.city);
  if (!origin) {
    const error = new Error("Manufacturer NCM pickup branch is required. Ask admin to assign and verify the pickup branch before readying the order.");
    error.code = "NCM_PICKUP_BRANCH_REQUIRED";
    throw error;
  }
  if (!destination) {
    const error = new Error("NCM destination branch mapping is required. Configure the customer city mapping before dispatch.");
    error.code = "NCM_DESTINATION_BRANCH_REQUIRED";
    throw error;
  }

  const phone = String(address.phone || "").trim();
  const name = String(address.name || `${address.firstName || ""} ${address.lastName || ""}`).trim();
  const customerAddress = String(address.street || address.address || "").trim();
  if (!name || !phone || !customerAddress) {
    const error = new Error("Customer name, phone, and address are required before delivery");
    error.code = "DELIVERY_CUSTOMER_DATA_REQUIRED";
    throw error;
  }

  const itemAmount = Number(order.amount || 0);
  const deliveryType = deliveryTypeForNcm(address.deliveryType || "Door2Door");
  const packageDescription = items
    .map((item) => `${item.name || "Item"} x${Number(item.quantity || 1)}`)
    .join(", ")
    .slice(0, 500);
  const vendorReference = `ORDER-${order.id}-V${assignment.id}`.slice(0, 100);

  return {
    origin,
    destination,
    address,
    name,
    phone,
    customerAddress,
    itemAmount,
    deliveryType,
    packageDescription,
    vendorReference,
    codAmount: itemAmount,
  };
};

export const prepareReadyDelivery = async ({ orderId, manufacturerId, packageWeight }) => {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.manufacturerId !== manufacturerId) {
    const error = new Error("Order not found or unauthorized");
    error.code = "DELIVERY_NOT_FOUND";
    throw error;
  }

  const assignment = await prisma.orderAssignment.findUnique({ where: { orderId } });
  if (!assignment || assignment.manufacturerId !== manufacturerId) {
    const error = new Error("Manufacturer assignment not found");
    error.code = "DELIVERY_ASSIGNMENT_NOT_FOUND";
    throw error;
  }

  const existing = await prisma.deliveryOrder.findUnique({ where: { orderId } });
  const submittedStates = ["NCM_CREATED", "PICKUP_CONFIRMED", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "OUT_FOR_DELIVERY", "DELIVERED"];
  if (existing && submittedStates.includes(existing.state)) {
    return { delivery: existing, alreadySubmitted: true };
  }

  const isPacked = VALID_READY_STATES.has(assignment.status) || order.fulfillmentStatus === "packed";
  const isRetryingHandoff = assignment.status === "ready_for_pickup" && existing && ["SUBMISSION_PENDING", "SUBMISSION_FAILED"].includes(existing.state);
  if (!isPacked && !isRetryingHandoff) {
    const error = new Error(`Order must be packed before delivery submission; current state is ${assignment.status}`);
    error.code = "DELIVERY_INVALID_STATE";
    throw error;
  }

  const manufacturer = await prisma.manufacturer.findUnique({ where: { id: manufacturerId } });
  const input = buildDeliveryInput({ order, assignment, manufacturer });

  const delivery = await prisma.$transaction(async (tx) => {
    const record = existing
      ? await tx.deliveryOrder.update({
          where: { id: existing.id },
          data: {
            state: "SUBMISSION_PENDING",
            packageVersion: { increment: 1 },
            originBranchName: input.origin,
            destinationBranchName: input.destination,
            deliveryType: input.deliveryType,
            packageDescription: input.packageDescription,
            itemAmount: input.itemAmount,
            codAmount: input.codAmount,
            packageWeight: Math.max(0.1, Number(packageWeight || existing.packageWeight || 1)),
            assignmentId: assignment.id,
            manufacturerId,
            lastSyncError: null,
          },
        })
      : await tx.deliveryOrder.create({
          data: {
            orderId,
            assignmentId: assignment.id,
            manufacturerId,
            state: "SUBMISSION_PENDING",
            deliveryType: input.deliveryType,
            packageDescription: input.packageDescription,
            originBranchName: input.origin,
            destinationBranchName: input.destination,
            itemAmount: input.itemAmount,
            codAmount: input.codAmount,
            packageWeight: Math.max(0.1, Number(packageWeight || 1)),
            vendorReference: input.vendorReference,
          },
        });

    await tx.order.update({
      where: { id: orderId },
      data: { fulfillmentStatus: "submission_pending" },
    });
    await tx.orderAssignment.update({
      where: { id: assignment.id },
      data: { status: "ready_for_pickup", readyAt: new Date() },
    });
    await createEvent(tx, {
      deliveryOrderId: record.id,
      orderId,
      source: "MANUFACTURER",
      eventType: "READY_TO_DELIVER",
      fromState: existing?.state || assignment.status,
      toState: "SUBMISSION_PENDING",
      actorId: manufacturerId,
      idempotencyKey: `READY_TO_DELIVER:${record.id}:${record.packageVersion}`,
    });
    return record;
  });

  return { delivery, input };
};

export const submitDeliveryToNcm = async (deliveryId) => {
  const delivery = await prisma.deliveryOrder.findUnique({ where: { id: deliveryId } });
  if (!delivery) throw new Error("Delivery not found");
  if (delivery.ncmOrderId) return delivery;
  if (delivery.state !== "SUBMISSION_PENDING") throw new Error(`Delivery is not awaiting submission: ${delivery.state}`);

  const order = await prisma.order.findUnique({ where: { id: delivery.orderId } });
  const manufacturer = await prisma.manufacturer.findUnique({ where: { id: delivery.manufacturerId } });
  const assignment = await prisma.orderAssignment.findUnique({ where: { orderId: delivery.orderId } });
  const input = buildDeliveryInput({ order, assignment, manufacturer });
  const attemptKey = `NCM_CREATE:${delivery.id}:${delivery.packageVersion}`;
  const priorAttempt = await prisma.ncmRequestAttempt.findUnique({ where: { idempotencyKey: attemptKey } });
  if (priorAttempt?.result === "SUCCESS") return prisma.deliveryOrder.findUnique({ where: { id: delivery.id } });

  const attempt = priorAttempt || await prisma.ncmRequestAttempt.create({
    data: {
      deliveryOrderId: delivery.id,
      operation: "CREATE_ORDER",
      idempotencyKey: attemptKey,
      attemptNumber: 1,
      requestUrl: "/api/v1/order/create",
      requestJson: {
        name: input.name,
        phone: input.phone,
        customerAddress: input.customerAddress,
        origin: input.origin,
        destination: input.destination,
        deliveryType: input.deliveryType,
        vendorReference: input.vendorReference,
        codAmount: input.codAmount,
      },
      result: "STARTED",
    },
  });

  try {
    const rate = await getShippingRate({ creation: input.origin, destination: input.destination, type: input.deliveryType });
    const rateValue = Number(rate.data?.delivery_charge ?? rate.data?.charge ?? rate.data?.shipping_charge ?? 0);
    const response = await createNcmOrder({
      name: input.name,
      phone: input.phone,
      phone2: input.address.phone2 || "",
      cod_charge: String(input.codAmount + rateValue),
      address: input.customerAddress,
      fbranch: input.origin,
      branch: input.destination,
      package: input.packageDescription,
      vref_id: input.vendorReference,
      instruction: String(input.address.deliveryInstruction || "").slice(0, 500),
      delivery_type: input.deliveryType,
      weight: String(Math.max(0.1, Number(delivery.packageWeight || 1))),
    });
    const ncmOrderId = Number(response.data?.orderid);
    if (!Number.isInteger(ncmOrderId)) throw new Error("NCM did not return a valid order ID");

    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.deliveryOrder.update({
        where: { id: delivery.id },
        data: {
          state: "NCM_CREATED",
          ncmOrderId,
          ncmStatus: "Pickup Order Created",
          ncmDeliveryCharge: rateValue,
          customerDeliveryCharge: rateValue,
          ncmCreatedAt: new Date(),
          lastSyncedAt: new Date(),
          nextSyncAt: new Date(Date.now() + 15 * 60 * 1000),
          lastSyncError: null,
        },
      });
      await tx.ncmRequestAttempt.update({
        where: { id: attempt.id },
        data: { result: "SUCCESS", httpStatus: response.httpStatus, responseJson: response.data, finishedAt: new Date() },
      });
      await tx.order.update({ where: { id: delivery.orderId }, data: { fulfillmentStatus: "ncm_created", deliveryJobId: delivery.id } });
      await createEvent(tx, {
        deliveryOrderId: delivery.id,
        orderId: delivery.orderId,
        source: "SYSTEM",
        eventType: "NCM_ORDER_CREATED",
        fromState: "SUBMISSION_PENDING",
        toState: "NCM_CREATED",
        ncmStatus: "Pickup Order Created",
        payloadJson: { orderid: ncmOrderId },
        idempotencyKey: `NCM_ORDER_CREATED:${delivery.id}:${ncmOrderId}`,
      });
      return record;
    });
    return updated;
  } catch (error) {
    await prisma.ncmRequestAttempt.update({
      where: { id: attempt.id },
      data: {
        result: "FAILED",
        httpStatus: error.httpStatus || null,
        responseJson: error.response || null,
        errorCode: error.code || "NCM_REQUEST_FAILED",
        errorMessage: error.message,
        finishedAt: new Date(),
      },
    }).catch(() => {});
    await prisma.deliveryOrder.update({ where: { id: delivery.id }, data: { state: "SUBMISSION_FAILED", lastSyncError: error.message, syncFailureCount: { increment: 1 } } });
    throw error;
  }
};

export const applyNcmStatus = async ({ payload, source = "NCM_WEBHOOK" }) => {
  const ids = payload.order_id ? [String(payload.order_id)] : (payload.order_ids || []).map(String);
  const results = [];
  for (const ncmId of ids) {
    const delivery = await prisma.deliveryOrder.findFirst({ where: { ncmOrderId: Number(ncmId) } });
    if (!delivery) continue;
    const nextState = STATUS_MAP[payload.status] || "EXTERNAL_STATUS_UNMAPPED";
    const eventKey = statusEventKey({ orderId: ncmId, status: payload.status, timestamp: payload.timestamp, event: payload.event });
    const updated = await prisma.$transaction(async (tx) => {
      await createEvent(tx, {
        deliveryOrderId: delivery.id,
        orderId: delivery.orderId,
        source,
        eventType: payload.event || "NCM_STATUS_CHANGED",
        fromState: delivery.state,
        toState: nextState,
        ncmStatus: payload.status || null,
        payloadJson: sanitizePayload(payload),
        occurredAt: payload.timestamp ? new Date(payload.timestamp) : new Date(),
        idempotencyKey: `NCM_STATUS:${eventKey}`,
      });
      const data = {
        ncmStatus: payload.status || delivery.ncmStatus,
        lastSyncedAt: new Date(),
        nextSyncAt: new Date(Date.now() + 30 * 60 * 1000),
        ...(nextState !== "EXTERNAL_STATUS_UNMAPPED" ? { state: nextState } : {}),
        ...(nextState === "PICKUP_CONFIRMED" ? { pickedUpAt: new Date() } : {}),
        ...(nextState === "DELIVERED" ? { deliveredAt: new Date() } : {}),
      };
      const record = await tx.deliveryOrder.update({ where: { id: delivery.id }, data });
      const summary = syncSummary(nextState);
      if (summary) await tx.order.update({ where: { id: delivery.orderId }, data: { fulfillmentStatus: summary } });
      return record;
    });
    results.push(updated);
  }
  return results;
};

export const storeAndApplyWebhook = async (payload) => {
  const ids = payload.order_id ? [String(payload.order_id)] : (payload.order_ids || []).map(String);
  const eventKey = statusEventKey({ orderId: ids.join(","), status: payload.status, timestamp: payload.timestamp, event: payload.event });
  try {
    await prisma.ncmWebhookEvent.create({
      data: {
        eventKey,
        event: payload.event || null,
        orderId: payload.order_id ? String(payload.order_id) : null,
        orderIds: payload.order_ids || null,
        status: payload.status || null,
        timestamp: payload.timestamp ? new Date(payload.timestamp) : null,
        payloadJson: sanitizePayload(payload),
      },
    });
  } catch (error) {
    if (error.code === "P2002") return { duplicate: true, updated: [] };
    throw error;
  }
  try {
    const updated = await applyNcmStatus({ payload });
    await prisma.ncmWebhookEvent.update({ where: { eventKey }, data: { processingStatus: "PROCESSED", processedAt: new Date() } });
    return { duplicate: false, updated };
  } catch (error) {
    await prisma.ncmWebhookEvent.update({ where: { eventKey }, data: { processingStatus: "FAILED", processingError: error.message } }).catch(() => {});
    throw error;
  }
};

const parseNcmOrderId = (payload) => Number(payload.order_id ?? payload.orderid ?? payload.id);

export const storeOrderCommentWebhook = async (payload) => {
  const ncmOrderId = parseNcmOrderId(payload);
  const comments = String(payload.comments ?? payload.comment ?? payload.message ?? "").trim();
  if (!Number.isInteger(ncmOrderId) || ncmOrderId <= 0 || !comments) {
    const error = new Error("Order comment webhook requires a valid order ID and comment");
    error.code = "INVALID_ORDER_COMMENT_WEBHOOK";
    throw error;
  }

  const addedAt = payload.added_time || payload.addedAt || payload.timestamp;
  const eventKey = statusEventKey({
    orderId: String(ncmOrderId),
    status: comments,
    timestamp: addedAt || "",
    event: "order.comment.created",
  });
  const delivery = await prisma.deliveryOrder.findFirst({ where: { ncmOrderId } });

  try {
    const comment = await prisma.deliveryComment.create({
      data: {
        deliveryOrderId: delivery?.id || null,
        ncmOrderId,
        comments,
        addedBy: String(payload.addedBy ?? payload.added_by ?? "NCM").slice(0, 150),
        addedAt: addedAt ? new Date(addedAt) : null,
        payloadJson: sanitizePayload(payload),
        eventKey,
      },
    });

    if (delivery) {
      await createEvent(prisma, {
        deliveryOrderId: delivery.id,
        orderId: delivery.orderId,
        source: "NCM_COMMENT_WEBHOOK",
        eventType: "NCM_COMMENT_RECEIVED",
        ncmStatus: delivery.ncmStatus,
        payloadJson: { commentId: comment.id, comments, addedBy: comment.addedBy },
        idempotencyKey: `NCM_COMMENT:${eventKey}`,
        occurredAt: comment.addedAt || new Date(),
      });
    }
    return { duplicate: false, comment, matchedDelivery: Boolean(delivery) };
  } catch (error) {
    if (error.code === "P2002") return { duplicate: true, matchedDelivery: Boolean(delivery) };
    throw error;
  }
};

export const reconcileDelivery = async (deliveryId) => {
  const delivery = await prisma.deliveryOrder.findUnique({ where: { id: deliveryId } });
  if (!delivery?.ncmOrderId) throw new Error("Delivery has no NCM order ID");
  const [detail, statuses] = await Promise.all([getOrder(delivery.ncmOrderId), getOrderStatus(delivery.ncmOrderId)]);
  const latest = Array.isArray(statuses.data) ? statuses.data[0] : null;
  if (latest?.status) await applyNcmStatus({ payload: { order_id: delivery.ncmOrderId, status: latest.status, timestamp: latest.added_time, event: "NCM_POLL_STATUS" }, source: "NCM_POLL" });
  const deliveryCharge = Number(detail.data?.delivery_charge ?? delivery.ncmDeliveryCharge ?? 0);
  const codAmount = Number(detail.data?.cod_charge ?? delivery.codAmount ?? 0);
  const paymentStatus = detail.data?.payment_status || null;
  await prisma.deliveryFinancialSettlement.upsert({
    where: { deliveryOrderId: delivery.id },
    create: {
      deliveryOrderId: delivery.id,
      ncmOrderId: delivery.ncmOrderId,
      codExpected: codAmount,
      deliveryFeeExpected: Number(delivery.customerDeliveryCharge || 0),
      deliveryFeeActual: deliveryCharge,
      settlementState: "PENDING",
    },
    update: {
      ncmOrderId: delivery.ncmOrderId,
      codExpected: codAmount,
      deliveryFeeActual: deliveryCharge,
    },
  });
  return prisma.deliveryOrder.update({ where: { id: delivery.id }, data: { lastSyncedAt: new Date(), nextSyncAt: new Date(Date.now() + 30 * 60 * 1000), ncmPaymentStatus: paymentStatus, ncmDeliveryCharge: deliveryCharge, syncFailureCount: 0, lastSyncError: null } });
};

export const reconcileActiveDeliveries = async () => {
  const active = await prisma.deliveryOrder.findMany({
    where: { ncmOrderId: { not: null }, state: { in: ["NCM_CREATED", "PICKUP_CONFIRMED", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "OUT_FOR_DELIVERY"] } },
    select: { id: true, ncmOrderId: true },
    take: 100,
  });
  if (!active.length) return [];
  const statusResponse = await getBulkOrderStatuses(active.map((item) => item.ncmOrderId));
  const result = statusResponse.data?.result || {};
  for (const item of active) {
    if (result[String(item.ncmOrderId)]) {
      await applyNcmStatus({ payload: { order_id: item.ncmOrderId, status: result[String(item.ncmOrderId)], event: "NCM_BULK_STATUS" }, source: "NCM_POLL" });
    }
  }
  return active;
};

export const requestDeliveryReturn = async ({ deliveryId, manufacturerId, reason }) => {
  const delivery = await prisma.deliveryOrder.findUnique({ where: { id: deliveryId } });
  if (!delivery || delivery.manufacturerId !== manufacturerId || !delivery.ncmOrderId) throw new Error("Delivery not found or not eligible for return");
  const existing = await prisma.deliveryReturn.findUnique({ where: { deliveryOrderId: deliveryId } });
  if (existing) return existing;
  const response = await requestOrderReturn({ pk: delivery.ncmOrderId, comment: reason });
  return prisma.$transaction(async (tx) => {
    const returned = await tx.deliveryReturn.create({ data: { deliveryOrderId: deliveryId, orderId: delivery.orderId, manufacturerId, returnReason: reason, ncmReturnComment: reason, ncmReturnRequestedAt: new Date(), state: "RETURN_REQUESTED" } });
    await tx.deliveryOrder.update({ where: { id: deliveryId }, data: { state: "RETURN_REQUESTED", ncmStatus: "Return Requested" } });
    await tx.order.update({ where: { id: delivery.orderId }, data: { fulfillmentStatus: "return_requested" } });
    await createEvent(tx, { deliveryOrderId: deliveryId, orderId: delivery.orderId, source: "MANUFACTURER", eventType: "RETURN_REQUESTED", fromState: delivery.state, toState: "RETURN_REQUESTED", actorId: manufacturerId, payloadJson: response.data, idempotencyKey: `RETURN_REQUESTED:${deliveryId}` });
    return returned;
  });
};

export { STATUS_MAP, deliveryTypeForNcm, statusEventKey };
