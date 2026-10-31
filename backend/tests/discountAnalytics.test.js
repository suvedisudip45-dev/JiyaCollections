import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyOrderDiscounts,
  DISCOUNT_CATEGORIES,
  getDiscountAnalytics,
  resolveDiscountAnalyticsRange,
} from "../services/discountAnalyticsService.js";

test("discount analytics uses Kathmandu calendar ranges and supports all time", () => {
  const now = new Date("2026-10-31T02:30:00.000Z");
  assert.deepEqual(
    resolveDiscountAnalyticsRange({ period: "today" }, now),
    {
      period: "today",
      startDate: "2026-10-31",
      endDate: "2026-10-31",
      startMs: Date.parse("2026-10-30T18:15:00.000Z"),
      endMs: Date.parse("2026-10-31T18:15:00.000Z"),
    }
  );
  const allTime = resolveDiscountAnalyticsRange({ period: "all" }, now);
  assert.equal(allTime.startDate, null);
  assert.equal(allTime.endDate, "2026-10-31");
  assert.equal(allTime.startMs, 0);
});

test("discount analytics rejects invalid or overlong custom date ranges", () => {
  assert.throws(
    () => resolveDiscountAnalyticsRange({ period: "custom", startDate: "2026-02-31", endDate: "2026-03-01" }),
    /startDate is not a valid calendar date/
  );
  assert.throws(
    () => resolveDiscountAnalyticsRange({ period: "custom", startDate: "2025-01-01", endDate: "2026-01-02" }),
    /cannot exceed 366 days/
  );
});

test("discount analytics classifies saved item price reductions by their recorded source", () => {
  const order = {
    id: "order-1",
    userId: "customer-1",
    address: { province: "Bagmati Province", district: "Kathmandu" },
    items: [
      {
        productId: "product-location",
        name: "Location priced item",
        category: "Tops",
        size: "M",
        color: "Blue",
        quantity: 2,
        originalUnitPrice: 1000,
        purchasedUnitPrice: 800,
        discountSource: "LOCATION",
        locationDiscountPercentage: 20,
      },
      {
        productId: "product-setting",
        name: "Product discount item",
        quantity: 1,
        originalUnitPrice: 500,
        purchasedUnitPrice: 450,
        discountSource: "PRODUCT",
        globalProductDiscountPercentage: 10,
      },
      {
        productId: "product-bundle",
        name: "Bundle component",
        comboBundleId: "bundle-1",
        quantity: 1,
        originalUnitPrice: 600,
        purchasedUnitPrice: 500,
      },
    ],
    loyaltyDiscount: 100,
    rewardApplied: { source: "LOYALTY", levelName: "Gold" },
  };
  const components = classifyOrderDiscounts(order, "distributor-1");
  assert.deepEqual(components.map(({ category, amount }) => [category, amount]), [
    ["LOCATION", 400],
    ["PRODUCT", 50],
    ["COMBO_BUNDLE", 100],
    ["LOYALTY", 100],
  ]);
  assert.equal(components[0].district, "Kathmandu");
  assert.equal(components[0].distributorId, "distributor-1");
});

test("discount analytics distinguishes marketing-card and admin order discounts", () => {
  const marketingCard = classifyOrderDiscounts({
    id: "order-card",
    userId: "customer-1",
    items: [],
    loyaltyDiscount: 0,
    rewardApplied: { source: "MARKETING_CARD", discountAmount: 125, cardCode: "CARD-1" },
  });
  assert.equal(marketingCard[0].category, "MARKETING_CARD");
  assert.equal(marketingCard[0].amount, 125);
  assert.equal(marketingCard[0].cardCode, "CARD-1");

  const adminOrder = classifyOrderDiscounts({
    id: "order-admin",
    userId: "customer-1",
    items: [],
    loyaltyDiscount: 75,
    rewardApplied: { adminCreated: true, manualDiscount: 75 },
  });
  assert.equal(adminOrder[0].category, "ADMIN_ORDER");
  assert.equal(adminOrder[0].amount, 75);
  assert.equal(DISCOUNT_CATEGORIES[adminOrder[0].category], "Admin order discount");
});

test("discount analytics applies location and category filters consistently across breakdowns", async () => {
  const distributorA = "1b73a191-51a0-4b2d-9e49-52bbf776f7d1";
  const distributorB = "2b73a191-51a0-4b2d-9e49-52bbf776f7d2";
  const customerA = "3b73a191-51a0-4b2d-9e49-52bbf776f7d3";
  const customerB = "4b73a191-51a0-4b2d-9e49-52bbf776f7d4";
  const date = BigInt(Date.now());
  const orders = [
    {
      id: "order-a",
      orderReference: "ORDER-A",
      userId: customerA,
      items: [{
        productId: "product-a",
        name: "Local item",
        category: "Tops",
        quantity: 2,
        originalUnitPrice: 100,
        purchasedUnitPrice: 80,
        discountSource: "LOCATION",
        locationDiscountPercentage: 20,
      }],
      amount: 165,
      deliveryFee: 0,
      address: { province: "Bagmati Province", district: "Kathmandu" },
      status: "Delivered",
      date,
      loyaltyDiscount: 5,
      rewardApplied: { source: "LOYALTY", levelName: "Gold" },
      cancelledAt: null,
      distributorId: null,
      locationDiscountDistributorId: distributorA,
    },
    {
      id: "order-b",
      orderReference: "ORDER-B",
      userId: customerB,
      items: [{
        productId: "product-b",
        name: "Product item",
        category: "Bottoms",
        quantity: 1,
        originalUnitPrice: 100,
        purchasedUnitPrice: 90,
        discountSource: "PRODUCT",
        globalProductDiscountPercentage: 10,
      }],
      amount: 75,
      deliveryFee: 0,
      address: { province: "Koshi Province", district: "Morang" },
      status: "Delivered",
      date,
      loyaltyDiscount: 0,
      rewardApplied: { source: "MARKETING_CARD", discountAmount: 15 },
      cancelledAt: null,
      distributorId: null,
      locationDiscountDistributorId: null,
    },
    {
      id: "order-cancelled",
      orderReference: "ORDER-C",
      userId: customerA,
      items: [{
        productId: "product-a",
        name: "Cancelled item",
        quantity: 1,
        originalUnitPrice: 500,
        purchasedUnitPrice: 0,
        discountSource: "PRODUCT",
      }],
      amount: 0,
      deliveryFee: 0,
      address: { province: "Bagmati Province", district: "Kathmandu" },
      status: "Cancelled",
      date,
      loyaltyDiscount: 0,
      rewardApplied: {},
      cancelledAt: new Date(),
      distributorId: distributorA,
      locationDiscountDistributorId: null,
    },
  ];
  const users = [
    { id: customerA, name: "Customer A", firstName: "Customer", lastName: "A", email: "a@example.test", phone: "9800000000" },
    { id: customerB, name: "Customer B", firstName: "Customer", lastName: "B", email: "b@example.test", phone: "9800000001" },
  ];
  const distributors = [
    { id: distributorA, name: "Distributor A" },
    { id: distributorB, name: "Distributor B" },
  ];
  const client = {
    order: {
      findMany: async ({ take, cursor }) => {
        const startIndex = cursor ? orders.findIndex((order) => order.id === cursor.id) + 1 : 0;
        return orders.slice(startIndex, startIndex + take);
      },
    },
    orderAssignment: {
      findMany: async ({ where }) => [
        { orderId: "order-a", distributorId: distributorA },
        { orderId: "order-b", distributorId: distributorB },
      ].filter((assignment) => where.orderId.in.includes(assignment.orderId)),
    },
    user: {
      findMany: async ({ where }) => users.filter((user) => where.id.in.includes(user.id)),
    },
    distributor: {
      findMany: async ({ where }) => distributors.filter((distributor) => where.id.in.includes(distributor.id)),
    },
  };

  const report = await getDiscountAnalytics({ period: "all" }, client);
  assert.equal(report.summary.totalDiscount, 70);
  assert.equal(report.summary.ordersWithDiscount, 2);
  assert.equal(report.breakdowns.distributorCategories.length, 4);
  assert.equal(report.breakdowns.customers.rows.length, 2);
  assert.equal(report.breakdowns.orders.rows.length, 2);

  const filtered = await getDiscountAnalytics({
    period: "all",
    category: "LOCATION",
    province: "Bagmati Province",
    district: "Kathmandu",
    distributorId: distributorA,
    customerId: customerA,
  }, client);
  assert.equal(filtered.summary.totalDiscount, 40);
  assert.equal(filtered.summary.ordersWithDiscount, 1);
  assert.deepEqual(filtered.breakdowns.categories.map((row) => row.category), ["LOCATION"]);
  assert.equal(filtered.breakdowns.districts[0].district, "Kathmandu");
  assert.equal(filtered.breakdowns.distributors[0].distributorName, "Distributor A");
  assert.equal(filtered.breakdowns.customers.rows[0].customer.name, "Customer A");
  assert.equal(filtered.breakdowns.orders.rows[0].discountBreakdown[0].label, "Place-wise discount");
});
