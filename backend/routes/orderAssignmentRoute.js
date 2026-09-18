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
import authManufacturer from "../middleware/manufacturerAuth.js";
import { authAdmin } from "../middleware/auth.js";

const orderAssignmentRouter = express.Router();

// Internal / Admin
orderAssignmentRouter.post("/assign", authAdmin, assignOrder);
orderAssignmentRouter.get("/all", authAdmin, getAllAssignments);
orderAssignmentRouter.get("/admin/all", authAdmin, getAllAssignments);
orderAssignmentRouter.post("/manual-assign", authAdmin, manualAssign);
orderAssignmentRouter.post("/admin/manual-assign", authAdmin, manualAssign);

// Manufacturer-authenticated
orderAssignmentRouter.get("/my", authManufacturer, getMyAssignments);
orderAssignmentRouter.post("/my", authManufacturer, getMyAssignments);
orderAssignmentRouter.get("/detail/:id", authManufacturer, getAssignmentById);
orderAssignmentRouter.get("/:id", authManufacturer, getAssignmentById);
orderAssignmentRouter.post("/accept/:id", authManufacturer, acceptOrder);
orderAssignmentRouter.post("/accept", authManufacturer, acceptOrder);
orderAssignmentRouter.post("/reject/:id", authManufacturer, rejectOrder);
orderAssignmentRouter.post("/reject", authManufacturer, rejectOrder);
orderAssignmentRouter.put("/status/:id", authManufacturer, updateAssignmentStatus);
orderAssignmentRouter.post("/status/:id", authManufacturer, updateAssignmentStatus);
orderAssignmentRouter.post("/status", authManufacturer, updateAssignmentStatus);

export default orderAssignmentRouter;
