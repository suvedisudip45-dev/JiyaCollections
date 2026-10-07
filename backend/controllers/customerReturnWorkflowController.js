import { getPagination } from "../utils/pagination.js";
import {
  createCustomerReturnRequest as createRequest,
  decideCustomerReturnRequest,
  inspectCustomerReturn,
  listAdminCustomerReturns,
  listCustomerReturnRequests,
  listManufacturerCustomerReturns,
  markCustomerReturnRefunded,
  resolveUnknownCustomerReturn,
  submitApprovedCustomerReturn,
} from "../services/customerReturnWorkflowService.js";

const sendError = (res, error) => res.status(error.status || 400).json({
  success: false,
  code: error.code || "RETURN_REQUEST_FAILED",
  message: error.message || "Return request failed.",
});

const actorContextFromRequest = (req) => ({
  actorId: req.auth?.accountId,
  actorRole: req.auth?.role,
  portalSource: req.auth?.role || "ADMIN",
  ipAddress: req.ip || null,
  userAgent: req.headers["user-agent"] || null,
  correlationId: req.correlationId || null,
});

export const customerCreateReturnRequest = async (req, res) => {
  try {
    const result = await createRequest({
      orderId: req.body.orderId,
      customerId: req.userId,
      requestKey: req.body.requestKey,
      reason: req.body.reason,
      items: req.body.items,
      actorRole: "CUSTOMER",
    });
    return res.status(result.duplicate ? 200 : 201).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};

export const customerListReturnRequests = async (req, res) => {
  try {
    const returns = await listCustomerReturnRequests({ customerId: req.userId });
    return res.json({ success: true, returns });
  } catch (error) {
    return sendError(res, error);
  }
};

export const manufacturerListReturnRequests = async (req, res) => {
  try {
    const returns = await listManufacturerCustomerReturns({
      manufacturerId: req.manufacturerId,
      distributorId: req.distributorId,
    });
    return res.json({ success: true, returns });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminCreateReturnRequest = async (req, res) => {
  try {
    const result = await createRequest({
      orderId: req.body.orderId,
      customerId: req.body.customerId || null,
      adminId: req.adminId,
      requestKey: req.body.requestKey,
      reason: req.body.reason,
      items: req.body.items,
      actorRole: "ADMIN",
    });
    return res.status(result.duplicate ? 200 : 201).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminListReturnRequests = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const result = await listAdminCustomerReturns({
      skip: pagination.skip,
      take: pagination.limit,
      status: req.query.status,
    });
    return res.json({
      success: true,
      returns: result.returns,
      pagination: { ...pagination, total: result.total, totalPages: Math.ceil(result.total / pagination.limit) },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminDecideReturnRequest = async (req, res) => {
  try {
    const returnRecord = await decideCustomerReturnRequest({
      returnId: req.params.id,
      adminId: req.adminId,
      actorContext: actorContextFromRequest(req),
      decision: req.body.decision,
      reason: req.body.reason,
      chargePayer: req.body.chargePayer,
    });
    return res.json({ success: true, returnRecord });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminRetryReturnSubmission = async (req, res) => {
  try {
    const returnRecord = await submitApprovedCustomerReturn({
      returnId: req.params.id,
      adminId: req.adminId,
      retry: true,
      chargePayer: req.body.chargePayer,
    });
    return res.json({ success: true, returnRecord });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminInspectReturn = async (req, res) => {
  try {
    const returnRecord = await inspectCustomerReturn({
      returnId: req.params.id,
      adminId: req.adminId,
      actorContext: actorContextFromRequest(req),
      result: req.body.result,
      notes: req.body.notes,
    });
    return res.json({ success: true, returnRecord });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminCompleteReturnRefund = async (req, res) => {
  try {
    const returnRecord = await markCustomerReturnRefunded({
      returnId: req.params.id,
      adminId: req.adminId,
      actorContext: actorContextFromRequest(req),
    });
    return res.json({ success: true, returnRecord });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminResolveUnknownReturn = async (req, res) => {
  try {
    const returnRecord = await resolveUnknownCustomerReturn({
      returnId: req.params.id,
      adminId: req.adminId,
      outcome: req.body.outcome,
      reason: req.body.reason,
    });
    return res.json({ success: true, returnRecord });
  } catch (error) {
    return sendError(res, error);
  }
};