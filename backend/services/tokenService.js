import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getJwtConfig } from "../config/jwt.js";

const JWT_ALGORITHM = "HS256";

const normalizeRole = (role) => String(role || "CUSTOMER").toUpperCase();

const normalizePortalAccess = (portalAccess, role) => {
  if (Array.isArray(portalAccess) && portalAccess.length > 0) {
    return portalAccess.map((entry) => String(entry).trim()).filter(Boolean);
  }
  return [normalizeRole(role)];
};

const buildJwtIdentity = ({
  accountId,
  role,
  email,
  phone,
  profileId,
  portalAccess,
  tokenType,
  tokenFamilyId,
}) => {
  const normalizedRole = normalizeRole(role);
  const payload = {
    sub: accountId || profileId || "unknown",
    jti: crypto.randomUUID(),
    role: normalizedRole,
    token_type: tokenType,
    accountId: accountId || profileId || null,
    profileId: profileId || accountId || null,
    portalAccess: normalizePortalAccess(portalAccess, normalizedRole),
    email: email || "",
    phone: phone || "",
    iat: Math.floor(Date.now() / 1000),
  };

  if (normalizedRole === "ADMIN") {
    payload.adminId = profileId || accountId || null;
  } else if (normalizedRole === "MANUFACTURER") {
    payload.manufacturerId = profileId || accountId || null;
  } else if (normalizedRole === "MARKETING_PARTNER") {
    payload.partnerId = profileId || accountId || null;
  } else {
    payload.id = profileId || accountId || null;
    payload.userId = profileId || accountId || null;
  }

  if (tokenType === "refresh" && tokenFamilyId) {
    payload.token_family_id = tokenFamilyId;
  }

  return payload;
};

const signToken = ({
  accountId,
  role,
  email,
  phone,
  profileId,
  portalAccess,
  tokenType,
  tokenFamilyId,
  expiresIn,
  secret,
}) => {
  const config = getJwtConfig();
  const payload = buildJwtIdentity({
    accountId,
    role,
    email,
    phone,
    profileId,
    portalAccess,
    tokenType,
    tokenFamilyId,
  });

  const finalExpiresIn = expiresIn || (tokenType === "access" ? config.accessTokenExpiresIn : config.refreshTokenExpiresIn);

  return jwt.sign(payload, secret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: finalExpiresIn,
    issuer: config.issuer,
    audience: config.audience,
  });
};

export const generateAccessToken = ({
  accountId,
  role,
  email,
  phone,
  profileId,
  portalAccess,
  expiresIn,
}) => {
  const config = getJwtConfig();
  return signToken({
    accountId,
    role,
    email,
    phone,
    profileId,
    portalAccess,
    tokenType: "access",
    secret: config.accessSecret,
    expiresIn,
  });
};

export const generateRefreshToken = ({
  accountId,
  role,
  email,
  phone,
  profileId,
  portalAccess,
  tokenFamilyId,
  expiresIn,
}) => {
  const config = getJwtConfig();
  return signToken({
    accountId,
    role,
    email,
    phone,
    profileId,
    portalAccess,
    tokenType: "refresh",
    tokenFamilyId,
    secret: config.refreshSecret,
    expiresIn,
  });
};

export const verifyToken = ({ token, secret, expectedType, issuer, audience, fallbackSecrets = [] }) => {
  if (!token) {
    throw new Error("Token is required");
  }

  let decoded;
  let lastError = null;
  const candidateSecrets = [secret, ...fallbackSecrets].filter(Boolean);

  for (const candidateSecret of candidateSecrets) {
    try {
      decoded = jwt.verify(token, candidateSecret, {
        algorithms: [JWT_ALGORITHM],
        issuer,
        audience,
      });
      break;
    } catch (error) {
      if (error && error.name === "TokenExpiredError") {
        throw error;
      }
      lastError = error;
    }
  }

  if (!decoded) {
    throw lastError || new Error("Invalid token");
  }

  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid token payload");
  }

  if (expectedType && decoded.token_type !== expectedType) {
    throw new Error(`Invalid token type. Expected ${expectedType} but received ${decoded.token_type || "unknown"}.`);
  }

  return decoded;
};

export const verifyAccessToken = (token) => {
  const config = getJwtConfig();
  return verifyToken({
    token,
    secret: config.accessSecret,
    fallbackSecrets: [config.refreshSecret],
    expectedType: "access",
    issuer: config.issuer,
    audience: config.audience,
  });
};

export const verifyRefreshToken = (token) => {
  const config = getJwtConfig();
  return verifyToken({
    token,
    secret: config.refreshSecret,
    fallbackSecrets: [config.accessSecret],
    expectedType: "refresh",
    issuer: config.issuer,
    audience: config.audience,
  });
};

export const createTokenFamilyId = () => crypto.randomUUID();

export const getTokenClaims = (token) => {
  const claims = jwt.decode(token);
  if (!claims || typeof claims !== "object" || !claims.jti || !claims.exp) {
    throw new Error("Generated token did not contain required session claims.");
  }
  return claims;
};
