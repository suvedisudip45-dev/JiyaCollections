import assert from "node:assert/strict";
import test from "node:test";
import { enqueueNotification } from "../notifications/notificationService.js";
import { publishPendingOutbox } from "../notifications/outboxRelay.js";
import { calculateRetryDelay, nextRetryAt } from "../notifications/retry.js";
import { scheduleDueRetries } from "../notifications/scheduler.js";
import { processNotificationMessage } from "../notifications/consumer.js";
import { NotificationProviderError } from "../notifications/providerError.js";

const enabledConfig = {
  enabled: true,
  sms: { enabled: true },
  email: { enabled: false },
  retry: { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 10000 },
};

test("retry backoff is capped and jitter is bounded", () => {
  assert.equal(calculateRetryDelay({ attemptNumber: 1, baseDelayMs: 1000, maxDelayMs: 10000, random: () => 0 }), 1000);
  assert.equal(calculateRetryDelay({ attemptNumber: 2, baseDelayMs: 1000, maxDelayMs: 10000, random: () => 0.5 }), 2200);
  assert.equal(calculateRetryDelay({ attemptNumber: 10, baseDelayMs: 1000, maxDelayMs: 10000, random: () => 0.99 }), 10000);
  assert.equal(nextRetryAt({ attemptNumber: 1, baseDelayMs: 1000, maxDelayMs: 10000, random: () => 0 }, new Date(0)).getTime(), 1000);
});

test("notification creation atomically records event and outbox with an idempotency key", async () => {
  const state = { notification: null, events: [], outbox: [] };
  const client = {
    notification: {
      findUnique: async () => state.notification && ({ id: state.notification.id, status: state.notification.status }),
      create: async ({ data }) => { state.notification = { ...data, id: "notification-1", status: "PENDING" }; return state.notification; },
    },
    notificationEvent: { create: async ({ data }) => { state.events.push(data); return data; } },
    notificationOutbox: { create: async ({ data }) => { state.outbox.push(data); return data; } },
    $transaction: async (callback) => callback(client),
  };

  const result = await enqueueNotification({
    channel: "SMS",
    recipientAddress: "9800000000",
    idempotencyKey: "order-status:1",
    payload: { text: "Test" },
  }, { client, config: enabledConfig });
  assert.equal(result.id, "notification-1");
  assert.equal(result.duplicate, false);
  assert.equal(state.events[0].eventType, "CREATED");
  assert.equal(state.outbox[0].routingKey, "notification.sms");

  const duplicate = await enqueueNotification({
    channel: "SMS",
    recipientAddress: "9800000000",
    idempotencyKey: "order-status:1",
    payload: { text: "Test" },
  }, { client, config: enabledConfig });
  assert.equal(duplicate.duplicate, true);
  assert.equal(state.outbox.length, 1);
});

test("outbox marks queued only after a broker confirm and database transaction", async () => {
  const outboxUpdates = [];
  const notificationUpdates = [];
  const row = {
    id: "outbox-1",
    notificationId: "notification-1",
    eventKey: "event-1",
    routingKey: "notification.sms",
    payload: { notificationId: "notification-1" },
    attemptCount: 0,
  };
  const client = {
    notificationOutbox: {
      findMany: async () => [row],
      updateMany: async ({ data }) => { outboxUpdates.push(data); return { count: 1 }; },
    },
    notification: { updateMany: async ({ data }) => { notificationUpdates.push(data); return { count: 1 }; } },
    $transaction: async (callback) => callback(client),
  };
  const channel = { publish: (_exchange, _route, _content, _options, confirm) => confirm(null) };

  const published = await publishPendingOutbox({ client, channel, now: new Date(1000) });
  assert.equal(published, 1);
  assert.equal(outboxUpdates.length, 2);
  assert.ok(outboxUpdates[0].leaseToken);
  assert.ok(outboxUpdates[1].publishedAt);
  assert.equal(notificationUpdates[0].status, "QUEUED");
});

test("retry scheduler atomically queues a due retry and creates a fresh outbox event", async () => {
  const updates = [];
  const outbox = [];
  const events = [];
  const notification = { id: "notification-2", channel: "EMAIL", attemptCount: 1, maxAttempts: 5 };
  const client = {
    notification: { findMany: async () => [notification], updateMany: async ({ data }) => { updates.push(data); return { count: 1 }; } },
    notificationOutbox: { create: async ({ data }) => { outbox.push(data); return data; } },
    notificationEvent: { create: async ({ data }) => { events.push(data); return data; } },
    $transaction: async (callback) => callback(client),
  };

  const scheduled = await scheduleDueRetries({ client, now: new Date(1000) });
  assert.equal(scheduled, 1);
  assert.equal(updates[0].status, "QUEUED");
  assert.equal(outbox[0].routingKey, "notification.email");
  assert.equal(events[0].eventType, "RETRY_QUEUED");
});

const createConsumerHarness = () => {
  const state = {
    notification: {
      id: "notification-3",
      channel: "SMS",
      status: "QUEUED",
      recipientAddress: "9800000000",
      payload: { text: "Test" },
      attemptCount: 0,
      maxAttempts: 3,
    },
    attempts: [],
    events: [],
    outbox: [],
  };
  const client = {
    notification: {
      updateMany: async ({ where, data }) => {
        if (where.status && state.notification.status !== where.status) return { count: 0 };
        if (where.claimToken && state.notification.claimToken !== where.claimToken) return { count: 0 };
        Object.assign(state.notification, data);
        return { count: 1 };
      },
      findUnique: async () => state.notification,
    },
    notificationAttempt: {
      create: async ({ data }) => { state.attempts.push(data); return data; },
      update: async ({ data }) => { Object.assign(state.attempts[0], data); return state.attempts[0]; },
    },
    notificationEvent: { create: async ({ data }) => { state.events.push(data); return data; } },
    notificationOutbox: { create: async ({ data }) => { state.outbox.push(data); return data; } },
    $transaction: async (callback) => callback(client),
  };
  const stateChanges = [];
  const channel = {
    ack: () => stateChanges.push("ACK"),
    nack: () => stateChanges.push("NACK"),
  };
  const message = { content: Buffer.from(JSON.stringify({ notificationId: state.notification.id })) };
  return { state, client, channel, message, stateChanges };
};

test("consumer records provider acceptance and acknowledges without claiming delivery", async () => {
  const harness = createConsumerHarness();
  let sends = 0;
  await processNotificationMessage({
    ...harness,
    providers: { sms: { send: async () => { sends += 1; return { provider: "SPARROW", status: "ACCEPTED", providerMessageId: "sms-1", providerStatus: "QUEUED" }; } } },
    retryConfig: enabledConfig.retry,
  });
  assert.equal(sends, 1);
  assert.equal(harness.state.notification.status, "ACCEPTED");
  assert.equal(harness.state.attempts[0].status, "ACCEPTED");
  assert.equal(harness.state.events[0].eventType, "PROVIDER_ACCEPTED");
  assert.deepEqual(harness.stateChanges, ["ACK"]);
});

test("ambiguous provider timeout is not retried automatically", async () => {
  const harness = createConsumerHarness();
  let sends = 0;
  await processNotificationMessage({
    ...harness,
    providers: { sms: { send: async () => { sends += 1; throw new NotificationProviderError("unknown provider outcome", { code: "SPARROW_TIMEOUT", category: "TIMEOUT", retryable: false }); } } },
    retryConfig: enabledConfig.retry,
  });
  assert.equal(sends, 1);
  assert.equal(harness.state.notification.status, "UNKNOWN");
  assert.equal(harness.state.notification.nextRetryAt, null);
  assert.equal(harness.state.outbox.length, 0);
  assert.deepEqual(harness.stateChanges, ["ACK"]);
});
