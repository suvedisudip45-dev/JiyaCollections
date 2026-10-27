import { promises as fs } from "node:fs";
import { v2 as cloudinary } from "cloudinary";

export const uploadEvidenceImage = async (file, folder) => {
  if (!file) {
    const error = new Error("A JPG or PNG evidence image is required.");
    error.statusCode = 400;
    error.code = "EVIDENCE_IMAGE_REQUIRED";
    throw error;
  }

  try {
    return await cloudinary.uploader.upload(file.path, {
      resource_type: "image",
      folder,
      allowed_formats: ["jpg", "jpeg", "png"],
      overwrite: false,
    });
  } finally {
    await fs.unlink(file.path).catch((error) => {
      console.error("Could not remove temporary evidence upload:", error);
    });
  }
};

export const deleteEvidenceImage = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch (error) {
    console.error("Could not remove unreferenced evidence image:", error);
  }
};
