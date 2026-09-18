import { prisma } from "../config/db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v2 as cloudinary } from "cloudinary";
import { getBranches, getNcmBranchName, getNcmBranchRows, getNcmCoveredAreas } from "../services/ncmClient.js";
import { syncManufacturerRating, syncAllManufacturersRatings } from "../services/manufacturerRatingService.js";

let ncmBranchesCache = { expiresAt: 0, branches: [] };
const NCM_BRANCH_CACHE_MS = 10 * 60 * 1000;

const getCachedNcmBranches = async () => {
  if (ncmBranchesCache.expiresAt > Date.now() && ncmBranchesCache.branches.length) return ncmBranchesCache.branches;
  const branches = await prisma.ncmBranch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  ncmBranchesCache = { branches, expiresAt: Date.now() + NCM_BRANCH_CACHE_MS };
  return branches;
};

const syncNcmBranches = async (req, res) => {
  try {
    const response = await getBranches();
    const rows = getNcmBranchRows(response).filter((row) => Number.isInteger(Number(row?.pk)));
    if (!rows.length) {
      return res.status(502).json({ success: false, message: "NCM returned no branch records" });
    }

    const syncedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.ncmBranch.updateMany({ data: { isActive: false } });
      for (const row of rows) {
        const name = getNcmBranchName(row);
        if (!name) continue;
        await tx.ncmBranch.upsert({
          where: { ncmPk: Number(row.pk) },
          create: {
            ncmPk: Number(row.pk),
            code: String(row.code || "").trim() || null,
            name,
            branchType: String(row.branch_type || row.branchType || "").trim() || null,
            geocode: String(row.geocode || "").trim() || null,
            address: String(row.address || "").trim() || null,
            phone: String(row.phone || "").trim() || null,
            phone2: String(row.phone2 || "").trim() || null,
            provinceName: String(row.province_name || row.province || "").trim().toUpperCase() || null,
            districtName: String(row.district_name || row.district || "").trim().toUpperCase() || null,
            coveredAreas: getNcmCoveredAreas(row),
            isActive: true,
            lastSyncedAt: syncedAt,
          },
          update: {
            code: String(row.code || "").trim() || null,
            name,
            branchType: String(row.branch_type || row.branchType || "").trim() || null,
            geocode: String(row.geocode || "").trim() || null,
            address: String(row.address || "").trim() || null,
            phone: String(row.phone || "").trim() || null,
            phone2: String(row.phone2 || "").trim() || null,
            provinceName: String(row.province_name || row.province || "").trim().toUpperCase() || null,
            districtName: String(row.district_name || row.district || "").trim().toUpperCase() || null,
            coveredAreas: getNcmCoveredAreas(row),
            isActive: true,
            lastSyncedAt: syncedAt,
          },
        });
      }
    });

    ncmBranchesCache = { expiresAt: 0, branches: [] };
    res.json({ success: true, message: `Synchronized ${rows.length} NCM branches`, count: rows.length, syncedAt });
  } catch (error) {
    console.error("syncNcmBranches error:", error);
    res.status(502).json({ success: false, message: error.message || "Unable to synchronize NCM branches" });
  }
};

// ─── LOGIN ───────────────────────────────────────────────────────────────────
const loginManufacturer = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.json({ success: false, message: "Email and password required" });

    const manufacturer = await prisma.manufacturer.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!manufacturer)
      return res.json({ success: false, message: "Invalid credentials" });

    const normalizedStatus = (manufacturer.contractStatus || "ACTIVE").toUpperCase();
    if (!manufacturer.isActive || normalizedStatus === "PENDING") {
      return res.json({ success: false, message: "Your manufacturer application is pending admin approval." });
    }
    if (normalizedStatus === "REJECTED") {
      return res.json({ success: false, message: "Your manufacturer registration was rejected. Contact admin for more details." });
    }
    if (normalizedStatus === "SUSPENDED" || normalizedStatus === "TERMINATED") {
      return res.json({ success: false, message: "This manufacturer account is currently inactive. Contact admin." });
    }

    const match = await bcrypt.compare(password, manufacturer.password);
    if (!match)
      return res.json({ success: false, message: "Invalid credentials" });

    const token = jwt.sign(
      { manufacturerId: manufacturer.id, role: "manufacturer" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const { password: _, ...safeManufacturer } = manufacturer;
    safeManufacturer.businessName = safeManufacturer.name;
    res.json({ success: true, token, manufacturer: safeManufacturer });
  } catch (error) {
    console.error("loginManufacturer error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── GET PROFILE ─────────────────────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId || req.body?.manufacturerId || req.query?.manufacturerId;
    if (!manufacturerId)
      return res.json({ success: false, message: "Manufacturer ID required" });

    const manufacturer = await prisma.manufacturer.findUnique({ where: { id: manufacturerId } });
    if (!manufacturer) return res.json({ success: false, message: "Manufacturer not found" });

    const { password: _, ...safe } = manufacturer;
    safe.businessName = safe.name;
    res.json({ success: true, manufacturer: safe });
  } catch (error) {
    console.error("getProfile error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── TOGGLE AVAILABILITY ─────────────────────────────────────────────────────
const updateAvailability = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId || req.body?.manufacturerId;
    const isAvailable = req.body?.isAvailable;
    const updated = await prisma.manufacturer.update({
      where: { id: manufacturerId },
      data: { isAvailable: Boolean(isAvailable) },
    });
    res.json({ success: true, message: "Availability updated", isAvailable: updated.isAvailable });
  } catch (error) {
    console.error("updateAvailability error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── ADMIN: REGISTER MANUFACTURER ────────────────────────────────────────────
const registerManufacturer = async (req, res) => {
  try {
    const {
      name,
      businessName,
      email,
      password,
      phone,
      city,
      ncmPickupBranch,
      pickupAddress,
      pickupContactName,
      pickupContactPhone,
      pickupWindow,
      returnInstructions,
      address,
      contractStartDate,
      contractStart,
      contractExpiryDate,
      contractEnd,
      agreementNotes,
    } = req.body;

    const mfgName = (name || businessName || "").trim();
    if (!mfgName || !email || !password || !phone || !city) {
      return res.json({ success: false, message: "Business name, email, password, phone, and city are required" });
    }

    const existing = await prisma.manufacturer.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) return res.json({ success: false, message: "Email already registered" });

    const hashed = await bcrypt.hash(password, 10);

    // Handle contract PDF upload if provided
    let contractDocUrl = null;
    if (req.file) {
      const uploaded = await cloudinary.uploader.upload(req.file.path, {
        resource_type: "raw",
        folder: "manufacturer_contracts",
      });
      contractDocUrl = uploaded.secure_url;
    }

    const startVal = contractStartDate || contractStart;
    const endVal = contractExpiryDate || contractEnd;

    const manufacturer = await prisma.manufacturer.create({
      data: {
        name: mfgName,
        email: email.toLowerCase().trim(),
        password: hashed,
        phone: phone.trim(),
        city: city.trim(),
        ncmPickupBranch: ncmPickupBranch ? String(ncmPickupBranch).trim().toUpperCase() : "",
        pickupBranchStatus: "UNVERIFIED",
        pickupAddress: pickupAddress || address || null,
        pickupContactName: pickupContactName || "",
        pickupContactPhone: pickupContactPhone || "",
        pickupWindow: pickupWindow || "",
        returnInstructions: returnInstructions || null,
        address: address || null,
        isActive: true,
        isAvailable: true,
        contractStatus: "ACTIVE",
        contractDocUrl,
        contractStartDate: startVal ? new Date(startVal) : null,
        contractExpiryDate: endVal ? new Date(endVal) : null,
        agreementNotes: agreementNotes || null,
      },
    });

    const { password: _, ...safe } = manufacturer;
    safe.businessName = safe.name;
    res.json({ success: true, message: "Manufacturer registered successfully", manufacturer: safe });
  } catch (error) {
    console.error("registerManufacturer error:", error);
    res.json({ success: false, message: error.message });
  }
};

const registerManufacturerSelf = async (req, res) => {
  try {
    const {
      name,
      businessName,
      email,
      password,
      phone,
      city,
      ncmPickupBranch,
      pickupAddress,
      pickupContactName,
      pickupContactPhone,
      pickupWindow,
      returnInstructions,
      address,
      contractStartDate,
      contractStart,
      contractExpiryDate,
      contractEnd,
      agreementNotes,
    } = req.body;

    const mfgName = (name || businessName || "").trim();
    if (!mfgName || !email || !password || !phone || !city || !pickupAddress) {
      return res.json({ success: false, message: "Business name, email, password, phone, city, and pickup address are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await prisma.manufacturer.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.json({ success: false, message: "Email already registered" });

    const hashed = await bcrypt.hash(password, 10);
    let contractDocUrl = null;
    if (req.file) {
      const uploaded = await cloudinary.uploader.upload(req.file.path, {
        resource_type: "raw",
        folder: "manufacturer_contracts",
      });
      contractDocUrl = uploaded.secure_url;
    }

    const startVal = contractStartDate || contractStart;
    const endVal = contractExpiryDate || contractEnd;

    const manufacturer = await prisma.manufacturer.create({
      data: {
        name: mfgName,
        email: normalizedEmail,
        password: hashed,
        phone: phone.trim(),
        city: city.trim(),
        ncmPickupBranch: ncmPickupBranch ? String(ncmPickupBranch).trim().toUpperCase() : "",
        pickupBranchStatus: "UNVERIFIED",
        pickupAddress: pickupAddress || address || null,
        pickupContactName: pickupContactName || "",
        pickupContactPhone: pickupContactPhone || "",
        pickupWindow: pickupWindow || "",
        returnInstructions: returnInstructions || null,
        address: address || null,
        isActive: false,
        isAvailable: false,
        contractStatus: "PENDING",
        contractDocUrl,
        contractStartDate: startVal ? new Date(startVal) : null,
        contractExpiryDate: endVal ? new Date(endVal) : null,
        agreementNotes: agreementNotes || "Application submitted for admin review.",
      },
    });

    const { password: _, ...safe } = manufacturer;
    safe.businessName = safe.name;
    res.json({ success: true, message: "Manufacturer registration submitted successfully. Admin review is required before your account becomes active.", manufacturer: safe });
  } catch (error) {
    console.error("registerManufacturerSelf error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── ADMIN: LIST ALL MANUFACTURERS ───────────────────────────────────────────
const listManufacturers = async (req, res) => {
  try {
    const manufacturers = await prisma.manufacturer.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { assignments: true, inventory: true } },
      },
    });
    const safe = manufacturers.map(({ password, ...m }) => ({
      ...m,
      businessName: m.name,
      contractStart: m.contractStartDate,
      contractEnd: m.contractExpiryDate,
      totalOrdersHandled: m.totalOrdersFulfilled || 0,
      onTimeRate: m.totalOrdersFulfilled > 0
        ? ((m.onTimeCount / m.totalOrdersFulfilled) * 100).toFixed(1)
        : "0.0",
      defectRate: m.totalOrdersFulfilled > 0
        ? ((m.defectCount / m.totalOrdersFulfilled) * 100).toFixed(1)
        : "0.0",
    }));
    res.json({ success: true, manufacturers: safe });
  } catch (error) {
    console.error("listManufacturers error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── ADMIN: SYNC MANUFACTURER RATINGS FROM CUSTOMER REVIEWS ──────────────────
const syncRatings = async (req, res) => {
  try {
    const manufacturerId = req.body?.manufacturerId;
    if (manufacturerId) {
      const result = await syncManufacturerRating(manufacturerId);
      return res.json({ success: true, message: "Manufacturer rating synchronized from customer reviews.", result });
    }
    await syncAllManufacturersRatings();
    res.json({ success: true, message: "All manufacturer ratings synchronized from customer reviews." });
  } catch (error) {
    console.error("syncRatings error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── ADMIN: UPDATE QUALITY RATING ────────────────────────────────────────────
const updateQualityRating = async (req, res) => {
  try {
    const manufacturerId = req.params?.id || req.body?.manufacturerId || req.body?.id;
    const { qualityRating, qualityNotes } = req.body;
    const rating = parseFloat(qualityRating);
    if (isNaN(rating) || rating < 0 || rating > 10)
      return res.json({ success: false, message: "Rating must be between 0 and 10" });

    const updateData = { qualityRating: rating };
    if (qualityNotes !== undefined) updateData.agreementNotes = qualityNotes;

    await prisma.manufacturer.update({
      where: { id: manufacturerId },
      data: updateData,
    });
    res.json({ success: true, message: "Quality rating updated" });
  } catch (error) {
    console.error("updateQualityRating error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── ADMIN: UPDATE CONTRACT STATUS ───────────────────────────────────────────
const updateContractStatus = async (req, res) => {
  try {
    const manufacturerId = req.params?.id || req.body?.manufacturerId || req.body?.id;
    const {
      contractStatus,
      contractExpiryDate,
      contractEnd,
      contractStartDate,
      contractStart,
      agreementNotes,
    } = req.body;

    const validStatuses = ["ACTIVE", "SUSPENDED", "TERMINATED", "PENDING", "REJECTED", "EXPIRED"];
    if (contractStatus && !validStatuses.includes(contractStatus))
      return res.json({ success: false, message: "Invalid contract status" });

    const updateData = {};
    if (contractStatus) updateData.contractStatus = contractStatus;
    if (agreementNotes !== undefined) updateData.agreementNotes = agreementNotes;

    const endVal = contractExpiryDate || contractEnd;
    const startVal = contractStartDate || contractStart;
    if (endVal) updateData.contractExpiryDate = new Date(endVal);
    if (startVal) updateData.contractStartDate = new Date(startVal);

    if (contractStatus === "ACTIVE") {
      updateData.isActive = true;
      updateData.isAvailable = true;
    }
    if (["PENDING", "REJECTED", "TERMINATED", "SUSPENDED"].includes(contractStatus || "")) {
      updateData.isActive = false;
      updateData.isAvailable = false;
    }
    if (contractStatus === "SUSPENDED") {
      updateData.isAvailable = false;
      updateData.isActive = false;
    }

    await prisma.manufacturer.update({ where: { id: manufacturerId }, data: updateData });
    res.json({ success: true, message: "Contract status updated" });
  } catch (error) {
    console.error("updateContractStatus error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── ADMIN: UPLOAD CONTRACT PDF ───────────────────────────────────────────────
const uploadContractDoc = async (req, res) => {
  try {
    const manufacturerId = req.params?.id || req.body?.manufacturerId || req.body?.id;
    if (!req.file) return res.json({ success: false, message: "No file provided" });

    const uploaded = await cloudinary.uploader.upload(req.file.path, {
      resource_type: "raw",
      folder: "manufacturer_contracts",
    });

    await prisma.manufacturer.update({
      where: { id: manufacturerId },
      data: { contractDocUrl: uploaded.secure_url },
    });
    res.json({ success: true, message: "Contract uploaded", contractDocUrl: uploaded.secure_url });
  } catch (error) {
    console.error("uploadContractDoc error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── ADMIN: UPDATE MANUFACTURER (general) ────────────────────────────────────
const updatePickupProfile = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId || req.body?.manufacturerId || req.params?.id;
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

    const updated = await prisma.manufacturer.update({ where: { id: manufacturerId }, data: updateData });
    const { password: _, ...safe } = updated;
    safe.businessName = safe.name;
    res.json({ success: true, message: "Pickup profile updated", manufacturer: safe });
  } catch (error) {
    console.error("updatePickupProfile error:", error);
    res.json({ success: false, message: error.message });
  }
};

const updateManufacturer = async (req, res) => {
  try {
    const manufacturerId = req.params?.id || req.body?.manufacturerId || req.body?.id;
    const {
      name,
      businessName,
      phone,
      city,
      ncmPickupBranch,
      pickupBranchStatus,
      pickupAddress,
      pickupContactName,
      pickupContactPhone,
      pickupWindow,
      returnInstructions,
      address,
      isActive,
      isAvailable,
      contractStatus,
      contractStartDate,
      contractStart,
      contractExpiryDate,
      contractEnd,
      agreementNotes,
    } = req.body;

    const updateData = {};
    const mfgName = name || businessName;
    if (mfgName !== undefined) updateData.name = mfgName;
    if (phone !== undefined) updateData.phone = phone;
    if (city !== undefined) updateData.city = city;
    if (ncmPickupBranch !== undefined) updateData.ncmPickupBranch = ncmPickupBranch ? String(ncmPickupBranch).trim().toUpperCase() : "";
    if (pickupBranchStatus !== undefined) updateData.pickupBranchStatus = String(pickupBranchStatus || "UNVERIFIED").trim().toUpperCase();
    if (pickupAddress !== undefined) updateData.pickupAddress = pickupAddress || null;
    if (pickupContactName !== undefined) updateData.pickupContactName = String(pickupContactName || "").trim();
    if (pickupContactPhone !== undefined) updateData.pickupContactPhone = String(pickupContactPhone || "").trim();
    if (pickupWindow !== undefined) updateData.pickupWindow = String(pickupWindow || "").trim();
    if (returnInstructions !== undefined) updateData.returnInstructions = returnInstructions || null;
    if (address !== undefined) updateData.address = address;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (isAvailable !== undefined) updateData.isAvailable = Boolean(isAvailable);
    if (contractStatus !== undefined) updateData.contractStatus = String(contractStatus).trim().toUpperCase();

    const startVal = contractStartDate || contractStart;
    const endVal = contractExpiryDate || contractEnd;
    if (startVal !== undefined) updateData.contractStartDate = startVal ? new Date(startVal) : null;
    if (endVal !== undefined) updateData.contractExpiryDate = endVal ? new Date(endVal) : null;
    if (agreementNotes !== undefined) updateData.agreementNotes = agreementNotes;

    const updated = await prisma.manufacturer.update({ where: { id: manufacturerId }, data: updateData });
    const { password: _, ...safe } = updated;
    safe.businessName = safe.name;
    res.json({ success: true, message: "Manufacturer updated", manufacturer: safe });
  } catch (error) {
    console.error("updateManufacturer error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── MANUFACTURER: GET OWN STATS ─────────────────────────────────────────────
const getManufacturerStats = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId || req.body?.manufacturerId;
    const manufacturer = await prisma.manufacturer.findUnique({
      where: { id: manufacturerId },
      include: {
        assignments: {
          orderBy: { assignedAt: "desc" },
          take: 10,
        },
        inventory: true,
      },
    });
    if (!manufacturer) return res.json({ success: false, message: "Not found" });

    const pending = await prisma.orderAssignment.count({
      where: { manufacturerId, status: "assigned" },
    });
    const active = await prisma.orderAssignment.count({
      where: { manufacturerId, status: { in: ["accepted", "preparing", "packed", "ready_for_pickup"] } },
    });

    const { password: _, assignments, inventory, ...stats } = manufacturer;
    res.json({
      success: true,
      stats: {
        ...stats,
        businessName: stats.name,
        onTimeRate: stats.totalOrdersFulfilled > 0
          ? ((stats.onTimeCount / stats.totalOrdersFulfilled) * 100).toFixed(1)
          : "0.0",
        pendingOrders: pending,
        activeOrders: active,
        inventoryCount: inventory.length,
      },
    });
  } catch (error) {
    console.error("getManufacturerStats error:", error);
    res.json({ success: false, message: error.message });
  }
};

const getAvailableNcmBranches = async (req, res) => {
  try {
    const city = String(req.query?.city || "").trim();
    const district = String(req.query?.district || "").trim();
    const province = String(req.query?.province || "").trim();
    const normalizeText = (value) => String(value || "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").replace(/[^a-z0-9]+/g, "");
    const normalizeBranch = (value) => String(value || "").trim().toUpperCase();
    const branchQuery = normalizeBranch(req.query?.branch || "");

    const extractBranchName = (branch) => {
      if (typeof branch === "string") return branch;
      return (
        branch?.name ||
        branch?.branch_name ||
        branch?.branchName ||
        branch?.branch ||
        branch?.branchCode ||
        branch?.code ||
        ""
      );
    };

    const extractBranchCity = (branch) => {
      if (typeof branch === "string") return "";
      return branch?.city || branch?.location || branch?.district || branch?.address || branch?.branch_city || "";
    };

    const matchesLocation = (branch) => {
      if (typeof branch === "string") return !district && !province;
      const branchDistrict = normalizeText(branch?.district_name || branch?.districtName || branch?.district || "");
      const branchProvince = normalizeText(branch?.province_name || branch?.provinceName || branch?.province || "");
      const requestedDistrict = normalizeText(district);
      const requestedProvince = normalizeText(province).replace(/province$/, "");

      if (requestedDistrict && branchDistrict) {
        if (branchDistrict !== requestedDistrict) return false;
      }
      if (requestedProvince && branchProvince) {
        if (branchProvince !== requestedProvince && !branchProvince.includes(requestedProvince) && !requestedProvince.includes(branchProvince)) return false;
      }
      return true;
    };

    const extractCoveredAreas = (branch) => {
      if (!branch || typeof branch === "string") return [];
      const values = [
        branch.covered_areas,
        branch.areas_covered,
        branch.coveredAreas,
        branch.covered_area,
        branch.coveredArea,
        branch.areas,
        branch.coverage,
      ].flat(Infinity);
      return [...new Set(values
        .flatMap((value) => typeof value === "string" ? value.split(/[,;|]/) : [value])
        .map((value) => typeof value === "object" ? value?.name || value?.area || value?.title : value)
        .map((value) => String(value || "").trim())
        .filter(Boolean))];
    };

    const rawBranches = await getCachedNcmBranches();
    const apiBranches = [...new Set(rawBranches.map(getNcmBranchName).filter(Boolean))].sort();

    const searchText = normalizeText(district || city || province);
    const matchingApiBranches = rawBranches.filter((branch) => {
      if (branchQuery && normalizeBranch(extractBranchName(branch)) !== branchQuery) return false;
      if (branchQuery) return true;
      if (!matchesLocation(branch)) return false;
      if (!searchText) return true;
      const searchable = [
        extractBranchName(branch),
        extractBranchCity(branch),
        branch?.district,
        branch?.district_name,
        branch?.districtName,
        branch?.province,
        branch?.province_name,
        branch?.provinceName,
        branch?.region,
        branch?.areas_covered,
        branch?.covered_areas,
        branch?.coveredAreas,
      ].flat().join(" ");
      return normalizeText(searchable).includes(searchText);
    });
    const filteredApiBranches = [...new Set(matchingApiBranches.map(extractBranchName).map(normalizeBranch).filter(Boolean))].sort();

    if (!city && !district && !province && !branchQuery) {
      return res.json({ success: true, branches: apiBranches, coveredAreas: [] });
    }

    const normalizedCity = normalizeText(city);
    const cityMatches = apiBranches.filter((branchName) => {
      if (!normalizedCity) return false;
      const branchText = normalizeText(branchName);
      const cityText = normalizedCity;
      const exactCityMatch = branchText.includes(cityText) || cityText.includes(branchText);
      if (exactCityMatch) return true;

      const matchingRawBranches = rawBranches.filter((branch) => normalizeBranch(extractBranchName(branch)) === branchName);
      return matchingRawBranches.some((branch) => {
        const branchCity = normalizeText(extractBranchCity(branch));
        return branchCity.includes(cityText) || cityText.includes(branchCity);
      });
    });

    const finalBranches = [...new Set([
      ...cityMatches,
      ...filteredApiBranches,
    ])]
      .filter(Boolean)
      .sort();

    const coveredAreas = [...new Set(matchingApiBranches.flatMap(extractCoveredAreas))].sort();
    res.json({ success: true, branches: finalBranches, coveredAreas });
  } catch (error) {
    console.error("getAvailableNcmBranches error:", error);
    res.status(503).json({ success: false, branches: [], coveredAreas: [], message: "NCM branch catalog is temporarily unavailable" });
  }
};

export {
  loginManufacturer,
  getProfile,
  updateAvailability,
  registerManufacturer,
  registerManufacturerSelf,
  listManufacturers,
  syncRatings,
  updateQualityRating,
  updateContractStatus,
  uploadContractDoc,
  updateManufacturer,
  updatePickupProfile,
  getManufacturerStats,
  getAvailableNcmBranches,
  syncNcmBranches,
};
