import express from "express";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import {
  getAdminDiscountAnalytics,
  getAdminDiscountAnalyticsFilters,
} from "../controllers/discountAnalyticsController.js";

const discountAnalyticsRouter = express.Router();

discountAnalyticsRouter.use(
  authenticate,
  (req, res, next) => {
    if (req.auth?.role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only administrators can access discount analytics.",
        code: "ADMIN_ROLE_REQUIRED",
      });
    }
    return next();
  },
  authorize("product:sales_analytics_read")
);
discountAnalyticsRouter.get("/", getAdminDiscountAnalytics);
discountAnalyticsRouter.get("/filters", getAdminDiscountAnalyticsFilters);

export default discountAnalyticsRouter;
