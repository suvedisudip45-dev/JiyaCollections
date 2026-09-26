import express from "express";
import {
  getAllLevels,
  createOrUpdateLevel,
  deleteLevel,
  getUserLoyaltyStatus,
  getCustomerLoyaltyByPhone,
  getHubCustomers,
  recordLoyaltyGift,
  getHubGifts,
} from "../controllers/loyaltyController.js";
import { authenticate, authorize, setManufacturerContext } from "../middleware/unifiedAuth.js";

const loyaltyRouter = express.Router();

// ── Public / Frontend & Admin read ──────────────────────────────────────────
loyaltyRouter.get("/levels", getAllLevels);

// ── Customer loyalty status ──────────────────────────────────────────────────
loyaltyRouter.get("/my-status", authenticate, authorize("customer:loyalty_read"), getUserLoyaltyStatus);

// ── Admin level configuration ────────────────────────────────────────────────
loyaltyRouter.post("/level", authenticate, authorize("loyalty:level_manage"), createOrUpdateLevel);
loyaltyRouter.delete("/level/:id", authenticate, authorize("loyalty:level_manage"), deleteLevel);

// ── Manufacturer loyalty endpoints ───────────────────────────────────────────
// Look up customer loyalty status by phone number
loyaltyRouter.get("/customer-by-phone", authenticate, authorize("manufacturer:loyalty_lookup"), setManufacturerContext, getCustomerLoyaltyByPhone);

// Get all hub customers (deduped from direct orders) with loyalty tiers
loyaltyRouter.get("/hub-customers", authenticate, authorize("manufacturer:hub_customers_read"), setManufacturerContext, getHubCustomers);

// Record a loyalty gift/perk physically given to a customer
loyaltyRouter.post("/hub-gift", authenticate, authorize("manufacturer:hub_gift_record"), setManufacturerContext, recordLoyaltyGift);

// Get all gift records for this manufacturer hub
loyaltyRouter.get("/hub-gifts", authenticate, authorize("manufacturer:hub_gifts_read"), setManufacturerContext, getHubGifts);

export default loyaltyRouter;
