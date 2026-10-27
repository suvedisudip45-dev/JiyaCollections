import assert from "node:assert/strict";
import test from "node:test";
import { decryptNotificationText } from "../utils/secureNotificationPayload.js";
import {
  issueDistributorDeliveryOtp,
  verifyDistributorDeliveryOtp,
} from "../services/distributorDeliveryOtpService.js";

const secret = "delivery-otp-test-secret-with-at-least-32-characters";
const notificationConfig = {
  enabled: true,
  sms: { enabled: true },
  email: { enabled: false },
  retry: { maxAttempts: 5 },
};

const createHarness = ({ activeChallenge = null } = {}) => {
  const state = {
    challenge: activeChallenge,
    notification: null,
    events: [],
    outbox: [],
  };
  const tx = {
    orderAssignment: {
      findFirst: async () => ({
        id: "assignment-1",
        orderId: "order-1",
        distributorId: "distributor-1",
        deliveryType: "SELF_DELIVERY",
        status: "on_the_way",
      }),
    },
    deliveryOrder: { findUnique: async () => null },
    order: {
      findUnique: async () => ({
        id: "order-1",
        amount: 1500,
        deliveryFee: 100,
        payment: false,
        paymentMethod: "COD",
        address: { phone: "9800000000" },
      }),
    },
    deliveryOtpChallenge: {
      findUnique: async () => state.challenge,
      create: async ({ data }) => {
        state.challenge = { ...data };
        return state.challenge;
      },
      update: async ({ data }) => {
        Object.assign(state.challenge, data);
        return state.challenge;
      },
      updateMany: async ({ where, data }) => {
        if (
          !state.challenge ||
          state.challenge.id !== where.id ||
          state.challenge.status !== where.status ||
          state.challenge.activeOrderKey !== where.activeOrderKey ||
          (where.attemptCount !== undefined && state.challenge.attemptCount !== where.attemptCount)
        ) return { count: 0 };
        if (data.attemptCount?.increment) state.challenge.attemptCount += data.attemptCount.increment;
        if (data.status) state.challenge.status = data.status;
        if ("activeOrderKey" in data) state.challenge.activeOrderKey = data.activeOrderKey;
        if (data.verifiedAt) state.challenge.verifiedAt = data.verifiedAt;
        return { count: 1 };
      },
    },
    notification: {
      findUnique: async () => null,
      create: async ({ data }) => {
        state.notification = { ...data, id: "notification-1", status: "PENDING" };
        return state.notification;
      },
    },
    notificationEvent: {
      create: async ({ data }) => {
        state.events.push(data);
        return data;
      },
    },
    notificationOutbox: {
      create: async ({ data }) => {
        state.outbox.push(data);
        return data;
      },
    },
  };
  const client = {
    $transaction: async (callback) => callback(tx),
  };
  return { state, tx, client };
};

test("delivery OTP issues an encrypted SMS challenge bound to the distributor and COD amount", async () => {
  const previousSecret = process.env.OTP_SERVER_SECRET;
  process.env.OTP_SERVER_SECRET = secret;
  try {
    const harness = createHarness();
    const result = await issueDistributorDeliveryOtp({
      distributorId: "distributor-1",
      orderId: "order-1",
      client: harness.client,
      notificationConfig,
      otpConfig: { length: 6, expiryMinutes: 5 },
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.equal(result.success, true);
    assert.equal(result.expiresInSeconds, 300);
    assert.equal(harness.state.challenge.collectionAmount, "1500.00");
    assert.equal(harness.state.challenge.status, "PENDING");
    assert.equal(harness.state.challenge.activeOrderKey, "order-1:ACTIVE");
    assert.equal(harness.state.notification.notificationType, "DISTRIBUTOR_DELIVERY_OTP");
    assert.equal(harness.state.events[0].eventType, "CREATED");
    assert.equal(harness.state.outbox[0].routingKey, "notification.sms");

    const message = decryptNotificationText(harness.state.notification.payload.secureContent, secret);
    const code = message.match(/\b\d{6}\b/)?.[0];
    assert.ok(code);
    assert.doesNotMatch(JSON.stringify(harness.state.notification.payload), new RegExp(code));

    const verified = await verifyDistributorDeliveryOtp({
      tx: harness.tx,
      distributorId: "distributor-1",
      order: { id: "order-1", amount: 1500, deliveryFee: 100 },
      code,
      paymentMethod: "cash",
      now: new Date("2026-01-01T00:01:00.000Z"),
    });
    assert.equal(verified.verified, true);
    assert.equal(verified.paymentMethod, "CASH");
    assert.equal(harness.state.challenge.status, "VERIFIED");
    assert.equal(harness.state.challenge.activeOrderKey, null);
  } finally {
    if (previousSecret === undefined) delete process.env.OTP_SERVER_SECRET;
    else process.env.OTP_SERVER_SECRET = previousSecret;
  }
});

test("delivery OTP falls back to distributor collection confirmation when SMS is disabled", async () => {
  const harness = createHarness();
  const result = await issueDistributorDeliveryOtp({
    distributorId: "distributor-1",
    orderId: "order-1",
    client: harness.client,
    notificationConfig: {
      enabled: true,
      sms: { enabled: false },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.otpRequired, false);
  assert.match(result.message, /Confirm customer collection/);
  assert.equal(harness.state.challenge, null);
  assert.equal(harness.state.notification, null);
});

test("failed delivery OTP attempts are committed and become locked at the limit", async () => {
  const previousSecret = process.env.OTP_SERVER_SECRET;
  process.env.OTP_SERVER_SECRET = secret;
  try {
    const harness = createHarness({
      activeChallenge: {
        id: "challenge-1",
        distributorId: "distributor-1",
        status: "PENDING",
        activeOrderKey: "order-1:ACTIVE",
        collectionAmount: "1500.00",
        codeHash: "0".repeat(64),
        attemptCount: 4,
        maxAttempts: 5,
        expiresAt: new Date("2026-01-01T00:05:00.000Z"),
      },
    });
    const result = await verifyDistributorDeliveryOtp({
      tx: harness.tx,
      distributorId: "distributor-1",
      order: { id: "order-1", amount: 1500, deliveryFee: 100 },
      code: "111111",
      now: new Date("2026-01-01T00:01:00.000Z"),
    });
    assert.equal(result.error.code, "DELIVERY_OTP_LOCKED");
    assert.equal(harness.state.challenge.attemptCount, 5);
    assert.equal(harness.state.challenge.status, "LOCKED");
    assert.equal(harness.state.challenge.activeOrderKey, null);
  } finally {
    if (previousSecret === undefined) delete process.env.OTP_SERVER_SECRET;
    else process.env.OTP_SERVER_SECRET = previousSecret;
  }
});
