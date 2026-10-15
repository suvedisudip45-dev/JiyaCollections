import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import validator from "validator";
import { prisma } from "../config/db.js";
import { loadNotificationConfig } from "../notifications/config.js";
import { createNotificationInTransaction } from "../notifications/notificationService.js";
import { encryptNotificationText } from "../utils/secureNotificationPayload.js";
import { isValidMobileNumber, normalizePhoneNumber } from "../utils/socialCustomerProfile.js";
import { accountHasWorkspaceRole, isWorkspaceProfileActive, logAuthEvent } from "./authService.js";
import { loadOtpConfig } from "./otpService.js";

const PASSWORD_RESET_PORTALS = new Set(["CUSTOMER", "MANUFACTURER", "DISTRIBUTOR"]);
const PASSWORD_RESET_OTP = "111111";

const fail = (message, statusCode = 400, code = "PASSWORD_RESET_FAILED") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const readBoundedInteger = (env, name, fallback, minimum, maximum) => {
  const value = Number(env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw fail(`${name} must be an integer between ${minimum} and ${maximum}.`, 500, "PASSWORD_RESET_CONFIG_INVALID");
  }
  return value;
};

const normalizePortal = (value) => String(value || "").trim().toUpperCase();
const maskPhone = (phone) => `${phone.slice(0, 2)}${"*".repeat(Math.max(4, phone.length - 4))}${phone.slice(-2)}`;
const getUtcMonthlyKey = (date) => date.toISOString().slice(0, 7);
const hashOtp = (challengeId, otp, secret) => crypto
  .createHmac("sha256", secret)
  .update(`password-reset-otp:v1:${challengeId}:${otp}`)
  .digest("hex");
const hashTfaToken = (challengeId, token, secret) => crypto
  .createHmac("sha256", secret)
  .update(`password-reset-tfa:v1:${challengeId}:${token}`)
  .digest("hex");
const constantTimeEqual = (left, right) => {
  const expected = Buffer.from(String(left || ""), "hex");
  const actual = Buffer.from(String(right || ""), "hex");
  return expected.length === actual.length && expected.length > 0 && crypto.timingSafeEqual(expected, actual);
};

const activeAccountForPortal = (account, portal) =>
  account?.status === "ACTIVE" &&
  String(account.role || "").toUpperCase() === portal &&
  accountHasWorkspaceRole(account, portal) &&
  isWorkspaceProfileActive(account, portal);

const genericRequestResult = (phone, challengeId = crypto.randomUUID(), otpLength = 6) => ({
  challengeId,
  maskedPhone: maskPhone(phone),
  otpLength,
  message: "If an active account matches these details for this portal, a verification code has been sent by SMS.",
});

const accountNotFoundForPortal = (portal) => {
  const portalName = {
    CUSTOMER: "customer",
    MANUFACTURER: "manufacturer",
    DISTRIBUTOR: "distributor",
  }[portal];
  const portalCode = {
    CUSTOMER: "CUSTOMER",
    MANUFACTURER: "MANUFACTURER",
    DISTRIBUTOR: "DISTRIBUTOR",
  }[portal];
  return fail(
    `No active ${portalName} account was found with the provided email and contact number.`,
    404,
    `PASSWORD_RESET_${portalCode}_NOT_FOUND`,
  );
};

export const requestPasswordResetOtp = async ({
  email: rawEmail,
  phone: rawPhone,
  portal: rawPortal,
  ipAddress = "",
  userAgent = "",
  client = prisma,
  notificationConfig: suppliedNotificationConfig,
  env = process.env,
  now = new Date(),
} = {}) => {
  const email = String(rawEmail || "").trim().toLowerCase();
  const phone = normalizePhoneNumber(rawPhone);
  const portal = normalizePortal(rawPortal);
  if (!validator.isEmail(email) || email.length > 255) {
    throw fail("Enter a valid account email address.", 400, "PASSWORD_RESET_EMAIL_INVALID");
  }
  if (!isValidMobileNumber(phone)) throw fail("Enter a valid Nepal mobile number.", 400, "PASSWORD_RESET_PHONE_INVALID");
  if (!PASSWORD_RESET_PORTALS.has(portal)) throw fail("Password recovery is not available for this portal.", 400, "PASSWORD_RESET_PORTAL_INVALID");

  const secret = String(env.OTP_SERVER_SECRET || "");
  if (secret.length < 32) throw fail("SMS verification is not configured.", 503, "PASSWORD_RESET_NOT_CONFIGURED");
  const { expiryMinutes } = loadOtpConfig(env);
  const maxAttempts = readBoundedInteger(env, "PASSWORD_RESET_MAX_ATTEMPTS", 5, 1, 10);
  const length = PASSWORD_RESET_OTP.length;
  const monthlyKey = getUtcMonthlyKey(now);
  const requestIp = String(ipAddress || "").slice(0, 64) || null;
  const userAgentHash = userAgent
    ? crypto.createHash("sha256").update(String(userAgent)).digest("hex")
    : null;

  const requestResult = await client.$transaction(async (tx) => {
    const account = await tx.authAccount.findUnique({
      where: { phone },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        passwordResetLastRequestedAt: true,
        passwordResetMonthlyKey: true,
        passwordResetMonthlyCount: true,
        customerProfile: { select: { id: true, isDisabled: true } },
        manufacturerProfile: { select: { id: true } },
        distributorProfile: { select: { id: true, status: true, isActive: true } },
        roleMappings: {
          select: { isActive: true, role: { select: { code: true, isActive: true } } },
        },
      },
    });

    if (
      !activeAccountForPortal(account, portal) ||
      !isValidMobileNumber(account.phone) ||
      String(account.email || "").trim().toLowerCase() !== email
    ) {
      throw accountNotFoundForPortal(portal);
    }

    if (
      account.passwordResetLastRequestedAt &&
      now.getTime() - account.passwordResetLastRequestedAt.getTime() < 7 * 24 * 60 * 60 * 1000
    ) {
      throw fail(
        "Password reset is limited to once every 7 days. Please try again later.",
        429,
        "PASSWORD_RESET_WEEKLY_LIMIT",
      );
    }
    const monthlyCount = account.passwordResetMonthlyKey === monthlyKey
      ? Number(account.passwordResetMonthlyCount || 0)
      : 0;
    if (monthlyCount >= 3) {
      throw fail(
        "Password reset is limited to three times per calendar month. Please try again next month.",
        429,
        "PASSWORD_RESET_MONTHLY_LIMIT",
      );
    }

    const updatedQuota = await tx.authAccount.updateMany({
      where: {
        id: account.id,
        passwordResetLastRequestedAt: account.passwordResetLastRequestedAt,
        passwordResetMonthlyKey: account.passwordResetMonthlyKey,
        passwordResetMonthlyCount: account.passwordResetMonthlyCount,
      },
      data: {
        passwordResetLastRequestedAt: now,
        passwordResetMonthlyKey: monthlyKey,
        passwordResetMonthlyCount: monthlyCount + 1,
      },
    });
    if (updatedQuota.count !== 1) {
      throw fail(
        "Password reset is limited to once every 7 days and three times per calendar month. Please try again later.",
        429,
        "PASSWORD_RESET_RATE_LIMITED",
      );
    }

    const notificationConfig = suppliedNotificationConfig || loadNotificationConfig(env);
    if (!notificationConfig.enabled || !notificationConfig.sms.enabled) {
      throw fail("SMS verification is temporarily unavailable.", 503, "PASSWORD_RESET_SMS_UNAVAILABLE");
    }

    const challengeId = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);
    const challenge = await tx.adminTwoFactorChallenge.create({
      data: {
        id: challengeId,
        accountId: account.id,
        targetPortal: portal,
        purpose: "PASSWORD_RESET",
        method: "SMS",
        otpHash: hashOtp(challengeId, PASSWORD_RESET_OTP, secret),
        status: "PENDING",
        attemptCount: 0,
        maxAttempts,
        expiresAt,
        lastSentAt: now,
        requestIp,
        userAgentHash,
      },
    });

    const notification = await createNotificationInTransaction({
      channel: "SMS",
      recipientAddress: account.phone,
      recipientName: "Account holder",
      notificationType: "PASSWORD_RESET",
      template: "password-reset-code",
      idempotencyKey: `password-reset:${challengeId}`,
      payload: {
        secureContent: encryptNotificationText(
          `Your Aama Clothings password reset code is ${PASSWORD_RESET_OTP}. It expires in ${expiryMinutes} minutes. Do not share this code.`,
          secret,
        ),
      },
    }, { tx, config: notificationConfig });

    await tx.adminTwoFactorChallenge.update({
      where: { id: challenge.id },
      data: { notificationId: notification.id },
    });

    return {
      ...genericRequestResult(account.phone, challenge.id, length),
      expiresAt: expiresAt.toISOString(),
    };
  });

  return requestResult;
};

export const verifyPasswordResetOtp = async ({
  challengeId,
  otp,
  portal: rawPortal,
  ipAddress = "",
  userAgent = "",
  client = prisma,
  env = process.env,
  now = new Date(),
} = {}) => {
  const portal = normalizePortal(rawPortal);
  const secret = String(env.OTP_SERVER_SECRET || "");
  const length = PASSWORD_RESET_OTP.length;
  if (
    secret.length < 32 ||
    !PASSWORD_RESET_PORTALS.has(portal) ||
    !/^[0-9a-f-]{36}$/i.test(String(challengeId || "")) ||
    !new RegExp(`^\\d{${length}}$`).test(String(otp || ""))
  ) {
    throw fail("Invalid or expired verification code.", 401, "PASSWORD_RESET_OTP_INVALID");
  }

  const challenge = await client.adminTwoFactorChallenge.findUnique({
    where: { id: challengeId },
    include: {
      account: {
        select: {
          id: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          customerProfile: { select: { id: true, isDisabled: true } },
          manufacturerProfile: { select: { id: true } },
          distributorProfile: { select: { id: true, status: true, isActive: true } },
          roleMappings: {
            select: { isActive: true, role: { select: { code: true, isActive: true } } },
          },
        },
      },
    },
  });
  if (
    !challenge ||
    challenge.purpose !== "PASSWORD_RESET" ||
    challenge.targetPortal !== portal ||
    challenge.method !== "SMS" ||
    challenge.status !== "PENDING" ||
    !challenge.otpHash ||
    challenge.expiresAt <= now ||
    !activeAccountForPortal(challenge.account, portal)
  ) {
    throw fail("Invalid or expired verification code.", 401, "PASSWORD_RESET_OTP_INVALID");
  }

  const tfaTokenLifetimeMinutes = readBoundedInteger(
    env,
    "PASSWORD_RESET_TFA_TOKEN_LIFETIME_MINUTES",
    5,
    1,
    30,
  );
  const tfaTokenExpiresAt = new Date(now.getTime() + tfaTokenLifetimeMinutes * 60 * 1000);
  if (!constantTimeEqual(hashOtp(challenge.id, String(otp), secret), challenge.otpHash)) {
    const nextAttemptCount = challenge.attemptCount + 1;
    await client.adminTwoFactorChallenge.updateMany({
      where: {
        id: challenge.id,
        status: "PENDING",
        attemptCount: challenge.attemptCount,
        otpHash: challenge.otpHash,
        expiresAt: { gt: now },
      },
      data: {
        attemptCount: { increment: 1 },
        ...(nextAttemptCount >= challenge.maxAttempts ? { status: "LOCKED", otpHash: null } : {}),
      },
    });
    await logAuthEvent({
      accountId: challenge.accountId,
      identifier: challenge.account.email,
      action: "PASSWORD_RESET_OTP_FAILED",
      role: portal,
      portal,
      ipAddress,
      userAgent,
      status: "FAILED",
      failureReason: "INVALID_OTP",
    }, { client });
    throw fail("Invalid or expired verification code.", 401, "PASSWORD_RESET_OTP_INVALID");
  }

  const tfaToken = crypto.randomBytes(32).toString("base64url");
  const consumedOtp = await client.adminTwoFactorChallenge.updateMany({
    where: {
      id: challenge.id,
      accountId: challenge.accountId,
      targetPortal: portal,
      purpose: "PASSWORD_RESET",
      method: "SMS",
      status: "PENDING",
      otpHash: challenge.otpHash,
      attemptCount: challenge.attemptCount,
      expiresAt: { gt: now },
    },
    data: {
      status: "VERIFIED",
      otpHash: hashTfaToken(challenge.id, tfaToken, secret),
      verifiedAt: now,
      expiresAt: tfaTokenExpiresAt,
    },
  });
  if (consumedOtp.count !== 1) throw fail("Invalid or expired verification code.", 401, "PASSWORD_RESET_OTP_INVALID");

  await logAuthEvent({
    accountId: challenge.accountId,
    identifier: challenge.account.email,
    action: "PASSWORD_RESET_OTP_VERIFIED",
    role: portal,
    portal,
    ipAddress,
    userAgent,
    status: "SUCCESS",
    metadata: { method: "SMS" },
  }, { client });

  return {
    success: true,
    challengeId: challenge.id,
    tfaToken,
    expiresAt: tfaTokenExpiresAt.toISOString(),
  };
};

export const completePasswordReset = async ({
  challengeId,
  tfaToken,
  newPassword,
  confirmPassword,
  portal: rawPortal,
  ipAddress = "",
  userAgent = "",
  correlationId = null,
  client = prisma,
  env = process.env,
  now = new Date(),
} = {}) => {
  const portal = normalizePortal(rawPortal);
  const secret = String(env.OTP_SERVER_SECRET || "");
  if (!PASSWORD_RESET_PORTALS.has(portal)) throw fail("Password recovery is not available for this portal.", 400, "PASSWORD_RESET_PORTAL_INVALID");
  if (!/^[0-9a-f-]{36}$/i.test(String(challengeId || "")) || !tfaToken || secret.length < 32) {
    throw fail("A valid verification token is required.", 401, "PASSWORD_RESET_TFA_REQUIRED");
  }
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) {
    throw fail("Password must be between 8 and 128 characters.", 400, "PASSWORD_RESET_PASSWORD_INVALID");
  }
  if (newPassword !== confirmPassword) throw fail("Passwords do not match.", 400, "PASSWORD_RESET_PASSWORD_MISMATCH");

  const tokenHash = hashTfaToken(challengeId, String(tfaToken), secret);
  const challenge = await client.adminTwoFactorChallenge.findUnique({
    where: { id: challengeId },
    include: {
      account: {
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          customerProfile: { select: { id: true, isDisabled: true } },
          manufacturerProfile: { select: { id: true } },
          distributorProfile: { select: { id: true, status: true, isActive: true } },
          roleMappings: {
            select: { isActive: true, role: { select: { code: true, isActive: true } } },
          },
        },
      },
    },
  });
  if (
    !challenge ||
    challenge.purpose !== "PASSWORD_RESET" ||
    challenge.targetPortal !== portal ||
    challenge.status !== "VERIFIED" ||
    challenge.consumedAt ||
    challenge.expiresAt <= now ||
    !activeAccountForPortal(challenge.account, portal) ||
    !constantTimeEqual(tokenHash, challenge.otpHash)
  ) {
    throw fail("The verification token is invalid, expired, or already used.", 401, "PASSWORD_RESET_TFA_INVALID");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await client.$transaction(async (tx) => {
    const claimed = await tx.adminTwoFactorChallenge.updateMany({
      where: {
        id: challenge.id,
        accountId: challenge.accountId,
        targetPortal: portal,
        purpose: "PASSWORD_RESET",
        status: "VERIFIED",
        consumedAt: null,
        otpHash: tokenHash,
        expiresAt: { gt: now },
      },
      data: {
        status: "COMPLETED",
        consumedAt: now,
        otpHash: null,
      },
    });
    if (claimed.count !== 1) throw fail("The verification token is invalid, expired, or already used.", 401, "PASSWORD_RESET_TFA_INVALID");

    await tx.authAccount.update({
      where: { id: challenge.accountId },
      data: {
        passwordHash,
        passwordChangedAt: now,
        mustChangePassword: false,
      },
    });
    await tx.authSession.updateMany({
      where: { accountId: challenge.accountId, revokedAt: null },
      data: { revokedAt: now, revocationReason: "PASSWORD_RESET" },
    });
  });

  await logAuthEvent({
    accountId: challenge.accountId,
    identifier: challenge.account?.email || "",
    action: "PASSWORD_RESET_COMPLETED",
    role: portal,
    portal,
    ipAddress,
    userAgent,
    correlationId,
    status: "SUCCESS",
  }, { client });

  return { success: true };
};
