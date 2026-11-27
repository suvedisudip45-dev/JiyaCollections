import assert from "node:assert/strict";
import test from "node:test";
import { provisionDriverAccount } from "../services/adminDriverAccessService.js";

test("driver login provisioning remains blocked outside development and test", async () => {
  let databaseTouched = false;
  const client = new Proxy({}, {
    get() {
      databaseTouched = true;
      throw new Error("Database access must not occur when provisioning is disabled.");
    },
  });

  for (const env of [
    { NODE_ENV: "production" },
    { NODE_ENV: "staging" },
    { NODE_ENV: undefined },
    {},
  ]) {
    await assert.rejects(
      provisionDriverAccount({
        actorAccountId: "admin-1",
        distributorId: "distributor-1",
        driverId: "driver-1",
        email: "driver@example.test",
        client,
        env,
      }),
      {
        code: "DRIVER_PROVISIONING_DISABLED",
        statusCode: 503,
      },
    );
  }

  assert.equal(databaseTouched, false);
});

test("driver provisioning creates only a fixed DRIVER role link for the selected active driver", async () => {
  const calls = {};
  const client = {
    deliveryDriver: {
      findFirst: async (query) => {
        calls.driverQuery = query;
        return {
          id: "driver-1",
          name: "Driver One",
          phone: "+9779800000000",
          distributorId: "distributor-1",
        };
      },
    },
    role: {
      findFirst: async (query) => {
        calls.roleQuery = query;
        return { id: "role-driver" };
      },
    },
    $transaction: async (callback) => callback({
      authAccount: {
        create: async ({ data }) => {
          calls.accountData = data;
          return { id: "account-1", email: data.email, phone: data.phone };
        },
      },
      deliveryDriver: {
        updateMany: async ({ where, data }) => {
          calls.linkWhere = where;
          calls.linkData = data;
          return { count: 1 };
        },
      },
      authAccountRoleMapping: {
        create: async ({ data }) => { calls.roleMapping = data; },
      },
      accessManagementAuditLog: {
        create: async ({ data }) => { calls.accessAudit = data; },
      },
      systemAuditOutbox: {
        create: async ({ data }) => { calls.systemAudit = data; },
      },
    }),
  };

  const result = await provisionDriverAccount({
    actorAccountId: "admin-1",
    distributorId: "distributor-1",
    driverId: "driver-1",
    email: "DRIVER@example.test",
    role: "ADMIN",
    roleId: "role-admin",
    accountId: "attacker-account",
    env: { NODE_ENV: "test" },
    client,
  });

  assert.equal(calls.driverQuery.where.id, "driver-1");
  assert.equal(calls.driverQuery.where.distributorId, "distributor-1");
  assert.equal(calls.driverQuery.where.status, "ACTIVE");
  assert.equal(calls.driverQuery.where.accountId, null);
  assert.equal(calls.driverQuery.where.distributor.is.isActive, true);
  assert.deepEqual(calls.roleQuery.where, {
    code: "DRIVER",
    portalScope: "DRIVER",
    isActive: true,
  });
  assert.equal(calls.accountData.email, "driver@example.test");
  assert.equal(calls.accountData.role, "DRIVER");
  assert.equal(calls.accountData.status, "ACTIVE");
  assert.equal(calls.accountData.passwordHash.includes("attacker-account"), false);
  assert.deepEqual(calls.linkWhere, {
    id: "driver-1",
    distributorId: "distributor-1",
    status: "ACTIVE",
    accountId: null,
  });
  assert.deepEqual(calls.linkData, { accountId: "account-1" });
  assert.deepEqual(calls.roleMapping, {
    accountId: "account-1",
    roleId: "role-driver",
    isActive: true,
  });
  assert.equal(result.driverId, "driver-1");
  assert.equal(result.distributorId, "distributor-1");
  assert.equal(Object.hasOwn(result, "password"), false);
  assert.equal(calls.accessAudit.action, "DRIVER_ACCOUNT_PROVISIONED");
  assert.equal(calls.systemAudit.event.action, "DRIVER_ACCOUNT_PROVISIONED");
});

test("driver provisioning rejects a concurrent or changed driver link before granting a role", async () => {
  let roleMappingCreated = false;
  const client = {
    deliveryDriver: {
      findFirst: async () => ({
        id: "driver-1",
        name: "Driver One",
        phone: "+9779800000000",
        distributorId: "distributor-1",
      }),
    },
    role: { findFirst: async () => ({ id: "role-driver" }) },
    $transaction: async (callback) => callback({
      authAccount: {
        create: async ({ data }) => ({ id: "account-1", email: data.email, phone: data.phone }),
      },
      deliveryDriver: { updateMany: async () => ({ count: 0 }) },
      authAccountRoleMapping: {
        create: async () => { roleMappingCreated = true; },
      },
    }),
  };

  await assert.rejects(provisionDriverAccount({
    actorAccountId: "admin-1",
    distributorId: "distributor-1",
    driverId: "driver-1",
    email: "driver@example.test",
    env: { NODE_ENV: "test" },
    client,
  }), { code: "DRIVER_ALREADY_LINKED", statusCode: 409 });
  assert.equal(roleMappingCreated, false);
});

test("driver provisioning rejects inactive or already-linked profiles before account creation", async () => {
  let transactionStarted = false;
  const client = {
    deliveryDriver: { findFirst: async () => null },
    $transaction: async () => { transactionStarted = true; },
  };

  await assert.rejects(provisionDriverAccount({
    actorAccountId: "admin-1",
    distributorId: "inactive-distributor",
    driverId: "inactive-driver",
    email: "driver@example.test",
    env: { NODE_ENV: "test" },
    client,
  }), { code: "DRIVER_NOT_AVAILABLE", statusCode: 404 });
  assert.equal(transactionStarted, false);
});
