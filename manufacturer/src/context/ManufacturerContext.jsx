import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  clearAuthTokens,
  getAccessToken,
  getActiveWorkspace,
  revokeAuthSession,
  storeAuthTokens,
  storeActiveWorkspace,
} from "../auth/tokenStorage";

const ManufacturerContext = createContext();

export const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
export const currency = "Rs ";

export const ManufacturerProvider = ({ children }) => {
  const [token, setToken] = useState(() => getAccessToken());
  const [manufacturer, setManufacturer] = useState(null);
  const [activeWorkspace, setActiveWorkspaceState] = useState(() => getActiveWorkspace());
  const [availableWorkspaces, setAvailableWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    pending: 0,
    active: 0,
    ready: 0,
    completed: 0,
    total: 0,
  });

  useEffect(() => {
    const updateToken = (event) => {
      if (event.detail?.accessToken) setToken(event.detail.accessToken);
    };
    const clearToken = () => setToken("");
    window.addEventListener("auth:tokens-updated", updateToken);
    window.addEventListener("auth:tokens-cleared", clearToken);
    return () => {
      window.removeEventListener("auth:tokens-updated", updateToken);
      window.removeEventListener("auth:tokens-cleared", clearToken);
    };
  }, []);

  const logout = async () => {
    await revokeAuthSession(backendUrl);
    setToken("");
    setManufacturer(null);
    setAvailableWorkspaces([]);
    toast.info("Logged out successfully");
  };

  const setActiveWorkspace = useCallback((role) => {
    const normalized = storeActiveWorkspace(role);
    setActiveWorkspaceState(normalized);
  }, []);

  const fetchProfile = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const sessionResponse = await axios.get(`${backendUrl}/api/auth/me`, {
        headers: { token },
      });
      const role = String(sessionResponse.data?.account?.role || "").toUpperCase();
      if (!sessionResponse.data?.success || !["MANUFACTURER", "DISTRIBUTOR"].includes(role)) {
        throw new Error("An active manufacturer or distributor workspace is required.");
      }
      setActiveWorkspace(role);
      setAvailableWorkspaces(sessionResponse.data.account.roles || []);
      const profilePath = role === "DISTRIBUTOR" ? "/api/distributor/profile" : "/api/manufacturer/profile";
      const response = await axios.get(`${backendUrl}${profilePath}`, { headers: { token } });
      const profile = role === "MANUFACTURER" ? response.data.manufacturer : response.data.distributor;
      if (!response.data.success || !profile) throw new Error("Partner profile could not be loaded.");
      setManufacturer({
        ...profile,
        businessName: profile.businessName || profile.name || "",
      });
    } catch (err) {
      console.error("Failed to fetch profile:", err);
      clearAuthTokens();
      setToken("");
      setManufacturer(null);
      setAvailableWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, [setActiveWorkspace, token]);

  const switchWorkspace = useCallback(async () => {
    const targetRole = activeWorkspace === "MANUFACTURER" ? "DISTRIBUTOR" : "MANUFACTURER";
    try {
      const response = await axios.post(`${backendUrl}/api/auth/workspace`, { role: targetRole });
      if (!response.data?.success || !(response.data.accessToken || response.data.token)) {
        throw new Error(response.data?.message || "Workspace could not be changed.");
      }
      setActiveWorkspace(targetRole);
      storeAuthTokens(response.data);
      toast.success(`Switched to ${targetRole === "DISTRIBUTOR" ? "distributor" : "manufacturer"} workspace.`);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Workspace could not be changed.");
    }
  }, [activeWorkspace, setActiveWorkspace]);

  const toggleAvailability = async () => {
    if (!token || !manufacturer) return;
    try {
      const nextState = !manufacturer.isAvailable;
      const res = await axios.put(
        `${backendUrl}/api/manufacturer/availability`,
        { isAvailable: nextState },
        { headers: { token } }
      );
      if (res.data.success) {
        setManufacturer((prev) => ({ ...prev, isAvailable: nextState }));
        toast.success(nextState ? "Status: Receiving Orders (Online)" : "Status: Paused (Offline)");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update availability");
    }
  };

  useEffect(() => {
    if (token) {
      storeAuthTokens({ accessToken: token });
      fetchProfile();
    } else {
      clearAuthTokens();
      setLoading(false);
    }
  }, [token, fetchProfile]);

  return (
    <ManufacturerContext.Provider
      value={{
        token,
        setToken,
        manufacturer,
        setManufacturer,
        activeWorkspace,
        availableWorkspaces,
        switchWorkspace,
        loading,
        stats,
        setStats,
        fetchProfile,
        toggleAvailability,
        logout,
        backendUrl,
        currency,
      }}
    >
      {children}
    </ManufacturerContext.Provider>
  );
};

export const useManufacturer = () => useContext(ManufacturerContext);
