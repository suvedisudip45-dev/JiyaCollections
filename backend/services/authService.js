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
import { normalizeRefreshPortal } from "../utils/refreshCookie.js";
import { hasMfaEvidence, requiresMfa } from "../security/mfaPolicy.js";
import { recordSystemAudit } from "./auditService.js";
import { logger } from "../utils/logger.js";

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
  const knownPortals = new Set(["CUSTOMER", "ADMIN", "MANUFACTURER", "DISTRIBUTOR", "MARKETING_PARTNER"]);
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
export const getAccountWorkspaceRoles = (account) => {
  const roleMappings = Array.isArray(account?.roleMappings) ? account.roleMappings : [];
  const mappedRoles = roleMappings
    .filter(({ isActive, role }) => isActive !== false && role?.isActive !== false)
    .map(({ role }) => String(role?.code || "").trim().toUpperCase())
    .filter(Boolean);
  const roles = mappedRoles.length || roleMappings.length
    ? mappedRoles
    : [String(account?.role || "CUSTOMER").toUpperCase()];
  return [...new Set(roles)];
};

export const accountHasWorkspaceRole = (account, role) =>
  getAccountWorkspaceRoles(account).includes(String(role || "").trim().toUpperCase());

export const getAccountProfile = (account, activeRole = account.role) => {
  if (activeRole === "ADMIN") {
    return account.adminProfile || { id: account.id, email: account.email, phone: account.phone };
  }
  if (activeRole === "MANUFACTURER") {
    const profile = account.manufacturerProfile || { id: account.id, email: account.email };
    profile.businessName = profile.name || "";
    return profile;
  }
  if (activeRole === "DISTRIBUTOR") {
    return account.distributorProfile || { id: account.id, email: account.email, phone: account.phone };
  }
  if (activeRole === "MARKETING_PARTNER") {
    return account.marketingPartnerProfile || { id: account.id, email: account.email };
  }
  return account.customerProfile || { id: account.id, email: account.email };
};

export const isWorkspaceProfileActive = (account, role) => {
  if (role === "DISTRIBUTOR") {
    return account.distributorProfile?.status === "ACTIVE" && account.distributorProfile?.isActive === true;
  }
  const profileField = {
    CUSTOMER: "customerProfile",
    ADMIN: "adminProfile",
    MANUFACTURER: "manufacturerProfile",
    MARKETING_PARTNER: "marketingPartnerProfile",
  }[role];
  return profileField ? Boolean(account[profileField]?.id) : false;
};

export const getActiveWorkspaceRoles = (account) =>
  getAccountWorkspaceRoles(account).filter((role) => isWorkspaceProfileActive(account, role));

export const generateAuthToken = (account, profile = {}, activeRole = account.role) => {
  return generateAccessToken({
    accountId: account.id,
    role: activeRole,
    email: account.email,
    phone: account.phone,
    profileId: profile.id || account.id,
    portalAccess: getAccountWorkspaceRoles(account),
  });
};

export const createLoginTokenPair = async ({
  account,
  profile,
  role = account.role,
  ipAddress,
  userAgent,
  mfaVerified = false,
  authMethods = [],
  tx = null,
}) => {
  const tokenFamilyId = createTokenFamilyId();
  const tokenInput = {
    accountId: account.id,
    role,
    email: account.email,
    phone: account.phone,
    profileId: profile.id || account.id,
    portalAccess: getAccountWorkspaceRoles(account),
    mfaVerified,
    authMethods,
  };
  const accessToken = generateAccessToken(tokenInput);
  const refreshToken = generateRefreshToken({ ...tokenInput, tokenFamilyId });
  const accessClaims = getTokenClaims(accessToken);
  const refreshClaims = getTokenClaims(refreshToken);

  const createSessions = async (sessionClient) => {
    await sessionClient.authSession.createMany({
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
  };
  if (tx) await createSessions(tx);
  else await prisma.$transaction(createSessions);

  return {
    accessToken,
    refreshToken,
    role,
    tokenFamilyId,
    refreshTokenExpiresAt: refreshClaims.exp * 1000,
  };
};

export const rotateRefreshToken = async ({
  refreshToken,
  targetPortal,
  ipAddress = "",
  userAgent = "",
  correlationId = null,
}) => {
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded.jti || !decoded.token_family_id || !decoded.accountId) {
    throw new Error("Invalid refresh token claims.");
  }
  if (normalizeRefreshPortal(targetPortal) !== normalizeRefreshPortal(decoded.role)) {
    const error = new Error("Refresh token does not belong to the requested portal.");
    error.code = "REFRESH_PORTAL_MISMATCH";
    throw error;
  }
  const refreshRole = String(decoded.role).toUpperCase();
  if (requiresMfa(refreshRole) && !hasMfaEvidence(decoded)) {
    const error = new Error("Multi-factor verification is required.");
    error.code = `${refreshRole}_MFA_REQUIRED`;
    throw error;
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
      correlationId,
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
      distributorProfile: true,
      marketingPartnerProfile: true,
      roleMappings: { include: { role: { select: { code: true, isActive: true } } } },
    },
  });
  if (!account || account.status !== "ACTIVE") {
    throw new Error("Account is not active.");
  }
  const activeRole = String(decoded.role || "").toUpperCase();
  if (!accountHasWorkspaceRole(account, activeRole) || !isWorkspaceProfileActive(account, activeRole)) {
    throw new Error("Refresh token identity is invalid.");
  }

  const profile = getAccountProfile(account, activeRole);
  const tokenInput = {
    accountId: account.id,
    role: activeRole,
    email: account.email,
    phone: account.phone,
    profileId: profile.id || account.id,
    portalAccess: getAccountWorkspaceRoles(account),
    mfaVerified: decoded.mfa_verified === true,
    authMethods: Array.isArray(decoded.amr) ? decoded.amr : [],
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
      correlationId,
    });
    throw createRefreshReuseError();
  }

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    tokenFamilyId: currentSession.tokenFamilyId,
    role: activeRole,
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
  correlationId,
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
    correlationId,
    status: "BLOCKED",
    failureReason: "REVOKED_REFRESH_TOKEN_REUSED",
    metadata: {
      tokenFamilyId,
      replacedByTokenId: replacedByTokenId || null,
    },
  });
};

export const switchAccountWorkspace = async ({
  accountId,
  currentTokenFamilyId,
  targetRole,
  mfaVerified = false,
  authMethods = [],
  ipAddress = "",
  userAgent = "",
  correlationId = null,
}) => {
  const role = String(targetRole || "").trim().toUpperCase();
  if (!["MANUFACTURER", "DISTRIBUTOR"].includes(role)) {
    const error = new Error("A valid manufacturer or distributor workspace is required.");
    error.statusCode = 400;
    error.code = "WORKSPACE_INVALID";
    throw error;
  }

  const account = await prisma.authAccount.findUnique({
    where: { id: accountId },
    include: {
      customerProfile: true,
      adminProfile: true,
      manufacturerProfile: true,
      distributorProfile: true,
      marketingPartnerProfile: true,
      roleMappings: { include: { role: { select: { code: true, isActive: true } } } },
    },
  });
  if (
    !account ||
    account.status !== "ACTIVE" ||
    !accountHasWorkspaceRole(account, role) ||
    !isWorkspaceProfileActive(account, role)
  ) {
    const error = new Error("This workspace is not approved for the account.");
    error.statusCode = 403;
    error.code = "WORKSPACE_NOT_GRANTED";
    throw error;
  }
  if (requiresMfa(role) && !mfaVerified) {
    const error = new Error("Complete multi-factor verification before switching to this workspace.");
    error.statusCode = 401;
    error.code = `${role}_MFA_REQUIRED`;
    throw error;
  }

  const profile = getAccountProfile(account, role);
  return prisma.$transaction(async (tx) => {
    const revoked = await tx.authSession.updateMany({
      where: {
        accountId,
        tokenFamilyId: currentTokenFamilyId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date(),
        lastUsedIp: String(ipAddress || "").slice(0, 64) || null,
        revocationReason: "WORKSPACE_SWITCH",
      },
    });
    if (revoked.count < 1) {
      const error = new Error("The current session is no longer active.");
      error.statusCode = 401;
      error.code = "INVALID_SESSION";
      throw error;
    }

    const tokenPair = await createLoginTokenPair({
      account,
      profile,
      role,
      ipAddress,
      userAgent,
      mfaVerified,
      authMethods,
      tx,
    });
    await logAuthEvent({
      accountId,
      identifier: account.email,
      action: "WORKSPACE_SWITCHED",
      role,
      portal: role,
      ipAddress,
      userAgent,
      status: "SUCCESS",
      correlationId,
      metadata: { tokenFamilyRotated: true },
    }, { client: tx });
    return {
      ...tokenPair,
      account: {
        id: account.id,
        email: account.email,
        phone: account.phone,
        role,
        status: account.status,
        mustChangePassword: Boolean(account.mustChangePassword),
      },
    };
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
  correlationId = null,
}, { client = prisma } = {}) => {
  try {
    await client.authAuditLog.create({
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
    const portalContext = String(portal || role || "").toUpperCase();
    const privilegedPortal = ["ADMIN", "MANUFACTURER", "MARKETING_PARTNER"].includes(portalContext);
    if (status !== "SUCCESS" || privilegedPortal) {
      const auditWrite = recordSystemAudit({
        actorId: status === "SUCCESS" ? accountId : null,
        actorRole: status === "SUCCESS" ? role : null,
        portalSource: portal || role,
        ipAddress,
        userAgent,
        correlationId,
      }, {
        action,
        entityType: status === "SUCCESS" ? "Authentication" : "SecurityEvent",
        entityId: accountId,
        status,
        failureReason,
        afterState: {
          role: role || null,
          portal: portal || role || null,
          outcome: status,
          reason: failureReason,
          details: metadata,
        },
      }, { client });
      if (client === prisma) {
        void auditWrite.catch((error) => logger.error("Unable to enqueue authentication audit event.", {
          action,
          correlationId,
          error: error.message || error,
        }));
      } else {
        await auditWrite;
      }
    }
  } catch (err) {
    logger.error("Failed to write authentication audit event.", {
      correlationId,
      error: err.message || err,
    });
  }
};

/**
 * Authenticates user credentials and checks lockouts & portal authorization
 */
export const authenticateAccount = async ({
  identifier,
  password,
  targetPortal = null, // Active workspace requested by the client.
  ipAddress = "",
  userAgent = "",
  correlationId = null,
}) => {
  const normalized = normalizeIdentifier(identifier);
  if (normalized.type === "UNKNOWN") {
    await logAuthEvent({
      identifier,
      action: "LOGIN_FAILED",
      portal: targetPortal,
      ipAddress,
      userAgent,
      correlationId,
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
      distributorProfile: true,
      marketingPartnerProfile: true,
      roleMappings: { include: { role: { select: { code: true, isActive: true } } } },
    },
  });

  if (!account) {
    await logAuthEvent({
      identifier: normalized.value,
      action: "LOGIN_FAILED",
      portal: targetPortal,
      ipAddress,
      userAgent,
      correlationId,
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
      correlationId,
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
      correlationId,
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
        correlationId,
        status: "FAILED",
        failureReason: `STATUS_${account.status}`,
      });

      throw new Error(message);
    }
  }

  const activeRole = String(targetPortal || account.role).trim().toUpperCase();
  if (!accountHasWorkspaceRole(account, activeRole) || !isWorkspaceProfileActive(account, activeRole)) {
    await logAuthEvent({
      accountId: account.id,
      identifier: normalized.value,
      action: "PORTAL_ACCESS_DENIED",
      role: activeRole,
      portal: activeRole,
      ipAddress,
      userAgent,
      correlationId,
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
  const profile = getAccountProfile(account, activeRole);

  const safeAccount = {
    id: account.id,
    email: account.email,
    phone: account.phone,
    role: activeRole,
    primaryRole: account.role,
    availableWorkspaces: getAccountWorkspaceRoles(account)
      .filter((role) => isWorkspaceProfileActive(account, role)),
    status: account.status,
    mustChangePassword: Boolean(account.mustChangePassword),
  };

  if (requiresMfa(activeRole)) {
    await logAuthEvent({
      accountId: account.id,
      identifier: normalized.value,
      action: `${activeRole}_PASSWORD_VERIFIED`,
      role: activeRole,
      portal: activeRole,
      ipAddress,
      userAgent,
      correlationId,
      status: "SUCCESS",
    });
    return { account: safeAccount, profile, requiresTwoFactor: true };
  }

  const tokenPair = await createLoginTokenPair({ account, profile, role: activeRole, ipAddress, userAgent });

  await logAuthEvent({
    accountId: account.id,
    identifier: normalized.value,
    action: "LOGIN_SUCCESS",
    role: activeRole,
    portal: activeRole,
    ipAddress,
    userAgent,
    correlationId,
    status: "SUCCESS",
  });

  return {
    account: safeAccount,
    profile,
    token: tokenPair.accessToken,
    accessToken: tokenPair.accessToken,
    refreshToken: tokenPair.refreshToken,
    tokenFamilyId: tokenPair.tokenFamilyId,
    refreshTokenExpiresAt: tokenPair.refreshTokenExpiresAt,
  };
};
