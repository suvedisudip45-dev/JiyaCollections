import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { clearAuthTokens, getAccessToken, revokeAuthSession, storeAuthTokens } from "../auth/tokenStorage";

const ManufacturerContext = createContext();

export const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
export const currency = "Rs ";

export const ManufacturerProvider = ({ children }) => {
  const [token, setToken] = useState(() => getAccessToken());
  const [manufacturer, setManufacturer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    pending: 0,
    active: 0,
    ready: 0,
    completed: 0,
    total: 0,
  });

  const logout = async () => {
    await revokeAuthSession(backendUrl);
    setToken("");
    setManufacturer(null);
    toast.info("Logged out successfully");
  };

  const fetchProfile = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const response = await axios.get(`${backendUrl}/api/manufacturer/profile`, {
        headers: { token },
      });
      if (response.data.success) {
        setManufacturer(response.data.manufacturer);
      } else {
        logout();
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err);
    } finally {
      setLoading(false);
    }
  }, [token]);

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
