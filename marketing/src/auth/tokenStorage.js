import axios from "axios";

export const ACCESS_TOKEN_KEY = "mp_token";

export const getAccessToken = () => localStorage.getItem(ACCESS_TOKEN_KEY) || "";

export const storeAuthTokens = (data = {}) => {
  const accessToken = data.accessToken || data.token || "";
  if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  return accessToken;
};

export const clearAuthTokens = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
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
