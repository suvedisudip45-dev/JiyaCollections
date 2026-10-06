import test from "node:test";
import assert from "node:assert/strict";
import {
  createAdminUser,
  exportSystemAuditLogs,
  listPortalUsers,
  listSystemAuditLogs,
  replaceAdminRolePermissions,
  setPortalUserStatus,
  updatePortalUser,
} from "../services/accessManagementService.js";

test("system audit listing is filtered and bounded with pagination metadata", async () => {
  let query;
  const client = {
    systemAuditLog: {
      findMany: async (request) => {
        query = request;
        return [{ id: "audit-1", action: "PRODUCT_UPDATED" }];
      },
      count: async ({ where }) => {
        assert.deepEqual(where, query.where);
        return 205;
      },
    },
  };

  const result = await listSystemAuditLogs({
    page: 2,
    limit: 1000,
    actorId: "admin-1",
    entityType: "Product",
    action: "UPDATED",
    status: "BLOCKED",
    search: "sku-1",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
  }, { client });

  assert.equal(query.skip, 100);
  assert.equal(query.take, 100);
  assert.equal(query.where.actorId, "admin-1");
  assert.equal(query.where.status, "BLOCKED");
  assert.equal(query.where.createdAt.gte.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(query.where.createdAt.lte.toISOString(), "2026-01-31T23:59:59.999Z");
  assert.deepEqual(result.pagination, { page: 2, limit: 100, total: 205, totalPages: 3 });
});

test("audit event status filters reject unsupported values", async () => {
  await assert.rejects(() => listSystemAuditLogs({ status: "UNKNOWN" }), {
    statusCode: 400,
    code: "INVALID_AUDIT_STATUS",
  });
});

test("audit CSV export escapes spreadsheet formulas and caps exported rows", async () => {
  let query;
  const client = {
    systemAuditLog: {
      findMany: async (request) => {
        query = request;
        return [{
          id: "event-1",
          action: "=HYPERLINK(\"https://example.invalid\")",
          entityType: "Product",
          entityId: "sku-1",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        }];
      },
    },
  };

  const result = await exportSystemAuditLogs({ format: "csv" }, { client });
  assert.equal(query.take, 1000);
  assert.equal(result.format, "csv");
  assert.match(result.content, /'=HYPERLINK/);
});

test("portal user listing is filtered, searched, and paginated server-side", async () => {
  let query;
  const client = {
    authAccount: {
      findMany: async (request) => {
        query = request;
        return [{
          id: "customer-1",
          email: "customer@example.com",
          phone: "9846000000",
          role: "CUSTOMER",
          status: "ACTIVE",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
          lastLoginAt: null,
          customerProfile: {
            name: "Customer One",
            firstName: "Customer",
            lastName: "One",
            email: "customer@example.com",
            phone: "9846000000",
            isInactiveProfile: false,
          },
          roleMappings: [],
        }];
      },
      count: async () => 1,
    },
  };

  const result = await listPortalUsers({ portal: "CUSTOMER", search: "one", page: 2, limit: 500 }, { client });
  assert.equal(query.where.role, "CUSTOMER");
  assert.ok(query.where.OR.some((condition) => condition.customerProfile));
  assert.equal(query.skip, 100);
  assert.equal(query.take, 100);
  assert.equal(result.users[0].displayName, "Customer One");
  assert.deepEqual(result.pagination, { page: 2, limit: 100, total: 1, totalPages: 1 });
});

test("Admin user management refuses self-edits before touching persistence", async () => {
  await assert.rejects(
    updatePortalUser({
      actorAccountId: "admin-1",
      portal: "ADMIN",
      accountId: "admin-1",
      input: { displayName: "Changed" },
    }, { client: {} }),
    (error) => error.statusCode === 403 && error.code === "SELF_MANAGEMENT_FORBIDDEN"
  );
});

test("deactivation revokes sessions and audits without deleting the account", async () => {
  const calls = { accountUpdates: [], sessionRevocations: [], audits: [], systemAudits: [] };
  const customer = {
    id: "customer-1",
    email: "customer@example.com",
    phone: "9846000000",
    role: "CUSTOMER",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    lastLoginAt: null,
    customerProfile: {
      name: "Customer One",
      firstName: "Customer",
      lastName: "One",
      email: "customer@example.com",
      phone: "9846000000",
      isInactiveProfile: false,
    },
    roleMappings: [],
  };
  const client = {
    authAccount: {
      findFirst: async () => customer,
      update: async (request) => {
        calls.accountUpdates.push(request);
        customer.status = request.data.status;
        return customer;
      },
    },
    authSession: {
      updateMany: async (request) => {
        calls.sessionRevocations.push(request);
        return { count: 2 };
      },
    },
    accessManagementAuditLog: {
      create: async (request) => {
        calls.audits.push(request);
        return request.data;
      },
    },
    systemAuditOutbox: {
      create: async (request) => {
        calls.systemAudits.push(request);
        return { id: request.data.id };
      },
    },
    $transaction: async (callback) => callback(client),
  };

  const user = await setPortalUserStatus({
    actorAccountId: "admin-1",
    portal: "CUSTOMER",
    accountId: "customer-1",
    active: false,
  }, { client });

  assert.equal(user.status, "INACTIVE");
  assert.equal(calls.accountUpdates[0].data.status, "INACTIVE");
  assert.equal(calls.sessionRevocations[0].where.accountId, "customer-1");
  assert.equal(calls.sessionRevocations[0].data.revocationReason, "ACCOUNT_DEACTIVATED");
  assert.equal(calls.audits[0].data.action, "CUSTOMER_USER_DEACTIVATED");
  assert.equal(calls.systemAudits[0].data.event.action, "CUSTOMER_USER_DEACTIVATED");
});

test("Admin account creation rejects roles scoped to another portal", async () => {
  let accountCreates = 0;
  const tx = {
    role: { findMany: async () => [] },
    authAccount: { create: async () => { accountCreates += 1; } },
  };
  const client = { $transaction: async (callback) => callback(tx) };

  await assert.rejects(
    createAdminUser({
      actorAccountId: "admin-1",
      input: {
        displayName: "New Admin",
        firstName: "New",
        lastName: "Admin",
        email: "new-admin@example.com",
        contactNumber: "9846000000",
        password: "Initial@123",
        roleIds: ["marketing-role"],
      },
    }, { client }),
    (error) => error.statusCode === 400 && error.code === "INVALID_ROLE"
  );
  assert.equal(accountCreates, 0);
});

test("Admin roles cannot gain permissions assigned to another portal", async () => {
  let transactionStarted = false;
  const client = {
    role: { findFirst: async () => ({ id: "role-1", code: "ADMIN_SUPPORT", portalScope: "ADMIN" }) },
    authAccountRoleMapping: { findFirst: async () => null },
    permission: {
      findMany: async () => [{ id: "permission-1", code: "manufacturer:assignment_accept" }],
    },
    rolePermissionMapping: {
      findMany: async (query) => query.where.roleId
        ? []
        : [{ permission: { code: "manufacturer:assignment_accept" } }],
    },
    $transaction: async (callback) => {
      transactionStarted = true;
      return callback(client);
    },
  };

  await assert.rejects(
    replaceAdminRolePermissions({
      actorAccountId: "admin-1",
      roleId: "role-1",
      permissionIds: ["permission-1"],
    }, { client }),
    (error) => error.statusCode === 400 && error.code === "PORTAL_PERMISSION_FORBIDDEN"
  );
  assert.equal(transactionStarted, false);
});

test("the last active full Admin cannot be deactivated", async () => {
  const calls = { updates: 0, audits: 0, isolationLevel: null };
  const admin = {
    id: "admin-1",
    email: "admin@example.com",
    phone: "9846000000",
    role: "ADMIN",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    lastLoginAt: null,
    adminProfile: { displayName: "Admin One", firstName: "Admin", lastName: "One", email: "admin@example.com", phone: "9846000000" },
    roleMappings: [{ role: { id: "system-admin", code: "ADMIN", name: "Administrator" } }],
  };
  const client = {
    authAccount: {
      findFirst: async () => admin,
      findUnique: async () => ({ roleMappings: [{ id: "mapping-1" }] }),
      count: async () => 1,
      update: async () => { calls.updates += 1; },
    },
    accessManagementAuditLog: { create: async () => { calls.audits += 1; } },
    systemAuditOutbox: { create: async () => { throw new Error("Audit must not be written."); } },
    $transaction: async (callback, options) => {
      calls.isolationLevel = options?.isolationLevel;
      return callback(client);
    },
  };

  await assert.rejects(
    setPortalUserStatus({ actorAccountId: "admin-2", portal: "ADMIN", accountId: "admin-1", active: false }, { client }),
    (error) => error.statusCode === 409 && error.code === "LAST_ADMIN_PROTECTED"
  );
  assert.equal(calls.isolationLevel, "Serializable");
  assert.equal(calls.updates, 0);
  assert.equal(calls.audits, 0);
});