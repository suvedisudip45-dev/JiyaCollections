import express from "express";
import { authorize } from "../middleware/authorize.js";
import { authenticate, requireRole } from "../middleware/unifiedAuth.js";
import {
  assignPermissions,
  assignRoles,
  createAdmin,
  createRole,
  downloadAuditLogs,
  getAdminUser,
  getAuditLogs,
  getCustomerUser,
  getManufacturerUser,
  getMarketingPartnerUser,
  getPermissions,
  getRole,
  listAdminUsers,
  listCustomerUsers,
  listManufacturerUsers,
  listMarketingPartnerUsers,
  listRoles,
  setAdminUserStatus,
  setCustomerUserStatus,
  setManufacturerUserStatus,
  setMarketingPartnerUserStatus,
  setRoleStatus,
  updateAdminUser,
  updateCustomerUser,
  updateManufacturerUser,
  updateMarketingPartnerUser,
  updateRole,
} from "../controllers/accessManagementController.js";

const accessManagementRouter = express.Router();
const protectedBy = (...permissions) => [authenticate, requireRole("ADMIN"), authorize(permissions)];

accessManagementRouter.get("/users/admin", ...protectedBy("access:admin_users_read"), listAdminUsers);
accessManagementRouter.post("/users/admin", ...protectedBy("access:admin_users_create", "access:admin_users_assign_roles"), createAdmin);
accessManagementRouter.get("/users/admin/:accountId", ...protectedBy("access:admin_users_read"), getAdminUser);
accessManagementRouter.patch("/users/admin/:accountId", ...protectedBy("access:admin_users_update"), updateAdminUser);
accessManagementRouter.patch("/users/admin/:accountId/status", ...protectedBy("access:admin_users_deactivate"), setAdminUserStatus);
accessManagementRouter.put("/users/admin/:accountId/roles", ...protectedBy("access:admin_users_assign_roles"), assignRoles);

accessManagementRouter.get("/users/customers", ...protectedBy("access:customer_users_read"), listCustomerUsers);
accessManagementRouter.get("/users/customers/:accountId", ...protectedBy("access:customer_users_read"), getCustomerUser);
accessManagementRouter.patch("/users/customers/:accountId", ...protectedBy("access:customer_users_update"), updateCustomerUser);
accessManagementRouter.patch("/users/customers/:accountId/status", ...protectedBy("access:customer_users_deactivate"), setCustomerUserStatus);

accessManagementRouter.get("/users/manufacturers", ...protectedBy("access:manufacturer_users_read"), listManufacturerUsers);
accessManagementRouter.get("/users/manufacturers/:accountId", ...protectedBy("access:manufacturer_users_read"), getManufacturerUser);
accessManagementRouter.patch("/users/manufacturers/:accountId", ...protectedBy("access:manufacturer_users_update"), updateManufacturerUser);
accessManagementRouter.patch("/users/manufacturers/:accountId/status", ...protectedBy("access:manufacturer_users_deactivate"), setManufacturerUserStatus);

accessManagementRouter.get("/users/marketing-partners", ...protectedBy("access:marketing_users_read"), listMarketingPartnerUsers);
accessManagementRouter.get("/users/marketing-partners/:accountId", ...protectedBy("access:marketing_users_read"), getMarketingPartnerUser);
accessManagementRouter.patch("/users/marketing-partners/:accountId", ...protectedBy("access:marketing_users_update"), updateMarketingPartnerUser);
accessManagementRouter.patch("/users/marketing-partners/:accountId/status", ...protectedBy("access:marketing_users_deactivate"), setMarketingPartnerUserStatus);

accessManagementRouter.get("/roles", ...protectedBy("access:roles_read"), listRoles);
accessManagementRouter.post("/roles", ...protectedBy("access:roles_create"), createRole);
accessManagementRouter.get("/roles/:roleId", ...protectedBy("access:roles_read"), getRole);
accessManagementRouter.patch("/roles/:roleId", ...protectedBy("access:roles_update"), updateRole);
accessManagementRouter.patch("/roles/:roleId/status", ...protectedBy("access:roles_deactivate"), setRoleStatus);
accessManagementRouter.put("/roles/:roleId/permissions", ...protectedBy("access:roles_assign_permissions"), assignPermissions);
accessManagementRouter.get("/permissions", ...protectedBy("access:permissions_read"), getPermissions);
accessManagementRouter.get("/audit-logs/export", ...protectedBy("access:audit_read"), downloadAuditLogs);
accessManagementRouter.get("/audit-logs", ...protectedBy("access:audit_read"), getAuditLogs);

export default accessManagementRouter;