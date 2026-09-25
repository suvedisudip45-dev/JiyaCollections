import express from "express";
import {
  getMyInventory,
  updateStock,
  getAllInventory,
  getLowStockAlerts,
} from "../controllers/manufacturerInventoryController.js";
import { authenticate, authorize, setManufacturerContext } from "../middleware/unifiedAuth.js";
import { authAdmin } from "../middleware/auth.js";

const manufacturerInventoryRouter = express.Router();

// Manufacturer-authenticated
manufacturerInventoryRouter.get("/my", authenticate, authorize("manufacturer:inventory_read"), setManufacturerContext, getMyInventory);
manufacturerInventoryRouter.post("/my", authenticate, authorize("manufacturer:inventory_read"), setManufacturerContext, getMyInventory);
manufacturerInventoryRouter.post("/update", authenticate, authorize("manufacturer:inventory_update"), setManufacturerContext, updateStock);

// Admin-only (supports both /all and /admin/all)
manufacturerInventoryRouter.get("/all", authAdmin, getAllInventory);
manufacturerInventoryRouter.get("/admin/all", authAdmin, getAllInventory);
manufacturerInventoryRouter.get("/low-stock", authAdmin, getLowStockAlerts);
manufacturerInventoryRouter.get("/admin/low-stock", authAdmin, getLowStockAlerts);

export default manufacturerInventoryRouter;
