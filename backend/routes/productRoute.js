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
import { authenticate, authorize, extractToken } from "../middleware/unifiedAuth.js";
import { resolveProductPrices } from "../controllers/locationPricingController.js";

const productRouter = express.Router();
const authenticateProductList = (req, res, next) => {
  if (!extractToken(req)) return next();
  return authenticate(req, res, () => {
    if (req.auth?.role !== "ADMIN") return next();
    return authorize("product:list_admin")(req, res, next);
  });
};

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
productRouter.get("/subcategory-bestsellers", authenticateProductList, getSubcategoryBestsellers);
productRouter.post("/remove", authenticate, authorize("product:delete"), removeProduct);
productRouter.post("/single", authenticateProductList, singleProduct);
productRouter.get("/list", authenticateProductList, listProducts);
productRouter.post("/resolve-prices", resolveProductPrices);
productRouter.post("/adjust-stock", authenticate, authorize("stock:adjust"), adjustStock);
productRouter.get("/stock-logs", authenticate, authorize("stock:logs_read"), getStockLogs);

export default productRouter;

