import express from "express";
import {
  getShippingConfig,
  updateShippingConfig,
  calculateShippingFee,
} from "../controllers/shippingController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const shippingRouter = express.Router();

shippingRouter.get("/config", getShippingConfig);
shippingRouter.get("/calculate", calculateShippingFee);
shippingRouter.post("/calculate", calculateShippingFee);
shippingRouter.post("/update", authenticate, authorize("shipping:config_update"), updateShippingConfig);

export default shippingRouter;
