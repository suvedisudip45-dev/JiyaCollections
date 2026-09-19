import express from "express";
import {
  getShippingConfig,
  updateShippingConfig,
  calculateShippingFee,
} from "../controllers/shippingController.js";
import adminAuth from "../middleware/adminAuth.js";

const shippingRouter = express.Router();

shippingRouter.get("/config", getShippingConfig);
shippingRouter.get("/calculate", calculateShippingFee);
shippingRouter.post("/calculate", calculateShippingFee);
shippingRouter.post("/update", adminAuth, updateShippingConfig);

export default shippingRouter;
