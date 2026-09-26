import { prisma } from "../config/db.js";
import bcrypt from "bcryptjs";
import { decryptAES } from "../utils/crypto.js";

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
        },
      }),
      prisma.admin.update({
        where: { id: admin.id },
        data: { password: hashedPassword },
      }),
    ]);

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export { adminChangePassword };
