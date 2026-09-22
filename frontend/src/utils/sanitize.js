/**
 * Client-side Input Sanitization & Safety Utilities (Frontend Customer Portal)
 * Provides defense-in-depth sanitization for user form inputs:
 * - Strips script tags, HTML event handlers, and javascript protocols
 * - Strips null bytes (\0, %00)
 * - Validates safe text inputs before network dispatch
 */

const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
  /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
  /<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi,
  /\bon\w+\s*=\s*[^>\s]+/gi,
  /javascript\s*:/gi,
  /data\s*:\s*text\/html/gi,
];

/**
 * Strips dangerous HTML, scripts, event handlers, and null bytes from text
 */
export const sanitizeInput = (val, options = {}) => {
  if (val === null || val === undefined) return "";
  if (typeof val !== "string") return String(val);

  let cleaned = val.replace(/\0/g, "").replace(/%00/gi, "");

  for (const pattern of DANGEROUS_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  if (options.stripAllHtml) {
    cleaned = cleaned.replace(/<[^>]*>?/gm, "");
  }

  return cleaned.trim();
};

/**
 * Recursively sanitizes form payload objects
 */
export const sanitizeFormData = (data) => {
  if (!data || typeof data !== "object") {
    return typeof data === "string" ? sanitizeInput(data) : data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeFormData(item));
  }

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    clean[key] = sanitizeFormData(value);
  }
  return clean;
};

/**
 * Checks if input text is free from overt injection payloads
 */
export const isSafeInput = (val) => {
  if (typeof val !== "string") return true;
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(val)) return false;
  }
  return true;
};

export default sanitizeInput;
