import { prisma } from "../config/db.js";
import validator from "validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { decryptAES } from "../utils/crypto.js";
import {
  buildInactiveSocialProfile,
  generateSocialCustomerCode,
  normalizeGender,
  normalizePhoneNumber,
} from "../utils/socialCustomerProfile.js";

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
  try {
    const { email, encryptedPassword, iv } = req.body;

    if (!encryptedPassword || !iv) {
      return res.json({ success: false, message: "Encrypted password and IV are required" });
    }

    // Decrypt the AES-encrypted password sent from the client
    let password;
    try {
      password = decryptAES(encryptedPassword, iv);
    } catch {
      return res.json({ success: false, message: "Invalid encrypted credentials" });
    }

    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user) {
      return res.json({ success: false, message: "User doesn't exist" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (isMatch) {
      const token = createToken(user.id);
      const addresses = parseJsonArray(user.addresses);
      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          name: user.name,
          email: user.email,
          phone: user.phone || "",
          gender: user.gender || "PREFER_NOT_TO_SAY",
          addresses,
        },
      });
    } else {
      res.json({ success: false, message: "Invalid credentials" });
    }
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
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
    let fName = (firstName || "").trim();
    let lName = (lastName || "").trim();
    let fullName = "";

    if (fName && lName) {
      fullName = fName.concat(" ").concat(lName);
    } else if (fName) {
      fullName = fName;
    } else if (name) {
      fullName = name.trim();
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

    // Checking user already exists or not
    const exists = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
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

    // Validating phone number if provided
    if (phone && phone.trim().length < 7) {
      return res.json({
        success: false,
        message: "Please enter a valid phone number",
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

    const user = await prisma.user.create({
      data: {
        firstName: fName,
        lastName: lName,
        phone: phone ? phone.trim() : "",
        gender: normalizedGender,
        name: fName.concat(" ").concat(lName),
        email: email.trim().toLowerCase(),
        password: hashedPassword,
        cartData: {},
        addresses: [],
      },
    });

    const token = createToken(user.id);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        email: user.email,
        phone: user.phone,
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
    city = "",
    district = "",
    state = "",
    country = "",
    address = {},
    socialUsername = "",
    source = "Social Media",
    loyaltyTier = "",
    orderId = "",
  } = payload;

  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) {
    throw new Error("Phone number is required to create a social media profile");
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
        { phone: normalizedPhone },
        { socialCustomerPhone: normalizedPhone },
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
    city,
    district,
    state,
    country,
    address,
    socialUsername,
    source,
    loyaltyTier,
    orderId,
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
      const active = await prisma.user.findFirst({
        where: {
          OR: [
            { phone: normalizedPhone },
            { socialCustomerPhone: normalizedPhone },
          ],
          isInactiveProfile: false,
        },
      });

      if (active) {
        return res.json({
          success: false,
          message: "This mobile number already belongs to an active website profile. Please log in.",
        });
      }

      return res.json({
        success: false,
        message: "Invalid mobile number or secret code. Please check the code provided during your social-media purchase.",
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

    let fName = (firstName || "").trim();
    let lName = (lastName || "").trim();

    if (!fName) return res.json({ success: false, message: "First name is required" });
    if (!lName) return res.json({ success: false, message: "Last name is required" });

    if (phone && phone.trim().length > 0 && phone.trim().length < 7) {
      return res.json({ success: false, message: "Please enter a valid phone number" });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: fName,
        lastName: lName,
        name: fName.concat(" ").concat(lName),
        phone: phone ? phone.trim() : "",
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
  try {
    const { email, encryptedPassword, iv } = req.body;

    if (!email || !encryptedPassword || !iv) {
      return res.json({ success: false, message: "Email and encrypted password are required" });
    }

    // Decrypt the AES-encrypted password
    let password;
    try {
      password = decryptAES(encryptedPassword, iv);
    } catch {
      return res.json({ success: false, message: "Invalid encrypted credentials" });
    }

    // Look up admin in DB
    const admin = await prisma.admin.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!admin) {
      return res.json({ success: false, message: "Invalid credentials" });
    }

    // Compare bcrypt hash
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.json({ success: false, message: "Invalid credentials" });
    }

    // Sign JWT with role:admin so authAdmin middleware can verify it
    const token = jwt.sign(
      { adminId: admin.id, role: "admin" },
      process.env.JWT_SECRET
    );
    res.json({ success: true, token });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
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
