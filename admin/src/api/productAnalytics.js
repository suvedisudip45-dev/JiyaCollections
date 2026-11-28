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
  `${backendUrl}/api/admin/product-analytics/${path}?${queryString(filters)}`,
  { headers: { token } },
);

export const productAnalyticsApi = {
  summary: (token, filters) => get(token, "summary", filters),
  charts: (token, filters) => get(token, "charts", filters),
  products: (token, filters) => get(token, "products", filters),
  locations: (token, filters) => get(token, "locations", filters),
  timeline: (token, filters) => get(token, "timeline", filters),
};
