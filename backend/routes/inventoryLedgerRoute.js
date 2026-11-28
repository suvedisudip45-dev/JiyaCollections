import express from "express";
import {
  getInventoryLedgerOptions,
  listInventoryLedgerEntries,
  reconcileInventory,
} from "../controllers/inventoryLedgerController.js";
import { authenticate, authorize, requireRole } from "../middleware/unifiedAuth.js";

const inventoryLedgerRouter = express.Router();
const requireInventoryAuditAccess = [authenticate, requireRole("ADMIN"), authorize("inventory:ledger_read")];

inventoryLedgerRouter.get("/options", ...requireInventoryAuditAccess, getInventoryLedgerOptions);
inventoryLedgerRouter.get("/reconciliation", ...requireInventoryAuditAccess, reconcileInventory);
inventoryLedgerRouter.get("/", ...requireInventoryAuditAccess, listInventoryLedgerEntries);

export default inventoryLedgerRouter;
