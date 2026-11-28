import axios from "axios";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

const queryString = (filters = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  }
  return params.toString();
};

const get = (token, path, filters) => axios.get(
  `${backendUrl}/api/admin/discount-analytics${path}${filters ? `?${queryString(filters)}` : ""}`,
  { headers: { token } },
);

export const discountAnalyticsApi = {
  report: (token, filters) => get(token, "", filters),
  filters: (token) => get(token, "/filters"),
};
