import express from "express";
import {
  getDistributorProfile,
  listDistributorApplications,
  registerDistributor,
  reviewDistributorApplication,
} from "../controllers/distributorController.js";
import { authenticate, authorize, setDistributorContext } from "../middleware/unifiedAuth.js";
import { publicRegistrationRateLimit } from "../middleware/authRateLimit.js";

const distributorRouter = express.Router();

distributorRouter.post("/register", publicRegistrationRateLimit, registerDistributor);
distributorRouter.get(
  "/profile",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  getDistributorProfile,
);
distributorRouter.get(
  "/admin/applications",
  authenticate,
  authorize("distributor:admin_list"),
  listDistributorApplications,
);
distributorRouter.patch(
  "/admin/applications/:id/review",
  authenticate,
  authorize("distributor:admin_review"),
  reviewDistributorApplication,
);

export default distributorRouter;
