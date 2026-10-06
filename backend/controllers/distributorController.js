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
      select: { id: true, accountId: true, name: true, phone: true, address: true, city: true },
    });
    if (!manufacturer || manufacturer.accountId !== req.auth?.accountId) {
      return res.status(404).json({ success: false, message: "Manufacturer profile not found." });
    }
    const existing = await prisma.distributor.findUnique({
      where: { accountId: req.auth.accountId },
      select: { id: true, status: true },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A distributor application already exists for this account.",
        application: existing,
      });
    }

    const distributor = await prisma.distributor.create({
      data: {
        accountId: req.auth.accountId,
        name: manufacturer.name,
        phone: manufacturer.phone,
        address: manufacturer.address,
        city: manufacturer.city,
        status: "PENDING_APPROVAL",
        isActive: false,
      },
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
      metadata: { distributorId: distributor.id },
    });
    return res.status(202).json({
      success: true,
      message: "Distributor access request submitted for admin approval.",
      application: { id: distributor.id, status: distributor.status, appliedAt: distributor.appliedAt },
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ success: false, message: "A distributor application already exists for this account." });
    }
    return sendFailure(res, error, "requestManufacturerDistributorAccess");
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
