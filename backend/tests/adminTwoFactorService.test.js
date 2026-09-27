import assert from "node:assert/strict";
import test from "node:test";
import "dotenv/config";
import { verifyAccessToken, verifyRefreshToken } from "../services/tokenService.js";
import {
  createAdminTwoFactorChallenge,
  sendAdminTwoFactorCode,
  verifyAdminTwoFactorCode,
} from "../services/adminTwoFactorService.js";
import { decryptNotificationText } from "../utils/secureNotificationPayload.js";

const secret = "test-only-admin-2fa-secret-long-enough-for-hmac";
const environment = { OTP_SERVER_SECRET: secret, OTP_LENGTH: "6", OTP_EXPIRY_MINUTES: "5", OTP_MAX_ATTEMPTS: "5" };
const notificationConfig = {
  enabled: true,
  sms: { enabled: true },
  email: { enabled: true },
  retry: { maxAttempts: 5 },
};

const createHarness = () => {
  const state = {
    account: {
      id: "admin-account-1",
      email: "admin@example.test",
      phone: "+9779800000000",
      role: "ADMIN",
      status: "ACTIVE",
      adminProfile: { id: "admin-profile-1" },
    },
    challenge: null,
    notification: null,
    attempts: [],
    events: [],
    outbox: [],
    audit: [],
    sessions: [],
  };

  const matches = (where) => {
    if (where.id && where.id !== state.challenge?.id) return false;
    if (where.accountId && where.accountId !== state.challenge?.accountId) return false;
    if (where.status && where.status !== state.challenge?.status) return false;
    if (Object.hasOwn(where, "method") && where.method !== state.challenge?.method) return false;
    if (where.otpHash && where.otpHash !== state.challenge?.otpHash) return false;
    if (where.attemptCount !== undefined && where.attemptCount !== state.challenge?.attemptCount) return false;
    if (where.targetPortal && where.targetPortal !== state.challenge?.targetPortal) return false;
    if (where.expiresAt?.gt && state.challenge.expiresAt <= where.expiresAt.gt) return false;
    if (where.expiresAt?.lte && state.challenge.expiresAt > where.expiresAt.lte) return false;
    return Boolean(state.challenge);
  };

  const client = {
    authAccount: {
      findUnique: async () => state.account,
    },
    adminTwoFactorChallenge: {
      findUnique: async () => state.challenge && ({ ...state.challenge, account: state.account }),
      count: async () => 0,
      create: async ({ data }) => {
        state.challenge = {
          method: null,
          otpHash: null,
          attemptCount: 0,
          resendCount: 0,
          ...data,
        };
        return state.challenge;
      },
      updateMany: async ({ where, data }) => {
        if (!matches(where)) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          state.challenge[key] = value && typeof value === "object" && "increment" in value
            ? state.challenge[key] + value.increment
            : value;
        }
        return { count: 1 };
      },
    },
    notification: {
      findUnique: async () => null,
      create: async ({ data }) => {
        state.notification = { ...data };
        return state.notification;
      },
    },
    notificationEvent: { create: async ({ data }) => { state.events.push(data); return data; } },
    notificationOutbox: { create: async ({ data }) => { state.outbox.push(data); return data; } },
    authAuditLog: { create: async ({ data }) => { state.audit.push(data); return data; } },
    authSession: { createMany: async ({ data }) => { state.sessions.push(...data); return { count: data.length }; } },
    $transaction: async (callback) => callback(client),
  };
  return { state, client };
};

const createChallengeAndSendCode = async (harness, now = new Date()) => {
  const result = await createAdminTwoFactorChallenge({
    accountId: harness.state.account.id,
    ipAddress: "203.0.113.10",
    userAgent: "unit-test-agent",
  }, { client: harness.client, notificationConfig, env: environment, now });
  assert.deepEqual(result.availableMethods, ["SMS", "EMAIL"]);
  assert.equal(result.maskedPhone.endsWith("0000"), true);
  assert.equal(result.maskedEmail, "a****@example.test");

  const sent = await sendAdminTwoFactorCode({ challengeId: result.challengeId, method: "EMAIL" }, {
    client: harness.client,
    notificationConfig,
    env: environment,
    now: new Date(now.getTime() + 1000),
  });
  assert.deepEqual(sent, { queued: true, method: "EMAIL" });
  assert.equal(Object.hasOwn(harness.state.challenge, "otp"), false);
  const payloadText = JSON.stringify(harness.state.notification.payload);
  assert.equal(payloadText.includes("Your admin verification code is"), false);
  const message = decryptNotificationText(harness.state.notification.payload.secureContent, secret);
  const otp = message.match(/code is (\d{6})/)?.[1];
  assert.ok(otp);
  return { challengeId: result.challengeId, otp, now: new Date(now.getTime() + 2000) };
};

test("admin OTP is queued encrypted and verification creates MFA-marked sessions once", async () => {
  const harness = createHarness();
  const challenge = await createChallengeAndSendCode(harness);
  const result = await verifyAdminTwoFactorCode(challenge, {
    client: harness.client,
    env: environment,
    now: challenge.now,
  });

  assert.equal(result.account.role, "ADMIN");
  assert.equal(harness.state.challenge.status, "VERIFIED");
  assert.equal(harness.state.challenge.otpHash, null);
  assert.equal(harness.state.sessions.length, 2);
  assert.equal(verifyAccessToken(result.tokenPair.accessToken).mfa_verified, true);
  assert.equal(verifyRefreshToken(result.tokenPair.refreshToken).amr.includes("otp"), true);
  await assert.rejects(() => verifyAdminTwoFactorCode(challenge, {
    client: harness.client,
    env: environment,
    now: challenge.now,
  }), /Invalid or expired/);
});

test("invalid OTP attempts lock the challenge at the configured limit", async () => {
  const harness = createHarness();
  const challenge = await createChallengeAndSendCode(harness);
  const wrongOtp = challenge.otp === "000000" ? "000001" : "000000";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(() => verifyAdminTwoFactorCode({ ...challenge, otp: wrongOtp }, {
      client: harness.client,
      env: environment,
      now: challenge.now,
    }), /Invalid or expired/);
  }
  assert.equal(harness.state.challenge.status, "LOCKED");
  assert.equal(harness.state.challenge.attemptCount, 5);
  assert.equal(harness.state.sessions.length, 0);
});

test("concurrent valid OTP submissions can consume a challenge only once", async () => {
  const harness = createHarness();
  const challenge = await createChallengeAndSendCode(harness);
  const results = await Promise.allSettled([
    verifyAdminTwoFactorCode(challenge, { client: harness.client, env: environment, now: challenge.now }),
    verifyAdminTwoFactorCode(challenge, { client: harness.client, env: environment, now: challenge.now }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(harness.state.sessions.length, 2);
});