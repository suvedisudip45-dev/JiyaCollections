import express from "express";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import {
  getLocationDiscounts,
  getManufacturerLocations,
  updateLocationDiscount,
  updateManufacturerLocations,
} from "../controllers/locationPricingController.js";

const locationPricingRouter = express.Router();

locationPricingRouter.get("/manufacturer-locations", authenticate, authorize("manufacturer:admin_update"), getManufacturerLocations);
locationPricingRouter.post("/manufacturer-locations", authenticate, authorize("manufacturer:admin_update"), updateManufacturerLocations);
locationPricingRouter.get("/location-discounts", authenticate, authorize("product:update"), getLocationDiscounts);
locationPricingRouter.post("/location-discounts", authenticate, authorize("product:update"), updateLocationDiscount);

export default locationPricingRouter;