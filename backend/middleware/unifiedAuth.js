import jwt from "jsonwebtoken";
import { prisma } from "../config/db.js";

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

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || typeof decoded !== "object") {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    const role = (decoded.role || "CUSTOMER").toUpperCase();
    let accountId = decoded.accountId || decoded.id || decoded.userId || decoded.adminId || decoded.manufacturerId || decoded.partnerId;
    const profileId = decoded.profileId || decoded.id || decoded.userId || decoded.adminId || decoded.manufacturerId || decoded.partnerId;

    if (!decoded.accountId && role === "CUSTOMER" && profileId) {
      const customerProfile = await prisma.user.findUnique({
        where: { id: profileId },
        select: { accountId: true },
      });
      accountId = customerProfile?.accountId || accountId;
    }

    req.auth = {
      accountId,
      profileId,
      manufacturerId: decoded.manufacturerId || null,
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
    if (!normalizedAllowed.includes(String(req.auth.role).toUpperCase())) {
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
  next();
};
