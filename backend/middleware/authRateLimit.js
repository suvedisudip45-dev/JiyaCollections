import crypto from "node:crypto";
import { normalizeIdentifier, resolveTargetPortal } from "../services/authService.js";
import { recordSystemAudit } from "../services/auditService.js";
import { logger } from "../utils/logger.js";

const parsePositiveInteger = (env, name, fallback, maximum) => {
  const value = Number(env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
};

export const loadAuthRateLimitConfig = (env = process.env) => ({
  windowMs: parsePositiveInteger(env, "AUTH_RATE_LIMIT_WINDOW_MS", 900_000, 86_400_000),
  loginUsernameBucketSize: parsePositiveInteger(env, "AUTH_LOGIN_USERNAME_BUCKET_SIZE", 5, 100_000),
  loginIpBucketSize: parsePositiveInteger(env, "AUTH_LOGIN_IP_BUCKET_SIZE", 30, 100_000),
  publicRegisterIpBucketSize: parsePositiveInteger(env, "AUTH_PUBLIC_REGISTER_IP_BUCKET_SIZE", 5, 100_000),
});

const hashKey = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

const getLoginIdentifier = (body = {}) => {
  const rawIdentifier = body.identifier || body.email || body.phone || body.username;
  if (!rawIdentifier) return "";
  return normalizeIdentifier(String(rawIdentifier)).value.slice(0, 255);
};

const normalizePortal = (portal) => String(portal || "UNKNOWN").trim().toUpperCase();

const getRequestedPortal = (body = {}) => {
  try {
    return normalizePortal(resolveTargetPortal(body.portal || body.targetPortal));
  } catch {
    return "UNKNOWN";
  }
};

const getClientIp = (req) => req.ip || req.socket?.remoteAddress || "unknown";

const hasAuthorizationCredential = (req) => Boolean(
  req.headers?.authorization ||
  req.headers?.token ||
  req.headers?.admintoken ||
  req.headers?.manufacturertoken,
);

export const createAuthRateLimiters = (options = {}) => {
  const {
    windowMs = 900_000,
    loginUsernameBucketSize = 5,
    loginIpBucketSize = 30,
    publicRegisterIpBucketSize = 5,
    now = Date.now,
    auditRecorder = recordSystemAudit,
  } = options;
  const buckets = {
    username: new Map(),
    loginIp: new Map(),
    registerIp: new Map(),
  };
  const auditedBlocks = new Map();
  let nextCleanupAt = 0;

  const cleanupExpired = (currentTime) => {
    if (currentTime < nextCleanupAt) return;
    for (const bucketMap of Object.values(buckets)) {
      for (const [key, bucket] of bucketMap) {
        if (bucket.resetAt <= currentTime) bucketMap.delete(key);
      }
    }
    for (const [key, expiresAt] of auditedBlocks) {
      if (expiresAt <= currentTime) auditedBlocks.delete(key);
    }
    nextCleanupAt = currentTime + Math.min(windowMs, 60_000);
  };

  const consume = (bucketMap, key, limit, currentTime) => {
    const bucketKey = hashKey(key);
    let bucket = bucketMap.get(bucketKey);
    if (!bucket || bucket.resetAt <= currentTime) {
      bucket = { count: 0, resetAt: currentTime + windowMs };
      bucketMap.set(bucketKey, bucket);
    }

    if (bucket.count >= limit) {
      return {
        limited: true,
        retryAfter: Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000)),
      };
    }
    bucket.count += 1;
    return { limited: false, retryAfter: 0 };
  };

  const resetLoginBuckets = ({ identifiers = [], portal, ipAddress = "" }) => {
    for (const identifier of identifiers) {
      if (!identifier) continue;
      const normalized = normalizeIdentifier(String(identifier)).value.slice(0, 255);
      if (normalized && portal) {
        buckets.username.delete(hashKey(`username:${normalizePortal(portal)}:${normalized}`));
      }
    }
    if (ipAddress && portal) {
      buckets.loginIp.delete(hashKey(`login-ip:${normalizePortal(portal)}:${ipAddress}`));
    }
  };

  const reject = (req, res, code, retryAfter, portal = "UNKNOWN") => {
    const ipAddress = getClientIp(req);
    const identifier = getLoginIdentifier(req.body);
    const dedupeKey = hashKey(`${code}:${portal}:${ipAddress}:${identifier}`);
    if (!auditedBlocks.has(dedupeKey)) {
      auditedBlocks.set(dedupeKey, now() + windowMs);
      if (auditedBlocks.size > 10_000) auditedBlocks.delete(auditedBlocks.keys().next().value);
      void Promise.resolve(auditRecorder({
        portalSource: portal,
        ipAddress,
        userAgent: req.headers?.["user-agent"] || null,
        correlationId: req.correlationId || null,
      }, {
        action: code,
        entityType: "SecurityEvent",
        status: "BLOCKED",
        failureReason: code,
        afterState: { portal, retryAfterSeconds: retryAfter },
      })).catch((error) => logger.error("Unable to enqueue rate-limit audit event.", {
        action: code,
        correlationId: req.correlationId || null,
        error: error.message || error,
      }));
    }
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      success: false,
      message: "Too many requests. Please try again later.",
      code,
      retryAfterSeconds: retryAfter,
    });
  };

  const login = (req, res, next, fixedPortal = null) => {
    const currentTime = now();
    cleanupExpired(currentTime);

    const identifier = getLoginIdentifier(req.body);
    const ip = getClientIp(req);
    const portal = normalizePortal(fixedPortal || getRequestedPortal(req.body));
    req.authRateLimitContext = { identifier, ipAddress: ip, portal };
    const results = [];
    if (identifier) {
      results.push(consume(
        buckets.username,
        `username:${portal}:${identifier}`,
        loginUsernameBucketSize,
        currentTime,
      ));
    }
    results.push(consume(buckets.loginIp, `login-ip:${portal}:${ip}`, loginIpBucketSize, currentTime));

    const blocked = results.filter(({ limited }) => limited);
    if (blocked.length) {
      return reject(req, res, "LOGIN_RATE_LIMITED", Math.max(...blocked.map(({ retryAfter }) => retryAfter)), portal);
    }
    return next();
  };

  const publicRegistration = (req, res, next) => {
    if (hasAuthorizationCredential(req)) return next("route");

    const currentTime = now();
    cleanupExpired(currentTime);
    const result = consume(
      buckets.registerIp,
      `register-ip:${getClientIp(req)}`,
      publicRegisterIpBucketSize,
      currentTime,
    );
    if (result.limited) return reject(req, res, "PUBLIC_REGISTRATION_RATE_LIMITED", result.retryAfter, "PUBLIC");
    return next();
  };

  const resetOnSuccessfulLogin = (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400 && body?.success && !body.requiresTwoFactor && (body.accessToken || body.token)) {
        const account = body.account || body.user || body.partner || body.manufacturer || {};
        const context = req.authRateLimitContext || {};
        resetLoginBuckets({
          identifiers: [
            context.identifier,
            account.email,
            account.phone,
          ],
          portal: account.role || context.portal,
          ipAddress: context.ipAddress || getClientIp(req),
        });
      }
      return originalJson(body);
    };
    return next();
  };

  return { login, publicRegistration, resetOnSuccessfulLogin, resetLoginBuckets };
};

let defaultLimiters;
const portalLoginLimiters = new Map();
const getDefaultLimiters = () => {
  if (!defaultLimiters) defaultLimiters = createAuthRateLimiters(loadAuthRateLimitConfig());
  return defaultLimiters;
};

export const loginRateLimit = (req, res, next) => getDefaultLimiters().login(req, res, next);
export const loginRateLimitForPortal = (portal) => {
  const normalizedPortal = normalizePortal(portal);
  if (!portalLoginLimiters.has(normalizedPortal)) {
    portalLoginLimiters.set(normalizedPortal, (req, res, next) =>
      getDefaultLimiters().login(req, res, next, normalizedPortal));
  }
  return portalLoginLimiters.get(normalizedPortal);
};
export const resetLoginRateLimitOnSuccess = (req, res, next) =>
  getDefaultLimiters().resetOnSuccessfulLogin(req, res, next);
export const publicRegistrationRateLimit = (req, res, next) =>
  getDefaultLimiters().publicRegistration(req, res, next);