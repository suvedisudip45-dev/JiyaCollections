import { randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";
import {
  listNcmSupportTickets,
  markNcmSupportTicketClosed,
  recordNcmSupportTicketReply,
  saveNcmSupportTicket,
} from "../services/ncmSupportTicketService.js";
import { logger } from "../utils/logger.js";
import {
  configureWebhook,
  createOrderComment,
  createTicketResponse,
  createVendorTicket,
  getAssignedBranches,
  getBranches,
  getBulkOrderComments,
  getBulkOrderStatuses,
  getCustomerRatings,
  getNcmBranchName,
  getNcmBranchRows,
  getNcmResponseRejection,
  getOrder,
  getOrderComments,
  getOrderLabel,
  getOrderLabels,
  getOrderStatus,
  getShippingRate,
  getTicketDetail,
  getVendorCustomerDetail,
  getVendorCustomers,
  getVendorStaffs,
  redirectOrder,
  testWebhook,
  closeVendorTicket,
} from "../services/ncmClient.js";

const inputError = (message) => Object.assign(new Error(message), { statusCode: 400, code: "INVALID_NCM_INPUT" });

const positiveInteger = (value, field, { optional = false } = {}) => {
  if (optional && (value === undefined || value === null || value === "")) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw inputError(`${field} must be a positive integer.`);
  return parsed;
};

const requiredText = (value, field, maxLength) => {
  const text = String(value || "").trim();
  if (!text) throw inputError(`${field} is required.`);
  if (text.length > maxLength) throw inputError(`${field} cannot exceed ${maxLength} characters.`);
  return text;
};

const validateWebhookUrl = (value, { allowEmpty = false } = {}) => {
  const webhookUrl = String(value ?? "").trim();
  if (!webhookUrl && allowEmpty) return "";
  if (webhookUrl.length > 2048) throw inputError("webhook_url cannot exceed 2048 characters.");
  let parsedUrl;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    throw inputError("webhook_url must be a valid HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol) || !parsedUrl.hostname || parsedUrl.username || parsedUrl.password) {
    throw inputError("webhook_url must be a valid HTTP or HTTPS URL without embedded credentials.");
  }
  return webhookUrl;
};

const requestActor = (req) => ({
  actorId: req.auth?.accountId || null,
  actorRole: req.auth?.role || "ADMIN",
  portalSource: "ADMIN",
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});

const errorResponse = (res, error) => {
  const isExternalError = Boolean(
    error.httpStatus || error.outcomeUnknown || String(error.code || "").startsWith("NCM_"),
  );
  const message = error.statusCode
    ? error.message
    : error.outcomeUnknown
      ? "NCM could not confirm the operation outcome. Verify the change in NCM before retrying."
    : error.httpStatus
      ? `NCM returned an error (HTTP ${error.httpStatus}).`
      : error.code === "NCM_TIMEOUT"
        ? "The NCM request timed out."
        : error.message || "NCM request failed.";
  return res.status(error.statusCode || (isExternalError ? 502 : 500)).json({
    success: false,
    code: error.code || (isExternalError ? "NCM_API_ERROR" : "NCM_ADMIN_ERROR"),
    message,
  });
};

const runNcmOperation = async (req, res, {
  operation,
  entityType,
  entityId,
  write = false,
  invoke,
  afterSuccess,
}) => {
  try {
    const result = await invoke();
    if (write) {
      const rejection = getNcmResponseRejection(result?.data);
      if (rejection) {
        return res.status(502).json({
          success: false,
          code: "NCM_OPERATION_REJECTED",
          message: "NCM rejected the operation.",
        });
      }
    }
    if (afterSuccess) await afterSuccess(result);
    if (write) {
      try {
        await recordSystemAudit(requestActor(req), {
          action: operation,
          entityType,
          entityId: entityId || null,
          afterState: { provider: "NCM", operation },
        });
      } catch (error) {
        logger.error("NCM operation succeeded but its audit event could not be stored.", {
          operation,
          errorName: error.name,
          errorCode: error.code,
        });
        return res.status(500).json({
          success: false,
          code: "NCM_AUDIT_FAILED_AFTER_SUCCESS",
          message: "NCM accepted the operation, but its audit record could not be saved. Verify the change in NCM before retrying.",
        });
      }
    }
    return res.json({ success: true, data: result?.data ?? null });
  } catch (error) {
    return errorResponse(res, error);
  }
};

const getKnownDelivery = async (ncmOrderId) => {
  const delivery = await prisma.deliveryOrder.findUnique({
    where: { ncmOrderId },
    select: {
      id: true,
      orderId: true,
      ncmOrderId: true,
      state: true,
      destinationBranchName: true,
      codAmount: true,
      order: { select: { address: true } },
    },
  });
  if (!delivery) {
    throw Object.assign(new Error("This NCM order is not linked to a local delivery record."), {
      statusCode: 404,
      code: "NCM_ORDER_NOT_LINKED",
    });
  }
  return delivery;
};

export const getNcmAdminBranches = (req, res) =>
  runNcmOperation(req, res, { operation: "branches.read", entityType: "NCM_BRANCH", invoke: getBranches });

export const getNcmAdminAssignedBranches = (req, res) =>
  runNcmOperation(req, res, { operation: "assigned-branches.read", entityType: "NCM_BRANCH", invoke: getAssignedBranches });

export const getNcmAdminStaff = (req, res) => {
  try {
    const page = positiveInteger(req.query.page || 1, "page");
    const pageSize = positiveInteger(req.query.page_size || 20, "page_size");
    if (pageSize > 100) throw inputError("page_size cannot exceed 100.");
    const q = String(req.query.q || "").trim().slice(0, 80);
    return runNcmOperation(req, res, {
      operation: "staff.read",
      entityType: "NCM_STAFF",
      invoke: () => getVendorStaffs({ q, page, page_size: pageSize }),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const getNcmAdminShippingRate = (req, res) => {
  try {
    const creation = requiredText(req.query.creation, "creation", 120);
    const destination = requiredText(req.query.destination, "destination", 120);
    const type = String(req.query.type || "Door2Door");
    if (!["Door2Door", "Branch2Door", "Door2Branch", "Branch2Branch"].includes(type)) {
      throw inputError("type is not a supported NCM delivery type.");
    }
    return runNcmOperation(req, res, {
      operation: "shipping-rate.read",
      entityType: "NCM_SHIPPING_RATE",
      invoke: () => getShippingRate({ creation, destination, type }),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const getNcmAdminOrder = (req, res) => {
  try {
    const orderId = positiveInteger(req.params.orderId, "orderId");
    return runNcmOperation(req, res, {
      operation: "order.read",
      entityType: "NCM_ORDER",
      entityId: orderId,
      invoke: () => getOrder(orderId),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const getNcmAdminOrderStatus = (req, res) => {
  try {
    const orderId = positiveInteger(req.params.orderId, "orderId");
    return runNcmOperation(req, res, {
      operation: "order-status.read",
      entityType: "NCM_ORDER",
      entityId: orderId,
      invoke: () => getOrderStatus(orderId),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const getNcmAdminOrderComments = (req, res) => {
  try {
    const orderId = positiveInteger(req.params.orderId, "orderId");
    return runNcmOperation(req, res, {
      operation: "order-comments.read",
      entityType: "NCM_ORDER",
      entityId: orderId,
      invoke: () => getOrderComments(orderId),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const getNcmAdminBulkOrderComments = (req, res) =>
  runNcmOperation(req, res, {
    operation: "recent-comments.read",
    entityType: "NCM_ORDER_COMMENT",
    invoke: getBulkOrderComments,
  });

export const getNcmAdminOrderLabel = (req, res) => {
  try {
    const orderId = positiveInteger(req.params.orderId, "orderId");
    return runNcmOperation(req, res, {
      operation: "order-label.read",
      entityType: "NCM_ORDER",
      entityId: orderId,
      invoke: () => getOrderLabel(orderId),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const postNcmAdminOrderLabels = (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) {
      throw inputError("ids must be an array containing 1 to 50 NCM order IDs.");
    }
    const normalizedIds = ids.map((id) => positiveInteger(id, "ids item"));
    return runNcmOperation(req, res, {
      operation: "order-labels.read",
      entityType: "NCM_ORDER",
      invoke: () => getOrderLabels(normalizedIds),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const postNcmAdminBulkOrderStatuses = (req, res) => {
  try {
    const ids = req.body?.orders;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) {
      throw inputError("orders must be an array containing 1 to 50 NCM order IDs.");
    }
    const orderIds = ids.map((id) => positiveInteger(id, "orders item"));
    return runNcmOperation(req, res, {
      operation: "bulk-order-status.read",
      entityType: "NCM_ORDER",
      invoke: () => getBulkOrderStatuses(orderIds),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const postNcmAdminOrderComment = async (req, res) => {
  try {
    const orderId = positiveInteger(req.body?.orderid, "orderid");
    const comments = requiredText(req.body?.comments, "comments", 2000);
    const delivery = await getKnownDelivery(orderId);
    const result = await createOrderComment({ orderid: orderId, comments });
    const responseData = result?.data;
    if (getNcmResponseRejection(responseData)) {
      return res.status(502).json({
        success: false,
        code: "NCM_OPERATION_REJECTED",
        message: "NCM rejected the comment.",
      });
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.deliveryComment.create({
          data: {
            deliveryOrderId: delivery.id,
            ncmOrderId: orderId,
            comments,
            addedBy: "Admin",
            addedAt: new Date(),
            payloadJson: { source: "ADMIN", operation: "COMMENT" },
            eventKey: `admin:${delivery.id}:${randomUUID()}`,
          },
        });
        await recordSystemAudit(requestActor(req), {
          action: "order-comment.create",
          entityType: "NCM_ORDER",
          entityId: orderId,
          afterState: { provider: "NCM", operation: "order-comment.create" },
        }, { client: tx });
      });
    } catch (error) {
      logger.error("NCM accepted an order comment but local recording failed.", {
        deliveryId: delivery.id,
        errorName: error.name,
        errorCode: error.code,
      });
      return res.status(500).json({
        success: false,
        code: "NCM_COMMENT_LOCAL_RECORD_FAILED",
        message: "NCM accepted the comment, but its local record could not be saved. Verify the comment in NCM before retrying.",
      });
    }
    return res.json({ success: true, data: responseData ?? null });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const postNcmAdminRedirectOrder = async (req, res) => {
  try {
    const deliveryId = String(req.params.deliveryId || "");
    const delivery = await prisma.deliveryOrder.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        orderId: true,
        ncmOrderId: true,
        vendorReference: true,
        codAmount: true,
        order: { select: { address: true } },
      },
    });
    if (!delivery?.ncmOrderId) {
      return res.status(404).json({
        success: false,
        code: "NCM_ORDER_NOT_LINKED",
        message: "A linked NCM delivery order is required.",
      });
    }
    const name = requiredText(req.body?.name, "name", 120);
    const phone = requiredText(req.body?.phone, "phone", 40);
    const address = requiredText(req.body?.address, "address", 500);
    const destination = positiveInteger(req.body?.destination, "destination", { optional: true });
    const codCharge = req.body?.cod_charge === undefined || req.body?.cod_charge === ""
      ? undefined
      : Number(req.body.cod_charge);
    if (codCharge !== undefined && (!Number.isFinite(codCharge) || codCharge < 0 || codCharge > 10000000)) {
      throw inputError("cod_charge must be a non-negative amount no greater than 10000000.");
    }

    let destinationBranchName = null;
    if (destination !== undefined) {
      const branchResponse = await getBranches();
      const matchedBranch = getNcmBranchRows(branchResponse).find(
        (branch) => Number(branch?.pk ?? branch?.id) === destination,
      );
      if (!matchedBranch) throw inputError("destination must match a branch returned by NCM.");
      destinationBranchName = getNcmBranchName(matchedBranch) || null;
    }

    const payload = {
      pk: delivery.ncmOrderId,
      name,
      phone,
      address,
      vendorOrderid: delivery.vendorReference,
      ...(destination !== undefined ? { destination } : {}),
      ...(codCharge !== undefined ? { cod_charge: codCharge } : {}),
    };
    const result = await redirectOrder(payload);
    const responseData = result?.data;
    if (getNcmResponseRejection(responseData)) {
      return res.status(502).json({
        success: false,
        code: "NCM_OPERATION_REJECTED",
        message: "NCM rejected the redirect request.",
      });
    }

    const responseOrder = responseData?.data && typeof responseData.data === "object"
      ? responseData.data
      : responseData;
    const actualCodCharge = responseOrder?.cod_charge == null ? codCharge : Number(responseOrder.cod_charge);
    const actualDeliveryCharge = responseOrder?.delivery_charge == null
      ? null
      : Number(responseOrder.delivery_charge);
    const previousAddress = delivery.order?.address && typeof delivery.order.address === "object"
      && !Array.isArray(delivery.order.address)
      ? delivery.order.address
      : {};
    const [firstName, ...lastNameParts] = name.split(/\s+/);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: delivery.orderId },
          data: {
            address: {
              ...previousAddress,
              name,
              firstName,
              lastName: lastNameParts.join(" "),
              phone,
              address,
            },
          },
        });
        await tx.deliveryOrder.update({
          where: { id: delivery.id },
          data: {
            ...(destinationBranchName ? { destinationBranchName } : {}),
            ...(Number.isFinite(actualCodCharge) ? { codAmount: actualCodCharge } : {}),
            ...(Number.isFinite(actualDeliveryCharge) ? { ncmDeliveryCharge: actualDeliveryCharge } : {}),
          },
        });
        await tx.deliveryEvent.create({
          data: {
            deliveryOrderId: delivery.id,
            orderId: delivery.orderId,
            source: "ADMIN",
            eventType: "NCM_ORDER_REDIRECTED",
            actorId: req.auth?.accountId || null,
            occurredAt: new Date(),
            idempotencyKey: `ncm-redirect:${delivery.id}:${randomUUID()}`,
            payloadJson: {
              destinationBranchName,
              codCharge: Number.isFinite(actualCodCharge) ? actualCodCharge : null,
              deliveryCharge: Number.isFinite(actualDeliveryCharge) ? actualDeliveryCharge : null,
            },
          },
        });
        await recordSystemAudit(requestActor(req), {
          action: "order.redirect",
          entityType: "NCM_ORDER",
          entityId: delivery.ncmOrderId,
          afterState: { provider: "NCM", operation: "order.redirect" },
        }, { client: tx });
      });
    } catch (error) {
      logger.error("NCM accepted a redirect but local state could not be synchronized.", {
        deliveryId: delivery.id,
        errorName: error.name,
        errorCode: error.code,
      });
      return res.status(500).json({
        success: false,
        code: "NCM_REDIRECT_LOCAL_SYNC_FAILED",
        message: "NCM accepted the redirect, but local delivery records could not be synchronized. Verify the order in NCM before retrying.",
      });
    }
    return res.json({ success: true, data: responseData ?? null });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const postNcmAdminWebhookConfiguration = (req, res) => {
  try {
    const webhookUrl = validateWebhookUrl(req.body?.webhook_url, { allowEmpty: true });
    return runNcmOperation(req, res, {
      operation: "webhook.configure",
      entityType: "NCM_WEBHOOK",
      write: true,
      invoke: () => configureWebhook({ webhook_url: webhookUrl }),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const postNcmAdminWebhookTest = (req, res) => {
  try {
    const webhookUrl = validateWebhookUrl(req.body?.webhook_url);
    return runNcmOperation(req, res, {
      operation: "webhook.test",
      entityType: "NCM_WEBHOOK",
      write: true,
      invoke: () => testWebhook({ webhook_url: webhookUrl }),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const postNcmAdminTicket = async (req, res) => {
  try {
    const ticketType = requiredText(req.body?.ticket_type, "ticket_type", 40);
    if (!["General", "Order Processing", "Return", "Pickup"].includes(ticketType)) {
      throw inputError("ticket_type must be General, Order Processing, Return, or Pickup.");
    }
    const message = requiredText(req.body?.message, "message", 500);
    const branch = ticketType === "Pickup"
      ? requiredText(req.body?.branch, "branch", 120)
      : undefined;
    if (branch) {
      const assignedBranches = getNcmBranchRows(await getAssignedBranches());
      const branchIsAssigned = assignedBranches.some((candidate) =>
        getNcmBranchName(candidate) === branch.toUpperCase()
        || String(candidate?.pk ?? candidate?.id ?? "") === branch,
      );
      if (!branchIsAssigned) throw inputError("Pickup tickets require one of the vendor's NCM-assigned branches.");
    }
    return runNcmOperation(req, res, {
      operation: "ticket.create",
      entityType: "NCM_TICKET",
      write: true,
      invoke: () => createVendorTicket({
        ticket_type: ticketType,
        message,
        ...(branch ? { branch } : {}),
      }),
      afterSuccess: (result) => saveNcmSupportTicket(result?.data, {
        ticketType,
        message,
        branch,
        addedOn: new Date(),
        recordedByAccountId: req.auth?.accountId || null,
      }),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const getNcmAdminSupportTickets = async (req, res) => {
  try {
    return res.json(await listNcmSupportTickets(req.query));
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const getNcmAdminTicket = (req, res) => {
  try {
    const ticketId = positiveInteger(req.params.ticketId, "ticketId");
    return runNcmOperation(req, res, {
      operation: "ticket.read",
      entityType: "NCM_TICKET",
      entityId: ticketId,
      invoke: () => getTicketDetail(ticketId),
      afterSuccess: (result) => saveNcmSupportTicket(result?.data, {
        ncmTicketId: ticketId,
        recordedByAccountId: req.auth?.accountId || null,
      }),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const postNcmAdminTicketResponse = (req, res) => {
  try {
    const ticketId = positiveInteger(req.params.ticketId, "ticketId");
    const message = requiredText(req.body?.message, "message", 2000);
    return runNcmOperation(req, res, {
      operation: "ticket.respond",
      entityType: "NCM_TICKET",
      entityId: ticketId,
      write: true,
      invoke: () => createTicketResponse(ticketId, message),
      afterSuccess: () => recordNcmSupportTicketReply(ticketId, message, {
        actorId: req.auth?.accountId || null,
      }),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const postNcmAdminTicketClose = (req, res) => {
  try {
    const ticketId = positiveInteger(req.params.ticketId, "ticketId");
    return runNcmOperation(req, res, {
      operation: "ticket.close",
      entityType: "NCM_TICKET",
      entityId: ticketId,
      write: true,
      invoke: () => closeVendorTicket(ticketId),
      afterSuccess: () => markNcmSupportTicketClosed(ticketId, {
        actorId: req.auth?.accountId || null,
      }),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const getNcmAdminCustomers = (req, res) => {
  try {
    const page = positiveInteger(req.query.page || 1, "page");
    const pageSize = positiveInteger(req.query.page_size || 20, "page_size");
    if (pageSize > 100) throw inputError("page_size cannot exceed 100.");
    return runNcmOperation(req, res, {
      operation: "customers.read",
      entityType: "NCM_CUSTOMER",
      invoke: () => getVendorCustomers({ page, page_size: pageSize }),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const getNcmAdminCustomer = (req, res) => {
  try {
    const customerId = positiveInteger(req.params.customerId, "customerId");
    return runNcmOperation(req, res, {
      operation: "customer.read",
      entityType: "NCM_CUSTOMER",
      entityId: customerId,
      invoke: () => getVendorCustomerDetail(customerId),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const getNcmAdminCustomerRatings = (req, res) => {
  try {
    const phone = requiredText(req.query.phone, "phone", 40);
    return runNcmOperation(req, res, {
      operation: "customer-ratings.read",
      entityType: "NCM_CUSTOMER",
      invoke: () => getCustomerRatings(phone),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const postNcmAdminCompareStatuses = async (req, res) => {
  try {
    const deliveryIds = req.body?.deliveryIds;
    if (!Array.isArray(deliveryIds) || deliveryIds.length < 1 || deliveryIds.length > 25) {
      throw inputError("deliveryIds must contain 1 to 25 local delivery IDs.");
    }
    const ids = [...new Set(deliveryIds.map((id) => requiredText(id, "delivery ID", 64)))];
    const localRecords = await prisma.deliveryOrder.findMany({
      where: { id: { in: ids }, ncmOrderId: { not: null } },
      select: { id: true, orderId: true, ncmOrderId: true, state: true, ncmStatus: true, lastSyncedAt: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    const localIds = localRecords.map((record) => record.ncmOrderId);
    const remote = localIds.length ? await getBulkOrderStatuses(localIds) : { data: [] };
    return res.json({
      success: true,
      local: localRecords,
      ncm: remote?.data ?? null,
      unmatchedDeliveryIds: ids.filter((id) => !localRecords.some((record) => record.id === id)),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};
