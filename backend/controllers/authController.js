import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";
import {
  authenticateAccount,
  logAuthEvent,
  resolvePassword,
  resolveTargetPortal,
  revokeTokenFamily,
  rotateRefreshToken,
  getAccountWorkspaceRoles,
  isWorkspaceProfileActive,
  switchAccountWorkspace,
} from "../services/authService.js";
import {
  createOtpChallenge,
  verifyOtpChallenge,
} from "../services/otpService.js";
import { serializeLoginResponse, serializeSessionProfile } from "../dtos/authDto.js";
import { resolveAccountPermissions } from "../services/rbacService.js";
import {
  createPortalTwoFactorChallenge,
  resendPortalTwoFactorCode,
  sendPortalTwoFactorCode,
  verifyPortalTwoFactorCode,
} from "../services/portalTwoFactorService.js";
import {
  clearRefreshCookie,
  getRefreshCookie,
  normalizeRefreshPortal,
  setRefreshCookie,
} from "../utils/refreshCookie.js";

/**
 * Unified Login Endpoint
 * POST /api/auth/login
 */
export const login = async (req, res) => {
  const ipAddress = req.ip || req.headers["x-forwarded-for"] || "";
  const userAgent = req.headers["user-agent"] || "";

  try {
    const { email, phone, identifier, portal, targetPortal } = req.body;
    const loginIdentifier = identifier || email || phone;

    if (!loginIdentifier) {
      return res.status(400).json({
        success: false,
        message: "Email or mobile number is required.",
      });
    }

    let password;
    try {
      password = resolvePassword(req.body);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message || "Password is required.",
      });
    }

    const portalHint = resolveTargetPortal(portal || targetPortal);
    const authResult = await authenticateAccount({
      identifier: loginIdentifier,
      password,
      targetPortal: portalHint,
      ipAddress,
      userAgent,
      correlationId: req.correlationId || null,
    });
    if (authResult.requiresTwoFactor) {
      const challenge = await createPortalTwoFactorChallenge({
        accountId: authResult.account.id,
        portal: authResult.account.role,
        ipAddress,
        userAgent,
        correlationId: req.correlationId || null,
      });
      return res.json({
        success: true,
        message: "Additional verification required.",
        requiresTwoFactor: true,
        ...challenge,
      });
    }
    setRefreshCookie(res, authResult.account.role, authResult.refreshToken, authResult.refreshTokenExpiresAt);

    return res.json(serializeLoginResponse(authResult));
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Authentication failed.",
    });
  }
};

const sendTwoFactorResponse = async (req, res, expectedPortal = null) => {
  try {
    const result = await sendPortalTwoFactorCode({
      challengeId: req.body?.challengeId,
      method: req.body?.method,
    }, {
      expectedPortal,
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId || null,
    });
    return res.status(202).json({
      success: true,
      message: "Verification code queued for delivery.",
      method: result.method,
      expiresAt: result.expiresAt,
      resendAvailableAt: result.resendAvailableAt,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Verification request failed.",
      code: error.code || "PORTAL_2FA_SEND_FAILED",
    });
  }
};

export const sendPortalTwoFactor = (req, res) => sendTwoFactorResponse(req, res);
export const sendAdminTwoFactor = (req, res) => sendTwoFactorResponse(req, res, "ADMIN");

export const resendPortalTwoFactor = async (req, res) => {
  try {
    const result = await resendPortalTwoFactorCode({ challengeId: req.body?.challengeId }, {
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId || null,
    });
    return res.status(202).json({
      success: true,
      message: "Verification code queued for delivery.",
      method: result.method,
      expiresAt: result.expiresAt,
      resendAvailableAt: result.resendAvailableAt,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.statusCode === 429 ? error.message : "Verification request failed.",
      code: error.code || "PORTAL_2FA_RESEND_FAILED",
    });
  }
};

const verifyTwoFactorResponse = async (req, res, expectedPortal = null) => {
  try {
    const result = await verifyPortalTwoFactorCode({
      challengeId: req.body?.challengeId,
      otp: req.body?.otp,
    }, {
      expectedPortal,
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId || null,
    });
    setRefreshCookie(res, result.account.role, result.tokenPair.refreshToken, result.tokenPair.refreshTokenExpiresAt);
    return res.json(serializeLoginResponse({ ...result.tokenPair, account: result.account }));
  } catch (error) {
    return res.status(error.statusCode || 401).json({
      success: false,
      message: error.statusCode === 503 ? error.message : "Invalid or expired verification code.",
      code: error.code || "PORTAL_2FA_INVALID",
    });
  }
};

export const verifyPortalTwoFactor = (req, res) => verifyTwoFactorResponse(req, res);
export const verifyAdminTwoFactor = (req, res) => verifyTwoFactorResponse(req, res, "ADMIN");

/**
 * Rotates a refresh token and returns a new access/refresh pair.
 * POST /api/auth/refresh
 */
export const refresh = async (req, res) => {
  const portal = normalizeRefreshPortal(req.body?.portal || req.headers["x-auth-portal"]);
  if (!portal) {
    return res.status(400).json({
      success: false,
      message: "A valid portal is required to refresh the session.",
      code: "REFRESH_PORTAL_REQUIRED",
    });
  }

  const refreshToken = getRefreshCookie(req, portal);
  if (!refreshToken) {
    clearRefreshCookie(res, portal);
    return res.status(400).json({
      success: false,
      message: "Refresh token is required.",
      code: "REFRESH_TOKEN_REQUIRED",
    });
  }

  try {
    const tokenPair = await rotateRefreshToken({
      refreshToken,
      targetPortal: portal,
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId || null,
    });
    setRefreshCookie(res, tokenPair.role, tokenPair.refreshToken, tokenPair.refreshTokenExpiresAt);

    return res.json({
      success: true,
      message: "Token refreshed successfully.",
      token: tokenPair.accessToken,
      accessToken: tokenPair.accessToken,
      refreshTokenExpiresAt: tokenPair.refreshTokenExpiresAt,
    });
  } catch (error) {
    clearRefreshCookie(res, portal);
    return res.status(401).json({
      success: false,
      message: error.message || "Invalid refresh token.",
      code: error.code || "INVALID_REFRESH_TOKEN",
    });
  }
};

/**
 * Session Profile Endpoint
 * GET /api/auth/me
 */
export const getMe = async (req, res) => {
  try {
    const { accountId, role } = req.auth;
    const account = await prisma.authAccount.findUnique({
      where: { id: accountId },
      include: {
        customerProfile: true,
        adminProfile: true,
        manufacturerProfile: true,
        distributorProfile: true,
        marketingPartnerProfile: true,
        roleMappings: {
          include: { role: { select: { id: true, code: true, name: true, isActive: true } } },
        },
      },
    });

    if (!account) {
      return res.status(404).json({ success: false, message: "Account not found." });
    }

    const availableWorkspaces = getAccountWorkspaceRoles(account)
      .filter((workspaceRole) => isWorkspaceProfileActive(account, workspaceRole))
      .map((code) => ({
        code,
        name: {
          MANUFACTURER: "Manufacturer",
          DISTRIBUTOR: "Distributor",
          ADMIN: "Administrator",
          CUSTOMER: "Customer",
          MARKETING_PARTNER: "Marketing partner",
        }[code] || code,
      }));
    const sessionProfile = serializeSessionProfile({ ...account, availableWorkspaces }, role);
    const permissions = await resolveAccountPermissions(accountId, { principalRole: role });
    return res.json({
      ...sessionProfile,
      account: {
        ...sessionProfile.account,
        permissions: [...permissions].sort(),
        roles: availableWorkspaces,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const switchWorkspace = async (req, res) => {
  try {
    const targetRole = resolveTargetPortal(req.body?.role || req.body?.workspace);
    if (!targetRole) {
      return res.status(400).json({
        success: false,
        message: "A valid manufacturer or distributor workspace is required.",
        code: "WORKSPACE_INVALID",
      });
    }
    const result = await switchAccountWorkspace({
      accountId: req.auth.accountId,
      currentTokenFamilyId: req.auth.tokenFamilyId,
      targetRole,
      mfaVerified: req.auth.mfaVerified,
      authMethods: req.auth.authMethods,
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId || null,
    });
    if (targetRole !== req.auth.role) clearRefreshCookie(res, req.auth.role);
    setRefreshCookie(res, targetRole, result.refreshToken, result.refreshTokenExpiresAt);
    return res.json(serializeLoginResponse({
      accessToken: result.accessToken,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt,
      account: result.account,
    }));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Workspace could not be changed.",
      code: error.code || "WORKSPACE_SWITCH_FAILED",
    });
  }
};

/**
 * Logout Endpoint
 * POST /api/auth/logout
 */
export const logout = async (req, res) => {
  try {
    if (!req.auth?.accountId || !req.auth?.tokenFamilyId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated session is required.",
        code: "INVALID_SESSION",
      });
    }

    await revokeTokenFamily({
      accountId: req.auth.accountId,
      tokenFamilyId: req.auth.tokenFamilyId,
      reason: "LOGOUT",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
    });

    await logAuthEvent({
      accountId: req.auth.accountId,
      identifier: req.auth.email || req.auth.phone || "",
      action: "LOGOUT",
      role: req.auth.role,
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId || null,
      status: "SUCCESS",
    });
    clearRefreshCookie(res, req.auth.role);

    return res.json({ success: true, message: "Logged out successfully." });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Logout could not be completed.",
      code: "LOGOUT_FAILED",
    });
  }
};

/**
 * Change Password Endpoint
 * POST /api/auth/change-password
 */
export const changePassword = async (req, res) => {
  try {
    const { accountId } = req.auth;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required.",
      });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters long.",
      });
    }

    const account = await prisma.authAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return res.status(404).json({ success: false, message: "Account not found." });
    }

    const isMatch = await bcrypt.compare(currentPassword, account.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Incorrect current password." });
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await prisma.authAccount.update({
      where: { id: accountId },
      data: {
        passwordHash: newHash,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });

    await logAuthEvent({
      accountId,
      identifier: account.email,
      action: "PASSWORD_CHANGED",
      role: account.role,
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId || null,
      status: "SUCCESS",
    });

    return res.json({ success: true, message: "Password changed successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Request OTP Challenge
 * POST /api/auth/otp/request
 */
export const requestOtp = async (req, res) => {
  try {
    const { destination, channel = "SMS", purpose = "LOGIN" } = req.body;
    if (!destination) {
      return res.status(400).json({ success: false, message: "Destination (email or phone) is required." });
    }

    const result = await createOtpChallenge({
      destination,
      channel,
      purpose,
    });

    return res.json({
      success: true,
      message: `OTP challenge created and dispatched via ${channel}.`,
      challenge: result,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * Verify OTP Challenge
 * POST /api/auth/otp/verify
 */
export const verifyOtp = async (req, res) => {
  try {
    const { destination, code, purpose = "LOGIN" } = req.body;
    if (!destination || !code) {
      return res.status(400).json({ success: false, message: "Destination and OTP code are required." });
    }

    const result = await verifyOtpChallenge({
      destination,
      purpose,
      code,
    });

    return res.json({
      success: true,
      message: "OTP verified successfully.",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
