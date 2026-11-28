import assert from "node:assert/strict";
import test from "node:test";
import { synchronizeSeededAccountRoles } from "../services/rbacSeedService.js";

const makeClient = ({ accounts, mappings = [] }) => {
  const mappingByKey = new Map(mappings.map((mapping) => [
    `${mapping.accountId}:${mapping.roleId}`,
    { ...mapping },
  ]));
  const calls = { upserts: [], updates: [], accessAudits: [], systemAudits: [] };
  const tx = {
    authAccount: {
      findMany: async () => accounts,
    },
    authAccountRoleMapping: {
      findUnique: async ({ where }) => mappingByKey.get(
        `${where.accountId_roleId.accountId}:${where.accountId_roleId.roleId}`
      ) || null,
      upsert: async ({ where, update, create }) => {
        calls.upserts.push({ where, update, create });
        const key = `${where.accountId_roleId.accountId}:${where.accountId_roleId.roleId}`;
        const current = mappingByKey.get(key);
        const result = current ? { ...current, ...update } : { ...create };
        mappingByKey.set(key, result);
        return result;
      },
      updateMany: async ({ where, data }) => {
        calls.updates.push({ where, data });
        const key = `${where.accountId}:${where.roleId}`;
        const current = mappingByKey.get(key);
        if (!current || !current.isActive) return { count: 0 };
        mappingByKey.set(key, { ...current, ...data });
        return { count: 1 };
      },
    },
    accessManagementAuditLog: {
      create: async ({ data }) => calls.accessAudits.push(data),
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        calls.systemAudits.push(data);
        return { id: data.id };
      },
    },
  };
  return {
    calls,
    mappingByKey,
    client: {
      $transaction: async (callback) => callback(tx),
    },
  };
};

const roles = {
  ADMIN: { id: "role-admin" },
  CUSTOMER: { id: "role-customer" },
};

test("RBAC seed grants the full Admin role only to the configured active owner", async () => {
  const accounts = [
    { id: "owner", email: "OWNER@example.com", role: "ADMIN", status: "ACTIVE" },
    { id: "staff", email: "staff@example.com", role: "ADMIN", status: "ACTIVE" },
    { id: "customer", email: "customer@example.com", role: "CUSTOMER", status: "ACTIVE" },
  ];
  const { client, mappingByKey, calls } = makeClient({
    accounts,
    mappings: [
      { accountId: "staff", roleId: "role-admin", isActive: true },
      { accountId: "staff", roleId: "custom-role", isActive: true },
    ],
  });

  const result = await synchronizeSeededAccountRoles({
    client,
    roles,
    ownerEmail: "owner@example.com",
  });

  assert.equal(mappingByKey.get("owner:role-admin").isActive, true);
  assert.equal(mappingByKey.get("staff:role-admin").isActive, false);
  assert.equal(mappingByKey.get("staff:custom-role").isActive, true);
  assert.equal(mappingByKey.get("customer:role-customer").isActive, true);
  assert.equal(calls.accessAudits.length, 2);
  assert.equal(calls.systemAudits.length, 2);
  assert.equal(result.ownerAccountId, "owner");

  const rerun = await synchronizeSeededAccountRoles({
    client,
    roles,
    ownerEmail: "owner@example.com",
  });
  assert.equal(rerun.changedAdminRoleCount, 0);
  assert.equal(calls.accessAudits.length, 2);
  assert.equal(calls.systemAudits.length, 2);
});

test("RBAC seed requires a matching active owner before changing mappings", async () => {
  const { client, calls } = makeClient({
    accounts: [{ id: "inactive-owner", email: "owner@example.com", role: "ADMIN", status: "INACTIVE" }],
  });

  await assert.rejects(
    synchronizeSeededAccountRoles({ client, roles, ownerEmail: "owner@example.com" }),
    /must match an active Admin account/
  );
  assert.equal(calls.upserts.length, 0);
  assert.equal(calls.updates.length, 0);
});

test("RBAC seed fails closed when configured owner is missing", async () => {
  const { client } = makeClient({
    accounts: [{ id: "staff", email: "staff@example.com", role: "ADMIN", status: "ACTIVE" }],
  });

  await assert.rejects(
    synchronizeSeededAccountRoles({ client, roles, ownerEmail: "missing@example.com" }),
    /must match an active Admin account/
  );
});
