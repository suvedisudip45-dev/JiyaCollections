import { prisma } from "../config/db.js";
import validator from "validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { decryptAES } from "../utils/crypto.js";
import { sanitizeText } from "../middleware/sanitize.js";
import {
  buildInactiveSocialProfile,
  generateSocialCustomerCode,
  isValidMobileNumber,
  normalizeGender,
  normalizePhoneNumber,
} from "../utils/socialCustomerProfile.js";
import { assignAccountRole } from "../services/rbacService.js";
import { setRefreshCookie } from "../utils/refreshCookie.js";

const createToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET);
};

// Helper: Safely parse JSON array field from Prisma
const parseJsonArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

// Route for user login
const loginUser = async (req, res) => {
  const ipAddress = req.ip || req.headers["x-forwarded-for"] || "";
  const userAgent = req.headers["user-agent"] || "";
  try {
    const { email, phone, identifier, encryptedPassword, iv, password } = req.body;
    const loginIdentifier = identifier || email || phone;

    if (!loginIdentifier) {
      return res.json({ success: false, message: "Email or mobile number is required" });
    }

    let resolvedPassword;
    if (encryptedPassword && iv) {
      try {
        resolvedPassword = decryptAES(encryptedPassword, iv);
      } catch {
        return res.json({ success: false, message: "Invalid encrypted credentials" });
      }
    } else if (password) {
      resolvedPassword = String(password);
    } else {
      return res.json({ success: false, message: "Password is required" });
    }

    const { authenticateAccount } = await import("../services/authService.js");
    const authResult = await authenticateAccount({
      identifier: loginIdentifier,
      password: resolvedPassword,
      targetPortal: "CUSTOMER",
      ipAddress,
      userAgent,
    });
    setRefreshCookie(res, "CUSTOMER", authResult.refreshToken, authResult.refreshTokenExpiresAt);

    const addresses = parseJsonArray(authResult.profile?.addresses);
    res.json({
      success: true,
      token: authResult.token,
      accessToken: authResult.accessToken,
      refreshTokenExpiresAt: authResult.refreshTokenExpiresAt,
      user: {
        id: authResult.profile.id,
        firstName: authResult.profile.firstName || "",
        lastName: authResult.profile.lastName || "",
        name: authResult.profile.name || `${authResult.profile.firstName || ""} ${authResult.profile.lastName || ""}`.trim(),
        email: authResult.profile.email,
        phone: authResult.profile.phone || "",
        socialCustomerCode: authResult.profile.socialCustomerCode || "",
        gender: authResult.profile.gender || "PREFER_NOT_TO_SAY",
        addresses,
      },
    });
  } catch (error) {
    res.json({ success: false, message: error.message || "Invalid credentials" });
  }
};

// Route for user register
const registerUser = async (req, res) => {
  try {
    const { firstName, lastName, name, email, phone, password, gender } = req.body;

    const normalizedGender = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"].includes(String(gender || "").trim().toUpperCase())
      ? String(gender).trim().toUpperCase()
      : "PREFER_NOT_TO_SAY";

    // Validate name fields
    let fName = sanitizeText(firstName || "", { stripAllHtml: true }) || "";
    let lName = sanitizeText(lastName || "", { stripAllHtml: true }) || "";
    let fullName = "";

    if (fName && lName) {
      fullName = fName.concat(" ").concat(lName);
    } else if (fName) {
      fullName = fName;
    } else if (name) {
      fullName = sanitizeText(name, { stripAllHtml: true }) || "";
      const parts = fullName.split(" ");
      fName = parts[0] || "";
      lName = parts.slice(1).join(" ") || "";
    } else {
      return res.json({
        success: false,
        message: "Please enter your first and last name",
      });
    }

    if (!fName) {
      return res.json({ success: false, message: "Please enter your first name" });
    }
    if (!lName) {
      return res.json({ success: false, message: "Please enter your last name" });
    }

    const cleanEmail = sanitizeText(email, { stripAllHtml: true }).toLowerCase();

    // Checking user already exists or not
    const exists = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (exists) {
      return res.json({ success: false, message: "User already exists with this email" });
    }

    // Validating email format
    if (!validator.isEmail(email)) {
      return res.json({
        success: false,
        message: "Please enter a valid email address",
      });
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    if (!isValidMobileNumber(normalizedPhone)) {
      return res.json({
        success: false,
        message: "Please enter a valid mobile number starting with 98 or 97",
      });
    }

    const duplicatePhoneUser = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: normalizedPhone },
          { socialCustomerPhone: normalizedPhone },
        ],
      },
    });

    if (duplicatePhoneUser) {
      return res.json({
        success: false,
        message: "This mobile number is already used by another customer",
      });
    }

    // Validating strong password
    if (!password || password.length < 8) {
      return res.json({
        success: false,
        message: "Please enter a strong password (minimum 8 characters)",
      });
    }

    // Hashing user password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const { account, user } = await prisma.$transaction(async (tx) => {
      const newAccount = await tx.authAccount.create({
        data: {
          email: cleanEmail,
          phone: normalizedPhone,
          passwordHash: hashedPassword,
          role: "CUSTOMER",
          status: "ACTIVE",
          isEmailVerified: false,
          isPhoneVerified: false,
        },
      });
      await assignAccountRole(newAccount.id, "CUSTOMER", { client: tx });

      const newUser = await tx.user.create({
        data: {
          accountId: newAccount.id,
          firstName: fName,
          lastName: lName,
          phone: normalizedPhone,
          gender: normalizedGender,
          name: fName.concat(" ").concat(lName),
          email: cleanEmail,
          password: hashedPassword,
          socialCustomerCode: generateSocialCustomerCode(),
          socialCustomerPhone: normalizedPhone,
          cartData: {},
          addresses: [],
        },
      });

      return { account: newAccount, user: newUser };
    });

    const { authenticateAccount } = await import("../services/authService.js");
    const authResult = await authenticateAccount({
      identifier: cleanEmail,
      password,
      targetPortal: "CUSTOMER",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
      userAgent: req.headers["user-agent"] || "",
    });
    setRefreshCookie(res, "CUSTOMER", authResult.refreshToken, authResult.refreshTokenExpiresAt);

    res.json({
      success: true,
      token: authResult.accessToken,
      accessToken: authResult.accessToken,
      refreshTokenExpiresAt: authResult.refreshTokenExpiresAt,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        email: user.email,
        phone: user.phone,
        socialCustomerCode: user.socialCustomerCode || "",
        gender: user.gender || "PREFER_NOT_TO_SAY",
        addresses: [],
      },
    });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export const createInactiveSocialCustomerProfile = async (payload = {}) => {
  const {
    firstName = "",
    lastName = "",
    phone = "",
    email = "",
    gender = "",
    province = "",
    city = "",
    district = "",
    state = "",
    country = "",
    address = {},
    socialUsername = "",
    source = "Social Media",
    loyaltyTier = "",
    orderId = "",
    ncmBranch = "",
  } = payload;

  const normalizedPhone = normalizePhoneNumber(phone);
  if (!isValidMobileNumber(normalizedPhone)) {
    throw new Error("Please enter a valid mobile number starting with 98 or 97");
  }

  let code = generateSocialCustomerCode();
  let attempts = 0;
  while (attempts < 10) {
    const existingCode = await prisma.user.findUnique({ where: { socialCustomerCode: code } });
    if (!existingCode) break;
    code = generateSocialCustomerCode();
    attempts += 1;
  }

  const existingProfile = await prisma.user.findFirst({
    where: {
      OR: [
        { phone: { in: [normalizedPhone, `977${normalizedPhone}`, `+977${normalizedPhone}`] } },
        { socialCustomerPhone: { in: [normalizedPhone, `977${normalizedPhone}`, `+977${normalizedPhone}`] } },
      ],
    },
  });

  if (existingProfile && existingProfile.isInactiveProfile) {
    return {
      success: true,
      code: existingProfile.socialCustomerCode,
      user: existingProfile,
      message: "Inactive social profile already exists for this phone number",
    };
  }

  if (existingProfile && !existingProfile.isInactiveProfile) {
    return {
      success: false,
      code: null,
      user: existingProfile,
      message: "This phone number is already linked to an active website account",
    };
  }

  const baseProfile = buildInactiveSocialProfile({
    firstName,
    lastName,
    phone: normalizedPhone,
    email,
    gender,
    province,
    city,
    district,
    state,
    country,
    address,
    socialUsername,
    source,
    loyaltyTier,
    orderId,
    ncmBranch,
  });

  const generatedCode = baseProfile.socialCustomerCode;
  const activeCode = code && code.length === 8 ? code : generatedCode;
  const candidateEmail = (email && validator.isEmail(email.trim()))
    ? email.trim().toLowerCase()
    : `social.${normalizedPhone}.${activeCode.toLowerCase()}@inactive.local`;

  const duplicateEmail = await prisma.user.findUnique({ where: { email: candidateEmail } });
  const finalEmail = duplicateEmail ? `social.${normalizedPhone}.${Date.now()}.${activeCode.toLowerCase()}@inactive.local` : candidateEmail;
  const socialPassword = await bcrypt.hash(`social-${activeCode.toLowerCase()}`, 10);
  const socialAddress = Array.isArray(address) ? address : (address && Object.keys(address).length ? [address] : []);

  const user = await prisma.user.create({
    data: {
      firstName: (firstName || "").trim() || "",
      lastName: (lastName || "").trim() || "",
      name: `${(firstName || "").trim()} ${(lastName || "").trim()}`.trim() || "Social Media Customer",
      phone: normalizedPhone,
      gender: normalizeGender(gender),
      email: finalEmail,
      password: socialPassword,
      socialCustomerCode: activeCode,
      socialCustomerPhone: normalizedPhone,
      loyaltyTier: String(loyaltyTier || "").trim(),
      isInactiveProfile: true,
      inactiveProfileData: {
        ...baseProfile.inactiveProfileData,
        source: String(source || "Social Media").trim() || "Social Media",
        loyaltyTier: String(loyaltyTier || "").trim(),
      },
      cartData: {},
      addresses: socialAddress,
    },
  });

  return {
    success: true,
    code: activeCode,
    user,
    message: "Inactive website profile created for social media customer",
  };
};

export const validateSocialCustomerProfile = async (req, res) => {
  try {
    const { phone, code } = req.body;
    const normalizedPhone = normalizePhoneNumber(phone);
    const normalizedCode = String(code || "").trim().toUpperCase();

    if (!normalizedPhone || !normalizedCode) {
      return res.json({
        success: false,
        message: "Mobile number and secret code are required",
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        phone: normalizedPhone,
        socialCustomerCode: normalizedCode,
        isInactiveProfile: true,
      },
    });

    if (!user) {
      const existingPhone = await prisma.user.findFirst({
        where: {
          OR: [
            { phone: normalizedPhone },
            { socialCustomerPhone: normalizedPhone },
          ],
        },
      });

      if (existingPhone) {
        return res.json({
          success: false,
          message: "contact number and code didnot match",
        });
      }

      return res.json({
        success: false,
        message: "contact number and code didnot match",
      });
    }

    const inactiveProfileData = typeof user.inactiveProfileData === "string"
      ? JSON.parse(user.inactiveProfileData || "{}")
      : (user.inactiveProfileData || {});

    return res.json({
      success: true,
      customer: {
        id: user.id,
        firstName: user.firstName || inactiveProfileData.firstName || "",
        lastName: user.lastName || inactiveProfileData.lastName || "",
        name: user.name || `${user.firstName || inactiveProfileData.firstName || ""} ${user.lastName || inactiveProfileData.lastName || ""}`.trim() || "Social Customer",
        phone: user.phone || user.socialCustomerPhone || normalizedPhone,
        gender: user.gender || inactiveProfileData.gender || "PREFER_NOT_TO_SAY",
        socialCustomerCode: user.socialCustomerCode,
        loyaltyTier: user.loyaltyTier || inactiveProfileData.loyaltyTier || "",
        inactiveProfileData,
      },
    });
  } catch (error) {
    console.error("Error validating social customer profile:", error);
    res.json({ success: false, message: error.message || "Unable to validate profile" });
  }
};

export const activateSocialCustomerProfile = async (req, res) => {
  try {
    const {
      phone,
      code,
      email,
      password,
      firstName,
      lastName,
      gender,
      extraData = {},
    } = req.body;

    const normalizedPhone = normalizePhoneNumber(phone);
    const normalizedCode = String(code || "").trim().toUpperCase();

    if (!normalizedPhone || !normalizedCode) {
      return res.json({
        success: false,
        message: "Mobile number and secret code are required",
      });
    }

    if (!email || !validator.isEmail(String(email).trim())) {
      return res.json({ success: false, message: "Please enter a valid email address" });
    }

    if (!password || String(password).length < 8) {
      return res.json({
        success: false,
        message: "Please enter a strong password (minimum 8 characters)",
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        phone: normalizedPhone,
        socialCustomerCode: normalizedCode,
        isInactiveProfile: true,
      },
    });

    if (!user) {
      return res.json({
        success: false,
        message: "Invalid mobile number or secret code. Please check the code provided during your purchase.",
      });
    }

    const candidateEmail = String(email).trim().toLowerCase();
    const existingEmailUser = await prisma.user.findUnique({ where: { email: candidateEmail } });
    if (existingEmailUser && existingEmailUser.id !== user.id) {
      return res.json({ success: false, message: "This email is already registered to another account" });
    }

    const inactiveProfileData = typeof user.inactiveProfileData === "string"
      ? JSON.parse(user.inactiveProfileData || "{}")
      : (user.inactiveProfileData || {});

    const finalFirstName = String(firstName || inactiveProfileData.firstName || user.firstName || "").trim();
    const finalLastName = String(lastName || inactiveProfileData.lastName || user.lastName || "").trim();
    const finalGender = normalizeGender(gender || inactiveProfileData.gender || user.gender || "");
    const profileAddress = Array.isArray(inactiveProfileData.addresses)
      ? inactiveProfileData.addresses
      : (Array.isArray(user.addresses) ? user.addresses : []);
    const mergedAddresses = Array.isArray(extraData.addresses) ? extraData.addresses : profileAddress;

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: finalFirstName,
        lastName: finalLastName,
        name: `${finalFirstName} ${finalLastName}`.trim() || "Social Customer",
        email: candidateEmail,
        password: hashedPassword,
        phone: normalizedPhone,
        gender: finalGender,
        isInactiveProfile: false,
        inactiveProfileData: {
          ...inactiveProfileData,
          email: candidateEmail,
          phone: normalizedPhone,
          gender: finalGender,
          activationCompletedAt: new Date().toISOString(),
          ...extraData,
        },
        addresses: mergedAddresses,
      },
    });

    const token = createToken(updatedUser.id);

    res.json({
      success: true,
      token,
      user: {
        id: updatedUser.id,
        firstName: updatedUser.firstName || "",
        lastName: updatedUser.lastName || "",
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone || "",
        socialCustomerCode: updatedUser.socialCustomerCode || "",
        gender: updatedUser.gender || "PREFER_NOT_TO_SAY",
        addresses: mergedAddresses,
      },
      loyaltyTier: updatedUser.loyaltyTier || inactiveProfileData.loyaltyTier || "",
    });
  } catch (error) {
    console.error("Error activating social customer profile:", error);
    res.json({ success: false, message: error.message || "Unable to activate loyalty profile" });
  }
};

// Route for getting user profile details
const getUserProfile = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }

    const addresses = parseJsonArray(user.addresses);

    res.json({
      success: true,
      user: {
        id: user.id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        name: user.name,
        email: user.email,
        phone: user.phone || "",
        socialCustomerCode: user.socialCustomerCode || "",
        gender: user.gender || "PREFER_NOT_TO_SAY",
        addresses,
      },
    });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// Route for saving user address
const saveUserAddress = async (req, res) => {
  try {
    const { userId, address } = req.body;
    if (!address) {
      return res.json({ success: false, message: "Address is required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }

    let addresses = parseJsonArray(user.addresses);

    if (address.id) {
      addresses = addresses.map((a) => (a.id === address.id ? { ...a, ...address } : a));
    } else {
      const newAddress = {
        ...address,
        id: Date.now().toString(),
        createdAt: Date.now(),
      };
      addresses = [
        newAddress,
        ...addresses.filter(
          (a) =>
            !(
              a.city === address.city &&
              a.street === address.street &&
              a.state === address.state
            )
        ),
      ];
    }

    // Keep max 5 saved addresses
    if (addresses.length > 5) {
      addresses = addresses.slice(0, 5);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { addresses },
    });

    res.json({ success: true, message: "Address saved successfully", addresses });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// Route for deleting user address
const deleteUserAddress = async (req, res) => {
  try {
    const { userId, addressId } = req.body;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }

    let addresses = parseJsonArray(user.addresses);
    addresses = addresses.filter((a) => a.id !== addressId);

    await prisma.user.update({
      where: { id: userId },
      data: { addresses },
    });

    res.json({ success: true, message: "Address removed", addresses });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// Route for updating user profile (name, phone only — email is immutable)
const updateUserProfile = async (req, res) => {
  try {
    const { userId, firstName, lastName, phone } = req.body;

    let fName = sanitizeText(firstName || "", { stripAllHtml: true }) || "";
    let lName = sanitizeText(lastName || "", { stripAllHtml: true }) || "";

    if (!fName) return res.json({ success: false, message: "First name is required" });
    if (!lName) return res.json({ success: false, message: "Last name is required" });

    const normalizedPhone = normalizePhoneNumber(phone);
    if (phone && phone.trim().length > 0 && !isValidMobileNumber(normalizedPhone)) {
      return res.json({ success: false, message: "Please enter a valid mobile number starting with 98 or 97" });
    }

    const existingPhoneUser = phone && phone.trim().length > 0
      ? await prisma.user.findFirst({
          where: {
            OR: [
              { phone: normalizedPhone },
              { socialCustomerPhone: normalizedPhone },
            ],
          },
        })
      : null;

    if (existingPhoneUser && existingPhoneUser.id !== userId) {
      return res.json({ success: false, message: "This mobile number is already used by another customer" });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: fName,
        lastName: lName,
        name: fName.concat(" ").concat(lName),
        phone: normalizedPhone || "",
      },
    });

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: updatedUser.id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone || "",
      },
    });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// Route for changing user password (current password must match)
const changePassword = async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.json({ success: false, message: "Both current and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.json({ success: false, message: "New password must be at least 8 characters" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.json({ success: false, message: "User not found" });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.json({ success: false, message: "Current password is incorrect" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// Route for admin login — credentials stored in DB, password AES-encrypted in transit
const adminLogin = async (req, res) => {
  const ipAddress = req.ip || req.headers["x-forwarded-for"] || "";
  const userAgent = req.headers["user-agent"] || "";
  try {
    const { email, encryptedPassword, iv, password } = req.body;

    if (!email) {
      return res.json({ success: false, message: "Please enter a valid email address" });
    }

    let resolvedPassword;
    if (encryptedPassword && iv) {
      try {
        resolvedPassword = decryptAES(encryptedPassword, iv);
      } catch {
        return res.json({ success: false, message: "Invalid encrypted credentials" });
      }
    } else if (password) {
      resolvedPassword = String(password);
    } else {
      return res.json({ success: false, message: "Email and password are required" });
    }

    const { authenticateAccount } = await import("../services/authService.js");
    const authResult = await authenticateAccount({
      identifier: email,
      password: resolvedPassword,
      targetPortal: "ADMIN",
      ipAddress,
      userAgent,
    });

    setRefreshCookie(res, "ADMIN", authResult.refreshToken, authResult.refreshTokenExpiresAt);
    res.json({
      success: true,
      token: authResult.accessToken,
      accessToken: authResult.accessToken,
      refreshTokenExpiresAt: authResult.refreshTokenExpiresAt,
      account: authResult.account,
      admin: authResult.profile,
    });
  } catch (error) {
    res.json({ success: false, message: error.message || "Invalid credentials" });
  }
};

export {
  loginUser,
  registerUser,
  getUserProfile,
  updateUserProfile,
  changePassword,
  saveUserAddress,
  deleteUserAddress,
  adminLogin,
};
