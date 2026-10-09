import express from "express";
import {
  getDistributorProfile,
  getDistributorPickupProfile,
  updateDistributorPickupProfile,
  toggleDistributorAvailability,
  listDistributorApplications,
  registerDistributor,
  reviewDistributorApplication,
} from "../controllers/distributorController.js";
import {
  decreaseDistributorInventory,
  getDistributorInventory,
} from "../controllers/distributorInventoryController.js";
import {
  createDistributorDirectOrder,
  getDistributorDirectOrders,
  updateDistributorDirectOrderStatus,
} from "../controllers/distributorDirectOrderController.js";
import {
  createStockTransferRequest,
  receiveStockTransferForRequest,
} from "../controllers/stockTransferController.js";
import {
  getAssignedOrders,
  selectDistributorSelfDelivery,
  updateSelfDeliveryOrderStatus,
  processDistributorOrderReturn,
} from "../controllers/distributorDeliveryController.js";
import {
  getDistributorStatement,
  askDistributorSettlement,
  listDistributorRates,
} from "../controllers/distributorFinanceController.js";
import { authenticate, authorize, setDistributorContext } from "../middleware/unifiedAuth.js";
import { publicRegistrationRateLimit } from "../middleware/authRateLimit.js";

const distributorRouter = express.Router();

distributorRouter.post("/register", publicRegistrationRateLimit, registerDistributor);

// Stock & Inventory
distributorRouter.post(
  "/stock-requests",
  authenticate,
  authorize("transfer:distributor_request"),
  setDistributorContext,
  createStockTransferRequest,
);
distributorRouter.post(
  "/stock-requests/:id/receive",
  authenticate,
  authorize("transfer:distributor_receive"),
  setDistributorContext,
  receiveStockTransferForRequest,
);
distributorRouter.post(
  "/inventory/decrease",
  authenticate,
  authorize("distributor:inventory_decrease"),
  setDistributorContext,
  decreaseDistributorInventory,
);
distributorRouter.get(
  "/inventory",
  authenticate,
  authorize("distributor:inventory_read"),
  setDistributorContext,
  getDistributorInventory,
);
distributorRouter.get(
  "/orders/direct",
  authenticate,
  authorize("distributor:direct_order_read"),
  setDistributorContext,
  getDistributorDirectOrders,
);
distributorRouter.post(
  "/orders/direct",
  authenticate,
  authorize("distributor:direct_order_create"),
  setDistributorContext,
  createDistributorDirectOrder,
);
distributorRouter.patch(
  "/orders/direct/status",
  authenticate,
  authorize("distributor:direct_order_status_update"),
  setDistributorContext,
  updateDistributorDirectOrderStatus,
);

// Profile & Pickup Readiness Setup
distributorRouter.get(
  "/profile",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  getDistributorProfile,
);
distributorRouter.get(
  "/pickup-profile",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  getDistributorPickupProfile,
);
distributorRouter.post(
  "/pickup-profile",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  updateDistributorPickupProfile,
);
distributorRouter.put(
  "/pickup-profile",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  updateDistributorPickupProfile,
);

// Availability Toggle (Online / Paused)
distributorRouter.patch(
  "/availability",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  toggleDistributorAvailability,
);

distributorRouter.get(
  "/orders/assigned",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  getAssignedOrders,
);
distributorRouter.post(
  "/orders/:id/self-delivery",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  selectDistributorSelfDelivery,
);
distributorRouter.patch(
  "/orders/:id/status",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  updateSelfDeliveryOrderStatus,
);
distributorRouter.post(
  "/orders/:id/return",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  processDistributorOrderReturn,
);

// Financial Dashboard, Statements & Settlements
distributorRouter.get(
  "/finance/statement",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  getDistributorStatement,
);
distributorRouter.post(
  "/finance/ask-settlement",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  askDistributorSettlement,
);
distributorRouter.get(
  "/rates",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  listDistributorRates,
);

// Admin Application Review
distributorRouter.get(
  "/admin/applications",
  authenticate,
  authorize("distributor:admin_list"),
  listDistributorApplications,
);
distributorRouter.patch(
  "/admin/applications/:id/review",
  authenticate,
  authorize("distributor:admin_review"),
  reviewDistributorApplication,
);

export default distributorRouter;
