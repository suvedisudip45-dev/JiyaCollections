import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_ROUTE_PERMISSIONS } from "../../admin/src/auth/adminRoutePermissions.js";
import { createAuthorize } from "../middleware/authorize.js";
import { requireRole } from "../middleware/unifiedAuth.js";
import { deactivateAccountRole, hasPermission, resolveAccountPermissions } from "../services/rbacService.js";

const invoke = (middleware, req) => new Promise((resolve) => {
  const response = {
    status: (code) => ({
      json: (body) => resolve({ code, body }),
    }),
  };
  middleware(req, response, () => resolve({ code: 200 }));
});
const ignoreAudit = async () => {};

test("resolveAccountPermissions returns only active mapped permissions", async () => {
  const calls = [];
  const client = {
    rolePermissionMapping: {
      findMany: async (query) => {
        calls.push(query);
        return [
          { permission: { code: "product:create" } },
          { permission: { code: "ALL:FUNCTION" } },
        ];
      },
    },
  };
  const permissions = await resolveAccountPermissions("account-1", { client, principalRole: "ADMIN" });

  assert.deepEqual([...permissions].sort(), ["all:function", "product:create"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.role.accounts.some.accountId, "account-1");
  assert.equal(calls[0].where.role.portalScope, "ADMIN");
  const customerPermissions = await resolveAccountPermissions("account-1", { client, principalRole: "CUSTOMER" });
  assert.deepEqual([...customerPermissions].sort(), ["all:function", "product:create"]);
  assert.equal(calls[1].where.role.code.not, "ADMIN");
  assert.equal(calls[1].where.role.portalScope, "CUSTOMER");
  assert.equal(hasPermission(permissions, "product:create"), true);
  assert.equal(hasPermission(permissions, "finance:read"), true);
});

test("permission cache is isolated by active workspace role", async () => {
  const cache = new Map();
  const client = {
    rolePermissionMapping: {
      findMany: async ({ where }) => [{ permission: { code: `${where.role.portalScope.toLowerCase()}:read` } }],
    },
  };

  const manufacturer = await resolveAccountPermissions("shared-account", {
    client,
    cache,
    principalRole: "MANUFACTURER",
  });
  const distributor = await resolveAccountPermissions("shared-account", {
    client,
    cache,
    principalRole: "DISTRIBUTOR",
  });

  assert.deepEqual([...manufacturer], ["manufacturer:read"]);
  assert.deepEqual([...distributor], ["distributor:read"]);
  assert.equal(cache.size, 2);
});

test("deactivateAccountRole centralizes role-mapping changes", async () => {
  let updateQuery;
  const result = await deactivateAccountRole("account-1", "distributor", {
    client: {
      role: {
        findUnique: async (query) => {
          assert.deepEqual(query, { where: { code: "DISTRIBUTOR" }, select: { id: true } });
          return { id: "role-1" };
        },
      },
      authAccountRoleMapping: {
        updateMany: async (query) => {
          updateQuery = query;
          return { count: 1 };
        },
      },
    },
  });

  assert.deepEqual(updateQuery, {
    where: { accountId: "account-1", roleId: "role-1" },
    data: { isActive: false },
  });
  assert.deepEqual(result, { count: 1 });
});

test("authorize allows, denies, caches, and fails closed", async () => {
  let resolverCalls = 0;
  let resolvedRole;
  const resolver = async (accountId, { cache, principalRole }) => {
    resolverCalls += 1;
    resolvedRole = principalRole;
    if (!cache.has(accountId)) cache.set(accountId, new Set(["product:create"]));
    return cache.get(accountId);
  };
  const middleware = createAuthorize(resolver)("product:create");
  const request = { auth: { accountId: "account-1", role: "CUSTOMER" } };

  assert.equal((await invoke(middleware, request)).code, 200);
  assert.equal(resolvedRole, "CUSTOMER");
  assert.equal((await invoke(middleware, request)).code, 200);
  assert.equal(resolverCalls, 2);

  const denied = await invoke(createAuthorize(async () => new Set(), ignoreAudit)("product:create"), {
    auth: { accountId: "account-2" },
  });
  assert.equal(denied.code, 403);

  let deniedEvent;
  const auditedDenied = await invoke(createAuthorize(async () => new Set(), async (actor, event) => {
    deniedEvent = { actor, event };
  })("product:delete"), {
    auth: { accountId: "account-4", role: "MANUFACTURER" },
    method: "DELETE",
    originalUrl: "/api/products/123?include=private",
    ip: "203.0.113.7",
    correlationId: "request-1",
    headers: { "user-agent": "test-agent" },
  });
  assert.equal(auditedDenied.code, 403);
  assert.equal(deniedEvent.actor.actorId, "account-4");
  assert.equal(deniedEvent.actor.correlationId, "request-1");
  assert.deepEqual(deniedEvent.event.afterState, {
    requiredPermissions: ["product:delete"],
    method: "DELETE",
    path: "/api/products/123",
  });

  const missingAuth = await invoke(middleware, {});
  assert.equal(missingAuth.code, 401);

  const unavailable = await invoke(createAuthorize(async () => {
    throw new Error("database unavailable");
  })("product:create"), { auth: { accountId: "account-3" } });
  assert.equal(unavailable.code, 500);
});

test("requireRole uses the centralized mapped role context", async () => {
  assert.equal(
    (await invoke(requireRole("MANUFACTURER"), {
      auth: { role: "CUSTOMER", roles: ["CUSTOMER", "MANUFACTURER"] },
    })).code,
    200
  );

  const denied = await invoke(requireRole("ADMIN"), {
    auth: { role: "CUSTOMER", roles: ["CUSTOMER", "MANUFACTURER"] },
  });
  assert.equal(denied.code, 403);
});

test("required password rotation permits only the Admin password-change permission", async () => {
  let resolverCalls = 0;
  const permissionResolver = async () => {
    resolverCalls += 1;
    return new Set();
  };
  const request = {
    auth: { accountId: "admin-1", role: "ADMIN", mustChangePassword: true },
  };

  assert.equal((await invoke(createAuthorize(permissionResolver)("admin:change_password"), request)).code, 200);
  assert.equal(resolverCalls, 0);

  const denied = await invoke(createAuthorize(permissionResolver, ignoreAudit)("access:admin_users_read"), request);
  assert.equal(denied.code, 403);
  assert.equal(resolverCalls, 1);
});

test("combo bundle management permissions are exposed to the admin route map", () => {
  assert.deepEqual(ADMIN_ROUTE_PERMISSIONS["/combo-bundles"], ["combo_bundle:create", "combo_bundle:update", "combo_bundle:delete"]);
});