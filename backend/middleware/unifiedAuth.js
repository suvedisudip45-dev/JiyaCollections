import { prisma } from "../config/db.js";
import { verifyAccessToken } from "../services/tokenService.js";

export { authorize } from "./authorize.js";

/**
 * Extracts token from headers (supporting standard Authorization header, token, adminToken, manufacturerToken)
 */
export const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }
  return req.headers.token || req.headers.admintoken || req.headers.manufacturertoken || null;
};

/**
 * Unified Authentication Middleware
 */
export const authenticate = async (req, res, next) => {
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

    const session = await prisma.authSession.findUnique({
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
        CUSTOMER: () => prisma.user.findUnique({ where: { id: profileId }, select: { accountId: true } }),
        ADMIN: () => prisma.admin.findUnique({ where: { id: profileId }, select: { accountId: true } }),
        MANUFACTURER: () => prisma.manufacturer.findUnique({ where: { id: profileId }, select: { accountId: true } }),
        MARKETING_PARTNER: () => prisma.marketingPartner.findUnique({ where: { id: profileId }, select: { accountId: true } }),
      }[role];
      const profile = profileLookup ? await profileLookup() : null;
      accountId = profile?.accountId || null;
    }

    const account = accountId
      ? await prisma.authAccount.findUnique({
          where: { id: accountId },
          select: {
            id: true,
            role: true,
            status: true,
            roleMappings: {
              where: {
                isActive: true,
                role: { isActive: true },
              },
              select: {
                role: { select: { code: true } },
              },
            },
          },
        })
      : null;
    if (!account || account.role.toUpperCase() !== role) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication identity.",
        code: "INVALID_IDENTITY",
      });
    }
    if (account.status !== "ACTIVE") {
      return res.status(401).json({
        success: false,
        message: "Account is not active.",
        code: "ACCOUNT_INACTIVE",
      });
    }

    const roles = Array.from(new Set([
      role,
      ...account.roleMappings.map(({ role: mappedRole }) => String(mappedRole.code).toUpperCase()),
    ]));

    req.auth = {
      userId: profileId,
      accountId,
      profileId,
      roles,
      tokenId: decoded.jti,
      tokenType: decoded.token_type,
      sessionId: session.id,
      tokenFamilyId: session.tokenFamilyId,
      manufacturerId: decoded.manufacturerId || null,
      partnerId: decoded.partnerId || null,
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
      req.manufacturerId = profileId;
      req.body.manufacturerId = profileId;
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
    MARKETING: ["MARKETING_PARTNER"],
  };

  const allowed = portalRoleMap[portalName.toUpperCase()] || [portalName.toUpperCase()];
  return requireRole(...allowed);
};

export const requireAdmin = [authenticate, requireRole("ADMIN")];
export const requireCustomer = [authenticate, requireRole("CUSTOMER")];
export const requireManufacturer = [authenticate, requireRole("MANUFACTURER")];
export const requireMarketingPartner = [authenticate, requireRole("MARKETING_PARTNER")];

export const setManufacturerContext = (req, res, next) => {
  if (!req.auth?.accountId) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }

  const manufacturerId = req.auth.manufacturerId || req.auth.profileId || req.auth.accountId;
  if (!req.body) req.body = {};
  req.manufacturerId = manufacturerId;
  req.body.manufacturerId = manufacturerId;
  delete req.body.manufacturerIdOverride;
  next();
};

export const setMarketingPartnerContext = (req, res, next) => {
  if (!req.auth?.accountId) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }

  const partnerId = req.auth.partnerId || req.auth.profileId || req.auth.accountId;
  if (!req.body) req.body = {};
  req.partnerId = partnerId;
  req.body.partnerId = partnerId;
  delete req.body.partnerIdOverride;
  next();
};
