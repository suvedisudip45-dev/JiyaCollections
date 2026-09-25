import { prisma } from "../config/db.js";

export const ALL_FUNCTION_PERMISSION = "all:function";

const normalizePermission = (permission) => String(permission || "").trim().toLowerCase();

export const resolveAccountPermissions = async (accountId, { client = prisma, cache } = {}) => {
  if (!accountId) return new Set();

  if (cache?.has(accountId)) {
    return cache.get(accountId);
  }

  const mappings = await client.rolePermissionMapping.findMany({
    where: {
      role: {
        isActive: true,
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
  return permissions;
};

export const hasPermission = (permissions, requiredPermission) => {
  const required = normalizePermission(requiredPermission);
  if (!required || !(permissions instanceof Set)) return false;
  return permissions.has(ALL_FUNCTION_PERMISSION) || permissions.has(required);
};