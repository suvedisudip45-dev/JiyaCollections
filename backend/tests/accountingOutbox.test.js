import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  enqueueDeliveredSaleAccounting,
  getDeliveryAccountingOutboxStatus,
  processDeliveryAccountingOutbox,
} from "../services/accountingOutboxService.js";

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const makeOrder = () => ({
  id: "order-1",
  amount: 226,
  deliveryFee: 22.6,
  items: [{ productId: "product-1", quantity: 1, agreedUnitCogsVatInclusiveAtAcceptance: 100 }],
  paymentMethod: "COD",
  userId: "customer-1",
  customerName: "Customer One",
  manufacturerId: "manufacturer-1",
  orderType: "DIRECT_MANUFACTURER",
  directOrderType: "PHONE_ORDER",
  agreedCommissionRate: 5,
  address: { phone: "not-part-of-accounting-snapshot" },
});

const makeEvent = () => {
  const order = {
    id: "order-1",
    amount: "226",
    deliveryCharge: "22.6",
    items: JSON.stringify([{ productId: "product-1", quantity: 1 }]),
    paymentMethod: "COD",
    userId: "customer-1",
    customerName: "Customer One",
    manufacturerId: "manufacturer-1",
    orderType: "DIRECT_MANUFACTURER",
    directOrderType: "PHONE_ORDER",
    agreedCommissionRate: "5",
    deliveredAt: "2026-10-16T10:00:00.000Z",
  };
  const payload = {
    snapshotVersion: 1,
    order,
    deliveryOrder: { deliveredAt: order.deliveredAt },
  };

  return {
    id: "event-1",
    idempotencyKey: "DELIVERY_SALE:order-1",
    sourceType: "DELIVERY_SALE",
    sourceId: "order-1",
    sourceVersion: 1,
    eventType: "DELIVERY_SALE",
    effectiveAt: new Date(order.deliveredAt),
    status: "PENDING",
    payload,
    payloadHash: crypto.createHash("sha256").update(stableStringify(payload)).digest("hex"),
    attemptCount: 0,
    nextAttemptAt: new Date("2026-10-16T10:00:00.000Z"),
    claimedAt: null,
    lastError: null,
    processedAt: null,
    createdAt: new Date("2026-10-16T10:00:00.000Z"),
    updatedAt: new Date("2026-10-16T10:00:00.000Z"),
  };
};

const makeWorkerClient = (event) => ({
  accountingEvent: {
    updateMany: async ({ where, data }) => {
      if (where.id && where.id !== event.id) return { count: 0 };
      if (where.status === "PROCESSING" && where.claimedAt?.lt) return { count: 0 };
      if (where.status?.in && !where.status.in.includes(event.status)) return { count: 0 };
      if (typeof where.status === "string" && where.status !== event.status) return { count: 0 };
      if (where.nextAttemptAt?.lte && event.nextAttemptAt > where.nextAttemptAt.lte) return { count: 0 };

      for (const [key, value] of Object.entries(data)) {
        if (key === "attemptCount" && value.increment) event.attemptCount += value.increment;
        else event[key] = value;
      }
      return { count: 1 };
    },
    findMany: async () => event.status === "PENDING" || event.status === "FAILED" ? [{ id: event.id }] : [],
    findUnique: async () => event,
    groupBy: async () => [],
  },
});

test("enqueueDeliveredSaleAccounting stores a minimal immutable snapshot with an idempotent key", async () => {
  let upsertArgs;
  const client = {
    accountingEvent: {
      upsert: async (args) => {
        upsertArgs = args;
        return { id: "event-1", ...args.create };
      },
    },
  };

  const event = await enqueueDeliveredSaleAccounting({
    order: makeOrder(),
    deliveryOrder: { id: "delivery-1", deliveredAt: new Date("2026-10-16T10:00:00.000Z"), customerDeliveryCharge: 22.6 },
  }, { client });

  assert.equal(upsertArgs.where.idempotencyKey, "DELIVERY_SALE:order-1");
  assert.deepEqual(upsertArgs.update, {});
  assert.equal(event.status, "PENDING");
  assert.equal(event.payload.order.amount, "226");
  assert.equal(event.payload.order.deliveryCharge, "22.6");
  assert.deepEqual(JSON.parse(event.payload.order.items), makeOrder().items);
  assert.equal("address" in event.payload.order, false);
  assert.equal(event.payload.deliveryOrder.id, "delivery-1");
});

test("delivery accounting worker posts claimed events and marks them posted", async () => {
  const event = makeEvent();
  const now = new Date("2026-10-16T10:00:01.000Z");
  const client = makeWorkerClient(event);
  let posterArgs;

  const result = await processDeliveryAccountingOutbox({
    client,
    now,
    poster: async (orderData, options) => {
      posterArgs = { orderData, options };
      return { id: "journal-1" };
    },
  });

  assert.deepEqual(result, { posted: 1, failed: 0, blocked: 0, skipped: 0 });
  assert.equal(posterArgs.options.accountingEventId, event.id);
  assert.equal(posterArgs.orderData.order.id, "order-1");
  assert.equal(event.status, "POSTED");
  assert.equal(event.attemptCount, 1);
  assert.equal(event.claimedAt, null);
  assert.equal(event.nextAttemptAt, null);
});

test("delivery accounting worker retains failed events and schedules retry", async () => {
  const event = makeEvent();
  const now = new Date("2026-10-16T10:00:01.000Z");
  const client = makeWorkerClient(event);

  const result = await processDeliveryAccountingOutbox({
    client,
    now,
    poster: async () => {
      throw new Error("Temporary database error");
    },
  });

  assert.deepEqual(result, { posted: 0, failed: 1, blocked: 0, skipped: 0 });
  assert.equal(event.status, "FAILED");
  assert.equal(event.lastError, "Temporary database error");
  assert.equal(event.claimedAt, null);
  assert.ok(event.nextAttemptAt > now);
});

test("delivery accounting worker blocks invalid or tampered snapshots", async () => {
  const event = makeEvent();
  event.payload.order.amount = "999";
  const client = makeWorkerClient(event);
  let posterCalled = false;

  const result = await processDeliveryAccountingOutbox({
    client,
    now: new Date("2026-10-16T10:00:01.000Z"),
    poster: async () => {
      posterCalled = true;
      return { id: "journal-1" };
    },
  });

  assert.deepEqual(result, { posted: 0, failed: 0, blocked: 1, skipped: 0 });
  assert.equal(posterCalled, false);
  assert.equal(event.status, "BLOCKED");
  assert.equal(event.nextAttemptAt, null);
});

test("delivery accounting status reports unresolved states and gross amounts", async () => {
  const client = {
    accountingEvent: {
      groupBy: async () => [
        { status: "PENDING", _count: { _all: 1 } },
        { status: "FAILED", _count: { _all: 1 } },
      ],
      findMany: async () => [{
        id: "event-1",
        sourceId: "order-1",
        status: "FAILED",
        effectiveAt: new Date("2026-10-16T10:00:00.000Z"),
        attemptCount: 3,
        lastError: "Mapping unavailable",
        nextAttemptAt: new Date("2026-10-16T10:05:00.000Z"),
        updatedAt: new Date("2026-10-16T10:00:00.000Z"),
        payload: { order: { amount: "226.00" } },
      }],
    },
  };

  const status = await getDeliveryAccountingOutboxStatus(client);

  assert.equal(status.unpostedCount, 2);
  assert.equal(status.pendingCount, 1);
  assert.equal(status.failedCount, 1);
  assert.equal(status.events[0].grossAmount, "226.00");
});
