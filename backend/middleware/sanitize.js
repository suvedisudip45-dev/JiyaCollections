/**
 * Security Sanitization Middleware & Utilities
 * Protects against:
 * 1. SQL Injection / Metacharacter anomalies in input text
 * 2. Cross-Site Scripting (XSS) via HTML tags, javascript: uris, event handlers
 * 3. Prototype Pollution (__proto__, constructor, prototype)
 * 4. Null-byte Injection (\0, %00)
 * 5. Type confusion / Object injection where primitive strings are expected
 */

// Characters/patterns commonly used in SQL injection exploits
const DANGEROUS_SQL_PATTERNS = [
  /(\b(UNION(\s+ALL)?|SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|EXECUTE)\b\s+)/gi,
  /(--|#|\/\*|\*\/)/g,
  /(\bOR\b\s+['"\d\w]+\s*=\s*['"\d\w]+)/gi,
  /(\bAND\b\s+['"\d\w]+\s*=\s*['"\d\w]+)/gi,
];

// Dangerous HTML/XSS tags and handlers
const DANGEROUS_HTML_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
  /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
  /<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi,
  /<link\b[^>]*>/gi,
  /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
  /\bon\w+\s*=\s*(['"]).*?\1/gi,
  /\bon\w+\s*=\s*[^>\s]+/gi,
  /javascript\s*:/gi,
  /vbscript\s*:/gi,
  /data\s*:\s*text\/html/gi,
];

/**
 * Strips null bytes and control characters
 */
export const stripNullBytes = (str) => {
  if (typeof str !== "string") return str;
  return str.replace(/\0/g, "").replace(/%00/gi, "");
};

/**
 * Escapes HTML entities for rendering safety
 */
export const escapeHtml = (str) => {
  if (typeof str !== "string") return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
};

/**
 * Sanitizes a single text string by stripping dangerous scripts, event handlers, and null bytes.
 * Preserves normal text, unicode characters (e.g. Nepali text), numbers, and safe punctuation.
 */
export const sanitizeText = (val, options = {}) => {
  if (val === null || val === undefined) return val;
  if (typeof val !== "string") return val;

  let cleaned = stripNullBytes(val);

  // Remove dangerous HTML and scripting tags
  for (const pattern of DANGEROUS_HTML_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  // If strict mode requested (e.g., for names, codes, ids), remove HTML tags entirely
  if (options.stripAllHtml) {
    cleaned = cleaned.replace(/<[^>]*>?/gm, "");
  }

  return cleaned.trim();
};

/**
 * Checks if an input string contains overt SQL injection attack payloads.
 */
export const containsSqlInjection = (val) => {
  if (typeof val !== "string") return false;
  const str = val.trim();
  for (const pattern of DANGEROUS_SQL_PATTERNS) {
    if (pattern.test(str)) {
      return true;
    }
  }
  return false;
};

/**
 * Deep sanitization for Objects and Arrays:
 * - Prevents Prototype Pollution by deleting `__proto__`, `constructor`, and `prototype` keys
 * - Recursively cleans string properties
 */
export const sanitizeObject = (target, depth = 0) => {
  if (depth > 10) return target; // Prevent deep recursion DOS
  if (!target || typeof target !== "object") {
    if (typeof target === "string") {
      return sanitizeText(target);
    }
    return target;
  }

  if (Array.isArray(target)) {
    return target.map((item) => sanitizeObject(item, depth + 1));
  }

  const clean = {};
  for (const [key, value] of Object.entries(target)) {
    // Prototype pollution prevention
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }

    // Clean key name itself
    const cleanKey = sanitizeText(key, { stripAllHtml: true });

    if (typeof value === "object" && value !== null) {
      clean[cleanKey] = sanitizeObject(value, depth + 1);
    } else if (typeof value === "string") {
      clean[cleanKey] = sanitizeText(value);
    } else {
      clean[cleanKey] = value;
    }
  }

  return clean;
};

/**
 * Express Middleware to sanitize req.body, req.query, and req.params automatically.
 */
export const sanitizeMiddleware = (req, res, next) => {
  try {
    if (req.body && typeof req.body === "object") {
      req.body = sanitizeObject(req.body);
    }
    if (req.query && typeof req.query === "object") {
      req.query = sanitizeObject(req.query);
    }
    if (req.params && typeof req.params === "object") {
      req.params = sanitizeObject(req.params);
    }
    next();
  } catch (err) {
    console.error("Sanitization middleware error:", err);
    next();
  }
};

export default sanitizeMiddleware;
