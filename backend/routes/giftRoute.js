import express from "express";
import { authenticate, authorize, setManufacturerContext } from "../middleware/unifiedAuth.js";
import {
  getGiftCatalog,
  saveGiftEntry,
  deleteGiftEntry,
  getTierConfigs,
  saveTierConfig,
  createManufacturerGiftDistribution,
  getManufacturerGiftQueue,
  getManufacturerOrderGiftOptions,
  respondToGiftQueue,
  markGiftReturned,
} from "../controllers/giftController.js";

const adminGiftRouter = express.Router();
const manufacturerGiftRouter = express.Router();

adminGiftRouter.get("/catalog", authenticate, authorize("loyalty:level_manage"), getGiftCatalog);
adminGiftRouter.post("/catalog", authenticate, authorize("loyalty:level_manage"), saveGiftEntry);
adminGiftRouter.delete("/catalog/:id", authenticate, authorize("loyalty:level_manage"), deleteGiftEntry);
adminGiftRouter.get("/tiers", authenticate, authorize("loyalty:level_manage"), getTierConfigs);
adminGiftRouter.post("/tiers", authenticate, authorize("loyalty:level_manage"), saveTierConfig);
adminGiftRouter.post("/assign-manufacturer", authenticate, authorize("loyalty:level_manage"), createManufacturerGiftDistribution);
adminGiftRouter.post("/returned/:orderId", authenticate, authorize("returns:admin_review"), markGiftReturned);

manufacturerGiftRouter.get("/inbound", authenticate, authorize("manufacturer:hub_gift_record"), setManufacturerContext, getManufacturerGiftQueue);
manufacturerGiftRouter.get("/order-options/:orderId", authenticate, authorize("manufacturer:assignment_status_update"), setManufacturerContext, getManufacturerOrderGiftOptions);
manufacturerGiftRouter.post("/:id/respond", authenticate, authorize("manufacturer:hub_gift_record"), setManufacturerContext, respondToGiftQueue);
manufacturerGiftRouter.post("/returned/:orderId", authenticate, authorize("manufacturer:delivery_return"), setManufacturerContext, markGiftReturned);

export { adminGiftRouter, manufacturerGiftRouter };
export default adminGiftRouter;
