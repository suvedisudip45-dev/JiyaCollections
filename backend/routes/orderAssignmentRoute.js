import express from "express";
import {
  assignOrder,
  getMyAssignments,
  getAssignmentById,
  acceptOrder,
  rejectOrder,
  updateAssignmentStatus,
  getAllAssignments,
  getUnassignedOrders,
  manualAssign,
} from "../controllers/orderAssignmentController.js";
import {
  authenticate,
  authorize,
  authorizeAny,
  setDistributorContext,
  setManufacturerContext,
  setFulfillmentContext,
} from "../middleware/unifiedAuth.js";

const orderAssignmentRouter = express.Router();

// Internal / Admin
orderAssignmentRouter.post("/assign", authenticate, authorize("assignment:create"), assignOrder);
orderAssignmentRouter.get(
  "/admin/unassigned",
  authenticate,
  authorize("assignment:admin_list"),
  getUnassignedOrders,
);
orderAssignmentRouter.get("/all", authenticate, authorize("assignment:admin_list"), getAllAssignments);
orderAssignmentRouter.get("/admin/all", authenticate, authorize("assignment:admin_list"), getAllAssignments);
orderAssignmentRouter.post("/manual-assign", authenticate, authorize("assignment:manual_assign"), manualAssign);
orderAssignmentRouter.post("/admin/manual-assign", authenticate, authorize("assignment:manual_assign"), manualAssign);

// Fulfillment Routes (Accessible by Distributor Hubs, Manufacturers & Admins)
orderAssignmentRouter.get(
  "/my",
  authenticate,
  authorizeAny("distributor:assignments_read", "manufacturer:assignments_read", "assignment:admin_list"),
  setFulfillmentContext,
  getMyAssignments
);
orderAssignmentRouter.post(
  "/my",
  authenticate,
  authorizeAny("distributor:assignments_read", "manufacturer:assignments_read", "assignment:admin_list"),
  setFulfillmentContext,
  getMyAssignments
);
orderAssignmentRouter.get(
  "/detail/:id",
  authenticate,
  authorizeAny("distributor:assignment_detail", "distributor:assignments_read", "manufacturer:assignment_detail", "manufacturer:assignments_read", "assignment:admin_list"),
  setFulfillmentContext,
  getAssignmentById
);
orderAssignmentRouter.get(
  "/:id",
  authenticate,
  authorizeAny("distributor:assignment_detail", "distributor:assignments_read", "manufacturer:assignment_detail", "manufacturer:assignments_read", "assignment:admin_list"),
  setFulfillmentContext,
  getAssignmentById
);

orderAssignmentRouter.post(
  "/accept/:id",
  authenticate,
  authorizeAny("distributor:assignment_accept", "manufacturer:assignment_accept", "assignment:admin_list"),
  setFulfillmentContext,
  acceptOrder
);

orderAssignmentRouter.post(
  "/reject/:id",
  authenticate,
  authorizeAny("distributor:assignment_reject", "manufacturer:assignment_reject", "assignment:admin_list"),
  setFulfillmentContext,
  rejectOrder
);

orderAssignmentRouter.put(
  "/status/:id",
  authenticate,
  authorizeAny("distributor:assignment_status_update", "manufacturer:assignment_status_update", "assignment:admin_list"),
  setFulfillmentContext,
  updateAssignmentStatus
);
orderAssignmentRouter.patch(
  "/status/:id",
  authenticate,
  authorizeAny("distributor:assignment_status_update", "manufacturer:assignment_status_update", "assignment:admin_list"),
  setFulfillmentContext,
  updateAssignmentStatus
);

// Distributor-explicit subroutes
orderAssignmentRouter.get("/distributor/my", authenticate, authorizeAny("distributor:assignments_read", "assignment:admin_list"), setDistributorContext, getMyAssignments);
orderAssignmentRouter.get("/distributor/:id", authenticate, authorizeAny("distributor:assignment_detail", "distributor:assignments_read", "assignment:admin_list"), setDistributorContext, getAssignmentById);

export default orderAssignmentRouter;
