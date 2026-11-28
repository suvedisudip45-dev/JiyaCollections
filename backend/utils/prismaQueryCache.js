const CACHE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 2_000;
const cacheableActions = new Set(["findMany", "count", "aggregate", "groupBy"]);
const writeActions = new Set([
  "create",
  "createMany",
  "delete",
  "deleteMany",
  "executeRaw",
  "executeRawUnsafe",
  "update",
  "updateMany",
  "upsert",
]);
const cacheableModels = new Set(["category", "color", "comboBundle", "product", "subCategory"]);
const entries = new Map();
let generation = 0;

const serialize = (value) => {
  if (Array.isArray(value)) return value.map(serialize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return `${value}n`;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, serialize(value[key])]),
    );
  }
  if (typeof value === "bigint") return `${value}n`;
  return value;
};

const cloneResult = (value) => {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(cloneResult);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneResult(nested)]),
    );
  }
  return value;
};

const createKey = ({ model, action, args }) => JSON.stringify(serialize({ model, action, args }));

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

export const invalidatePrismaQueryCache = () => {
  generation += 1;
  entries.clear();
};

export const prismaQueryCacheMiddleware = async (params, next) => {
  const modelKey = params.model
    ? `${params.model[0].toLowerCase()}${params.model.slice(1)}`
    : "";
  const cacheable = cacheableModels.has(modelKey)
    && cacheableActions.has(params.action)
    && !params.runInTransaction;
  if (!cacheable) {
    const result = await next(params);
    if (writeActions.has(params.action)) invalidatePrismaQueryCache();
    return result;
  }

  const key = createKey(params);
  const cached = readEntry(key);
  if (cached) return cloneResult(cached.value);

  const requestGeneration = generation;
  const result = await next(params);
  if (requestGeneration === generation) {
    entries.set(key, { value: cloneResult(result), expiresAt: Date.now() + CACHE_TTL_MS });
    while (entries.size > MAX_CACHE_ENTRIES) {
      entries.delete(entries.keys().next().value);
    }
  }
  return result;
};
