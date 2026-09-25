import express from "express";
import {
  assignOrder,
  getMyAssignments,
  getAssignmentById,
  acceptOrder,
  rejectOrder,
  updateAssignmentStatus,
  getAllAssignments,
  manualAssign,
} from "../controllers/orderAssignmentController.js";
import { authenticate, authorize, setManufacturerContext } from "../middleware/unifiedAuth.js";
import { authAdmin } from "../middleware/auth.js";

const orderAssignmentRouter = express.Router();

// Internal / Admin
orderAssignmentRouter.post("/assign", authAdmin, assignOrder);
orderAssignmentRouter.get("/all", authAdmin, getAllAssignments);
orderAssignmentRouter.get("/admin/all", authAdmin, getAllAssignments);
orderAssignmentRouter.post("/manual-assign", authAdmin, manualAssign);
orderAssignmentRouter.post("/admin/manual-assign", authAdmin, manualAssign);

// Manufacturer-authenticated
orderAssignmentRouter.get("/my", authenticate, authorize("manufacturer:assignments_read"), setManufacturerContext, getMyAssignments);
orderAssignmentRouter.post("/my", authenticate, authorize("manufacturer:assignments_read"), setManufacturerContext, getMyAssignments);
orderAssignmentRouter.get("/detail/:id", authenticate, authorize("manufacturer:assignment_detail"), setManufacturerContext, getAssignmentById);
orderAssignmentRouter.get("/:id", authenticate, authorize("manufacturer:assignment_detail"), setManufacturerContext, getAssignmentById);
orderAssignmentRouter.post("/accept/:id", authenticate, authorize("manufacturer:assignment_accept"), setManufacturerContext, acceptOrder);
orderAssignmentRouter.post("/accept", authenticate, authorize("manufacturer:assignment_accept"), setManufacturerContext, acceptOrder);
orderAssignmentRouter.post("/reject/:id", authenticate, authorize("manufacturer:assignment_reject"), setManufacturerContext, rejectOrder);
orderAssignmentRouter.post("/reject", authenticate, authorize("manufacturer:assignment_reject"), setManufacturerContext, rejectOrder);
orderAssignmentRouter.put("/status/:id", authenticate, authorize("manufacturer:assignment_status_update"), setManufacturerContext, updateAssignmentStatus);
orderAssignmentRouter.post("/status/:id", authenticate, authorize("manufacturer:assignment_status_update"), setManufacturerContext, updateAssignmentStatus);
orderAssignmentRouter.post("/status", authenticate, authorize("manufacturer:assignment_status_update"), setManufacturerContext, updateAssignmentStatus);

export default orderAssignmentRouter;
