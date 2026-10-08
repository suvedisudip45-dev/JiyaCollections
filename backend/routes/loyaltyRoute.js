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
import { authenticate, authorize, setDistributorContext } from "../middleware/unifiedAuth.js";

const loyaltyRouter = express.Router();

// ── Public / Frontend & Admin read ──────────────────────────────────────────
loyaltyRouter.get("/levels", getAllLevels);

// ── Customer loyalty status ──────────────────────────────────────────────────
loyaltyRouter.get("/my-status", authenticate, authorize("customer:loyalty_read"), getUserLoyaltyStatus);

// ── Admin level configuration ────────────────────────────────────────────────
loyaltyRouter.post("/level", authenticate, authorize("loyalty:level_manage"), createOrUpdateLevel);
loyaltyRouter.delete("/level/:id", authenticate, authorize("loyalty:level_manage"), deleteLevel);

// ── Distributor hub loyalty endpoints ────────────────────────────────────────
// Look up customer loyalty status by phone number
loyaltyRouter.get("/customer-by-phone", authenticate, authorize("distributor:loyalty_lookup"), setDistributorContext, getCustomerLoyaltyByPhone);

// Get all hub customers (deduped from direct orders) with loyalty tiers
loyaltyRouter.get("/hub-customers", authenticate, authorize("distributor:hub_customers_read"), setDistributorContext, getHubCustomers);

// Record a loyalty gift/perk physically given to a customer
loyaltyRouter.post("/hub-gift", authenticate, authorize("distributor:hub_gift_record"), setDistributorContext, recordLoyaltyGift);

// Get all gift records for this distributor hub
loyaltyRouter.get("/hub-gifts", authenticate, authorize("distributor:hub_gifts_read"), setDistributorContext, getHubGifts);

export default loyaltyRouter;
