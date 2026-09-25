import axios from "axios";
import {
  clearAuthTokens,
  getAccessToken,
  storeAuthTokens,
} from "../auth/tokenStorage";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
let installed = false;
let refreshPromise = null;

const refreshAccessToken = () => {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${backendUrl}/api/auth/refresh`, {}, { withCredentials: true })
      .then((refreshResponse) => {
        const accessToken = storeAuthTokens(refreshResponse.data);
        if (!accessToken) throw new Error("Refresh response did not include an access token.");
        return accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

export const installAuthInterceptor = () => {
  if (installed) return;
  installed = true;

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
      if (error.response?.status === 403 && !isAuthRequest) {
        clearAuthTokens();
        window.location.assign("/");
        return Promise.reject(error);
      }
      if (error.response?.status !== 401 || isAuthRequest || originalRequest?._authRetry) {
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
        clearAuthTokens();
        window.location.assign("/");
        return Promise.reject(refreshError);
      }
    }
  );
};
