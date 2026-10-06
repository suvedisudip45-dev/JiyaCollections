import { prisma } from "../config/db.js";
import bcrypt from "bcryptjs";
import { decryptAES } from "../utils/crypto.js";
import { logAuthEvent } from "../services/authService.js";

/**
 * POST /api/user/admin/change-password
 * Protected by authAdmin middleware.
 * Body: { currentEncryptedPassword, currentIv, newEncryptedPassword, newIv }
 */
const adminChangePassword = async (req, res) => {
  try {
    const { accountId, profileId } = req.auth;
    const {
      currentEncryptedPassword,
      currentIv,
      newEncryptedPassword,
      newIv,
    } = req.body;

    if (
      !currentEncryptedPassword ||
      !currentIv ||
      !newEncryptedPassword ||
      !newIv
    ) {
      return res.json({
        success: false,
        message: "All password fields are required",
      });
    }

    // Decrypt incoming AES-encrypted passwords
    const currentPassword = decryptAES(currentEncryptedPassword, currentIv);
    const newPassword = decryptAES(newEncryptedPassword, newIv);

    if (!newPassword || newPassword.length < 8) {
      return res.json({
        success: false,
        message: "New password must be at least 8 characters",
      });
    }

    const [account, admin] = await Promise.all([
      prisma.authAccount.findUnique({ where: { id: accountId } }),
      prisma.admin.findUnique({ where: { id: profileId } }),
    ]);
    if (!account || !admin || admin.accountId !== account.id) {
      return res.json({ success: false, message: "Admin not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, account.passwordHash);
    if (!isMatch) {
      await logAuthEvent({
        accountId: account.id,
        identifier: account.email,
        action: "ADMIN_PASSWORD_CHANGE_FAILED",
        role: "ADMIN",
        portal: "ADMIN",
        ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
        userAgent: req.headers["user-agent"] || "",
        correlationId: req.correlationId || null,
        status: "FAILED",
        failureReason: "INVALID_CURRENT_PASSWORD",
      });
      return res.json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash and save new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.$transaction([
      prisma.authAccount.update({
        where: { id: account.id },
        data: {
          passwordHash: hashedPassword,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
        },
      }),
      prisma.admin.update({
        where: { id: admin.id },
        data: { password: hashedPassword },
      }),
    ]);

    await logAuthEvent({
      accountId: account.id,
      identifier: account.email,
      action: "ADMIN_PASSWORD_CHANGED",
      role: "ADMIN",
      portal: "ADMIN",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
      userAgent: req.headers["user-agent"] || "",
      correlationId: req.correlationId || null,
      status: "SUCCESS",
    });
    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export { adminChangePassword };
