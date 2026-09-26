import bcrypt from "bcryptjs";
import validator from "validator";
import { prisma } from "../config/db.js";
import {
  createTokenFamilyId,
  generateAccessToken,
  generateRefreshToken,
  getTokenClaims,
  verifyRefreshToken,
} from "./tokenService.js";
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
  const { password, encryptedPassword } = body;
  if (encryptedPassword) {
    try {
      return decryptAES(encryptedPassword);
    } catch {
      throw new Error("Invalid encrypted credentials");
    }
  }
  if (password) {
    return String(password);
  }
  throw new Error("Password is required");
};

export const resolveTargetPortal = (rawTargetPortal) => {
  if (!rawTargetPortal) return null;
  const normalized = String(rawTargetPortal).trim().toUpperCase();
  const knownPortals = new Set(["CUSTOMER", "ADMIN", "MANUFACTURER", "MARKETING_PARTNER"]);
  if (knownPortals.has(normalized)) return normalized;

  try {
    const decrypted = decryptAES(rawTargetPortal).trim().toUpperCase();
    return knownPortals.has(decrypted) ? decrypted : null;
  } catch {
    throw new Error("Invalid target portal");
  }
};

/**
 * Creates a standardized JWT token
 */
export const generateAuthToken = (account, profile = {}) => {
  return generateAccessToken({
    accountId: account.id,
    role: account.role,
    email: account.email,
    phone: account.phone,
    profileId: profile.id || account.id,
    portalAccess: [account.role],
  });
};

const createLoginTokenPair = async ({ account, profile, ipAddress, userAgent }) => {
  const tokenFamilyId = createTokenFamilyId();
  const tokenInput = {
    accountId: account.id,
    role: account.role,
    email: account.email,
    phone: account.phone,
    profileId: profile.id || account.id,
    portalAccess: [account.role],
  };
  const accessToken = generateAccessToken(tokenInput);
  const refreshToken = generateRefreshToken({ ...tokenInput, tokenFamilyId });
  const accessClaims = getTokenClaims(accessToken);
  const refreshClaims = getTokenClaims(refreshToken);

  await prisma.$transaction(async (tx) => {
    await tx.authSession.createMany({
      data: [
        {
          accountId: account.id,
          tokenFamilyId,
          jti: accessClaims.jti,
          tokenType: "ACCESS",
          issuedAt: new Date(accessClaims.iat * 1000),
          expiresAt: new Date(accessClaims.exp * 1000),
          createdIp: String(ipAddress || "").slice(0, 64) || null,
          userAgent: userAgent || null,
        },
        {
          accountId: account.id,
          tokenFamilyId,
          jti: refreshClaims.jti,
          tokenType: "REFRESH",
          issuedAt: new Date(refreshClaims.iat * 1000),
          expiresAt: new Date(refreshClaims.exp * 1000),
          createdIp: String(ipAddress || "").slice(0, 64) || null,
          userAgent: userAgent || null,
        },
      ],
    });
  });

  return {
    accessToken,
    refreshToken,
    tokenFamilyId,
    refreshTokenExpiresAt: refreshClaims.exp * 1000,
  };
};

const getAccountProfile = (account) => {
  if (account.role === "ADMIN") {
    return account.adminProfile || { id: account.id, email: account.email, phone: account.phone };
  }
  if (account.role === "MANUFACTURER") {
    const profile = account.manufacturerProfile || { id: account.id, email: account.email };
    profile.businessName = profile.name || "";
    return profile;
  }
  if (account.role === "MARKETING_PARTNER") {
    return account.marketingPartnerProfile || { id: account.id, email: account.email };
  }
  return account.customerProfile || { id: account.id, email: account.email };
};

export const rotateRefreshToken = async ({ refreshToken, ipAddress = "", userAgent = "" }) => {
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded.jti || !decoded.token_family_id || !decoded.accountId) {
    throw new Error("Invalid refresh token claims.");
  }

  const currentSession = await prisma.authSession.findUnique({
    where: { jti: decoded.jti },
  });
  if (
    !currentSession ||
    currentSession.tokenType !== "REFRESH" ||
    currentSession.accountId !== decoded.accountId ||
    currentSession.tokenFamilyId !== decoded.token_family_id
  ) {
    throw new Error("Refresh token is invalid or has already been rotated.");
  }

  if (currentSession.revokedAt) {
    await invalidateRefreshFamilyOnReuse({
      accountId: currentSession.accountId,
      tokenFamilyId: currentSession.tokenFamilyId,
      tokenId: currentSession.jti,
      replacedByTokenId: currentSession.replacedByTokenId,
      role: decoded.role,
      ipAddress,
      userAgent,
    });
    throw createRefreshReuseError();
  }

  if (currentSession.expiresAt <= new Date()) {
    throw new Error("Refresh token is invalid or has expired.");
  }

  const account = await prisma.authAccount.findUnique({
    where: { id: currentSession.accountId },
    include: {
      customerProfile: true,
      adminProfile: true,
      manufacturerProfile: true,
      marketingPartnerProfile: true,
    },
  });
  if (!account || account.status !== "ACTIVE") {
    throw new Error("Account is not active.");
  }
  if (String(account.role).toUpperCase() !== String(decoded.role).toUpperCase()) {
    throw new Error("Refresh token identity is invalid.");
  }

  const profile = getAccountProfile(account);
  const tokenInput = {
    accountId: account.id,
    role: account.role,
    email: account.email,
    phone: account.phone,
    profileId: profile.id || account.id,
    portalAccess: [account.role],
  };
  const accessToken = generateAccessToken(tokenInput);
  const nextRefreshToken = generateRefreshToken({
    ...tokenInput,
    tokenFamilyId: currentSession.tokenFamilyId,
  });
  const accessClaims = getTokenClaims(accessToken);
  const refreshClaims = getTokenClaims(nextRefreshToken);

  try {
    await prisma.$transaction(async (tx) => {
      const revoked = await tx.authSession.updateMany({
        where: {
          jti: currentSession.jti,
          tokenType: "REFRESH",
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          replacedByTokenId: refreshClaims.jti,
          lastUsedAt: new Date(),
          lastUsedIp: String(ipAddress || "").slice(0, 64) || null,
          revocationReason: "ROTATED",
        },
      });

      if (revoked.count !== 1) {
        throw createRefreshRotationConflictError();
      }

      await tx.authSession.createMany({
        data: [
          {
            accountId: account.id,
            tokenFamilyId: currentSession.tokenFamilyId,
            jti: accessClaims.jti,
            tokenType: "ACCESS",
            issuedAt: new Date(accessClaims.iat * 1000),
            expiresAt: new Date(accessClaims.exp * 1000),
            createdIp: String(ipAddress || "").slice(0, 64) || null,
            userAgent: userAgent || null,
          },
          {
            accountId: account.id,
            tokenFamilyId: currentSession.tokenFamilyId,
            jti: refreshClaims.jti,
            tokenType: "REFRESH",
            issuedAt: new Date(refreshClaims.iat * 1000),
            expiresAt: new Date(refreshClaims.exp * 1000),
            createdIp: String(ipAddress || "").slice(0, 64) || null,
            userAgent: userAgent || null,
          },
        ],
      });
    });
  } catch (error) {
    if (error.code !== "REFRESH_ROTATION_CONFLICT") {
      throw error;
    }

    await invalidateRefreshFamilyOnReuse({
      accountId: currentSession.accountId,
      tokenFamilyId: currentSession.tokenFamilyId,
      tokenId: currentSession.jti,
      replacedByTokenId: currentSession.replacedByTokenId,
      role: decoded.role,
      ipAddress,
      userAgent,
    });
    throw createRefreshReuseError();
  }

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    tokenFamilyId: currentSession.tokenFamilyId,
    refreshTokenExpiresAt: refreshClaims.exp * 1000,
  };
};

const createRefreshReuseError = () => {
  const error = new Error("Refresh token reuse detected. The session family has been invalidated.");
  error.code = "REFRESH_TOKEN_REUSE_DETECTED";
  return error;
};

const createRefreshRotationConflictError = () => {
  const error = new Error("Refresh token rotation conflict.");
  error.code = "REFRESH_ROTATION_CONFLICT";
  return error;
};

const invalidateRefreshFamilyOnReuse = async ({
  accountId,
  tokenFamilyId,
  tokenId,
  replacedByTokenId,
  role,
  ipAddress,
  userAgent,
}) => {
  const revokedAt = new Date();
  await prisma.authSession.updateMany({
    where: {
      accountId,
      tokenFamilyId,
      revokedAt: null,
    },
    data: {
      revokedAt,
      lastUsedAt: revokedAt,
      lastUsedIp: String(ipAddress || "").slice(0, 64) || null,
      revocationReason: "REFRESH_TOKEN_REUSE",
    },
  });

  await logAuthEvent({
    accountId,
    identifier: tokenId,
    action: "REFRESH_TOKEN_REUSE_DETECTED",
    role,
    ipAddress,
    userAgent,
    status: "BLOCKED",
    failureReason: "REVOKED_REFRESH_TOKEN_REUSED",
    metadata: {
      tokenFamilyId,
      replacedByTokenId: replacedByTokenId || null,
    },
  });
};

export const revokeTokenFamily = async ({
  accountId,
  tokenFamilyId,
  reason = "LOGOUT",
  ipAddress = "",
}) => {
  if (!accountId || !tokenFamilyId) {
    throw new Error("Authenticated session context is required for logout.");
  }

  const revokedAt = new Date();
  const result = await prisma.authSession.updateMany({
    where: {
      accountId,
      tokenFamilyId,
      revokedAt: null,
    },
    data: {
      revokedAt,
      lastUsedAt: revokedAt,
      lastUsedIp: String(ipAddress || "").slice(0, 64) || null,
      revocationReason: reason,
    },
  });

  return result.count;
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
  const profile = getAccountProfile(account);

  const tokenPair = await createLoginTokenPair({ account, profile, ipAddress, userAgent });

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
    token: tokenPair.accessToken,
    accessToken: tokenPair.accessToken,
    refreshToken: tokenPair.refreshToken,
    tokenFamilyId: tokenPair.tokenFamilyId,
    refreshTokenExpiresAt: tokenPair.refreshTokenExpiresAt,
  };
};
