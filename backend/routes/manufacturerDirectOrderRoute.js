import express from "express";
import {
  createDirectOrder,
  getMyDirectOrders,
  updateDirectOrderStatus,
} from "../controllers/manufacturerDirectOrderController.js";
import { authenticate, authorize, setManufacturerContext } from "../middleware/unifiedAuth.js";

const manufacturerDirectOrderRouter = express.Router();

manufacturerDirectOrderRouter.post("/create", authenticate, authorize("manufacturer:direct_order_create"), setManufacturerContext, createDirectOrder);
manufacturerDirectOrderRouter.get("/my-orders", authenticate, authorize("manufacturer:direct_order_read"), setManufacturerContext, getMyDirectOrders);
manufacturerDirectOrderRouter.post("/update-status", authenticate, authorize("manufacturer:direct_order_status_update"), setManufacturerContext, updateDirectOrderStatus);

export default manufacturerDirectOrderRouter;
