import bcrypt from "bcryptjs";
import validator from "validator";
import { prisma } from "../config/db.js";
import { assignAccountRole, deactivateAccountRole, invalidatePermissionCache } from "../services/rbacService.js";
import { logAuthEvent } from "../services/authService.js";
import { isValidMobileNumber, normalizePhoneNumber } from "../utils/socialCustomerProfile.js";
import { recordSystemAudit } from "../services/auditService.js";
import { canonicalizeNepalLocation } from "../services/locationPricingService.js";
import { NEPAL_LOCATION_MAP } from "../utils/nepalLocationData.js";

const clean = (value) => String(value || "").trim();

export const normalizeDistributorCoverage = (locations) => {
  if (!Array.isArray(locations)) {
    throw Object.assign(new Error("Coverage locations must be an array."), { statusCode: 400 });
  }

  const normalizedLocations = new Map();
  for (const location of locations) {
    const canonical = canonicalizeNepalLocation(location?.province, location?.district);
    if (!canonical) {
      throw Object.assign(
        new Error(`Invalid province and district coverage: ${location?.province || ""} / ${location?.district || ""}.`),
        { statusCode: 400 },
      );
    }
    normalizedLocations.set(`${canonical.province}\0${canonical.district}`, canonical);
  }
  return [...normalizedLocations.values()];
};

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
  province,
  district,
  street,
  landmark,
  ncmPickupBranch,
  pickupAddress,
  pickupContactName,
  pickupContactPhone,
  pickupWindow,
  returnInstructions,
  contractStartDate,
  contractExpiryDate,
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
      province: province || null,
      district: district || null,
      street: street || null,
      landmark: landmark || null,
      ncmPickupBranch: ncmPickupBranch || "",
      pickupAddress: pickupAddress || null,
      pickupContactName: pickupContactName || "",
      pickupContactPhone: pickupContactPhone || "",
      pickupWindow: pickupWindow || "",
      returnInstructions: returnInstructions || null,
      contractStartDate: contractStartDate ? new Date(contractStartDate) : null,
      contractExpiryDate: contractExpiryDate ? new Date(contractExpiryDate) : null,
      status: "PENDING_APPROVAL",
      isActive: false,
    },
  });
  await tx.distributorLocation.create({
    data: { distributorId: distributor.id, province, district, isActive: true },
  });
  return distributor;
});

export const registerDistributor = async (req, res) => {
  const name = clean(req.body?.name || req.body?.businessName);
  const email = clean(req.body?.email).toLowerCase();
  const phone = normalizePhoneNumber(req.body?.phone);
  const address = clean(req.body?.address);
  const city = clean(req.body?.city);
  const street = clean(req.body?.street);
  const landmark = clean(req.body?.landmark);
  const password = String(req.body?.password || "");
  const pickupContactPhone = req.body?.pickupContactPhone
    ? normalizePhoneNumber(req.body.pickupContactPhone)
    : "";

  let location;
  try {
    [location] = normalizeDistributorCoverage([{
      province: req.body?.province,
      district: req.body?.district,
    }]);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }

  if (!name || !validator.isEmail(email) || !password || !phone || !city || !street || !landmark) {
    return res.status(400).json({
      success: false,
      message: "Business name, valid email, password, phone, province, district, NCM branch, covered area, and landmark are required.",
    });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters long." });
  }
  if (!isValidMobileNumber(phone)) {
    return res.status(400).json({ success: false, message: "Please enter a valid mobile number starting with 98 or 97." });
  }
  if (pickupContactPhone && !isValidMobileNumber(pickupContactPhone)) {
    return res.status(400).json({ success: false, message: "Please enter a valid pickup contact mobile number starting with 98 or 97." });
  }
  if (
    [req.body?.contractStartDate, req.body?.contractExpiryDate]
      .some((value) => value && !validator.isISO8601(String(value), { strict: true }))
  ) {
    return res.status(400).json({ success: false, message: "Contract dates must be valid calendar dates." });
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
      province: location.province,
      district: location.district,
      street,
      landmark,
      ncmPickupBranch: clean(req.body?.ncmPickupBranch || city).toUpperCase(),
      pickupAddress: clean(req.body?.pickupAddress),
      pickupContactName: clean(req.body?.pickupContactName),
      pickupContactPhone,
      pickupWindow: clean(req.body?.pickupWindow),
      returnInstructions: clean(req.body?.returnInstructions),
      contractStartDate: req.body?.contractStartDate,
      contractExpiryDate: req.body?.contractExpiryDate,
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
        province: true,
        district: true,
        street: true,
        landmark: true,
        ncmPickupBranch: true,
        pickupBranchStatus: true,
        pickupBranchVerifiedAt: true,
        pickupAddress: true,
        pickupContactName: true,
        pickupContactPhone: true,
        pickupWindow: true,
        returnInstructions: true,
        contractStartDate: true,
        contractExpiryDate: true,
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

export const updateDistributorAdminProfile = async (req, res) => {
  const {
    name,
    email,
    phone,
    address,
    city,
    province,
    district,
    street,
    landmark,
    ncmPickupBranch,
    pickupBranchStatus,
    pickupAddress,
    pickupContactName,
    pickupContactPhone,
    pickupWindow,
    returnInstructions,
    contractStartDate,
    contractExpiryDate,
  } = req.body || {};
  const normalizedEmail = email === undefined ? undefined : clean(email).toLowerCase();
  const normalizedPhone = phone === undefined ? undefined : normalizePhoneNumber(phone);
  const normalizedPickupPhone = pickupContactPhone === undefined
    ? undefined
    : (pickupContactPhone ? normalizePhoneNumber(pickupContactPhone) : "");

  if (name !== undefined && !clean(name)) {
    return res.status(400).json({ success: false, message: "Business name is required." });
  }
  if (normalizedEmail !== undefined && !validator.isEmail(normalizedEmail)) {
    return res.status(400).json({ success: false, message: "Please enter a valid email address." });
  }
  if (normalizedPhone !== undefined && !isValidMobileNumber(normalizedPhone)) {
    return res.status(400).json({ success: false, message: "Please enter a valid mobile number starting with 98 or 97." });
  }
  if (normalizedPickupPhone && !isValidMobileNumber(normalizedPickupPhone)) {
    return res.status(400).json({ success: false, message: "Please enter a valid pickup contact mobile number starting with 98 or 97." });
  }
  if (
    [contractStartDate, contractExpiryDate]
      .some((value) => value && !validator.isISO8601(String(value), { strict: true }))
  ) {
    return res.status(400).json({ success: false, message: "Contract dates must be valid calendar dates." });
  }

  let normalizedLocation;
  if (province !== undefined || district !== undefined) {
    try {
      [normalizedLocation] = normalizeDistributorCoverage([{
        province,
        district,
      }]);
    } catch (error) {
      return res.status(error.statusCode || 400).json({ success: false, message: error.message });
    }
  }

  const updateData = {};
  if (name !== undefined) updateData.name = clean(name);
  if (normalizedPhone !== undefined) updateData.phone = normalizedPhone;
  if (address !== undefined) updateData.address = clean(address) || null;
  if (city !== undefined) updateData.city = clean(city);
  if (normalizedLocation) {
    updateData.province = normalizedLocation.province;
    updateData.district = normalizedLocation.district;
  }
  if (street !== undefined) updateData.street = clean(street);
  if (landmark !== undefined) updateData.landmark = clean(landmark);
  if (ncmPickupBranch !== undefined) updateData.ncmPickupBranch = clean(ncmPickupBranch).toUpperCase();
  if (pickupBranchStatus !== undefined) {
    const status = clean(pickupBranchStatus).toUpperCase();
    if (!["UNVERIFIED", "VERIFIED", "REJECTED"].includes(status)) {
      return res.status(400).json({ success: false, message: "Pickup status must be UNVERIFIED, VERIFIED, or REJECTED." });
    }
    updateData.pickupBranchStatus = status;
    updateData.pickupBranchVerifiedAt = status === "VERIFIED" ? new Date() : null;
  }
  if (pickupAddress !== undefined) updateData.pickupAddress = clean(pickupAddress) || null;
  if (pickupContactName !== undefined) updateData.pickupContactName = clean(pickupContactName);
  if (normalizedPickupPhone !== undefined) updateData.pickupContactPhone = normalizedPickupPhone;
  if (pickupWindow !== undefined) updateData.pickupWindow = clean(pickupWindow);
  if (returnInstructions !== undefined) updateData.returnInstructions = clean(returnInstructions) || null;
  if (contractStartDate !== undefined) updateData.contractStartDate = contractStartDate ? new Date(contractStartDate) : null;
  if (contractExpiryDate !== undefined) updateData.contractExpiryDate = contractExpiryDate ? new Date(contractExpiryDate) : null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.distributor.findUnique({
        where: { id: req.params.id },
        include: { account: { select: { id: true, email: true, phone: true } } },
      });
      if (!before) {
        throw Object.assign(new Error("Distributor not found."), { statusCode: 404 });
      }
      const updated = await tx.distributor.update({
        where: { id: req.params.id },
        data: updateData,
      });
      if (normalizedLocation) {
        await tx.distributorLocation.upsert({
          where: {
            distributorId_province_district: {
              distributorId: updated.id,
              province: normalizedLocation.province,
              district: normalizedLocation.district,
            },
          },
          create: {
            distributorId: updated.id,
            province: normalizedLocation.province,
            district: normalizedLocation.district,
            isActive: true,
          },
          update: { isActive: true },
        });
      }
      if (before.accountId && (normalizedPhone !== undefined || normalizedEmail !== undefined)) {
        await tx.authAccount.update({
          where: { id: before.accountId },
          data: {
            ...(normalizedPhone !== undefined ? { phone: normalizedPhone } : {}),
            ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
            ...(normalizedEmail !== undefined && normalizedEmail !== before.account?.email
              ? { isEmailVerified: false }
              : {}),
            ...(normalizedPhone !== undefined && normalizedPhone !== before.account?.phone
              ? { isPhoneVerified: false }
              : {}),
          },
        });
      }
      await recordSystemAudit({
        actorId: req.auth?.accountId || null,
        actorRole: req.auth?.role || "ADMIN",
        portalSource: "ADMIN",
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        correlationId: req.correlationId || null,
      }, {
        action: "DISTRIBUTOR_PROFILE_UPDATED",
        entityType: "Distributor",
        entityId: updated.id,
        beforeState: before,
        afterState: updated,
      }, { client: tx });
      return updated;
    });
    return res.json({ success: true, message: "Distributor profile updated.", distributor: result });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    if (error.code === "P2002") {
      return res.status(409).json({ success: false, message: "Email or contact number is already registered." });
    }
    return sendFailure(res, error, "updateDistributorAdminProfile");
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

export const getDistributorCoverage = async (_req, res) => {
  try {
    const distributors = await prisma.distributor.findMany({
      select: {
        id: true,
        name: true,
        city: true,
        status: true,
        isActive: true,
        locations: {
          where: { isActive: true },
          select: { province: true, district: true },
          orderBy: [{ province: "asc" }, { district: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    });
    return res.json({
      success: true,
      distributors,
      locations: NEPAL_LOCATION_MAP.filter((location) => ["PROVINCE", "DISTRICT"].includes(location.type)),
    });
  } catch (error) {
    return sendFailure(res, error, "getDistributorCoverage");
  }
};

export const updateDistributorCoverage = async (req, res) => {
  let locations;
  try {
    locations = normalizeDistributorCoverage(req.body?.locations);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }

  try {
    const distributorId = req.params.id;
    const updatedLocations = await prisma.$transaction(async (tx) => {
      const distributor = await tx.distributor.findUnique({
        where: { id: distributorId },
        select: { id: true, name: true },
      });
      if (!distributor) {
        throw Object.assign(new Error("Distributor not found."), { statusCode: 404 });
      }

      const previousLocations = await tx.distributorLocation.findMany({
        where: { distributorId, isActive: true },
        select: { province: true, district: true },
        orderBy: [{ province: "asc" }, { district: "asc" }],
      });
      await tx.distributorLocation.deleteMany({ where: { distributorId } });
      if (locations.length) {
        await tx.distributorLocation.createMany({
          data: locations.map((location) => ({ distributorId, ...location, isActive: true })),
        });
      }

      await recordSystemAudit({
        actorId: req.auth?.accountId || null,
        actorRole: req.auth?.role || "ADMIN",
        portalSource: "ADMIN",
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        correlationId: req.correlationId || null,
      }, {
        action: "DISTRIBUTOR_COVERAGE_UPDATED",
        entityType: "Distributor",
        entityId: distributorId,
        beforeState: { locations: previousLocations },
        afterState: { locations },
      }, { client: tx });

      return tx.distributorLocation.findMany({
        where: { distributorId, isActive: true },
        select: { province: true, district: true },
        orderBy: [{ province: "asc" }, { district: "asc" }],
      });
    });
    return res.json({
      success: true,
      message: "Distributor coverage updated.",
      distributorId,
      locations: updatedLocations,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return sendFailure(res, error, "updateDistributorCoverage");
  }
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
