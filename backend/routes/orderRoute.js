import express from "express";
import {
  placeOrder,
  allOrders,
  allAdminOrders,
  userOrders,
  lookupAdminOrderCustomer,
  verifyAdminOrderCustomer,
  adminCreateOrder,
} from "../controllers/orderController.js";
import { customerCancelOrder } from "../controllers/orderCancellationController.js";
import { getAdminOrderControl, cancelAdminOrderControl } from "../controllers/adminOrderControlController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const orderRouter = express.Router();
const requireAdminOrderControl = (req, res, next) => {
  if (req.auth?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_ROLE_REQUIRED",
      message: "Only administrators can access order controls.",
    });
  }
  return next();
};

// Admin Features
// /list → all orders (read-only, hub monitor view)
orderRouter.post("/list", authenticate, authorize("order:list_all"), allOrders);
// /admin-list → only admin-created orders (operational management tab)
orderRouter.post("/admin-list", authenticate, authorize("order:list_admin"), allAdminOrders);
orderRouter.get("/admin-customer", authenticate, authorize("order:customer_lookup"), lookupAdminOrderCustomer);
orderRouter.post("/admin-customer/verify", authenticate, authorize("order:customer_verify"), verifyAdminOrderCustomer);
orderRouter.post("/admin-create", authenticate, authorize("order:admin_create"), adminCreateOrder);
orderRouter.get(
  "/admin/control/:orderId",
  authenticate,
  requireAdminOrderControl,
  authorize("order:control"),
  getAdminOrderControl,
);
orderRouter.post(
  "/admin/control/:orderId/cancel",
  authenticate,
  requireAdminOrderControl,
  authorize("order:control"),
  cancelAdminOrderControl,
);

// Payment Features
orderRouter.post("/place", authenticate, authorize("customer:order_place"), placeOrder);
orderRouter.post("/:orderId/cancel", authenticate, authorize("order:customer_cancel"), customerCancelOrder);

// User Features
orderRouter.post("/userorders", authenticate, authorize("customer:order_read"), userOrders);

export default orderRouter;
