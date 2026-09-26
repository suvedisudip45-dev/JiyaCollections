export const REFRESH_COOKIE_NAME = "refresh_token";

const refreshCookieOptions = (expiresAt) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/api/auth",
  ...(expiresAt ? { maxAge: Math.max(0, Number(expiresAt) - Date.now()) } : {}),
});

export const setRefreshCookie = (res, refreshToken, expiresAt) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(expiresAt));
};

export const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
};

export const getRefreshCookie = (req) => {
  const cookieHeader = req.headers.cookie || "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REFRESH_COOKIE_NAME}=`));
  return cookie ? decodeURIComponent(cookie.slice(REFRESH_COOKIE_NAME.length + 1)) : "";
};