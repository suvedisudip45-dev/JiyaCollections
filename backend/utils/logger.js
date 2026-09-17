import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDirectory = path.resolve(__dirname, "..", "logs");
const logFilePath = path.join(logDirectory, "app.log");

fs.mkdirSync(logDirectory, { recursive: true });

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "authorization",
  "secret",
  "apiKey",
  "api_key",
  "phone",
  "phone2",
  "address",
  "customerAddress",
  "name",
  "instruction",
  "deliveryInstruction",
  "email",
  "customerEmail",
  "ssn",
  "cvv",
  "cardNumber",
  "bankAccount",
]);

const redactSensitiveValue = (value) => {
  if (typeof value === "string") {
    if (!value.trim()) return value;
    if (value.length <= 2) return "***";
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }
  if (typeof value === "number") return "[REDACTED]";
  if (typeof value === "boolean") return "[REDACTED]";
  return "[REDACTED]";
};

const sanitizeForLog = (value) => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));
  if (typeof value !== "object") return value;

  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const lowerKey = String(key).toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes("phone") || lowerKey.includes("address") || lowerKey.includes("token") || lowerKey.includes("secret") || lowerKey.includes("name") || lowerKey.includes("email")) {
      sanitized[key] = redactSensitiveValue(nestedValue);
      continue;
    }
    sanitized[key] = sanitizeForLog(nestedValue);
  }
  return sanitized;
};

const safeSerialize = (value) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, (_key, nestedValue) => {
      if (nestedValue instanceof Error) {
        return {
          name: nestedValue.name,
          message: nestedValue.message,
          stack: nestedValue.stack,
        };
      }
      return nestedValue;
    }, 2);
  } catch {
    return String(value);
  }
};

const writeLog = (level, message, meta = {}) => {
  const safeMeta = sanitizeForLog(meta);
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(Object.keys(safeMeta).length ? { meta: safeMeta } : {}),
  };

  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFileSync(logFilePath, line, "utf8");

  const metaText = Object.keys(meta).length ? ` ${safeSerialize(meta)}` : "";
  console.log(`[${level.toUpperCase()}] ${message}${metaText}`);
};

export const readRecentLogs = (limit = 50) => {
  if (!fs.existsSync(logFilePath)) return [];
  const text = fs.readFileSync(logFilePath, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
};

export const logger = {
  info: (message, meta = {}) => writeLog("info", message, meta),
  warn: (message, meta = {}) => writeLog("warn", message, meta),
  error: (message, meta = {}) => writeLog("error", message, meta),
  http: (message, meta = {}) => writeLog("http", message, meta),
  request: (req, res, durationMs) =>
    writeLog("http", "request completed", {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip || req.headers["x-forwarded-for"] || "unknown",
      userAgent: req.headers["user-agent"] || "unknown",
      manufacturerId: req.manufacturerId || null,
    }),
};

export const logFile = logFilePath;
