import { getAdminOrderControlDetails } from "../services/adminOrderControlService.js";
import { cancelAdminOrder } from "../services/orderCancellationService.js";

export const getAdminOrderControl = async (req, res) => {
  try {
    const result = await getAdminOrderControlDetails(req.params.orderId);
    if (!result) {
      return res.status(404).json({
        success: false,
        code: "ORDER_NOT_FOUND",
        message: "Order not found.",
      });
    }
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("getAdminOrderControl error:", error);
    return res.status(500).json({
      success: false,
      code: "ORDER_CONTROL_DETAILS_UNAVAILABLE",
      message: "Order control details could not be loaded.",
    });
  }
};

export const cancelAdminOrderControl = async (req, res) => {
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 10 || reason.length > 500) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CANCELLATION",
      message: "A cancellation reason between 10 and 500 characters is required.",
    });
  }

  try {
    const result = await cancelAdminOrder({
      orderId: req.params.orderId,
      actorId: req.auth.accountId,
      reason,
    });
    return res.json({
      success: true,
      alreadyCancelled: result.alreadyCancelled,
      message: result.alreadyCancelled ? "This order was already cancelled." : "Order cancelled successfully.",
      order: result.order,
    });
  } catch (error) {
    console.error("cancelAdminOrderControl error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "ORDER_CANCELLATION_FAILED",
      message: error.message || "Order could not be cancelled.",
    });
  }
};
