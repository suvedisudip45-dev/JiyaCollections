import { prisma } from "../config/db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v2 as cloudinary } from "cloudinary";
import { getBranches } from "../services/ncmClient.js";
import { syncManufacturerRating, syncAllManufacturersRatings } from "../services/manufacturerRatingService.js";

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
    const rawBranchMap = (() => {
      try {
        return JSON.parse(process.env.NCM_BRANCH_MAP_JSON || "{}") || {};
      } catch {
        return {};
      }
    })();

    const normalizeText = (value) => String(value || "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").replace(/[^a-z0-9]+/g, "");
    const normalizeBranch = (value) => String(value || "").trim().toUpperCase();

    const cityAliases = {
      lalitpur: ["lalitpur", "patan"],
      patan: ["lalitpur", "patan"],
      bhaktapur: ["bhaktapur", "madhyapurthimi"],
      bharatpur: ["bharatpur", "chitwan"],
      chitwan: ["bharatpur", "chitwan"],
      bhairahawa: ["bhairahawa", "siddharthanagar"],
      siddharthanagar: ["bhairahawa", "siddharthanagar"],
      surkhet: ["surkhet", "birendranagar"],
      birendranagar: ["surkhet", "birendranagar"],
      lamjung: ["lamjung", "besisahar"],
      besisahar: ["lamjung", "besisahar"],
      baglung: ["baglung"],
      dharan: ["dharan", "itahari"],
      itahari: ["dharan", "itahari"],
    };

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

    const pickPriorityBranches = (selectedCity) => {
      const candidates = [];
      const normalizedKey = normalizeText(selectedCity);
      const aliasKeys = new Set([normalizedKey]);

      Object.keys(cityAliases).forEach((key) => {
        if (key === normalizedKey || cityAliases[key].includes(normalizedKey)) {
          aliasKeys.add(key);
          cityAliases[key].forEach((alias) => aliasKeys.add(normalizeText(alias)));
        }
      });

      [...aliasKeys].forEach((cityKey) => {
        const directValue = rawBranchMap[cityKey] || rawBranchMap[selectedCity] || rawBranchMap[selectedCity.toLowerCase()];
        if (Array.isArray(directValue)) {
          directValue.forEach((item) => candidates.push(normalizeBranch(item)));
        } else if (directValue) {
          candidates.push(normalizeBranch(directValue));
        }
      });

      Object.entries(rawBranchMap).forEach(([key, value]) => {
        const keyNorm = normalizeText(key);
        if (keyNorm && keyNorm.includes(normalizedKey) && keyNorm !== normalizedKey) {
          if (Array.isArray(value)) {
            value.forEach((item) => candidates.push(normalizeBranch(item)));
          } else if (value) {
            candidates.push(normalizeBranch(value));
          }
        }
      });

      return [...new Set(candidates.filter(Boolean))];
    };

    const response = await getBranches();
    const rawBranches = Array.isArray(response?.data) ? response.data : Array.isArray(response?.data?.results) ? response.data.results : [];
    const apiBranches = [...new Set(
      rawBranches
        .map((branch) => {
          const name = extractBranchName(branch);
          return name ? normalizeBranch(name) : null;
        })
        .filter(Boolean)
    )].sort();

    const defaultBranches = [
      "TINKUNE",
      "POKHARA",
      "BIRATNAGAR",
      "BHARATPUR",
      "BUTWAL",
      "DANG",
      "DHARAN",
      "HETAUDA",
      "LALITPUR",
      "KATHMANDU",
    ];

    if (!city) {
      return res.json({ success: true, branches: [...new Set([...apiBranches, ...defaultBranches])].sort() });
    }

    const preferred = pickPriorityBranches(city);
    const normalizedCity = normalizeText(city);
    const cityMatches = apiBranches.filter((branchName) => {
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

    const finalBranches = [...new Set([...preferred, ...cityMatches, ...apiBranches, ...defaultBranches])]
      .filter(Boolean)
      .sort();

    res.json({ success: true, branches: finalBranches });
  } catch (error) {
    console.error("getAvailableNcmBranches error:", error);
    res.json({ success: true, branches: ["TINKUNE", "POKHARA", "BIRATNAGAR", "BHARATPUR", "BUTWAL", "DANG", "DHARAN", "HETAUDA", "LALITPUR", "KATHMANDU"] });
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
};
