import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../config/db.js";
import {
  getProductSalesSummary,
  getProductSalesRows,
  getProductSalesCharts,
  getProductSalesLocations,
  resolveProductAnalyticsRange,
  validateAnalyticsProductId,
} from "../services/productSalesAnalyticsService.js";

const VALID_DISTRIBUTOR_ID = "aa000000-0000-4000-8000-000000000001";
const VALID_PRODUCT_ID = "bb000000-0000-4000-8000-000000000002";

test("product analytics ranges use Kathmandu calendar boundaries", () => {
  const week = resolveProductAnalyticsRange({ period: "week" }, new Date("2026-10-14T00:00:00.000Z"));
  assert.equal(week.startDate, "2026-10-12");
  assert.equal(week.endDate, "2026-10-14");

  const custom = resolveProductAnalyticsRange({
    period: "custom",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
  });
  assert.equal(custom.start.getTime(), Date.parse("2025-12-31T18:15:00.000Z"));
  assert.equal(custom.end.getTime(), Date.parse("2026-01-31T18:15:00.000Z"));
});

test("product analytics rejects invalid or excessive date ranges", () => {
  assert.throws(
    () => resolveProductAnalyticsRange({ period: "custom", startDate: "2026-02-30", endDate: "2026-03-01" }),
    { code: "INVALID_PRODUCT_ANALYTICS_FILTER" },
  );
  assert.throws(
    () => resolveProductAnalyticsRange({ period: "custom", startDate: "2025-01-01", endDate: "2026-01-02" }),
    { code: "INVALID_PRODUCT_ANALYTICS_FILTER" },
  );
  assert.throws(() => resolveProductAnalyticsRange({ period: "all" }), { code: "INVALID_PRODUCT_ANALYTICS_FILTER" });
});

test("product analytics validates product IDs before using them in filters", () => {
  assert.equal(validateAnalyticsProductId(VALID_PRODUCT_ID), VALID_PRODUCT_ID);
  assert.throws(() => validateAnalyticsProductId("1 OR 1=1"), { code: "INVALID_PRODUCT_ANALYTICS_FILTER" });
});

test("distributor product analytics rejects revenue sorting and omits revenue fields", async (t) => {
  const originalQueryRaw = prisma.$queryRaw;
  let queryCount = 0;
  const queryTexts = [];
  prisma.$queryRaw = async (query) => {
    queryTexts.push(query.sql);
    queryCount += 1;
    return queryCount === 1
      ? [{
        productId: VALID_PRODUCT_ID,
        name: "Everyday shirt",
        category: "Shirts",
        soldQuantity: 4,
        returnedQuantity: 1,
        returnCases: 1,
        returnRate: 25,
      }]
      : [{ total: 1 }];
  };
  t.after(() => {
    prisma.$queryRaw = originalQueryRaw;
  });

  const range = resolveProductAnalyticsRange({ period: "month" }, new Date("2026-10-14T00:00:00.000Z"));
  await assert.rejects(
    getProductSalesRows({
      range,
      distributorId: VALID_DISTRIBUTOR_ID,
      includeRevenue: false,
      page: 1,
      limit: 25,
      sort: "revenue",
    }),
    { code: "INVALID_PRODUCT_ANALYTICS_FILTER" },
  );
  assert.equal(queryCount, 0);

  const result = await getProductSalesRows({
    range,
    distributorId: VALID_DISTRIBUTOR_ID,
    includeRevenue: false,
    page: 1,
    limit: 25,
    sort: "soldQuantity",
  });
  assert.equal(result.products[0].soldQuantity, 4);
  assert.equal(result.products[0].returnedQuantity, 1);
  assert.equal(Object.hasOwn(result.products[0], "grossRevenue"), false);
  assert.equal(Object.hasOwn(result.products[0], "netRevenue"), false);
  assert.ok(queryTexts.every((query) => query.includes("COLLATE utf8mb4_unicode_ci")));
  assert.ok(queryTexts.every((query) => (
    !query.includes("AS `grossRevenue`") && !query.includes("AS `refundedRevenue`")
  )));

  queryCount = 0;
  const summary = await getProductSalesSummary({
    range,
    distributorId: VALID_DISTRIBUTOR_ID,
    includeRevenue: false,
  });
  assert.equal(Object.hasOwn(summary, "grossRevenue"), false);
  assert.equal(Object.hasOwn(summary, "netRevenue"), false);
  assert.equal(queryTexts.slice(-2).every((query) => (
    !query.includes("AS `grossRevenue`") && !query.includes("AS `refundedRevenue`")
  )), true);
});

test("admin comparison charts expose quantity, revenue, historical COGS, profit and distributor grouping", async (t) => {
  const originalQueryRaw = prisma.$queryRaw;
  let capturedQuery;
  prisma.$queryRaw = async (query) => {
    capturedQuery = query;
    return [
      {
        kind: "PRODUCT",
        entityId: VALID_PRODUCT_ID,
        label: "Classic T-shirt",
        soldQuantity: 10,
        grossRevenue: 5000,
        cogs: 2500,
        returnedQuantity: 1,
        refundedRevenue: 500,
        grossProfit: 2000,
        uncostedQuantity: 0,
      },
      {
        kind: "LOCATION",
        entityId: "Bagmati|Kathmandu",
        label: "Bagmati",
        secondaryLabel: "Kathmandu",
        soldQuantity: 10,
        grossRevenue: 5000,
        cogs: 2500,
        returnedQuantity: 1,
        refundedRevenue: 500,
        grossProfit: 2000,
        uncostedQuantity: 0,
      },
      {
        kind: "DISTRIBUTOR",
        entityId: VALID_DISTRIBUTOR_ID,
        label: "XYZ Distributor",
        soldQuantity: 10,
        grossRevenue: 5000,
        cogs: 2500,
        returnedQuantity: 1,
        refundedRevenue: 500,
        grossProfit: 2000,
        uncostedQuantity: 0,
      },
      { kind: "COVERAGE", uncostedQuantity: 0 },
    ];
  };
  t.after(() => {
    prisma.$queryRaw = originalQueryRaw;
  });

  const range = resolveProductAnalyticsRange({ period: "month" }, new Date("2026-10-14T00:00:00.000Z"));
  const charts = await getProductSalesCharts({ range, productId: VALID_PRODUCT_ID });
  assert.equal(charts.products[0].grossProfit, 2000);
  assert.equal(charts.locations[0].district, "Kathmandu");
  assert.equal(charts.distributors[0].name, "XYZ Distributor");
  assert.equal(charts.costCoverage.uncostedQuantity, 0);
  assert.ok(capturedQuery.sql.includes("productionCostAllocations"));
  assert.ok(capturedQuery.sql.includes("OrderAssignment"));
  assert.ok(capturedQuery.sql.includes("distributorId"));
  assert.ok(capturedQuery.sql.includes("COLLATE utf8mb4_unicode_ci"));
});

test("location analytics returns distinct customer counts for each province and district", async (t) => {
  const originalQueryRaw = prisma.$queryRaw;
  let capturedQuery;
  prisma.$queryRaw = async (query) => {
    capturedQuery = query;
    return [{
      province: "Bagmati Province",
      district: "Kathmandu",
      orderCount: 3,
      customerCount: 2,
      soldQuantity: 5,
      grossRevenue: 5625,
    }];
  };
  t.after(() => {
    prisma.$queryRaw = originalQueryRaw;
  });

  const range = resolveProductAnalyticsRange({ period: "month" }, new Date("2026-10-14T00:00:00.000Z"));
  const locations = await getProductSalesLocations({ range, includeRevenue: true });
  assert.equal(locations[0].customerCount, 2);
  assert.equal(locations[0].orderCount, 3);
  assert.ok(capturedQuery.sql.includes("COUNT(DISTINCT o.`userId`) AS `customerCount`"));
});
