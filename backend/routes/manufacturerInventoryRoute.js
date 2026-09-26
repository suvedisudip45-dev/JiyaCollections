import express from "express";
import {
  getMyInventory,
  updateStock,
  getAllInventory,
  getLowStockAlerts,
} from "../controllers/manufacturerInventoryController.js";
import { authenticate, authorize, setManufacturerContext } from "../middleware/unifiedAuth.js";

const manufacturerInventoryRouter = express.Router();

// Manufacturer-authenticated
manufacturerInventoryRouter.get("/my", authenticate, authorize("manufacturer:inventory_read"), setManufacturerContext, getMyInventory);
manufacturerInventoryRouter.post("/my", authenticate, authorize("manufacturer:inventory_read"), setManufacturerContext, getMyInventory);
manufacturerInventoryRouter.post("/update", authenticate, authorize("manufacturer:inventory_update"), setManufacturerContext, updateStock);

// Admin-only (supports both /all and /admin/all)
manufacturerInventoryRouter.get("/all", authenticate, authorize("inventory:admin_read_all"), getAllInventory);
manufacturerInventoryRouter.get("/admin/all", authenticate, authorize("inventory:admin_read_all"), getAllInventory);
manufacturerInventoryRouter.get("/low-stock", authenticate, authorize("inventory:admin_low_stock"), getLowStockAlerts);
manufacturerInventoryRouter.get("/admin/low-stock", authenticate, authorize("inventory:admin_low_stock"), getLowStockAlerts);

export default manufacturerInventoryRouter;
