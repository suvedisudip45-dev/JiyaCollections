import assert from "node:assert/strict";
import test from "node:test";
import { inspectNotificationRuntime } from "../notifications/runtimeCheck.js";
import { QUEUE_NAMES } from "../notifications/constants.js";

const makeDependencies = ({
  queues = {},
  groupedStatuses = [],
  oldestOutstanding = null,
  databaseError = null,
} = {}) => {
  const checkedQueues = [];
  const closed = [];
  const config = {
    enabled: true,
    sms: { enabled: true },
    email: { enabled: false },
  };
  const broker = {
    channel: {
      checkQueue: async (name) => {
        checkedQueues.push(name);
        return queues[name] || { messageCount: 0, consumerCount: 0 };
      },
      close: async () => { closed.push("channel"); },
    },
    connection: {
      close: async () => { closed.push("connection"); },
    },
  };
  const client = {
    notification: {
      groupBy: async () => {
        if (databaseError) throw databaseError;
        return groupedStatuses;
      },
      findFirst: async () => oldestOutstanding,
    },
  };
  return {
    config,
    client,
    checkedQueues,
    closed,
    connectBroker: async () => broker,
  };
};

test("notification runtime check validates enabled consumers and reports backlog signals", async () => {
  const createdAt = new Date("2026-11-08T10:00:00.000Z");
  const dependencies = makeDependencies({
    queues: { [QUEUE_NAMES.SMS]: { messageCount: 4, consumerCount: 1 } },
    groupedStatuses: [
      { channel: "SMS", status: "UNKNOWN", _count: { _all: 2 } },
      { channel: "SMS", status: "QUEUED", _count: { _all: 4 } },
    ],
    oldestOutstanding: { createdAt },
  });

  const report = await inspectNotificationRuntime({
    ...dependencies,
    now: new Date("2026-11-08T10:01:30.000Z"),
  });

  assert.equal(report.ok, true);
  assert.deepEqual(dependencies.checkedQueues, [QUEUE_NAMES.SMS]);
  assert.deepEqual(report.broker.queues, [{
    channel: "SMS",
    name: QUEUE_NAMES.SMS,
    messageCount: 4,
    consumerCount: 1,
  }]);
  assert.equal(report.notifications.statusCounts["SMS:UNKNOWN"], 2);
  assert.equal(report.notifications.oldestOutstandingAgeSeconds, 90);
  assert.deepEqual(dependencies.closed, ["channel", "connection"]);
});

test("notification runtime check fails when an enabled channel has no worker consumer", async () => {
  const dependencies = makeDependencies({
    queues: { [QUEUE_NAMES.SMS]: { messageCount: 0, consumerCount: 0 } },
  });

  const report = await inspectNotificationRuntime(dependencies);

  assert.equal(report.ok, false);
  assert.deepEqual(dependencies.checkedQueues, [QUEUE_NAMES.SMS]);
  assert.equal(report.notifications.oldestOutstandingCreatedAt, null);
});

test("notification runtime check closes broker resources when database inspection fails", async () => {
  const dependencies = makeDependencies({ databaseError: new Error("database down") });

  await assert.rejects(inspectNotificationRuntime(dependencies), /database down/);

  assert.deepEqual(dependencies.closed, ["channel", "connection"]);
});

test("notification runtime check rejects disabled configuration", async () => {
  let brokerCalled = false;

  await assert.rejects(inspectNotificationRuntime({
    config: { enabled: false },
    connectBroker: async () => { brokerCalled = true; },
  }), /Notifications are not enabled/);

  assert.equal(brokerCalled, false);
});
