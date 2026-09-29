import bcrypt from "bcryptjs";
import validator from "validator";
import { prisma } from "../config/db.js";
import { ALL_FUNCTION_PERMISSION, hasPermission, resolveAccountPermissions } from "./rbacService.js";
import { isValidMobileNumber, normalizePhoneNumber } from "../utils/socialCustomerProfile.js";

const PORTALS = new Set(["ADMIN", "CUSTOMER", "MANUFACTURER", "MARKETING_PARTNER"]);
const SYSTEM_ROLE_CODES = new Set(["ADMIN", "CUSTOMER", "MANUFACTURER", "MARKETING_PARTNER"]);
const MAX_PAGE_SIZE = 100;

const createServiceError = (message, statusCode = 400, code = "ACCESS_MANAGEMENT_ERROR") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const normalizePortal = (portal) => {
  const normalized = String(portal || "").trim().toUpperCase();
  if (!PORTALS.has(normalized)) throw createServiceError("Unsupported user portal.", 400, "INVALID_PORTAL");
  return normalized;
};

const normalizePage = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const roleMappingSelect = (portalScope) => ({
  where: { isActive: true, role: { isActive: true, portalScope } },
  select: {
    role: {
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        isActive: true,
        portalScope: true,
      },
    },
  },
});

const profileSelect = {
  ADMIN: {
    adminProfile: { select: { displayName: true, firstName: true, lastName: true, email: true, phone: true } },
  },
  CUSTOMER: {
    customerProfile: { select: { name: true, firstName: true, lastName: true, email: true, phone: true, isInactiveProfile: true } },
  },
  MANUFACTURER: {
    manufacturerProfile: { select: { name: true, email: true, phone: true, isActive: true, contractStatus: true } },
  },
  MARKETING_PARTNER: {
    marketingPartnerProfile: { select: { name: true, email: true, contactPhone: true, status: true, code: true } },
  },
};

const getAccountSelect = (portal) => ({
  id: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
  ...profileSelect[portal],
  roleMappings: roleMappingSelect(portal),
});

const getProfile = (account, portal) => ({
  ADMIN: account.adminProfile,
  CUSTOMER: account.customerProfile,
  MANUFACTURER: account.manufacturerProfile,
  MARKETING_PARTNER: account.marketingPartnerProfile,
})[portal];

const getNonAdminPermissionCodes = async (client) => {
  const mappings = await client.rolePermissionMapping.findMany({
    where: {
      role: { isActive: true, portalScope: { not: "ADMIN" } },
      permission: { isActive: true },
    },
    select: { permission: { select: { code: true } } },
  });
  return new Set(mappings.map(({ permission }) => permission.code));
};

const getUserStatus = (account, portal) => {
  if (portal === "MANUFACTURER" && account.manufacturerProfile && !account.manufacturerProfile.isActive) return "INACTIVE";
  if (portal === "MARKETING_PARTNER" && account.marketingPartnerProfile?.status === "INACTIVE") return "INACTIVE";
  return account.status;
};

const serializeAccount = (account, portal) => {
  const profile = getProfile(account, portal);
  if (!profile) return null;
  const displayName = portal === "ADMIN"
    ? profile.displayName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || account.email
    : portal === "CUSTOMER"
      ? profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || account.email
      : profile.name || account.email;
  return {
    id: account.id,
    portal,
    displayName,
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    email: account.email,
    contactNumber: profile.contactPhone ?? profile.phone ?? account.phone ?? "",
    status: getUserStatus(account, portal),
    roles: account.roleMappings.map(({ role }) => ({ id: role.id, code: role.code, name: role.name })),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastLoginAt: account.lastLoginAt,
    mustChangePassword: portal === "ADMIN" ? account.mustChangePassword : undefined,
    profileStatus: profile.status,
    contractStatus: profile.contractStatus,
    isInactiveProfile: profile.isInactiveProfile,
  };
};

const buildSearchWhere = (portal, search) => {
  const where = { role: portal };
  if (!search) return where;
  const contains = { contains: search };
  const profileSearch = {
    ADMIN: [
      { adminProfile: { is: { displayName: contains } } },
      { adminProfile: { is: { firstName: contains } } },
      { adminProfile: { is: { lastName: contains } } },
    ],
    CUSTOMER: [
      { customerProfile: { is: { name: contains } } },
      { customerProfile: { is: { firstName: contains } } },
      { customerProfile: { is: { lastName: contains } } },
    ],
    MANUFACTURER: [{ manufacturerProfile: { is: { name: contains } } }],
    MARKETING_PARTNER: [{ marketingPartnerProfile: { is: { name: contains } } }],
  }[portal];
  where.OR = [{ email: contains }, { phone: contains }, ...profileSearch];
  return where;
};

const audit = (client, { actorAccountId, targetAccountId = null, action, metadata = {} }) =>
  client.accessManagementAuditLog.create({
    data: { actorAccountId, targetAccountId, action, metadata },
  });

const assertNotSelf = (actorAccountId, targetAccountId) => {
  if (actorAccountId === targetAccountId) {
    throw createServiceError("You cannot modify your own account through user management.", 403, "SELF_MANAGEMENT_FORBIDDEN");
  }
};

const getPortalAccount = async (client, portal, accountId) => {
  const account = await client.authAccount.findFirst({
    where: { id: accountId, role: portal },
    select: getAccountSelect(portal),
  });
  if (!account || !getProfile(account, portal)) {
    throw createServiceError("Portal account not found.", 404, "ACCOUNT_NOT_FOUND");
  }
  return account;
};

const getGrantableAdminRoles = async (client, roleIds, actorAccountId) => {
  const ids = [...new Set((roleIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) throw createServiceError("At least one Admin role is required.", 400, "ROLE_REQUIRED");
  const roles = await client.role.findMany({
    where: { id: { in: ids }, portalScope: "ADMIN", isActive: true },
    include: {
      permissions: {
        where: { permission: { isActive: true } },
        select: { permission: { select: { code: true } } },
      },
    },
  });
  if (roles.length !== ids.length) {
    throw createServiceError("One or more selected roles are invalid or inactive.", 400, "INVALID_ROLE");
  }
  const actorPermissions = await resolveAccountPermissions(actorAccountId, {
    client,
    principalRole: "ADMIN",
  });
  const nonAdminPermissionCodes = await getNonAdminPermissionCodes(client);
  for (const role of roles) {
    for (const { permission } of role.permissions) {
      if (role.code !== "ADMIN" && nonAdminPermissionCodes.has(permission.code)) {
        throw createServiceError("The selected role contains permissions from another portal.", 403, "ROLE_PORTAL_SCOPE_INVALID");
      }
      if (!hasPermission(actorPermissions, permission.code)) {
        throw createServiceError("You cannot assign a role with permissions you do not hold.", 403, "ROLE_GRANT_FORBIDDEN");
      }
    }
  }
  return roles;
};

const findRoleMappingsForAccount = async (client, accountId) => client.authAccountRoleMapping.findMany({
  where: { accountId, role: { portalScope: "ADMIN" } },
  select: { roleId: true },
});

const replaceAdminRoleMappings = async (client, accountId, roles) => {
  const currentMappings = await findRoleMappingsForAccount(client, accountId);
  if (currentMappings.length) {
    await client.authAccountRoleMapping.updateMany({
      where: { accountId, roleId: { in: currentMappings.map(({ roleId }) => roleId) } },
      data: { isActive: false },
    });
  }
  for (const role of roles) {
    await client.authAccountRoleMapping.upsert({
      where: { accountId_roleId: { accountId, roleId: role.id } },
      update: { isActive: true },
      create: { accountId, roleId: role.id, isActive: true },
    });
  }
};

const normalizeEmail = (email) => {
  const normalized = String(email || "").trim().toLowerCase();
  if (!validator.isEmail(normalized)) throw createServiceError("A valid email address is required.", 400, "INVALID_EMAIL");
  return normalized;
};

const normalizePhone = (phone, required = false) => {
  const normalized = normalizePhoneNumber(String(phone || "").trim());
  if (!normalized && !required) return null;
  if (!isValidMobileNumber(normalized)) throw createServiceError("A valid mobile number is required.", 400, "INVALID_PHONE");
  return normalized;
};

export const listPortalUsers = async ({ portal: rawPortal, search = "", page = 1, limit = 10 }, { client = prisma } = {}) => {
  const portal = normalizePortal(rawPortal);
  const normalizedPage = normalizePage(page, 1);
  const normalizedLimit = Math.min(normalizePage(limit, 10), MAX_PAGE_SIZE);
  const where = buildSearchWhere(portal, String(search || "").trim());
  const [accounts, total] = await Promise.all([
    client.authAccount.findMany({
      where,
      select: getAccountSelect(portal),
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (normalizedPage - 1) * normalizedLimit,
      take: normalizedLimit,
    }),
    client.authAccount.count({ where }),
  ]);
  return {
    users: accounts.map((account) => serializeAccount(account, portal)).filter(Boolean),
    pagination: {
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      totalPages: Math.ceil(total / normalizedLimit),
    },
  };
};

export const getPortalUser = async ({ portal: rawPortal, accountId }, { client = prisma } = {}) => {
  const portal = normalizePortal(rawPortal);
  const account = await getPortalAccount(client, portal, accountId);
  const user = serializeAccount(account, portal);
  if (portal === "ADMIN") {
    const permissions = await resolveAccountPermissions(account.id, { client, principalRole: "ADMIN" });
    user.effectivePermissions = [...permissions].sort();
  }
  return user;
};

export const createAdminUser = async ({ actorAccountId, input }, { client = prisma } = {}) => {
  const displayName = String(input?.displayName || "").trim();
  const firstName = String(input?.firstName || "").trim();
  const lastName = String(input?.lastName || "").trim();
  const email = normalizeEmail(input?.email);
  const phone = normalizePhone(input?.contactNumber, true);
  const password = String(input?.password || "");
  if (!displayName || !firstName || !lastName) {
    throw createServiceError("Display name, first name, and last name are required.", 400, "ADMIN_NAME_REQUIRED");
  }
  if (password.length < 8) throw createServiceError("Initial password must be at least 8 characters.", 400, "WEAK_PASSWORD");

  return client.$transaction(async (tx) => {
    const roles = await getGrantableAdminRoles(tx, input.roleIds, actorAccountId);
    const passwordHash = await bcrypt.hash(password, 12);
    const account = await tx.authAccount.create({
      data: {
        email,
        phone,
        passwordHash,
        role: "ADMIN",
        status: "ACTIVE",
        mustChangePassword: true,
        isEmailVerified: true,
      },
    });
    await tx.authAccountRoleMapping.createMany({
      data: roles.map(({ id }) => ({ accountId: account.id, roleId: id, isActive: true })),
    });
    await tx.admin.create({
      data: {
        accountId: account.id,
        displayName,
        firstName,
        lastName,
        email,
        phone,
        password: passwordHash,
      },
    });
    await audit(tx, {
      actorAccountId,
      targetAccountId: account.id,
      action: "ADMIN_USER_CREATED",
      metadata: { roleCodes: roles.map(({ code }) => code), changedFields: ["displayName", "firstName", "lastName", "email", "contactNumber"] },
    });
    return { accountId: account.id };
  });
};

export const updatePortalUser = async ({ actorAccountId, portal: rawPortal, accountId, input }, { client = prisma } = {}) => {
  const portal = normalizePortal(rawPortal);
  assertNotSelf(actorAccountId, accountId);
  const existing = await getPortalAccount(client, portal, accountId);
  const profile = getProfile(existing, portal);
  const accountData = {};
  const profileData = {};

  if (Object.hasOwn(input || {}, "email")) {
    const email = normalizeEmail(input.email);
    accountData.email = email;
    profileData.email = email;
  }
  if (Object.hasOwn(input || {}, "contactNumber")) {
    const phone = normalizePhone(input.contactNumber, portal === "MANUFACTURER");
    accountData.phone = phone;
    if (portal === "MARKETING_PARTNER") profileData.contactPhone = phone;
    else profileData.phone = phone || "";
  }

  if (portal === "ADMIN") {
    for (const field of ["displayName", "firstName", "lastName"]) {
      if (Object.hasOwn(input || {}, field)) profileData[field] = String(input[field] || "").trim();
    }
    if (!Object.hasOwn(input || {}, "displayName") && (profileData.firstName !== undefined || profileData.lastName !== undefined)) {
      const first = profileData.firstName ?? profile.firstName ?? "";
      const last = profileData.lastName ?? profile.lastName ?? "";
      profileData.displayName = [first, last].filter(Boolean).join(" ");
    }
  } else if (portal === "CUSTOMER") {
    for (const field of ["firstName", "lastName"]) {
      if (Object.hasOwn(input || {}, field)) profileData[field] = String(input[field] || "").trim();
    }
    if (Object.hasOwn(input || {}, "displayName")) profileData.name = String(input.displayName || "").trim();
    else if (profileData.firstName !== undefined || profileData.lastName !== undefined) {
      profileData.name = [profileData.firstName ?? profile.firstName, profileData.lastName ?? profile.lastName].filter(Boolean).join(" ");
    }
  } else if (portal === "MARKETING_PARTNER" || portal === "MANUFACTURER") {
    if (Object.hasOwn(input || {}, "displayName")) profileData.name = String(input.displayName || "").trim();
  }

  for (const [field, value] of Object.entries(profileData)) {
    if (["displayName", "firstName", "lastName", "name"].includes(field) && !String(value || "").trim()) {
      throw createServiceError(`${field} cannot be empty.`, 400, "INVALID_NAME");
    }
  }

  if (!Object.keys(accountData).length && !Object.keys(profileData).length) {
    throw createServiceError("No supported profile changes were provided.", 400, "NO_CHANGES");
  }

  await client.$transaction(async (tx) => {
    if (Object.keys(accountData).length) await tx.authAccount.update({ where: { id: accountId }, data: accountData });
    if (Object.keys(profileData).length) {
      const profileModel = {
        ADMIN: tx.admin,
        CUSTOMER: tx.user,
        MANUFACTURER: tx.manufacturer,
        MARKETING_PARTNER: tx.marketingPartner,
      }[portal];
      await profileModel.update({ where: { accountId }, data: profileData });
    }
    await audit(tx, {
      actorAccountId,
      targetAccountId: accountId,
      action: `${portal}_USER_UPDATED`,
      metadata: { changedFields: Object.keys({ ...accountData, ...profileData }).filter((field) => field !== "password") },
    });
  });
  return getPortalUser({ portal, accountId }, { client });
};

const assertCanDeactivateLastAdmin = async (client, accountId) => {
  const account = await client.authAccount.findUnique({
    where: { id: accountId },
    select: { roleMappings: { where: { isActive: true, role: { code: "ADMIN", isActive: true, portalScope: "ADMIN" } }, select: { id: true } } },
  });
  if (!account?.roleMappings.length) return;
  const activeFullAdminCount = await client.authAccount.count({
    where: {
      role: "ADMIN",
      status: "ACTIVE",
      roleMappings: { some: { isActive: true, role: { code: "ADMIN", isActive: true, portalScope: "ADMIN" } } },
    },
  });
  if (activeFullAdminCount <= 1) {
    throw createServiceError("The last active full administrator cannot be deactivated.", 409, "LAST_ADMIN_PROTECTED");
  }
};

export const setPortalUserStatus = async ({ actorAccountId, portal: rawPortal, accountId, active }, { client = prisma } = {}) => {
  const portal = normalizePortal(rawPortal);
  assertNotSelf(actorAccountId, accountId);
  const existing = await getPortalAccount(client, portal, accountId);
  const nextStatus = active ? "ACTIVE" : "INACTIVE";
  if (existing.status === nextStatus && getUserStatus(existing, portal) === nextStatus) {
    return serializeAccount(existing, portal);
  }
  if (active && existing.status !== "ACTIVE" && existing.status !== "INACTIVE") {
    throw createServiceError("This account's current status cannot be changed through activation controls.", 409, "STATUS_TRANSITION_FORBIDDEN");
  }
  if (portal === "MARKETING_PARTNER" && !["ACTIVE", "INACTIVE"].includes(existing.marketingPartnerProfile.status)) {
    throw createServiceError("Pending Marketing Partners must be approved through the existing approval workflow.", 409, "PARTNER_APPROVAL_REQUIRED");
  }
  if (portal === "MANUFACTURER" && active && existing.manufacturerProfile.contractStatus !== "ACTIVE") {
    throw createServiceError("A suspended or terminated Manufacturer contract cannot be activated here.", 409, "CONTRACT_NOT_ACTIVE");
  }
  const updateStatus = async (tx) => {
    if (!active && portal === "ADMIN") await assertCanDeactivateLastAdmin(tx, accountId);
    await tx.authAccount.update({ where: { id: accountId }, data: { status: nextStatus } });
    if (portal === "MARKETING_PARTNER") {
      await tx.marketingPartner.update({ where: { accountId }, data: { status: nextStatus } });
    } else if (portal === "MANUFACTURER") {
      await tx.manufacturer.update({ where: { accountId }, data: { isActive: Boolean(active) } });
    }
    if (!active) {
      await tx.authSession.updateMany({
        where: { accountId, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: "ACCOUNT_DEACTIVATED" },
      });
    }
    await audit(tx, {
      actorAccountId,
      targetAccountId: accountId,
      action: `${portal}_USER_${active ? "ACTIVATED" : "DEACTIVATED"}`,
      metadata: { previousStatus: existing.status, status: nextStatus },
    });
  };
  if (!active && portal === "ADMIN") {
    await client.$transaction(updateStatus, { isolationLevel: "Serializable" });
  } else {
    await client.$transaction(updateStatus);
  }
  return getPortalUser({ portal, accountId }, { client });
};

export const assignAdminUserRoles = async ({ actorAccountId, accountId, roleIds }, { client = prisma } = {}) => {
  assertNotSelf(actorAccountId, accountId);
  const existing = await getPortalAccount(client, "ADMIN", accountId);
  await client.$transaction(async (tx) => {
    const roles = await getGrantableAdminRoles(tx, roleIds, actorAccountId);
    const hadFullAdminRole = await tx.authAccountRoleMapping.findFirst({
      where: { accountId, isActive: true, role: { code: "ADMIN", isActive: true, portalScope: "ADMIN" } },
      select: { id: true },
    });
    if (hadFullAdminRole && !roles.some(({ code }) => code === "ADMIN")) {
      await assertCanDeactivateLastAdmin(tx, accountId);
    }
    await replaceAdminRoleMappings(tx, accountId, roles);
    await audit(tx, {
      actorAccountId,
      targetAccountId: accountId,
      action: "ADMIN_USER_ROLES_UPDATED",
      metadata: { previousRoleCodes: existing.roleMappings.map(({ role }) => role.code), roleCodes: roles.map(({ code }) => code) },
    });
  }, { isolationLevel: "Serializable" });
  return getPortalUser({ portal: "ADMIN", accountId }, { client });
};

const assertRoleNotAssignedToActor = async (client, roleId, actorAccountId) => {
  const assigned = await client.authAccountRoleMapping.findFirst({
    where: { accountId: actorAccountId, roleId, isActive: true },
    select: { id: true },
  });
  if (assigned) throw createServiceError("You cannot modify a role assigned to your own account.", 403, "SELF_ROLE_MUTATION_FORBIDDEN");
};

const makeRoleCode = (name) => {
  const slug = String(name || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 55);
  if (!slug) throw createServiceError("Role name must contain letters or numbers.", 400, "INVALID_ROLE_NAME");
  return `ADMIN_${slug}`;
};

export const listAdminRoles = async ({ search = "", page = 1, limit = 25 }, { client = prisma } = {}) => {
  const normalizedPage = normalizePage(page, 1);
  const normalizedLimit = Math.min(normalizePage(limit, 25), MAX_PAGE_SIZE);
  const term = String(search || "").trim();
  const where = {
    portalScope: "ADMIN",
    ...(term ? { OR: [{ name: { contains: term } }, { description: { contains: term } }, { code: { contains: term } }] } : {}),
  };
  const [roles, total] = await Promise.all([
    client.role.findMany({
      where,
      include: { permissions: { where: { permission: { isActive: true } }, select: { permissionId: true } } },
      orderBy: [{ code: "asc" }, { id: "asc" }],
      skip: (normalizedPage - 1) * normalizedLimit,
      take: normalizedLimit,
    }),
    client.role.count({ where }),
  ]);
  const mappedRoles = await Promise.all(roles.map(async (role) => ({
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    portalScope: role.portalScope,
    isActive: role.isActive,
    isSystemRole: SYSTEM_ROLE_CODES.has(role.code),
    userCount: await client.authAccountRoleMapping.count({
      where: { roleId: role.id, isActive: true, account: { role: "ADMIN", status: "ACTIVE" } },
    }),
    permissionCount: role.permissions.length,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  })));
  return {
    roles: mappedRoles,
    pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages: Math.ceil(total / normalizedLimit) },
  };
};

export const createAdminRole = async ({ actorAccountId, name, description = "" }, { client = prisma } = {}) => {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) throw createServiceError("Role name is required.", 400, "ROLE_NAME_REQUIRED");
  const code = makeRoleCode(normalizedName);
  return client.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: { code, name: normalizedName, description: String(description || "").trim(), portalScope: "ADMIN" },
      select: { id: true, code: true, name: true, description: true, portalScope: true, isActive: true },
    });
    await audit(tx, { actorAccountId, action: "ADMIN_ROLE_CREATED", metadata: { roleId: role.id, roleCode: role.code } });
    return role;
  });
};

export const updateAdminRole = async ({ actorAccountId, roleId, name, description }, { client = prisma } = {}) => {
  const role = await client.role.findFirst({ where: { id: roleId, portalScope: "ADMIN" } });
  if (!role) throw createServiceError("Admin role not found.", 404, "ROLE_NOT_FOUND");
  if (SYSTEM_ROLE_CODES.has(role.code)) throw createServiceError("System roles cannot be edited.", 409, "SYSTEM_ROLE_PROTECTED");
  await assertRoleNotAssignedToActor(client, roleId, actorAccountId);
  const data = {};
  if (name !== undefined) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) throw createServiceError("Role name is required.", 400, "ROLE_NAME_REQUIRED");
    data.name = normalizedName;
  }
  if (description !== undefined) data.description = String(description || "").trim();
  if (!Object.keys(data).length) throw createServiceError("No role changes were provided.", 400, "NO_CHANGES");
  return client.$transaction(async (tx) => {
    const updated = await tx.role.update({ where: { id: roleId }, data });
    await audit(tx, { actorAccountId, action: "ADMIN_ROLE_UPDATED", metadata: { roleId, changedFields: Object.keys(data) } });
    return updated;
  });
};

export const setAdminRoleStatus = async ({ actorAccountId, roleId, active }, { client = prisma } = {}) => {
  const role = await client.role.findFirst({ where: { id: roleId, portalScope: "ADMIN" } });
  if (!role) throw createServiceError("Admin role not found.", 404, "ROLE_NOT_FOUND");
  if (SYSTEM_ROLE_CODES.has(role.code)) throw createServiceError("System roles cannot be deactivated.", 409, "SYSTEM_ROLE_PROTECTED");
  await assertRoleNotAssignedToActor(client, roleId, actorAccountId);
  const updated = await client.$transaction(async (tx) => {
    const result = await tx.role.update({ where: { id: roleId }, data: { isActive: Boolean(active) } });
    await audit(tx, { actorAccountId, action: `ADMIN_ROLE_${active ? "ACTIVATED" : "DEACTIVATED"}`, metadata: { roleId, code: role.code } });
    return result;
  });
  return updated;
};

export const getAdminRole = async ({ roleId }, { client = prisma } = {}) => {
  const role = await client.role.findFirst({
    where: { id: roleId, portalScope: "ADMIN" },
    include: {
      permissions: {
        where: { permission: { isActive: true } },
        select: { permission: { select: { id: true, code: true, description: true } } },
      },
    },
  });
  if (!role) throw createServiceError("Admin role not found.", 404, "ROLE_NOT_FOUND");
  const nonAdminPermissionCodes = await getNonAdminPermissionCodes(client);
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    portalScope: role.portalScope,
    isActive: role.isActive,
    isSystemRole: SYSTEM_ROLE_CODES.has(role.code),
    permissions: role.permissions.map(({ permission }) => ({
      ...permission,
      adminAssignable: permission.code !== ALL_FUNCTION_PERMISSION && !nonAdminPermissionCodes.has(permission.code),
    })).sort((left, right) => left.code.localeCompare(right.code)),
  };
};

export const replaceAdminRolePermissions = async ({ actorAccountId, roleId, permissionIds }, { client = prisma } = {}) => {
  const role = await client.role.findFirst({ where: { id: roleId, portalScope: "ADMIN" } });
  if (!role) throw createServiceError("Admin role not found.", 404, "ROLE_NOT_FOUND");
  if (SYSTEM_ROLE_CODES.has(role.code)) throw createServiceError("System role permissions are managed by the seed.", 409, "SYSTEM_ROLE_PROTECTED");
  await assertRoleNotAssignedToActor(client, roleId, actorAccountId);
  const ids = [...new Set((permissionIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const permissions = await client.permission.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, code: true } });
  if (permissions.length !== ids.length) throw createServiceError("One or more permissions are invalid or inactive.", 400, "INVALID_PERMISSION");
  const existingMappings = await client.rolePermissionMapping.findMany({ where: { roleId }, select: { permissionId: true } });
  const existingPermissionIds = new Set(existingMappings.map(({ permissionId }) => permissionId));
  if (permissions.some(({ code }) => code === ALL_FUNCTION_PERMISSION)) {
    throw createServiceError("The full authorization bypass is reserved for the seeded system Admin role.", 409, "SYSTEM_PERMISSION_PROTECTED");
  }
  const nonAdminPermissionCodes = await getNonAdminPermissionCodes(client);
  if (permissions.some(({ id, code }) => nonAdminPermissionCodes.has(code) && !existingPermissionIds.has(id))) {
    throw createServiceError("Permissions assigned to another portal cannot be granted through Admin roles.", 400, "PORTAL_PERMISSION_FORBIDDEN");
  }
  const actorPermissions = await resolveAccountPermissions(actorAccountId, { client, principalRole: "ADMIN" });
  if (permissions.some(({ code }) => !hasPermission(actorPermissions, code))) {
    throw createServiceError("You cannot grant permissions you do not hold.", 403, "PERMISSION_GRANT_FORBIDDEN");
  }

  await client.$transaction(async (tx) => {
    await tx.rolePermissionMapping.deleteMany({ where: { roleId } });
    if (ids.length) {
      await tx.rolePermissionMapping.createMany({ data: ids.map((permissionId) => ({ roleId, permissionId })) });
    }
    await audit(tx, {
      actorAccountId,
      action: "ADMIN_ROLE_PERMISSIONS_UPDATED",
      metadata: { roleId, permissionCodes: permissions.map(({ code }) => code).sort() },
    });
  });
  return getAdminRole({ roleId }, { client });
};

export const listPermissions = async ({ search = "", page = 1, limit = 50 }, { client = prisma } = {}) => {
  const normalizedPage = normalizePage(page, 1);
  const normalizedLimit = Math.min(normalizePage(limit, 50), MAX_PAGE_SIZE);
  const term = String(search || "").trim();
  const where = {
    isActive: true,
    ...(term ? { OR: [{ code: { contains: term } }, { description: { contains: term } }] } : {}),
  };
  const [permissions, total, nonAdminPermissionCodes] = await Promise.all([
    client.permission.findMany({
      where,
      include: { roles: { where: { role: { isActive: true, portalScope: "ADMIN" } }, select: { roleId: true } } },
      orderBy: [{ code: "asc" }, { id: "asc" }],
      skip: (normalizedPage - 1) * normalizedLimit,
      take: normalizedLimit,
    }),
    client.permission.count({ where }),
    getNonAdminPermissionCodes(client),
  ]);
  return {
    permissions: permissions.map(({ id, code, description, roles, createdAt, updatedAt }) => ({
      id,
      code,
      description,
      group: code.split(":")[0] || "other",
      adminAssignable: code !== ALL_FUNCTION_PERMISSION && !nonAdminPermissionCodes.has(code),
      adminRoleCount: roles.length,
      createdAt,
      updatedAt,
    })),
    pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages: Math.ceil(total / normalizedLimit) },
  };
};