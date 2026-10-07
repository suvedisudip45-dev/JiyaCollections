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
  const [manufacturer, setManufacturer] = useState(null);    // active manufacturer profile (null if distributor-only view)
  const [distributor, setDistributor] = useState(null);      // active distributor profile (null if manufacturer-only view)
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
    setDistributor(null);
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
      const allRoles = sessionResponse.data.account.roles || [];
      setAvailableWorkspaces(allRoles);

      // Always fetch both profiles if available roles include both
      const hasMfr = allRoles.some((w) => (typeof w === "string" ? w : w.code) === "MANUFACTURER") || role === "MANUFACTURER";
      const hasDist = allRoles.some((w) => (typeof w === "string" ? w : w.code) === "DISTRIBUTOR") || role === "DISTRIBUTOR";

      // Fetch active workspace profile
      if (role === "DISTRIBUTOR") {
        const res = await axios.get(`${backendUrl}/api/distributor/profile`, { headers: { token } });
        const prof = res.data.distributor;
        if (!res.data.success || !prof) throw new Error("Distributor profile could not be loaded.");
        setDistributor({ ...prof, businessName: prof.businessName || prof.name || "" });
        // If also a manufacturer, fetch that too (for sidebar context)
        if (hasMfr) {
          try {
            const mRes = await axios.get(`${backendUrl}/api/manufacturer/profile`, { headers: { token } });
            if (mRes.data.success && mRes.data.manufacturer) {
              setManufacturer({ ...mRes.data.manufacturer, businessName: mRes.data.manufacturer.businessName || mRes.data.manufacturer.name || "" });
            }
          } catch { /* non-critical */ }
        }
      } else {
        const res = await axios.get(`${backendUrl}/api/manufacturer/profile`, { headers: { token } });
        const prof = res.data.manufacturer;
        if (!res.data.success || !prof) throw new Error("Manufacturer profile could not be loaded.");
        setManufacturer({ ...prof, businessName: prof.businessName || prof.name || "" });
        // If also a distributor, fetch that too
        if (hasDist) {
          try {
            const dRes = await axios.get(`${backendUrl}/api/distributor/profile`, { headers: { token } });
            if (dRes.data.success && dRes.data.distributor) {
              setDistributor({ ...dRes.data.distributor, businessName: dRes.data.distributor.businessName || dRes.data.distributor.name || "" });
            }
          } catch { /* non-critical */ }
        }
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err);
      clearAuthTokens();
      setToken("");
      setManufacturer(null);
      setDistributor(null);
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
      storeAuthTokens(response.data);
      setActiveWorkspace(targetRole);
      toast.success(`Switched to ${targetRole === "DISTRIBUTOR" ? "Distributor" : "Manufacturer"} view.`);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Workspace could not be changed.");
    }
  }, [activeWorkspace, setActiveWorkspace]);

  // Manufacturer availability toggle (accepting auto-assigned production orders)
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

  // Distributor availability toggle (accepting hub orders online / paused offline)
  const toggleDistributorAvailability = async () => {
    if (!token || !distributor) return;
    try {
      const nextState = !distributor.isActive;
      const res = await axios.patch(
        `${backendUrl}/api/distributor/availability`,
        { isAvailable: nextState },
        { headers: { token } }
      );
      if (res.data.success) {
        setDistributor((prev) => ({ ...prev, isActive: nextState }));
        toast.success(nextState ? "Hub: Accepting Orders (Online)" : "Hub: Paused (Offline)");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update hub availability");
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

  // Active profile: the one for the current workspace
  const activeProfile = activeWorkspace === "DISTRIBUTOR" ? distributor : manufacturer;

  return (
    <ManufacturerContext.Provider
      value={{
        token,
        setToken,
        manufacturer,
        setManufacturer,
        distributor,
        setDistributor,
        activeProfile,
        activeWorkspace,
        availableWorkspaces,
        switchWorkspace,
        loading,
        stats,
        setStats,
        fetchProfile,
        toggleAvailability,
        toggleDistributorAvailability,
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
