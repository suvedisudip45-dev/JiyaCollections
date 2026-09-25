import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";
import {
  authenticateAccount,
  logAuthEvent,
  resolvePassword,
  revokeTokenFamily,
  rotateRefreshToken,
} from "../services/authService.js";
import {
  createOtpChallenge,
  verifyOtpChallenge,
} from "../services/otpService.js";

const REFRESH_COOKIE_NAME = "refresh_token";
const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/auth",
});

const setRefreshCookie = (res, refreshToken) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
};

const getRefreshCookie = (req) => {
  const cookieHeader = req.headers.cookie || "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${REFRESH_COOKIE_NAME}=`));
  return cookie ? decodeURIComponent(cookie.slice(REFRESH_COOKIE_NAME.length + 1)) : "";
};

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

    const portalHint = portal || targetPortal || null;
    const authResult = await authenticateAccount({
      identifier: loginIdentifier,
      password,
      targetPortal: portalHint,
      ipAddress,
      userAgent,
    });
    setRefreshCookie(res, authResult.refreshToken);

    return res.json({
      success: true,
      message: "Authentication successful",
      token: authResult.token,
      accessToken: authResult.accessToken,
      account: authResult.account,
      user: authResult.profile,
      manufacturer: authResult.profile,
      partner: authResult.profile,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Authentication failed.",
    });
  }
};

/**
 * Rotates a refresh token and returns a new access/refresh pair.
 * POST /api/auth/refresh
 */
export const refresh = async (req, res) => {
  const refreshToken = getRefreshCookie(req) || req.body?.refreshToken || req.body?.token;
  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      message: "Refresh token is required.",
    });
  }

  try {
    const tokenPair = await rotateRefreshToken({
      refreshToken,
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
      userAgent: req.headers["user-agent"] || "",
    });
    setRefreshCookie(res, tokenPair.refreshToken);

    return res.json({
      success: true,
      message: "Token refreshed successfully.",
      token: tokenPair.accessToken,
      accessToken: tokenPair.accessToken,
    });
  } catch (error) {
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
        marketingPartnerProfile: true,
      },
    });

    if (!account) {
      return res.status(404).json({ success: false, message: "Account not found." });
    }

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

    const { passwordHash: _, ...safeAccount } = account;

    return res.json({
      success: true,
      account: safeAccount,
      profile,
      role: account.role,
      user: profile,
      manufacturer: profile,
      partner: profile,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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
      status: "SUCCESS",
    });
    clearRefreshCookie(res);

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
      },
    });

    await logAuthEvent({
      accountId,
      identifier: account.email,
      action: "PASSWORD_CHANGED",
      role: account.role,
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
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
