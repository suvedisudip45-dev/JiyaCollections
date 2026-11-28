import axios from "axios";

const CACHE_TTL_MS = 10000;
const MAX_CACHE_ENTRIES = 100;
const entries = new Map();

const serialize = (value) => {
  if (value instanceof URLSearchParams) {
    return [...value.entries()].sort(([left], [right]) => left.localeCompare(right));
  }
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, serialize(value[key])]),
    );
  }
  return value;
};

const createCacheKey = (config, token, scope) => JSON.stringify([
  config.baseURL || "",
  config.url || "",
  serialize(config.params || {}),
  token || "",
  scope || "",
  config.headers?.get?.("accept") || config.headers?.Accept || config.headers?.accept || "",
]);

const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const getRequestToken = (config, getAccessToken) => {
  const headers = config.headers;
  const explicitToken = headers?.get?.("token")
    || headers?.token
    || headers?.get?.("Authorization")
    || headers?.Authorization
    || "";
  return String(explicitToken).replace(/^Bearer\s+/i, "") || getAccessToken();
};
const isJsonResponse = (response) => {
  if (response.config.responseType && response.config.responseType !== "json") return false;
  const contentType = response.headers?.get?.("content-type")
    || response.headers?.["content-type"]
    || "";
  return /(?:application|text)\/[^;]*json|application\/[^;]+\+json/i.test(contentType)
    && response.data !== undefined;
};

const readEntry = (key) => {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return null;
  }
  entries.delete(key);
  entries.set(key, entry);
  return entry;
};

export const clearResponseCache = () => entries.clear();

export const installResponseCache = (client, getAccessToken, getScope = () => "") => {
  client.interceptors.request.use((config) => {
    if (
      config.method?.toLowerCase() !== "get"
      || config.cacheResponse === false
      || (config.responseType && config.responseType !== "json")
    ) return config;

    const token = getRequestToken(config, getAccessToken);
    if (!token && config.withCredentials) return config;

    const key = createCacheKey(config, token, getScope());
    const baseAdapter = config._responseCacheBaseAdapter || axios.getAdapter(config.adapter);
    config._responseCacheBaseAdapter = baseAdapter;
    config.adapter = async (requestConfig) => {
      const cached = readEntry(key);
      if (cached) {
        return {
          data: cloneJson(cached.data),
          status: cached.status,
          statusText: cached.statusText,
          headers: cached.headers,
          config: requestConfig,
        };
      }

      const response = await baseAdapter(requestConfig);
      if (response.status >= 200 && response.status < 300 && isJsonResponse(response)) {
        entries.delete(key);
        entries.set(key, {
          data: cloneJson(response.data),
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
        while (entries.size > MAX_CACHE_ENTRIES) {
          entries.delete(entries.keys().next().value);
        }
      }
      return response;
    };
    return config;
  });

  client.interceptors.response.use(
    (response) => {
      if (response.config.method?.toLowerCase() !== "get") clearResponseCache();
      return response;
    },
    (error) => Promise.reject(error),
  );
};
