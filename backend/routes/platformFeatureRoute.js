import express from "express";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import { getPublicPlatformFeatures, updatePlatformFeatureSettings } from "../controllers/platformFeatureController.js";

const platformFeatureRouter = express.Router();

platformFeatureRouter.get("/", getPublicPlatformFeatures);
platformFeatureRouter.patch(
  "/",
  authenticate,
  authorize("platform:features_manage"),
  updatePlatformFeatureSettings
);

export default platformFeatureRouter;
