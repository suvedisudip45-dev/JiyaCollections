import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDirectory = path.resolve(__dirname, "..", "logs");
const logFilePath = path.join(logDirectory, "app.log");
const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_TAIL_BYTES = 1024 * 1024;
const MAX_LOG_ENTRIES = 500;

fs.mkdirSync(logDirectory, { recursive: true });
let logStream = fs.createWriteStream(logFilePath, { flags: "a", encoding: "utf8" });
let droppedFileEntries = 0;

const SENSITIVE_KEYS = new Set([
  "password", "token", "authorization", "secret", "apikey", "api_key",
  "phone", "phone2", "address", "customeraddress", "name", "instruction",
  "deliveryinstruction", "email", "customeremail", "ssn", "cvv", "cvc",
  "cardnumber", "creditcardnumber", "bankaccount",
]);

const redactSensitiveValue = () => "[REDACTED]";

export const sanitizeForLog = (value) => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));
  if (typeof value !== "object") return value;

  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const lowerKey = String(key).toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes("password") || lowerKey.includes("credential") || lowerKey.includes("phone") || lowerKey.includes("address") || lowerKey.includes("token") || lowerKey.includes("secret") || lowerKey.includes("name") || lowerKey.includes("email") || lowerKey.includes("cardnumber") || lowerKey.includes("creditcard") || lowerKey.includes("cvv") || lowerKey.includes("cvc") || lowerKey.includes("bankaccount") || lowerKey.includes("apikey")) {
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
        return { name: nestedValue.name, message: nestedValue.message, stack: nestedValue.stack };
      }
      return nestedValue;
    }, 2);
  } catch {
    return String(value);
  }
};

logStream.on("error", (error) => {
  console.error("[LOGGER] File logging unavailable:", error.message);
});

const writeLog = (level, message, meta = {}) => {
  const safeMeta = sanitizeForLog(meta);
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: String(message),
    ...(Object.keys(safeMeta).length ? { meta: safeMeta } : {}),
    ...(droppedFileEntries ? { droppedFileEntries } : {}),
  };
  const line = `${JSON.stringify(entry)}\n`;
  const lineBytes = Buffer.byteLength(line, "utf8");
  if (!logStream.destroyed && logStream.writableLength + lineBytes <= MAX_BUFFERED_BYTES) {
    logStream.write(line, "utf8");
  } else {
    droppedFileEntries += 1;
  }
  console.log(`[${level.toUpperCase()}] ${entry.message}${Object.keys(safeMeta).length ? ` ${safeSerialize(safeMeta)}` : ""}`);
};

export const readRecentLogs = async (limit = 50) => {
  const safeLimit = Math.max(1, Math.min(MAX_LOG_ENTRIES, Number.parseInt(limit, 10) || 50));
  let fileHandle;
  try {
    fileHandle = await fs.promises.open(logFilePath, "r");
    const { size } = await fileHandle.stat();
    const bytesToRead = Math.min(size, MAX_TAIL_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    await fileHandle.read(buffer, 0, bytesToRead, size - bytesToRead);
    const lines = buffer.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-safeLimit);
    return lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  } finally {
    await fileHandle?.close();
  }
};

export const flushLogs = async () => {
  if (logStream.destroyed || logStream.closed) return;
  logStream.end();
  await once(logStream, "finish");
};

export const logger = {
  info: (message, meta = {}) => writeLog("info", message, meta),
  warn: (message, meta = {}) => writeLog("warn", message, meta),
  error: (message, meta = {}) => writeLog("error", message, meta),
  http: (message, meta = {}) => writeLog("http", message, meta),
  request: (req, res, durationMs) =>
    writeLog("http", "request completed", {
      method: req.method,
      url: req.path || req.url?.split("?")[0] || req.originalUrl?.split("?")[0] || "",
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip || req.headers["x-forwarded-for"] || "unknown",
      userAgent: req.headers["user-agent"] || "unknown",
      accountId: req.auth?.accountId || null,
      portal: req.auth?.role || null,
      manufacturerId: req.manufacturerId || null,
    }),
};

export const logFile = logFilePath;
