import express from "express";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import {
  getProductAnalyticsLocations,
  getProductAnalyticsCharts,
  getProductAnalyticsProducts,
  getProductAnalyticsSummary,
  getProductAnalyticsTimeline,
} from "../controllers/productSalesAnalyticsController.js";

const adminAnalyticsRouter = express.Router();
const requireAdminRole = (req, res, next) => {
  if (req.auth?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: "Only administrators can access full product revenue analytics.",
      code: "ADMIN_ROLE_REQUIRED",
    });
  }
  return next();
};

adminAnalyticsRouter.use(authenticate, requireAdminRole, authorize("product:sales_analytics_read"));
adminAnalyticsRouter.get("/summary", getProductAnalyticsSummary);
adminAnalyticsRouter.get("/charts", getProductAnalyticsCharts);
adminAnalyticsRouter.get("/products", getProductAnalyticsProducts);
adminAnalyticsRouter.get("/locations", getProductAnalyticsLocations);
adminAnalyticsRouter.get("/timeline", getProductAnalyticsTimeline);

export default adminAnalyticsRouter;
