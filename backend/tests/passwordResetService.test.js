import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import {
  completePasswordReset,
  generatePasswordResetOtp,
  requestPasswordResetOtp as requestPasswordResetOtpService,
  resendPasswordResetOtp,
  verifyPasswordResetOtp,
} from "../services/passwordResetService.js";

const SECRET = "password-reset-test-secret-with-more-than-32-characters";
const TEST_OTP = "01234567";
const TEST_ENV = { OTP_SERVER_SECRET: SECRET, OTP_LENGTH: "6", OTP_EXPIRY_MINUTES: "5", NODE_ENV: "test" };
const NOTIFICATION_CONFIG = {
  enabled: true,
  sms: { enabled: true },
  retry: { maxAttempts: 3 },
};

const requestPasswordResetOtp = (input) => requestPasswordResetOtpService({
  otpGenerator: () => TEST_OTP,
  ...input,
});

const makeClient = () => {
  const account = {
    id: "account-1",
    email: "customer@example.test",
    phone: "9812345678",
    role: "CUSTOMER",
    status: "ACTIVE",
    customerProfile: { id: "customer-profile-1", isDisabled: false },
    manufacturerProfile: null,
    distributorProfile: null,
    deliveryDriverProfile: null,
    roleMappings: [],
    passwordResetLastRequestedAt: null,
    passwordResetMonthlyKey: null,
    passwordResetMonthlyCount: 0,
    passwordHash: "old-hash",
  };
  const challenges = new Map();
  const sessions = [{ accountId: account.id, revokedAt: null }];
  let notificationNumber = 0;
  const notifications = new Map();
  const auditEvents = [];
  const authAuditLog = { create: async ({ data }) => { auditEvents.push(data); return { id: "audit-1" }; } };
  const notification = {
    findUnique: async ({ where }) => [...notifications.values()].find((item) => item.idempotencyKey === where.idempotencyKey) || null,
    create: async ({ data }) => {
      const created = { ...data, id: `notification-${++notificationNumber}` };
      notifications.set(created.id, created);
      return created;
    },
    updateMany: async ({ where, data }) => {
      const item = notifications.get(where.id);
      if (!item || (where.status?.in && !where.status.in.includes(item.status))) return { count: 0 };
      Object.assign(item, data);
      return { count: 1 };
    },
  };
  const notificationEvent = { create: async () => ({ id: "event-1" }) };
  const notificationOutbox = { create: async () => ({ id: "outbox-1" }) };
  const systemAuditOutbox = { create: async ({ data }) => ({ id: data.id }) };

  const challengeClient = {
    create: async ({ data }) => {
      const challenge = {
        resendCount: 0,
        notificationId: null,
        consumedAt: null,
        verifiedAt: null,
        ...data,
        updatedAt: new Date(),
      };
      challenges.set(challenge.id, challenge);
      return challenge;
    },
    update: async ({ where, data }) => {
      const challenge = challenges.get(where.id);
      Object.assign(challenge, data);
      return challenge;
    },
    findUnique: async ({ where, include }) => {
      const challenge = challenges.get(where.id);
      if (!challenge) return null;
      return include?.account ? { ...challenge, account } : challenge;
    },
    updateMany: async ({ where, data }) => {
      const matches = (challenge) => Object.entries(where).every(([key, value]) => {
        if (key === "expiresAt") {
          if (value.gt && challenge.expiresAt <= value.gt) return false;
          if (value.lte && challenge.expiresAt > value.lte) return false;
          return true;
        }
        return challenge[key] === value;
      });
      let count = 0;
      for (const challenge of challenges.values()) {
        if (!matches(challenge)) continue;
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "increment" in value) {
            challenge[key] = Number(challenge[key] || 0) + value.increment;
          } else {
            challenge[key] = value;
          }
        }
        count += 1;
      }
      return { count };
    },
  };

  const authAccount = {
    findUnique: async () => account,
    updateMany: async ({ where, data }) => {
      const accountLastRequested = account.passwordResetLastRequestedAt;
      const expectedLastRequested = where.passwordResetLastRequestedAt;
      if (
        (accountLastRequested === null) !== (expectedLastRequested === null) ||
        (accountLastRequested && accountLastRequested.getTime() !== expectedLastRequested.getTime()) ||
        account.passwordResetMonthlyKey !== where.passwordResetMonthlyKey ||
        account.passwordResetMonthlyCount !== where.passwordResetMonthlyCount
      ) return { count: 0 };
      Object.assign(account, data);
      return { count: 1 };
    },
    update: async ({ data }) => {
      Object.assign(account, data);
      return account;
    },
  };
  const authSession = {
    updateMany: async ({ data }) => {
      for (const session of sessions) {
        if (session.accountId === account.id && session.revokedAt === null) Object.assign(session, data);
      }
      return { count: sessions.length };
    },
  };
  const tx = {
    authAccount,
    authSession,
    deliveryDriver: {
      findUnique: async () => account.deliveryDriverProfile,
    },
    adminTwoFactorChallenge: challengeClient,
    authAuditLog,
    notification,
    notificationEvent,
    notificationOutbox,
    systemAuditOutbox,
  };
  const client = {
    ...tx,
    $transaction: async (callback) => {
      const challengeSnapshot = new Map([...challenges].map(([id, challenge]) => [id, { ...challenge }]));
      const accountSnapshot = { ...account };
      const sessionSnapshot = sessions.map((session) => ({ ...session }));
      const notificationSnapshot = new Map([...notifications].map(([id, item]) => [id, { ...item }]));
      const auditLength = auditEvents.length;
      const notificationNumberSnapshot = notificationNumber;
      try {
        return await callback(tx);
      } catch (error) {
        challenges.clear();
        for (const [id, challenge] of challengeSnapshot) challenges.set(id, challenge);
        Object.assign(account, accountSnapshot);
        sessions.splice(0, sessions.length, ...sessionSnapshot);
        notifications.clear();
        for (const [id, item] of notificationSnapshot) notifications.set(id, item);
        auditEvents.splice(auditLength);
        notificationNumber = notificationNumberSnapshot;
        throw error;
      }
    },
  };
  return { client, account, challenges, sessions, notifications, auditEvents };
};

test("password recovery creates an SMS-only OTP challenge with a masked contact", async () => {
  const { client, account, challenges, notifications, auditEvents } = makeClient();
  const result = await requestPasswordResetOtp({
    email: "CUSTOMER@example.test",
    phone: "+977 9812345678",
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:00:00.000Z"),
  });

  assert.equal(result.maskedPhone, "98******78");
  assert.match(result.message, /If an eligible account matches/);
  assert.equal(challenges.get(result.challengeId).purpose, "PASSWORD_RESET");
  assert.equal(challenges.get(result.challengeId).method, "SMS");
  assert.match(challenges.get(result.challengeId).otpHash, /^[0-9a-f]{64}$/);
  assert.equal(challenges.get(result.challengeId).otpHash.includes(TEST_OTP), false);
  assert.equal(JSON.stringify(notifications.get(challenges.get(result.challengeId).notificationId).payload).includes(TEST_OTP), false);
  assert.equal(JSON.stringify(auditEvents).includes(TEST_OTP), false);
  assert.equal(account.passwordResetLastRequestedAt.toISOString(), "2026-10-15T10:00:00.000Z");
  assert.equal(account.passwordResetMonthlyCount, 1);
});

test("password recovery generates unpredictable eight-digit OTPs", () => {
  const generated = new Set(Array.from({ length: 64 }, () => generatePasswordResetOtp()));
  assert.equal(generated.size, 64);
  for (const otp of generated) assert.match(otp, /^\d{8}$/);
  assert.equal(generated.has("11111111"), false);
});

test("separate reset challenges use distinct injected OTPs and persist challenge-bound hashes", async () => {
  const first = makeClient();
  const second = makeClient();
  const now = new Date("2026-10-15T10:00:00.000Z");
  const firstRequest = await requestPasswordResetOtp({
    email: first.account.email,
    phone: first.account.phone,
    portal: "CUSTOMER",
    client: first.client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now,
    otpGenerator: () => "00000001",
  });
  const secondRequest = await requestPasswordResetOtp({
    email: second.account.email,
    phone: second.account.phone,
    portal: "CUSTOMER",
    client: second.client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now,
    otpGenerator: () => "99999999",
  });
  const firstChallenge = first.challenges.get(firstRequest.challengeId);
  const secondChallenge = second.challenges.get(secondRequest.challengeId);

  assert.notEqual(firstChallenge.otpHash, secondChallenge.otpHash);
  assert.notEqual(firstChallenge.otpHash, "00000001");
  assert.notEqual(secondChallenge.otpHash, "99999999");
  assert.equal(JSON.stringify(first.notifications.get(firstChallenge.notificationId).payload).includes("00000001"), false);
  assert.equal(JSON.stringify(second.notifications.get(secondChallenge.notificationId).payload).includes("99999999"), false);
});

test("production driver recovery requires an explicit feature flag and full rate-limit configuration", async () => {
  const { client } = makeClient();
  const restrictedEnv = { ...TEST_ENV, NODE_ENV: "production", OTP_LENGTH: "8" };
  for (const environment of ["production", "staging", undefined]) {
    restrictedEnv.NODE_ENV = environment;
    await assert.rejects(
      requestPasswordResetOtp({
        email: "customer@example.test",
        phone: "9812345678",
        portal: "CUSTOMER",
        client,
        notificationConfig: NOTIFICATION_CONFIG,
        env: restrictedEnv,
        now: new Date("2026-10-15T10:00:00.000Z"),
      }),
      { code: "PASSWORD_RESET_DISABLED", statusCode: 503 },
    );
  }
  const enabledButUnconfigured = {
    ...TEST_ENV,
    NODE_ENV: "production",
    PASSWORD_RESET_DRIVER_ENABLED: "true",
  };
  await assert.rejects(
    requestPasswordResetOtp({
      email: "customer@example.test",
      phone: "9812345678",
      portal: "DRIVER",
      client,
      notificationConfig: NOTIFICATION_CONFIG,
      env: enabledButUnconfigured,
    }),
    { code: "PASSWORD_RESET_NOT_CONFIGURED", statusCode: 503 },
  );
  await assert.rejects(
    requestPasswordResetOtp({
      email: "customer@example.test",
      phone: "9812345678",
      portal: "DRIVER",
      client,
      notificationConfig: NOTIFICATION_CONFIG,
      env: { ...enabledButUnconfigured, NODE_ENV: undefined },
    }),
    { code: "PASSWORD_RESET_DISABLED", statusCode: 503 },
  );
  for (const environment of ["production", "staging", undefined]) {
    restrictedEnv.NODE_ENV = environment;
    await assert.rejects(
      verifyPasswordResetOtp({
        challengeId: "123e4567-e89b-12d3-a456-426614174000",
        otp: TEST_OTP,
        portal: "CUSTOMER",
        client,
        env: restrictedEnv,
      }),
      { code: "PASSWORD_RESET_DISABLED", statusCode: 503 },
    );
    await assert.rejects(
      completePasswordReset({
        challengeId: "123e4567-e89b-12d3-a456-426614174000",
        tfaToken: "unused",
        newPassword: "StrongPass123!",
        confirmPassword: "StrongPass123!",
        portal: "CUSTOMER",
        client,
        env: restrictedEnv,
      }),
      { code: "PASSWORD_RESET_DISABLED", statusCode: 503 },
    );
  }
});

test("configured production driver recovery completes through the normal reset flow", async () => {
  const { client, account, challenges, sessions } = makeClient();
  account.role = "DRIVER";
  account.customerProfile = null;
  account.deliveryDriverProfile = {
    id: "driver-profile-1",
    accountId: account.id,
    status: "ACTIVE",
    distributor: { id: "distributor-1", status: "ACTIVE", isActive: true },
  };
  account.roleMappings = [
    { isActive: true, role: { code: "DRIVER", isActive: true } },
  ];
  const productionEnv = {
    ...TEST_ENV,
    NODE_ENV: "production",
    PASSWORD_RESET_DRIVER_ENABLED: "true",
    PASSWORD_RESET_MAX_ATTEMPTS: "5",
    PASSWORD_RESET_MAX_RESENDS: "3",
    PASSWORD_RESET_RESEND_COOLDOWN_SECONDS: "60",
    PASSWORD_RESET_TFA_TOKEN_LIFETIME_MINUTES: "5",
    AUTH_RATE_LIMIT_WINDOW_MS: "900000",
    AUTH_PASSWORD_RESET_REQUEST_IP_BUCKET_SIZE: "10",
    AUTH_PASSWORD_RESET_VERIFY_IP_BUCKET_SIZE: "10",
    AUTH_PASSWORD_RESET_COMPLETE_IP_BUCKET_SIZE: "10",
  };
  const request = await requestPasswordResetOtp({
    email: account.email,
    phone: account.phone,
    portal: "DRIVER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: productionEnv,
    now: new Date("2026-10-15T10:00:00.000Z"),
  });
  const verified = await verifyPasswordResetOtp({
    challengeId: request.challengeId,
    otp: TEST_OTP,
    portal: "DRIVER",
    client,
    env: productionEnv,
    now: new Date("2026-10-15T10:01:00.000Z"),
  });
  await completePasswordReset({
    challengeId: request.challengeId,
    tfaToken: verified.tfaToken,
    newPassword: "a-new-driver-password",
    confirmPassword: "a-new-driver-password",
    portal: "DRIVER",
    client,
    env: productionEnv,
    now: new Date("2026-10-15T10:02:00.000Z"),
  });
  assert.equal(challenges.get(request.challengeId).status, "COMPLETED");
  assert.equal(sessions[0].revocationReason, "PASSWORD_RESET");
});

test("password recovery attempt and TFA token limits use environment configuration", async () => {
  const { client, challenges } = makeClient();
  const configuredEnv = {
    ...TEST_ENV,
    PASSWORD_RESET_MAX_ATTEMPTS: "3",
    PASSWORD_RESET_TFA_TOKEN_LIFETIME_MINUTES: "2",
  };
  const request = await requestPasswordResetOtp({
    email: "customer@example.test",
    phone: "9812345678",
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: configuredEnv,
    now: new Date("2026-10-15T10:00:00.000Z"),
  });
  assert.equal(challenges.get(request.challengeId).maxAttempts, 3);

  const verified = await verifyPasswordResetOtp({
    challengeId: request.challengeId,
    otp: TEST_OTP,
    portal: "CUSTOMER",
    client,
    env: configuredEnv,
    now: new Date("2026-10-15T10:01:00.000Z"),
  });
  assert.equal(verified.expiresAt, "2026-10-15T10:03:00.000Z");
  assert.equal(challenges.get(request.challengeId).expiresAt.toISOString(), verified.expiresAt);
});

test("password recovery returns indistinguishable results for eligible and ineligible accounts", async () => {
  const now = new Date("2026-10-15T10:00:00.000Z");
  const active = makeClient();
  const activeResult = await requestPasswordResetOtp({
    email: "customer@example.test",
    phone: "9812345678",
    portal: "CUSTOMER",
    client: active.client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now,
  });

  const missing = makeClient();
  missing.client.authAccount.findUnique = async () => null;
  const missingResult = await requestPasswordResetOtp({
    email: "customer@example.test",
    phone: "9812345678",
    portal: "CUSTOMER",
    client: missing.client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now,
  });
  assert.deepEqual(
    [missingResult.message, missingResult.maskedPhone, missingResult.otpLength, missingResult.expiresAt],
    [activeResult.message, activeResult.maskedPhone, activeResult.otpLength, activeResult.expiresAt],
  );
  assert.notEqual(missingResult.challengeId, activeResult.challengeId);
  assert.equal(missing.challenges.size, 0);

  const mismatch = makeClient();
  const mismatchResult = await requestPasswordResetOtp({
    email: "different@example.test",
    phone: "9812345678",
    portal: "CUSTOMER",
    client: mismatch.client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now,
  });
  assert.deepEqual(
    [mismatchResult.message, mismatchResult.maskedPhone, mismatchResult.otpLength, mismatchResult.expiresAt],
    [activeResult.message, activeResult.maskedPhone, activeResult.otpLength, activeResult.expiresAt],
  );
  assert.equal(mismatch.challenges.size, 0);
});

test("password recovery enforces one request per account every rolling seven days before issuing an OTP", async () => {
  const { client, challenges } = makeClient();
  const request = {
    phone: "9812345678",
    email: "customer@example.test",
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:00:00.000Z"),
  };
  const first = await requestPasswordResetOtp(request);
  const secondWithinCooldown = await requestPasswordResetOtp({
    ...request,
    now: new Date("2026-10-21T10:00:00.000Z"),
  });
  assert.equal(secondWithinCooldown.message, first.message);
  assert.notEqual(secondWithinCooldown.challengeId, first.challengeId);
  assert.equal(challenges.size, 1);
  assert.equal((await client.authAccount.findUnique()).passwordResetMonthlyCount, 1);

  const nextWeek = await requestPasswordResetOtp({
    ...request,
    now: new Date("2026-10-22T10:00:00.000Z"),
  });
  assert.notEqual(nextWeek.challengeId, first.challengeId);
  assert.equal(challenges.size, 2);
});

test("password recovery enforces three requests per account per UTC month before issuing an OTP", async () => {
  const { client, challenges } = makeClient();
  for (const day of [1, 8, 15]) {
    await requestPasswordResetOtp({
      phone: "9812345678",
      email: "customer@example.test",
      portal: "CUSTOMER",
      client,
      notificationConfig: NOTIFICATION_CONFIG,
      env: TEST_ENV,
      now: new Date(`2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`),
    });
  }
  const throttled = await requestPasswordResetOtp({
    phone: "9812345678",
    email: "customer@example.test",
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now: new Date("2026-10-22T10:00:00.000Z"),
  });
  assert.match(throttled.message, /If an eligible account matches/);
  assert.equal(challenges.size, 3);
  assert.equal((await client.authAccount.findUnique()).passwordResetMonthlyCount, 3);
});

test("expired password reset OTPs are invalidated and their hashes cleared", async () => {
  const { client, challenges } = makeClient();
  const request = await requestPasswordResetOtp({
    email: "customer@example.test",
    phone: "9812345678",
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:00:00.000Z"),
  });

  await assert.rejects(
    verifyPasswordResetOtp({
      challengeId: request.challengeId,
      otp: TEST_OTP,
      portal: "CUSTOMER",
      client,
      env: TEST_ENV,
      now: new Date("2026-10-15T10:06:00.000Z"),
    }),
    { code: "PASSWORD_RESET_OTP_INVALID", statusCode: 401 },
  );
  assert.equal(challenges.get(request.challengeId).status, "EXPIRED");
  assert.equal(challenges.get(request.challengeId).otpHash, null);
});

test("a password-recovery OTP cannot be verified against an MFA challenge", async () => {
  const { client, challenges } = makeClient();
  const challengeId = "123e4567-e89b-12d3-a456-426614174000";
  challenges.set(challengeId, {
    id: challengeId,
    accountId: "account-1",
    targetPortal: "CUSTOMER",
    purpose: "CUSTOMER_LOGIN",
    method: "SMS",
    otpHash: "a".repeat(64),
    status: "PENDING",
    attemptCount: 0,
    maxAttempts: 5,
    expiresAt: new Date("2026-10-15T10:05:00.000Z"),
  });

  await assert.rejects(
    verifyPasswordResetOtp({
      challengeId,
      otp: TEST_OTP,
      portal: "CUSTOMER",
      client,
      env: TEST_ENV,
      now: new Date("2026-10-15T10:01:00.000Z"),
    }),
    { code: "PASSWORD_RESET_OTP_INVALID", statusCode: 401 },
  );
  assert.equal(challenges.get(challengeId).attemptCount, 0);
});

test("wrong reset OTP attempts are atomically counted and lock at the challenge limit", async () => {
  const { client, challenges } = makeClient();
  const env = { ...TEST_ENV, PASSWORD_RESET_MAX_ATTEMPTS: "2" };
  const request = await requestPasswordResetOtp({
    email: "customer@example.test",
    phone: "9812345678",
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      verifyPasswordResetOtp({
        challengeId: request.challengeId,
        otp: "99999999",
        portal: "CUSTOMER",
        client,
        env,
      }),
      { code: "PASSWORD_RESET_OTP_INVALID", statusCode: 401 },
    );
  }
  assert.equal(challenges.get(request.challengeId).attemptCount, 2);
  assert.equal(challenges.get(request.challengeId).status, "LOCKED");
  assert.equal(challenges.get(request.challengeId).otpHash, null);
  await assert.rejects(
    verifyPasswordResetOtp({
      challengeId: request.challengeId,
      otp: TEST_OTP,
      portal: "CUSTOMER",
      client,
      env,
    }),
    { code: "PASSWORD_RESET_OTP_INVALID", statusCode: 401 },
  );
});

test("concurrent verification can consume one OTP only once", async () => {
  const { client, challenges } = makeClient();
  const request = await requestPasswordResetOtp({
    email: "customer@example.test",
    phone: "9812345678",
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
  });
  const results = await Promise.allSettled([
    verifyPasswordResetOtp({ challengeId: request.challengeId, otp: TEST_OTP, portal: "CUSTOMER", client, env: TEST_ENV }),
    verifyPasswordResetOtp({ challengeId: request.challengeId, otp: TEST_OTP, portal: "CUSTOMER", client, env: TEST_ENV }),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(challenges.get(request.challengeId).status, "VERIFIED");
});

test("resend respects cooldown, invalidates the old OTP, and queues a fresh code", async () => {
  const { client, challenges, notifications } = makeClient();
  const requestedAt = new Date("2026-10-15T10:00:00.000Z");
  const request = await requestPasswordResetOtp({
    email: "customer@example.test",
    phone: "9812345678",
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now: requestedAt,
  });
  const challenge = challenges.get(request.challengeId);
  const originalHash = challenge.otpHash;
  const originalNotificationId = challenge.notificationId;

  const earlyResend = await resendPasswordResetOtp({
    challengeId: request.challengeId,
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now: new Date(requestedAt.getTime() + 30_000),
    otpGenerator: () => "87654321",
  });
  assert.equal(earlyResend.message, "If the request is valid and outside its cooldown, a new code will be sent.");
  assert.equal(challenge.otpHash, originalHash);
  assert.equal(notifications.size, 1);

  await resendPasswordResetOtp({
    challengeId: request.challengeId,
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now: new Date(requestedAt.getTime() + 61_000),
    otpGenerator: () => "87654321",
  });
  assert.notEqual(challenge.otpHash, originalHash);
  assert.equal(challenge.resendCount, 1);
  assert.equal(notifications.get(originalNotificationId).status, "CANCELLED");
  assert.equal(notifications.size, 2);

  await assert.rejects(
    verifyPasswordResetOtp({
      challengeId: request.challengeId,
      otp: TEST_OTP,
      portal: "CUSTOMER",
      client,
      env: TEST_ENV,
      now: new Date(requestedAt.getTime() + 62_000),
    }),
    { code: "PASSWORD_RESET_OTP_INVALID", statusCode: 401 },
  );
  const verified = await verifyPasswordResetOtp({
    challengeId: request.challengeId,
    otp: "87654321",
    portal: "CUSTOMER",
    client,
    env: TEST_ENV,
    now: new Date(requestedAt.getTime() + 63_000),
  });
  assert.ok(verified.tfaToken);
});

test("password recovery enforces the configured resend limit", async () => {
  const { client, challenges, notifications } = makeClient();
  const env = { ...TEST_ENV, PASSWORD_RESET_MAX_RESENDS: "1" };
  const requestedAt = new Date("2026-10-15T10:00:00.000Z");
  const request = await requestPasswordResetOtp({
    email: "customer@example.test",
    phone: "9812345678",
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env,
    now: requestedAt,
  });
  const challenge = challenges.get(request.challengeId);

  await resendPasswordResetOtp({
    challengeId: request.challengeId,
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env,
    now: new Date(requestedAt.getTime() + 61_000),
    otpGenerator: () => "87654321",
  });
  const hashAfterAllowedResend = challenge.otpHash;

  await resendPasswordResetOtp({
    challengeId: request.challengeId,
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env,
    now: new Date(requestedAt.getTime() + 122_000),
    otpGenerator: () => "12345678",
  });
  assert.equal(challenge.resendCount, 1);
  assert.equal(challenge.otpHash, hashAfterAllowedResend);
  assert.equal(notifications.size, 2);
});

test("failed notification enqueue rolls back the challenge and account quota", async () => {
  const { client, account, challenges } = makeClient();
  client.notification.create = async () => {
    throw new Error("notification enqueue failed");
  };
  await assert.rejects(
    requestPasswordResetOtp({
      email: account.email,
      phone: account.phone,
      portal: "CUSTOMER",
      client,
      notificationConfig: NOTIFICATION_CONFIG,
      env: TEST_ENV,
    }),
    /notification enqueue failed/,
  );
  assert.equal(challenges.size, 0);
  assert.equal(account.passwordResetLastRequestedAt, null);
  assert.equal(account.passwordResetMonthlyCount, 0);
});

test("verified OTP issues a TFA token and the password reset consumes it once", async () => {
  const { client, challenges, account, sessions } = makeClient();
  const request = await requestPasswordResetOtp({
    email: "customer@example.test",
    phone: "9812345678",
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:00:00.000Z"),
  });
  const verified = await verifyPasswordResetOtp({
    challengeId: request.challengeId,
    otp: TEST_OTP,
    portal: "CUSTOMER",
    client,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:01:00.000Z"),
  });

  assert.ok(verified.tfaToken);
  assert.equal(challenges.get(request.challengeId).status, "VERIFIED");
  await completePasswordReset({
    challengeId: request.challengeId,
    tfaToken: verified.tfaToken,
    newPassword: "a-new-secure-password",
    confirmPassword: "a-new-secure-password",
    portal: "CUSTOMER",
    client,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:02:00.000Z"),
  });

  assert.equal(challenges.get(request.challengeId).status, "COMPLETED");
  assert.equal(challenges.get(request.challengeId).consumedAt.toISOString(), "2026-10-15T10:02:00.000Z");
  assert.equal(await bcrypt.compare("a-new-secure-password", account.passwordHash), true);
  assert.equal(sessions[0].revocationReason, "PASSWORD_RESET");
  await assert.rejects(
    completePasswordReset({
      challengeId: request.challengeId,
      tfaToken: verified.tfaToken,
      newPassword: "another-secure-password",
      confirmPassword: "another-secure-password",
      portal: "CUSTOMER",
      client,
      env: TEST_ENV,
      now: new Date("2026-10-15T10:03:00.000Z"),
    }),
    { code: "PASSWORD_RESET_TFA_INVALID", statusCode: 401 },
  );
});

test("reset tokens expire before password completion", async () => {
  const { client, challenges, account } = makeClient();
  const request = await requestPasswordResetOtp({
    email: account.email,
    phone: account.phone,
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:00:00.000Z"),
  });
  const verified = await verifyPasswordResetOtp({
    challengeId: request.challengeId,
    otp: TEST_OTP,
    portal: "CUSTOMER",
    client,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:00:00.000Z"),
  });

  await assert.rejects(
    completePasswordReset({
      challengeId: request.challengeId,
      tfaToken: verified.tfaToken,
      newPassword: "a-new-secure-password",
      confirmPassword: "a-new-secure-password",
      portal: "CUSTOMER",
      client,
      env: TEST_ENV,
      now: new Date("2026-10-15T10:05:00.000Z"),
    }),
    { code: "PASSWORD_RESET_TFA_INVALID", statusCode: 401 },
  );
  assert.equal(challenges.get(request.challengeId).status, "VERIFIED");
  assert.equal(account.passwordHash, "old-hash");
});

test("driver password recovery requires its active linked driver profile and completes the normal reset flow", async () => {
  const { client, challenges, account, sessions } = makeClient();
  account.role = "DRIVER";
  account.customerProfile = null;
  account.deliveryDriverProfile = {
    id: "driver-profile-1",
    accountId: account.id,
    status: "ACTIVE",
    distributor: { id: "distributor-1", status: "ACTIVE", isActive: true },
  };
  account.roleMappings = [
    { isActive: true, role: { code: "DRIVER", isActive: true } },
  ];

  const request = await requestPasswordResetOtp({
    email: account.email,
    phone: account.phone,
    portal: "DRIVER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:00:00.000Z"),
  });
  const verified = await verifyPasswordResetOtp({
    challengeId: request.challengeId,
    otp: TEST_OTP,
    portal: "DRIVER",
    client,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:01:00.000Z"),
  });
  await completePasswordReset({
    challengeId: request.challengeId,
    tfaToken: verified.tfaToken,
    newPassword: "a-new-driver-password",
    confirmPassword: "a-new-driver-password",
    portal: "DRIVER",
    client,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:02:00.000Z"),
  });

  assert.equal(challenges.get(request.challengeId).status, "COMPLETED");
  assert.equal(await bcrypt.compare("a-new-driver-password", account.passwordHash), true);
  assert.equal(sessions[0].revocationReason, "PASSWORD_RESET");
});

test("driver password recovery rejects a missing, inactive, or unlinked driver profile", async () => {
  const { client, account, challenges } = makeClient();
  account.role = "DRIVER";
  account.customerProfile = null;
  account.roleMappings = [
    { isActive: true, role: { code: "DRIVER", isActive: true } },
  ];

  const missingProfileResult = await requestPasswordResetOtp({
    email: account.email,
    phone: account.phone,
    portal: "DRIVER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
  });
  assert.match(missingProfileResult.message, /If an eligible account matches/);
  assert.equal(challenges.size, 0);

  account.deliveryDriverProfile = {
    id: "driver-profile-1",
    accountId: account.id,
    status: "ACTIVE",
    distributor: { id: "distributor-1", status: "INACTIVE", isActive: false },
  };
  const inactiveDistributorResult = await requestPasswordResetOtp({
    email: account.email,
    phone: account.phone,
    portal: "DRIVER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
  });
  assert.equal(inactiveDistributorResult.message, missingProfileResult.message);
  assert.equal(challenges.size, 0);
});

test("password recovery rejects invalid attempt and TFA token environment values", async () => {
  const { client } = makeClient();
  await assert.rejects(
    requestPasswordResetOtp({
      phone: "9812345678",
      email: "customer@example.test",
      portal: "CUSTOMER",
      client,
      notificationConfig: NOTIFICATION_CONFIG,
      env: { ...TEST_ENV, PASSWORD_RESET_MAX_ATTEMPTS: "0" },
    }),
    { code: "PASSWORD_RESET_CONFIG_INVALID", statusCode: 500 },
  );

  const request = await requestPasswordResetOtp({
    email: "customer@example.test",
    phone: "9812345678",
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
  });
  await assert.rejects(
    verifyPasswordResetOtp({
      challengeId: request.challengeId,
      otp: TEST_OTP,
      portal: "CUSTOMER",
      client,
      env: { ...TEST_ENV, PASSWORD_RESET_TFA_TOKEN_LIFETIME_MINUTES: "31" },
    }),
    { code: "PASSWORD_RESET_CONFIG_INVALID", statusCode: 500 },
  );
});

test("password reset requires the OTP-issued TFA token and matching confirmation", async () => {
  const { client } = makeClient();
  const request = await requestPasswordResetOtp({
    email: "customer@example.test",
    phone: "9812345678",
    portal: "CUSTOMER",
    client,
    notificationConfig: NOTIFICATION_CONFIG,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:00:00.000Z"),
  });
  const verified = await verifyPasswordResetOtp({
    challengeId: request.challengeId,
    otp: TEST_OTP,
    portal: "CUSTOMER",
    client,
    env: TEST_ENV,
    now: new Date("2026-10-15T10:01:00.000Z"),
  });
  await assert.rejects(
    completePasswordReset({
      challengeId: request.challengeId,
      tfaToken: verified.tfaToken,
      newPassword: "a-new-secure-password",
      confirmPassword: "a-different-password",
      portal: "CUSTOMER",
      client,
      env: TEST_ENV,
    }),
    { code: "PASSWORD_RESET_PASSWORD_MISMATCH", statusCode: 400 },
  );
});
