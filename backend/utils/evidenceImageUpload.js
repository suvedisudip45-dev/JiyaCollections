import { promises as fs } from "node:fs";
import { v2 as cloudinary } from "cloudinary";

const EVIDENCE_UPLOAD_TIMEOUT_MS = 60_000;

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
      timeout: EVIDENCE_UPLOAD_TIMEOUT_MS,
    });
  } catch (error) {
    const providerError = error?.error || error;
    const message = String(providerError?.message || "");
    if (
      providerError?.http_code === 499 ||
      providerError?.name === "TimeoutError" ||
      /timed?\s*out|timeout/i.test(message)
    ) {
      const timeoutError = new Error(
        "The server could not upload the evidence image to Cloudinary before the connection timed out. The return was not recorded; ask an administrator to check backend HTTPS connectivity to api.cloudinary.com.",
      );
      timeoutError.statusCode = 504;
      timeoutError.code = "EVIDENCE_UPLOAD_TIMEOUT";
      throw timeoutError;
    }

    const uploadError = new Error("The evidence image could not be uploaded. The return was not recorded.");
    uploadError.statusCode = 502;
    uploadError.code = "EVIDENCE_UPLOAD_FAILED";
    throw uploadError;
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

export const uploadPrivateEvidenceImage = async (file, folder) => {
  if (!file) throw Object.assign(new Error("A valid evidence image is required."), {
    statusCode: 400,
    code: "EVIDENCE_IMAGE_REQUIRED",
  });
  try {
    return await cloudinary.uploader.upload(file.path, {
      resource_type: "image",
      type: "authenticated",
      access_mode: "authenticated",
      folder,
      allowed_formats: ["jpg", "jpeg", "png"],
      overwrite: false,
      timeout: EVIDENCE_UPLOAD_TIMEOUT_MS,
    });
  } finally {
    await fs.unlink(file.path).catch(() => {});
  }
};

export const uploadPrivateEvidenceDataUrl = async (dataUrl, folder) => {
  if (typeof dataUrl !== "string" || !/^data:image\/(?:png|jpeg);base64,/i.test(dataUrl)) {
    throw Object.assign(new Error("Signature evidence must be a base64 JPEG or PNG data URL."), {
      statusCode: 400,
      code: "INVALID_SIGNATURE_EVIDENCE",
    });
  }
  const base64Length = dataUrl.length - dataUrl.indexOf(",") - 1;
  if (base64Length > 8 * 1024 * 1024) {
    throw Object.assign(new Error("Signature evidence is too large."), {
      statusCode: 413,
      code: "SIGNATURE_EVIDENCE_TOO_LARGE",
    });
  }
  return cloudinary.uploader.upload(dataUrl, {
    resource_type: "image",
    type: "authenticated",
    access_mode: "authenticated",
    folder,
    allowed_formats: ["jpg", "jpeg", "png"],
    overwrite: false,
    timeout: EVIDENCE_UPLOAD_TIMEOUT_MS,
  });
};

export const deletePrivateEvidenceImage = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      type: "authenticated",
      invalidate: true,
    });
  } catch (error) {
    console.error("Could not remove private evidence image:", error);
  }
};

export const getPrivateEvidenceDownloadUrl = (publicId, kind = "photo") => {
  if (!publicId) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  return cloudinary.utils.private_download_url(publicId, kind === "signature" ? "png" : "jpg", {
    type: "authenticated",
    attachment: false,
    expires_at: expiresAt,
  });
};
