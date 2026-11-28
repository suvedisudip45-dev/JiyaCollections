import { unlink } from "node:fs/promises";
import { v2 as cloudinary } from "cloudinary";
import { prisma } from "../config/db.js";
import { saveAccountProfileImage } from "../services/accountProfileImageService.js";

const PROFILE_IMAGE_ROLES = new Set(["ADMIN", "MANUFACTURER", "DISTRIBUTOR"]);

export const requireProfileImageWorkspace = (req, res, next) => {
  const role = String(req.auth?.role || "").toUpperCase();
  if (!PROFILE_IMAGE_ROLES.has(role)) {
    return res.status(403).json({ success: false, message: "Profile images are not available for this workspace." });
  }
  return next();
};

export const updateAccountProfileImage = async (req, res) => {
  const accountId = req.auth?.accountId;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Choose an image to upload." });
    }
    const updated = await saveAccountProfileImage({
      database: prisma,
      mediaStorage: cloudinary,
      accountId,
      filePath: req.file.path,
    });

    return res.json({
      success: true,
      message: "Profile image updated.",
      profileImageUrl: updated.profileImageUrl,
    });
  } catch (error) {
    console.error("Unable to update account profile image.", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Profile image could not be updated.",
    });
  } finally {
    if (req.file?.path) {
      try {
        await unlink(req.file.path);
      } catch (error) {
        if (error.code !== "ENOENT") {
          console.error("Unable to remove temporary account profile image.", error);
        }
      }
    }
  }
};
