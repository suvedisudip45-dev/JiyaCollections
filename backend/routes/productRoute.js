import express from "express";
import {
  addProduct,
  updateProduct,
  togglePublish,
  toggleBestseller,
  getSubcategoryBestsellers,
  listProducts,
  removeProduct,
  singleProduct,
  adjustStock,
  getStockLogs,
} from "../controllers/productController.js";
import upload from "../middleware/multer.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const productRouter = express.Router();

productRouter.post(
  "/add",
  authenticate,
  authorize("product:create"),
  upload.any(),
  addProduct
);

productRouter.post(
  "/update",
  authenticate,
  authorize("product:update"),
  upload.any(),
  updateProduct
);

productRouter.post("/toggle-publish", authenticate, authorize("product:update"), togglePublish);
productRouter.post("/toggle-bestseller", authenticate, authorize("product:update"), toggleBestseller);
productRouter.get("/subcategory-bestsellers", getSubcategoryBestsellers);
productRouter.post("/remove", authenticate, authorize("product:delete"), removeProduct);
productRouter.post("/single", singleProduct);
productRouter.get("/list", listProducts);
productRouter.post("/adjust-stock", authenticate, authorize("stock:adjust"), adjustStock);
productRouter.get("/stock-logs", authenticate, authorize("stock:logs_read"), getStockLogs);

export default productRouter;

