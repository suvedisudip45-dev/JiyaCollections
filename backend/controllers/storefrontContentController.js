import { v2 as cloudinary } from "cloudinary";
import { unlink } from "node:fs/promises";
import { getStorefrontContent, updateStorefrontContent } from "../services/storefrontContentService.js";

export const getPublicStorefrontContent = async (_req, res) => {
  try {
    return res.json({ success: true, content: await getStorefrontContent() });
  } catch (error) {
    console.error("Error loading storefront content:", error);
    return res.status(500).json({ success: false, message: "Unable to load storefront content." });
  }
};

export const saveStorefrontContent = async (req, res) => {
  try {
    const content = await updateStorefrontContent(req.body || {});
    return res.json({ success: true, message: "Storefront content updated.", content });
  } catch (error) {
    console.error("Error updating storefront content:", error);
    return res.status(error.status || 500).json({
      success: false,
      code: error.code || "STOREFRONT_CONTENT_UPDATE_FAILED",
      message: error.status ? error.message : "Unable to update storefront content.",
    });
  }
};

export const uploadStorefrontImage = async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  try {
    if (files.length !== 1) {
      return res.status(400).json({ success: false, message: "Select one image to upload." });
    }
    const uploaded = await cloudinary.uploader.upload(files[0].path, { resource_type: "image" });
    return res.json({ success: true, imageUrl: uploaded.secure_url });
  } catch (error) {
    console.error("Error uploading storefront image:", error);
    return res.status(500).json({ success: false, message: "Unable to upload storefront image." });
  } finally {
    await Promise.all(files.map(async (file) => {
      try {
        await unlink(file.path);
      } catch (error) {
        if (error.code !== "ENOENT") console.error("Unable to remove temporary storefront image:", error);
      }
    }));
  }
};
