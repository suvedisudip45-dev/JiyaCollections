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

const orderAssignmentRouter = express.Router();

// Internal / Admin
orderAssignmentRouter.post("/assign", authenticate, authorize("assignment:create"), assignOrder);
orderAssignmentRouter.get("/all", authenticate, authorize("assignment:admin_list"), getAllAssignments);
orderAssignmentRouter.get("/admin/all", authenticate, authorize("assignment:admin_list"), getAllAssignments);
orderAssignmentRouter.post("/manual-assign", authenticate, authorize("assignment:manual_assign"), manualAssign);
orderAssignmentRouter.post("/admin/manual-assign", authenticate, authorize("assignment:manual_assign"), manualAssign);

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
