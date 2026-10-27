import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import {
  completePasswordReset,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
} from "../services/passwordResetService.js";

const SECRET = "password-reset-test-secret-with-more-than-32-characters";
const TEST_ENV = { OTP_SERVER_SECRET: SECRET, OTP_LENGTH: "6", OTP_EXPIRY_MINUTES: "5", NODE_ENV: "test" };
const NOTIFICATION_CONFIG = {
  enabled: true,
  sms: { enabled: true },
  retry: { maxAttempts: 3 },
};

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
    roleMappings: [],
    passwordResetLastRequestedAt: null,
    passwordResetMonthlyKey: null,
    passwordResetMonthlyCount: 0,
    passwordHash: "old-hash",
  };
  const challenges = new Map();
  const sessions = [{ accountId: account.id, revokedAt: null }];
  let notificationNumber = 0;
  const authAuditLog = { create: async () => ({ id: "audit-1" }) };
  const notification = {
    findUnique: async () => null,
    create: async ({ data }) => ({ ...data, id: `notification-${++notificationNumber}` }),
  };
  const notificationEvent = { create: async () => ({ id: "event-1" }) };
  const notificationOutbox = { create: async () => ({ id: "outbox-1" }) };

  const challengeClient = {
    create: async ({ data }) => {
      const challenge = { ...data, consumedAt: null, verifiedAt: null, updatedAt: new Date() };
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
      const challenge = challenges.get(where.id);
      if (!challenge || challenge.status !== where.status) return { count: 0 };
      if (where.attemptCount !== undefined && challenge.attemptCount !== where.attemptCount) return { count: 0 };
      if (where.otpHash !== undefined && challenge.otpHash !== where.otpHash) return { count: 0 };
      if (where.consumedAt === null && challenge.consumedAt !== null) return { count: 0 };
      if (where.expiresAt?.gt && challenge.expiresAt <= where.expiresAt.gt) return { count: 0 };
      Object.assign(challenge, data);
      if (data.attemptCount?.increment) challenge.attemptCount += data.attemptCount.increment;
      return { count: 1 };
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
    adminTwoFactorChallenge: challengeClient,
    authAuditLog,
    notification,
    notificationEvent,
    notificationOutbox,
  };
  const client = {
    ...tx,
    $transaction: async (callback) => callback(tx),
  };
  return { client, account, challenges, sessions };
};

test("password recovery creates an SMS-only OTP challenge with a masked contact", async () => {
  const { client, account, challenges } = makeClient();
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
  assert.match(result.message, /If an active account matches/);
  assert.equal(challenges.get(result.challengeId).purpose, "PASSWORD_RESET");
  assert.equal(challenges.get(result.challengeId).method, "SMS");
  assert.equal(account.passwordResetLastRequestedAt.toISOString(), "2026-10-15T10:00:00.000Z");
  assert.equal(account.passwordResetMonthlyCount, 1);
});

test("password recovery stays unavailable outside development and test while the fixed OTP remains unchanged", async () => {
  const { client } = makeClient();
  for (const environment of ["production", "staging", undefined]) {
    const restrictedEnv = { ...TEST_ENV, NODE_ENV: environment, OTP_LENGTH: "8" };
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
    await assert.rejects(
      verifyPasswordResetOtp({
        challengeId: "123e4567-e89b-12d3-a456-426614174000",
        otp: "111111",
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
    otp: "111111",
    portal: "CUSTOMER",
    client,
    env: configuredEnv,
    now: new Date("2026-10-15T10:01:00.000Z"),
  });
  assert.equal(verified.expiresAt, "2026-10-15T10:03:00.000Z");
  assert.equal(challenges.get(request.challengeId).expiresAt.toISOString(), verified.expiresAt);
});

test("password recovery returns a portal-specific not-found message", async () => {
  for (const [portal, name] of [
    ["CUSTOMER", "customer"],
    ["MANUFACTURER", "manufacturer"],
    ["DISTRIBUTOR", "distributor"],
  ]) {
    const { client } = makeClient();
    client.authAccount.findUnique = async () => null;
    await assert.rejects(
      requestPasswordResetOtp({
        phone: "9812345678",
        email: "person@example.test",
        portal,
        client,
        env: TEST_ENV,
      }),
      {
        code: `PASSWORD_RESET_${portal}_NOT_FOUND`,
        statusCode: 404,
        message: `No active ${name} account was found with the provided email and contact number.`,
      },
    );
  }
});

test("password recovery requires both the account email and phone to match", async () => {
  const { client, challenges } = makeClient();
  await assert.rejects(
    requestPasswordResetOtp({
      email: "different@example.test",
      phone: "9812345678",
      portal: "CUSTOMER",
      client,
      notificationConfig: NOTIFICATION_CONFIG,
      env: TEST_ENV,
    }),
    {
      code: "PASSWORD_RESET_CUSTOMER_NOT_FOUND",
      statusCode: 404,
      message: "No active customer account was found with the provided email and contact number.",
    },
  );

  assert.equal(challenges.size, 0);
});

test("password recovery reports the selected portal when account role does not match", async () => {
  const { client, account, challenges } = makeClient();
  account.role = "MANUFACTURER";
  account.customerProfile = null;
  account.manufacturerProfile = { id: "manufacturer-profile-1" };
  account.distributorProfile = { id: "distributor-profile-1", status: "ACTIVE", isActive: true };
  account.roleMappings = [
    { isActive: true, role: { code: "MANUFACTURER", isActive: true } },
    { isActive: true, role: { code: "DISTRIBUTOR", isActive: true } },
  ];

  await assert.rejects(
    requestPasswordResetOtp({
      email: "customer@example.test",
      phone: "9812345678",
      portal: "DISTRIBUTOR",
      client,
      notificationConfig: NOTIFICATION_CONFIG,
      env: TEST_ENV,
    }),
    {
      code: "PASSWORD_RESET_DISTRIBUTOR_NOT_FOUND",
      statusCode: 404,
      message: "No active distributor account was found with the provided email and contact number.",
    },
  );

  assert.equal(challenges.size, 0);
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
  await assert.rejects(
    requestPasswordResetOtp({ ...request, now: new Date("2026-10-21T10:00:00.000Z") }),
    {
      code: "PASSWORD_RESET_WEEKLY_LIMIT",
      statusCode: 429,
      message: "Password reset is limited to once every 7 days. Please try again later.",
    },
  );
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
  await assert.rejects(
    requestPasswordResetOtp({
      phone: "9812345678",
      email: "customer@example.test",
      portal: "CUSTOMER",
      client,
      notificationConfig: NOTIFICATION_CONFIG,
      env: TEST_ENV,
      now: new Date("2026-10-22T10:00:00.000Z"),
    }),
    {
      code: "PASSWORD_RESET_MONTHLY_LIMIT",
      statusCode: 429,
      message: "Password reset is limited to three times per calendar month. Please try again next month.",
    },
  );
  assert.equal(challenges.size, 3);
  assert.equal((await client.authAccount.findUnique()).passwordResetMonthlyCount, 3);
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
    otp: "111111",
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
      otp: "111111",
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
    otp: "111111",
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
