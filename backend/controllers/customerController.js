import { prisma } from "../config/db.js";
import { Prisma } from "@prisma/client";
import { v2 as cloudinary } from "cloudinary";
import { calculateUserLoyalty } from "./loyaltyController.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { recordSystemAudit } from "../services/auditService.js";
import {
  calculateAllocatedProductionOverhead,
  calculateFinancialDashboardProductCosts,
  calculateProductFixedOverheadPerSoldUnit,
  countPurchaseTransactions,
} from "../services/financialDashboardCosting.js";

// Helper to safely parse JSON arrays
const parseJson = (val, fallback = []) => {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
};

// GET /api/customer/list (Admin only)
export const listAllCustomers = async (req, res) => {
  try {
    const { search = "" } = req.query;
    const pagination = getPagination(req.query);

    const [users, orders, letters, levels] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          firstName: true,
          lastName: true,
          name: true,
          email: true,
          phone: true,
          gender: true,
          socialCustomerCode: true,
          socialCustomerPhone: true,
          loyaltyTier: true,
          isInactiveProfile: true,
          inactiveProfileData: true,
          addresses: true,
        },
      }),
      prisma.order.findMany({
        where: { status: { notIn: ["Cancelled"] } },
        select: {
          id: true,
          userId: true,
          amount: true,
          date: true,
          status: true,
          address: true,
        },
      }),
      prisma.customerLetterImage.findMany({
        select: { id: true, userId: true },
      }),
      prisma.customerLevel.findMany({ orderBy: { levelNumber: "asc" } }),
    ]);

    // Aggregate orders & letters per user
    const ordersByUser = {};
    for (const o of orders) {
      if (!ordersByUser[o.userId]) ordersByUser[o.userId] = [];
      ordersByUser[o.userId].push(o);
    }

    const lettersByUser = {};
    for (const l of letters) {
      if (!lettersByUser[l.userId]) lettersByUser[l.userId] = 0;
      lettersByUser[l.userId]++;
    }

    // Build customer cards with calculated loyalty level
    let customerList = users.map((user) => {
      const userOrders = ordersByUser[user.id] || [];
      const totalOrders = userOrders.length;
      const totalSpend = userOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0);
      const letterCount = lettersByUser[user.id] || 0;

      // Determine level
      let currentLevel = levels[0] || {
        levelNumber: 1,
        name: "Bronze Explorer",
        badgeIcon: "🥉",
        color: "#CD7F32",
      };

      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        if (totalSpend >= Number(lvl.minSpend) && totalOrders >= Number(lvl.minOrders)) {
          currentLevel = lvl;
        }
      }

      // Latest order
      const latestOrder = userOrders.length > 0
        ? userOrders.sort((a, b) => Number(b.date) - Number(a.date))[0]
        : null;

      const addresses = parseJson(user.addresses, []);
      const primaryCity = addresses.length > 0
        ? addresses[0].city
        : (latestOrder ? parseJson(latestOrder.address, {})?.city : "");

      const inactiveProfileData = parseJson(user.inactiveProfileData, {});

      return {
        id: user.id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        name: user.name || `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Customer",
        email: user.email,
        phone: user.phone || (addresses[0]?.phone || "") || user.socialCustomerPhone || "",
        gender: user.gender || inactiveProfileData.gender || "PREFER_NOT_TO_SAY",
        socialCustomerCode: user.socialCustomerCode || "",
        socialCustomerPhone: user.socialCustomerPhone || user.phone || "",
        loyaltyTier: user.loyaltyTier || inactiveProfileData.loyaltyTier || "",
        isInactiveProfile: Boolean(user.isInactiveProfile),
        inactiveProfileData,
        city: primaryCity || "",
        totalSpend,
        totalOrders,
        letterCount,
        currentLevel,
        latestOrderDate: latestOrder ? Number(latestOrder.date) : null,
      };
    });

    // Apply search filter
    const searchStr = typeof search === "string" ? search.trim() : "";
    if (searchStr) {
      const query = searchStr.toLowerCase();
      customerList = customerList.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.email.toLowerCase().includes(query) ||
          (c.phone && c.phone.toLowerCase().includes(query)) ||          (c.socialCustomerCode && c.socialCustomerCode.toLowerCase().includes(query)) ||
          (c.loyaltyTier && c.loyaltyTier.toLowerCase().includes(query)) ||          (c.city && c.city.toLowerCase().includes(query)) ||
          c.currentLevel.name.toLowerCase().includes(query)
      );
    }

    // Sort by total spend descending
    customerList.sort((a, b) => b.totalSpend - a.totalSpend);

    const total = customerList.length;
    const pageCustomers = customerList.slice(pagination.skip, pagination.skip + pagination.limit);
    res.json(paginatedResponse("customers", pageCustomers, pagination, total));
  } catch (error) {
    console.error("Error listing customers:", error);
    res.json({ success: false, message: error.message });
  }
};

const parseNotificationMessage = (payload) => {
  const value = typeof payload === "string" ? parseJson(payload, {}) : payload;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of ["message", "text", "body", "content"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].slice(0, 4000);
  }
  return null;
};

const parseDateOnly = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

const nextUtcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
const nepalMidnight = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - 345 * 60 * 1000);
const currentNepalCalendarDate = (now) => {
  const dateParts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
};

const resolveCustomerDateRange = (query, now = new Date()) => {
  const period = String(query.period || "all");
  if (period === "all") return { start: null, end: null };

  if (period === "week" || period === "month" || period === "year") {
    const start = currentNepalCalendarDate(now);
    if (period === "week") {
      const daysSinceMonday = (start.getUTCDay() + 6) % 7;
      start.setUTCDate(start.getUTCDate() - daysSinceMonday);
    } else if (period === "month") {
      start.setUTCDate(1);
    } else {
      start.setUTCMonth(0, 1);
    }
    const end = period === "week"
      ? nextUtcDay(new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000))
      : period === "month"
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
        : new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1));
    return { start: nepalMidnight(start), end: nepalMidnight(end) };
  }

  if (period === "date") {
    const date = parseDateOnly(String(query.date || ""));
    if (!date) return { error: "Select a valid date for the customer date filter." };
    return { start: nepalMidnight(date), end: nepalMidnight(nextUtcDay(date)) };
  }

  if (period === "range") {
    const start = parseDateOnly(String(query.from || ""));
    const to = parseDateOnly(String(query.to || ""));
    if (!start || !to) return { error: "Select a valid start and end date for the customer date range." };
    if (start > to) return { error: "The customer date range start must not be after its end." };
    return { start: nepalMidnight(start), end: nepalMidnight(nextUtcDay(to)) };
  }

  return { error: "Choose a valid customer date filter." };
};

const customerProvinceExpression = Prisma.sql`COALESCE(
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(u.addresses, '$[0].province')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(u.addresses, '$[0].state')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT((
    SELECT latestOrder.address
    FROM \`Order\` latestOrder
    WHERE latestOrder.userId = u.id
      AND latestOrder.status <> 'Cancelled'
    ORDER BY latestOrder.date DESC
    LIMIT 1
  ), '$.province')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT((
    SELECT latestOrder.address
    FROM \`Order\` latestOrder
    WHERE latestOrder.userId = u.id
      AND latestOrder.status <> 'Cancelled'
    ORDER BY latestOrder.date DESC
    LIMIT 1
  ), '$.state')), ''),
  'Not provided'
)`;

const customerDistrictExpression = Prisma.sql`COALESCE(
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(u.addresses, '$[0].district')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(u.addresses, '$[0].city')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT((
    SELECT latestOrder.address
    FROM \`Order\` latestOrder
    WHERE latestOrder.userId = u.id
      AND latestOrder.status <> 'Cancelled'
    ORDER BY latestOrder.date DESC
    LIMIT 1
  ), '$.district')), ''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT((
    SELECT latestOrder.address
    FROM \`Order\` latestOrder
    WHERE latestOrder.userId = u.id
      AND latestOrder.status <> 'Cancelled'
    ORDER BY latestOrder.date DESC
    LIMIT 1
  ), '$.city')), ''),
  'Not provided'
)`;

const getOrderLocation = (address) => {
  const parsed = parseJson(address, {});
  return {
    province: String(parsed?.province || parsed?.state || "").trim() || "Not provided",
    district: String(parsed?.district || parsed?.city || "").trim() || "Not provided",
  };
};

const addLocationSale = (map, locationKey, order, deliveryCost) => {
  const current = map.get(locationKey) || {
    orders: [],
    customerIds: new Set(),
    transactionIds: new Set(),
    revenue: 0,
    ncmDeliveryCost: 0,
    ncmPackageCount: 0,
    ncmPackagesWithRecordedCost: 0,
  };
  current.orders.push(order);
  current.customerIds.add(order.userId);
  current.transactionIds.add(order.checkoutGroupId || order.id);
  current.revenue += Number(order.amount || 0);
  if (deliveryCost !== null) {
    current.ncmPackageCount += 1;
    current.ncmDeliveryCost += deliveryCost;
    current.ncmPackagesWithRecordedCost += deliveryCost > 0 ? 1 : 0;
  }
  map.set(locationKey, current);
};

const formatLocationSales = (map, locationFields, costData) => [...map.entries()]
  .map(([locationKey, group]) => {
    const costs = calculateFinancialDashboardProductCosts({
      orders: group.orders,
      ...costData,
    });
    const cogs = costs.directCOGS;
    const productionOverhead = calculateAllocatedProductionOverhead({
      orders: group.orders,
      overheadPerProduct: costData.overheadPerProduct,
    });
    const ncmDeliveryCost = Number(group.ncmDeliveryCost.toFixed(2));
    return {
      ...locationFields(locationKey),
      transactionCount: group.transactionIds.size,
      customerCount: group.customerIds.size,
      sales: Number(group.revenue.toFixed(2)),
      cogs,
      productionOverhead,
      ncmDeliveryCost,
      estimatedProfit: Number((group.revenue - cogs - productionOverhead - ncmDeliveryCost).toFixed(2)),
      ncmPackageCount: group.ncmPackageCount,
      ncmPackagesWithRecordedCost: group.ncmPackagesWithRecordedCost,
    };
  })
  .sort((left, right) => right.sales - left.sales);

export const getCustomerAdminAnalytics = async (req, res) => {
  try {
    const selectedRange = resolveCustomerDateRange(req.query);
    if (selectedRange.error) {
      return res.status(400).json({ success: false, message: selectedRange.error, code: "INVALID_CUSTOMER_DATE_FILTER" });
    }

    const now = new Date();
    const weekRange = resolveCustomerDateRange({ period: "week" }, now);
    const monthRange = resolveCustomerDateRange({ period: "month" }, now);
    const yearRange = resolveCustomerDateRange({ period: "year" }, now);
    const countNewCustomers = (range) => prisma.user.count({
      where: range.start
        ? { account: { is: { createdAt: { gte: range.start, lt: range.end } } } }
        : { accountId: { not: null } },
    });

    const [
      statusRows,
      locationProvinceRows,
      locationDistrictRows,
      retentionRows,
      weeklyNewCustomers,
      monthlyNewCustomers,
      yearlyNewCustomers,
      selectedNewCustomers,
      salesOrders,
    ] = await Promise.all([
      prisma.$queryRaw(Prisma.sql`
        SELECT
          COUNT(*) AS totalCustomers,
          SUM(CASE WHEN u.isDisabled = 0 THEN 1 ELSE 0 END) AS activeCustomers,
          SUM(CASE WHEN u.isDisabled = 1 THEN 1 ELSE 0 END) AS disabledCustomers
        FROM \`User\` u
      `),
      prisma.$queryRaw(Prisma.sql`
        SELECT ${customerProvinceExpression} AS province, COUNT(*) AS total
        FROM \`User\` u
        GROUP BY province
        ORDER BY total DESC, province ASC
      `),
      prisma.$queryRaw(Prisma.sql`
        SELECT ${customerProvinceExpression} AS province, ${customerDistrictExpression} AS district, COUNT(*) AS total
        FROM \`User\` u
        GROUP BY province, district
        ORDER BY total DESC, province ASC, district ASC
      `),
      prisma.$queryRaw(Prisma.sql`
        SELECT
          COUNT(*) AS purchasingCustomers,
          SUM(CASE WHEN order_stats.transactionCount > 1 THEN 1 ELSE 0 END) AS repeatCustomers
        FROM (
          SELECT COUNT(*) AS transactionCount
          FROM (
            SELECT userId, COALESCE(checkoutGroupId, id) AS transactionKey
            FROM \`Order\`
            WHERE status <> 'Cancelled'
            GROUP BY userId, transactionKey
          ) customer_transactions
          GROUP BY userId
        ) order_stats
      `),
      countNewCustomers(weekRange),
      countNewCustomers(monthRange),
      countNewCustomers(yearRange),
      countNewCustomers(selectedRange),
      prisma.order.findMany({
        where: { status: { not: "Cancelled" } },
        select: {
          id: true,
          userId: true,
          checkoutGroupId: true,
          items: true,
          amount: true,
          address: true,
          deliveryOrder: {
            select: { id: true, ncmDeliveryCharge: true },
          },
        },
      }),
    ]);

    const deliveryOrderIds = salesOrders.map((order) => order.deliveryOrder?.id).filter(Boolean);
    const productIds = [...new Set(salesOrders.flatMap((order) =>
      parseJson(order.items, [])
        .map((item) => item.productId || item._id || item.id)
        .filter(Boolean)
    ))];
    const [settlements, products, costLayers, manufacturerInventories] = await Promise.all([
      deliveryOrderIds.length
        ? prisma.deliveryFinancialSettlement.findMany({
            where: { deliveryOrderId: { in: deliveryOrderIds } },
            select: { deliveryOrderId: true, deliveryFeeActual: true },
          })
        : [],
      productIds.length
        ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, costPrice: true } })
        : [],
      productIds.length
        ? prisma.manufacturerInventoryCostLayer.findMany({
            where: { productId: { in: productIds } },
            select: { productId: true, producedQuantity: true, unitCogs: true, unitDeliveryCost: true },
          })
        : [],
      productIds.length
        ? prisma.manufacturerInventory.findMany({
            where: {
              productId: { in: productIds },
              priceStatus: "APPROVED",
              agreedCostPrice: { not: null },
            },
            select: { productId: true, quantity: true, agreedCostPrice: true, priceStatus: true },
          })
        : [],
    ]);
    const settlementByDeliveryId = new Map(settlements.map((settlement) => [
      settlement.deliveryOrderId,
      Number(settlement.deliveryFeeActual || 0),
    ]));
    const salesByProvince = new Map();
    const salesByDistrict = new Map();
    for (const order of salesOrders) {
      const location = getOrderLocation(order.address);
      const recordedNcmCharge = Number(order.deliveryOrder?.ncmDeliveryCharge || 0)
        || settlementByDeliveryId.get(order.deliveryOrder?.id)
        || 0;
      const ncmDeliveryCost = order.deliveryOrder ? recordedNcmCharge : null;
      addLocationSale(salesByProvince, location.province, order, ncmDeliveryCost);
      addLocationSale(salesByDistrict, `${location.province}\0${location.district}`, order, ncmDeliveryCost);
    }
    const overheadPerProduct = calculateProductFixedOverheadPerSoldUnit({
      orders: salesOrders,
    });
    const costData = { costLayers, manufacturerInventories, products, overheadPerProduct };
    const formattedProvinceSales = formatLocationSales(
      salesByProvince,
      (province) => ({ province }),
      costData,
    );
    const formattedDistrictSales = formatLocationSales(
      salesByDistrict,
      (key) => {
        const [province, district] = key.split("\0");
        return { province, district };
      },
      costData,
    );
    const salesCostTotals = calculateFinancialDashboardProductCosts({
      orders: salesOrders,
      ...costData,
    });
    const salesSummary = formattedDistrictSales.reduce((totals, row) => ({
      sales: totals.sales + row.sales,
      cogs: totals.cogs + row.cogs,
      productionOverhead: totals.productionOverhead + row.productionOverhead,
      ncmDeliveryCost: totals.ncmDeliveryCost + row.ncmDeliveryCost,
      ncmPackageCount: totals.ncmPackageCount + row.ncmPackageCount,
      ncmPackagesWithRecordedCost: totals.ncmPackagesWithRecordedCost + row.ncmPackagesWithRecordedCost,
    }), {
      sales: 0,
      cogs: 0,
      productionOverhead: 0,
      ncmDeliveryCost: 0,
      ncmPackageCount: 0,
      ncmPackagesWithRecordedCost: 0,
    });
    salesSummary.customerCount = new Set(salesOrders.map((order) => order.userId)).size;
    salesSummary.transactionCount = countPurchaseTransactions(salesOrders);
    salesSummary.cogs = salesCostTotals.directCOGS;
    salesSummary.productionOverhead = Number(
      formattedDistrictSales.reduce((total, row) => total + row.productionOverhead, 0).toFixed(2),
    );
    salesSummary.estimatedProfit = Number((
      salesSummary.sales
      - salesSummary.cogs
      - salesSummary.productionOverhead
      - salesSummary.ncmDeliveryCost
    ).toFixed(2));
    salesSummary.ncmDeliveryCost = Number(salesSummary.ncmDeliveryCost.toFixed(2));

    const status = statusRows[0] || {};
    const retention = retentionRows[0] || {};
    const purchasingCustomers = Number(retention.purchasingCustomers || 0);
    const repeatCustomers = Number(retention.repeatCustomers || 0);

    return res.json({
      success: true,
      metrics: {
        totalCustomers: Number(status.totalCustomers || 0),
        activeCustomers: Number(status.activeCustomers || 0),
        disabledCustomers: Number(status.disabledCustomers || 0),
        retentionRate: purchasingCustomers ? (repeatCustomers / purchasingCustomers) * 100 : 0,
        repeatCustomers,
        purchasingCustomers,
        newCustomers: {
          weekly: weeklyNewCustomers,
          monthly: monthlyNewCustomers,
          yearly: yearlyNewCustomers,
          selected: selectedNewCustomers,
          selectedPeriod: String(req.query.period || "all"),
        },
        provinceBreakdown: locationProvinceRows.map((row) => ({
          province: row.province,
          total: Number(row.total || 0),
        })),
        districtBreakdown: locationDistrictRows.map((row) => ({
          province: row.province,
          district: row.district,
          total: Number(row.total || 0),
        })),
        salesSummary,
        salesByProvince: formattedProvinceSales,
        salesByDistrict: formattedDistrictSales,
      },
    });
  } catch (error) {
    console.error("Error loading customer analytics:", error);
    return res.status(500).json({ success: false, message: "Unable to load customer analytics." });
  }
};

// GET /api/customer/admin/search (Admin only; requires a search or explicit filter)
export const searchAdminCustomers = async (req, res) => {
  try {
    const query = String(req.query.search || "").trim();
    if (query && query.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Enter at least two characters to search for a customer.",
        code: "CUSTOMER_SEARCH_REQUIRED",
      });
    }

    const dateRange = resolveCustomerDateRange(req.query);
    if (dateRange.error) {
      return res.status(400).json({ success: false, message: dateRange.error, code: "INVALID_CUSTOMER_DATE_FILTER" });
    }

    const status = String(req.query.status || "");
    if (status && !["active", "disabled"].includes(status)) {
      return res.status(400).json({ success: false, message: "Choose active or disabled for the customer status filter." });
    }
    const province = String(req.query.province || "").trim();
    const district = String(req.query.district || "").trim();
    const hasDateFilter = dateRange.start !== null;
    if (!query && !status && !province && !district && !hasDateFilter) {
      return res.status(400).json({
        success: false,
        message: "Search by name or choose a customer filter before viewing records.",
        code: "CUSTOMER_FILTER_REQUIRED",
      });
    }

    const pagination = getPagination(req.query);
    const conditions = [];
    if (query) {
      const searchPattern = `%${query}%`;
      conditions.push(Prisma.sql`(
        u.name LIKE ${searchPattern}
        OR CONCAT_WS(' ', COALESCE(u.firstName, ''), COALESCE(u.lastName, '')) LIKE ${searchPattern}
        OR COALESCE(u.firstName, '') LIKE ${searchPattern}
        OR COALESCE(u.lastName, '') LIKE ${searchPattern}
        OR u.email LIKE ${searchPattern}
        OR COALESCE(u.phone, '') LIKE ${searchPattern}
        OR COALESCE(u.socialCustomerPhone, '') LIKE ${searchPattern}
        OR COALESCE(u.socialCustomerCode, '') LIKE ${searchPattern}
        OR JSON_SEARCH(u.addresses, 'one', ${searchPattern}, NULL, '$[*].phone') IS NOT NULL
      )`);
    }
    if (status) conditions.push(Prisma.sql`u.isDisabled = ${status === "disabled"}`);
    if (province) conditions.push(Prisma.sql`${customerProvinceExpression} = ${province}`);
    if (district) conditions.push(Prisma.sql`${customerDistrictExpression} = ${district}`);
    if (dateRange.start) {
      conditions.push(Prisma.sql`a.createdAt >= ${dateRange.start} AND a.createdAt < ${dateRange.end}`);
    }
    const whereCondition = Prisma.join(conditions, " AND ");

    const [countRows, customers] = await Promise.all([
      prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(*) AS total
        FROM \`User\` u
        LEFT JOIN \`AuthAccount\` a ON a.id = u.accountId
        WHERE ${whereCondition}
      `),
      prisma.$queryRaw(Prisma.sql`
        SELECT
          u.id,
          u.firstName,
          u.lastName,
          u.name,
          u.email,
          u.phone,
          u.socialCustomerPhone,
          JSON_UNQUOTE(JSON_EXTRACT(u.addresses, '$[0].phone')) AS addressPhone,
          u.isDisabled,
          a.createdAt AS createdAt,
          ${customerProvinceExpression} AS province,
          ${customerDistrictExpression} AS district,
          COALESCE(order_stats.totalSpend, 0) AS totalSpend,
          COALESCE(order_stats.totalOrders, 0) AS totalOrders,
          COALESCE(exchange_stats.exchangeCount, 0) AS exchangeCount,
          order_stats.latestOrderDate
        FROM \`User\` u
        LEFT JOIN \`AuthAccount\` a ON a.id = u.accountId
        LEFT JOIN (
          SELECT userId, SUM(amount) AS totalSpend, COUNT(*) AS totalOrders, MAX(date) AS latestOrderDate
          FROM \`Order\`
          WHERE status <> 'Cancelled'
          GROUP BY userId
        ) order_stats ON order_stats.userId = u.id
        LEFT JOIN (
          SELECT customerId, COUNT(*) AS exchangeCount
          FROM \`OrderExchangeRequest\`
          GROUP BY customerId
        ) exchange_stats ON exchange_stats.customerId = u.id
        WHERE ${whereCondition}
        ORDER BY order_stats.latestOrderDate IS NULL ASC, order_stats.latestOrderDate DESC, u.id ASC
        LIMIT ${pagination.limit} OFFSET ${pagination.skip}
      `),
    ]);
    const total = Number(countRows[0]?.total || 0);
    const formattedCustomers = customers.map((customer) => ({
      id: customer.id,
      firstName: customer.firstName || "",
      lastName: customer.lastName || "",
      name: customer.name || `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || "Customer",
      email: customer.email || "",
      phone: customer.phone || customer.socialCustomerPhone || customer.addressPhone || "",
      isDisabled: Boolean(customer.isDisabled),
      createdAt: customer.createdAt,
      province: customer.province || "",
      district: customer.district || "",
      totalSpend: Number(customer.totalSpend || 0),
      totalOrders: Number(customer.totalOrders || 0),
      exchangeCount: Number(customer.exchangeCount || 0),
      latestOrderDate: customer.latestOrderDate == null ? null : Number(customer.latestOrderDate),
    }));
    return res.json(paginatedResponse("customers", formattedCustomers, pagination, total));
  } catch (error) {
    console.error("Error searching customers:", error);
    return res.status(500).json({ success: false, message: "Unable to search customers." });
  }
};

export const getCustomerAdminProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, message: "Customer not found." });
    const [account, orderSummary, cancelledOrderCount, exchangeCount, returnCount, reviewCount, letterCount] = await Promise.all([
      user.accountId
        ? prisma.authAccount.findUnique({
            where: { id: user.accountId },
            select: { status: true, createdAt: true, lastLoginAt: true, isEmailVerified: true, isPhoneVerified: true },
          })
        : null,
      prisma.order.aggregate({
        where: { userId, status: { not: "Cancelled" } },
        _count: { _all: true },
        _sum: { amount: true },
        _min: { date: true },
        _max: { date: true },
      }),
      prisma.order.count({ where: { userId, status: "Cancelled" } }),
      prisma.orderExchangeRequest.count({ where: { customerId: userId } }),
      prisma.customerReturn.count({ where: { userId } }),
      prisma.review.count({ where: { userId } }),
      prisma.customerLetterImage.count({ where: { userId } }),
    ]);
    const count = orderSummary._count._all;
    const minimumOrderDate = orderSummary._min.date == null ? null : Number(orderSummary._min.date);
    const maximumOrderDate = orderSummary._max.date == null ? null : Number(orderSummary._max.date);
    const addresses = parseJson(user.addresses, []);
    return res.json({
      success: true,
      customer: {
        id: user.id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        name: user.name || `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Customer",
        email: user.email,
        phone: user.phone || user.socialCustomerPhone || addresses[0]?.phone || "",
        socialCustomerCode: user.socialCustomerCode || "",
        gender: user.gender || "PREFER_NOT_TO_SAY",
        isDisabled: Boolean(user.isDisabled),
        disabledAt: user.disabledAt,
        disabledReason: user.disabledReason || "",
        addresses,
        createdAt: account?.createdAt || null,
        lastLoginAt: account?.lastLoginAt || null,
        accountStatus: account?.status || (user.isInactiveProfile ? "PROFILE_ONLY" : "NO_AUTH_ACCOUNT"),
        emailVerified: Boolean(account?.isEmailVerified),
        phoneVerified: Boolean(account?.isPhoneVerified),
      },
      metrics: {
        orderCount: count,
        cancelledOrderCount,
        totalPurchaseAmount: Number(orderSummary._sum.amount || 0),
        averageOrderAmount: count ? Number(orderSummary._sum.amount || 0) / count : 0,
        firstOrderDate: minimumOrderDate,
        lastOrderDate: maximumOrderDate,
        averageDaysBetweenOrders: count > 1
          ? (maximumOrderDate - minimumOrderDate) / (count - 1) / 86_400_000
          : null,
        exchangeCount,
        returnCount,
        reviewCount,
        letterCount,
      },
      loyalty: await calculateUserLoyalty(userId),
    });
  } catch (error) {
    console.error("Error getting customer admin profile:", error);
    return res.status(500).json({ success: false, message: "Unable to load customer profile." });
  }
};

export const getCustomerAdminOrders = async (req, res) => {
  try {
    const { userId } = req.params;
    const pagination = getPagination(req.query);
    const [user, total, orders] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      prisma.order.count({ where: { userId } }),
      prisma.order.findMany({
        where: { userId },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
    ]);
    if (!user) return res.status(404).json({ success: false, message: "Customer not found." });
    const orderIds = orders.map(({ id }) => id);
    const allProductIds = [...new Set(orders.flatMap((order) => {
      const items = parseJson(order.items, []);
      return Array.isArray(items) ? items.map((item) => item.productId || item._id || item.id).filter(Boolean) : [];
    }))];
    const [assignments, deliveries, products] = await Promise.all([
      orderIds.length
        ? prisma.orderAssignment.findMany({
            where: { orderId: { in: orderIds } },
            select: {
              orderId: true,
              deliveryType: true,
              status: true,
              assignedAt: true,
              dispatchedAt: true,
              onTheWayAt: true,
              deliveredAt: true,
              distributor: { select: { id: true, name: true } },
              manufacturer: { select: { id: true, name: true } },
            },
          })
        : [],
      orderIds.length
        ? prisma.deliveryOrder.findMany({
            where: { orderId: { in: orderIds } },
            select: {
              orderId: true,
              state: true,
              deliveryType: true,
              originBranchName: true,
              destinationBranchName: true,
              customerDeliveryCharge: true,
              ncmDeliveryCharge: true,
              codAmount: true,
              ncmStatus: true,
              ncmPaymentStatus: true,
              pickedUpAt: true,
              deliveredAt: true,
              returnedAt: true,
            },
          })
        : [],
      allProductIds.length
        ? prisma.product.findMany({
            where: { id: { in: allProductIds } },
            select: { id: true, name: true, image: true },
          })
        : [],
    ]);
    const assignmentByOrder = new Map(assignments.map((assignment) => [assignment.orderId, assignment]));
    const deliveryByOrder = new Map(deliveries.map((delivery) => [delivery.orderId, delivery]));
    const productById = new Map(products.map((product) => [product.id, product]));
    const formattedOrders = orders.map((order) => {
      const items = parseJson(order.items, []);
      return {
        ...order,
        date: Number(order.date),
        address: parseJson(order.address, {}),
        items: (Array.isArray(items) ? items : []).map((item) => ({
          ...item,
          product: productById.get(item.productId || item._id || item.id) || null,
        })),
        assignment: assignmentByOrder.get(order.id) || null,
        delivery: deliveryByOrder.get(order.id) || null,
      };
    });
    return res.json(paginatedResponse("orders", formattedOrders, pagination, total));
  } catch (error) {
    console.error("Error listing customer orders:", error);
    return res.status(500).json({ success: false, message: "Unable to load customer order history." });
  }
};

export const getCustomerAdminLetters = async (req, res) => {
  try {
    const { userId } = req.params;
    const pagination = getPagination(req.query);
    const [user, total, letters] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      prisma.customerLetterImage.count({ where: { userId } }),
      prisma.customerLetterImage.findMany({
        where: { userId },
        select: { id: true, title: true, notes: true, imageUrl: true, orderId: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
    ]);
    if (!user) return res.status(404).json({ success: false, message: "Customer not found." });
    return res.json(paginatedResponse("letters", letters, pagination, total));
  } catch (error) {
    console.error("Error listing customer letters:", error);
    return res.status(500).json({ success: false, message: "Unable to load customer letters." });
  }
};

// GET /api/customer/details/:userId (Admin only)
export const getCustomerDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const includeOrders = req.query.includeOrders !== "false";
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }

    const [orders, loyaltyStatus] = await Promise.all([
      includeOrders
        ? prisma.order.findMany({
            where: { userId },
            orderBy: { date: "desc" },
          })
        : [],
      includeOrders ? calculateUserLoyalty(userId) : null,
    ]);

    const addresses = parseJson(user.addresses, []);

    const orderIds = orders.map(({ id }) => id);
    const orderItems = orders.flatMap((order) => {
      const items = parseJson(order.items, []);
      return Array.isArray(items) ? items : [];
    });
    const productIds = [...new Set(orderItems.map((item) => item.productId || item.id).filter(Boolean))];
    const inactiveProfileData = parseJson(user.inactiveProfileData, {});
    const historicalContacts = includeOrders
      ? orders.map((order) => parseJson(order.address, {}))
      : (await prisma.order.findMany({ where: { userId }, select: { address: true } }))
        .map((order) => parseJson(order.address, {}));
    const contactSources = [
      ...addresses,
      inactiveProfileData,
      ...historicalContacts,
    ];
    const notificationAddresses = [...new Set([
      user.email?.trim().toLowerCase(),
      inactiveProfileData.email?.trim().toLowerCase(),
      user.phone?.trim(),
      user.socialCustomerPhone?.trim(),
      ...contactSources.flatMap((contact) => [
        contact.email?.trim().toLowerCase(),
        contact.phone?.trim(),
      ]),
    ].filter(Boolean))];

    const [
      account,
      assignments,
      deliveryOrders,
      returnRequests,
      exchangeRequests,
      productReviews,
      distributorReviews,
      cardLinks,
      cardOrders,
      benefitRedemptions,
      storyAssignments,
      letterDeliveries,
      manualLetters,
      products,
      notifications,
    ] = await Promise.all([
      user.accountId
        ? prisma.authAccount.findUnique({
            where: { id: user.accountId },
            select: { id: true, status: true, createdAt: true, lastLoginAt: true, isEmailVerified: true, isPhoneVerified: true },
          })
        : null,
      orderIds.length
          ? prisma.orderAssignment.findMany({
              where: { orderId: { in: orderIds } },
              select: {
                orderId: true,
                deliveryType: true,
                status: true,
                assignedAt: true,
                acceptedAt: true,
                dispatchedAt: true,
                onTheWayAt: true,
                deliveredAt: true,
                returnedAt: true,
                notes: true,
                distributor: { select: { id: true, name: true } },
                manufacturer: { select: { id: true, name: true } },
              },
            })
          : [],
      orderIds.length
        ? prisma.deliveryOrder.findMany({
            where: { orderId: { in: orderIds } },
            select: {
              orderId: true,
              state: true,
              deliveryType: true,
              originBranchName: true,
              destinationBranchName: true,
              itemAmount: true,
              customerDeliveryCharge: true,
              ncmDeliveryCharge: true,
              codAmount: true,
              ncmOrderId: true,
              ncmStatus: true,
              ncmPaymentStatus: true,
              readyAt: true,
              ncmCreatedAt: true,
              pickedUpAt: true,
              deliveredAt: true,
              returnedAt: true,
              createdAt: true,
              events: {
                orderBy: { occurredAt: "asc" },
                select: { source: true, eventType: true, fromState: true, toState: true, ncmStatus: true, occurredAt: true },
              },
            },
          })
        : [],
      prisma.customerReturn.findMany({
        where: {
          OR: [
            { userId },
            ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderId: true,
          manufacturerId: true,
          distributorId: true,
          deliveryRoute: true,
          customerName: true,
          customerPhone: true,
          returnDate: true,
          items: true,
          totalRefundAmount: true,
          vatRefunded: true,
          refundMethod: true,
          refundStatus: true,
          inventoryAction: true,
          reason: true,
          notes: true,
          lifecycleStatus: true,
          adminReviewerId: true,
          adminNotes: true,
          approvedAt: true,
          originalNcmOrderId: true,
          ncmReturnOrderId: true,
          ncmDeliveryCharge: true,
          ncmChargeSource: true,
          ncmChargePayer: true,
          logisticsSettlementAmount: true,
          returnPickupStatus: true,
          returnPickupCompletedAt: true,
          manufacturerReceivedAt: true,
          inspectedAt: true,
          inspectionResult: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
          events: {
            orderBy: { occurredAt: "asc" },
            select: { id: true, eventType: true, fromStatus: true, toStatus: true, actorRole: true, reason: true, occurredAt: true },
          },
        },
      }),
      prisma.orderExchangeRequest.findMany({
        where: { customerId: userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderId: true,
          customerName: true,
          customerPhone: true,
          manufacturerId: true,
          distributorId: true,
          deliveryRoute: true,
          reasonCode: true,
          reasonDetails: true,
          items: true,
          replacementItems: true,
          priceDifference: true,
          status: true,
          decisionActorId: true,
          decisionReason: true,
          decidedAt: true,
          ncmReturnOrderId: true,
          ncmReplacementOrderId: true,
          ncmReturnCharge: true,
          ncmReplacementCharge: true,
          ncmTotalCharge: true,
          ncmChargePayer: true,
          logisticsSettlementAmount: true,
          returnPickupStatus: true,
          returnPickupCompletedAt: true,
          replacementStatus: true,
          replacementDeliveredAt: true,
          manufacturerReceivedAt: true,
          inspectedAt: true,
          inspectionResult: true,
          inspectionNotes: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
          events: {
            orderBy: { occurredAt: "asc" },
            select: { id: true, eventType: true, fromStatus: true, toStatus: true, actorRole: true, reason: true, occurredAt: true },
          },
        },
      }),
      prisma.review.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        select: { id: true, productId: true, rating: true, title: true, comment: true, verified: true, date: true },
      }),
      prisma.distributorReview.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { distributor: { select: { id: true, name: true } } },
      }),
      prisma.marketingCardCustomer.findMany({
        where: { customerId: userId },
        orderBy: { linkedAt: "desc" },
        select: {
          id: true,
          cardId: true,
          linkedAt: true,
          scannedAt: true,
          assignedOrganization: true,
          scanWeekIndex: true,
          activatedAt: true,
          status: true,
          card: {
            select: {
              id: true,
              cardCode: true,
              hasBenefit: true,
              physicalStatus: true,
              assignedOrganization: true,
              assignedAt: true,
              receivedAt: true,
              reservedAt: true,
              attachedAt: true,
              createdAt: true,
              campaign: { select: { id: true, name: true } },
              benefit: { select: { id: true, name: true, description: true, benefitType: true, value: true } },
              events: { orderBy: { createdAt: "asc" }, select: { eventType: true, fromStatus: true, toStatus: true, createdAt: true } },
            },
          },
        },
      }),
      orderIds.length
        ? prisma.marketingCardOrder.findMany({
            where: { orderId: { in: orderIds } },
            orderBy: { attachedAt: "desc" },
            include: {
              card: {
                select: {
                  id: true,
                  cardCode: true,
                  hasBenefit: true,
                  physicalStatus: true,
                  createdAt: true,
                  campaign: { select: { id: true, name: true } },
                  benefit: { select: { id: true, name: true, description: true, benefitType: true, value: true } },
                },
              },
            },
          })
        : [],
      prisma.marketingBenefitRedemption.findMany({
        where: { customerId: userId },
        orderBy: { redeemedAt: "desc" },
        include: {
          benefit: { select: { id: true, name: true, description: true, benefitType: true, value: true } },
          card: { select: { id: true, cardCode: true, campaign: { select: { name: true } } } },
        },
      }),
      prisma.customerStoryAssignment.findMany({
        where: { customerId: userId },
        orderBy: { startedAt: "desc" },
        include: { story: { select: { id: true, title: true } } },
      }),
      prisma.letterDelivery.findMany({
        where: { customerId: userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderId: true,
          status: true,
          reservedAt: true,
          printedAt: true,
          packedAt: true,
          shippedAt: true,
          deliveredAt: true,
          createdAt: true,
          renderedContent: true,
          renderedDocumentUrl: true,
          story: { select: { title: true } },
          storyLetter: { select: { title: true, sequenceNumber: true } },
          template: { select: { name: true } },
        },
      }),
      prisma.customerLetterImage.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      productIds.length
        ? prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, image: true, category: true, subCategory: true },
          })
        : [],
      notificationAddresses.length
        ? prisma.notification.findMany({
            where: {
                recipientAddress: { in: notificationAddresses },
              },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              notificationType: true,
              channel: true,
              status: true,
              subject: true,
              template: true,
              payload: true,
              provider: true,
              attemptCount: true,
              queuedAt: true,
              acceptedAt: true,
              deliveredAt: true,
              failedAt: true,
              failureCode: true,
              createdAt: true,
            },
          })
        : [],
    ]);

    const productsById = new Map(products.map((product) => [product.id, product]));
    const orderProducts = orderItems.map((item) => ({
      ...item,
      product: productsById.get(item.productId || item.id) || null,
    }));
    const formattedOrders = orders.map((o) => {
      const items = parseJson(o.items, []);
      return {
        ...o,
        date: Number(o.date),
        items: (Array.isArray(items) ? items : []).map((item) => ({
          ...item,
          product: productsById.get(item.productId || item.id) || null,
        })),
        address: parseJson(o.address, {}),
      };
    });
    const lifetimeOrders = orders.filter((order) => order.status !== "Cancelled");
    const totalPurchaseAmount = lifetimeOrders.reduce((total, order) => total + Number(order.amount || 0), 0);
    const notificationsForProfile = notifications
      .filter((notification) => !/(otp|two.?factor|auth|verification|password|reset|login)/i.test(notification.notificationType))
      .map((notification) => ({
      id: notification.id,
      type: notification.notificationType,
      channel: notification.channel,
      status: notification.status,
      subject: notification.subject,
      template: notification.template,
      message: parseNotificationMessage(notification.payload),
      provider: notification.provider,
      attemptCount: notification.attemptCount,
      queuedAt: notification.queuedAt,
      acceptedAt: notification.acceptedAt,
      deliveredAt: notification.deliveredAt,
      failedAt: notification.failedAt,
      failureCode: notification.failureCode,
      createdAt: notification.createdAt,
      }));

    res.json({
      success: true,
      customer: {
        id: user.id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        name: user.name,
        email: user.email,
        phone: user.phone || "",
        gender: user.gender || inactiveProfileData.gender || "PREFER_NOT_TO_SAY",
        socialCustomerCode: user.socialCustomerCode || "",
        socialCustomerPhone: user.socialCustomerPhone || user.phone || "",
        loyaltyTier: user.loyaltyTier || inactiveProfileData.loyaltyTier || "",
        isInactiveProfile: Boolean(user.isInactiveProfile),
        isDisabled: Boolean(user.isDisabled),
        disabledAt: user.disabledAt,
        disabledBy: user.disabledBy,
        disabledReason: user.disabledReason || "",
        createdAt: account?.createdAt || null,
        lastLoginAt: account?.lastLoginAt || null,
        accountStatus: account?.status || (user.isInactiveProfile ? "PROFILE_ONLY" : "NO_AUTH_ACCOUNT"),
        emailVerified: Boolean(account?.isEmailVerified),
        phoneVerified: Boolean(account?.isPhoneVerified),
        inactiveProfileData,
        addresses,
      },
      loyalty: loyaltyStatus,
      orders: formattedOrders,
      assignments,
      metrics: {
        orderCount: lifetimeOrders.length,
        cancelledOrderCount: orders.length - lifetimeOrders.length,
        totalPurchaseAmount,
        averageOrderAmount: lifetimeOrders.length ? totalPurchaseAmount / lifetimeOrders.length : 0,
        firstOrderDate: lifetimeOrders.length ? Math.min(...lifetimeOrders.map((order) => Number(order.date))) : null,
        lastOrderDate: lifetimeOrders.length ? Math.max(...lifetimeOrders.map((order) => Number(order.date))) : null,
        averageDaysBetweenOrders: lifetimeOrders.length > 1
          ? (Math.max(...lifetimeOrders.map((order) => Number(order.date))) - Math.min(...lifetimeOrders.map((order) => Number(order.date))))
            / (lifetimeOrders.length - 1) / 86_400_000
          : null,
      },
      products: orderProducts,
      deliveries: deliveryOrders,
      returns: returnRequests,
      exchanges: exchangeRequests,
      reviews: {
        products: productReviews.map((review) => ({
          ...review,
          date: Number(review.date),
          product: productsById.get(review.productId) || null,
        })),
        distributors: distributorReviews,
      },
      cards: {
        linked: cardLinks,
        attachedToOrders: cardOrders,
        benefitRedemptions,
      },
      letters: manualLetters,
      letterDeliveries,
      storyAssignments,
      notifications: notificationsForProfile,
    });
  } catch (error) {
    console.error("Error getting customer details:", error);
    res.status(500).json({ success: false, message: "Unable to load customer details." });
  }
};

export const updateCustomerDisabledStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const disabled = req.body.disabled;
    const reason = String(req.body.reason || "").trim().slice(0, 1000);
    if (typeof disabled !== "boolean") {
      return res.status(400).json({ success: false, message: "A boolean disabled value is required." });
    }
    if (disabled && !reason) {
      return res.status(400).json({ success: false, message: "Provide a reason when disabling a customer account." });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountId: true, isDisabled: true, disabledAt: true, disabledBy: true, disabledReason: true },
    });
    if (!currentUser) return res.status(404).json({ success: false, message: "Customer not found." });
    if (currentUser.isDisabled === disabled) {
      return res.json({ success: true, message: disabled ? "Customer account is already disabled." : "Customer account is already enabled.", isDisabled: disabled });
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          isDisabled: disabled,
          disabledAt: disabled ? now : null,
          disabledBy: disabled ? req.auth.accountId : null,
          disabledReason: disabled ? reason : null,
        },
      });
      if (disabled && currentUser.accountId) {
        await tx.authSession.updateMany({
          where: { accountId: currentUser.accountId, revokedAt: null },
          data: { revokedAt: now, revocationReason: "CUSTOMER_ACCOUNT_DISABLED" },
        });
      }
      await recordSystemAudit({
        actorId: req.auth.accountId,
        actorRole: req.auth.role,
        portalSource: "ADMIN",
        ipAddress: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        correlationId: req.correlationId || null,
      }, {
        action: disabled ? "CUSTOMER_ACCOUNT_DISABLED" : "CUSTOMER_ACCOUNT_RE_ENABLED",
        entityType: "CUSTOMER",
        entityId: userId,
        beforeState: {
          isDisabled: currentUser.isDisabled,
          disabledAt: currentUser.disabledAt,
          disabledBy: currentUser.disabledBy,
          disabledReason: currentUser.disabledReason,
        },
        afterState: {
          isDisabled: disabled,
          disabledAt: disabled ? now : null,
          disabledBy: disabled ? req.auth.accountId : null,
          disabledReason: disabled ? reason : null,
        },
      }, { client: tx });
    });

    return res.json({
      success: true,
      message: disabled ? "Customer account disabled and active sessions revoked." : "Customer account re-enabled.",
      isDisabled: disabled,
      disabledAt: disabled ? now : null,
    });
  } catch (error) {
    console.error("Error updating customer account status:", error);
    return res.status(500).json({ success: false, message: "Unable to update the customer account status." });
  }
};

// POST /api/customer/letter/upload (Admin only)
export const uploadCustomerLetter = async (req, res) => {
  try {
    const { userId, title, notes, orderId } = req.body;
    const file = req.file;

    if (!userId) {
      return res.json({ success: false, message: "User ID is required" });
    }
    if (!file) {
      return res.json({ success: false, message: "Letter image file is required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.json({ success: false, message: "Customer not found" });
    }

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(file.path, {
      resource_type: "image",
      folder: "aama_customer_letters",
    });

    const letterRecord = await prisma.customerLetterImage.create({
      data: {
        userId,
        userEmail: user.email,
        imageUrl: uploadResult.secure_url,
        title: (title || "Handwritten Letter / Dispatch Note").trim(),
        notes: (notes || "").trim(),
        orderId: orderId ? orderId.trim() : null,
      },
    });

    res.json({
      success: true,
      message: "Letter image stored successfully",
      letter: letterRecord,
    });
  } catch (error) {
    console.error("Error uploading customer letter:", error);
    res.json({ success: false, message: error.message });
  }
};

// DELETE /api/customer/letter/:id (Admin only)
export const deleteCustomerLetter = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.customerLetterImage.delete({ where: { id } });
    res.json({ success: true, message: "Letter image deleted successfully" });
  } catch (error) {
    console.error("Error deleting customer letter:", error);
    res.json({ success: false, message: error.message });
  }
};
