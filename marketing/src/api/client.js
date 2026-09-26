import axios from "axios";
import { installAuthInterceptor } from "./authInterceptor";

export const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

/**
 * Central axios instance for the marketing portal.
 * Automatically attaches `token` header from localStorage.
 * Handles 401 globally → redirects to /login.
 */
const api = axios.create({
  baseURL: backendUrl,
  timeout: 15000,
  withCredentials: true,
});

installAuthInterceptor(api);

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
