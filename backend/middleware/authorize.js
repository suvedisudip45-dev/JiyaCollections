import { resolveAccountPermissions } from "../services/rbacService.js";

const normalizeRequiredPermissions = (requiredPermission) => {
  const permissions = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
  return permissions.map((permission) => String(permission || "").trim().toLowerCase()).filter(Boolean);
};

export const createAuthorize = (permissionResolver = resolveAccountPermissions) => {
  return (requiredPermission) => {
    const requiredPermissions = normalizeRequiredPermissions(requiredPermission);
    if (requiredPermissions.length === 0) {
      throw new Error("authorize() requires at least one permission.");
    }

    return async (req, res, next) => {
      if (!req.auth?.accountId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
          code: "AUTHENTICATION_REQUIRED",
        });
      }

      try {
        const cache = req.rbac?.permissionCache || new Map();
        req.rbac = { ...(req.rbac || {}), permissionCache: cache };
        const permissions = await permissionResolver(req.auth.accountId, { cache });
        const hasAllRequired = requiredPermissions.every(
          (permission) => permissions.has("all:function") || permissions.has(permission)
        );

        if (!hasAllRequired) {
          return res.status(403).json({
            success: false,
            message: "You do not have permission to perform this action.",
            code: "FORBIDDEN",
          });
        }

        return next();
      } catch (error) {
        console.error("RBAC permission resolution failed:", error.message);
        return res.status(500).json({
          success: false,
          message: "Authorization service unavailable.",
          code: "AUTHORIZATION_UNAVAILABLE",
        });
      }
    };
  };
};

export const authorize = createAuthorize();