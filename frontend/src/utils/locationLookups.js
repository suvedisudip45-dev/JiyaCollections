import axios from "axios";
import { useEffect, useState } from "react";

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

export const fetchLocationLookups = async (backendUrl, filters = {}) => {
  const params = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => String(value || "").trim()),
  );
  const key = `${backendUrl}:${new URLSearchParams(params).toString()}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached?.pending) return cached.pending;

  const pending = axios.get(`${backendUrl}/api/lookups/nepal`, { params })
    .then(({ data }) => {
      if (!data?.success) throw new Error(data?.message || "Unable to load location options.");
      cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, { pending, expiresAt: 0 });
  return pending;
};

export const getDistrictsForProvince = (lookups, province) => (
  lookups?.districts
    ?.filter((district) => String(district.province || "").toLocaleLowerCase() === String(province || "").toLocaleLowerCase())
    .map(({ name }) => name) || []
);

export const getBranchesForLocation = (lookups, province, district) => (
  lookups?.branches?.filter((branch) => (
    (!province || branch.province.toLocaleLowerCase() === province.toLocaleLowerCase())
    && (!district || branch.district.toLocaleLowerCase() === district.toLocaleLowerCase())
  )) || []
);

export const useLocationLookups = (backendUrl) => {
  const [lookups, setLookups] = useState(null);
  const [lookupError, setLookupError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchLocationLookups(backendUrl)
      .then((data) => {
        if (!cancelled) setLookups(data);
      })
      .catch((error) => {
        if (!cancelled) setLookupError(error.response?.data?.message || error.message || "Unable to load location options.");
      });
    return () => {
      cancelled = true;
    };
  }, [backendUrl]);

  return { lookups, lookupError };
};
