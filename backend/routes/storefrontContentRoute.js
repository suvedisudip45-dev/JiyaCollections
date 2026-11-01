import express from "express";
import { getPublicStorefrontContent, saveStorefrontContent, uploadStorefrontImage } from "../controllers/storefrontContentController.js";
import { secureProductUpload } from "../middleware/secureUpload.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const storefrontContentRouter = express.Router();

storefrontContentRouter.get("/", getPublicStorefrontContent);
storefrontContentRouter.put("/", authenticate, authorize("platform:features_manage"), saveStorefrontContent);
storefrontContentRouter.post(
  "/upload-image",
  authenticate,
  authorize("platform:features_manage"),
  ...secureProductUpload,
  uploadStorefrontImage
);

export default storefrontContentRouter;
