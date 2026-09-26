import axios from "axios";
import {
  ACCESS_TOKEN_KEY,
  clearAuthTokens,
  getAccessToken,
  getRefreshTokenExpiresAt,
  REFRESH_EXPIRY_KEY,
  storeAuthTokens,
} from "../auth/tokenStorage";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
let installed = false;
let refreshPromise = null;
let expiryTimer = null;
let redirecting = false;

const MAX_TIMEOUT = 2147483647;

const redirectToHome = () => {
  if (redirecting) return;
  redirecting = true;
  clearAuthTokens();
  window.location.replace("/");
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
        { portal: "CUSTOMER" },
        { withCredentials: true }
      );
      const accessToken = storeAuthTokens(refreshResponse.data);
      if (!accessToken || !refreshResponse.data?.refreshTokenExpiresAt) {
        throw new Error("Refresh response did not include a complete token pair.");
      }
      return accessToken;
    };

    const refreshOperation = typeof navigator !== "undefined" && navigator.locks?.request
      ? navigator.locks.request("clothes-store-auth-refresh-customer", rotate)
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
    refreshAccessToken().catch(redirectToHome);
    return;
  }

  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    redirectToHome();
    return;
  }

  expiryTimer = window.setTimeout(scheduleSessionExpiry, Math.min(remaining, MAX_TIMEOUT));
};

export const installAuthInterceptor = () => {
  if (installed) return;
  installed = true;

  axios.interceptors.request.use((config) => {
    const requestUrl = config.url || "";
    if (/\/api\/auth\//.test(requestUrl) || /\/api\/user\/(login|register)/.test(requestUrl)) {
      config.withCredentials = true;
    }
    return config;
  });

  axios.interceptors.response.use(
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
      if (error.response?.status !== 401 || isAuthRequest || !hasAccessToken) {
        return Promise.reject(error);
      }
      if (originalRequest?._authRetry) {
        redirectToHome();
        return Promise.reject(error);
      }

      originalRequest._authRetry = true;
      try {
        const accessToken = await refreshAccessToken(getRequestAccessToken(headers));
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        originalRequest.headers.token = accessToken;
        return axios(originalRequest);
      } catch (refreshError) {
        redirectToHome();
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
        redirectToHome();
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
