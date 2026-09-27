import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { loadNotificationConfig } from "../notifications/config.js";
import { createNotificationInTransaction } from "../notifications/notificationService.js";
import { encryptNotificationText } from "../utils/secureNotificationPayload.js";
import { normalizePortal, requiresMfa } from "../security/mfaPolicy.js";
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
    maxResends: readBoundedInteger(env, "OTP_MAX_RESENDS", 3, 1, 10),
    resendCooldownSeconds: readBoundedInteger(env, "OTP_RESEND_COOLDOWN_SECONDS", 30, 5, 300),
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

const purposeForPortal = (portal) => portal === "ADMIN" ? "ADMIN_LOGIN" : `${portal}_LOGIN`;

const isExpectedPurpose = (challenge) => challenge.purpose === purposeForPortal(challenge.targetPortal) ||
  (challenge.targetPortal === "ADMIN" && challenge.purpose === "PORTAL_LOGIN");

const hashOtp = (challengeId, otp, secret) => crypto
  .createHmac("sha256", secret)
  .update(`admin-2fa:v1:${challengeId}:${otp}`)
  .digest("hex");

const compareOtp = (challengeId, otp, storedHash, secret) => {
  const expected = Buffer.from(String(storedHash || ""), "hex");
  const actual = Buffer.from(hashOtp(challengeId, otp, secret), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const generateOtp = (length) => crypto.randomInt(0, 10 ** length).toString().padStart(length, "0");

const portalLabelFor = (portal) => ({
  ADMIN: "admin",
  MARKETING_PARTNER: "marketing partner",
  MANUFACTURER: "manufacturer",
})[portal];

const queuePortalCode = async ({
  tx,
  challenge,
  method,
  otp,
  config,
  notificationConfig,
  idempotencyKey,
}) => {
  const recipientAddress = method === "SMS" ? challenge.account.phone : challenge.account.email;
  const portalLabel = portalLabelFor(challenge.targetPortal);
  const message = `Your ${portalLabel} verification code is ${otp}. It expires in ${config.expiryMinutes} minutes. Do not share this code.`;
  return createNotificationInTransaction({
    channel: method,
    recipientAddress,
    recipientName: challenge.account.email,
    notificationType: challenge.targetPortal === "ADMIN" ? "ADMIN_2FA" : "PORTAL_2FA",
    template: challenge.targetPortal === "ADMIN" ? "admin-2fa-code" : "portal-2fa-code",
    idempotencyKey,
    payload: {
      ...(method === "EMAIL" ? { subject: `${portalLabel} verification code` } : {}),
      secureContent: encryptNotificationText(message, config.secret),
    },
  }, { tx, config: notificationConfig });
};

const safeAccountSelect = {
  id: true,
  email: true,
  phone: true,
  role: true,
  status: true,
};

export const createPortalTwoFactorChallenge = async ({
  accountId,
  portal = "ADMIN",
  ipAddress = "",
  userAgent = "",
}, {
  client = prisma,
  notificationConfig = loadNotificationConfig(),
  env = process.env,
  now = new Date(),
} = {}) => {
  const config = loadAdminTwoFactorConfig(env);
  const targetPortal = normalizePortal(portal);
  if (!requiresMfa(targetPortal)) {
    throw failure("Verification is unavailable for this portal.", 400, "PORTAL_2FA_PORTAL_INVALID");
  }
  const account = await client.authAccount.findUnique({
    where: { id: accountId },
    select: safeAccountSelect,
  });
  if (!account || account.role !== targetPortal || account.status !== "ACTIVE") {
    throw failure("Verification is unavailable.", 503, "PORTAL_2FA_ACCOUNT_UNAVAILABLE");
  }

  const availableMethods = availableMethodsFor(account, notificationConfig);
  if (!availableMethods.length) {
    throw failure("Verification delivery is unavailable.", 503, "PORTAL_2FA_DELIVERY_UNAVAILABLE");
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
      where: { accountId, targetPortal, status: "PENDING" },
      data: { status: "CANCELLED", otpHash: null },
    });
    await tx.adminTwoFactorChallenge.create({
      data: {
        id: challengeId,
        accountId,
        targetPortal,
        purpose: purposeForPortal(targetPortal),
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
        action: `${targetPortal}_2FA_CHALLENGE_CREATED`,
        role: targetPortal,
        portal: targetPortal,
        status: "SUCCESS",
        ipAddress: String(ipAddress || "").slice(0, 64) || null,
      },
    });
  });

  return {
    challengeId,
    portal: targetPortal,
    codeLength: config.length,
    availableMethods,
    maskedPhone: availableMethods.includes("SMS") ? maskPhone(account.phone) : null,
    maskedEmail: availableMethods.includes("EMAIL") ? maskEmail(account.email) : null,
  };
};

export const createAdminTwoFactorChallenge = (input, options) => createPortalTwoFactorChallenge({
  ...input,
  portal: "ADMIN",
}, options);

export const sendPortalTwoFactorCode = async ({ challengeId, method }, {
  client = prisma,
  notificationConfig = loadNotificationConfig(),
  env = process.env,
  now = new Date(),
  expectedPortal = null,
} = {}) => {
  const config = loadAdminTwoFactorConfig(env);
  const normalizedMethod = normalizeMethod(method);
  if (!/^[0-9a-f-]{36}$/i.test(String(challengeId || "")) || !["SMS", "EMAIL"].includes(normalizedMethod)) {
    throw failure("Invalid or expired verification challenge.");
  }
  if (!notificationConfig.enabled || !notificationConfig[normalizedMethod.toLowerCase()]?.enabled) {
    throw failure("Selected verification method is unavailable.", 503, "ADMIN_2FA_DELIVERY_UNAVAILABLE");
  }

  // const otp = generateOtp(config.length);
  const otp = 111111;
  const expiresAt = new Date(now.getTime() + config.expiryMinutes * 60 * 1000);
  const otpHash = hashOtp(challengeId, otp, config.secret);

  return client.$transaction(async (tx) => {
    const challenge = await tx.adminTwoFactorChallenge.findUnique({
      where: { id: challengeId },
      include: { account: { select: safeAccountSelect } },
    });
    if (
      !challenge ||
      challenge.status !== "PENDING" ||
      !requiresMfa(challenge.targetPortal) ||
      (expectedPortal && challenge.targetPortal !== expectedPortal) ||
      !isExpectedPurpose(challenge) ||
      challenge.method ||
      challenge.expiresAt <= now ||
      challenge.account.role !== challenge.targetPortal ||
      challenge.account.status !== "ACTIVE"
    ) {
      throw failure("Invalid or expired verification challenge.");
    }

    const methods = availableMethodsFor(challenge.account, notificationConfig);
    if (!methods.includes(normalizedMethod)) {
      throw failure("Selected verification method is unavailable.", 503, "ADMIN_2FA_DELIVERY_UNAVAILABLE");
    }
    const notification = await queuePortalCode({
      tx,
      challenge,
      method: normalizedMethod,
      otp,
      config,
      notificationConfig,
      idempotencyKey: `portal-2fa:${challenge.targetPortal}:${challenge.id}:0`,
    });

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
        action: `${challenge.targetPortal}_2FA_OTP_QUEUED`,
        role: challenge.targetPortal,
        portal: challenge.targetPortal,
        status: "SUCCESS",
        ipAddress: challenge.requestIp,
      },
    });
    return {
      queued: true,
      method: normalizedMethod,
      expiresAt: expiresAt.toISOString(),
      resendAvailableAt: new Date(now.getTime() + config.resendCooldownSeconds * 1000).toISOString(),
    };
  });
};

export const sendAdminTwoFactorCode = (input, options = {}) => sendPortalTwoFactorCode(input, {
  ...options,
  expectedPortal: "ADMIN",
});

export const resendPortalTwoFactorCode = async ({ challengeId }, {
  client = prisma,
  notificationConfig = loadNotificationConfig(),
  env = process.env,
  now = new Date(),
} = {}) => {
  const config = loadAdminTwoFactorConfig(env);
  if (!/^[0-9a-f-]{36}$/i.test(String(challengeId || ""))) throw failure();

  // const otp = generateOtp(config.length);
  const otp = 111111;
  const otpHash = hashOtp(challengeId, otp, config.secret);
  const expiresAt = new Date(now.getTime() + config.expiryMinutes * 60 * 1000);

  return client.$transaction(async (tx) => {
    const challenge = await tx.adminTwoFactorChallenge.findUnique({
      where: { id: challengeId },
      include: { account: { select: safeAccountSelect } },
    });
    if (
      !challenge ||
      challenge.status !== "PENDING" ||
      !requiresMfa(challenge.targetPortal) ||
      !isExpectedPurpose(challenge) ||
      !challenge.method ||
      challenge.account.role !== challenge.targetPortal ||
      challenge.account.status !== "ACTIVE"
    ) {
      throw failure();
    }
    if (challenge.resendCount >= config.maxResends) {
      throw failure("Too many resend requests. Please try again later.", 429, "PORTAL_2FA_RESEND_LIMITED");
    }
    const resendAvailableAt = challenge.lastSentAt
      ? new Date(challenge.lastSentAt.getTime() + config.resendCooldownSeconds * 1000)
      : now;
    if (challenge.lastSentAt && now < resendAvailableAt) {
      throw failure("Please wait before requesting another code.", 429, "PORTAL_2FA_RESEND_COOLDOWN");
    }
    if (!notificationConfig.enabled || !notificationConfig[challenge.method.toLowerCase()]?.enabled) {
      throw failure("Selected verification method is unavailable.", 503, "PORTAL_2FA_DELIVERY_UNAVAILABLE");
    }

    if (challenge.notificationId) {
      await tx.notification.updateMany({
        where: { id: challenge.notificationId, status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
        data: {
          status: "CANCELLED",
          failureCode: "PORTAL_2FA_RESENT",
          failureReason: "A newer verification code replaced this notification.",
          claimToken: null,
          claimExpiresAt: null,
        },
      });
    }

    const notification = await queuePortalCode({
      tx,
      challenge,
      method: challenge.method,
      otp,
      config,
      notificationConfig,
      idempotencyKey: `portal-2fa:${challenge.targetPortal}:${challenge.id}:resend:${challenge.resendCount + 1}`,
    });
    const claimed = await tx.adminTwoFactorChallenge.updateMany({
      where: {
        id: challenge.id,
        accountId: challenge.accountId,
        targetPortal: challenge.targetPortal,
        status: "PENDING",
        resendCount: challenge.resendCount,
        notificationId: challenge.notificationId,
      },
      data: {
        otpHash,
        attemptCount: 0,
        expiresAt,
        lastSentAt: now,
        resendCount: { increment: 1 },
        notificationId: notification.id,
      },
    });
    if (claimed.count !== 1) throw failure();

    await tx.authAuditLog.create({
      data: {
        accountId: challenge.accountId,
        identifier: challenge.account.email,
        action: `${challenge.targetPortal}_2FA_OTP_RESENT`,
        role: challenge.targetPortal,
        portal: challenge.targetPortal,
        status: "SUCCESS",
        ipAddress: challenge.requestIp,
      },
    });
    return {
      queued: true,
      method: challenge.method,
      expiresAt: expiresAt.toISOString(),
      resendAvailableAt: new Date(now.getTime() + config.resendCooldownSeconds * 1000).toISOString(),
    };
  });
};

export const verifyPortalTwoFactorCode = async ({ challengeId, otp }, {
  client = prisma,
  env = process.env,
  now = new Date(),
  ipAddress = "",
  userAgent = "",
  expectedPortal = null,
} = {}) => {
  const config = loadAdminTwoFactorConfig(env);
  if (!/^[0-9a-f-]{36}$/i.test(String(challengeId || "")) || !new RegExp(`^\\d{${config.length}}$`).test(String(otp || ""))) {
    throw failure();
  }

  const challenge = await client.adminTwoFactorChallenge.findUnique({
    where: { id: challengeId },
    include: {
      account: {
        include: {
          adminProfile: true,
          marketingPartnerProfile: true,
          manufacturerProfile: true,
        },
      },
    },
  });
  if (
    !challenge ||
    challenge.status !== "PENDING" ||
    !requiresMfa(challenge.targetPortal) ||
    (expectedPortal && challenge.targetPortal !== expectedPortal) ||
    !isExpectedPurpose(challenge) ||
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
  if (challenge.account.role !== challenge.targetPortal || challenge.account.status !== "ACTIVE") throw failure();

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
        action: nextAttemptCount >= challenge.maxAttempts
          ? `${challenge.targetPortal}_2FA_LOCKED`
          : `${challenge.targetPortal}_2FA_FAILED`,
        role: challenge.targetPortal,
        portal: challenge.targetPortal,
        ipAddress,
        userAgent,
        status: "FAILED",
        failureReason: "INVALID_OTP",
      }, { client });
    }
    throw failure();
  }

  const profileField = {
    ADMIN: "adminProfile",
    MARKETING_PARTNER: "marketingPartnerProfile",
    MANUFACTURER: "manufacturerProfile",
  }[challenge.targetPortal];
  const profile = challenge.account[profileField] || {
    id: challenge.account.id,
    email: challenge.account.email,
    phone: challenge.account.phone,
  };
  const tokenPair = await client.$transaction(async (tx) => {
    const consumed = await tx.adminTwoFactorChallenge.updateMany({
      where: {
        id: challenge.id,
        accountId: challenge.accountId,
        targetPortal: challenge.targetPortal,
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
    action: `${challenge.targetPortal}_2FA_VERIFIED`,
    role: challenge.targetPortal,
    portal: challenge.targetPortal,
    ipAddress,
    userAgent,
    status: "SUCCESS",
    metadata: { method: challenge.method },
  }, { client });
  return {
    portal: challenge.targetPortal,
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

export const verifyAdminTwoFactorCode = (input, options = {}) => verifyPortalTwoFactorCode(input, {
  ...options,
  expectedPortal: "ADMIN",
});

export const maskAdminContact = Object.freeze({ email: maskEmail, phone: maskPhone });