import assert from "node:assert/strict";
import test from "node:test";
import "dotenv/config";
import { generateRefreshToken, verifyAccessToken, verifyRefreshToken } from "../services/tokenService.js";
import { rotateRefreshToken } from "../services/authService.js";
import {
  createAdminTwoFactorChallenge,
  sendAdminTwoFactorCode,
  verifyAdminTwoFactorCode,
  createPortalTwoFactorChallenge,
  resendPortalTwoFactorCode,
  sendPortalTwoFactorCode,
  verifyPortalTwoFactorCode,
} from "../services/portalTwoFactorService.js";
import { requiresMfa } from "../security/mfaPolicy.js";
import { decryptNotificationText } from "../utils/secureNotificationPayload.js";

const secret = "test-only-admin-2fa-secret-long-enough-for-hmac";
const environment = {
  OTP_SERVER_SECRET: secret,
  OTP_LENGTH: "6",
  OTP_EXPIRY_MINUTES: "5",
  OTP_MAX_ATTEMPTS: "5",
  OTP_MAX_CHALLENGES_PER_WINDOW: "5",
  AUTH_LOGIN_IP_BUCKET_SIZE: "30",
  OTP_MAX_RESENDS: "3",
  OTP_RESEND_COOLDOWN_SECONDS: "30",
};
const notificationConfig = {
  enabled: true,
  sms: { enabled: true },
  email: { enabled: true },
  retry: { maxAttempts: 5 },
};

const createHarness = (role = "ADMIN") => {
  const state = {
    account: {
      id: `${role.toLowerCase()}-account-1`,
      email: "admin@example.test",
      phone: "+9779800000000",
      role,
      status: "ACTIVE",
      adminProfile: role === "ADMIN" ? { id: "admin-profile-1" } : null,
      marketingPartnerProfile: role === "MARKETING_PARTNER" ? { id: "marketing-profile-1" } : null,
      manufacturerProfile: role === "MANUFACTURER" ? { id: "manufacturer-profile-1" } : null,
    },
    challenge: null,
    notification: null,
    notifications: [],
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
    if (where.resendCount !== undefined && where.resendCount !== state.challenge?.resendCount) return false;
    if (Object.hasOwn(where, "notificationId") && where.notificationId !== state.challenge?.notificationId) return false;
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
        state.notifications.push(state.notification);
        return state.notification;
      },
      updateMany: async ({ where, data }) => {
        const notification = state.notifications.find(({ id }) => id === where.id);
        if (!notification) return { count: 0 };
        const allowedStatuses = where.status?.in;
        if (allowedStatuses && !allowedStatuses.includes(notification.status)) return { count: 0 };
        Object.assign(notification, data);
        return { count: 1 };
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

const createChallengeAndSendCode = async (harness, now = new Date(), portal = "ADMIN") => {
  const createChallenge = portal === "ADMIN" ? createAdminTwoFactorChallenge : createPortalTwoFactorChallenge;
  const sendCode = portal === "ADMIN" ? sendAdminTwoFactorCode : sendPortalTwoFactorCode;
  const result = await createChallenge({
    accountId: harness.state.account.id,
    portal,
    ipAddress: "203.0.113.10",
    userAgent: "unit-test-agent",
  }, { client: harness.client, notificationConfig, env: environment, now });
  assert.deepEqual(result.availableMethods, ["SMS", "EMAIL"]);
  assert.equal(result.maskedPhone.endsWith("0000"), true);
  assert.equal(result.maskedEmail, "a****@example.test");

  const sent = await sendCode({ challengeId: result.challengeId, method: "EMAIL" }, {
    client: harness.client,
    notificationConfig,
    env: environment,
    now: new Date(now.getTime() + 1000),
  });
  assert.equal(sent.queued, true);
  assert.equal(sent.method, "EMAIL");
  assert.ok(Date.parse(sent.expiresAt) > now.getTime());
  assert.ok(Date.parse(sent.resendAvailableAt) > now.getTime());
  assert.equal(Object.hasOwn(harness.state.challenge, "otp"), false);
  const payloadText = JSON.stringify(harness.state.notification.payload);
  assert.equal(payloadText.includes("Your admin verification code is"), false);
  const message = decryptNotificationText(harness.state.notification.payload.secureContent, secret);
  const otp = message.match(/code is (\d{6})/)?.[1];
  assert.ok(otp);
  return { challengeId: result.challengeId, otp, now: new Date(now.getTime() + 2000) };
};

test("Marketing Partner and Manufacturer challenges issue only portal-bound MFA sessions", async () => {
  for (const portal of ["MARKETING_PARTNER", "MANUFACTURER"]) {
    const harness = createHarness(portal);
    const challenge = await createChallengeAndSendCode(harness, new Date(), portal);
    const result = await verifyPortalTwoFactorCode(challenge, {
      client: harness.client,
      env: environment,
      now: challenge.now,
    });
    const claims = verifyAccessToken(result.tokenPair.accessToken);

    assert.equal(harness.state.challenge.targetPortal, portal);
    assert.equal(result.account.role, portal);
    assert.equal(claims.role, portal);
    assert.equal(claims.mfa_verified, true);
    assert.deepEqual(claims.amr, ["pwd", "otp"]);
  }
});

test("OTP challenge limits are per account and allow up to the configured IP limit", async () => {
  const otherAccountHarness = createHarness("ADMIN");
  let ipChallenges = 5;
  otherAccountHarness.client.adminTwoFactorChallenge.count = async ({ where }) =>
    Object.hasOwn(where, "accountId") ? 0 : ipChallenges;

  const created = await createPortalTwoFactorChallenge({
    accountId: otherAccountHarness.state.account.id,
    portal: "ADMIN",
    ipAddress: "203.0.113.10",
  }, { client: otherAccountHarness.client, notificationConfig, env: environment });
  assert.ok(created.challengeId);

  const sameAccountHarness = createHarness("ADMIN");
  sameAccountHarness.client.adminTwoFactorChallenge.count = async () => 5;
  await assert.rejects(() => createPortalTwoFactorChallenge({
    accountId: sameAccountHarness.state.account.id,
    portal: "ADMIN",
    ipAddress: "203.0.113.10",
  }, { client: sameAccountHarness.client, notificationConfig, env: environment }),
  (error) => error.code === "ADMIN_2FA_RATE_LIMITED");

  ipChallenges = 30;
  const ipLimitedHarness = createHarness("ADMIN");
  ipLimitedHarness.client.adminTwoFactorChallenge.count = async ({ where }) =>
    Object.hasOwn(where, "accountId") ? 0 : ipChallenges;
  await assert.rejects(() => createPortalTwoFactorChallenge({
    accountId: ipLimitedHarness.state.account.id,
    portal: "ADMIN",
    ipAddress: "203.0.113.10",
  }, { client: ipLimitedHarness.client, notificationConfig, env: environment }),
  (error) => error.code === "ADMIN_2FA_RATE_LIMITED");
});

test("MFA policy excludes Customer and rejects cross-portal challenge binding", async () => {
  assert.equal(requiresMfa("CUSTOMER"), false);
  assert.equal(requiresMfa("MARKETING_PARTNER"), true);

  const harness = createHarness("MANUFACTURER");
  const challenge = await createChallengeAndSendCode(harness, new Date(), "MANUFACTURER");
  harness.state.challenge.targetPortal = "ADMIN";
  await assert.rejects(() => verifyPortalTwoFactorCode(challenge, {
    client: harness.client,
    env: environment,
    now: challenge.now,
  }), /Invalid or expired/);
  assert.equal(harness.state.sessions.length, 0);
});

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

test("resend invalidates the previous OTP and cancels its queued notification", async () => {
  const harness = createHarness("MARKETING_PARTNER");
  const challenge = await createChallengeAndSendCode(harness, new Date(), "MARKETING_PARTNER");
  const oldNotification = harness.state.notification;
  const resendAt = new Date(challenge.now.getTime() + 28_000);
  await assert.rejects(() => resendPortalTwoFactorCode({ challengeId: challenge.challengeId }, {
    client: harness.client,
    notificationConfig,
    env: environment,
    now: resendAt,
  }), (error) => error.code === "PORTAL_2FA_RESEND_COOLDOWN");

  const resent = await resendPortalTwoFactorCode({ challengeId: challenge.challengeId }, {
    client: harness.client,
    notificationConfig,
    env: environment,
    now: new Date(challenge.now.getTime() + 29_000),
  });
  assert.equal(resent.queued, true);
  assert.equal(harness.state.challenge.resendCount, 1);
  assert.equal(oldNotification.status, "CANCELLED");
  const newOtpMessage = decryptNotificationText(harness.state.notification.payload.secureContent, secret);
  const newOtp = newOtpMessage.match(/code is (\d{6})/)?.[1];
  assert.ok(newOtp);
  assert.notEqual(newOtp, challenge.otp);

  await assert.rejects(() => verifyPortalTwoFactorCode({
    challengeId: challenge.challengeId,
    otp: challenge.otp,
  }, {
    client: harness.client,
    env: environment,
    now: new Date(challenge.now.getTime() + 30_000),
  }), /Invalid or expired/);
  const verified = await verifyPortalTwoFactorCode({ challengeId: challenge.challengeId, otp: newOtp }, {
    client: harness.client,
    env: environment,
    now: new Date(challenge.now.getTime() + 30_000),
  });
  assert.equal(verified.account.role, "MARKETING_PARTNER");
});

test("password-only refresh tokens cannot bypass MFA for privileged portals", async () => {
  for (const role of ["ADMIN", "MARKETING_PARTNER", "MANUFACTURER"]) {
    const refreshToken = generateRefreshToken({
      accountId: `${role.toLowerCase()}-refresh-account`,
      profileId: `${role.toLowerCase()}-refresh-profile`,
      role,
      tokenFamilyId: `${role.toLowerCase()}-refresh-family`,
    });
    await assert.rejects(() => rotateRefreshToken({
      refreshToken,
      targetPortal: role,
    }), (error) => error.code === `${role}_MFA_REQUIRED`);
  }
});

test("OTP generation does not repeat a fixed code", async () => {
  const codes = [];
  for (let index = 0; index < 8; index += 1) {
    const harness = createHarness();
    const created = await createChallengeAndSendCode(
      harness,
      new Date(Date.UTC(2026, 0, 1, 0, index)),
    );
    codes.push(created.otp);
  }
  assert.ok(new Set(codes).size > 1);
});

test("legacy Admin challenge functions reject Marketing Partner challenges", async () => {
  const harness = createHarness("MARKETING_PARTNER");
  const created = await createPortalTwoFactorChallenge({
    accountId: harness.state.account.id,
    portal: "MARKETING_PARTNER",
  }, { client: harness.client, notificationConfig, env: environment });
  await assert.rejects(() => sendAdminTwoFactorCode({
    challengeId: created.challengeId,
    method: "EMAIL",
  }, { client: harness.client, notificationConfig, env: environment }), /Invalid or expired/);

  const challenge = await createChallengeAndSendCode(harness, new Date(), "MARKETING_PARTNER");
  await assert.rejects(() => verifyAdminTwoFactorCode(challenge, {
    client: harness.client,
    env: environment,
    now: challenge.now,
  }), /Invalid or expired/);
});