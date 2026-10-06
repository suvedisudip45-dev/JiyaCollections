/**
 * Secure File Upload Middleware
 * ─────────────────────────────
 * Validates uploaded files at the stream level using both MIME-type
 * and magic-byte (file signature) filtering. Only allows genuine
 * image/jpeg, image/png, and image/webp files.
 *
 * Security controls:
 *  1. Multer MIME-type whitelist (first gate)
 *  2. Binary magic-byte verification (second gate — prevents renamed executables)
 *  3. Per-file and total request size limits
 *  4. Filename sanitization (strips path traversal, null bytes, special chars)
 */

import multer from "multer";
import path from "node:path";
import { readFile, unlink } from "node:fs/promises";

// ─── Allowed MIME types ───────────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// ─── Magic byte signatures ───────────────────────────────────────────
// Each entry: { mime, offsets: [{ position, bytes }] }
const MAGIC_SIGNATURES = [
  {
    mime: "image/jpeg",
    // JPEG always starts with FF D8 FF
    check: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    mime: "image/png",
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    check: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  {
    mime: "image/webp",
    // WebP: RIFF....WEBP  (bytes 0–3 = RIFF, bytes 8–11 = WEBP)
    check: (buf) =>
      buf.length >= 12 &&
      buf[0] === 0x52 && // R
      buf[1] === 0x49 && // I
      buf[2] === 0x46 && // F
      buf[3] === 0x46 && // F
      buf[8] === 0x57 && // W
      buf[9] === 0x45 && // E
      buf[10] === 0x42 && // B
      buf[11] === 0x50, // P
  },
];

// ─── Configuration ───────────────────────────────────────────────────
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
const MAX_TOTAL_FILES = 20; // Max files in a single request

// ─── Filename sanitization ──────────────────────────────────────────
const sanitizeFilename = (original) => {
  if (!original || typeof original !== "string") return `upload_${Date.now()}`;
  // Strip null bytes, path traversal, and control characters
  let clean = original
    .replace(/\0/g, "")
    .replace(/%00/gi, "")
    .replace(/\.\./g, "")
    .replace(/[/\\]/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "");
  // Keep only safe characters
  const ext = path.extname(clean).toLowerCase();
  const base = path.basename(clean, ext).replace(/[^a-zA-Z0-9_\-. ]/g, "_").substring(0, 200);
  return `${base}${ext}` || `upload_${Date.now()}`;
};

// ─── Multer storage with sanitized names ────────────────────────────
const storage = multer.diskStorage({
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = sanitizeFilename(file.originalname);
    cb(null, `${timestamp}_${safeName}`);
  },
});

// ─── Multer file filter (first gate: MIME-type) ─────────────────────
const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    const error = new Error(
      `File type '${file.mimetype}' is not allowed. Only JPEG, PNG, and WebP images are accepted.`
    );
    error.code = "INVALID_FILE_TYPE";
    return cb(error, false);
  }
  cb(null, true);
};

// ─── Multer instance ────────────────────────────────────────────────
const multerUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_TOTAL_FILES,
  },
});

// ─── Magic byte verification (second gate) ──────────────────────────
/**
 * Verifies the binary content of each uploaded file matches its claimed
 * MIME type by inspecting the first 12 bytes (magic bytes / file signature).
 * Rejects and deletes any file that fails verification.
 */
const verifyMagicBytes = async (req, res, next) => {
  if (!req.files || req.files.length === 0) return next();

  const files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
  const invalidFiles = [];

  for (const file of files) {
    try {
      const buffer = await readFile(file.path);

      // Check for minimum file size (corrupt / empty files)
      if (buffer.length < 12) {
        invalidFiles.push({ file, reason: "File is too small to be a valid image" });
        continue;
      }

      // Verify magic bytes match the claimed MIME type
      const matchingSignature = MAGIC_SIGNATURES.find((sig) => sig.check(buffer));

      if (!matchingSignature) {
        invalidFiles.push({
          file,
          reason: "File content does not match any allowed image format (magic byte mismatch)",
        });
        continue;
      }

      // Verify the magic bytes match the declared MIME type
      if (matchingSignature.mime !== file.mimetype) {
        invalidFiles.push({
          file,
          reason: `File content is ${matchingSignature.mime} but was uploaded as ${file.mimetype}`,
        });
        continue;
      }

      // Additional safety: scan for embedded script payloads in the first 8KB
      // Polyglot images can embed JS/HTML at the end, but the header check
      // plus this scan catches the most common attack vectors
      const scanRange = buffer.subarray(0, Math.min(buffer.length, 8192));
      const scanStr = scanRange.toString("latin1").toLowerCase();
      if (
        scanStr.includes("<script") ||
        scanStr.includes("javascript:") ||
        scanStr.includes("<?php") ||
        scanStr.includes("<% ") ||
        scanStr.includes("#!/")
      ) {
        invalidFiles.push({
          file,
          reason: "File contains embedded script content and has been rejected for security",
        });
        continue;
      }
    } catch (err) {
      invalidFiles.push({ file, reason: `Could not read file for verification: ${err.message}` });
    }
  }

  // Clean up rejected files from disk
  if (invalidFiles.length > 0) {
    for (const { file } of invalidFiles) {
      try {
        await unlink(file.path);
      } catch {
        // Ignore cleanup failures
      }
    }

    const reasons = invalidFiles.map(
      ({ file, reason }) => `${file.originalname}: ${reason}`
    );

    return res.status(400).json({
      success: false,
      message: "One or more uploaded files failed security validation",
      details: reasons,
    });
  }

  next();
};

// ─── Composite middleware for product image uploads ──────────────────
/**
 * Use this as a drop-in replacement for `upload.any()` in product routes.
 * Applies both MIME-type filtering and binary magic-byte verification.
 *
 * Usage:
 *   import { secureProductUpload } from "../middleware/secureUpload.js";
 *   router.post("/add", authenticate, authorize("product:create"), ...secureProductUpload, addProduct);
 */
const secureProductUpload = [
  (req, res, next) => {
    multerUpload.any()(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: `File exceeds the maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
          });
        }
        if (err.code === "LIMIT_FILE_COUNT") {
          return res.status(400).json({
            success: false,
            message: `Too many files. Maximum ${MAX_TOTAL_FILES} files allowed per request`,
          });
        }
        if (err.code === "INVALID_FILE_TYPE") {
          return res.status(400).json({
            success: false,
            message: err.message,
          });
        }
        return res.status(400).json({
          success: false,
          message: `Upload error: ${err.message}`,
        });
      }
      next();
    });
  },
  verifyMagicBytes,
];

export { secureProductUpload, verifyMagicBytes, sanitizeFilename, ALLOWED_MIME_TYPES };
export default secureProductUpload;
