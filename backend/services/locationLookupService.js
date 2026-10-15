import { prisma } from "../config/db.js";
import { resolveExactLocationEntry } from "../utils/nepalLocationData.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
let lookupCache = { expiresAt: 0, value: null, pending: null };
let cacheEpoch = 0;

const normalize = (value) => String(value || "").trim().toLocaleLowerCase();
const normalizeLocation = (value, expectedType) => {
  const raw = String(value || "").trim();
  const entry = resolveExactLocationEntry(raw);
  return entry?.type === expectedType ? entry.name : raw;
};

const toAreas = (areas) => {
  if (Array.isArray(areas)) {
    return areas.map((area) => String(area || "").trim()).filter(Boolean);
  }
  if (typeof areas === "string") {
    try {
      return toAreas(JSON.parse(areas));
    } catch {
      return areas.split(/[,;\n]/).map((area) => area.trim()).filter(Boolean);
    }
  }
  return [];
};

const loadLookupData = async (client) => {
  const [locations, branches] = await Promise.all([
    client.locationMapping.findMany({
      select: { code: true, name: true, type: true, province: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    client.ncmBranch.findMany({
      where: { isActive: true },
      select: {
        name: true,
        provinceName: true,
        districtName: true,
        coveredAreas: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    locations,
    provinces: locations.filter((location) => location.type === "PROVINCE").map(({ name }) => name),
    districts: locations.filter((location) => location.type === "DISTRICT"),
    branches: branches.map((branch) => ({
      name: branch.name,
      province: normalizeLocation(branch.provinceName, "PROVINCE"),
      district: normalizeLocation(branch.districtName, "DISTRICT"),
      coveredAreas: toAreas(branch.coveredAreas),
    })),
  };
};

const getLookupData = async (client) => {
  if (client !== prisma) return loadLookupData(client);
  if (lookupCache.value && lookupCache.expiresAt > Date.now()) return lookupCache.value;
  if (!lookupCache.pending) {
    const requestEpoch = cacheEpoch;
    lookupCache.pending = loadLookupData(prisma)
      .then((value) => {
        if (cacheEpoch === requestEpoch) {
          lookupCache = { value, expiresAt: Date.now() + CACHE_TTL_MS, pending: null };
        }
        return value;
      })
      .catch((error) => {
        if (cacheEpoch === requestEpoch) lookupCache.pending = null;
        throw error;
      });
  }
  return lookupCache.pending;
};

export const invalidateLocationLookupCache = () => {
  cacheEpoch += 1;
  lookupCache = { expiresAt: 0, value: null, pending: null };
};

export const getLocationLookupData = async ({ province, district, branch } = {}, client = prisma) => {
  const data = await getLookupData(client);
  const provinceKey = normalize(normalizeLocation(province, "PROVINCE"));
  const districtKey = normalize(normalizeLocation(district, "DISTRICT"));
  const branchKey = normalize(branch);
  const branches = data.branches.filter((entry) => (
    (!provinceKey || normalize(entry.province) === provinceKey)
    && (!districtKey || normalize(entry.district) === districtKey)
    && (!branchKey || normalize(entry.name) === branchKey)
  ));

  return {
    locations: data.locations,
    provinces: data.provinces,
    districts: data.districts,
    branches,
    coveredAreas: branchKey ? branches.flatMap((entry) => entry.coveredAreas) : [],
  };
};

export const validateNcmLocationSelection = async ({
  province,
  district,
  branch,
  coveredArea,
} = {}, client = prisma) => {
  const branchName = String(branch || "").trim();
  const areaName = String(coveredArea || "").trim();
  if (!branchName) {
    if (areaName) {
      const error = new Error("Select a valid NCM branch before choosing a covered area.");
      error.statusCode = 400;
      throw error;
    }
    return null;
  }

  const { branches } = await getLocationLookupData({ province, district }, client);
  const selected = branches.find((entry) => normalize(entry.name) === normalize(branchName));
  if (!selected) {
    const error = new Error("Select an active NCM branch for the chosen province and district.");
    error.statusCode = 400;
    throw error;
  }
  if (areaName && !selected.coveredAreas.some((area) => normalize(area) === normalize(areaName))) {
    const error = new Error("Select a covered area listed for the selected NCM branch.");
    error.statusCode = 400;
    throw error;
  }
  const canonicalArea = selected.coveredAreas.find((area) => normalize(area) === normalize(areaName));
  return { branch: selected, coveredArea: canonicalArea || "" };
};
