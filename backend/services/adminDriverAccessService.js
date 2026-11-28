import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import validator from "validator";
import { prisma } from "../config/db.js";
import { invalidatePermissionCache } from "./rbacService.js";
import { isValidMobileNumber, normalizePhoneNumber } from "../utils/socialCustomerProfile.js";
import { recordSystemAudit } from "./auditService.js";

const serviceError = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code });

export const listDriverProvisioningDistributors = async ({ client = prisma } = {}) =>
  client.distributor.findMany({
    where: { status: "ACTIVE", isActive: true },
    select: { id: true, name: true, province: true, district: true },
    orderBy: { name: "asc" },
    take: 500,
  });

export const listUnlinkedDrivers = async ({ distributorId, client = prisma }) => {
  if (!distributorId) throw serviceError("Select a distributor first.", 400, "DISTRIBUTOR_REQUIRED");
  const distributor = await client.distributor.findFirst({
    where: { id: distributorId, status: "ACTIVE", isActive: true },
    select: { id: true },
  });
  if (!distributor) throw serviceError("Active distributor not found.", 404, "DISTRIBUTOR_NOT_FOUND");
  return client.deliveryDriver.findMany({
    where: { distributorId, status: "ACTIVE", accountId: null },
    select: { id: true, name: true, phone: true, vehicleType: true, vehicleRegistration: true },
    orderBy: { name: "asc" },
    take: 200,
  });
};

export const provisionDriverAccount = async ({
  actorAccountId,
  distributorId,
  driverId,
  email: rawEmail,
  client = prisma,
  env = process.env,
}) => {
  if (!["development", "test"].includes(String(env.NODE_ENV || "").toLowerCase())) {
    throw serviceError(
      "Driver login provisioning remains disabled until HTTPS SMS delivery, shared rate limiting, staging recovery checks, and documented recovery operations are verified.",
      503,
      "DRIVER_PROVISIONING_DISABLED",
    );
  }
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!validator.isEmail(email)) throw serviceError("A valid driver email address is required.", 400, "INVALID_EMAIL");
  const driver = await client.deliveryDriver.findFirst({
    where: {
      id: driverId,
      distributorId,
      status: "ACTIVE",
      accountId: null,
      distributor: { is: { status: "ACTIVE", isActive: true } },
    },
    select: { id: true, name: true, phone: true, distributorId: true },
  });
  if (!driver) throw serviceError("An active, unlinked driver in the selected distributor workspace is required.", 404, "DRIVER_NOT_AVAILABLE");
  const phone = normalizePhoneNumber(String(driver.phone || "").trim());
  if (!isValidMobileNumber(phone)) throw serviceError("The driver's profile must have a valid mobile number.", 400, "INVALID_DRIVER_PHONE");
  const role = await client.role.findFirst({
    where: { code: "DRIVER", portalScope: "DRIVER", isActive: true },
    select: { id: true },
  });
  if (!role) throw serviceError("Driver workspace access is not initialized. Run the RBAC seed before provisioning.", 503, "DRIVER_ROLE_NOT_SEEDED");
  const passwordHash = await bcrypt.hash(crypto.randomBytes(48).toString("hex"), 12);
  let createdAccountId = null;

  try {
    const result = await client.$transaction(async (tx) => {
      const account = await tx.authAccount.create({
        data: {
          email,
          phone,
          passwordHash,
          role: "DRIVER",
          status: "ACTIVE",
          isEmailVerified: false,
          isPhoneVerified: false,
        },
        select: { id: true, email: true, phone: true },
      });
      createdAccountId = account.id;
      const linked = await tx.deliveryDriver.updateMany({
        where: { id: driver.id, distributorId, status: "ACTIVE", accountId: null },
        data: { accountId: account.id },
      });
      if (linked.count !== 1) throw serviceError("This driver account was linked by another administrator. Refresh and retry.", 409, "DRIVER_ALREADY_LINKED");
      await tx.authAccountRoleMapping.create({
        data: { accountId: account.id, roleId: role.id, isActive: true },
      });
      await tx.accessManagementAuditLog.create({
        data: {
          actorAccountId,
          targetAccountId: account.id,
          action: "DRIVER_ACCOUNT_PROVISIONED",
          metadata: { driverId: driver.id, distributorId },
        },
      });
      await recordSystemAudit({ actorId: actorAccountId, actorRole: "ADMIN", portalSource: "ADMIN" }, {
        action: "DRIVER_ACCOUNT_PROVISIONED",
        entityType: "DeliveryDriver",
        entityId: driver.id,
        afterState: { accountId: account.id, distributorId },
      }, { client: tx });
      return { driverId: driver.id, distributorId, name: driver.name, email: account.email, phone: account.phone };
    }, { isolationLevel: "Serializable" });
    invalidatePermissionCache(createdAccountId);
    return result;
  } catch (error) {
    if (error.code === "P2002") throw serviceError("An account already uses this email or phone number.", 409, "DRIVER_ACCOUNT_EXISTS");
    throw error;
  }
};
