const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
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
  ];

  return [...new Set(origins.filter(Boolean))];
};

export const isOriginAllowed = (origin) => {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  return getAllowedOrigins().includes(normalizedOrigin);
};
