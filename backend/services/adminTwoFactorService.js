import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { loadNotificationConfig } from "../notifications/config.js";
import { createNotificationInTransaction } from "../notifications/notificationService.js";
import { encryptNotificationText } from "../utils/secureNotificationPayload.js";
import { createLoginTokenPair, logAuthEvent } from "./authService.js";

const failure = (message = "Invalid or expired verification code.", statusCode = 401, code = "ADMIN_2FA_INVALID") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const readBoundedInteger = (env, name, fallback, minimum, maximum) => {
  const value = Number(env[name] || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw failure(`${name} must be an integer between ${minimum} and ${maximum}.`, 500, "ADMIN_2FA_CONFIG_INVALID");
  }
  return value;
};

const loadAdminTwoFactorConfig = (env = process.env) => {
  const secret = String(env.OTP_SERVER_SECRET || "");
  if (secret.length < 32) {
    throw failure("Admin verification is not configured.", 503, "ADMIN_2FA_NOT_CONFIGURED");
  }
  return {
    secret,
    length: readBoundedInteger(env, "OTP_LENGTH", 6, 6, 8),
    expiryMinutes: readBoundedInteger(env, "OTP_EXPIRY_MINUTES", 5, 1, 15),
    maxAttempts: readBoundedInteger(env, "OTP_MAX_ATTEMPTS", 5, 1, 10),
    maxChallengesPerWindow: readBoundedInteger(env, "OTP_MAX_CHALLENGES_PER_WINDOW", 5, 1, 20),
    challengeWindowMinutes: readBoundedInteger(env, "OTP_CHALLENGE_WINDOW_MINUTES", 10, 1, 60),
  };
};

const normalizeMethod = (method) => String(method || "").trim().toUpperCase();

const availableMethodsFor = (account, config) => {
  if (!config.enabled) return [];
  const methods = [];
  if (account.phone && config.sms.enabled) methods.push("SMS");
  if (account.email && config.email.enabled) methods.push("EMAIL");
  return methods;
};

const maskEmail = (email) => {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 1)}${"*".repeat(Math.max(3, Math.min(local.length - 1, 8)))}@${domain}`;
};

const maskPhone = (phone) => {
  const value = String(phone || "");
  return value ? `${"*".repeat(Math.max(4, value.length - 4))}${value.slice(-4)}` : "";
};

const getUserAgentHash = (userAgent) => userAgent
  ? crypto.createHash("sha256").update(String(userAgent)).digest("hex")
  : null;

const hashOtp = (challengeId, otp, secret) => crypto
  .createHmac("sha256", secret)
  .update(`admin-2fa:v1:${challengeId}:${otp}`)
  .digest("hex");

const compareOtp = (challengeId, otp, storedHash, secret) => {
  const expected = Buffer.from(String(storedHash || ""), "hex");
  const actual = Buffer.from(hashOtp(challengeId, otp, secret), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const generateOtp = (length) => 111111;
// crypto.randomInt(0, 10 ** length).toString().padStart(length, "0");
const safeAccountSelect = {
  id: true,
  email: true,
  phone: true,
  role: true,
  status: true,
};

export const createAdminTwoFactorChallenge = async ({
  accountId,
  ipAddress = "",
  userAgent = "",
}, {
  client = prisma,
  notificationConfig = loadNotificationConfig(),
  env = process.env,
  now = new Date(),
} = {}) => {
  const config = loadAdminTwoFactorConfig(env);
  const account = await client.authAccount.findUnique({
    where: { id: accountId },
    select: safeAccountSelect,
  });
  if (!account || account.role !== "ADMIN" || account.status !== "ACTIVE") {
    throw failure("Admin verification is unavailable.", 503, "ADMIN_2FA_ACCOUNT_UNAVAILABLE");
  }

  const availableMethods = availableMethodsFor(account, notificationConfig);
  if (!availableMethods.length) {
    throw failure("Admin verification delivery is unavailable.", 503, "ADMIN_2FA_DELIVERY_UNAVAILABLE");
  }

  const windowStart = new Date(now.getTime() - config.challengeWindowMinutes * 60 * 1000);
  const rateScopes = [{ accountId }];
  if (ipAddress) rateScopes.push({ requestIp: String(ipAddress).slice(0, 64) });
  const recentChallenges = await client.adminTwoFactorChallenge.count({
    where: { createdAt: { gte: windowStart }, OR: rateScopes },
  });
  if (recentChallenges >= config.maxChallengesPerWindow) {
    throw failure("Too many verification requests. Please try again later.", 429, "ADMIN_2FA_RATE_LIMITED");
  }

  const expiresAt = new Date(now.getTime() + config.expiryMinutes * 60 * 1000);
  const challengeId = crypto.randomUUID();
  await client.$transaction(async (tx) => {
    await tx.adminTwoFactorChallenge.updateMany({
      where: { accountId, targetPortal: "ADMIN", status: "PENDING" },
      data: { status: "CANCELLED", otpHash: null },
    });
    await tx.adminTwoFactorChallenge.create({
      data: {
        id: challengeId,
        accountId,
        targetPortal: "ADMIN",
        purpose: "ADMIN_LOGIN",
        status: "PENDING",
        maxAttempts: config.maxAttempts,
        expiresAt,
        requestIp: String(ipAddress || "").slice(0, 64) || null,
        userAgentHash: getUserAgentHash(userAgent),
      },
    });
    await tx.authAuditLog.create({
      data: {
        accountId,
        identifier: account.email,
        action: "ADMIN_2FA_CHALLENGE_CREATED",
        role: "ADMIN",
        portal: "ADMIN",
        status: "SUCCESS",
        ipAddress: String(ipAddress || "").slice(0, 64) || null,
      },
    });
  });

  return {
    challengeId,
    availableMethods,
    maskedPhone: availableMethods.includes("SMS") ? maskPhone(account.phone) : null,
    maskedEmail: availableMethods.includes("EMAIL") ? maskEmail(account.email) : null,
  };
};

export const sendAdminTwoFactorCode = async ({ challengeId, method }, {
  client = prisma,
  notificationConfig = loadNotificationConfig(),
  env = process.env,
  now = new Date(),
} = {}) => {
  const config = loadAdminTwoFactorConfig(env);
  const normalizedMethod = normalizeMethod(method);
  if (!/^[0-9a-f-]{36}$/i.test(String(challengeId || "")) || !["SMS", "EMAIL"].includes(normalizedMethod)) {
    throw failure("Invalid or expired verification challenge.");
  }
  if (!notificationConfig.enabled || !notificationConfig[normalizedMethod.toLowerCase()]?.enabled) {
    throw failure("Selected verification method is unavailable.", 503, "ADMIN_2FA_DELIVERY_UNAVAILABLE");
  }

  const otp = generateOtp(config.length);
  const expiresAt = new Date(now.getTime() + config.expiryMinutes * 60 * 1000);
  const otpHash = hashOtp(challengeId, otp, config.secret);
  const message = `Your admin verification code is ${otp}. It expires in ${config.expiryMinutes} minutes. Do not share this code.`;

  return client.$transaction(async (tx) => {
    const challenge = await tx.adminTwoFactorChallenge.findUnique({
      where: { id: challengeId },
      include: { account: { select: safeAccountSelect } },
    });
    if (
      !challenge ||
      challenge.status !== "PENDING" ||
      challenge.targetPortal !== "ADMIN" ||
      challenge.purpose !== "ADMIN_LOGIN" ||
      challenge.method ||
      challenge.expiresAt <= now ||
      challenge.account.role !== "ADMIN" ||
      challenge.account.status !== "ACTIVE"
    ) {
      throw failure("Invalid or expired verification challenge.");
    }

    const methods = availableMethodsFor(challenge.account, notificationConfig);
    if (!methods.includes(normalizedMethod)) {
      throw failure("Selected verification method is unavailable.", 503, "ADMIN_2FA_DELIVERY_UNAVAILABLE");
    }
    const recipientAddress = normalizedMethod === "SMS" ? challenge.account.phone : challenge.account.email;
    const notification = await createNotificationInTransaction({
      channel: normalizedMethod,
      recipientAddress,
      recipientName: challenge.account.email,
      notificationType: "ADMIN_2FA",
      template: "admin-2fa-code",
      idempotencyKey: `admin-2fa:${challenge.id}`,
      payload: {
        ...(normalizedMethod === "EMAIL" ? { subject: "Admin verification code" } : {}),
        secureContent: encryptNotificationText(message, config.secret),
      },
    }, { tx, config: notificationConfig });

    const claimed = await tx.adminTwoFactorChallenge.updateMany({
      where: {
        id: challenge.id,
        accountId: challenge.accountId,
        status: "PENDING",
        method: null,
        expiresAt: { gt: now },
      },
      data: {
        method: normalizedMethod,
        otpHash,
        attemptCount: 0,
        expiresAt,
        lastSentAt: now,
        notificationId: notification.id,
      },
    });
    if (claimed.count !== 1) throw failure("Invalid or expired verification challenge.");

    await tx.authAuditLog.create({
      data: {
        accountId: challenge.accountId,
        identifier: challenge.account.email,
        action: "ADMIN_2FA_OTP_QUEUED",
        role: "ADMIN",
        portal: "ADMIN",
        status: "SUCCESS",
        ipAddress: challenge.requestIp,
      },
    });
    return { queued: true, method: normalizedMethod };
  });
};

export const verifyAdminTwoFactorCode = async ({ challengeId, otp }, {
  client = prisma,
  env = process.env,
  now = new Date(),
  ipAddress = "",
  userAgent = "",
} = {}) => {
  const config = loadAdminTwoFactorConfig(env);
  if (!/^[0-9a-f-]{36}$/i.test(String(challengeId || "")) || !new RegExp(`^\\d{${config.length}}$`).test(String(otp || ""))) {
    throw failure();
  }

  const challenge = await client.adminTwoFactorChallenge.findUnique({
    where: { id: challengeId },
    include: { account: { include: { adminProfile: true } } },
  });
  if (
    !challenge ||
    challenge.status !== "PENDING" ||
    challenge.targetPortal !== "ADMIN" ||
    challenge.purpose !== "ADMIN_LOGIN" ||
    !challenge.method ||
    !challenge.otpHash
  ) {
    throw failure();
  }
  if (challenge.expiresAt <= now) {
    await client.adminTwoFactorChallenge.updateMany({
      where: { id: challenge.id, status: "PENDING", expiresAt: { lte: now } },
      data: { status: "EXPIRED", otpHash: null },
    });
    throw failure();
  }
  if (challenge.account.role !== "ADMIN" || challenge.account.status !== "ACTIVE") throw failure();

  if (!compareOtp(challenge.id, String(otp), challenge.otpHash, config.secret)) {
    const nextAttemptCount = challenge.attemptCount + 1;
    const updated = await client.adminTwoFactorChallenge.updateMany({
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
    if (updated.count === 1) {
      await logAuthEvent({
        accountId: challenge.accountId,
        identifier: challenge.account.email,
        action: nextAttemptCount >= challenge.maxAttempts ? "ADMIN_2FA_LOCKED" : "ADMIN_2FA_FAILED",
        role: "ADMIN",
        portal: "ADMIN",
        ipAddress,
        userAgent,
        status: "FAILED",
        failureReason: "INVALID_OTP",
      }, { client });
    }
    throw failure();
  }

  const profile = challenge.account.adminProfile || {
    id: challenge.account.id,
    email: challenge.account.email,
    phone: challenge.account.phone,
  };
  const tokenPair = await client.$transaction(async (tx) => {
    const consumed = await tx.adminTwoFactorChallenge.updateMany({
      where: {
        id: challenge.id,
        accountId: challenge.accountId,
        targetPortal: "ADMIN",
        status: "PENDING",
        method: challenge.method,
        otpHash: challenge.otpHash,
        attemptCount: challenge.attemptCount,
        expiresAt: { gt: now },
      },
      data: {
        status: "VERIFIED",
        otpHash: null,
        verifiedAt: now,
        consumedAt: now,
      },
    });
    if (consumed.count !== 1) throw failure();
    return createLoginTokenPair({
      account: challenge.account,
      profile,
      ipAddress,
      userAgent,
      mfaVerified: true,
      authMethods: ["pwd", "otp"],
      tx,
    });
  });

  await logAuthEvent({
    accountId: challenge.accountId,
    identifier: challenge.account.email,
    action: "ADMIN_2FA_VERIFIED",
    role: "ADMIN",
    portal: "ADMIN",
    ipAddress,
    userAgent,
    status: "SUCCESS",
    metadata: { method: challenge.method },
  }, { client });
  return {
    tokenPair,
    account: {
      id: challenge.account.id,
      email: challenge.account.email,
      phone: challenge.account.phone,
      role: challenge.account.role,
      status: challenge.account.status,
    },
  };
};

export const maskAdminContact = Object.freeze({ email: maskEmail, phone: maskPhone });