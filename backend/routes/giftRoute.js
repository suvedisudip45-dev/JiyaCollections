import express from "express";
import { authenticate, authorize, setDistributorContext } from "../middleware/unifiedAuth.js";
import {
  getGiftCatalog,
  saveGiftEntry,
  deleteGiftEntry,
  getTierConfigs,
  saveTierConfig,
  createDistributorGiftDistribution,
  getDistributorGiftQueue,
  getDistributorOrderGiftOptions,
  respondToDistributorGiftQueue,
  markGiftReturned,
  markDistributorGiftReturned,
} from "../controllers/giftController.js";

const adminGiftRouter = express.Router();
const distributorGiftRouter = express.Router();

adminGiftRouter.get("/catalog", authenticate, authorize("loyalty:level_manage"), getGiftCatalog);
adminGiftRouter.post("/catalog", authenticate, authorize("loyalty:level_manage"), saveGiftEntry);
adminGiftRouter.delete("/catalog/:id", authenticate, authorize("loyalty:level_manage"), deleteGiftEntry);
adminGiftRouter.get("/tiers", authenticate, authorize("loyalty:level_manage"), getTierConfigs);
adminGiftRouter.post("/tiers", authenticate, authorize("loyalty:level_manage"), saveTierConfig);
adminGiftRouter.post("/assign-distributor", authenticate, authorize("loyalty:level_manage"), createDistributorGiftDistribution);
adminGiftRouter.post("/returned/:orderId", authenticate, authorize("returns:admin_review"), markGiftReturned);

distributorGiftRouter.get("/inbound", authenticate, authorize("distributor:hub_gifts_read"), setDistributorContext, getDistributorGiftQueue);
distributorGiftRouter.get("/order-options/:orderId", authenticate, authorize("distributor:assignment_status_update"), setDistributorContext, getDistributorOrderGiftOptions);
distributorGiftRouter.post("/:id/respond", authenticate, authorize("distributor:hub_gift_record"), setDistributorContext, respondToDistributorGiftQueue);
distributorGiftRouter.post("/returned/:orderId", authenticate, authorize("distributor:delivery_return"), setDistributorContext, markDistributorGiftReturned);

export { adminGiftRouter, distributorGiftRouter };
export default adminGiftRouter;
