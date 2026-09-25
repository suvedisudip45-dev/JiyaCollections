import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { authApi } from "../api/auth";
import { getErrorMessage } from "../api/client";
import { clearAuthTokens, getAccessToken, revokeAuthSession, storeAuthTokens } from "./tokenStorage";

const AuthContext = createContext(null);

const TOKEN_KEY   = "mp_token";
const PARTNER_KEY = "mp_partner";

export const AuthProvider = ({ children }) => {
  const [partner,         setPartner]         = useState(() => {
    try { return JSON.parse(localStorage.getItem(PARTNER_KEY)) || null; } catch { return null; }
  });
  const [token,           setToken]           = useState(() => getAccessToken() || null);
  const [loading,         setLoading]         = useState(true); // initial session restore
  const [authError,       setAuthError]       = useState(null);

  const isAuthenticated = Boolean(token && partner);

  // ── Persist token ──────────────────────────────────────
  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      clearAuthTokens();
      localStorage.removeItem(PARTNER_KEY);
    }
  }, [token]);

  // ── Restore session on mount ───────────────────────────
  const refreshUser = useCallback(async () => {
    const storedToken = getAccessToken();
    if (!storedToken) { setLoading(false); return; }
    try {
      const res = await authApi.getProfile();
      if (res.data?.success && res.data?.partner) {
        setPartner(res.data.partner);
        localStorage.setItem(PARTNER_KEY, JSON.stringify(res.data.partner));
        setToken(storedToken);
      } else {
        // Token invalid
        setToken(null);
        setPartner(null);
      }
    } catch {
      setToken(null);
      setPartner(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshUser(); }, [refreshUser]);

  // ── Login ──────────────────────────────────────────────
  const login = async (email, password) => {
    setAuthError(null);
    try {
      const res = await authApi.login(email, password);
      if (res.data?.success) {
        const newToken = storeAuthTokens(res.data);
        const profileResponse = await authApi.getProfile();
        const newPartner = profileResponse.data?.partner || res.data.account;
        localStorage.setItem(TOKEN_KEY, newToken);
        localStorage.setItem(PARTNER_KEY, JSON.stringify(newPartner));
        setToken(newToken);
        setPartner(newPartner);
        return { success: true };
      } else {
        const msg = res.data?.message || "Login failed.";
        setAuthError(msg);
        return { success: false, message: msg };
      }
    } catch (error) {
      const msg = getErrorMessage(error, "Login failed. Please try again.");
      setAuthError(msg);
      return { success: false, message: msg };
    }
  };

  // ── Logout ─────────────────────────────────────────────
  const logout = async () => {
    await revokeAuthSession(import.meta.env.VITE_BACKEND_URL || "http://localhost:4000");
    setToken(null);
    setPartner(null);
    clearAuthTokens();
    localStorage.removeItem(PARTNER_KEY);
  };

  const value = {
    partner,
    token,
    loading,
    isAuthenticated,
    authError,
    login,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
