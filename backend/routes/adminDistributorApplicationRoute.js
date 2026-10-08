import express from "express";
import {
  getDistributorCoverage,
  listManufacturerDistributorApplications,
  reviewManufacturerDistributorApplication,
  updateDistributorAdminProfile,
  updateDistributorCoverage,
} from "../controllers/distributorController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const adminDistributorApplicationRouter = express.Router();

adminDistributorApplicationRouter.get(
  "/coverage",
  authenticate,
  authorize("distributor:admin_list"),
  getDistributorCoverage,
);
adminDistributorApplicationRouter.put(
  "/:id/coverage",
  authenticate,
  authorize("distributor:admin_review"),
  updateDistributorCoverage,
);
adminDistributorApplicationRouter.put(
  "/:id/profile",
  authenticate,
  authorize("distributor:admin_review"),
  updateDistributorAdminProfile,
);
adminDistributorApplicationRouter.get(
  "/",
  authenticate,
  authorize("distributor:admin_list"),
  listManufacturerDistributorApplications,
);
adminDistributorApplicationRouter.patch(
  "/:id",
  authenticate,
  authorize("distributor:admin_review"),
  reviewManufacturerDistributorApplication,
);

export default adminDistributorApplicationRouter;
