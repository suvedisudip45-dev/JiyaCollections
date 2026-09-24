import axios from "axios";

export const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

/**
 * Central axios instance for the marketing portal.
 * Automatically attaches `token` header from localStorage.
 * Handles 401 globally → redirects to /login.
 */
const api = axios.create({
  baseURL: backendUrl,
  timeout: 15000,
});

// ── Request interceptor: attach JWT ──────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("mp_token");
  if (token) {
    config.headers.token = token;
  }
  return config;
});

// ── Response interceptor: handle 401/403 ─────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("mp_token");
      localStorage.removeItem("mp_partner");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

/**
 * Extracts a user-friendly error message from an API error.
 * Never exposes stack traces or internal details.
 */
export const getErrorMessage = (error, fallback = "An unexpected error occurred.") => {
  if (error?.response?.data?.message) return error.response.data.message;
  if (error?.message && !error.message.includes("Network Error")) return error.message;
  if (error?.message?.includes("Network Error")) return "Network error. Please check your connection.";
  return fallback;
};

export default api;
