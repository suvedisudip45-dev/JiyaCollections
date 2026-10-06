import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { extractNcmCharge, getNcmErrorMessage, getNcmResponseRejection, getOrder, requestOrderReturn } from "./ncmClient.js";
import { syncProductStock } from "./stockSyncService.js";
import { postCustomerReturnAccounting } from "./accountingPostingEngine.js";
import { applyCollaborationReturnAdjustments } from "./collaborationSalesService.js";
import { recordSystemAudit } from "./auditService.js";

const ACTIVE_RETURN_STATES = [
  "PENDING_ADMIN_REVIEW",
  "APPROVED_BY_ADMIN",
  "SUBMITTING",
  "NCM_SUBMISSION_UNKNOWN",
  "NCM_RETURN_INITIATED",
  "RETURN_IN_TRANSIT",
  "RECEIVED_AT_WAREHOUSE",
  "REFUND_PENDING",
];

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

const parseObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const normalize = (value) => String(value || "").trim().toLowerCase();
const itemKey = (item) => [String(item.productId || ""), normalize(item.size), normalize(item.color)].join("|");
const fail = (message, code, status = 400) => Object.assign(new Error(message), { code, status });

export const returnItemsFromOrder = (orderItems, requestedItems, previousReturns = []) => {
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
      unitCostPrice: Number(item.agreedUnitCogsVatInclusiveAtAcceptance ?? item.costPrice ?? 0),
    };
    const key = itemKey(snapshot);
    const existing = purchased.get(key);
    if (existing) existing.quantity += snapshot.quantity;
    else purchased.set(key, snapshot);
  }

  const alreadyRequested = new Map();
  for (const returnRecord of previousReturns) {
    for (const item of parseArray(returnRecord.items)) {
      const key = itemKey(item);
      alreadyRequested.set(key, (alreadyRequested.get(key) || 0) + Number(item.quantity || 0));
    }
  }

  const selected = new Map();
  for (const item of requestedItems) {
    const productId = String(item.productId || item._id || item.id || "");
    const quantity = Number(item.quantity);
    const key = itemKey({ productId, size: item.size, color: item.color });
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
      throw fail("Choose a product and a positive whole-number quantity for every return item.", "INVALID_RETURN_ITEMS");
    }
    selected.set(key, (selected.get(key) || 0) + quantity);
  }
  if (!selected.size) throw fail("Select at least one item to return.", "INVALID_RETURN_ITEMS");

  return [...selected.entries()].map(([key, quantity]) => {
    const purchase = purchased.get(key);
    if (!purchase || quantity + (alreadyRequested.get(key) || 0) > purchase.quantity) {
      throw fail("The requested return quantity exceeds the quantity purchased or already returned.", "RETURN_QUANTITY_EXCEEDED", 409);
    }
    return { ...purchase, quantity, refundAmount: Number((purchase.unitPrice * quantity).toFixed(2)), condition: "PENDING_INSPECTION" };
  });
};

const hashRequest = ({ orderId, reason, items }) => createHash("sha256")
  .update(JSON.stringify({
    orderId,
    reason: String(reason || "").trim(),
    items: items.map((item) => ({ ...item, quantity: Number(item.quantity) })).sort((a, b) => itemKey(a).localeCompare(itemKey(b))),
  }))
  .digest("hex");

const addReturnEvent = (tx, { returnId, eventType, fromStatus, toStatus, actorId, actorRole, reason, metadata, idempotencyKey }) =>
  tx.customerReturnEvent.create({
    data: {
      customerReturnId: returnId,
      eventType,
      fromStatus: fromStatus || null,
      toStatus: toStatus || null,
      actorId: actorId || null,
      actorRole: actorRole || "SYSTEM",
      reason: reason || null,
      ...(metadata === undefined ? {} : { metadata }),
      idempotencyKey,
    },
  });

const getOrderForRequest = async ({ orderId, customerId }) => {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...(customerId ? { userId: customerId } : {}) },
    include: { deliveryOrder: true },
  });
  if (!order) throw fail("Delivered order not found.", "ORDER_NOT_FOUND", 404);
  if (normalize(order.status) !== "delivered" && order.deliveryOrder?.state !== "DELIVERED") {
    throw fail("Returns can only be requested for delivered orders.", "ORDER_NOT_DELIVERED", 409);
  }
  const ncmOrderId = Number(order.deliveryOrder?.ncmOrderId);
  if (!Number.isInteger(ncmOrderId) || ncmOrderId <= 0) {
    throw fail("The original delivery has no NCM order ID, so a carrier return cannot be created.", "NCM_ORDER_ID_MISSING", 409);
  }
  return { ...order, ncmOrderId };
};

export const createCustomerReturnRequest = async ({ orderId, customerId, adminId, actorRole = "CUSTOMER", requestKey, reason, items }) => {
  const normalizedReason = String(reason || "").trim();
  const key = String(requestKey || randomUUID()).trim();
  if (!orderId || !normalizedReason || normalizedReason.length > 2000 || !Array.isArray(items) || items.length === 0 || items.length > 100 || key.length > 128) {
    throw fail("Order, return reason, and valid item selections are required.", "INVALID_RETURN_REQUEST");
  }

  const order = await getOrderForRequest({ orderId, customerId });
  const user = await prisma.user.findUnique({ where: { id: order.userId }, select: { name: true, phone: true } });
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.customerReturn.findUnique({ where: { requestKey: key } });
    const requestHash = hashRequest({ orderId, reason: normalizedReason, items });
    if (existing) {
      if (existing.userId !== order.userId || existing.orderId !== orderId || existing.requestHash !== requestHash) {
        throw fail("This return request key was already used for different details.", "IDEMPOTENCY_KEY_CONFLICT", 409);
      }
      return { returnRecord: existing, duplicate: true };
    }

    const openReturn = await tx.customerReturn.findFirst({
      where: { orderId, requestKey: { not: null }, lifecycleStatus: { in: ACTIVE_RETURN_STATES } },
      select: { id: true },
    });
    if (openReturn) throw fail("This order already has an open return request.", "RETURN_ALREADY_OPEN", 409);
    const previousReturns = await tx.customerReturn.findMany({
      where: {
        orderId,
        OR: [
          { lifecycleStatus: "REFUNDED" },
          { requestKey: null, refundStatus: "COMPLETED" },
        ],
      },
      select: { items: true },
    });
    const processedItems = returnItemsFromOrder(order.items, items, previousReturns);
    const totalRefundAmount = processedItems.reduce((sum, item) => sum + item.refundAmount, 0);
    const vatRefunded = Number((totalRefundAmount - (totalRefundAmount / 1.13)).toFixed(2));
    const created = await tx.customerReturn.create({
      data: {
        requestKey: key,
        requestHash,
        orderId,
        userId: order.userId,
        manufacturerId: order.manufacturerId,
        customerName: user?.name || "Customer",
        customerPhone: user?.phone || String(parseObject(order.address).phone || ""),
        items: processedItems,
        totalRefundAmount,
        vatRefunded,
        refundStatus: "PENDING",
        inventoryAction: "PENDING_INSPECTION",
        reason: normalizedReason,
        lifecycleStatus: "PENDING_ADMIN_REVIEW",
        originalNcmOrderId: order.ncmOrderId,
      },
    });
    await addReturnEvent(tx, {
      returnId: created.id,
      eventType: "REQUESTED",
      toStatus: "PENDING_ADMIN_REVIEW",
      actorId: actorRole === "ADMIN" ? adminId : customerId,
      actorRole,
      reason: normalizedReason,
      metadata: { items: processedItems, originalNcmOrderId: order.ncmOrderId },
      idempotencyKey: `RETURN:${created.id}:REQUESTED`,
    });
    return { returnRecord: created, duplicate: false };
  }, { isolationLevel: "Serializable" });

  return result;
};

export const listCustomerReturnRequests = ({ customerId }) => prisma.customerReturn.findMany({
  where: { userId: customerId, requestKey: { not: null } },
  include: { events: { orderBy: { occurredAt: "asc" } }, ncmAttempts: { orderBy: { attemptNumber: "asc" } } },
  orderBy: { createdAt: "desc" },
});

export const listAdminCustomerReturns = async ({ skip = 0, take = 30, status }) => {
  const where = { requestKey: { not: null }, ...(status ? { lifecycleStatus: status } : {}) };
  const [returns, total] = await prisma.$transaction([
    prisma.customerReturn.findMany({
      where,
      include: { events: { orderBy: { occurredAt: "asc" } }, ncmAttempts: { orderBy: { attemptNumber: "asc" } } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.customerReturn.count({ where }),
  ]);
  return { returns, total };
};

export const listManufacturerCustomerReturns = ({ manufacturerId }) => prisma.customerReturn.findMany({
  where: {
    manufacturerId,
    requestKey: { not: null },
    lifecycleStatus: { in: ["NCM_RETURN_INITIATED", "RETURN_IN_TRANSIT", "RECEIVED_AT_WAREHOUSE", "REFUND_PENDING", "REFUNDED"] },
  },
  include: { events: { orderBy: { occurredAt: "asc" } } },
  orderBy: { createdAt: "desc" },
});

export const submitApprovedCustomerReturn = async ({ returnId, adminId, retry = false, chargePayer }) => {
  const submission = await prisma.$transaction(async (tx) => {
    const current = await tx.customerReturn.findUnique({ where: { id: returnId } });
    if (!current) throw fail("Return request not found.", "RETURN_NOT_FOUND", 404);
    const allowed = retry
      ? ["NCM_REJECTED", "APPROVED_BY_ADMIN"].includes(current.lifecycleStatus)
      : current.lifecycleStatus === "APPROVED_BY_ADMIN";
    if (!allowed) throw fail("This return request is not ready for admin approval or retry.", "RETURN_NOT_SUBMITTABLE", 409);

    const previousStatus = current.lifecycleStatus;
    const submittedAt = new Date();
    const attemptNumber = await tx.returnExchangeNcmAttempt.count({ where: { customerReturnId: current.id, operation: "MARK_RETURN" } }) + 1;
    const attemptKey = `RETURN:${current.id}:MARK_RETURN:${attemptNumber}`;
    const requestJson = { pk: current.originalNcmOrderId, comment: current.reason };
    const claimed = await tx.customerReturn.updateMany({
      where: { id: current.id, lifecycleStatus: previousStatus },
      data: {
        lifecycleStatus: "SUBMITTING",
        adminReviewerId: adminId,
        approvedAt: current.approvedAt || submittedAt,
        ncmChargePayer: chargePayer === "CUSTOMER" ? "CUSTOMER" : current.ncmChargePayer,
        ncmSubmissionAttemptedAt: submittedAt,
        ncmSubmissionError: null,
      },
    });
    if (claimed.count !== 1) throw fail("Another admin action is already processing this return.", "RETURN_SUBMISSION_CONFLICT", 409);

    const attempt = await tx.returnExchangeNcmAttempt.create({
      data: {
        customerReturnId: current.id,
        operation: "MARK_RETURN",
        idempotencyKey: attemptKey,
        attemptNumber,
        requestUrl: "/api/v2/vendor/order/return",
        requestJson,
        result: "STARTED",
      },
    });
    await addReturnEvent(tx, {
      returnId: current.id,
      eventType: "NCM_SUBMISSION_STARTED",
      fromStatus: previousStatus,
      toStatus: "SUBMITTING",
      actorId: adminId,
      actorRole: "SYSTEM",
      metadata: { attemptNumber, requestJson },
      idempotencyKey: attemptKey,
    });
    return { current, attempt, requestJson };
  }, { isolationLevel: "Serializable" });

  try {
    const response = await requestOrderReturn(submission.requestJson);
    const rejection = getNcmResponseRejection(response.data);
    if (rejection) {
      throw Object.assign(new Error(rejection), {
        code: "NCM_RESPONSE_REJECTED",
        httpStatus: response.httpStatus,
        response: response.data,
      });
    }
    const returnResponseCharge = extractNcmCharge(response.data);
    const orderDetailResult = await getOrder(submission.current.originalNcmOrderId).then(
      (result) => ({ status: "fulfilled", data: result.data, attemptHistory: result.attemptHistory || [] }),
      (error) => ({ status: "rejected", error: getNcmErrorMessage(error), attemptHistory: error.attemptHistory || [] }),
    );
    const charge = returnResponseCharge ?? (orderDetailResult.status === "fulfilled" ? extractNcmCharge(orderDetailResult.data) : null);
    const chargeSource = returnResponseCharge !== null
      ? "RETURN_RESPONSE"
      : charge !== null ? "ORDER_DETAIL" : null;
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.customerReturn.update({
        where: { id: returnId },
        data: {
          lifecycleStatus: "NCM_RETURN_INITIATED",
          ncmReturnOrderId: submission.current.originalNcmOrderId,
          returnPickupStatus: "AWAITING_PICKUP",
          ncmDeliveryCharge: charge,
          ncmChargeSource: chargeSource,
          ncmSubmissionError: null,
        },
      });
      await tx.returnExchangeNcmAttempt.update({
        where: { id: submission.attempt.id },
        data: {
          result: "SUCCESS",
          httpStatus: response.httpStatus,
          responseJson: {
            returnResponse: response.data,
            returnAttemptHistory: response.attemptHistory || [],
            orderDetail: orderDetailResult.status === "fulfilled" ? orderDetailResult.data : null,
            orderDetailError: orderDetailResult.status === "rejected" ? orderDetailResult.error : null,
            orderDetailAttemptHistory: orderDetailResult.attemptHistory,
          },
          finishedAt: new Date(),
        },
      });
      await addReturnEvent(tx, {
        returnId,
        eventType: "NCM_RETURN_INITIATED",
        fromStatus: "SUBMITTING",
        toStatus: "NCM_RETURN_INITIATED",
        actorId: adminId,
        actorRole: "SYSTEM",
        metadata: { ncmOrderId: updated.ncmReturnOrderId, ncmDeliveryCharge: charge, ncmChargeSource: chargeSource, ncmResponse: response.data },
        idempotencyKey: `${submission.attempt.id}:SUCCESS`,
      });
      return updated;
    });
  } catch (error) {
    const message = getNcmErrorMessage(error);
    const rejected = error.code === "NCM_RESPONSE_REJECTED" || (Number(error.httpStatus) >= 400 && Number(error.httpStatus) < 500);
    const nextStatus = rejected ? "NCM_REJECTED" : "NCM_SUBMISSION_UNKNOWN";
    return prisma.$transaction(async (tx) => {
      const updated = await tx.customerReturn.update({
        where: { id: returnId },
        data: { lifecycleStatus: nextStatus, ncmSubmissionError: message },
      });
      await tx.returnExchangeNcmAttempt.update({
        where: { id: submission.attempt.id },
        data: {
          result: rejected ? "FAILED" : "UNKNOWN",
          httpStatus: error.httpStatus || null,
          responseJson: { response: error.response || null, attemptHistory: error.attemptHistory || [] },
          errorCode: error.code || "NCM_RETURN_FAILED",
          errorMessage: message,
          finishedAt: new Date(),
        },
      });
      await addReturnEvent(tx, {
        returnId,
        eventType: nextStatus,
        fromStatus: "SUBMITTING",
        toStatus: nextStatus,
        actorRole: "SYSTEM",
        reason: message,
        metadata: { httpStatus: error.httpStatus || null, errorCode: error.code || null, response: error.response || null },
        idempotencyKey: `${submission.attempt.id}:${nextStatus}`,
      });
      return updated;
    });
  }
};

export const resolveUnknownCustomerReturn = async ({ returnId, adminId, outcome, reason }) => {
  const resolution = String(outcome || "").trim().toUpperCase();
  const resolutionReason = String(reason || "").trim();
  if (!returnId || !["FOUND", "NOT_CREATED"].includes(resolution) || resolutionReason.length < 5) {
    throw fail("Choose the verified NCM return outcome and provide investigation notes.", "INVALID_RETURN_NCM_RESOLUTION");
  }
  return prisma.$transaction(async (tx) => {
    const current = await tx.customerReturn.findUnique({ where: { id: returnId } });
    if (!current) throw fail("Return request not found.", "RETURN_NOT_FOUND", 404);
    if (!["SUBMITTING", "NCM_SUBMISSION_UNKNOWN"].includes(current.lifecycleStatus)) {
      throw fail("Only a return with an unknown NCM result can be reconciled.", "RETURN_NOT_UNKNOWN", 409);
    }
    if (current.lifecycleStatus === "SUBMITTING" && current.ncmSubmissionAttemptedAt && Date.now() - current.ncmSubmissionAttemptedAt.getTime() < 120000) {
      throw fail("The NCM return request may still be in progress. Wait two minutes before resolving it manually.", "NCM_SUBMISSION_STILL_ACTIVE", 409);
    }
    const nextStatus = resolution === "FOUND" ? "NCM_RETURN_INITIATED" : "NCM_REJECTED";
    const claimed = await tx.customerReturn.updateMany({
      where: { id: current.id, lifecycleStatus: current.lifecycleStatus },
      data: resolution === "FOUND"
        ? {
            lifecycleStatus: nextStatus,
            ncmReturnOrderId: current.originalNcmOrderId,
            returnPickupStatus: "AWAITING_PICKUP",
            ncmSubmissionError: null,
          }
        : { lifecycleStatus: nextStatus, ncmSubmissionError: resolutionReason },
    });
    if (claimed.count !== 1) throw fail("This NCM return result was already resolved.", "RETURN_NCM_RESOLUTION_CONFLICT", 409);
    const attempt = await tx.returnExchangeNcmAttempt.findFirst({
      where: { customerReturnId: current.id, operation: "MARK_RETURN" },
      orderBy: { attemptNumber: "desc" },
    });
    if (attempt) {
      await tx.returnExchangeNcmAttempt.update({
        where: { id: attempt.id },
        data: {
          result: resolution === "FOUND" ? "RESOLVED_SUCCESS" : "RESOLVED_NOT_CREATED",
          errorMessage: resolution === "NOT_CREATED" ? resolutionReason : attempt.errorMessage,
          finishedAt: new Date(),
        },
      });
    }
    await addReturnEvent(tx, {
      returnId: current.id,
      eventType: resolution === "FOUND" ? "NCM_OUTCOME_CONFIRMED_CREATED" : "NCM_OUTCOME_CONFIRMED_NOT_CREATED",
      fromStatus: current.lifecycleStatus,
      toStatus: nextStatus,
      actorId: adminId,
      actorRole: "ADMIN",
      reason: resolutionReason,
      metadata: { originalNcmOrderId: current.originalNcmOrderId },
      idempotencyKey: `RETURN:${current.id}:NCM_RESOLUTION:${current.ncmSubmissionAttemptedAt?.getTime() || current.updatedAt.getTime()}`,
    });
    return tx.customerReturn.findUnique({ where: { id: current.id } });
  }, { isolationLevel: "Serializable" });
};

export const decideCustomerReturnRequest = async ({ returnId, adminId, actorContext, decision, reason, chargePayer }) => {
  const selected = String(decision || "").trim().toUpperCase();
  const decisionReason = String(reason || "").trim();
  if (!returnId || !["APPROVE", "REJECT"].includes(selected) || decisionReason.length < 3) {
    throw fail("Choose approve or reject and provide a decision reason.", "INVALID_RETURN_DECISION");
  }
  if (selected === "APPROVE") {
    await prisma.$transaction(async (tx) => {
      const current = await tx.customerReturn.findUnique({ where: { id: returnId } });
      if (!current || current.lifecycleStatus !== "PENDING_ADMIN_REVIEW") throw fail("Only pending return requests can be approved.", "RETURN_ALREADY_REVIEWED", 409);
      const updated = await tx.customerReturn.updateMany({
        where: { id: returnId, lifecycleStatus: "PENDING_ADMIN_REVIEW" },
        data: {
          lifecycleStatus: "APPROVED_BY_ADMIN",
          adminReviewerId: adminId,
          adminNotes: decisionReason,
          approvedAt: new Date(),
          ncmChargePayer: chargePayer === "CUSTOMER" ? "CUSTOMER" : "MERCHANT",
        },
      });
      if (updated.count !== 1) throw fail("This return request was reviewed by another admin.", "RETURN_ALREADY_REVIEWED", 409);
      await addReturnEvent(tx, {
        returnId,
        eventType: "APPROVED_BY_ADMIN",
        fromStatus: "PENDING_ADMIN_REVIEW",
        toStatus: "APPROVED_BY_ADMIN",
        actorId: adminId,
        actorRole: "ADMIN",
        reason: decisionReason,
        idempotencyKey: `RETURN:${returnId}:APPROVED_BY_ADMIN`,
      });
      await recordSystemAudit(actorContext, {
        action: "CUSTOMER_RETURN_APPROVED",
        entityType: "CustomerReturn",
        entityId: returnId,
        beforeState: { lifecycleStatus: current.lifecycleStatus },
        afterState: {
          lifecycleStatus: "APPROVED_BY_ADMIN",
          chargePayer: chargePayer === "CUSTOMER" ? "CUSTOMER" : "MERCHANT",
        },
      }, { client: tx });
    }, { isolationLevel: "Serializable" });
    return submitApprovedCustomerReturn({ returnId, adminId, chargePayer });
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.customerReturn.findUnique({ where: { id: returnId } });
    if (!current || !["PENDING_ADMIN_REVIEW", "NCM_REJECTED"].includes(current.lifecycleStatus)) throw fail("Only pending or NCM-rejected return requests can be closed.", "RETURN_ALREADY_REVIEWED", 409);
    const claimed = await tx.customerReturn.updateMany({
      where: { id: returnId, lifecycleStatus: current.lifecycleStatus },
      data: { lifecycleStatus: "REJECTED_BY_ADMIN", refundStatus: "REJECTED", adminReviewerId: adminId, adminNotes: decisionReason },
    });
    if (claimed.count !== 1) throw fail("This return request was reviewed by another admin.", "RETURN_ALREADY_REVIEWED", 409);
    await addReturnEvent(tx, {
      returnId,
      eventType: "REJECTED_BY_ADMIN",
      fromStatus: current.lifecycleStatus,
      toStatus: "REJECTED_BY_ADMIN",
      actorId: adminId,
      actorRole: "ADMIN",
      reason: decisionReason,
      idempotencyKey: `RETURN:${returnId}:REJECTED_BY_ADMIN`,
    });
    await recordSystemAudit(actorContext, {
      action: "CUSTOMER_RETURN_REJECTED",
      entityType: "CustomerReturn",
      entityId: returnId,
      beforeState: { lifecycleStatus: current.lifecycleStatus, refundStatus: current.refundStatus },
      afterState: { lifecycleStatus: "REJECTED_BY_ADMIN", refundStatus: "REJECTED" },
    }, { client: tx });
    return tx.customerReturn.findUnique({ where: { id: returnId } });
  }, { isolationLevel: "Serializable" });
};

export const inspectCustomerReturn = async ({ returnId, adminId, actorContext, result, notes }) => {
  const inspection = String(result || "").trim().toUpperCase();
  const inspectionNotes = String(notes || "").trim();
  if (!returnId || !["RESTOCKABLE", "DAMAGED", "MISSING", "DISPUTED"].includes(inspection)) {
    throw fail("Choose a valid return inspection result.", "INVALID_RETURN_INSPECTION");
  }
  if (["DAMAGED", "MISSING", "DISPUTED"].includes(inspection) && inspectionNotes.length < 5) {
    throw fail("Add inspection notes for damaged, missing, or disputed items.", "RETURN_INSPECTION_NOTES_REQUIRED");
  }

  let restockedInventoryCost = 0;
  const record = await prisma.$transaction(async (tx) => {
    const current = await tx.customerReturn.findUnique({ where: { id: returnId } });
    if (!current) throw fail("Return request not found.", "RETURN_NOT_FOUND", 404);
    if (current.lifecycleStatus !== "RECEIVED_AT_WAREHOUSE") throw fail("The returned parcel must be received before inspection.", "RETURN_NOT_RECEIVED", 409);
    if (current.inspectedAt) throw fail("This return has already been inspected.", "RETURN_ALREADY_INSPECTED", 409);

    const items = parseArray(current.items);
    if (inspection === "RESTOCKABLE") {
      const originalOrder = await tx.order.findUnique({ where: { id: current.orderId }, select: { items: true } });
      const orderItems = parseArray(originalOrder?.items);
      const consumedAllocations = current.manufacturerId
        ? await tx.manufacturerInventoryCostAllocation.findMany({
          where: { orderId: current.orderId, state: "CONSUMED" },
          include: { costLayer: true },
          orderBy: [{ orderItemIndex: "asc" }, { createdAt: "asc" }],
        })
        : [];
      for (const item of items) {
        let remainingReturnQuantity = Number(item.quantity || 0);
        const matchingOrderItems = orderItems
          .map((orderItem, orderItemIndex) => ({ orderItem, orderItemIndex }))
          .filter(({ orderItem }) =>
            String(orderItem.productId || orderItem._id || orderItem.id || "") === String(item.productId)
            && normalize(orderItem.size || "Standard") === normalize(item.size || "Standard")
            && normalize(orderItem.color || "Standard") === normalize(item.color || "Standard")
          );
        for (const { orderItem, orderItemIndex } of matchingOrderItems) {
          for (const allocation of consumedAllocations.filter((entry) => entry.orderItemIndex === orderItemIndex)) {
            if (!remainingReturnQuantity) break;
            const restorableQuantity = allocation.quantity - allocation.returnedQuantity;
            if (restorableQuantity <= 0) continue;
            const quantity = Math.min(remainingReturnQuantity, restorableQuantity);
            const claimed = await tx.manufacturerInventoryCostAllocation.updateMany({
              where: {
                id: allocation.id,
                returnedQuantity: allocation.returnedQuantity,
                state: "CONSUMED",
              },
              data: { returnedQuantity: { increment: quantity } },
            });
            if (claimed.count !== 1) throw fail("Production return allocation changed during inspection. Retry the return inspection.", "RETURN_ALLOCATION_CONFLICT", 409);
            await tx.manufacturerInventoryCostLayer.update({
              where: { id: allocation.costLayerId },
              data: {
                consumedQuantity: { decrement: quantity },
                availableQuantity: { increment: quantity },
              },
            });
            restockedInventoryCost += Number(allocation.costLayer.unitCogs) * quantity;
            remainingReturnQuantity -= quantity;
          }
        }
        restockedInventoryCost += Number(item.unitCostPrice || 0) * remainingReturnQuantity;
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) throw fail(`Product not found for returned item ${item.name || item.productId}.`, "RETURN_PRODUCT_NOT_FOUND", 409);
        const inventory = current.manufacturerId
          ? await tx.manufacturerInventory.findUnique({ where: { manufacturerId_productId: { manufacturerId: current.manufacturerId, productId: item.productId } } })
          : null;
        if (inventory) {
          const variants = parseArray(inventory.variantsStock);
          const hasVariants = variants.length > 0;
          const matchVariant = (variant) => normalize(variant.size || "Standard") === normalize(item.size || "Standard") && normalize(variant.color || "Standard") === normalize(item.color || "Standard");
          const nextVariants = hasVariants
            ? variants.map((variant) => matchVariant(variant) ? { ...variant, quantity: Number(variant.quantity || 0) + Number(item.quantity || 0) } : variant)
            : variants;
          if (hasVariants && !variants.some(matchVariant)) throw fail(`Manufacturer inventory has no matching variant for ${item.name || item.productId}.`, "RETURN_INVENTORY_VARIANT_MISSING", 409);
          await tx.manufacturerInventory.update({
            where: { manufacturerId_productId: { manufacturerId: current.manufacturerId, productId: item.productId } },
            data: { quantity: { increment: Number(item.quantity || 0) }, ...(hasVariants ? { variantsStock: nextVariants } : {}) },
          });
          await syncProductStock(item.productId, { client: tx, throwOnError: true });
        } else {
          const variants = parseArray(product.variants);
          const nextVariants = variants.map((variant) => (
            normalize(variant.size || "Standard") === normalize(item.size || "Standard") && normalize(variant.color || "Standard") === normalize(item.color || "Standard")
              ? { ...variant, quantity: Number(variant.quantity || 0) + Number(item.quantity || 0) }
              : variant
          ));
          await tx.product.update({
            where: { id: product.id },
            data: { stockQuantity: { increment: Number(item.quantity || 0) }, ...(variants.length ? { variants: nextVariants } : {}) },
          });
        }
        await tx.stockLog.create({
          data: {
            productId: item.productId,
            productName: product.name,
            variantLabel: item.size && item.color ? `${item.size} / ${item.color}` : "",
            previousQty: product.stockQuantity,
            newQty: product.stockQuantity + Number(item.quantity || 0),
            changeQty: Number(item.quantity || 0),
            reason: `Customer return restocked (${current.id.slice(0, 8)})`,
            orderId: current.orderId,
            source: "return",
          },
        });
      }
    } else {
      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { id: true, name: true, stockQuantity: true } });
        if (!product) continue;
        await tx.stockLog.create({
          data: {
            productId: product.id,
            productName: product.name,
            variantLabel: item.size && item.color ? `${item.size} / ${item.color}` : "",
            previousQty: product.stockQuantity,
            newQty: product.stockQuantity,
            changeQty: 0,
            reason: `Customer return written off (${current.id.slice(0, 8)})`,
            note: `${inspection}: ${inspectionNotes}`,
            orderId: current.orderId,
            source: "damage_scrap",
          },
        });
      }
    }

    const now = new Date();
    const returnAccepted = inspection === "RESTOCKABLE" || inspection === "DAMAGED";
    const nextStatus = returnAccepted ? "REFUND_PENDING" : "INSPECTED_FAILED";
    const updated = await tx.customerReturn.update({
      where: { id: current.id },
      data: {
        lifecycleStatus: nextStatus,
        refundStatus: returnAccepted ? "PENDING" : "REJECTED",
        inventoryAction: inspection === "RESTOCKABLE" ? "RESTOCKED" : "WRITTEN_OFF_DAMAGED",
        inspectionResult: inspection,
        notes: inspectionNotes ? `${current.notes || ""}\nInspection: ${inspectionNotes}`.trim() : current.notes,
        inspectedAt: now,
      },
    });
    if (returnAccepted) {
      await tx.accountPayable.create({
        data: {
          title: `Customer Refund: RMA #${current.id.slice(0, 8)} (${current.customerName})`,
          payeeName: current.customerName,
          category: "OPERATING_EXPENSE",
          referenceType: "CUSTOMER_REFUND",
          referenceId: current.id,
          totalAmount: current.totalRefundAmount,
          paidAmount: 0,
          remainingBalance: current.totalRefundAmount,
          status: "UNPAID",
          priority: "HIGH",
          notes: `Approved customer return refund. NCM charge: ${current.ncmDeliveryCharge ?? "not supplied"}; payer: ${current.ncmChargePayer}.`,
        },
      });
      await applyCollaborationReturnAdjustments({ orderId: current.orderId, items, returnedAt: now, client: tx });
    }
    await addReturnEvent(tx, {
      returnId: current.id,
      eventType: returnAccepted ? "INSPECTED_PASSED" : "INSPECTED_FAILED",
      fromStatus: current.lifecycleStatus,
      toStatus: nextStatus,
      actorId: adminId,
      actorRole: "ADMIN",
      reason: inspectionNotes || inspection,
      metadata: { result: inspection, refundAmount: current.totalRefundAmount, ncmDeliveryCharge: current.ncmDeliveryCharge },
      idempotencyKey: `RETURN:${current.id}:INSPECTED:${inspection}`,
    });
    await recordSystemAudit(actorContext, {
      action: "CUSTOMER_RETURN_INSPECTED",
      entityType: "CustomerReturn",
      entityId: current.id,
      beforeState: {
        lifecycleStatus: current.lifecycleStatus,
        inspectionResult: current.inspectionResult,
        refundStatus: current.refundStatus,
      },
      afterState: {
        lifecycleStatus: nextStatus,
        inspectionResult: inspection,
        refundStatus: returnAccepted ? "PENDING" : "REJECTED",
      },
    }, { client: tx });
    return updated;
  }, { isolationLevel: "Serializable" });

  if (record.lifecycleStatus === "REFUND_PENDING") {
    postCustomerReturnAccounting({
      ...record,
      restockedInventoryCost: inspection === "RESTOCKABLE" ? restockedInventoryCost : 0,
    }, { recordAsPayable: true }).catch((error) => {
      console.error("Customer return accounting post failed", { returnId: record.id, error: error.message });
    });
  }
  return record;
};

export const nextCustomerReturnNcmState = ({ currentStatus, currentPickupStatus, status, event }) => {
  const statusText = normalize(status || event).replace(/[_-]+/g, " ");
  let lifecycleStatus = currentStatus;
  let returnPickupStatus = currentPickupStatus;
  if (["sent for pickup", "pickup order created", "return requested", "return initiated"].includes(statusText)) {
    returnPickupStatus = "PICKUP_PENDING";
  } else if (["pickup complete", "pickup completed"].includes(statusText)) {
    returnPickupStatus = "PICKUP_COMPLETE";
    if (currentStatus === "NCM_RETURN_INITIATED") lifecycleStatus = "RETURN_IN_TRANSIT";
  } else if (["sent for delivery"].includes(statusText)) {
    returnPickupStatus = "SENT_FOR_DELIVERY";
    if (["NCM_RETURN_INITIATED", "RETURN_IN_TRANSIT"].includes(currentStatus)) lifecycleStatus = "RETURN_IN_TRANSIT";
  } else if (["dispatched", "order dispatched"].includes(statusText)) {
    returnPickupStatus = "DISPATCHED";
    if (["NCM_RETURN_INITIATED", "RETURN_IN_TRANSIT"].includes(currentStatus)) lifecycleStatus = "RETURN_IN_TRANSIT";
  } else if (["arrived", "order arrived"].includes(statusText)) {
    returnPickupStatus = "ARRIVED_AT_DESTINATION";
    if (["NCM_RETURN_INITIATED", "RETURN_IN_TRANSIT"].includes(currentStatus)) lifecycleStatus = "RETURN_IN_TRANSIT";
  } else if (["delivered", "delivery complete", "delivery completed", "returned to vendor"].includes(statusText)) {
    if (currentStatus === "RETURN_IN_TRANSIT" || (statusText === "returned to vendor" && currentStatus === "NCM_RETURN_INITIATED")) {
      returnPickupStatus = "DELIVERED_TO_MANUFACTURER";
      lifecycleStatus = "RECEIVED_AT_WAREHOUSE";
    }
  }
  return { lifecycleStatus, returnPickupStatus };
};

const returnPickupRank = (status) => ({
  AWAITING_PICKUP: 0,
  PICKUP_PENDING: 0,
  PICKUP_COMPLETE: 1,
  SENT_FOR_DELIVERY: 2,
  DISPATCHED: 2,
  ARRIVED_AT_DESTINATION: 3,
  DELIVERED_TO_MANUFACTURER: 4,
}[String(status || "").toUpperCase()] ?? -1);

export const resolveCustomerReturnNcmState = ({ currentStatus, currentPickupStatus, status, event }) => {
  const mappedState = nextCustomerReturnNcmState({ currentStatus, currentPickupStatus, status, event });
  const keepCurrentPickup = returnPickupRank(currentPickupStatus) > returnPickupRank(mappedState.returnPickupStatus);
  return {
    lifecycleStatus: keepCurrentPickup && currentStatus === "RETURN_IN_TRANSIT"
      ? currentStatus
      : mappedState.lifecycleStatus,
    returnPickupStatus: keepCurrentPickup ? currentPickupStatus : mappedState.returnPickupStatus,
  };
};

export const applyCustomerReturnNcmStatus = async ({ ncmOrderId, status, event, timestamp }) => {
  const numericId = Number(ncmOrderId);
  if (!Number.isInteger(numericId) || numericId <= 0) return false;
  const returnRecord = await prisma.customerReturn.findFirst({
    where: {
      requestKey: { not: null },
      lifecycleStatus: { in: ["APPROVED_BY_ADMIN", "SUBMITTING", "NCM_SUBMISSION_UNKNOWN", "NCM_RETURN_INITIATED", "RETURN_IN_TRANSIT"] },
      OR: [{ originalNcmOrderId: numericId }, { ncmReturnOrderId: numericId }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (!returnRecord) return false;

  const happenedAt = timestamp && !Number.isNaN(new Date(timestamp).getTime()) ? new Date(timestamp) : new Date();
  if (returnRecord.ncmSubmissionAttemptedAt && happenedAt < returnRecord.ncmSubmissionAttemptedAt) return true;
  const { lifecycleStatus: nextStatus, returnPickupStatus: pickupStatus } = resolveCustomerReturnNcmState({
    currentStatus: returnRecord.lifecycleStatus,
    currentPickupStatus: returnRecord.returnPickupStatus,
    status,
    event,
  });
  await prisma.$transaction(async (tx) => {
    if (nextStatus !== returnRecord.lifecycleStatus || pickupStatus !== returnRecord.returnPickupStatus) {
      await tx.customerReturn.update({
        where: { id: returnRecord.id },
        data: {
          lifecycleStatus: nextStatus,
          returnPickupStatus: pickupStatus,
          ...(pickupStatus === "PICKUP_COMPLETE" ? { returnPickupCompletedAt: returnRecord.returnPickupCompletedAt || happenedAt } : {}),
          ...(nextStatus === "RECEIVED_AT_WAREHOUSE" ? { manufacturerReceivedAt: returnRecord.manufacturerReceivedAt || happenedAt } : {}),
        },
      });
    }
    await addReturnEvent(tx, {
      returnId: returnRecord.id,
      eventType: `NCM_${String(status || event || "STATUS").toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 48)}`,
      fromStatus: returnRecord.lifecycleStatus,
      toStatus: nextStatus,
      metadata: { ncmOrderId: numericId, status, event, timestamp: happenedAt.toISOString() },
      idempotencyKey: `RETURN_NCM:${numericId}:${status || event}:${timestamp || "NO_TIMESTAMP"}`.slice(0, 191),
    }).catch((error) => {
      if (error.code !== "P2002") throw error;
    });
  }, { isolationLevel: "Serializable" });
  return true;
};

export const recordLegacyReturn = async () => {
  throw fail("Directly completing customer returns is disabled. Create an RMA request, approve it, and complete inspection before refund or inventory changes.", "RETURN_WORKFLOW_REQUIRED", 409);
};

export const markCustomerReturnRefunded = async ({ returnId, adminId, actorContext }) => {
  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.customerReturn.findUnique({ where: { id: returnId } });
    if (!current || current.lifecycleStatus !== "REFUND_PENDING") throw fail("Only an inspected return awaiting refund can be marked refunded.", "RETURN_REFUND_NOT_READY", 409);
    const payable = await tx.accountPayable.findFirst({
      where: { referenceType: "CUSTOMER_REFUND", referenceId: returnId },
      orderBy: { createdAt: "desc" },
    });
    if (!payable || payable.status !== "SETTLED") throw fail("Settle the customer refund payable before completing the return.", "RETURN_REFUND_UNSETTLED", 409);
    const result = await tx.customerReturn.updateMany({
      where: { id: returnId, lifecycleStatus: "REFUND_PENDING", refundStatus: "PENDING" },
      data: { lifecycleStatus: "REFUNDED", refundStatus: "COMPLETED", completedAt: new Date() },
    });
    if (result.count !== 1) throw fail("The return refund was already processed.", "RETURN_REFUND_CONFLICT", 409);
    await addReturnEvent(tx, {
      returnId,
      eventType: "REFUNDED",
      fromStatus: "REFUND_PENDING",
      toStatus: "REFUNDED",
      actorId: adminId,
      actorRole: "ADMIN",
      idempotencyKey: `RETURN:${returnId}:REFUNDED`,
    });
    await recordSystemAudit(actorContext, {
      action: "CUSTOMER_RETURN_REFUND_COMPLETED",
      entityType: "CustomerReturn",
      entityId: returnId,
      beforeState: { lifecycleStatus: current.lifecycleStatus, refundStatus: current.refundStatus },
      afterState: { lifecycleStatus: "REFUNDED", refundStatus: "COMPLETED" },
    }, { client: tx });
    return tx.customerReturn.findUnique({ where: { id: returnId } });
  });
  return updated;
};