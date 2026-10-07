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
import { decreaseDistributorInventory } from "../controllers/distributorInventoryController.js";
import {
  createStockTransferRequest,
  receiveStockTransferForRequest,
} from "../controllers/stockTransferController.js";
import {
  getAssignedOrders,
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

