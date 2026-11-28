import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import validator from "validator";
import { prisma } from "../config/db.js";
import { loadNotificationConfig } from "../notifications/config.js";
import { createNotificationInTransaction } from "../notifications/notificationService.js";
import { encryptNotificationText } from "../utils/secureNotificationPayload.js";
import { isValidMobileNumber, normalizePhoneNumber } from "../utils/socialCustomerProfile.js";
import {
  accountHasWorkspaceRole,
  hydrateDeliveryDriverProfile,
  isWorkspaceProfileActive,
  logAuthEvent,
} from "./authService.js";
import { loadOtpConfig } from "./otpService.js";

const PASSWORD_RESET_PORTALS = new Set(["CUSTOMER", "MANUFACTURER", "DISTRIBUTOR", "DRIVER"]);
const PASSWORD_RESET_OTP_LENGTH = 8;
const PASSWORD_RESET_OTP_LIMIT = 10 ** PASSWORD_RESET_OTP_LENGTH;
const PASSWORD_RESET_MAX_RESENDS = 3;
const PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = 60;

const ensurePasswordResetAvailable = (env, portal) => {
  if (String(env.PASSWORD_RESET_ENABLED || "").toLowerCase() === "false") {
    throw fail(
      "Password recovery is temporarily unavailable.",
      503,
      "PASSWORD_RESET_DISABLED",
    );
  }
  const nodeEnv = String(env.NODE_ENV || "").toLowerCase();
  const driverRecoveryOptedIn = portal === "DRIVER" &&
    ["staging", "production"].includes(nodeEnv) &&
    String(env.PASSWORD_RESET_DRIVER_ENABLED || "").toLowerCase() === "true";
  if (!["development", "test"].includes(nodeEnv) && !driverRecoveryOptedIn) {
    throw fail(
      "Password recovery is temporarily unavailable.",
      503,
      "PASSWORD_RESET_DISABLED",
    );
  }
};

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

const loadPasswordResetConfig = (env) => {
  const { expiryMinutes } = loadOtpConfig(env);
  return {
    expiryMinutes,
    maxAttempts: readBoundedInteger(env, "PASSWORD_RESET_MAX_ATTEMPTS", 5, 1, 10),
    tfaTokenLifetimeMinutes: readBoundedInteger(
      env,
      "PASSWORD_RESET_TFA_TOKEN_LIFETIME_MINUTES",
      5,
      1,
      30,
    ),
    maxResends: readBoundedInteger(env, "PASSWORD_RESET_MAX_RESENDS", PASSWORD_RESET_MAX_RESENDS, 1, 5),
    resendCooldownSeconds: readBoundedInteger(
      env,
      "PASSWORD_RESET_RESEND_COOLDOWN_SECONDS",
      PASSWORD_RESET_RESEND_COOLDOWN_SECONDS,
      30,
      900,
    ),
  };
};

const ensureDriverRecoveryConfiguration = (env, notificationConfig = null) => {
  const required = [
    "OTP_SERVER_SECRET",
    "OTP_EXPIRY_MINUTES",
    "PASSWORD_RESET_MAX_ATTEMPTS",
    "PASSWORD_RESET_MAX_RESENDS",
    "PASSWORD_RESET_RESEND_COOLDOWN_SECONDS",
    "PASSWORD_RESET_TFA_TOKEN_LIFETIME_MINUTES",
    "AUTH_RATE_LIMIT_WINDOW_MS",
    "AUTH_PASSWORD_RESET_REQUEST_IP_BUCKET_SIZE",
    "AUTH_PASSWORD_RESET_VERIFY_IP_BUCKET_SIZE",
    "AUTH_PASSWORD_RESET_COMPLETE_IP_BUCKET_SIZE",
  ];
  if (
    required.some((name) => !String(env[name] || "").trim()) ||
    String(env.PASSWORD_RESET_DRIVER_ENABLED || "").toLowerCase() !== "true" ||
    (notificationConfig && (!notificationConfig.enabled || !notificationConfig.sms?.enabled))
  ) {
    throw fail("Password recovery is temporarily unavailable.", 503, "PASSWORD_RESET_NOT_CONFIGURED");
  }
};

const normalizePortal = (value) => String(value || "").trim().toUpperCase();
const maskPhone = (phone) => `${phone.slice(0, 2)}${"*".repeat(Math.max(4, phone.length - 4))}${phone.slice(-2)}`;
const getUtcMonthlyKey = (date) => date.toISOString().slice(0, 7);
export const generatePasswordResetOtp = () => crypto
  .randomInt(0, PASSWORD_RESET_OTP_LIMIT)
  .toString()
  .padStart(PASSWORD_RESET_OTP_LENGTH, "0");
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

const genericRequestResult = (phone, challengeId, otpLength, now, expiryMinutes) => ({
  challengeId,
  maskedPhone: maskPhone(phone),
  otpLength,
  message: "If an eligible account matches these details, recovery instructions will be sent.",
  expiresAt: new Date(now.getTime() + expiryMinutes * 60 * 1000).toISOString(),
});

const makeOtp = (otpGenerator) => {
  const otp = otpGenerator();
  if (typeof otp !== "string" || !new RegExp(`^\\d{${PASSWORD_RESET_OTP_LENGTH}}$`).test(otp)) {
    throw fail("Password recovery is temporarily unavailable.", 503, "PASSWORD_RESET_CONFIG_INVALID");
  }
  return otp;
};

const genericResendResult = (challengeId) => ({
  challengeId: String(challengeId || ""),
  message: "If the request is valid and outside its cooldown, a new code will be sent.",
});

export const requestPasswordResetOtp = async ({
  email: rawEmail,
  phone: rawPhone,
  portal: rawPortal,
  ipAddress = "",
  userAgent = "",
  client = prisma,
  notificationConfig: suppliedNotificationConfig,
  otpGenerator = generatePasswordResetOtp,
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
  ensurePasswordResetAvailable(env, portal);

  const secret = String(env.OTP_SERVER_SECRET || "");
  if (secret.length < 32) throw fail("SMS verification is not configured.", 503, "PASSWORD_RESET_NOT_CONFIGURED");
  const { expiryMinutes, maxAttempts } = loadPasswordResetConfig(env);
  const notificationConfig = suppliedNotificationConfig || loadNotificationConfig(env);
  if (!notificationConfig.enabled || !notificationConfig.sms?.enabled) {
    throw fail("SMS verification is temporarily unavailable.", 503, "PASSWORD_RESET_SMS_UNAVAILABLE");
  }
  if (!["development", "test"].includes(String(env.NODE_ENV || "").toLowerCase())) {
    ensureDriverRecoveryConfiguration(env, notificationConfig);
  }
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
    const accountWithDriver = await hydrateDeliveryDriverProfile(account, tx);

    if (
      !activeAccountForPortal(accountWithDriver, portal) ||
      !isValidMobileNumber(account.phone) ||
      String(account.email || "").trim().toLowerCase() !== email
    ) return genericRequestResult(phone, crypto.randomUUID(), PASSWORD_RESET_OTP_LENGTH, now, expiryMinutes);

    if (
      account.passwordResetLastRequestedAt &&
      now.getTime() - account.passwordResetLastRequestedAt.getTime() < 7 * 24 * 60 * 60 * 1000
    ) return genericRequestResult(phone, crypto.randomUUID(), PASSWORD_RESET_OTP_LENGTH, now, expiryMinutes);
    const monthlyCount = account.passwordResetMonthlyKey === monthlyKey
      ? Number(account.passwordResetMonthlyCount || 0)
      : 0;
    if (monthlyCount >= 3) return genericRequestResult(phone, crypto.randomUUID(), PASSWORD_RESET_OTP_LENGTH, now, expiryMinutes);

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
    if (updatedQuota.count !== 1) return genericRequestResult(phone, crypto.randomUUID(), PASSWORD_RESET_OTP_LENGTH, now, expiryMinutes);

    const challengeId = crypto.randomUUID();
    const otp = makeOtp(otpGenerator);
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);
    await tx.adminTwoFactorChallenge.updateMany({
      where: {
        accountId: account.id,
        targetPortal: portal,
        purpose: "PASSWORD_RESET",
        status: "PENDING",
      },
      data: { status: "CANCELLED", otpHash: null },
    });
    const challenge = await tx.adminTwoFactorChallenge.create({
      data: {
        id: challengeId,
        accountId: account.id,
        targetPortal: portal,
        purpose: "PASSWORD_RESET",
        method: "SMS",
        otpHash: hashOtp(challengeId, otp, secret),
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
          `Your Aama Clothings password reset code is ${otp}. It expires in ${expiryMinutes} minutes. Do not share this code.`,
          secret,
        ),
      },
    }, { tx, config: notificationConfig });

    await tx.adminTwoFactorChallenge.update({
      where: { id: challenge.id },
      data: { notificationId: notification.id },
    });

    return genericRequestResult(phone, challenge.id, PASSWORD_RESET_OTP_LENGTH, now, expiryMinutes);
  });

  return requestResult;
};

export const resendPasswordResetOtp = async ({
  challengeId,
  portal: rawPortal,
  ipAddress = "",
  userAgent = "",
  client = prisma,
  notificationConfig: suppliedNotificationConfig,
  otpGenerator = generatePasswordResetOtp,
  env = process.env,
  now = new Date(),
} = {}) => {
  const portal = normalizePortal(rawPortal);
  if (!PASSWORD_RESET_PORTALS.has(portal)) throw fail("Password recovery is not available for this portal.", 400, "PASSWORD_RESET_PORTAL_INVALID");
  ensurePasswordResetAvailable(env, portal);

  const secret = String(env.OTP_SERVER_SECRET || "");
  if (secret.length < 32) throw fail("Password recovery is temporarily unavailable.", 503, "PASSWORD_RESET_NOT_CONFIGURED");
  const { expiryMinutes, maxAttempts, maxResends, resendCooldownSeconds } = loadPasswordResetConfig(env);
  const notificationConfig = suppliedNotificationConfig || loadNotificationConfig(env);
  if (!notificationConfig.enabled || !notificationConfig.sms?.enabled) {
    throw fail("SMS verification is temporarily unavailable.", 503, "PASSWORD_RESET_SMS_UNAVAILABLE");
  }
  if (!["development", "test"].includes(String(env.NODE_ENV || "").toLowerCase())) {
    ensureDriverRecoveryConfiguration(env, notificationConfig);
  }

  const normalizedChallengeId = String(challengeId || "");
  if (!/^[0-9a-f-]{36}$/i.test(normalizedChallengeId)) return genericResendResult(normalizedChallengeId);

  await client.$transaction(async (tx) => {
    const challenge = await tx.adminTwoFactorChallenge.findUnique({
      where: { id: normalizedChallengeId },
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
    const challengeAccount = await hydrateDeliveryDriverProfile(challenge?.account, tx);
    if (
      !challenge ||
      challenge.purpose !== "PASSWORD_RESET" ||
      challenge.targetPortal !== portal ||
      challenge.method !== "SMS" ||
      challenge.status !== "PENDING" ||
      !challenge.otpHash ||
      !activeAccountForPortal(challengeAccount, portal)
    ) return;

    if (challenge.expiresAt <= now) {
      await tx.adminTwoFactorChallenge.updateMany({
        where: {
          id: challenge.id,
          status: "PENDING",
          purpose: "PASSWORD_RESET",
          expiresAt: { lte: now },
        },
        data: { status: "EXPIRED", otpHash: null },
      });
      return;
    }
    if (challenge.attemptCount >= challenge.maxAttempts) {
      await tx.adminTwoFactorChallenge.updateMany({
        where: { id: challenge.id, status: "PENDING", attemptCount: challenge.attemptCount },
        data: { status: "LOCKED", otpHash: null },
      });
      return;
    }
    if (
      challenge.resendCount >= maxResends ||
      (challenge.lastSentAt && now.getTime() - challenge.lastSentAt.getTime() < resendCooldownSeconds * 1000)
    ) return;

    const otp = makeOtp(otpGenerator);
    const otpHash = hashOtp(challenge.id, otp, secret);
    const nextResendCount = challenge.resendCount + 1;
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);
    const claimed = await tx.adminTwoFactorChallenge.updateMany({
      where: {
        id: challenge.id,
        accountId: challenge.accountId,
        targetPortal: portal,
        purpose: "PASSWORD_RESET",
        method: "SMS",
        status: "PENDING",
        attemptCount: challenge.attemptCount,
        resendCount: challenge.resendCount,
        otpHash: challenge.otpHash,
        notificationId: challenge.notificationId,
        expiresAt: { gt: now },
      },
      data: {
        otpHash,
        expiresAt,
        lastSentAt: now,
        resendCount: { increment: 1 },
        notificationId: null,
      },
    });
    if (claimed.count !== 1) return;

    if (challenge.notificationId) {
      const cancelled = await tx.notification.updateMany({
        where: {
          id: challenge.notificationId,
          status: { in: ["PENDING", "QUEUED", "PROCESSING"] },
        },
        data: {
          status: "CANCELLED",
          failureCode: "PASSWORD_RESET_OTP_RESENT",
          failureReason: "A newer password reset code replaced this notification.",
          claimToken: null,
          claimExpiresAt: null,
        },
      });
      if (cancelled.count === 1) {
        await tx.notificationEvent.create({
          data: {
            notificationId: challenge.notificationId,
            eventType: "CANCELLED",
            eventTimestamp: now,
          },
        });
      }
    }

    const notification = await createNotificationInTransaction({
      channel: "SMS",
      recipientAddress: challenge.account.phone,
      recipientName: "Account holder",
      notificationType: "PASSWORD_RESET",
      template: "password-reset-code",
      idempotencyKey: `password-reset:${challenge.id}:resend:${nextResendCount}`,
      payload: {
        secureContent: encryptNotificationText(
          `Your Aama Clothings password reset code is ${otp}. It expires in ${expiryMinutes} minutes. Do not share this code.`,
          secret,
        ),
      },
    }, { tx, config: notificationConfig });

    const linkedNotification = await tx.adminTwoFactorChallenge.updateMany({
      where: {
        id: challenge.id,
        status: "PENDING",
        resendCount: nextResendCount,
        otpHash,
        notificationId: null,
      },
      data: { notificationId: notification.id },
    });
    if (linkedNotification.count !== 1) {
      throw fail("Password recovery is temporarily unavailable.", 503, "PASSWORD_RESET_RESEND_FAILED");
    }

    await logAuthEvent({
      accountId: challenge.accountId,
      identifier: challenge.account.email,
      action: "PASSWORD_RESET_OTP_RESENT",
      role: portal,
      portal,
      ipAddress,
      userAgent,
      status: "SUCCESS",
      metadata: { method: "SMS" },
    }, { client: tx });
  });

  return genericResendResult(normalizedChallengeId);
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
  if (!PASSWORD_RESET_PORTALS.has(portal)) throw fail("Invalid or expired verification code.", 401, "PASSWORD_RESET_OTP_INVALID");
  ensurePasswordResetAvailable(env, portal);
  const secret = String(env.OTP_SERVER_SECRET || "");
  if (
    secret.length < 32
  ) {
    throw fail("Password recovery is temporarily unavailable.", 503, "PASSWORD_RESET_NOT_CONFIGURED");
  }
  if (!["development", "test"].includes(String(env.NODE_ENV || "").toLowerCase())) {
    ensureDriverRecoveryConfiguration(env);
  }
  if (
    !/^[0-9a-f-]{36}$/i.test(String(challengeId || "")) ||
    !new RegExp(`^\\d{${PASSWORD_RESET_OTP_LENGTH}}$`).test(String(otp || ""))
  ) {
    throw fail("Invalid or expired verification code.", 401, "PASSWORD_RESET_OTP_INVALID");
  }

  const { tfaTokenLifetimeMinutes } = loadPasswordResetConfig(env);
  const tfaTokenExpiresAt = new Date(now.getTime() + tfaTokenLifetimeMinutes * 60 * 1000);
  const tfaToken = crypto.randomBytes(32).toString("base64url");
  const verification = await client.$transaction(async (tx) => {
    const challenge = await tx.adminTwoFactorChallenge.findUnique({
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
    if (!challenge || challenge.purpose !== "PASSWORD_RESET" || challenge.targetPortal !== portal ||
      challenge.method !== "SMS" || challenge.status !== "PENDING" || !challenge.otpHash) return null;

    const challengeAccount = await hydrateDeliveryDriverProfile(challenge.account, tx);
    if (!activeAccountForPortal(challengeAccount, portal)) return null;
    if (challenge.expiresAt <= now) {
      await tx.adminTwoFactorChallenge.updateMany({
        where: {
          id: challenge.id,
          targetPortal: portal,
          purpose: "PASSWORD_RESET",
          status: "PENDING",
          expiresAt: { lte: now },
        },
        data: { status: "EXPIRED", otpHash: null },
      });
      return null;
    }

    const maxAttempts = Number(challenge.maxAttempts || 5);
    if (challenge.attemptCount >= maxAttempts) {
      await tx.adminTwoFactorChallenge.updateMany({
        where: {
          id: challenge.id,
          status: "PENDING",
          attemptCount: challenge.attemptCount,
          otpHash: challenge.otpHash,
        },
        data: { status: "LOCKED", otpHash: null },
      });
      return null;
    }

    const nextAttemptCount = challenge.attemptCount + 1;
    const attemptClaim = await tx.adminTwoFactorChallenge.updateMany({
      where: {
        id: challenge.id,
        accountId: challenge.accountId,
        targetPortal: portal,
        purpose: "PASSWORD_RESET",
        method: "SMS",
        status: "PENDING",
        attemptCount: challenge.attemptCount,
        otpHash: challenge.otpHash,
        expiresAt: { gt: now },
      },
      data: { attemptCount: { increment: 1 } },
    });
    if (attemptClaim.count !== 1) return null;

    if (!constantTimeEqual(hashOtp(challenge.id, String(otp), secret), challenge.otpHash)) {
      if (nextAttemptCount >= maxAttempts) {
        await tx.adminTwoFactorChallenge.updateMany({
          where: {
            id: challenge.id,
            status: "PENDING",
            attemptCount: nextAttemptCount,
            otpHash: challenge.otpHash,
          },
          data: { status: "LOCKED", otpHash: null },
        });
      }
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
      }, { client: tx });
      return null;
    }

    const consumedOtp = await tx.adminTwoFactorChallenge.updateMany({
      where: {
        id: challenge.id,
        accountId: challenge.accountId,
        targetPortal: portal,
        purpose: "PASSWORD_RESET",
        method: "SMS",
        status: "PENDING",
        otpHash: challenge.otpHash,
        attemptCount: nextAttemptCount,
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
    }, { client: tx });
    return { challengeId: challenge.id };
  });
  if (!verification) throw fail("Invalid or expired verification code.", 401, "PASSWORD_RESET_OTP_INVALID");

  return {
    success: true,
    challengeId: verification.challengeId,
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
  if (!PASSWORD_RESET_PORTALS.has(portal)) throw fail("Password recovery is not available for this portal.", 400, "PASSWORD_RESET_PORTAL_INVALID");
  ensurePasswordResetAvailable(env, portal);
  const secret = String(env.OTP_SERVER_SECRET || "");
  if (
    secret.length < 32
  ) throw fail("Password recovery is temporarily unavailable.", 503, "PASSWORD_RESET_NOT_CONFIGURED");
  if (!["development", "test"].includes(String(env.NODE_ENV || "").toLowerCase())) {
    ensureDriverRecoveryConfiguration(env);
  }
  if (
    !/^[0-9a-f-]{36}$/i.test(String(challengeId || "")) ||
    !/^[A-Za-z0-9_-]{43}$/.test(String(tfaToken || ""))
  ) {
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
  const challengeAccount = await hydrateDeliveryDriverProfile(challenge?.account, client);
  if (
    !challenge ||
    challenge.purpose !== "PASSWORD_RESET" ||
    challenge.targetPortal !== portal ||
    challenge.status !== "VERIFIED" ||
    challenge.consumedAt ||
    challenge.expiresAt <= now ||
    !activeAccountForPortal(challengeAccount, portal) ||
    !constantTimeEqual(tokenHash, challenge.otpHash)
  ) {
    throw fail("The verification token is invalid, expired, or already used.", 401, "PASSWORD_RESET_TFA_INVALID");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const completedChallenge = await client.$transaction(async (tx) => {
    const currentChallenge = await tx.adminTwoFactorChallenge.findUnique({
      where: { id: challenge.id },
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
    const currentAccount = await hydrateDeliveryDriverProfile(currentChallenge?.account, tx);
    if (
      !currentChallenge ||
      currentChallenge.purpose !== "PASSWORD_RESET" ||
      currentChallenge.targetPortal !== portal ||
      currentChallenge.status !== "VERIFIED" ||
      currentChallenge.consumedAt ||
      currentChallenge.expiresAt <= now ||
      !activeAccountForPortal(currentAccount, portal) ||
      !constantTimeEqual(tokenHash, currentChallenge.otpHash)
    ) {
      throw fail("The verification token is invalid, expired, or already used.", 401, "PASSWORD_RESET_TFA_INVALID");
    }

    const claimed = await tx.adminTwoFactorChallenge.updateMany({
      where: {
        id: currentChallenge.id,
        accountId: currentChallenge.accountId,
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
      where: { id: currentChallenge.accountId },
      data: {
        passwordHash,
        passwordChangedAt: now,
        mustChangePassword: false,
      },
    });
    await tx.authSession.updateMany({
      where: { accountId: currentChallenge.accountId, revokedAt: null },
      data: { revokedAt: now, revocationReason: "PASSWORD_RESET" },
    });
    return currentChallenge;
  });

  await logAuthEvent({
    accountId: completedChallenge.accountId,
    identifier: completedChallenge.account?.email || "",
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
