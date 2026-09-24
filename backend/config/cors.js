const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
];

const normalizeOrigin = (value) => {
  if (!value) return "";
  return String(value).trim().replace(/\/+$/, "");
};

const parseOrigins = (value) =>
  String(value || "")
    .split(",")
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);

export const getAllowedOrigins = () => {
  const origins = [
    ...DEFAULT_ALLOWED_ORIGINS,
    ...parseOrigins(process.env.CORS_ALLOWED_ORIGINS),
    ...parseOrigins(process.env.ACCEPTED_URL),
    ...parseOrigins(process.env.FRONTEND_URL),
    ...parseOrigins(process.env.ADMIN_URL),
    ...parseOrigins(process.env.MANUFACTURER_URL),
    ...parseOrigins(process.env.MARKETING_URL),
  ];


  return [...new Set(origins.filter(Boolean))];
};

const LOCALHOST_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/i;

export const isOriginAllowed = (origin) => {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  if (LOCALHOST_ORIGIN_REGEX.test(normalizedOrigin)) {
    return true;
  }
  return getAllowedOrigins().includes(normalizedOrigin);
};
