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

const requireAdminRole = (req, res, next) => {
  if (req.auth?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_ROLE_REQUIRED",
      message: "Only administrators can manage distributor applications.",
    });
  }
  return next();
};

adminDistributorApplicationRouter.use(authenticate, requireAdminRole);

adminDistributorApplicationRouter.get(
  "/coverage",
  authorize("distributor:admin_list"),
  getDistributorCoverage,
);
adminDistributorApplicationRouter.put(
  "/:id/coverage",
  authorize("distributor:admin_review"),
  updateDistributorCoverage,
);
adminDistributorApplicationRouter.put(
  "/:id/profile",
  authorize("distributor:admin_review"),
  updateDistributorAdminProfile,
);
adminDistributorApplicationRouter.get(
  "/",
  authorize("distributor:admin_list"),
  listManufacturerDistributorApplications,
);
adminDistributorApplicationRouter.patch(
  "/:id",
  authorize("distributor:admin_review"),
  reviewManufacturerDistributorApplication,
);

export default adminDistributorApplicationRouter;
