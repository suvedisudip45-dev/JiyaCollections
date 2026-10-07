import bcrypt from "bcryptjs";
import validator from "validator";
import { prisma } from "../config/db.js";
import { assignAccountRole, deactivateAccountRole, invalidatePermissionCache } from "../services/rbacService.js";
import { logAuthEvent } from "../services/authService.js";
import { isValidMobileNumber, normalizePhoneNumber } from "../utils/socialCustomerProfile.js";

const clean = (value) => String(value || "").trim();

const sendFailure = (res, error, action) => {
  console.error(`${action} error:`, error);
  return res.status(500).json({
    success: false,
    message: "The request could not be completed.",
  });
};

const createDistributorApplication = async ({
  name,
  email,
  passwordHash,
  phone,
  address,
  city,
  accountRole,
}) => prisma.$transaction(async (tx) => {
  const account = await tx.authAccount.create({
    data: {
      email,
      phone,
      passwordHash,
      role: accountRole,
      status: "PENDING_APPROVAL",
      isEmailVerified: false,
      isPhoneVerified: false,
    },
  });
  const distributor = await tx.distributor.create({
    data: {
      accountId: account.id,
      name,
      phone,
      address: address || null,
      city: city || null,
      status: "PENDING_APPROVAL",
      isActive: false,
    },
  });
  return distributor;
});

export const registerDistributor = async (req, res) => {
  const name = clean(req.body?.name || req.body?.businessName);
  const email = clean(req.body?.email).toLowerCase();
  const phone = normalizePhoneNumber(req.body?.phone);
  const address = clean(req.body?.address);
  const city = clean(req.body?.city);
  const password = String(req.body?.password || "");

  if (!name || !validator.isEmail(email) || !password || !phone || !city) {
    return res.status(400).json({
      success: false,
      message: "Name, valid email, password, phone, and city are required.",
    });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters long." });
  }
  if (!isValidMobileNumber(phone)) {
    return res.status(400).json({ success: false, message: "Please enter a valid mobile number starting with 98 or 97." });
  }

  try {
    const existing = await prisma.authAccount.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ success: false, message: "Email or contact number is already registered." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const distributor = await createDistributorApplication({
      name,
      email,
      passwordHash,
      phone,
      address,
      city,
      accountRole: "DISTRIBUTOR",
    });
    return res.status(201).json({
      success: true,
      message: "Distributor application submitted for admin approval.",
      application: {
        id: distributor.id,
        name: distributor.name,
        status: distributor.status,
        appliedAt: distributor.appliedAt,
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ success: false, message: "Email or contact number is already registered." });
    }
    return sendFailure(res, error, "registerDistributor");
  }
};

export const requestManufacturerDistributorAccess = async (req, res) => {
  try {
    const manufacturer = await prisma.manufacturer.findUnique({
      where: { id: req.manufacturerId },
      select: {
        id: true,
        accountId: true,
        name: true,
        phone: true,
        address: true,
        city: true,
        distributorApplicationStatus: true,
      },
    });
    if (!manufacturer || manufacturer.accountId !== req.auth?.accountId) {
      return res.status(404).json({ success: false, message: "Manufacturer profile not found." });
    }
    const existing = await prisma.distributor.findUnique({
      where: { accountId: req.auth.accountId },
      select: { id: true, status: true },
    });
    if (
      manufacturer.distributorApplicationStatus === "REQUESTED" ||
      manufacturer.distributorApplicationStatus === "APPROVED" ||
      existing?.status === "ACTIVE"
    ) {
      return res.status(409).json({
        success: false,
        message: manufacturer.distributorApplicationStatus === "APPROVED" || existing?.status === "ACTIVE"
          ? "This manufacturer account already has distributor access."
          : "A distributor application is already awaiting review.",
        application: { id: manufacturer.id, status: manufacturer.distributorApplicationStatus },
      });
    }

    const application = await prisma.manufacturer.update({
      where: { id: manufacturer.id },
      data: { distributorApplicationStatus: "REQUESTED" },
      select: { id: true, distributorApplicationStatus: true, updatedAt: true },
    });
    await logAuthEvent({
      accountId: req.auth.accountId,
      identifier: req.auth.email,
      action: "MANUFACTURER_DISTRIBUTOR_ACCESS_REQUESTED",
      role: "MANUFACTURER",
      portal: "MANUFACTURER",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId || null,
      metadata: { manufacturerId: manufacturer.id },
    });
    return res.status(202).json({
      success: true,
      message: "Distributor access request submitted for admin approval.",
      application: {
        id: application.id,
        status: application.distributorApplicationStatus,
        appliedAt: application.updatedAt,
      },
    });
  } catch (error) {
    return sendFailure(res, error, "requestManufacturerDistributorAccess");
  }
};

export const listManufacturerDistributorApplications = async (req, res) => {
  try {
    const status = clean(req.query?.status).toUpperCase() || "REQUESTED";
    const allowedStatuses = ["NONE", "REQUESTED", "APPROVED", "REJECTED"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid manufacturer distributor application status." });
    }
    const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query?.limit, 10) || 25));
    const where = { distributorApplicationStatus: status };
    const [applications, total] = await prisma.$transaction([
      prisma.manufacturer.findMany({
        where,
        include: {
          account: { select: { id: true, email: true, phone: true, role: true, status: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.manufacturer.count({ where }),
    ]);
    return res.json({ success: true, applications, page, limit, total });
  } catch (error) {
    return sendFailure(res, error, "listManufacturerDistributorApplications");
  }
};

export const reviewManufacturerDistributorApplication = async (req, res) => {
  const targetStatus = clean(req.body?.status).toUpperCase();
  if (!["APPROVED", "REJECTED"].includes(targetStatus)) {
    return res.status(400).json({ success: false, message: "Status must be APPROVED or REJECTED." });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const manufacturer = await tx.manufacturer.findUnique({
        where: { id: req.params.id },
        include: { account: { select: { id: true } } },
      });
      if (!manufacturer || !manufacturer.accountId) {
        const error = new Error("Manufacturer distributor application not found.");
        error.statusCode = 404;
        throw error;
      }
      if (manufacturer.distributorApplicationStatus !== "REQUESTED") {
        const error = new Error("Only pending distributor applications can be reviewed.");
        error.statusCode = 409;
        throw error;
      }

      const claimed = await tx.manufacturer.updateMany({
        where: { id: manufacturer.id, distributorApplicationStatus: "REQUESTED" },
        data: { distributorApplicationStatus: targetStatus },
      });
      if (claimed.count !== 1) {
        const error = new Error("This distributor application has already been reviewed.");
        error.statusCode = 409;
        throw error;
      }

      let distributor = await tx.distributor.findUnique({
        where: { accountId: manufacturer.accountId },
      });
      if (targetStatus === "APPROVED") {
        const now = new Date();
        const profileData = {
          name: manufacturer.name,
          phone: manufacturer.phone,
          address: manufacturer.address,
          city: manufacturer.city,
          status: "ACTIVE",
          isActive: true,
          approvedAt: now,
          approvedBy: req.auth?.accountId || req.auth?.profileId,
        };
        distributor = distributor
          ? await tx.distributor.update({ where: { id: distributor.id }, data: profileData })
          : await tx.distributor.create({
              data: { ...profileData, accountId: manufacturer.accountId, appliedAt: manufacturer.updatedAt },
            });
        await assignAccountRole(manufacturer.accountId, "DISTRIBUTOR", { client: tx });
      } else {
        if (distributor && distributor.status === "PENDING_APPROVAL") {
          distributor = await tx.distributor.update({
            where: { id: distributor.id },
            data: { status: "REJECTED", isActive: false },
          });
        }
        if (distributor?.status !== "ACTIVE") {
          await deactivateAccountRole(manufacturer.accountId, "DISTRIBUTOR", { client: tx });
        }
      }

      await logAuthEvent({
        accountId: manufacturer.accountId,
        identifier: manufacturer.accountId,
        action: "MANUFACTURER_DISTRIBUTOR_APPLICATION_REVIEWED",
        role: "ADMIN",
        portal: "ADMIN",
        ipAddress: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        correlationId: req.correlationId || null,
        metadata: {
          manufacturerId: manufacturer.id,
          distributorId: distributor?.id || null,
          previousStatus: manufacturer.distributorApplicationStatus,
          status: targetStatus,
        },
      }, { client: tx });

      return { manufacturerId: manufacturer.id, accountId: manufacturer.accountId, status: targetStatus, distributor };
    });

    invalidatePermissionCache(result.accountId);
    return res.json({
      success: true,
      message: `Manufacturer distributor application ${targetStatus.toLowerCase()}.`,
      application: result,
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    return sendFailure(res, error, "reviewManufacturerDistributorApplication");
  }
};

export const getDistributorProfile = async (req, res) => {
  try {
    const distributor = await prisma.distributor.findUnique({
      where: { id: req.distributorId },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        city: true,
        status: true,
        isActive: true,
        appliedAt: true,
        approvedAt: true,
      },
    });
    if (!distributor) return res.status(404).json({ success: false, message: "Distributor profile not found." });
    return res.json({ success: true, distributor });
  } catch (error) {
    return sendFailure(res, error, "getDistributorProfile");
  }
};

export const listDistributorApplications = async (req, res) => {
  try {
    const status = clean(req.query?.status).toUpperCase();
    const allowedStatuses = ["PENDING_APPROVAL", "ACTIVE", "SUSPENDED", "REJECTED"];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid distributor application status." });
    }
    const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query?.limit, 10) || 25));
    const where = status ? { status } : {};
    const [applications, total] = await prisma.$transaction([
      prisma.distributor.findMany({
        where,
        include: {
          account: { select: { email: true, phone: true, role: true, status: true } },
        },
        orderBy: { appliedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.distributor.count({ where }),
    ]);
    return res.json({ success: true, applications, page, limit, total });
  } catch (error) {
    return sendFailure(res, error, "listDistributorApplications");
  }
};

const permittedTransitions = {
  PENDING_APPROVAL: new Set(["ACTIVE", "REJECTED"]),
  ACTIVE: new Set(["SUSPENDED"]),
  SUSPENDED: new Set(["ACTIVE"]),
  REJECTED: new Set(),
};

export const reviewDistributorApplication = async (req, res) => {
  const targetStatus = clean(req.body?.status).toUpperCase();
  if (!["ACTIVE", "REJECTED", "SUSPENDED"].includes(targetStatus)) {
    return res.status(400).json({ success: false, message: "Status must be ACTIVE, REJECTED, or SUSPENDED." });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const distributor = await tx.distributor.findUnique({
        where: { id: req.params.id },
        include: { account: { select: { id: true, role: true } } },
      });
      if (!distributor) {
        const error = new Error("Distributor application not found.");
        error.statusCode = 404;
        throw error;
      }
      if (!permittedTransitions[distributor.status]?.has(targetStatus)) {
        const error = new Error(`Cannot change distributor status from ${distributor.status} to ${targetStatus}.`);
        error.statusCode = 409;
        throw error;
      }

      const updated = await tx.distributor.update({
        where: { id: distributor.id },
        data: {
          status: targetStatus,
          isActive: targetStatus === "ACTIVE",
          approvedAt: targetStatus === "ACTIVE" ? new Date() : null,
          approvedBy: targetStatus === "ACTIVE" ? req.auth.profileId : null,
        },
      });
      if (distributor.accountId) {
        if (targetStatus === "ACTIVE") {
          await assignAccountRole(distributor.accountId, "DISTRIBUTOR", { client: tx });
        } else {
          await deactivateAccountRole(distributor.accountId, "DISTRIBUTOR", { client: tx });
        }

        if (distributor.account.role === "DISTRIBUTOR") {
          await tx.authAccount.update({
            where: { id: distributor.accountId },
            data: { status: targetStatus === "ACTIVE" ? "ACTIVE" : targetStatus },
          });
        }
      }
      await logAuthEvent({
        accountId: distributor.accountId,
        identifier: distributor.accountId || distributor.id,
        action: "DISTRIBUTOR_APPLICATION_REVIEWED",
        role: "ADMIN",
        portal: "ADMIN",
        ipAddress: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        correlationId: req.correlationId || null,
        metadata: { distributorId: distributor.id, previousStatus: distributor.status, status: targetStatus },
      }, { client: tx });
      return updated;
    });

    if (result.accountId) invalidatePermissionCache(result.accountId);
    return res.json({ success: true, message: `Distributor status updated to ${targetStatus}.`, distributor: result });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    return sendFailure(res, error, "reviewDistributorApplication");
  }
};

export const getDistributorPickupProfile = async (req, res) => {
  try {
    const distributor = await prisma.distributor.findUnique({
      where: { id: req.distributorId },
    });
    if (!distributor) {
      return res.status(404).json({ success: false, message: "Distributor profile not found." });
    }
    return res.json({ success: true, distributor });
  } catch (error) {
    return sendFailure(res, error, "getDistributorPickupProfile");
  }
};

export const updateDistributorPickupProfile = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.body?.distributorId;
    const {
      pickupAddress,
      pickupContactName,
      pickupContactPhone,
      pickupWindow,
      returnInstructions,
    } = req.body;

    const updateData = {};
    if (pickupAddress !== undefined) updateData.pickupAddress = pickupAddress || null;
    if (pickupContactName !== undefined) updateData.pickupContactName = String(pickupContactName || "").trim();
    if (pickupContactPhone !== undefined) updateData.pickupContactPhone = String(pickupContactPhone || "").trim();
    if (pickupWindow !== undefined) updateData.pickupWindow = String(pickupWindow || "").trim();
    if (returnInstructions !== undefined) updateData.returnInstructions = returnInstructions || null;

    const updated = await prisma.distributor.update({
      where: { id: distributorId },
      data: updateData,
    });

    // If this distributor account also has a linked manufacturer profile, sync to manufacturer
    if (updated.accountId) {
      const linkedManufacturer = await prisma.manufacturer.findUnique({
        where: { accountId: updated.accountId },
      });
      if (linkedManufacturer) {
        await prisma.manufacturer.update({
          where: { id: linkedManufacturer.id },
          data: {
            ...updateData,
            ncmPickupBranch: updated.ncmPickupBranch,
            pickupBranchStatus: updated.pickupBranchStatus,
          },
        });
      }
    }

    return res.json({ success: true, message: "Distributor pickup profile updated successfully.", distributor: updated });
  } catch (error) {
    return sendFailure(res, error, "updateDistributorPickupProfile");
  }
};

/**
 * Toggle distributor online/offline availability for accepting orders.
 * PATCH /api/distributor/availability
 */
export const toggleDistributorAvailability = async (req, res) => {
  try {
    const distributorId = req.distributorId;
    if (!distributorId) {
      return res.status(403).json({ success: false, message: "Distributor profile required." });
    }

    const { isAvailable } = req.body;
    if (typeof isAvailable !== "boolean") {
      return res.status(400).json({ success: false, message: "isAvailable (boolean) is required." });
    }

    const updated = await prisma.distributor.update({
      where: { id: distributorId },
      data: { isActive: isAvailable },
      select: { id: true, name: true, isActive: true, status: true },
    });

    return res.json({
      success: true,
      message: isAvailable ? "Hub is now accepting orders (Online)." : "Hub is paused (Offline).",
      distributor: updated,
    });
  } catch (error) {
    return sendFailure(res, error, "toggleDistributorAvailability");
  }
};
