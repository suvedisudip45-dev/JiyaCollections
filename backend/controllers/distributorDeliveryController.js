import {
  listAssignedDistributorOrders,
  markDistributorSelfDeliveryReady,
  updateSelfDeliveryStatus,
  processSelfDeliveryReturn,
} from "../services/distributorSelfDeliveryService.js";
import {
  bookDistributorNcmOrders as bookDistributorNcmOrdersService,
  holdDistributorOrderForDelivery,
  listDistributorNcmOrders,
} from "../services/distributorNcmService.js";

/**
 * GET /api/distributor/orders/assigned
 * List orders allocated to this Distributor hub.
 */
export const getAssignedOrders = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.auth?.distributorId;
    if (!distributorId) {
      return res.status(403).json({
        success: false,
        message: "An approved distributor profile is required.",
      });
    }

    const { status, page, limit } = req.query;
    const result = await listAssignedDistributorOrders({
      distributorId,
      status,
      page,
      limit,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("getAssignedOrders error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to list assigned orders.",
      code: error.code || "ASSIGNED_ORDERS_ERROR",
    });
  }
};

export const getDistributorNcmOrders = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.auth?.distributorId;
    if (!distributorId) {
      return res.status(403).json({ success: false, message: "An approved distributor profile is required." });
    }
    const result = await listDistributorNcmOrders({
      distributorId,
      type: req.query.type,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("getDistributorNcmOrders error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "NCM_ORDERS_ERROR",
      message: error.message || "Failed to list NCM orders.",
    });
  }
};

export const holdDistributorOrder = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.auth?.distributorId;
    if (!distributorId) {
      return res.status(403).json({ success: false, message: "An approved distributor profile is required." });
    }
    const result = await holdDistributorOrderForDelivery({
      distributorId,
      assignmentId: req.params.id,
      deliveryType: req.body.deliveryType,
      actorContext: {
        actorId: req.auth?.accountId || req.auth?.userId || null,
        actorRole: req.auth?.role || "DISTRIBUTOR",
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        correlationId: req.correlationId || null,
      },
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("holdDistributorOrder error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "DELIVERY_HOLD_ERROR",
      message: error.message || "Failed to hold order for delivery.",
    });
  }
};

export const bookDistributorNcmOrders = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.auth?.distributorId;
    if (!distributorId) {
      return res.status(403).json({ success: false, message: "An approved distributor profile is required." });
    }
    const result = await bookDistributorNcmOrdersService({
      distributorId,
      assignmentIds: req.body.assignmentIds,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("bookDistributorNcmOrders error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "NCM_BULK_BOOKING_ERROR",
      message: error.message || "Failed to book selected orders with NCM.",
    });
  }
};

/**
 * POST /api/distributor/orders/:id/self-delivery
 * Select distributor-managed delivery after package preparation.
 */
export const selectDistributorSelfDelivery = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.auth?.distributorId;
    if (!distributorId) {
      return res.status(403).json({
        success: false,
        message: "An approved distributor profile is required.",
      });
    }

    const result = await markDistributorSelfDeliveryReady({
      distributorId,
      assignmentIdOrOrderId: req.params.id,
      actorContext: {
        actorId: req.auth?.accountId || req.auth?.userId || null,
        actorRole: req.auth?.role || "DISTRIBUTOR",
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        correlationId: req.correlationId || null,
      },
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("selectDistributorSelfDelivery error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to select distributor self-delivery.",
      code: error.code || "SELF_DELIVERY_SELECTION_ERROR",
    });
  }
};

/**
 * PATCH /api/distributor/orders/:id/status
 * Update status sequentially: Dispatched -> On the Way -> Delivered.
 */
export const updateSelfDeliveryOrderStatus = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.auth?.distributorId;
    if (!distributorId) {
      return res.status(403).json({
        success: false,
        message: "An approved distributor profile is required.",
      });
    }

    const id = req.params.id || req.body.id || req.body.assignmentId || req.body.orderId;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status field is required (Dispatched, On the Way, Delivered).",
      });
    }

    const actorContext = {
      actorId: req.auth?.accountId || req.auth?.userId || null,
      actorRole: req.auth?.role || "DISTRIBUTOR",
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
      correlationId: req.correlationId || null,
    };

    const result = await updateSelfDeliveryStatus({
      distributorId,
      assignmentIdOrOrderId: id,
      status,
      notes,
      actorContext,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("updateSelfDeliveryOrderStatus error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update order delivery status.",
      code: error.code || "DELIVERY_STATUS_ERROR",
    });
  }
};

/**
 * POST /api/distributor/orders/:id/return
 * Process self-delivery customer returns, conduct return QA, update stock (restock or damage write-off), and inform Admin.
 */
export const processDistributorOrderReturn = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.auth?.distributorId;
    if (!distributorId) {
      return res.status(403).json({
        success: false,
        message: "An approved distributor profile is required.",
      });
    }

    const id = req.params.id || req.body.id || req.body.orderId || req.body.assignmentId;
    const { items, reason, notes, damageType, damageNotes, returnRequestId } = req.body;

    const actorContext = {
      actorId: req.auth?.accountId || req.auth?.userId || null,
      actorRole: req.auth?.role || "DISTRIBUTOR",
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
      correlationId: req.correlationId || null,
    };

    const result = await processSelfDeliveryReturn({
      distributorId,
      assignmentIdOrOrderId: id,
      items,
      reason,
      notes,
      damageType,
      damageNotes,
      returnRequestId,
      actorContext,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("processDistributorOrderReturn error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to process customer return.",
      code: error.code || "RETURN_PROCESSING_ERROR",
    });
  }
};
