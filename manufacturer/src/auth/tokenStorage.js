import axios from "axios";

export const ACCESS_TOKEN_KEY = "manufacturerToken";
export const REFRESH_EXPIRY_KEY = `${ACCESS_TOKEN_KEY}_refresh_expires_at`;
export const WORKSPACE_KEY = "manufacturerWorkspace";

export const getAccessToken = () => localStorage.getItem(ACCESS_TOKEN_KEY) || "";
export const getActiveWorkspace = () => {
  const role = String(localStorage.getItem(WORKSPACE_KEY) || "MANUFACTURER").toUpperCase();
  return role === "DISTRIBUTOR" ? role : "MANUFACTURER";
};
export const storeActiveWorkspace = (role) => {
  const normalized = String(role || "").toUpperCase();
  if (normalized !== "MANUFACTURER" && normalized !== "DISTRIBUTOR") {
    throw new Error("Unsupported partner workspace.");
  }
  localStorage.setItem(WORKSPACE_KEY, normalized);
  return normalized;
};
export const getRefreshTokenExpiresAt = () => Number(localStorage.getItem(REFRESH_EXPIRY_KEY)) || 0;

export const storeAuthTokens = (data = {}) => {
  const accessToken = data.accessToken || data.token || "";
  if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  const refreshTokenExpiresAt = Number(data.refreshTokenExpiresAt);
  if (refreshTokenExpiresAt > 0) {
    localStorage.setItem(REFRESH_EXPIRY_KEY, String(refreshTokenExpiresAt));
  }
  window.dispatchEvent(new CustomEvent("auth:tokens-updated", { detail: { accessToken } }));
  return accessToken;
};

export const clearAuthTokens = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_EXPIRY_KEY);
  window.dispatchEvent(new Event("auth:tokens-cleared"));
};

export const revokeAuthSession = async (backendUrl) => {
  const accessToken = getAccessToken();
  try {
    if (accessToken) {
      await axios.post(`${backendUrl}/api/auth/logout`, {}, {
        withCredentials: true,
        headers: { Authorization: `Bearer ${accessToken}`, token: accessToken },
      });
    }
  } finally {
    clearAuthTokens();
  }
};
