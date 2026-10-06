import {
  assignAdminUserRoles,
  createAdminRole,
  createAdminUser,
  getAdminRole,
  getPortalUser,
  listAdminRoles,
  listPermissions,
  listPortalUsers,
  listSystemAuditLogs,
  exportSystemAuditLogs,
  replaceAdminRolePermissions,
  setAdminRoleStatus,
  setPortalUserStatus,
  updateAdminRole,
  updatePortalUser,
} from "../services/accessManagementService.js";

const actorContextFromRequest = (req) => ({
  actorId: req.auth?.accountId,
  actorRole: req.auth?.role,
  portalSource: req.auth?.role || "ADMIN",
  ipAddress: req.ip || null,
  userAgent: req.headers["user-agent"] || null,
  correlationId: req.correlationId || null,
});

const sendError = (res, error, fallback) => {
  const statusCode = error.statusCode || (error.code === "P2002" ? 409 : error.code === "P2025" ? 404 : 500);
  if (statusCode >= 500) {
    console.error("Access management operation failed:", error.code || error.name);
  }
  const message = statusCode >= 500
    ? fallback
    : error.code === "P2002"
      ? "A record with one of those unique values already exists."
      : error.code === "P2025"
        ? "The requested record was not found."
        : error.message;
  return res.status(statusCode).json({
    success: false,
    message,
    code: statusCode >= 500 ? "ACCESS_MANAGEMENT_UNAVAILABLE" : error.code || "ACCESS_MANAGEMENT_ERROR",
  });
};

const listUsers = (portal) => async (req, res) => {
  try {
    const result = await listPortalUsers({ portal, ...req.query });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Unable to load portal users.");
  }
};

const getUser = (portal) => async (req, res) => {
  try {
    const user = await getPortalUser({ portal, accountId: req.params.accountId });
    return res.json({ success: true, user });
  } catch (error) {
    return sendError(res, error, "Unable to load the user.");
  }
};

const updateUser = (portal) => async (req, res) => {
  try {
    const user = await updatePortalUser({
      actorAccountId: req.auth.accountId,
      actorContext: actorContextFromRequest(req),
      portal,
      accountId: req.params.accountId,
      input: req.body,
    });
    return res.json({ success: true, user });
  } catch (error) {
    return sendError(res, error, "Unable to update the user.");
  }
};

const setUserStatus = (portal) => async (req, res) => {
  try {
    if (typeof req.body?.active !== "boolean") {
      return res.status(400).json({ success: false, message: "active must be a boolean.", code: "INVALID_STATUS" });
    }
    const user = await setPortalUserStatus({
      actorAccountId: req.auth.accountId,
      actorContext: actorContextFromRequest(req),
      portal,
      accountId: req.params.accountId,
      active: req.body.active,
    });
    return res.json({ success: true, user });
  } catch (error) {
    return sendError(res, error, "Unable to change account status.");
  }
};

export const listAdminUsers = listUsers("ADMIN");
export const getAdminUser = getUser("ADMIN");
export const updateAdminUser = updateUser("ADMIN");
export const setAdminUserStatus = setUserStatus("ADMIN");
export const listCustomerUsers = listUsers("CUSTOMER");
export const getCustomerUser = getUser("CUSTOMER");
export const updateCustomerUser = updateUser("CUSTOMER");
export const setCustomerUserStatus = setUserStatus("CUSTOMER");
export const listManufacturerUsers = listUsers("MANUFACTURER");
export const getManufacturerUser = getUser("MANUFACTURER");
export const updateManufacturerUser = updateUser("MANUFACTURER");
export const setManufacturerUserStatus = setUserStatus("MANUFACTURER");
export const listMarketingPartnerUsers = listUsers("MARKETING_PARTNER");
export const getMarketingPartnerUser = getUser("MARKETING_PARTNER");
export const updateMarketingPartnerUser = updateUser("MARKETING_PARTNER");
export const setMarketingPartnerUserStatus = setUserStatus("MARKETING_PARTNER");

export const createAdmin = async (req, res) => {
  try {
    const result = await createAdminUser({
      actorAccountId: req.auth.accountId,
      actorContext: actorContextFromRequest(req),
      input: req.body,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Unable to create the Admin account.");
  }
};

export const assignRoles = async (req, res) => {
  try {
    if (!Array.isArray(req.body?.roleIds)) {
      return res.status(400).json({ success: false, message: "roleIds must be an array.", code: "INVALID_ROLES" });
    }
    const user = await assignAdminUserRoles({
      actorAccountId: req.auth.accountId,
      actorContext: actorContextFromRequest(req),
      accountId: req.params.accountId,
      roleIds: req.body.roleIds,
    });
    return res.json({ success: true, user });
  } catch (error) {
    return sendError(res, error, "Unable to assign Admin roles.");
  }
};

export const listRoles = async (req, res) => {
  try {
    const result = await listAdminRoles(req.query);
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Unable to load Admin roles.");
  }
};

export const getRole = async (req, res) => {
  try {
    const role = await getAdminRole({ roleId: req.params.roleId });
    return res.json({ success: true, role });
  } catch (error) {
    return sendError(res, error, "Unable to load the Admin role.");
  }
};

export const createRole = async (req, res) => {
  try {
    const role = await createAdminRole({
      actorAccountId: req.auth.accountId,
      actorContext: actorContextFromRequest(req),
      name: req.body?.name,
      description: req.body?.description,
    });
    return res.status(201).json({ success: true, role });
  } catch (error) {
    return sendError(res, error, "Unable to create the Admin role.");
  }
};

export const updateRole = async (req, res) => {
  try {
    const role = await updateAdminRole({
      actorAccountId: req.auth.accountId,
      actorContext: actorContextFromRequest(req),
      roleId: req.params.roleId,
      name: req.body?.name,
      description: req.body?.description,
    });
    return res.json({ success: true, role });
  } catch (error) {
    return sendError(res, error, "Unable to update the Admin role.");
  }
};

export const setRoleStatus = async (req, res) => {
  try {
    if (typeof req.body?.active !== "boolean") {
      return res.status(400).json({ success: false, message: "active must be a boolean.", code: "INVALID_STATUS" });
    }
    const role = await setAdminRoleStatus({
      actorAccountId: req.auth.accountId,
      actorContext: actorContextFromRequest(req),
      roleId: req.params.roleId,
      active: req.body.active,
    });
    return res.json({ success: true, role });
  } catch (error) {
    return sendError(res, error, "Unable to change role status.");
  }
};

export const assignPermissions = async (req, res) => {
  try {
    if (!Array.isArray(req.body?.permissionIds)) {
      return res.status(400).json({ success: false, message: "permissionIds must be an array.", code: "INVALID_PERMISSIONS" });
    }
    const role = await replaceAdminRolePermissions({
      actorAccountId: req.auth.accountId,
      actorContext: actorContextFromRequest(req),
      roleId: req.params.roleId,
      permissionIds: req.body.permissionIds,
    });
    return res.json({ success: true, role });
  } catch (error) {
    return sendError(res, error, "Unable to update role permissions.");
  }
};

export const getPermissions = async (req, res) => {
  try {
    const result = await listPermissions(req.query);
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Unable to load permissions.");
  }
};

export const getAuditLogs = async (req, res) => {
  try {
    const result = await listSystemAuditLogs(req.query);
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Unable to load audit history.");
  }
};

export const downloadAuditLogs = async (req, res) => {
  try {
    const result = await exportSystemAuditLogs(req.query);
    if (result.format === "csv") {
      res.type("text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="audit-history.csv"');
      return res.send(result.content);
    }
    res.type("application/json; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="audit-history.json"');
    return res.send(result.content);
  } catch (error) {
    return sendError(res, error, "Unable to export audit history.");
  }
};