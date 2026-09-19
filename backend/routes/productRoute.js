import express from "express";
import {
  addProduct,
  updateProduct,
  togglePublish,
  listProducts,
  removeProduct,
  singleProduct,
  adjustStock,
  getStockLogs,
} from "../controllers/productController.js";
import upload from "../middleware/multer.js";
import adminAuth from "../middleware/adminAuth.js";

const productRouter = express.Router();

productRouter.post(
  "/add",
  adminAuth,
  upload.any(),
  addProduct
);

productRouter.post(
  "/update",
  adminAuth,
  upload.any(),
  updateProduct
);

productRouter.post("/toggle-publish", adminAuth, togglePublish);
productRouter.post("/remove", adminAuth, removeProduct);
productRouter.post("/single", singleProduct);
productRouter.get("/list", listProducts);
productRouter.post("/adjust-stock", adminAuth, adjustStock);
productRouter.get("/stock-logs", adminAuth, getStockLogs);

export default productRouter;

