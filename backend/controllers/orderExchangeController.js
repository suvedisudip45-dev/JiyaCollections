import { getPagination } from "../utils/pagination.js";
import {
  createAdminExchangeRequest,
  createCustomerExchangeRequest,
  decideCustomerExchangeRequest,
  listAdminExchangeRequests,
  listCustomerExchangeRequests,
  recordExchangeInspection,
  reconcileCustomerExchange,
  resolveUnknownExchangeSubmission,
  submitApprovedExchange,
} from "../services/orderExchangeService.js";

const sendError = (res, error) => res.status(error.status || 400).json({
  success: false,
  code: error.code || "EXCHANGE_REQUEST_FAILED",
  message: error.message || "Exchange request failed.",
});

export const customerCreateExchangeRequest = async (req, res) => {
  try {
    const result = await createCustomerExchangeRequest({
      customerId: req.userId,
      orderId: req.body.orderId,
      requestKey: req.body.requestKey,
      reasonCode: req.body.reasonCode,
      reasonDetails: req.body.reasonDetails,
      items: req.body.items,
      replacementItems: req.body.replacementItems,
    });
    return res.status(result.duplicate ? 200 : 201).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};

export const customerListExchangeRequests = async (req, res) => {
  try {
    const requests = await listCustomerExchangeRequests({ customerId: req.userId, orderId: req.query.orderId });
    return res.json({ success: true, requests });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminListExchangeRequests = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const result = await listAdminExchangeRequests({
      status: req.query.status,
      skip: pagination.skip,
      take: pagination.limit,
    });
    return res.json({
      success: true,
      requests: result.requests,
      pagination: { ...pagination, total: result.total, totalPages: Math.ceil(result.total / pagination.limit) },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminDecideExchangeRequest = async (req, res) => {
  try {
    const result = await decideCustomerExchangeRequest({
      requestId: req.params.id,
      adminId: req.adminId,
      decision: req.body.decision,
      reason: req.body.reason,
      chargePayer: req.body.chargePayer,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminRetryExchangeSubmission = async (req, res) => {
  try {
    const request = await submitApprovedExchange(req.params.id);
    return res.json({ success: true, request });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminReconcileExchange = async (req, res) => {
  try {
    const request = await reconcileCustomerExchange(req.params.id);
    return res.json({ success: true, request });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminRecordExchangeInspection = async (req, res) => {
  try {
    const request = await recordExchangeInspection({
      requestId: req.params.id,
      adminId: req.adminId,
      result: req.body.result,
      notes: req.body.notes,
    });
    return res.json({ success: true, request });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminResolveUnknownExchange = async (req, res) => {
  try {
    const request = await resolveUnknownExchangeSubmission({
      requestId: req.params.id,
      adminId: req.adminId,
      outcome: req.body.outcome,
      ncmReturnOrderId: req.body.ncmReturnOrderId,
      ncmReplacementOrderId: req.body.ncmReplacementOrderId,
      reason: req.body.reason,
    });
    return res.json({ success: true, request });
  } catch (error) {
    return sendError(res, error);
  }
};

export const adminCreateExchangeRequest = async (req, res) => {
  try {
    const result = await createAdminExchangeRequest({
      adminId: req.adminId,
      orderId: req.body.orderId,
      requestKey: req.body.requestKey,
      reasonCode: req.body.reasonCode,
      reasonDetails: req.body.reasonDetails,
      items: req.body.items,
      replacementItems: req.body.replacementItems,
    });
    return res.status(result.duplicate ? 200 : 201).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};