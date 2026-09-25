const DEFAULT_JWT_ISSUER = "clothes-store-api";
const DEFAULT_JWT_AUDIENCE = "clothes-store-clients";
const DEFAULT_ACCESS_TOKEN_EXPIRES_IN = "5m";
const DEFAULT_REFRESH_TOKEN_EXPIRES_IN = "15m";

const normalizeString = (value, fallback = "") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

const ensureNonEmptySecret = (value, envName) => {
  const secret = normalizeString(value);
  if (!secret) {
    throw new Error(`Missing required environment variable: ${envName}. Set it in backend/.env before starting the server.`);
  }
  return secret;
};

const normalizeJwtDuration = (value, fallback) => {
  const normalized = normalizeString(value, fallback);
  if (!/^[0-9]+[smhd]$/i.test(normalized)) {
    throw new Error(`Invalid JWT duration value: ${normalized}. Use values such as 5m, 15m, 1h.`);
  }
  return normalized;
};

export const validateJwtConfig = () => {
  const accessSecret = ensureNonEmptySecret(
    process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
    "JWT_ACCESS_SECRET"
  );
  const refreshSecret = ensureNonEmptySecret(process.env.JWT_REFRESH_SECRET, "JWT_REFRESH_SECRET");

  if (accessSecret === refreshSecret) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.");
  }

  const accessTokenExpiresIn = normalizeJwtDuration(
    process.env.JWT_ACCESS_TOKEN_EXPIRES_IN,
    DEFAULT_ACCESS_TOKEN_EXPIRES_IN
  );
  const refreshTokenExpiresIn = normalizeJwtDuration(
    process.env.JWT_REFRESH_TOKEN_EXPIRES_IN,
    DEFAULT_REFRESH_TOKEN_EXPIRES_IN
  );

  const issuer = normalizeString(process.env.JWT_ISSUER, DEFAULT_JWT_ISSUER);
  const audience = normalizeString(process.env.JWT_AUDIENCE, DEFAULT_JWT_AUDIENCE);

  process.env.JWT_ACCESS_SECRET = accessSecret;
  process.env.JWT_REFRESH_SECRET = refreshSecret;
  process.env.JWT_SECRET = accessSecret;
  process.env.JWT_ACCESS_TOKEN_EXPIRES_IN = accessTokenExpiresIn;
  process.env.JWT_REFRESH_TOKEN_EXPIRES_IN = refreshTokenExpiresIn;
  process.env.JWT_ISSUER = issuer;
  process.env.JWT_AUDIENCE = audience;

  return {
    accessSecret,
    refreshSecret,
    accessTokenExpiresIn,
    refreshTokenExpiresIn,
    issuer,
    audience,
  };
};

export const getJwtConfig = () => validateJwtConfig();
