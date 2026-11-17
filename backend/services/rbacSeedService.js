import { recordSystemAudit } from "./auditService.js";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const recordRoleChange = async (tx, { account, beforeActive, afterActive, ownerEmail }) => {
  const action = afterActive ? "ADMIN_OWNER_ROLE_ASSIGNED" : "ADMIN_FULL_ROLE_REVOKED";
  const beforeState = { adminRoleActive: beforeActive };
  const afterState = { adminRoleActive: afterActive };
  await tx.accessManagementAuditLog.create({
    data: {
      actorAccountId: null,
      targetAccountId: account.id,
      action,
      metadata: {
        reason: "RBAC seed synchronizes the configured owner account without granting the built-in full Admin role to other Admin accounts.",
        ownerEmail,
      },
    },
  });
  await recordSystemAudit({
    actorId: "SYSTEM:RBAC_SEED",
    actorRole: "SYSTEM",
    portalSource: "ADMIN",
  }, {
    action,
    entityType: "AuthAccountRoleMapping",
    entityId: account.id,
    beforeState,
    afterState,
  }, { client: tx });
};

export const synchronizeSeededAccountRoles = async ({ client, roles, ownerEmail }) => {
  const normalizedOwnerEmail = normalizeEmail(ownerEmail);
  const adminRole = roles.ADMIN;
  if (!normalizedOwnerEmail || !adminRole?.id) {
    throw new Error("A configured owner Admin email and seeded ADMIN role are required for RBAC synchronization.");
  }

  return client.$transaction(async (tx) => {
    const accounts = await tx.authAccount.findMany({
      select: { id: true, email: true, role: true, status: true },
    });
    const owner = accounts.find((account) =>
      account.role === "ADMIN" && normalizeEmail(account.email) === normalizedOwnerEmail
    );
    if (!owner || owner.status !== "ACTIVE") {
      throw new Error("The configured ADMIN_EMAIL must match an active Admin account before RBAC roles can be synchronized.");
    }

    let changedAdminRoleCount = 0;
    for (const account of accounts) {
      const primaryRole = roles[account.role];
      if (!primaryRole) {
        throw new Error(`Cannot seed RBAC mapping: unknown AuthAccount role "${account.role}" for account ${account.id}.`);
      }

      if (account.role !== "ADMIN") {
        await tx.authAccountRoleMapping.upsert({
          where: { accountId_roleId: { accountId: account.id, roleId: primaryRole.id } },
          update: { isActive: true },
          create: { accountId: account.id, roleId: primaryRole.id, isActive: true },
        });
        continue;
      }

      const mapping = await tx.authAccountRoleMapping.findUnique({
        where: { accountId_roleId: { accountId: account.id, roleId: adminRole.id } },
        select: { isActive: true },
      });
      if (account.id === owner.id) {
        await tx.authAccountRoleMapping.upsert({
          where: { accountId_roleId: { accountId: account.id, roleId: adminRole.id } },
          update: { isActive: true },
          create: { accountId: account.id, roleId: adminRole.id, isActive: true },
        });
        if (!mapping?.isActive) {
          changedAdminRoleCount += 1;
          await recordRoleChange(tx, {
            account,
            beforeActive: Boolean(mapping?.isActive),
            afterActive: true,
            ownerEmail: normalizedOwnerEmail,
          });
        }
      } else if (mapping?.isActive) {
        changedAdminRoleCount += 1;
        await tx.authAccountRoleMapping.updateMany({
          where: { accountId: account.id, roleId: adminRole.id, isActive: true },
          data: { isActive: false },
        });
        await recordRoleChange(tx, {
          account,
          beforeActive: true,
          afterActive: false,
          ownerEmail: normalizedOwnerEmail,
        });
      }
    }

    return {
      accountCount: accounts.length,
      ownerAccountId: owner.id,
      changedAdminRoleCount,
    };
  }, { isolationLevel: "Serializable" });
};
