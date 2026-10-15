import test from "node:test";
import assert from "node:assert/strict";
import {
  getAdminNcmDeliveryDetails,
  getAdminSelfDeliveryDetails,
  getKathmanduDateRange,
  listAdminNcmDeliveries,
  listAdminSelfDeliveryDistributors,
} from "../services/adminDeliveryMonitoringService.js";

const asISO = (value) => value.toISOString();

test("Kathmandu today range uses local midnight boundaries", () => {
  const range = getKathmanduDateRange({
    range: "today",
    now: new Date("2026-10-15T12:00:00.000Z"),
  });

  assert.equal(asISO(range.start), "2026-10-14T18:15:00.000Z");
  assert.equal(asISO(range.endExclusive), "2026-10-15T18:15:00.000Z");
});

test("Kathmandu week range starts on Monday", () => {
  const range = getKathmanduDateRange({
    range: "week",
    now: new Date("2026-10-15T12:00:00.000Z"),
  });

  assert.equal(asISO(range.start), "2026-10-11T18:15:00.000Z");
  assert.equal(asISO(range.endExclusive), "2026-10-18T18:15:00.000Z");
});

test("custom ranges include the full final Kathmandu date", () => {
  const range = getKathmanduDateRange({
    range: "custom",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
  });

  assert.equal(asISO(range.start), "2026-09-30T18:15:00.000Z");
  assert.equal(asISO(range.endExclusive), "2026-10-03T18:15:00.000Z");
});

test("invalid and reversed custom ranges are rejected", () => {
  assert.throws(
    () => getKathmanduDateRange({ range: "custom", startDate: "2026-02-30", endDate: "2026-03-01" }),
    /valid calendar date/,
  );
  assert.throws(
    () => getKathmanduDateRange({ range: "custom", startDate: "2026-03-02", endDate: "2026-03-01" }),
    /not be later/,
  );
});

test("all-time range does not constrain database dates", () => {
  assert.equal(getKathmanduDateRange({ range: "all" }), null);
});

test("NCM list returns compact customer and location fields with bounded pagination", async () => {
  let findManyArgs;
  const client = {
    deliveryOrder: {
      findMany: async (args) => {
        findManyArgs = args;
        return [{
          id: "delivery-1",
          orderId: "order-1",
          ncmOrderId: 77,
          state: "DELIVERED",
          ncmStatus: "Delivered",
          originBranchName: "KATHMANDU",
          destinationBranchName: "POKHARA",
          createdAt: new Date("2026-10-15T00:00:00Z"),
          ncmCreatedAt: null,
          deliveredAt: new Date("2026-10-15T01:00:00Z"),
          returnedAt: null,
          order: {
            id: "order-1",
            userId: "user-1",
            address: {
              city: "Lalitpur",
              district: "Lalitpur",
              province: "Bagmati",
              phone: "9800000000",
            },
            status: "Delivered",
          },
        }];
      },
      count: async () => 1,
    },
    user: {
      findMany: async () => [{ id: "user-1", name: "Customer Example" }],
    },
  };

  const result = await listAdminNcmDeliveries({
    range: "all",
    status: "completed",
    page: "1",
    limit: "10",
  }, client);

  assert.equal(findManyArgs.take, 10);
  assert.equal(findManyArgs.where.state, "DELIVERED");
  assert.equal(result.deliveries[0].customerName, "Customer Example");
  assert.equal(result.deliveries[0].deliveryLocation, "Lalitpur, Bagmati");
  assert.equal(result.deliveries[0].deliveryLocation.includes("9800000000"), false);
  assert.equal(result.pagination.total, 1);
});

test("self-delivery distributor lookup only includes hubs with explicit self-delivery assignments", async () => {
  let query;
  const client = {
    distributor: {
      findMany: async (args) => {
        query = args;
        return [{ id: "hub-1", name: "Hub One", district: "Kaski", province: "Gandaki" }];
      },
      count: async () => 1,
    },
  };
  const result = await listAdminSelfDeliveryDistributors({ limit: "100" }, client);

  assert.deepEqual(query.where.assignments, { some: { deliveryType: "SELF_DELIVERY" } });
  assert.equal(result.distributors[0].id, "hub-1");
  assert.equal(result.pagination.total, 1);
});

test("invalid pagination values are rejected rather than producing unbounded offsets", async () => {
  await assert.rejects(
    () => listAdminNcmDeliveries({ range: "all", page: "1e9", limit: "1000" }, {}),
    /page must be an integer/,
  );
});

test("NCM detail serializes the order's BigInt timestamp as a number", async () => {
  const orderDate = 1792022400000n;
  const client = {
    deliveryOrder: {
      findUnique: async () => ({
        id: "delivery-1",
        orderId: "order-1",
        createdAt: new Date("2026-10-15T00:00:00Z"),
        order: { id: "order-1", userId: "user-1", date: orderDate },
        events: [],
      }),
    },
    user: { findUnique: async () => null },
    customerReturn: { findMany: async () => [] },
    orderExchangeRequest: { findMany: async () => [] },
    deliveryFinancialSettlement: { findUnique: async () => null },
    distributorReview: { findUnique: async () => null },
  };

  const result = await getAdminNcmDeliveryDetails("delivery-1", client);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(result.delivery.order.date, Number(orderDate));
  assert.equal(result.delivery.order.createdAt, Number(orderDate));
});

test("self-delivery detail serializes the order's BigInt timestamp as a number", async () => {
  const orderDate = 1792022400000n;
  const client = {
    orderAssignment: {
      findUnique: async () => ({
        id: "assignment-1",
        orderId: "order-1",
        distributorId: "distributor-1",
        deliveryType: "SELF_DELIVERY",
      }),
    },
    deliveryOrder: { findUnique: async () => null },
    order: {
      findUnique: async () => ({
        id: "order-1",
        userId: "user-1",
        date: orderDate,
      }),
    },
    distributor: { findUnique: async () => ({ id: "distributor-1", name: "Hub One" }) },
    customerReturn: { findMany: async () => [] },
    orderExchangeRequest: { findMany: async () => [] },
    distributorReview: { findUnique: async () => null },
    user: { findUnique: async () => null },
  };

  const result = await getAdminSelfDeliveryDetails("assignment-1", client);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(result.delivery.order.date, Number(orderDate));
  assert.equal(result.delivery.order.createdAt, Number(orderDate));
});
