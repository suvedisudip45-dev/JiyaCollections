import {
  getDiscountAnalytics,
  getDiscountAnalyticsFilters,
} from "../services/discountAnalyticsService.js";

const readQuery = (query) => {
  const allowed = [
    "period",
    "startDate",
    "endDate",
    "category",
    "province",
    "district",
    "distributorId",
    "customerId",
    "search",
    "customerPage",
    "orderPage",
    "limit",
  ];
  const filters = {};
  for (const key of allowed) {
    const value = query[key];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw Object.assign(new Error(`${key} must be provided once.`), {
        code: "INVALID_DISCOUNT_ANALYTICS_FILTER",
      });
    }
    filters[key] = value;
  }
  return filters;
};

const respondWith = (operation) => async (req, res) => {
  try {
    return res.json({ success: true, ...(await operation(req)) });
  } catch (error) {
    if (error.code === "INVALID_DISCOUNT_ANALYTICS_FILTER") {
      return res.status(400).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    }
    console.error("Discount analytics request failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load discount analytics.",
      code: "DISCOUNT_ANALYTICS_FAILED",
    });
  }
};

export const getAdminDiscountAnalytics = respondWith(async (req) => (
  getDiscountAnalytics(readQuery(req.query))
));

export const getAdminDiscountAnalyticsFilters = respondWith(async () => (
  getDiscountAnalyticsFilters()
));
