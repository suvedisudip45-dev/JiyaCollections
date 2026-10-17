import {
  getProductSalesLocations,
  getProductSalesRows,
  getProductSalesSummary,
  getProductSalesCharts,
  getProductSalesTimeline,
  resolveProductAnalyticsRange,
  validateAnalyticsProductId,
} from "../services/productSalesAnalyticsService.js";

const readSingleQuery = (query, key, fallback) => {
  const value = query[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    throw Object.assign(new Error(`${key} must be provided once.`), { code: "INVALID_PRODUCT_ANALYTICS_FILTER" });
  }
  return value;
};

const getRange = (req) => resolveProductAnalyticsRange({
  period: readSingleQuery(req.query, "period", "month"),
  startDate: readSingleQuery(req.query, "startDate", undefined),
  endDate: readSingleQuery(req.query, "endDate", undefined),
});

const getPageNumber = (query, key, defaultValue, max) => {
  const value = readSingleQuery(query, key, String(defaultValue));
  if (!/^\d+$/.test(value)) {
    throw Object.assign(new Error(`${key} must be a positive integer.`), { code: "INVALID_PRODUCT_ANALYTICS_FILTER" });
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw Object.assign(new Error(`${key} must be between 1 and ${max}.`), { code: "INVALID_PRODUCT_ANALYTICS_FILTER" });
  }
  return number;
};

const contextFor = (req, includeRevenue, distributorId = undefined) => ({
  distributorId,
  includeRevenue,
});

const respondWith = (operation) => async (req, res) => {
  try {
    const data = await operation(req);
    return res.json({ success: true, ...data });
  } catch (error) {
    if (error.code === "INVALID_PRODUCT_ANALYTICS_FILTER") {
      return res.status(400).json({ success: false, message: error.message, code: error.code });
    }
    if (error.code === "ANALYTICS_SCOPE_INVALID") {
      return res.status(403).json({ success: false, message: "The requested analytics scope is not available.", code: error.code });
    }
    console.error("Product sales analytics request failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load product sales analytics.",
      code: "PRODUCT_ANALYTICS_FAILED",
    });
  }
};

const getScope = (req) => {
  if (req.distributorId) return contextFor(req, false, req.distributorId);
  if (req.auth?.role !== "ADMIN") {
    throw Object.assign(new Error("Administrative product analytics access is required."), { code: "ANALYTICS_SCOPE_INVALID" });
  }
  return contextFor(req, true, undefined);
};

export const getProductAnalyticsSummary = respondWith(async (req) => {
  const range = getRange(req);
  const summary = await getProductSalesSummary({ range, ...getScope(req) });
  return { range: { period: range.period, startDate: range.startDate, endDate: range.endDate }, summary };
});

export const getProductAnalyticsProducts = respondWith(async (req) => {
  const range = getRange(req);
  const context = getScope(req);
  const page = getPageNumber(req.query, "page", 1, 5000);
  const limit = getPageNumber(req.query, "limit", 25, 100);
  const sort = readSingleQuery(req.query, "sort", "soldQuantity");
  const result = await getProductSalesRows({ range, ...context, page, limit, sort });
  return { range: { period: range.period, startDate: range.startDate, endDate: range.endDate }, ...result };
});

export const getProductAnalyticsLocations = respondWith(async (req) => {
  const range = getRange(req);
  const productId = readSingleQuery(req.query, "productId", undefined);
  if (productId !== undefined) validateAnalyticsProductId(productId);
  const locations = await getProductSalesLocations({
    range,
    ...getScope(req),
    productId,
  });
  return { range: { period: range.period, startDate: range.startDate, endDate: range.endDate }, locations };
});

export const getProductAnalyticsTimeline = respondWith(async (req) => {
  const range = getRange(req);
  const productId = validateAnalyticsProductId(readSingleQuery(req.query, "productId", undefined));
  const timeline = await getProductSalesTimeline({
    range,
    ...getScope(req),
    productId,
  });
  return { range: { period: range.period, startDate: range.startDate, endDate: range.endDate }, timeline };
});

export const getProductAnalyticsCharts = respondWith(async (req) => {
  const range = getRange(req);
  const productId = readSingleQuery(req.query, "productId", undefined);
  if (productId !== undefined) validateAnalyticsProductId(productId);
  const charts = await getProductSalesCharts({ range, productId });
  return {
    range: { period: range.period, startDate: range.startDate, endDate: range.endDate },
    charts,
    profitBasis: "GROSS_PRODUCT_PROFIT",
  };
});
