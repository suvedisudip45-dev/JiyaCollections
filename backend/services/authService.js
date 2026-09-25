import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import validator from "validator";
import { prisma } from "../config/db.js";
import { decryptAES } from "../utils/crypto.js";
import { normalizePhoneNumber } from "../utils/socialCustomerProfile.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Normalizes identifier (lowercase email or 10-digit Nepal mobile number)
 */
export const normalizeIdentifier = (rawIdentifier) => {
  const clean = String(rawIdentifier || "").trim();
  if (validator.isEmail(clean)) {
    return { type: "EMAIL", value: clean.toLowerCase() };
  }
  const normalizedPhone = normalizePhoneNumber(clean);
  if (normalizedPhone) {
    return { type: "PHONE", value: normalizedPhone };
  }
  return { type: "UNKNOWN", value: clean.toLowerCase() };
};

/**
 * Safe password resolution (decrypts AES-256 payload if present, or accepts plain string)
 */
export const resolvePassword = (body = {}) => {
  const { password, encryptedPassword, iv } = body;
  if (encryptedPassword && iv) {
    try {
      return decryptAES(encryptedPassword, iv);
    } catch {
      throw new Error("Invalid encrypted credentials");
    }
  }
  if (password) {
    return String(password);
  }
  throw new Error("Password is required");
};

/**
 * Creates a standardized JWT token
 */
export const generateAuthToken = (account, profile = {}) => {
  const payload = {
    accountId: account.id,
    role: account.role,
    email: account.email,
    phone: account.phone || "",
    portalAccess: [account.role],
  };

  if (account.role === "ADMIN") {
    payload.adminId = profile.id || account.id;
  } else if (account.role === "MANUFACTURER") {
    payload.manufacturerId = profile.id || account.id;
  } else if (account.role === "MARKETING_PARTNER") {
    payload.partnerId = profile.id || account.id;
  } else {
    payload.id = profile.id || account.id;
    payload.userId = profile.id || account.id;
  }

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });
};

/**
 * Records an authentication audit log event
 */
export const logAuthEvent = async ({
  accountId = null,
  identifier = "",
  action,
  role = null,
  portal = null,
  ipAddress = null,
  userAgent = null,
  status = "SUCCESS",
  failureReason = null,
  metadata = {},
}) => {
  try {
    await prisma.authAuditLog.create({
      data: {
        accountId,
        identifier: String(identifier || "").slice(0, 255),
        action,
        role: role ? String(role) : null,
        portal: portal ? String(portal) : null,
        ipAddress: ipAddress ? String(ipAddress).slice(0, 64) : null,
        userAgent: userAgent ? String(userAgent) : null,
        status,
        failureReason: failureReason ? String(failureReason).slice(0, 255) : null,
        metadata: metadata || {},
      },
    });
  } catch (err) {
    console.error("Failed to write AuthAuditLog:", err);
  }
};

/**
 * Authenticates user credentials and checks lockouts & portal authorization
 */
export const authenticateAccount = async ({
  identifier,
  password,
  targetPortal = null, // e.g. "CUSTOMER" | "ADMIN" | "MANUFACTURER" | "MARKETING_PARTNER"
  ipAddress = "",
  userAgent = "",
}) => {
  const normalized = normalizeIdentifier(identifier);
  if (normalized.type === "UNKNOWN") {
    await logAuthEvent({
      identifier,
      action: "LOGIN_FAILED",
      portal: targetPortal,
      ipAddress,
      userAgent,
      status: "FAILED",
      failureReason: "INVALID_IDENTIFIER_FORMAT",
    });
    throw new Error("Invalid email or password");
  }

  // Find AuthAccount by email or phone
  const account = await prisma.authAccount.findFirst({
    where: normalized.type === "EMAIL"
      ? { email: normalized.value }
      : { phone: normalized.value },
    include: {
      customerProfile: true,
      adminProfile: true,
      manufacturerProfile: true,
      marketingPartnerProfile: true,
    },
  });

  if (!account) {
    await logAuthEvent({
      identifier: normalized.value,
      action: "LOGIN_FAILED",
      portal: targetPortal,
      ipAddress,
      userAgent,
      status: "FAILED",
      failureReason: "ACCOUNT_NOT_FOUND",
    });
    throw new Error("Invalid email or password");
  }

  // Check Account Lockout
  const now = new Date();
  if (account.accountLockedUntil && account.accountLockedUntil > now) {
    const minutesLeft = Math.ceil((account.accountLockedUntil.getTime() - now.getTime()) / 60000);
    await logAuthEvent({
      accountId: account.id,
      identifier: normalized.value,
      action: "LOGIN_BLOCKED",
      role: account.role,
      portal: targetPortal,
      ipAddress,
      userAgent,
      status: "BLOCKED",
      failureReason: "ACCOUNT_LOCKED",
    });
    throw new Error(`Account temporarily locked due to failed attempts. Please try again in ${minutesLeft} minute(s).`);
  }

  // Verify Password
  const isMatch = await bcrypt.compare(password, account.passwordHash);
  if (!isMatch) {
    const nextFailedAttempts = account.failedLoginAttempts + 1;
    const shouldLock = nextFailedAttempts >= MAX_FAILED_ATTEMPTS;
    const lockUntil = shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;

    await prisma.authAccount.update({
      where: { id: account.id },
      data: {
        failedLoginAttempts: shouldLock ? 0 : nextFailedAttempts,
        accountLockedUntil: lockUntil,
      },
    });

    await logAuthEvent({
      accountId: account.id,
      identifier: normalized.value,
      action: shouldLock ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
      role: account.role,
      portal: targetPortal,
      ipAddress,
      userAgent,
      status: "FAILED",
      failureReason: shouldLock ? "MAX_ATTEMPTS_EXCEEDED" : "INVALID_PASSWORD",
    });

    if (shouldLock) {
      throw new Error("Account has been temporarily locked for 15 minutes due to multiple failed login attempts.");
    }

    throw new Error("Invalid email or password");
  }

  // Check Account Status
  const partnerProfileIsApproved =
    account.role === "MARKETING_PARTNER" &&
    account.marketingPartnerProfile &&
    account.marketingPartnerProfile.status === "ACTIVE";

  if (account.status !== "ACTIVE") {
    if (partnerProfileIsApproved) {
      await prisma.authAccount.update({
        where: { id: account.id },
        data: { status: "ACTIVE" },
      });
      account.status = "ACTIVE";
    } else {
      let message = "Your account is not active. Please contact administrator.";
      if (account.status === "PENDING_APPROVAL") {
        message = "Your registration is currently pending admin approval.";
      } else if (account.status === "SUSPENDED") {
        message = "Your account has been suspended. Please contact support.";
      } else if (account.status === "REJECTED") {
        message = "Your application was rejected. Please contact administrator.";
      }

      await logAuthEvent({
        accountId: account.id,
        identifier: normalized.value,
        action: "LOGIN_REJECTED",
        role: account.role,
        portal: targetPortal,
        ipAddress,
        userAgent,
        status: "FAILED",
        failureReason: `STATUS_${account.status}`,
      });

      throw new Error(message);
    }
  }

  // Validate Target Portal Authorization if specified
  if (targetPortal && String(account.role).toUpperCase() !== String(targetPortal).toUpperCase()) {
    // Admin has access to admin portal, manufacturer to manufacturer portal, etc.
    await logAuthEvent({
      accountId: account.id,
      identifier: normalized.value,
      action: "PORTAL_ACCESS_DENIED",
      role: account.role,
      portal: targetPortal,
      ipAddress,
      userAgent,
      status: "FAILED",
      failureReason: "ROLE_PORTAL_MISMATCH",
    });
    throw new Error("Access denied. You do not have permission to access this portal.");
  }

  // Successful Login: Reset failed attempts, update lastLoginAt
  await prisma.authAccount.update({
    where: { id: account.id },
    data: {
      failedLoginAttempts: 0,
      accountLockedUntil: null,
      lastLoginAt: now,
      lastLoginIp: ipAddress,
    },
  });

  // Extract Profile
  let profile = {};
  if (account.role === "ADMIN") {
    profile = account.adminProfile || { id: account.id, email: account.email, phone: account.phone };
  } else if (account.role === "MANUFACTURER") {
    profile = account.manufacturerProfile || { id: account.id, email: account.email };
    profile.businessName = profile.name || "";
  } else if (account.role === "MARKETING_PARTNER") {
    profile = account.marketingPartnerProfile || { id: account.id, email: account.email };
  } else {
    profile = account.customerProfile || { id: account.id, email: account.email };
  }

  const token = generateAuthToken(account, profile);

  await logAuthEvent({
    accountId: account.id,
    identifier: normalized.value,
    action: "LOGIN_SUCCESS",
    role: account.role,
    portal: targetPortal || account.role,
    ipAddress,
    userAgent,
    status: "SUCCESS",
  });

  return {
    account: {
      id: account.id,
      email: account.email,
      phone: account.phone,
      role: account.role,
      status: account.status,
    },
    profile,
    token,
  };
};
