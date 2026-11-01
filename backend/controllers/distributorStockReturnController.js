import {
  createDistributorStockReturnCollection,
  createDistributorStockReturn,
  getDistributorStockReturnAuditReport,
  inspectDistributorStockReturnCollection,
  listDistributorStockReturns,
  receiveDistributorStockReturnCollection,
  recordDistributorStockReturnDiscrepancyReview,
  reviewDistributorStockReturn,
} from "../services/distributorStockReturnService.js";

const actorFromRequest = (req) => ({
  accountId: req.auth?.accountId,
  ipAddress: req.ip || null,
  userAgent: req.headers["user-agent"] || null,
  correlationId: req.correlationId || null,
});

const sendError = (res, error, action) => {
  console.error(`${action} error:`, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Unable to process distributor stock return.",
    ...(error.code ? { code: error.code } : {}),
  });
};

export const getDistributorStockReturns = async (req, res) => {
  try {
    const result = await listDistributorStockReturns({
      distributorId: req.params.id,
      query: req.query,
    });
    return res.json(result);
  } catch (error) {
    return sendError(res, error, "getDistributorStockReturns");
  }
};

export const getDistributorStockReturnAuditReportController = async (req, res) => {
  try {
    const report = await getDistributorStockReturnAuditReport({
      distributorId: req.params.id,
      stockReturnId: req.params.returnId,
    });
    return res.json(report);
  } catch (error) {
    return sendError(res, error, "getDistributorStockReturnAuditReport");
  }
};

export const reviewDistributorStockReturnDiscrepancy = async (req, res) => {
  try {
    const result = await recordDistributorStockReturnDiscrepancyReview({
      distributorId: req.params.id,
      stockReturnId: req.params.returnId,
      discrepancyId: req.params.discrepancyId,
      notes: req.body?.notes,
      evidence: req.body?.evidence,
      idempotencyKey: req.get("Idempotency-Key"),
      actor: actorFromRequest(req),
    });
    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      message: result.replayed
        ? "Discrepancy investigation note already recorded."
        : "Investigation note recorded; discrepancy remains open and under review.",
      ...result,
    });
  } catch (error) {
    return sendError(res, error, "reviewDistributorStockReturnDiscrepancy");
  }
};

export const createDistributorStockReturnRequest = async (req, res) => {
  try {
    const result = await createDistributorStockReturn({
      distributorId: req.params.id,
      reason: req.body?.reason,
      lines: req.body?.lines,
      idempotencyKey: req.get("Idempotency-Key"),
      actor: actorFromRequest(req),
    });
    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      message: result.replayed ? "Stock return request already exists." : "Stock return request submitted for approval.",
      ...result,
    });
  } catch (error) {
    return sendError(res, error, "createDistributorStockReturnRequest");
  }
};

export const reviewDistributorStockReturnRequest = async (req, res) => {
  try {
    const stockReturn = await reviewDistributorStockReturn({
      distributorId: req.params.id,
      stockReturnId: req.params.returnId,
      decision: req.body?.decision,
      lines: req.body?.lines,
      notes: req.body?.notes,
      actor: actorFromRequest(req),
    });
    return res.json({
      success: true,
      message: stockReturn.status === "REJECTED"
        ? "Stock return request rejected."
        : "Stock return authorized and approved units moved to return hold.",
      stockReturn,
    });
  } catch (error) {
    return sendError(res, error, "reviewDistributorStockReturnRequest");
  }
};

export const collectDistributorStockReturn = async (req, res) => {
  try {
    const result = await createDistributorStockReturnCollection({
      distributorId: req.params.id,
      stockReturnId: req.params.returnId,
      carrier: req.body?.carrier,
      trackingReference: req.body?.trackingReference,
      handoverEvidence: req.body?.handoverEvidence,
      notes: req.body?.notes,
      lines: req.body?.lines,
      idempotencyKey: req.get("Idempotency-Key"),
      actor: actorFromRequest(req),
    });
    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      message: result.replayed ? "Stock return collection already recorded." : "Collection recorded and stock moved to transit.",
      ...result,
    });
  } catch (error) {
    return sendError(res, error, "collectDistributorStockReturn");
  }
};

export const receiveDistributorStockReturn = async (req, res) => {
  try {
    const result = await receiveDistributorStockReturnCollection({
      distributorId: req.params.id,
      stockReturnId: req.params.returnId,
      collectionId: req.params.collectionId,
      notes: req.body?.notes,
      lines: req.body?.lines,
      idempotencyKey: req.get("Idempotency-Key"),
      actor: actorFromRequest(req),
    });
    return res.json({
      success: true,
      message: result.replayed
        ? "Warehouse receipt already recorded."
        : "Warehouse receipt recorded; received stock remains quarantined for disposition review.",
      ...result,
    });
  } catch (error) {
    return sendError(res, error, "receiveDistributorStockReturn");
  }
};

export const inspectDistributorStockReturn = async (req, res) => {
  try {
    const result = await inspectDistributorStockReturnCollection({
      distributorId: req.params.id,
      stockReturnId: req.params.returnId,
      collectionId: req.params.collectionId,
      notes: req.body?.notes,
      lines: req.body?.lines,
      idempotencyKey: req.get("Idempotency-Key"),
      actor: actorFromRequest(req),
    });
    return res.json({
      success: true,
      message: result.replayed
        ? "Warehouse inspection already recorded."
        : "Inspection recorded as a recommendation; stock remains quarantined.",
      ...result,
    });
  } catch (error) {
    return sendError(res, error, "inspectDistributorStockReturn");
  }
};
