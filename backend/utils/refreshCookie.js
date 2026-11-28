export const REFRESH_COOKIE_NAME = "refresh_token";

const PORTAL_COOKIE_SUFFIXES = {
  CUSTOMER: "customer",
  ADMIN: "admin",
  MANUFACTURER: "manufacturer",
  DISTRIBUTOR: "distributor",
  DRIVER: "driver",
  MARKETING: "marketing_partner",
  MARKETING_PARTNER: "marketing_partner",
};

export const normalizeRefreshPortal = (portal) => {
  const normalizedPortal = String(portal || "").trim().toUpperCase();
  if (normalizedPortal === "MARKETING") return "MARKETING_PARTNER";
  return PORTAL_COOKIE_SUFFIXES[normalizedPortal] ? normalizedPortal : "";
};

const getPortalCookieName = (portal) => {
  const normalizedPortal = normalizeRefreshPortal(portal);
  return normalizedPortal
    ? `${REFRESH_COOKIE_NAME}_${PORTAL_COOKIE_SUFFIXES[normalizedPortal]}`
    : "";
};

const isHttpsRequest = (req) => {
  if (!req) return false;
  if (req.secure) return true;
  const forwardedProto = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return forwardedProto === "https";
};

const refreshCookieOptions = (expiresAt, req = null) => {
  const useCrossSiteCookie = process.env.NODE_ENV === "production" || isHttpsRequest(req);
  return {
    httpOnly: true,
    secure: useCrossSiteCookie,
    sameSite: useCrossSiteCookie ? "none" : "lax",
    path: "/api/auth",
    ...(expiresAt ? { maxAge: Math.max(0, Number(expiresAt) - Date.now()) } : {}),
  };
};

const getCookieValue = (req, cookieName) => {
  const cookieHeader = req.headers.cookie || "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  return cookie ? decodeURIComponent(cookie.slice(cookieName.length + 1)) : "";
};

export const setRefreshCookie = (res, portal, refreshToken, expiresAt) => {
  const cookieName = getPortalCookieName(portal);
  if (!cookieName) throw new Error("A valid portal is required for a refresh cookie.");
  res.cookie(cookieName, refreshToken, refreshCookieOptions(expiresAt, res?.req));
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(undefined, res?.req));
};

export const clearRefreshCookie = (res, portal) => {
  const cookieName = getPortalCookieName(portal);
  const options = refreshCookieOptions(undefined, res?.req);
  if (cookieName) res.clearCookie(cookieName, options);
  res.clearCookie(REFRESH_COOKIE_NAME, options);
};

export const getRefreshCookie = (req, portal) => {
  const cookieName = getPortalCookieName(portal);
  if (!cookieName) return "";
  return getCookieValue(req, cookieName) || getCookieValue(req, REFRESH_COOKIE_NAME);
};