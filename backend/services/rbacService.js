import { prisma } from "../config/db.js";

export const ALL_FUNCTION_PERMISSION = "all:function";
const PERMISSION_CACHE_TTL_MS = 2000;
const PERMISSION_CACHE_MAX_ENTRIES = 1000;
const permissionCache = new Map();

const normalizePermission = (permission) => String(permission || "").trim().toLowerCase();

export const resolveAccountPermissions = async (accountId, { client = prisma, cache, principalRole } = {}) => {
  if (!accountId) return new Set();
  const normalizedPrincipalRole = String(principalRole || "").toUpperCase();

  if (cache?.has(accountId)) {
    return cache.get(accountId);
  }
  if (client === prisma) {
    const cached = permissionCache.get(accountId);
    if (cached && cached.expiresAt > Date.now()) {
      cache?.set(accountId, cached.permissions);
      return cached.permissions;
    }
    if (cached) permissionCache.delete(accountId);
  }

  const mappings = await client.rolePermissionMapping.findMany({
    where: {
      role: {
        isActive: true,
        ...(normalizedPrincipalRole ? { portalScope: normalizedPrincipalRole } : {}),
        ...(normalizedPrincipalRole && normalizedPrincipalRole !== "ADMIN" ? { code: { not: "ADMIN" } } : {}),
        accounts: {
          some: {
            accountId,
            isActive: true,
          },
        },
      },
      permission: {
        isActive: true,
      },
    },
    select: {
      permission: {
        select: {
          code: true,
        },
      },
    },
  });

  const permissions = new Set(
    mappings
      .map(({ permission }) => normalizePermission(permission.code))
      .filter(Boolean)
  );

  cache?.set(accountId, permissions);
  if (client === prisma) {
    if (permissionCache.size >= PERMISSION_CACHE_MAX_ENTRIES) {
      const firstKey = permissionCache.keys().next().value;
      if (firstKey !== undefined) permissionCache.delete(firstKey);
    }
    permissionCache.set(accountId, {
      permissions,
      expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
    });
  }
  return permissions;
};

export const invalidatePermissionCache = (accountId = null) => {
  if (accountId) permissionCache.delete(accountId);
  else permissionCache.clear();
};

export const hasPermission = (permissions, requiredPermission) => {
  const required = normalizePermission(requiredPermission);
  if (!required || !(permissions instanceof Set)) return false;
  return permissions.has(ALL_FUNCTION_PERMISSION) || permissions.has(required);
};

export const assignAccountRole = async (accountId, roleCode, { client = prisma } = {}) => {
  const role = await client.role.findUnique({
    where: { code: String(roleCode).trim().toUpperCase() },
  });
  if (!role || !role.isActive) {
    throw new Error(`Active RBAC role is not configured: ${roleCode}`);
  }

  return client.authAccountRoleMapping.upsert({
    where: { accountId_roleId: { accountId, roleId: role.id } },
    update: { isActive: true },
    create: { accountId, roleId: role.id, isActive: true },
  });
};