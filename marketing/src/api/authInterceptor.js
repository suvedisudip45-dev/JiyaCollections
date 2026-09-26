import axios from "axios";
import {
  clearAuthTokens,
  getAccessToken,
  getRefreshTokenExpiresAt,
  ACCESS_TOKEN_KEY,
  REFRESH_EXPIRY_KEY,
  storeAuthTokens,
} from "../auth/tokenStorage";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
const installedClients = new WeakSet();
let refreshPromise = null;
let expiryTimer = null;
let redirecting = false;
let loginPath = "/login";

const MAX_TIMEOUT = 2147483647;

const redirectToLogin = () => {
  if (redirecting) return;
  redirecting = true;
  clearAuthTokens();
  window.location.replace(loginPath);
};

const readHeader = (headers, name) =>
  headers?.get?.(name) || headers?.[name] || headers?.[name.toLowerCase()] || "";

const getRequestAccessToken = (headers) => {
  const tokenHeader = readHeader(headers, "token");
  const authorization = readHeader(headers, "Authorization");
  return tokenHeader || authorization.replace(/^Bearer\s+/i, "") || getAccessToken();
};

const refreshAccessToken = (staleAccessToken = getAccessToken()) => {
  if (!refreshPromise) {
    const rotate = async () => {
      const currentAccessToken = getAccessToken();
      if (currentAccessToken && currentAccessToken !== staleAccessToken) return currentAccessToken;

      const refreshResponse = await axios.post(
        `${backendUrl}/api/auth/refresh`,
        { portal: "MARKETING_PARTNER" },
        { withCredentials: true }
      );
      const accessToken = storeAuthTokens(refreshResponse.data);
      if (!accessToken || !refreshResponse.data?.refreshTokenExpiresAt) {
        throw new Error("Refresh response did not include a complete token pair.");
      }
      return accessToken;
    };

    const refreshOperation = typeof navigator !== "undefined" && navigator.locks?.request
      ? navigator.locks.request("clothes-store-auth-refresh-marketing", rotate)
      : rotate();

    refreshPromise = refreshOperation
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

const scheduleSessionExpiry = () => {
  window.clearTimeout(expiryTimer);
  if (!getAccessToken()) return;

  const expiresAt = getRefreshTokenExpiresAt();
  if (!expiresAt) {
    refreshAccessToken().catch(redirectToLogin);
    return;
  }

  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    redirectToLogin();
    return;
  }

  expiryTimer = window.setTimeout(scheduleSessionExpiry, Math.min(remaining, MAX_TIMEOUT));
};

export const installAuthInterceptor = (client = axios, redirectPath = "/login") => {
  if (installedClients.has(client)) return;
  installedClients.add(client);
  loginPath = redirectPath;

  client.interceptors.request.use((config) => {
    config.withCredentials = true;
    const accessToken = getAccessToken();
    if (accessToken) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${accessToken}`;
      config.headers.token = accessToken;
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      const isAuthRequest = /\/api\/auth\/(login|refresh)/.test(originalRequest?.url || "");
      const headers = originalRequest?.headers;
      const hasAccessToken = Boolean(
        headers?.get?.("token") ||
        headers?.get?.("Authorization") ||
        headers?.token ||
        headers?.Token ||
        headers?.Authorization ||
        headers?.authorization
      );
      if (error.response?.status !== 401 || isAuthRequest || !hasAccessToken || originalRequest?._authRetry) {
        return Promise.reject(error);
      }

      originalRequest._authRetry = true;
      try {
        const accessToken = await refreshAccessToken(getRequestAccessToken(headers));
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        originalRequest.headers.token = accessToken;
        return client(originalRequest);
      } catch (refreshError) {
        redirectToLogin();
        return Promise.reject(refreshError);
      }
    }
  );

  window.addEventListener("auth:tokens-updated", scheduleSessionExpiry);
  window.addEventListener("auth:tokens-cleared", () => window.clearTimeout(expiryTimer));
  window.addEventListener("storage", (event) => {
    if (event.key === ACCESS_TOKEN_KEY) {
      if (event.newValue) {
        window.dispatchEvent(new CustomEvent("auth:tokens-updated", { detail: { accessToken: event.newValue } }));
      } else if (event.oldValue) {
        redirectToLogin();
      }
    } else if (event.key === REFRESH_EXPIRY_KEY) {
      scheduleSessionExpiry();
    }
  });
  window.addEventListener("focus", scheduleSessionExpiry);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleSessionExpiry();
  });
  scheduleSessionExpiry();
};
