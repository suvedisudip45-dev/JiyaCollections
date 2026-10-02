import { cancelCustomerOrder } from "../services/orderCancellationService.js";

export const customerCancelOrder = async (req, res) => {
  try {
    const result = await cancelCustomerOrder({
      orderId: req.params.orderId,
      customerId: req.userId,
      reason: req.body.reason,
    });
    return res.json({
      success: true,
      alreadyCancelled: result.alreadyCancelled,
      message: result.alreadyCancelled ? "This order was already cancelled." : "Order cancelled successfully.",
      order: result.order,
    });
  } catch (error) {
    const status = error.code === "ORDER_NOT_FOUND" ? 404 : error.status || (error.code?.includes("CONFLICT") || error.code?.includes("CUTOFF") ? 409 : 400);
    return res.status(status).json({ success: false, code: error.code || "ORDER_CANCELLATION_FAILED", message: error.message });
  }
};