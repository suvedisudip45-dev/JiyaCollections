import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { postDeliveredOrderAccounting } from "./accountingPostingEngine.js";

const DELIVERY_SALE_SOURCE = "DELIVERY_SALE";
const SNAPSHOT_VERSION = 1;
const BATCH_SIZE = 25;
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

const stableStringify = (value) => JSON.stringify(canonicalize(value));

const toIsoDate = (value, fallback) => {
  const date = value ? new Date(value) : fallback;
  if (Number.isNaN(date.getTime())) throw new Error("Delivered-sale accounting event has an invalid effective date.");
  return date.toISOString();
};

const snapshotItems = (items) => {
  const parsed = typeof items === "string" ? JSON.parse(items) : (items || []);
  if (!Array.isArray(parsed)) throw new Error("Delivered-sale accounting event requires an order item array.");
  return JSON.stringify(parsed);
};

const buildDeliverySaleSnapshot = ({ order, deliveryOrder }) => {
  if (!order?.id) throw new Error("Delivered-sale accounting event requires an order ID.");
  const now = new Date();
  const effectiveAt = toIsoDate(deliveryOrder?.deliveredAt || order.deliveredAt, now);
  const deliveryCharge = order.deliveryCharge || order.deliveryFee || deliveryOrder?.customerDeliveryCharge || 0;
  const orderSnapshot = {
    id: String(order.id),
    amount: String(order.amount ?? 0),
    deliveryCharge: String(deliveryCharge),
    items: snapshotItems(order.items),
    paymentMethod: String(order.paymentMethod || "COD"),
    userId: order.userId ? String(order.userId) : null,
    customerName: order.customerName ? String(order.customerName) : null,
    manufacturerId: order.manufacturerId ? String(order.manufacturerId) : null,
    orderType: order.orderType ? String(order.orderType) : null,
    directOrderType: order.directOrderType ? String(order.directOrderType) : null,
    agreedCommissionRate: String(order.agreedCommissionRate ?? 0),
    deliveredAt: effectiveAt,
  };
  const deliverySnapshot = deliveryOrder
    ? {
        id: String(deliveryOrder.id),
        manufacturerId: deliveryOrder.manufacturerId ? String(deliveryOrder.manufacturerId) : null,
        customerDeliveryCharge: String(deliveryOrder.customerDeliveryCharge ?? deliveryCharge),
        deliveredAt: effectiveAt,
      }
    : { deliveredAt: effectiveAt };
  const payload = {
    snapshotVersion: SNAPSHOT_VERSION,
    order: orderSnapshot,
    deliveryOrder: deliverySnapshot,
  };

  return { payload, effectiveAt: new Date(effectiveAt) };
};

export const enqueueDeliveredSaleAccounting = async (
  { order, deliveryOrder = null },
  { client = prisma } = {},
) => {
  const { payload, effectiveAt } = buildDeliverySaleSnapshot({ order, deliveryOrder });
  const idempotencyKey = `${DELIVERY_SALE_SOURCE}:${order.id}`;
  const payloadHash = crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
  const event = await client.accountingEvent.upsert({
    where: { idempotencyKey },
    create: {
      idempotencyKey,
      sourceType: DELIVERY_SALE_SOURCE,
      sourceId: String(order.id),
      sourceVersion: SNAPSHOT_VERSION,
      eventType: DELIVERY_SALE_SOURCE,
      effectiveAt,
      status: "PENDING",
      payload,
      payloadHash,
      nextAttemptAt: new Date(),
    },
    update: {},
  });

  if (
    event.sourceType !== DELIVERY_SALE_SOURCE ||
    event.sourceId !== String(order.id) ||
    event.eventType !== DELIVERY_SALE_SOURCE
  ) {
    throw new Error(`Accounting event key ${idempotencyKey} is already bound to a different source.`);
  }
  return event;
};

const isValidSnapshot = (event) => {
  const payload = event?.payload;
  return event?.sourceType === DELIVERY_SALE_SOURCE &&
    event?.eventType === DELIVERY_SALE_SOURCE &&
    event?.idempotencyKey === `${DELIVERY_SALE_SOURCE}:${event.sourceId}` &&
    payload?.snapshotVersion === SNAPSHOT_VERSION &&
    payload?.order?.id === event.sourceId &&
    typeof payload.order.items === "string" &&
    event.payloadHash === crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
};

const retryDelay = (attemptCount) =>
  Math.min(MAX_RETRY_DELAY_MS, 1000 * (2 ** Math.min(attemptCount, 12)));

const processEvent = async (eventId, { client, poster, now }) => {
  const claimed = await client.accountingEvent.updateMany({
    where: {
      id: eventId,
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: now },
    },
    data: {
      status: "PROCESSING",
      claimedAt: now,
      attemptCount: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return "skipped";

  const event = await client.accountingEvent.findUnique({ where: { id: eventId } });
  if (!event) return "skipped";

  try {
    if (!isValidSnapshot(event)) {
      const error = new Error("Delivered-sale accounting event payload is invalid or unsupported.");
      error.code = "INVALID_ACCOUNTING_EVENT";
      throw error;
    }

    const journalEntry = await poster(
      { order: event.payload.order, deliveryOrder: event.payload.deliveryOrder },
      { client, accountingEventId: event.id },
    );
    if (!journalEntry) {
      const error = new Error("Delivered-sale accounting poster did not create a journal entry.");
      error.code = "ACCOUNTING_POSTING_EMPTY";
      throw error;
    }

    await client.accountingEvent.updateMany({
      where: { id: event.id, status: "PROCESSING" },
      data: {
        status: "POSTED",
        processedAt: new Date(),
        claimedAt: null,
        nextAttemptAt: null,
        lastError: null,
      },
    });
    return "posted";
  } catch (error) {
    const blocked = error.code === "INVALID_ACCOUNTING_EVENT" || error.code === "ACCOUNTING_POSTING_EMPTY";
    const retryAt = new Date(now.getTime() + retryDelay(event.attemptCount));
    await client.accountingEvent.updateMany({
      where: { id: event.id, status: "PROCESSING" },
      data: {
        status: blocked ? "BLOCKED" : "FAILED",
        claimedAt: null,
        nextAttemptAt: blocked ? null : retryAt,
        lastError: String(error.message || error).slice(0, 2000),
      },
    });
    logger.error("Delivered-sale accounting outbox event could not be posted.", {
      eventId: event.id,
      orderId: event.sourceId,
      attemptCount: event.attemptCount,
      blocked,
      error: error.message || error,
    });
    return blocked ? "blocked" : "failed";
  }
};

export const processDeliveryAccountingOutbox = async ({
  client = prisma,
  poster = postDeliveredOrderAccounting,
  now = new Date(),
} = {}) => {
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  await client.accountingEvent.updateMany({
    where: {
      sourceType: DELIVERY_SALE_SOURCE,
      eventType: DELIVERY_SALE_SOURCE,
      status: "PROCESSING",
      claimedAt: { lt: staleBefore },
    },
    data: {
      status: "FAILED",
      claimedAt: null,
      nextAttemptAt: now,
      lastError: "Accounting worker claim expired; retrying.",
    },
  });

  const pending = await client.accountingEvent.findMany({
    where: {
      sourceType: DELIVERY_SALE_SOURCE,
      eventType: DELIVERY_SALE_SOURCE,
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: now },
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: BATCH_SIZE,
    select: { id: true },
  });

  const counts = { posted: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const event of pending) {
    const result = await processEvent(event.id, { client, poster, now });
    counts[result] += 1;
  }
  return counts;
};

export const getDeliveryAccountingOutboxStatus = async (client = prisma) => {
  const where = {
    sourceType: DELIVERY_SALE_SOURCE,
    eventType: DELIVERY_SALE_SOURCE,
    status: { in: ["PENDING", "PROCESSING", "FAILED", "BLOCKED"] },
  };
  const [groupedCounts, events] = await Promise.all([
    client.accountingEvent.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    client.accountingEvent.findMany({
      where,
      orderBy: [{ status: "asc" }, { updatedAt: "asc" }],
      take: 20,
      select: {
        id: true,
        sourceId: true,
        status: true,
        effectiveAt: true,
        attemptCount: true,
        lastError: true,
        nextAttemptAt: true,
        updatedAt: true,
        payload: true,
      },
    }),
  ]);
  const counts = Object.fromEntries(groupedCounts.map((row) => [row.status, row._count._all]));
  const listedEvents = events.map((event) => ({
    id: event.id,
    orderId: event.sourceId,
    status: event.status,
    effectiveAt: event.effectiveAt,
    attemptCount: event.attemptCount,
    lastError: event.lastError,
    nextAttemptAt: event.nextAttemptAt,
    updatedAt: event.updatedAt,
    grossAmount: event.payload?.order?.amount ?? null,
  }));

  return {
    pendingCount: counts.PENDING || 0,
    processingCount: counts.PROCESSING || 0,
    failedCount: counts.FAILED || 0,
    blockedCount: counts.BLOCKED || 0,
    unpostedCount: groupedCounts.reduce((total, row) => total + row._count._all, 0),
    events: listedEvents,
  };
};

let workerTimer = null;
let workerRunning = false;

const runWorkerCycle = async () => {
  if (workerRunning) return;
  workerRunning = true;
  try {
    await processDeliveryAccountingOutbox();
  } catch (error) {
    logger.error("Delivered-sale accounting outbox polling failed.", { error: error.message || error });
  } finally {
    workerRunning = false;
  }
};

export const startDeliveryAccountingOutboxWorker = (intervalMs = 1000) => {
  if (workerTimer) return;
  workerTimer = setInterval(() => { void runWorkerCycle(); }, Math.max(250, intervalMs));
  workerTimer.unref?.();
  void runWorkerCycle();
};

export const stopDeliveryAccountingOutboxWorker = () => {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
};
