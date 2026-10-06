const CACHE_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 20;
const entries = new Map();

export const getAuditHistoryCache = (key) => {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return null;
  }
  entries.delete(key);
  entries.set(key, entry);
  return entry.data;
};

export const setAuditHistoryCache = (key, data) => {
  entries.delete(key);
  entries.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  while (entries.size > MAX_CACHE_ENTRIES) {
    entries.delete(entries.keys().next().value);
  }
};

export const clearAuditHistoryCache = () => entries.clear();
