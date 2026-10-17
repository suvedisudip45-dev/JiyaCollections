import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";

const NEPAL_OFFSET_MS = 5 * 60 * 60 * 1000 + 45 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CUSTOM_RANGE_DAYS = 366;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const invalidFilter = (message) => Object.assign(new Error(message), {
  code: "INVALID_PRODUCT_ANALYTICS_FILTER",
});

const getKathmanduDate = (date) => {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const parseCalendarDate = (value, fieldName) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidFilter(`${fieldName} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalidFilter(`${fieldName} is not a valid calendar date.`);
  }
  return value;
};

const addCalendarDays = (value, amount) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
};

const kathmanduMidnight = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - NEPAL_OFFSET_MS);
};

export const resolveProductAnalyticsRange = ({ period = "month", startDate, endDate } = {}, now = new Date()) => {
  if (typeof period !== "string") throw invalidFilter("period must be a single value.");
  let selectedPeriod = period.trim().toLowerCase();
  let firstDate;
  let lastDate;

  if (selectedPeriod === "custom") {
    firstDate = parseCalendarDate(startDate, "startDate");
    lastDate = parseCalendarDate(endDate, "endDate");
    if (lastDate < firstDate) throw invalidFilter("endDate must be on or after startDate.");
    const dayCount = (Date.parse(`${addCalendarDays(lastDate, 1)}T00:00:00.000Z`)
      - Date.parse(`${firstDate}T00:00:00.000Z`)) / DAY_MS;
    if (dayCount > MAX_CUSTOM_RANGE_DAYS) {
      throw invalidFilter(`Custom date ranges cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days.`);
    }
  } else {
    if (!["week", "month", "year"].includes(selectedPeriod)) {
      throw invalidFilter("period must be week, month, year, or custom.");
    }
    const today = getKathmanduDate(now);
    if (selectedPeriod === "week") {
      const [year, month, day] = today.split("-").map(Number);
      const todayDate = new Date(Date.UTC(year, month - 1, day));
      const daysSinceMonday = (todayDate.getUTCDay() + 6) % 7;
      firstDate = addCalendarDays(today, -daysSinceMonday);
      lastDate = today;
    } else if (selectedPeriod === "month") {
      firstDate = `${today.slice(0, 7)}-01`;
      lastDate = today;
    } else {
      firstDate = `${today.slice(0, 4)}-01-01`;
      lastDate = today;
    }
  }

  return {
    period: selectedPeriod,
    start: kathmanduMidnight(firstDate),
    end: kathmanduMidnight(addCalendarDays(lastDate, 1)),
    startDate: firstDate,
    endDate: lastDate,
  };
};

export const validateAnalyticsProductId = (productId) => {
  if (typeof productId !== "string" || !UUID_PATTERN.test(productId)) {
    throw invalidFilter("A valid product ID is required.");
  }
  return productId;
};

const validateScope = ({ distributorId, includeRevenue }) => {
  if (distributorId !== undefined && (typeof distributorId !== "string" || !UUID_PATTERN.test(distributorId))) {
    throw Object.assign(new Error("Authenticated distributor context is invalid."), { code: "ANALYTICS_SCOPE_INVALID" });
  }
  if (typeof includeRevenue !== "boolean") {
    throw Object.assign(new Error("Analytics access scope is invalid."), { code: "ANALYTICS_SCOPE_INVALID" });
  }
};

const databaseString = (value) => Prisma.sql`CONVERT(${value} USING utf8mb4) COLLATE utf8mb4_unicode_ci`;

const orderScope = (distributorId) => distributorId
  ? Prisma.sql`
      AND (
        o.\`distributorId\` = ${databaseString(distributorId)}
        OR EXISTS (
          SELECT 1 FROM \`OrderAssignment\` assignment
          WHERE assignment.\`orderId\` = o.\`id\`
            AND assignment.\`distributorId\` = ${databaseString(distributorId)}
        )
      )
    `
  : Prisma.empty;

const returnScope = (distributorId) => distributorId
  ? Prisma.sql`
      AND (
        returned.\`distributorId\` = ${databaseString(distributorId)}
        OR EXISTS (
          SELECT 1
          FROM \`Order\` scopedOrder
          WHERE scopedOrder.\`id\` = returned.\`orderId\`
            AND (
              scopedOrder.\`distributorId\` = ${databaseString(distributorId)}
              OR EXISTS (
                SELECT 1 FROM \`OrderAssignment\` assignment
                WHERE assignment.\`orderId\` = scopedOrder.\`id\`
                  AND assignment.\`distributorId\` = ${databaseString(distributorId)}
              )
            )
        )
      )
    `
  : Prisma.empty;

const salesRows = (range, distributorId, includeRevenue) => {
  const revenueSelect = includeRevenue
    ? Prisma.sql`,
    COALESCE(SUM(COALESCE(
      item.\`lineTotal\`,
      COALESCE(item.\`purchasedUnitPrice\`, item.\`price\`, item.\`originalUnitPrice\`) * item.\`quantity\`,
      0
    )), 0) AS \`grossRevenue\``
    : Prisma.empty;
  return prisma.$queryRaw(Prisma.sql`
  SELECT
    COALESCE(SUM(item.\`quantity\`), 0) AS \`soldQuantity\`,
    COUNT(DISTINCT o.\`id\`) AS \`orderCount\`${revenueSelect}
  FROM \`Order\` o
  CROSS JOIN JSON_TABLE(
    IF(JSON_TYPE(o.\`items\`) = 'ARRAY', o.\`items\`, JSON_ARRAY()),
    '$[*]' COLUMNS (
      \`productId\` VARCHAR(191) PATH '$.productId' NULL ON EMPTY,
      \`legacyProductId\` VARCHAR(191) PATH '$._id' NULL ON EMPTY,
      \`idProduct\` VARCHAR(191) PATH '$.id' NULL ON EMPTY,
      \`quantity\` DECIMAL(12, 3) PATH '$.quantity' DEFAULT '1' ON EMPTY,
      \`lineTotal\` DECIMAL(14, 2) PATH '$.lineTotal' NULL ON EMPTY,
      \`purchasedUnitPrice\` DECIMAL(14, 2) PATH '$.purchasedUnitPrice' NULL ON EMPTY,
      \`price\` DECIMAL(14, 2) PATH '$.price' NULL ON EMPTY,
      \`originalUnitPrice\` DECIMAL(14, 2) PATH '$.originalUnitPrice' NULL ON EMPTY
    )
  ) item
  WHERE o.\`status\` <> 'Cancelled'
    AND o.\`date\` >= ${BigInt(range.start.getTime())}
    AND o.\`date\` < ${BigInt(range.end.getTime())}
    AND COALESCE(NULLIF(item.\`productId\`, ''), NULLIF(item.\`legacyProductId\`, ''), NULLIF(item.\`idProduct\`, '')) IS NOT NULL
    ${orderScope(distributorId)}
`);
};

const returnRows = (range, distributorId, includeRevenue) => {
  const revenueSelect = includeRevenue
    ? Prisma.sql`,
    COALESCE(SUM(COALESCE(item.\`refundAmount\`, item.\`unitPrice\` * item.\`quantity\`, 0)), 0) AS \`refundedRevenue\``
    : Prisma.empty;
  return prisma.$queryRaw(Prisma.sql`
  SELECT
    COALESCE(SUM(item.\`quantity\`), 0) AS \`returnedQuantity\`,
    COUNT(DISTINCT returned.\`id\`) AS \`returnCases\`${revenueSelect}
  FROM \`CustomerReturn\` returned
  CROSS JOIN JSON_TABLE(
    IF(JSON_TYPE(returned.\`items\`) = 'ARRAY', returned.\`items\`, JSON_ARRAY()),
    '$[*]' COLUMNS (
      \`quantity\` DECIMAL(12, 3) PATH '$.quantity' DEFAULT '1' ON EMPTY,
      \`refundAmount\` DECIMAL(14, 2) PATH '$.refundAmount' NULL ON EMPTY,
      \`unitPrice\` DECIMAL(14, 2) PATH '$.unitPrice' NULL ON EMPTY
    )
  ) item
  WHERE returned.\`refundStatus\` = 'COMPLETED'
    AND returned.\`returnDate\` >= ${range.start}
    AND returned.\`returnDate\` < ${range.end}
    ${returnScope(distributorId)}
`);
};

const toNumber = (value) => Number(value || 0);
const roundMoney = (value) => Number(toNumber(value).toFixed(2));
const resolveProductIdColumn = Prisma.sql`(COALESCE(NULLIF(item.\`productId\`, ''), NULLIF(item.\`legacyProductId\`, ''), NULLIF(item.\`idProduct\`, ''))) COLLATE utf8mb4_unicode_ci`;
const salesCte = (range, distributorId, includeRevenue) => {
  const revenueSelect = includeRevenue
    ? Prisma.sql`,
      SUM(COALESCE(
        item.\`lineTotal\`,
        COALESCE(item.\`purchasedUnitPrice\`, item.\`price\`, item.\`originalUnitPrice\`) * item.\`quantity\`,
        0
      )) AS \`grossRevenue\``
    : Prisma.empty;
  return Prisma.sql`
  sales AS (
    SELECT
      ${resolveProductIdColumn} AS \`productId\`,
      MAX(NULLIF(item.\`name\`, '')) COLLATE utf8mb4_unicode_ci AS \`snapshotName\`,
      SUM(item.\`quantity\`) AS \`soldQuantity\`${revenueSelect}
    FROM \`Order\` o
    CROSS JOIN JSON_TABLE(
      IF(JSON_TYPE(o.\`items\`) = 'ARRAY', o.\`items\`, JSON_ARRAY()),
      '$[*]' COLUMNS (
        \`productId\` VARCHAR(191) PATH '$.productId' NULL ON EMPTY,
        \`legacyProductId\` VARCHAR(191) PATH '$._id' NULL ON EMPTY,
        \`idProduct\` VARCHAR(191) PATH '$.id' NULL ON EMPTY,
        \`name\` VARCHAR(255) PATH '$.name' NULL ON EMPTY,
        \`quantity\` DECIMAL(12, 3) PATH '$.quantity' DEFAULT '1' ON EMPTY,
        \`lineTotal\` DECIMAL(14, 2) PATH '$.lineTotal' NULL ON EMPTY,
        \`purchasedUnitPrice\` DECIMAL(14, 2) PATH '$.purchasedUnitPrice' NULL ON EMPTY,
        \`price\` DECIMAL(14, 2) PATH '$.price' NULL ON EMPTY,
        \`originalUnitPrice\` DECIMAL(14, 2) PATH '$.originalUnitPrice' NULL ON EMPTY
      )
    ) item
    WHERE o.\`status\` <> 'Cancelled'
      AND o.\`date\` >= ${BigInt(range.start.getTime())}
      AND o.\`date\` < ${BigInt(range.end.getTime())}
      AND ${resolveProductIdColumn} IS NOT NULL
      ${orderScope(distributorId)}
    GROUP BY ${resolveProductIdColumn}
  )
`;
};

const returnsCte = (range, distributorId, includeRevenue) => {
  const revenueSelect = includeRevenue
    ? Prisma.sql`,
      SUM(COALESCE(item.\`refundAmount\`, item.\`unitPrice\` * item.\`quantity\`, 0)) AS \`refundedRevenue\``
    : Prisma.empty;
  return Prisma.sql`
  return_metrics AS (
    SELECT
      (COALESCE(NULLIF(item.\`productId\`, ''), NULLIF(item.\`legacyProductId\`, ''), NULLIF(item.\`idProduct\`, ''))) COLLATE utf8mb4_unicode_ci AS \`productId\`,
      SUM(item.\`quantity\`) AS \`returnedQuantity\`,
      COUNT(DISTINCT returned.\`id\`) AS \`returnCases\`${revenueSelect}
    FROM \`CustomerReturn\` returned
    CROSS JOIN JSON_TABLE(
      IF(JSON_TYPE(returned.\`items\`) = 'ARRAY', returned.\`items\`, JSON_ARRAY()),
      '$[*]' COLUMNS (
        \`productId\` VARCHAR(191) PATH '$.productId' NULL ON EMPTY,
        \`legacyProductId\` VARCHAR(191) PATH '$._id' NULL ON EMPTY,
        \`idProduct\` VARCHAR(191) PATH '$.id' NULL ON EMPTY,
        \`quantity\` DECIMAL(12, 3) PATH '$.quantity' DEFAULT '1' ON EMPTY,
        \`refundAmount\` DECIMAL(14, 2) PATH '$.refundAmount' NULL ON EMPTY,
        \`unitPrice\` DECIMAL(14, 2) PATH '$.unitPrice' NULL ON EMPTY
      )
    ) item
    WHERE returned.\`refundStatus\` = 'COMPLETED'
      AND returned.\`returnDate\` >= ${range.start}
      AND returned.\`returnDate\` < ${range.end}
      AND ${resolveProductIdColumn} IS NOT NULL
      ${returnScope(distributorId)}
    GROUP BY ${resolveProductIdColumn}
  )
`;
};

const buildAnalyticsCtes = (range, distributorId, includeRevenue) => Prisma.sql`
  WITH ${salesCte(range, distributorId, includeRevenue)}, ${returnsCte(range, distributorId, includeRevenue)}
`;

const normalizeProductRow = (row, includeRevenue) => {
  const soldQuantity = toNumber(row.soldQuantity);
  const returnedQuantity = toNumber(row.returnedQuantity);
  return {
    productId: row.productId,
    name: row.name || row.snapshotName || "Removed product",
    category: row.category || null,
    soldQuantity,
    returnedQuantity,
    returnCases: toNumber(row.returnCases),
    returnRate: soldQuantity ? Number(((returnedQuantity / soldQuantity) * 100).toFixed(2)) : 0,
    ...(includeRevenue ? {
      grossRevenue: roundMoney(row.grossRevenue),
      refundedRevenue: roundMoney(row.refundedRevenue),
      netRevenue: roundMoney(toNumber(row.grossRevenue) - toNumber(row.refundedRevenue)),
    } : {}),
  };
};

export const getProductSalesSummary = async ({ range, distributorId, includeRevenue }) => {
  validateScope({ distributorId, includeRevenue });
  const [salesResult, returnsResult] = await Promise.all([
    salesRows(range, distributorId, includeRevenue),
    returnRows(range, distributorId, includeRevenue),
  ]);
  const sales = salesResult[0] || {};
  const returns = returnsResult[0] || {};
  const soldQuantity = toNumber(sales.soldQuantity);
  const returnedQuantity = toNumber(returns.returnedQuantity);
  return {
    soldQuantity,
    orderCount: toNumber(sales.orderCount),
    returnedQuantity,
    returnCases: toNumber(returns.returnCases),
    returnRate: soldQuantity ? Number(((returnedQuantity / soldQuantity) * 100).toFixed(2)) : 0,
    ...(includeRevenue ? {
      grossRevenue: roundMoney(sales.grossRevenue),
      refundedRevenue: roundMoney(returns.refundedRevenue),
      netRevenue: roundMoney(toNumber(sales.grossRevenue) - toNumber(returns.refundedRevenue)),
    } : {}),
  };
};

export const getProductSalesRows = async ({
  range,
  distributorId,
  includeRevenue,
  page,
  limit,
  sort,
}) => {
  validateScope({ distributorId, includeRevenue });
  const sortColumns = {
    soldQuantity: "`soldQuantity` DESC, `productId` ASC",
    returnedQuantity: "`returnedQuantity` DESC, `productId` ASC",
    revenue: "`grossRevenue` DESC, `productId` ASC",
  };
  if (!Number.isInteger(page) || page < 1 || page > 5000) throw invalidFilter("page must be an integer between 1 and 5000.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalidFilter("limit must be an integer between 1 and 100.");
  if (!Object.hasOwn(sortColumns, sort)) throw invalidFilter("sort must be soldQuantity, returnedQuantity, or revenue.");
  if (!includeRevenue && sort === "revenue") throw invalidFilter("Revenue sorting is not available in distributor analytics.");
  const orderBy = Prisma.raw(sortColumns[sort]);
  const offset = (page - 1) * limit;
  const ctes = buildAnalyticsCtes(range, distributorId, includeRevenue);
  const revenueSelect = includeRevenue
    ? Prisma.sql`COALESCE(s.\`grossRevenue\`, 0) AS \`grossRevenue\`,
        COALESCE(r.\`refundedRevenue\`, 0) AS \`refundedRevenue\`,`
    : Prisma.empty;

  const [rows, totalResult] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`
      ${ctes}
      SELECT
        COALESCE(p.\`id\`, s.\`productId\`, r.\`productId\`) COLLATE utf8mb4_unicode_ci AS \`productId\`,
        COALESCE(NULLIF(p.\`name\`, ''), s.\`snapshotName\`, 'Removed product') COLLATE utf8mb4_unicode_ci AS \`name\`,
        p.\`category\` COLLATE utf8mb4_unicode_ci AS \`category\`,
        COALESCE(s.\`soldQuantity\`, 0) AS \`soldQuantity\`,
        COALESCE(r.\`returnedQuantity\`, 0) AS \`returnedQuantity\`,
        COALESCE(r.\`returnCases\`, 0) AS \`returnCases\`,
        ${revenueSelect}
        CASE WHEN COALESCE(s.\`soldQuantity\`, 0) = 0 THEN 0
          ELSE ROUND(COALESCE(r.\`returnedQuantity\`, 0) / s.\`soldQuantity\` * 100, 2)
        END AS \`returnRate\`
      FROM sales s
      LEFT JOIN \`Product\` p ON p.\`id\` = s.\`productId\`
      LEFT JOIN return_metrics r ON r.\`productId\` = s.\`productId\`
      UNION ALL
      SELECT
        r.\`productId\` COLLATE utf8mb4_unicode_ci AS \`productId\`,
        COALESCE(NULLIF(p.\`name\`, ''), 'Removed product') COLLATE utf8mb4_unicode_ci AS \`name\`,
        p.\`category\` COLLATE utf8mb4_unicode_ci AS \`category\`,
        0 AS \`soldQuantity\`,
        r.\`returnedQuantity\` AS \`returnedQuantity\`,
        r.\`returnCases\` AS \`returnCases\`,
        ${includeRevenue ? Prisma.sql`0 AS \`grossRevenue\`, r.\`refundedRevenue\` AS \`refundedRevenue\`,` : Prisma.empty}
        0 AS \`returnRate\`
      FROM return_metrics r
      LEFT JOIN \`Product\` p ON p.\`id\` = r.\`productId\`
      LEFT JOIN sales s ON s.\`productId\` = r.\`productId\`
      WHERE s.\`productId\` IS NULL
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `),
    prisma.$queryRaw(Prisma.sql`
      ${ctes}
      SELECT COUNT(*) AS \`total\`
      FROM (
        SELECT \`productId\` FROM sales
        UNION
        SELECT \`productId\` FROM return_metrics
      ) groupedProducts
    `),
  ]);

  return {
    products: rows.map((row) => normalizeProductRow(row, includeRevenue)),
    pagination: {
      page,
      limit,
      total: toNumber(totalResult[0]?.total),
      totalPages: Math.ceil(toNumber(totalResult[0]?.total) / limit),
    },
  };
};

export const getProductSalesLocations = async ({ range, distributorId, includeRevenue, productId }) => {
  validateScope({ distributorId, includeRevenue });
  const productFilter = productId ? Prisma.sql`AND ${resolveProductIdColumn} = ${databaseString(validateAnalyticsProductId(productId))}` : Prisma.empty;
  const revenueSelect = includeRevenue
    ? Prisma.sql`SUM(COALESCE(item.\`lineTotal\`, COALESCE(item.\`purchasedUnitPrice\`, item.\`price\`, item.\`originalUnitPrice\`) * item.\`quantity\`, 0)) AS \`grossRevenue\`,`
    : Prisma.empty;
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT
      COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.\`address\`, '$.province')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.\`address\`, '$.state')), ''), 'Unknown') COLLATE utf8mb4_unicode_ci AS \`province\`,
      COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.\`address\`, '$.district')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.\`address\`, '$.city')), ''), 'Unknown') COLLATE utf8mb4_unicode_ci AS \`district\`,
      COUNT(DISTINCT o.\`id\`) AS \`orderCount\`,
      COUNT(DISTINCT o.\`userId\`) AS \`customerCount\`,
      SUM(item.\`quantity\`) AS \`soldQuantity\`,
      ${revenueSelect}
      1 AS \`_rowMarker\`
    FROM \`Order\` o
    CROSS JOIN JSON_TABLE(
      IF(JSON_TYPE(o.\`items\`) = 'ARRAY', o.\`items\`, JSON_ARRAY()),
      '$[*]' COLUMNS (
        \`productId\` VARCHAR(191) PATH '$.productId' NULL ON EMPTY,
        \`legacyProductId\` VARCHAR(191) PATH '$._id' NULL ON EMPTY,
        \`idProduct\` VARCHAR(191) PATH '$.id' NULL ON EMPTY,
        \`quantity\` DECIMAL(12, 3) PATH '$.quantity' DEFAULT '1' ON EMPTY,
        \`lineTotal\` DECIMAL(14, 2) PATH '$.lineTotal' NULL ON EMPTY,
        \`purchasedUnitPrice\` DECIMAL(14, 2) PATH '$.purchasedUnitPrice' NULL ON EMPTY,
        \`price\` DECIMAL(14, 2) PATH '$.price' NULL ON EMPTY,
        \`originalUnitPrice\` DECIMAL(14, 2) PATH '$.originalUnitPrice' NULL ON EMPTY
      )
    ) item
    WHERE o.\`status\` <> 'Cancelled'
      AND o.\`date\` >= ${BigInt(range.start.getTime())}
      AND o.\`date\` < ${BigInt(range.end.getTime())}
      AND ${resolveProductIdColumn} IS NOT NULL
      ${productFilter}
      ${orderScope(distributorId)}
    GROUP BY \`province\`, \`district\`
    ORDER BY \`soldQuantity\` DESC, \`province\` ASC, \`district\` ASC
    LIMIT 500
  `);
  return rows.map((row) => ({
    province: row.province,
    district: row.district,
    orderCount: toNumber(row.orderCount),
    customerCount: toNumber(row.customerCount),
    soldQuantity: toNumber(row.soldQuantity),
    ...(includeRevenue ? { grossRevenue: roundMoney(row.grossRevenue) } : {}),
  }));
};

const dayIndexToDate = (dayIndex) => new Date(Number(dayIndex) * DAY_MS).toISOString().slice(0, 10);

export const getProductSalesTimeline = async ({ range, distributorId, includeRevenue, productId }) => {
  validateScope({ distributorId, includeRevenue });
  const validProductId = validateAnalyticsProductId(productId);
  const revenueSelect = includeRevenue
    ? Prisma.sql`SUM(COALESCE(item.\`lineTotal\`, COALESCE(item.\`purchasedUnitPrice\`, item.\`price\`, item.\`originalUnitPrice\`) * item.\`quantity\`, 0)) AS \`grossRevenue\`,`
    : Prisma.empty;
  const returnRevenueSelect = includeRevenue
    ? Prisma.sql`SUM(COALESCE(item.\`refundAmount\`, item.\`unitPrice\` * item.\`quantity\`, 0)) AS \`refundedRevenue\`,`
    : Prisma.empty;
  const [sales, returns] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`
      SELECT FLOOR((o.\`date\` + ${NEPAL_OFFSET_MS}) / ${DAY_MS}) AS \`dayIndex\`,
        SUM(item.\`quantity\`) AS \`soldQuantity\`,
        ${revenueSelect}
        COUNT(DISTINCT o.\`id\`) AS \`orderCount\`
      FROM \`Order\` o
      CROSS JOIN JSON_TABLE(
        IF(JSON_TYPE(o.\`items\`) = 'ARRAY', o.\`items\`, JSON_ARRAY()),
        '$[*]' COLUMNS (
          \`productId\` VARCHAR(191) PATH '$.productId' NULL ON EMPTY,
          \`legacyProductId\` VARCHAR(191) PATH '$._id' NULL ON EMPTY,
          \`idProduct\` VARCHAR(191) PATH '$.id' NULL ON EMPTY,
          \`quantity\` DECIMAL(12, 3) PATH '$.quantity' DEFAULT '1' ON EMPTY,
          \`lineTotal\` DECIMAL(14, 2) PATH '$.lineTotal' NULL ON EMPTY,
          \`purchasedUnitPrice\` DECIMAL(14, 2) PATH '$.purchasedUnitPrice' NULL ON EMPTY,
          \`price\` DECIMAL(14, 2) PATH '$.price' NULL ON EMPTY,
          \`originalUnitPrice\` DECIMAL(14, 2) PATH '$.originalUnitPrice' NULL ON EMPTY
        )
      ) item
      WHERE o.\`status\` <> 'Cancelled'
        AND o.\`date\` >= ${BigInt(range.start.getTime())}
        AND o.\`date\` < ${BigInt(range.end.getTime())}
        AND ${resolveProductIdColumn} = ${databaseString(validProductId)}
        ${orderScope(distributorId)}
      GROUP BY \`dayIndex\`
      ORDER BY \`dayIndex\` ASC
      LIMIT 366
    `),
    prisma.$queryRaw(Prisma.sql`
      SELECT FLOOR((TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', returned.\`returnDate\`) * 1000 + ${NEPAL_OFFSET_MS}) / ${DAY_MS}) AS \`dayIndex\`,
        SUM(item.\`quantity\`) AS \`returnedQuantity\`,
        ${returnRevenueSelect}
        COUNT(DISTINCT returned.\`id\`) AS \`returnCases\`
      FROM \`CustomerReturn\` returned
      CROSS JOIN JSON_TABLE(
        IF(JSON_TYPE(returned.\`items\`) = 'ARRAY', returned.\`items\`, JSON_ARRAY()),
        '$[*]' COLUMNS (
          \`productId\` VARCHAR(191) PATH '$.productId' NULL ON EMPTY,
          \`legacyProductId\` VARCHAR(191) PATH '$._id' NULL ON EMPTY,
          \`idProduct\` VARCHAR(191) PATH '$.id' NULL ON EMPTY,
          \`quantity\` DECIMAL(12, 3) PATH '$.quantity' DEFAULT '1' ON EMPTY,
          \`refundAmount\` DECIMAL(14, 2) PATH '$.refundAmount' NULL ON EMPTY,
          \`unitPrice\` DECIMAL(14, 2) PATH '$.unitPrice' NULL ON EMPTY
        )
      ) item
      WHERE returned.\`refundStatus\` = 'COMPLETED'
        AND returned.\`returnDate\` >= ${range.start}
        AND returned.\`returnDate\` < ${range.end}
        AND ${resolveProductIdColumn} = ${databaseString(validProductId)}
        ${returnScope(distributorId)}
      GROUP BY \`dayIndex\`
      ORDER BY \`dayIndex\` ASC
      LIMIT 366
    `),
  ]);

  const byDay = new Map();
  for (const row of sales) {
    const key = toNumber(row.dayIndex);
    byDay.set(key, {
      dayIndex: key,
      soldQuantity: toNumber(row.soldQuantity),
      orderCount: toNumber(row.orderCount),
      ...(includeRevenue ? { grossRevenue: roundMoney(row.grossRevenue) } : {}),
    });
  }
  for (const row of returns) {
    const key = toNumber(row.dayIndex);
    const point = byDay.get(key) || {
      dayIndex: key,
      soldQuantity: 0,
      orderCount: 0,
      ...(includeRevenue ? { grossRevenue: 0 } : {}),
    };
    point.returnedQuantity = toNumber(row.returnedQuantity);
    point.returnCases = toNumber(row.returnCases);
    if (includeRevenue) point.refundedRevenue = roundMoney(row.refundedRevenue);
    byDay.set(key, point);
  }

  const firstDayIndex = Math.floor((range.start.getTime() + NEPAL_OFFSET_MS) / DAY_MS);
  const lastDayIndex = Math.floor((range.end.getTime() - 1 + NEPAL_OFFSET_MS) / DAY_MS);
  const daily = [];
  for (let dayIndex = firstDayIndex; dayIndex <= lastDayIndex; dayIndex += 1) {
    daily.push(byDay.get(dayIndex) || {
      dayIndex,
      soldQuantity: 0,
      returnedQuantity: 0,
      returnCases: 0,
      orderCount: 0,
      ...(includeRevenue ? { grossRevenue: 0, refundedRevenue: 0 } : {}),
    });
  }
  if (range.period !== "year") {
    return daily.map(({ dayIndex, ...point }) => ({ date: dayIndexToDate(dayIndex), ...point }));
  }

  const monthly = new Map();
  for (const { dayIndex, ...point } of daily) {
    const month = dayIndexToDate(dayIndex).slice(0, 7);
    const total = monthly.get(month) || {
      date: month,
      soldQuantity: 0,
      returnedQuantity: 0,
      returnCases: 0,
      orderCount: 0,
      ...(includeRevenue ? { grossRevenue: 0, refundedRevenue: 0 } : {}),
    };
    total.soldQuantity += point.soldQuantity;
    total.returnedQuantity += point.returnedQuantity || 0;
    total.returnCases += point.returnCases || 0;
    total.orderCount += point.orderCount;
    if (includeRevenue) {
      total.grossRevenue += point.grossRevenue || 0;
      total.refundedRevenue += point.refundedRevenue || 0;
    }
    monthly.set(month, total);
  }
  return [...monthly.values()].sort((left, right) => left.date.localeCompare(right.date)).map((point) => (
    includeRevenue
      ? { ...point, grossRevenue: roundMoney(point.grossRevenue), refundedRevenue: roundMoney(point.refundedRevenue) }
      : point
  ));
};

const buildComparisonCtes = (range) => Prisma.sql`
  WITH sales_items AS (
    SELECT
      o.\`id\` AS \`orderId\`,
      o.\`date\` AS \`orderDate\`,
      COALESCE(o.\`distributorId\`, assignment.\`distributorId\`) AS \`distributorId\`,
      COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.\`address\`, '$.province')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.\`address\`, '$.state')), ''), 'Unknown') COLLATE utf8mb4_unicode_ci AS \`province\`,
      COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.\`address\`, '$.district')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.\`address\`, '$.city')), ''), 'Unknown') COLLATE utf8mb4_unicode_ci AS \`district\`,
      item.\`itemIndex\`,
      ${resolveProductIdColumn} AS \`productId\`,
      item.\`name\` AS \`snapshotName\`,
      item.\`quantity\`,
      COALESCE(item.\`lineTotal\`, COALESCE(item.\`purchasedUnitPrice\`, item.\`price\`, item.\`originalUnitPrice\`) * item.\`quantity\`, 0) AS \`revenue\`,
      item.\`acceptedUnitCogs\`,
      item.\`itemCostPrice\`,
      item.\`legacyCostQuantity\`,
      item.\`costAllocations\`
    FROM \`Order\` o
    LEFT JOIN \`OrderAssignment\` assignment ON assignment.\`orderId\` = o.\`id\`
    CROSS JOIN JSON_TABLE(
      IF(JSON_TYPE(o.\`items\`) = 'ARRAY', o.\`items\`, JSON_ARRAY()),
      '$[*]' COLUMNS (
        \`itemIndex\` FOR ORDINALITY,
        \`productId\` VARCHAR(191) PATH '$.productId' NULL ON EMPTY,
        \`legacyProductId\` VARCHAR(191) PATH '$._id' NULL ON EMPTY,
        \`idProduct\` VARCHAR(191) PATH '$.id' NULL ON EMPTY,
        \`name\` VARCHAR(255) PATH '$.name' NULL ON EMPTY,
        \`quantity\` DECIMAL(12, 3) PATH '$.quantity' DEFAULT '1' ON EMPTY,
        \`lineTotal\` DECIMAL(14, 2) PATH '$.lineTotal' NULL ON EMPTY,
        \`purchasedUnitPrice\` DECIMAL(14, 2) PATH '$.purchasedUnitPrice' NULL ON EMPTY,
        \`price\` DECIMAL(14, 2) PATH '$.price' NULL ON EMPTY,
        \`originalUnitPrice\` DECIMAL(14, 2) PATH '$.originalUnitPrice' NULL ON EMPTY,
        \`acceptedUnitCogs\` DECIMAL(14, 2) PATH '$.agreedUnitCogsVatInclusiveAtAcceptance' NULL ON EMPTY,
        \`itemCostPrice\` DECIMAL(14, 2) PATH '$.costPrice' NULL ON EMPTY,
        \`legacyCostQuantity\` DECIMAL(12, 3) PATH '$.legacyCostQuantity' NULL ON EMPTY,
        \`costAllocations\` JSON PATH '$.productionCostAllocations' NULL ON EMPTY
      )
    ) item
    WHERE o.\`status\` <> 'Cancelled'
      AND o.\`date\` >= ${BigInt(range.start.getTime())}
      AND o.\`date\` < ${BigInt(range.end.getTime())}
      AND COALESCE(NULLIF(item.\`productId\`, ''), NULLIF(item.\`legacyProductId\`, ''), NULLIF(item.\`idProduct\`, '')) IS NOT NULL
  ),
  allocated_costs AS (
    SELECT
      salesItem.\`orderId\`,
      salesItem.\`itemIndex\`,
      SUM(COALESCE(allocation.\`quantity\`, 0) * COALESCE(allocation.\`unitCogs\`, 0)) AS \`allocatedCogs\`,
      SUM(COALESCE(allocation.\`quantity\`, 0)) AS \`allocatedQuantity\`
    FROM sales_items salesItem
    CROSS JOIN JSON_TABLE(
      IF(JSON_TYPE(salesItem.\`costAllocations\`) = 'ARRAY', salesItem.\`costAllocations\`, JSON_ARRAY()),
      '$[*]' COLUMNS (
        \`quantity\` DECIMAL(12, 3) PATH '$.quantity' DEFAULT '0' ON EMPTY,
        \`unitCogs\` DECIMAL(30, 14) PATH '$.unitCogs' DEFAULT '0' ON EMPTY
      )
    ) allocation
    GROUP BY salesItem.\`orderId\`, salesItem.\`itemIndex\`
  ),
  costed_sales AS (
    SELECT
      salesItem.*,
      COALESCE(allocated.\`allocatedCogs\`, 0)
        + GREATEST(0, COALESCE(salesItem.\`legacyCostQuantity\`, salesItem.\`quantity\` - COALESCE(allocated.\`allocatedQuantity\`, 0)))
          * COALESCE(NULLIF(salesItem.\`acceptedUnitCogs\`, 0), NULLIF(salesItem.\`itemCostPrice\`, 0), product.\`costPrice\`, 0) AS \`cogs\`,
      CASE
        WHEN COALESCE(NULLIF(salesItem.\`acceptedUnitCogs\`, 0), NULLIF(salesItem.\`itemCostPrice\`, 0), product.\`costPrice\`, 0) > 0
        THEN 0
        ELSE GREATEST(0, COALESCE(salesItem.\`legacyCostQuantity\`, salesItem.\`quantity\` - COALESCE(allocated.\`allocatedQuantity\`, 0)))
          + CASE WHEN COALESCE(allocated.\`allocatedCogs\`, 0) > 0 THEN 0 ELSE COALESCE(allocated.\`allocatedQuantity\`, 0) END
      END AS \`uncostedQuantity\`
    FROM sales_items salesItem
    LEFT JOIN allocated_costs allocated
      ON allocated.\`orderId\` = salesItem.\`orderId\` AND allocated.\`itemIndex\` = salesItem.\`itemIndex\`
    LEFT JOIN \`Product\` product ON product.\`id\` = salesItem.\`productId\`
  ),
  return_items AS (
    SELECT
      returned.\`id\` AS \`returnId\`,
      COALESCE(returned.\`distributorId\`, returnOrder.\`distributorId\`, returnAssignment.\`distributorId\`) AS \`distributorId\`,
      COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(returnOrder.\`address\`, '$.province')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(returnOrder.\`address\`, '$.state')), ''), 'Unknown') COLLATE utf8mb4_unicode_ci AS \`province\`,
      COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(returnOrder.\`address\`, '$.district')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(returnOrder.\`address\`, '$.city')), ''), 'Unknown') COLLATE utf8mb4_unicode_ci AS \`district\`,
      (COALESCE(NULLIF(returnItem.\`productId\`, ''), NULLIF(returnItem.\`legacyProductId\`, ''), NULLIF(returnItem.\`idProduct\`, ''))) COLLATE utf8mb4_unicode_ci AS \`productId\`,
      returnItem.\`quantity\`,
      COALESCE(returnItem.\`refundAmount\`, returnItem.\`unitPrice\` * returnItem.\`quantity\`, 0) AS \`refundedRevenue\`
    FROM \`CustomerReturn\` returned
    LEFT JOIN \`Order\` returnOrder ON returnOrder.\`id\` = returned.\`orderId\`
    LEFT JOIN \`OrderAssignment\` returnAssignment ON returnAssignment.\`orderId\` = returnOrder.\`id\`
    CROSS JOIN JSON_TABLE(
      IF(JSON_TYPE(returned.\`items\`) = 'ARRAY', returned.\`items\`, JSON_ARRAY()),
      '$[*]' COLUMNS (
        \`productId\` VARCHAR(191) PATH '$.productId' NULL ON EMPTY,
        \`legacyProductId\` VARCHAR(191) PATH '$._id' NULL ON EMPTY,
        \`idProduct\` VARCHAR(191) PATH '$.id' NULL ON EMPTY,
        \`quantity\` DECIMAL(12, 3) PATH '$.quantity' DEFAULT '1' ON EMPTY,
        \`refundAmount\` DECIMAL(14, 2) PATH '$.refundAmount' NULL ON EMPTY,
        \`unitPrice\` DECIMAL(14, 2) PATH '$.unitPrice' NULL ON EMPTY
      )
    ) returnItem
    WHERE returned.\`refundStatus\` = 'COMPLETED'
      AND returned.\`returnDate\` >= ${range.start}
      AND returned.\`returnDate\` < ${range.end}
      AND COALESCE(NULLIF(returnItem.\`productId\`, ''), NULLIF(returnItem.\`legacyProductId\`, ''), NULLIF(returnItem.\`idProduct\`, '')) IS NOT NULL
  )
`;

export const getProductSalesCharts = async ({ range, productId }) => {
  if (productId) validateAnalyticsProductId(productId);
  const ctes = buildComparisonCtes(range);
  const rows = await prisma.$queryRaw(Prisma.sql`
    ${ctes},
    product_sales AS (
      SELECT productId, MAX(snapshotName) AS snapshotName,
        SUM(quantity) AS soldQuantity, SUM(revenue) AS grossRevenue, SUM(cogs) AS cogs,
        SUM(uncostedQuantity) AS uncostedQuantity
      FROM costed_sales
      GROUP BY productId
    ),
    product_returns AS (
      SELECT productId, SUM(quantity) AS returnedQuantity, SUM(refundedRevenue) AS refundedRevenue
      FROM return_items GROUP BY productId
    ),
    product_keys AS (
      SELECT productId FROM product_sales UNION SELECT productId FROM product_returns
    ),
    product_report AS (
      SELECT productKeySet.productId, COALESCE(product.name, sales.snapshotName, 'Removed product') AS name,
        COALESCE(sales.soldQuantity, 0) AS soldQuantity,
        COALESCE(sales.grossRevenue, 0) AS grossRevenue,
        COALESCE(sales.cogs, 0) AS cogs,
        COALESCE(returns.returnedQuantity, 0) AS returnedQuantity,
        COALESCE(returns.refundedRevenue, 0) AS refundedRevenue,
        COALESCE(sales.grossRevenue, 0) - COALESCE(sales.cogs, 0) - COALESCE(returns.refundedRevenue, 0) AS grossProfit,
        COALESCE(sales.uncostedQuantity, 0) AS uncostedQuantity
      FROM product_keys productKeySet
      LEFT JOIN product_sales sales ON sales.productId = productKeySet.productId
      LEFT JOIN product_returns returns ON returns.productId = productKeySet.productId
      LEFT JOIN Product product ON product.id = productKeySet.productId
    ),
    ranked_products AS (
      SELECT product_report.*,
        ROW_NUMBER() OVER (ORDER BY grossRevenue DESC, name COLLATE utf8mb4_unicode_ci ASC) AS revenueRank,
        ROW_NUMBER() OVER (ORDER BY soldQuantity DESC, name COLLATE utf8mb4_unicode_ci ASC) AS quantityRank,
        ROW_NUMBER() OVER (ORDER BY grossProfit DESC, name COLLATE utf8mb4_unicode_ci ASC) AS profitRank
      FROM product_report
    ),
    location_sales AS (
      SELECT province, district, SUM(quantity) AS soldQuantity, SUM(revenue) AS grossRevenue,
        SUM(cogs) AS cogs, SUM(uncostedQuantity) AS uncostedQuantity
      FROM costed_sales GROUP BY province, district
    ),
    location_returns AS (
      SELECT province, district, SUM(quantity) AS returnedQuantity, SUM(refundedRevenue) AS refundedRevenue
      FROM return_items GROUP BY province, district
    ),
    location_keys AS (
      SELECT province, district FROM location_sales UNION SELECT province, district FROM location_returns
    ),
    location_report AS (
      SELECT locationKeySet.province, locationKeySet.district,
        COALESCE(sales.soldQuantity, 0) AS soldQuantity,
        COALESCE(sales.grossRevenue, 0) AS grossRevenue,
        COALESCE(sales.cogs, 0) AS cogs,
        COALESCE(returns.returnedQuantity, 0) AS returnedQuantity,
        COALESCE(returns.refundedRevenue, 0) AS refundedRevenue,
        COALESCE(sales.grossRevenue, 0) - COALESCE(sales.cogs, 0) - COALESCE(returns.refundedRevenue, 0) AS grossProfit,
        COALESCE(sales.uncostedQuantity, 0) AS uncostedQuantity
      FROM location_keys locationKeySet
      LEFT JOIN location_sales sales ON sales.province = locationKeySet.province AND sales.district = locationKeySet.district
      LEFT JOIN location_returns returns ON returns.province = locationKeySet.province AND returns.district = locationKeySet.district
    ),
    ranked_locations AS (
      SELECT location_report.*,
        ROW_NUMBER() OVER (ORDER BY grossRevenue DESC, province ASC, district ASC) AS revenueRank,
        ROW_NUMBER() OVER (ORDER BY soldQuantity DESC, province ASC, district ASC) AS quantityRank,
        ROW_NUMBER() OVER (ORDER BY grossProfit DESC, province ASC, district ASC) AS profitRank
      FROM location_report
    ),
    distributor_sales AS (
      SELECT distributorId, SUM(quantity) AS soldQuantity, SUM(revenue) AS grossRevenue,
        SUM(cogs) AS cogs, SUM(uncostedQuantity) AS uncostedQuantity
      FROM costed_sales
      WHERE distributorId IS NOT NULL
        ${productId ? Prisma.sql`AND productId = ${databaseString(productId)}` : Prisma.empty}
      GROUP BY distributorId
    ),
    distributor_returns AS (
      SELECT distributorId, SUM(quantity) AS returnedQuantity, SUM(refundedRevenue) AS refundedRevenue
      FROM return_items
      WHERE distributorId IS NOT NULL
        ${productId ? Prisma.sql`AND productId = ${databaseString(productId)}` : Prisma.empty}
      GROUP BY distributorId
    ),
    distributor_keys AS (
      SELECT distributorId FROM distributor_sales UNION SELECT distributorId FROM distributor_returns
    ),
    distributor_report AS (
      SELECT distributorKeySet.distributorId, distributor.name,
        COALESCE(sales.soldQuantity, 0) AS soldQuantity,
        COALESCE(sales.grossRevenue, 0) AS grossRevenue,
        COALESCE(sales.cogs, 0) AS cogs,
        COALESCE(returns.returnedQuantity, 0) AS returnedQuantity,
        COALESCE(returns.refundedRevenue, 0) AS refundedRevenue,
        COALESCE(sales.grossRevenue, 0) - COALESCE(sales.cogs, 0) - COALESCE(returns.refundedRevenue, 0) AS grossProfit,
        COALESCE(sales.uncostedQuantity, 0) AS uncostedQuantity
      FROM distributor_keys distributorKeySet
      LEFT JOIN distributor_sales sales ON sales.distributorId = distributorKeySet.distributorId
      LEFT JOIN distributor_returns returns ON returns.distributorId = distributorKeySet.distributorId
      LEFT JOIN Distributor distributor ON distributor.id = distributorKeySet.distributorId
    ),
    ranked_distributors AS (
      SELECT distributor_report.*,
        ROW_NUMBER() OVER (ORDER BY grossRevenue DESC, name ASC) AS revenueRank,
        ROW_NUMBER() OVER (ORDER BY soldQuantity DESC, name ASC) AS quantityRank,
        ROW_NUMBER() OVER (ORDER BY grossProfit DESC, name ASC) AS profitRank
      FROM distributor_report
    ),
    coverage_report AS (
      SELECT SUM(uncostedQuantity) AS uncostedQuantity FROM costed_sales
    )
    SELECT 'PRODUCT' AS kind, productId AS entityId, name AS label, CAST(NULL AS CHAR(191)) AS secondaryLabel,
      soldQuantity, grossRevenue, cogs, returnedQuantity, refundedRevenue, grossProfit, uncostedQuantity
    FROM ranked_products WHERE revenueRank <= 12 OR quantityRank <= 12 OR profitRank <= 12
    UNION ALL
    SELECT 'LOCATION' AS kind, CONCAT(province, '|', district) AS entityId, province AS label, district AS secondaryLabel,
      soldQuantity, grossRevenue, cogs, returnedQuantity, refundedRevenue, grossProfit, uncostedQuantity
    FROM ranked_locations WHERE revenueRank <= 12 OR quantityRank <= 12 OR profitRank <= 12
    UNION ALL
    SELECT 'DISTRIBUTOR' AS kind, distributorId AS entityId, name AS label, CAST(NULL AS CHAR(191)) AS secondaryLabel,
      soldQuantity, grossRevenue, cogs, returnedQuantity, refundedRevenue, grossProfit, uncostedQuantity
    FROM ranked_distributors WHERE revenueRank <= 20 OR quantityRank <= 20 OR profitRank <= 20
    UNION ALL
    SELECT 'COVERAGE' AS kind, CAST(NULL AS CHAR(191)) AS entityId, CAST(NULL AS CHAR(191)) AS label, CAST(NULL AS CHAR(191)) AS secondaryLabel,
      0 AS soldQuantity, 0 AS grossRevenue, 0 AS cogs, 0 AS returnedQuantity, 0 AS refundedRevenue, 0 AS grossProfit,
      COALESCE(uncostedQuantity, 0) AS uncostedQuantity
    FROM coverage_report
  `);

  const normalize = (row) => ({
    id: row.entityId,
    name: row.label,
    ...(row.secondaryLabel ? { province: row.label, district: row.secondaryLabel } : {}),
    soldQuantity: toNumber(row.soldQuantity),
    grossRevenue: roundMoney(row.grossRevenue),
    cogs: roundMoney(row.cogs),
    returnedQuantity: toNumber(row.returnedQuantity),
    refundedRevenue: roundMoney(row.refundedRevenue),
    grossProfit: roundMoney(row.grossProfit),
    uncostedQuantity: toNumber(row.uncostedQuantity),
  });
  return {
    products: rows.filter(({ kind }) => kind === "PRODUCT").map(normalize),
    locations: rows.filter(({ kind }) => kind === "LOCATION").map(normalize),
    distributors: rows.filter(({ kind }) => kind === "DISTRIBUTOR").map(normalize),
    costCoverage: {
      uncostedQuantity: toNumber(rows.find(({ kind }) => kind === "COVERAGE")?.uncostedQuantity),
    },
  };
};
