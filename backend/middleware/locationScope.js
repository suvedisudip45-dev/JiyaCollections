import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";

const LOCATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;

export const normalizeLocationIdentity = (value) => {
  const locationId = String(value || "").trim();
  if (!LOCATION_ID_PATTERN.test(locationId)) return null;
  return locationId;
};

export const evaluateLocationAccess = ({
  auth,
  location,
  allowGlobalLocationAccess = false,
  requirePlatformOwner = true,
}) => {
  const locationId = normalizeLocationIdentity(location?.id);
  if (!locationId) {
    return { allowed: false, code: "LOCATION_ID_INVALID", reason: "missing or malformed location identity" };
  }
  if (!location.isActive) {
    return { allowed: false, code: "LOCATION_INACTIVE", reason: "location is inactive or archived" };
  }
  if (requirePlatformOwner && location.inventoryOwner !== "PLATFORM") {
    return { allowed: false, code: "LOCATION_OWNER_UNSUPPORTED", reason: "location ownership is not platform-owned" };
  }

  const role = String(auth?.role || "").trim().toUpperCase();
  if (role === "ADMIN") {
    if (allowGlobalLocationAccess) {
      return { allowed: true, code: "LOCATION_ACCESS_GRANTED", reason: "explicit global location access" };
    }
    return { allowed: false, code: "LOCATION_SCOPE_REQUIRED", reason: "global access was not explicitly granted" };
  }
  if (role === "MANUFACTURER") {
    if (auth.manufacturerId && location.manufacturerId === auth.manufacturerId) {
      return { allowed: true, code: "LOCATION_ACCESS_GRANTED", reason: "manufacturer location assignment" };
    }
    return { allowed: false, code: "LOCATION_ACCESS_DENIED", reason: "location is outside authenticated manufacturer scope" };
  }
  if (role === "DISTRIBUTOR") {
    if (auth.distributorId && location.distributorId === auth.distributorId) {
      return { allowed: true, code: "LOCATION_ACCESS_GRANTED", reason: "distributor location assignment" };
    }
    return { allowed: false, code: "LOCATION_ACCESS_DENIED", reason: "location is outside authenticated distributor scope" };
  }
  return { allowed: false, code: "LOCATION_ACCESS_DENIED", reason: "workspace role cannot access inventory location" };
};

export const evaluateMovementLocationAccess = ({
  auth,
  sourceLocation,
  destinationLocation,
  sourcePermissionGranted = false,
  destinationPermissionGranted = false,
  allowGlobalLocationAccess = false,
}) => {
  const sourceDecision = sourceLocation
    ? evaluateLocationAccess({ auth, location: sourceLocation, allowGlobalLocationAccess })
    : { allowed: true, code: "SOURCE_LOCATION_NOT_APPLICABLE", reason: "source not applicable" };
  const destinationDecision = destinationLocation
    ? evaluateLocationAccess({ auth, location: destinationLocation, allowGlobalLocationAccess })
    : { allowed: true, code: "DESTINATION_LOCATION_NOT_APPLICABLE", reason: "destination not applicable" };

  if (sourceLocation && !sourcePermissionGranted) {
    return { allowed: false, code: "SOURCE_PERMISSION_REQUIRED", reason: "source movement permission is missing" };
  }
  if (destinationLocation && !destinationPermissionGranted) {
    return { allowed: false, code: "DESTINATION_PERMISSION_REQUIRED", reason: "destination movement permission is missing" };
  }
  if (!sourceDecision.allowed) return sourceDecision;
  if (!destinationDecision.allowed) return destinationDecision;
  return { allowed: true, code: "MOVEMENT_LOCATION_ACCESS_GRANTED", reason: "source and destination scopes are authorized" };
};

export const createRequireLocationAccess = ({
  resolveLocation,
  auditRecorder = recordSystemAudit,
  requirePlatformOwner = true,
  allowGlobalLocationAccess = false,
} = {}) => {
  if (typeof resolveLocation !== "function") {
    throw new Error("createRequireLocationAccess requires a location resolver.");
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
      const location = await resolveLocation(req);
      if (!location) {
        return res.status(404).json({
          success: false,
          message: "Inventory location not found.",
          code: "LOCATION_NOT_FOUND",
        });
      }
      const decision = evaluateLocationAccess({
        auth: req.auth,
        location,
        allowGlobalLocationAccess,
        requirePlatformOwner,
      });
      if (!decision.allowed) {
        try {
          void Promise.resolve(auditRecorder({
            actorId: req.auth.accountId,
            actorRole: req.auth.role || null,
            portalSource: req.auth.role || null,
            ipAddress: req.ip || req.headers?.["x-forwarded-for"] || null,
            userAgent: req.headers?.["user-agent"] || null,
            correlationId: req.correlationId || null,
          }, {
            action: "LOCATION_AUTHORIZATION_DENIED",
            entityType: "InventoryLocation",
            entityId: normalizeLocationIdentity(location.id),
            status: "BLOCKED",
            failureReason: decision.code,
            afterState: {
              method: req.method,
              path: (req.originalUrl || req.path || "").split("?")[0].slice(0, 255),
              reason: decision.reason,
            },
          })).catch(() => {});
        } catch {
          // Authorization denial remains authoritative even if audit enqueue fails.
        }
        return res.status(403).json({
          success: false,
          message: "You do not have access to this inventory location.",
          code: decision.code,
        });
      }
      req.locationScope = {
        locationId: location.id,
        kind: location.kind,
        inventoryOwner: location.inventoryOwner,
        manufacturerId: location.manufacturerId || null,
        distributorId: location.distributorId || null,
      };
      return next();
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.statusCode ? error.message : "Unable to verify inventory location access.",
        code: error.statusCode ? (error.code || "LOCATION_ACCESS_ERROR") : "LOCATION_ACCESS_ERROR",
      });
    }
  };
};

export const requireDistributorInventoryLocation = createRequireLocationAccess({
  resolveLocation: (req) => prisma.inventoryLocation.findFirst({
    where: {
      kind: "DISTRIBUTOR",
      distributorId: req.distributorId,
      inventoryOwner: "PLATFORM",
      isActive: true,
    },
    select: {
      id: true,
      kind: true,
      inventoryOwner: true,
      manufacturerId: true,
      distributorId: true,
      isActive: true,
    },
  }),
});

export const createRequireManufacturerTransferSourceLocation = ({
  client = prisma,
  auditRecorder = recordSystemAudit,
} = {}) => async (req, res, next) => {
  if (!req.auth?.accountId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
      code: "AUTHENTICATION_REQUIRED",
    });
  }
  const transferId = normalizeLocationIdentity(req.params?.id);
  if (!transferId) {
    return res.status(400).json({
      success: false,
      message: "A valid stock-transfer identity is required.",
      code: "TRANSFER_ID_INVALID",
    });
  }
  try {
    const authenticatedManufacturerId = req.manufacturerId || req.auth.manufacturerId;
    const transfer = await client.stockTransfer.findUnique({
      where: { id: transferId },
      select: { id: true, manufacturerId: true, sourceLocationId: true },
    });
    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Stock transfer not found.",
        code: "TRANSFER_NOT_FOUND",
      });
    }
    if (transfer.manufacturerId !== authenticatedManufacturerId) {
      return res.status(403).json({
        success: false,
        message: "This stock transfer is outside the authenticated manufacturer scope.",
        code: "LOCATION_ACCESS_DENIED",
      });
    }
    const location = await client.inventoryLocation.findUnique({
      where: { id: transfer.sourceLocationId },
      select: {
        id: true,
        kind: true,
        inventoryOwner: true,
        manufacturerId: true,
        distributorId: true,
        isActive: true,
      },
    });
    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Transfer source location not found.",
        code: "LOCATION_NOT_FOUND",
      });
    }
    const decision = evaluateLocationAccess({
      auth: req.auth,
      location,
      allowGlobalLocationAccess: false,
      requirePlatformOwner: true,
    });
    if (!decision.allowed) {
      try {
        void Promise.resolve(auditRecorder({
          actorId: req.auth.accountId,
          actorRole: req.auth.role || null,
          portalSource: req.auth.role || null,
          ipAddress: req.ip || req.headers?.["x-forwarded-for"] || null,
          userAgent: req.headers?.["user-agent"] || null,
          correlationId: req.correlationId || null,
        }, {
          action: "TRANSFER_SOURCE_LOCATION_AUTHORIZATION_DENIED",
          entityType: "StockTransfer",
          entityId: transfer.id,
          status: "BLOCKED",
          failureReason: decision.code,
          afterState: {
            sourceLocationId: location.id,
            method: req.method,
            path: (req.originalUrl || req.path || "").split("?")[0].slice(0, 255),
            reason: decision.reason,
          },
        })).catch(() => {});
      } catch {
        // Authorization denial remains authoritative if audit enqueue fails.
      }
      return res.status(403).json({
        success: false,
        message: "You do not have access to this transfer source location.",
        code: decision.code,
      });
    }
    req.sourceLocationScope = {
      locationId: location.id,
      kind: location.kind,
      inventoryOwner: location.inventoryOwner,
      manufacturerId: location.manufacturerId,
      distributorId: location.distributorId,
    };
    return next();
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Unable to verify transfer source location access.",
      code: error.statusCode ? (error.code || "TRANSFER_SOURCE_LOCATION_ACCESS_ERROR") : "TRANSFER_SOURCE_LOCATION_ACCESS_ERROR",
    });
  }
};

export const requireManufacturerTransferSourceLocation =
  createRequireManufacturerTransferSourceLocation();
