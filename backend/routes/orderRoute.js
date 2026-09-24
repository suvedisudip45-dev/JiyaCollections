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
import adminAuth from "../middleware/adminAuth.js";
import authUser from "../middleware/auth.js";

const orderRouter = express.Router();

// Admin Features
// /list → all orders (read-only, hub monitor view)
orderRouter.post("/list", adminAuth, allOrders);
// /admin-list → only admin-created orders (operational management tab)
orderRouter.post("/admin-list", adminAuth, allAdminOrders);
orderRouter.get("/admin-customer", adminAuth, lookupAdminOrderCustomer);
orderRouter.post("/admin-customer/verify", adminAuth, verifyAdminOrderCustomer);
orderRouter.post("/admin-create", adminAuth, adminCreateOrder);

// Payment Features
orderRouter.post("/place", authUser, placeOrder);

// User Features
orderRouter.post("/userorders", authUser, userOrders);

export default orderRouter;
