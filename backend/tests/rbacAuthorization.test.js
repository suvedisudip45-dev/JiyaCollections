import test from "node:test";
import assert from "node:assert/strict";
import { createAuthorize } from "../middleware/authorize.js";
import { hasPermission, resolveAccountPermissions } from "../services/rbacService.js";

const invoke = (middleware, req) => new Promise((resolve) => {
  const response = {
    status: (code) => ({
      json: (body) => resolve({ code, body }),
    }),
  };
  middleware(req, response, () => resolve({ code: 200 }));
});

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
  const permissions = await resolveAccountPermissions("account-1", { client });

  assert.deepEqual([...permissions].sort(), ["all:function", "product:create"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.role.accounts.some.accountId, "account-1");
  assert.equal(hasPermission(permissions, "product:create"), true);
  assert.equal(hasPermission(permissions, "finance:read"), true);
});

test("authorize allows, denies, caches, and fails closed", async () => {
  let resolverCalls = 0;
  const resolver = async (accountId, { cache }) => {
    resolverCalls += 1;
    if (!cache.has(accountId)) cache.set(accountId, new Set(["product:create"]));
    return cache.get(accountId);
  };
  const middleware = createAuthorize(resolver)("product:create");
  const request = { auth: { accountId: "account-1" } };

  assert.equal((await invoke(middleware, request)).code, 200);
  assert.equal((await invoke(middleware, request)).code, 200);
  assert.equal(resolverCalls, 2);

  const denied = await invoke(createAuthorize(async () => new Set())("product:create"), {
    auth: { accountId: "account-2" },
  });
  assert.equal(denied.code, 403);

  const missingAuth = await invoke(middleware, {});
  assert.equal(missingAuth.code, 401);

  const unavailable = await invoke(createAuthorize(async () => {
    throw new Error("database unavailable");
  })("product:create"), { auth: { accountId: "account-3" } });
  assert.equal(unavailable.code, 500);
});