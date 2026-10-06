import { hasPermission, resolveAccountPermissions } from "../services/rbacService.js";
import { recordSystemAudit } from "../services/auditService.js";
import { logger } from "../utils/logger.js";

const normalizeRequiredPermissions = (requiredPermission) => {
  const permissions = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
  return permissions.map((permission) => String(permission || "").trim().toLowerCase()).filter(Boolean);
};

export const createAuthorize = (
  permissionResolver = resolveAccountPermissions,
  auditRecorder = recordSystemAudit,
) => {
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
      if (
        req.auth.mustChangePassword &&
        requiredPermissions.every((permission) => permission === "admin:change_password")
      ) {
        return next();
      }

      try {
        const cache = req.rbac?.permissionCache || new Map();
        req.rbac = { ...(req.rbac || {}), permissionCache: cache };
        const permissions = await permissionResolver(req.auth.accountId, {
          cache,
          principalRole: req.auth.role,
        });
        const hasAllRequired = requiredPermissions.every((permission) => hasPermission(permissions, permission));

        if (!hasAllRequired) {
          void Promise.resolve(auditRecorder({
            actorId: req.auth.accountId,
            actorRole: req.auth.role || null,
            portalSource: req.auth.role || null,
            ipAddress: req.ip || req.headers?.["x-forwarded-for"] || null,
            userAgent: req.headers?.["user-agent"] || null,
            correlationId: req.correlationId || null,
          }, {
            action: "AUTHORIZATION_DENIED",
            entityType: "SecurityEvent",
            status: "BLOCKED",
            failureReason: "MISSING_REQUIRED_PERMISSION",
            afterState: {
              requiredPermissions,
              method: req.method,
              path: (req.originalUrl || req.path || "").split("?")[0].slice(0, 255),
            },
          })).catch((error) => logger.error("Unable to enqueue authorization audit event.", {
            actorId: req.auth.accountId,
            correlationId: req.correlationId || null,
            error: error.message || error,
          }));
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