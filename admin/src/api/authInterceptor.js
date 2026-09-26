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
let installed = false;
let refreshPromise = null;
let expiryTimer = null;
let redirecting = false;
let loginPath = "/";

const MAX_TIMEOUT = 2147483647;

const redirectToLogin = () => {
  if (redirecting) return;
  redirecting = true;
  clearAuthTokens();
  window.location.replace(loginPath);
};

const refreshAccessToken = () => {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${backendUrl}/api/auth/refresh`, {}, { withCredentials: true })
      .then((refreshResponse) => {
        const accessToken = storeAuthTokens(refreshResponse.data);
        if (!accessToken || !refreshResponse.data?.refreshTokenExpiresAt) {
          throw new Error("Refresh response did not include a complete token pair.");
        }
        return accessToken;
      })
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

export const installAuthInterceptor = (redirectPath = "/") => {
  if (installed) return;
  installed = true;
  loginPath = redirectPath;

  axios.interceptors.request.use((config) => {
    config.withCredentials = true;
    const accessToken = getAccessToken();
    if (accessToken) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${accessToken}`;
      config.headers.token = accessToken;
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
      if (error.response?.status !== 401 || isAuthRequest || !hasAccessToken || originalRequest?._authRetry) {
        return Promise.reject(error);
      }

      originalRequest._authRetry = true;
      try {
        const accessToken = await refreshAccessToken();
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        originalRequest.headers.token = accessToken;
        return axios(originalRequest);
      } catch (refreshError) {
        redirectToLogin();
        return Promise.reject(refreshError);
      }
    }
  );

  window.addEventListener("auth:tokens-updated", scheduleSessionExpiry);
  window.addEventListener("auth:tokens-cleared", () => window.clearTimeout(expiryTimer));
  window.addEventListener("storage", (event) => {
    if (event.key === ACCESS_TOKEN_KEY && event.oldValue && !event.newValue) {
      redirectToLogin();
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
