import { prisma } from "../config/db.js";
import validator from "validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { decryptAES } from "../utils/crypto.js";

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
