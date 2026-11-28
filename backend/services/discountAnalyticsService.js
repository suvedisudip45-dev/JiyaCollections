import { createHash } from "node:crypto";
import { prisma } from "../config/db.js";
import { getLocationLookupData } from "./locationLookupService.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NEPAL_OFFSET_MS = 5 * 60 * 60 * 1000 + 45 * 60 * 1000;
const BATCH_SIZE = 2000;
const MAX_CUSTOM_RANGE_DAYS = 366;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DISCOUNT_CATEGORIES = {
  PRODUCT: "Product discount",
  LOCATION: "Place-wise discount",
  LOYALTY: "Loyalty reward",
  MARKETING_CARD: "Marketing card / voucher",
  COMBO_BUNDLE: "Combo bundle discount",
  ADMIN_ORDER: "Admin order discount",
  LEGACY_ITEM: "Legacy / unclassified item discount",
  LEGACY_ORDER: "Legacy / unclassified order discount",
};

const invalidFilter = (message) => Object.assign(new Error(message), {
  code: "INVALID_DISCOUNT_ANALYTICS_FILTER",
});

const kathmanduDate = (date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const parseCalendarDate = (value, fieldName) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidFilter(`${fieldName} must use YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw invalidFilter(`${fieldName} is not a valid calendar date.`);
  }
  return value;
};

const addDays = (value, amount) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
};

const kathmanduMidnight = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - NEPAL_OFFSET_MS);
};

export const resolveDiscountAnalyticsRange = (
  { period = "all", startDate, endDate } = {},
  now = new Date()
) => {
  if (typeof period !== "string") throw invalidFilter("period must be a single value.");
  const selectedPeriod = period.trim().toLowerCase();
  const today = kathmanduDate(now);
  let firstDate;
  let lastDate = today;

  if (selectedPeriod === "custom") {
    firstDate = parseCalendarDate(startDate, "startDate");
    lastDate = parseCalendarDate(endDate, "endDate");
    if (lastDate < firstDate) throw invalidFilter("endDate must be on or after startDate.");
    const days = (Date.parse(`${addDays(lastDate, 1)}T00:00:00.000Z`)
      - Date.parse(`${firstDate}T00:00:00.000Z`)) / DAY_MS;
    if (days > MAX_CUSTOM_RANGE_DAYS) {
      throw invalidFilter(`Custom date ranges cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days.`);
    }
  } else if (selectedPeriod === "all") {
    firstDate = null;
  } else if (["today", "week", "month", "year"].includes(selectedPeriod)) {
    if (selectedPeriod === "today") firstDate = today;
    if (selectedPeriod === "week") {
      const [year, month, day] = today.split("-").map(Number);
      const todayDate = new Date(Date.UTC(year, month - 1, day));
      firstDate = addDays(today, -((todayDate.getUTCDay() + 6) % 7));
    }
    if (selectedPeriod === "month") firstDate = `${today.slice(0, 7)}-01`;
    if (selectedPeriod === "year") firstDate = `${today.slice(0, 4)}-01-01`;
  } else {
    throw invalidFilter("period must be all, today, week, month, year, or custom.");
  }

  return {
    period: selectedPeriod,
    startDate: firstDate,
    endDate: lastDate,
    startMs: firstDate ? kathmanduMidnight(firstDate).getTime() : 0,
    endMs: kathmanduMidnight(addDays(lastDate, 1)).getTime(),
  };
};

const parseJson = (value, fallback) => {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeText = (value) => String(value || "").trim();
const normalizeKey = (value) => normalizeText(value).toLocaleLowerCase();
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const getOrderLocation = (order) => {
  const address = parseJson(order.address, {});
  return {
    province: normalizeText(address?.province || address?.state),
    district: normalizeText(address?.district || address?.city),
  };
};

const getOrderReward = (order) => {
  const reward = parseJson(order.rewardApplied, {});
  return reward && typeof reward === "object" && !Array.isArray(reward) ? reward : {};
};

export const classifyOrderDiscounts = (order, distributorId = null) => {
  const reward = getOrderReward(order);
  const items = parseJson(order.items, []);
  const location = getOrderLocation(order);
  const components = [];

  if (Array.isArray(items)) {
    for (const [index, item] of items.entries()) {
      if (!item || typeof item !== "object") continue;
      const originalUnitPrice = safeNumber(item.originalUnitPrice ?? item.price ?? item.purchasedUnitPrice);
      const purchasedUnitPrice = safeNumber(item.purchasedUnitPrice ?? item.price);
      const quantity = Math.max(0, safeNumber(item.quantity));
      const amount = roundMoney(Math.max(0, originalUnitPrice - purchasedUnitPrice) * quantity);
      if (!amount) continue;

      let category = "LEGACY_ITEM";
      if (item.comboBundleId) category = "COMBO_BUNDLE";
      else if (item.discountSource === "LOCATION" || safeNumber(item.locationDiscountPercentage) > 0) category = "LOCATION";
      else if (item.discountSource === "PRODUCT" || safeNumber(item.globalProductDiscountPercentage ?? item.discountPercentage) > 0) category = "PRODUCT";

      components.push({
        key: `${order.id}:item:${index}`,
        orderId: order.id,
        category,
        amount,
        productId: normalizeText(item.productId || item._id || item.id),
        productName: normalizeText(item.name) || "Product",
        productCategory: normalizeText(item.category || item.subCategory) || "Uncategorized",
        size: normalizeText(item.size),
        color: normalizeText(item.color),
        quantity,
        percentage: category === "LOCATION"
          ? safeNumber(item.locationDiscountPercentage || item.effectiveDiscountPercentage)
          : category === "COMBO_BUNDLE"
            ? safeNumber(item.comboBundleDiscountPercentage)
            : safeNumber(item.globalProductDiscountPercentage ?? item.discountPercentage),
        distributorId,
        province: location.province,
        district: location.district,
        customerId: order.userId,
      });
    }
  }

  const loyaltyDiscount = Math.max(0, safeNumber(order.loyaltyDiscount));
  const manualDiscount = Math.max(0, safeNumber(reward.manualDiscount));
  const cardDiscount = reward.source === "MARKETING_CARD"
    ? Math.max(0, safeNumber(reward.discountAmount))
    : 0;
  let orderDiscount = 0;
  let orderCategory = null;

  if (cardDiscount > 0) {
    orderDiscount = cardDiscount;
    orderCategory = "MARKETING_CARD";
  } else if (manualDiscount > 0 || (reward.adminCreated && loyaltyDiscount > 0)) {
    orderDiscount = Math.max(manualDiscount, loyaltyDiscount);
    orderCategory = "ADMIN_ORDER";
  } else if (loyaltyDiscount > 0) {
    const isLoyalty = reward.source === "LOYALTY" ||
      String(reward.source || "").startsWith("Distributor Direct") ||
      Boolean(reward.levelName && !reward.adminCreated);
    orderDiscount = loyaltyDiscount;
    orderCategory = isLoyalty ? "LOYALTY" : "LEGACY_ORDER";
  }

  if (orderDiscount > 0) {
    components.push({
      key: `${order.id}:order`,
      orderId: order.id,
      category: orderCategory,
      amount: roundMoney(orderDiscount),
      productId: "",
      productName: "",
      productCategory: "",
      size: "",
      color: "",
      quantity: 0,
      percentage: safeNumber(reward.discountPercentage),
      distributorId,
      province: location.province,
      district: location.district,
      customerId: order.userId,
      rewardName: normalizeText(reward.benefitName || reward.title || reward.levelName),
      cardCode: normalizeText(reward.cardCode),
    });
  }

  return components;
};

const aggregate = (map, key, initial, amount, orderId) => {
  if (!map.has(key)) map.set(key, { ...initial, amount: 0, orderIds: new Set(), componentCount: 0 });
  const row = map.get(key);
  row.amount = roundMoney(row.amount + amount);
  row.orderIds.add(orderId);
  row.componentCount += 1;
  return row;
};

const presentAggregates = (map) => [...map.entries()]
  .map(([id, value]) => {
    const { orderIds, ...row } = value;
    return { id, ...row, orderCount: orderIds.size };
  })
  .sort((left, right) => right.amount - left.amount);

const parsePagination = (value, fallback, maximum) => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw invalidFilter("Page and limit filters must be positive integers.");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw invalidFilter(`Page and limit values must be between 1 and ${maximum}.`);
  return number;
};

const toIsoDate = (value) => {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const toCalendarDate = (value) => {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? kathmanduDate(new Date(timestamp)) : "";
};

export const getDiscountAnalyticsFilters = async () => {
  const [distributors, { locations }] = await Promise.all([
    prisma.distributor.findMany({
      select: { id: true, name: true, province: true, district: true },
      orderBy: { name: "asc" },
    }),
    getLocationLookupData(),
  ]);
  return {
    distributors,
    provinces: locations.filter((entry) => entry.type === "PROVINCE").map((entry) => entry.name),
    districts: locations.filter((entry) => entry.type === "DISTRICT").map((entry) => ({
      name: entry.name,
      province: entry.province,
    })),
    categories: Object.entries(DISCOUNT_CATEGORIES).map(([id, label]) => ({ id, label })),
  };
};

export const getDiscountAnalytics = async (filters = {}, client = prisma) => {
  const range = resolveDiscountAnalyticsRange(filters);
  const categoryFilter = normalizeText(filters.category);
  if (categoryFilter && !Object.hasOwn(DISCOUNT_CATEGORIES, categoryFilter)) {
    throw invalidFilter("Choose a valid discount category.");
  }
  const distributorId = normalizeText(filters.distributorId);
  const customerId = normalizeText(filters.customerId);
  if (distributorId && !UUID_PATTERN.test(distributorId)) throw invalidFilter("distributorId must be a valid ID.");
  if (
    customerId &&
    !UUID_PATTERN.test(customerId) &&
    !/^GUEST_[A-F0-9]{32}$/i.test(customerId)
  ) {
    throw invalidFilter("customerId must be a valid customer ID.");
  }
  const provinceFilter = normalizeKey(filters.province);
  const districtFilter = normalizeKey(filters.district);
  const rawSearch = normalizeText(filters.search);
  if (rawSearch.length > 120 || normalizeText(filters.province).length > 120 || normalizeText(filters.district).length > 120) {
    throw invalidFilter("Customer search and location filters must be 120 characters or fewer.");
  }
  const search = rawSearch.toLocaleLowerCase();
  const customerPage = parsePagination(filters.customerPage, 1, 100000);
  const orderPage = parsePagination(filters.orderPage, 1, 100000);
  const limit = parsePagination(filters.limit, 25, 100);

  const orderWhere = {
    date: { gte: BigInt(range.startMs), lt: BigInt(range.endMs) },
  };
  const categoryRows = new Map();
  const provinceRows = new Map();
  const districtRows = new Map();
  const distributorRows = new Map();
  const distributorCategoryRows = new Map();
  const districtCategoryRows = new Map();
  const customerRows = new Map();
  const productRows = new Map();
  const orderRows = [];
  let totalDiscount = 0;
  let componentCount = 0;
  let orderCount = 0;
  let orderCursor = null;

  while (true) {
    const orders = await client.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        orderReference: true,
        userId: true,
        items: true,
        amount: true,
        deliveryFee: true,
        address: true,
        status: true,
        date: true,
        loyaltyDiscount: true,
        rewardApplied: true,
        cancelledAt: true,
        distributorId: true,
        locationDiscountDistributorId: true,
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
      ...(orderCursor ? { cursor: { id: orderCursor }, skip: 1 } : {}),
    });
    if (!orders.length) break;
    orderCursor = orders[orders.length - 1].id;

    const orderIds = orders.map((order) => order.id);
    const userIds = [...new Set(orders.map((order) => order.userId).filter((id) => id && !String(id).startsWith("GUEST_")))];
    const [assignments, users] = await Promise.all([
      client.orderAssignment.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true, distributorId: true },
      }),
      client.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, firstName: true, lastName: true, email: true, phone: true },
      }),
    ]);
    const assignmentDistributorIds = assignments.map((entry) => entry.distributorId).filter(Boolean);
    const allDistributorIds = [...new Set([
      ...assignmentDistributorIds,
      ...orders.map((order) => order.distributorId),
      ...orders.map((order) => order.locationDiscountDistributorId),
    ].filter(Boolean))];
    const distributors = allDistributorIds.length
      ? await client.distributor.findMany({
        where: { id: { in: allDistributorIds } },
        select: { id: true, name: true },
      })
      : [];
    const assignmentMap = new Map(assignments.map((entry) => [entry.orderId, entry.distributorId]));
    const userMap = new Map(users.map((user) => [user.id, user]));
    const distributorMap = new Map(distributors.map((distributor) => [distributor.id, distributor.name]));

    for (const order of orders) {
      if (order.cancelledAt || normalizeKey(order.status) === "cancelled") continue;
      const resolvedDistributorId = assignmentMap.get(order.id) || order.distributorId || order.locationDiscountDistributorId || "";
      const location = getOrderLocation(order);
      const user = userMap.get(order.userId);
      const fallbackCustomer = parseJson(order.address, {});
      const customerName = normalizeText(user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
        [fallbackCustomer?.firstName, fallbackCustomer?.lastName].filter(Boolean).join(" ")) || "Guest / unlinked customer";
      const customerEmail = normalizeText(user?.email || fallbackCustomer?.email);
      const customerPhone = normalizeText(user?.phone || fallbackCustomer?.phone);
      const isGuest = !order.userId || String(order.userId).startsWith("GUEST_");
      const guestIdentity = customerEmail || customerPhone || customerName || order.id;
      const customer = {
        id: isGuest
          ? `GUEST_${createHash("sha256").update(String(guestIdentity).toLocaleLowerCase()).digest("hex").slice(0, 32).toUpperCase()}`
          : order.userId,
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
      };
      if (customerId && customer.id !== customerId) continue;
      if (search && ![customer.name, customer.email, customer.phone, customer.id].some((value) => value.toLocaleLowerCase().includes(search))) continue;
      if (distributorId && resolvedDistributorId !== distributorId) continue;
      if (provinceFilter && normalizeKey(location.province) !== provinceFilter) continue;
      if (districtFilter && normalizeKey(location.district) !== districtFilter) continue;

      const components = classifyOrderDiscounts(order, resolvedDistributorId)
        .filter((component) => !categoryFilter || component.category === categoryFilter);
      if (!components.length) continue;
      const amount = roundMoney(components.reduce((sum, component) => sum + component.amount, 0));
      if (!amount) continue;
      orderCount += 1;
      totalDiscount = roundMoney(totalDiscount + amount);
      componentCount += components.length;

      const detail = {
        orderId: order.id,
        orderReference: order.orderReference || order.id,
        customer,
        date: toIsoDate(order.date),
        localDate: toCalendarDate(order.date),
        status: order.status,
        province: location.province || "Not recorded",
        district: location.district || "Not recorded",
        distributorId: resolvedDistributorId || "",
        distributorName: distributorMap.get(resolvedDistributorId) || (resolvedDistributorId ? "Unknown distributor" : "Unassigned"),
        orderAmount: safeNumber(order.amount),
        deliveryFee: safeNumber(order.deliveryFee),
        totalDiscount: amount,
        discountBreakdown: components.map((component) => ({
          category: component.category,
          label: DISCOUNT_CATEGORIES[component.category],
          amount: component.amount,
          productName: component.productName,
          productCategory: component.productCategory,
          size: component.size,
          color: component.color,
          quantity: component.quantity,
          percentage: component.percentage,
          rewardName: component.rewardName || "",
          cardCode: component.cardCode || "",
        })),
      };
      orderRows.push(detail);

      for (const component of components) {
        const category = component.category;
        aggregate(categoryRows, category, { category, label: DISCOUNT_CATEGORIES[category] }, component.amount, order.id);
        const province = location.province || "Not recorded";
        const district = location.district || "Not recorded";
        aggregate(provinceRows, province, { province }, component.amount, order.id);
        aggregate(districtRows, `${province}|${district}`, { province, district }, component.amount, order.id);

        const distributorKey = resolvedDistributorId || "UNASSIGNED";
        aggregate(distributorRows, distributorKey, {
          distributorId: resolvedDistributorId || "",
          distributorName: distributorMap.get(resolvedDistributorId) || (resolvedDistributorId ? "Unknown distributor" : "Unassigned"),
        }, component.amount, order.id);
        aggregate(distributorCategoryRows, `${distributorKey}|${category}`, {
          distributorId: resolvedDistributorId || "",
          distributorName: distributorMap.get(resolvedDistributorId) || (resolvedDistributorId ? "Unknown distributor" : "Unassigned"),
          category,
          label: DISCOUNT_CATEGORIES[category],
        }, component.amount, order.id);
        aggregate(districtCategoryRows, `${province}|${district}|${category}`, {
          province,
          district,
          category,
          label: DISCOUNT_CATEGORIES[category],
        }, component.amount, order.id);
        aggregate(customerRows, customer.id, { customer }, component.amount, order.id);

        if (component.productId) {
          const productKey = component.productId;
          aggregate(productRows, productKey, {
            productId: component.productId,
            productName: component.productName,
            productCategory: component.productCategory,
          }, component.amount, order.id);
        }
      }
    }
    if (orders.length < BATCH_SIZE) break;
  }

  const sortByDiscount = (left, right) => right.totalDiscount - left.totalDiscount;
  const makePagedRows = (rows, page) => ({
    rows: rows.slice((page - 1) * limit, page * limit),
    page,
    limit,
    total: rows.length,
    pageCount: Math.ceil(rows.length / limit),
  });
  const customers = presentAggregates(customerRows)
    .map(({ amount, ...row }) => ({ ...row, totalDiscount: amount }))
    .sort(sortByDiscount);
  const ordersForDisplay = orderRows
    .sort((left, right) => String(right.date).localeCompare(String(left.date)) || right.orderReference.localeCompare(left.orderReference));

  return {
    range: {
      period: range.period,
      startDate: range.startDate,
      endDate: range.endDate,
    },
    summary: {
      totalDiscount: roundMoney(totalDiscount),
      ordersWithDiscount: orderCount,
      discountComponents: componentCount,
      averageDiscountPerOrder: orderCount ? roundMoney(totalDiscount / orderCount) : 0,
      averageDiscountPerComponent: componentCount ? roundMoney(totalDiscount / componentCount) : 0,
    },
    breakdowns: {
      categories: presentAggregates(categoryRows),
      provinces: presentAggregates(provinceRows),
      districts: presentAggregates(districtRows),
      distributors: presentAggregates(distributorRows),
      distributorCategories: presentAggregates(distributorCategoryRows),
      districtCategories: presentAggregates(districtCategoryRows),
      products: presentAggregates(productRows),
      customers: makePagedRows(customers, customerPage),
      orders: makePagedRows(ordersForDisplay, orderPage),
    },
    notes: [
      "Discount totals use the prices and reward snapshots saved on each order; current product settings are not used to rewrite history.",
      "Place-wise pricing replaces the standard product discount for that item; the two are not added together.",
      "Canceled orders are excluded. Product, location, loyalty, marketing-card, combo-bundle, and recorded admin/legacy order discounts are classified separately.",
      "Free-shipping savings are not included because historical orders do not consistently record the undiscounted shipping fee.",
      "Distributor totals use the distributor assigned to the order; orders without a recorded distributor are grouped as Unassigned.",
      "Historical orders without a saved original unit price cannot be used to reconstruct product-price discounts.",
    ],
  };
};
