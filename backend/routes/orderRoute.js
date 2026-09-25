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
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import authUser from "../middleware/auth.js";

const orderRouter = express.Router();

// Admin Features
// /list → all orders (read-only, hub monitor view)
orderRouter.post("/list", authenticate, authorize("order:list_all"), allOrders);
// /admin-list → only admin-created orders (operational management tab)
orderRouter.post("/admin-list", authenticate, authorize("order:list_admin"), allAdminOrders);
orderRouter.get("/admin-customer", authenticate, authorize("order:customer_lookup"), lookupAdminOrderCustomer);
orderRouter.post("/admin-customer/verify", authenticate, authorize("order:customer_verify"), verifyAdminOrderCustomer);
orderRouter.post("/admin-create", authenticate, authorize("order:admin_create"), adminCreateOrder);

// Payment Features
orderRouter.post("/place", authUser, placeOrder);

// User Features
orderRouter.post("/userorders", authUser, userOrders);

export default orderRouter;
