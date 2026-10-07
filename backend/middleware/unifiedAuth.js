import { prisma } from "../config/db.js";
import { hasVerifiedMfa, verifyAccessToken } from "../services/tokenService.js";
import { accountHasWorkspaceRole, getActiveWorkspaceRoles, isWorkspaceProfileActive } from "../services/authService.js";
import { requiresMfa } from "../security/mfaPolicy.js";

export { authorize, authorizeAny } from "./authorize.js";

/**
 * Extracts token from headers (supporting standard Authorization header, token, adminToken, manufacturerToken)
 */
export const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }
  return req.headers.token || req.headers.admintoken || req.headers.manufacturertoken || req.headers.distributortoken || null;
};

/**
 * Unified Authentication Middleware
 */
export const createAuthenticate = (client = prisma) => async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not Authorized. Login required.",
      });
    }

    const decoded = verifyAccessToken(token);
    if (!decoded || typeof decoded !== "object") {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    if (!decoded.jti || decoded.token_type !== "access") {
      return res.status(401).json({
        success: false,
        message: "Invalid access token.",
        code: "INVALID_ACCESS_TOKEN",
      });
    }

    const session = await client.authSession.findUnique({
      where: { jti: decoded.jti },
      select: {
        id: true,
        accountId: true,
        tokenFamilyId: true,
        tokenType: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (
      !session ||
      session.tokenType !== "ACCESS" ||
      session.accountId !== decoded.accountId ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      return res.status(401).json({
        success: false,
        message: "Authentication session is invalid or revoked.",
        code: "INVALID_SESSION",
      });
    }

    const role = (decoded.role || "CUSTOMER").toUpperCase();
    let accountId = decoded.accountId || decoded.id || decoded.userId || decoded.adminId || decoded.manufacturerId || decoded.partnerId;
    const profileId = decoded.profileId || decoded.id || decoded.userId || decoded.adminId || decoded.manufacturerId || decoded.partnerId;

    if (!decoded.accountId && profileId) {
      const profileLookup = {
        CUSTOMER: () => client.user.findUnique({ where: { id: profileId }, select: { accountId: true } }),
        ADMIN: () => client.admin.findUnique({ where: { id: profileId }, select: { accountId: true } }),
        MANUFACTURER: () => client.manufacturer.findUnique({ where: { id: profileId }, select: { accountId: true } }),
        DISTRIBUTOR: () => client.distributor.findUnique({ where: { id: profileId }, select: { accountId: true } }),
        MARKETING_PARTNER: () => client.marketingPartner.findUnique({ where: { id: profileId }, select: { accountId: true } }),
      }[role];
      const profile = profileLookup ? await profileLookup() : null;
      accountId = profile?.accountId || null;
    }

    const account = accountId
      ? await client.authAccount.findUnique({
          where: { id: accountId },
          select: {
            id: true,
            role: true,
            status: true,
            mustChangePassword: true,
            customerProfile: { select: { id: true } },
            adminProfile: { select: { id: true } },
            manufacturerProfile: {
              select: {
                id: true,
                accountId: true,
                name: true,
                email: true,
                phone: true,
                city: true,
                isActive: true,
                isAvailable: true,
                contractStatus: true,
              },
            },
            distributorProfile: {
              select: {
                id: true,
                accountId: true,
                name: true,
                phone: true,
                address: true,
                city: true,
                status: true,
                isActive: true,
              },
            },
            marketingPartnerProfile: { select: { id: true } },
            roleMappings: { include: { role: { select: { code: true, isActive: true } } } },
          },
        })
      : null;
    if (!account || !accountHasWorkspaceRole(account, role)) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication identity.",
        code: "INVALID_IDENTITY",
      });
    }
    if (!isWorkspaceProfileActive(account, role)) {
      return res.status(403).json({
        success: false,
        message: "This workspace is not active.",
        code: "WORKSPACE_INACTIVE",
      });
    }
    if (requiresMfa(role) && !hasVerifiedMfa(decoded)) {
      return res.status(401).json({
        success: false,
        message: "Multi-factor verification is required.",
        code: `${role}_MFA_REQUIRED`,
      });
    }
    if (account.status !== "ACTIVE") {
      return res.status(401).json({
        success: false,
        message: "Account is not active.",
        code: "ACCOUNT_INACTIVE",
      });
    }
    const passwordChangeAllowedPaths = new Set([
      "/api/auth/me",
      "/api/auth/logout",
      "/api/auth/change-password",
      "/api/user/admin/change-password",
    ]);
    const requestPath = String(req.originalUrl || req.url || "").split("?")[0];
    if (account.mustChangePassword && !passwordChangeAllowedPaths.has(requestPath)) {
      return res.status(403).json({
        success: false,
        message: "Change your initial password before using the Admin Portal.",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }

    const canonicalProfileId = {
      CUSTOMER: account.customerProfile?.id,
      ADMIN: account.adminProfile?.id,
      MANUFACTURER: account.manufacturerProfile?.id,
      DISTRIBUTOR: account.distributorProfile?.id,
      MARKETING_PARTNER: account.marketingPartnerProfile?.id,
    }[role] || account.id;
    if (profileId !== canonicalProfileId && profileId !== account.id) {
      return res.status(401).json({
        success: false,
        message: "Invalid authenticated profile ownership.",
        code: "INVALID_PROFILE_OWNER",
      });
    }

    const roles = getActiveWorkspaceRoles(account);
    const manufacturer = roles.includes("MANUFACTURER") ? account.manufacturerProfile : null;
    const distributor = roles.includes("DISTRIBUTOR") ? account.distributorProfile : null;

    req.auth = {
      userId: profileId,
      accountId,
      profileId,
      roles,
      tokenId: decoded.jti,
      tokenType: decoded.token_type,
      mfaVerified: hasVerifiedMfa(decoded),
      sessionId: session.id,
      tokenFamilyId: session.tokenFamilyId,
      mustChangePassword: account.mustChangePassword,
      manufacturerId: manufacturer?.id || null,
      distributorId: distributor?.id || null,
      manufacturer,
      distributor,
      partnerId: decoded.partnerId || null,
      authMethods: Array.isArray(decoded.amr) ? decoded.amr : [],
      role,
      email: decoded.email || "",
      phone: decoded.phone || "",
    };

    if (!req.body) req.body = {};

    // Backward compatibility for existing controllers
    if (role === "ADMIN") {
      req.adminId = profileId;
      req.body.adminId = profileId;
    } else if (role === "MANUFACTURER") {
      req.manufacturerId = req.auth.manufacturerId || profileId;
      req.body.manufacturerId = req.manufacturerId;
    } else if (role === "DISTRIBUTOR") {
      req.distributorId = req.auth.distributorId || profileId;
      req.body.distributorId = req.distributorId;
    } else if (role === "MARKETING_PARTNER") {
      req.partnerId = profileId;
      req.body.partnerId = profileId;
    } else {
      req.userId = profileId;
      req.body.userId = profileId;
    }

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Session expired. Please log in again.",
        code: "TOKEN_EXPIRED",
      });
    }
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
      code: "INVALID_TOKEN",
    });
  }
};

export const authenticate = createAuthenticate();

/**
 * Middleware requiring specific roles
 */
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.auth || !req.auth.role) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const normalizedAllowed = allowedRoles.map((r) => String(r).toUpperCase());
    const authenticatedRoles = Array.isArray(req.auth.roles) && req.auth.roles.length > 0
      ? req.auth.roles.map((r) => String(r).toUpperCase())
      : [String(req.auth.role).toUpperCase()];
    if (!normalizedAllowed.some((allowedRole) => authenticatedRoles.includes(allowedRole))) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Requires one of: ${allowedRoles.join(", ")}`,
        code: "FORBIDDEN",
      });
    }

    next();
  };
};

/**
 * Middleware requiring specific portal access
 */
export const requirePortal = (portalName) => {
  const portalRoleMap = {
    CUSTOMER: ["CUSTOMER"],
    ADMIN: ["ADMIN"],
    MANUFACTURER: ["MANUFACTURER"],
    DISTRIBUTOR: ["DISTRIBUTOR"],
    MARKETING: ["MARKETING_PARTNER"],
  };

  const allowed = portalRoleMap[portalName.toUpperCase()] || [portalName.toUpperCase()];
  return requireRole(...allowed);
};

export const requireAdmin = [authenticate, requireRole("ADMIN")];
export const requireCustomer = [authenticate, requireRole("CUSTOMER")];
export const requireManufacturer = [authenticate, requireRole("MANUFACTURER")];
export const requireDistributor = [authenticate, requireRole("DISTRIBUTOR")];
export const requireMarketingPartner = [authenticate, requireRole("MARKETING_PARTNER")];

const hasPortalRole = (req, allowedRoles) => {
  const authenticatedRoles = Array.isArray(req.auth?.roles) && req.auth.roles.length > 0
    ? req.auth.roles
    : [req.auth?.role];
  return authenticatedRoles.some((role) => allowedRoles.includes(String(role).toUpperCase()));
};

export const setManufacturerContext = (req, res, next) => {
  if (!req.auth?.accountId) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  if (!hasPortalRole(req, ["MANUFACTURER", "ADMIN"])) {
    return res.status(403).json({
      success: false,
      message: "Manufacturer portal access is required.",
      code: "PORTAL_FORBIDDEN",
    });
  }

  const manufacturerId = req.auth.manufacturerId || (hasPortalRole(req, ["ADMIN"]) ? req.auth.profileId || req.auth.accountId : null);
  if (!manufacturerId) {
    return res.status(403).json({
      success: false,
      message: "An active manufacturer profile is required.",
      code: "MANUFACTURER_PROFILE_REQUIRED",
    });
  }
  if (!req.body) req.body = {};
  req.manufacturer = req.auth.manufacturer || null;
  req.manufacturerId = manufacturerId;
  req.body.manufacturerId = manufacturerId;
  delete req.body.manufacturerIdOverride;
  next();
};

export const setDistributorContext = (req, res, next) => {
  if (!req.auth?.accountId) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  if (!hasPortalRole(req, ["DISTRIBUTOR", "ADMIN"])) {
    return res.status(403).json({
      success: false,
      message: "Distributor portal access is required.",
      code: "PORTAL_FORBIDDEN",
    });
  }

  const distributorId = req.auth.distributorId;
  if (!distributorId) {
    return res.status(403).json({
      success: false,
      message: "An approved distributor profile is required.",
      code: "DISTRIBUTOR_PROFILE_REQUIRED",
    });
  }
  if (!req.body) req.body = {};
  req.distributor = req.auth.distributor;
  req.distributorId = distributorId;
  req.body.distributorId = distributorId;
  delete req.body.distributorIdOverride;
  next();
};

export const setFulfillmentContext = (req, res, next) => {
  if (!req.auth?.accountId) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  if (!hasPortalRole(req, ["DISTRIBUTOR", "MANUFACTURER", "ADMIN"])) {
    return res.status(403).json({
      success: false,
      message: "Order fulfillment portal access is required.",
      code: "PORTAL_FORBIDDEN",
    });
  }

  if (!req.body) req.body = {};

  if (req.auth.distributorId) {
    req.distributor = req.auth.distributor;
    req.distributorId = req.auth.distributorId;
    req.body.distributorId = req.auth.distributorId;
  }
  if (req.auth.manufacturerId) {
    req.manufacturer = req.auth.manufacturer;
    req.manufacturerId = req.auth.manufacturerId;
    req.body.manufacturerId = req.auth.manufacturerId;
  }
  if (hasPortalRole(req, ["ADMIN"]) && !req.distributorId && !req.manufacturerId) {
    const fallbackId = req.auth.profileId || req.auth.accountId;
    req.adminId = fallbackId;
    req.body.adminId = fallbackId;
  }

  if (!req.distributorId && !req.manufacturerId && !hasPortalRole(req, ["ADMIN"])) {
    return res.status(403).json({
      success: false,
      message: "An active distributor or manufacturer profile is required.",
      code: "PROFILE_REQUIRED",
    });
  }

  delete req.body.distributorIdOverride;
  delete req.body.manufacturerIdOverride;
  next();
};

export const setMarketingPartnerContext = (req, res, next) => {
  if (!req.auth?.accountId) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  if (!hasPortalRole(req, ["MARKETING_PARTNER", "ADMIN"])) {
    return res.status(403).json({
      success: false,
      message: "Marketing partner portal access is required.",
      code: "PORTAL_FORBIDDEN",
    });
  }

  const partnerId = req.auth.partnerId || req.auth.profileId || req.auth.accountId;
  if (!req.body) req.body = {};
  req.partnerId = partnerId;
  req.body.partnerId = partnerId;
  delete req.body.partnerIdOverride;
  next();
};
