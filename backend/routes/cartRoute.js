import express from "express";
import {
  addToCart,
  getUserCart,
  updateCart,
  syncCart,
} from "../controllers/cartController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const cartRouter = express.Router();

cartRouter.post("/get", authenticate, authorize("customer:cart_read"), getUserCart);
cartRouter.post("/add", authenticate, authorize("customer:cart_write"), addToCart);
cartRouter.post("/update", authenticate, authorize("customer:cart_write"), updateCart);
cartRouter.post("/sync", authenticate, authorize("customer:cart_write"), syncCart);

export default cartRouter;

