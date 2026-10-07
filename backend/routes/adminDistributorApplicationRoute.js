import express from "express";
import {
  listManufacturerDistributorApplications,
  reviewManufacturerDistributorApplication,
} from "../controllers/distributorController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const adminDistributorApplicationRouter = express.Router();

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
