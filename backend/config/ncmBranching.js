const parseJson = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeBranch = (value) => String(value || "").trim().toUpperCase();

const normalizeCity = (value) => String(value || "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").replace(/[^a-z0-9]+/g, "");

const cityAliases = {
  lalitpur: ["lalitpur", "patan"],
  patan: ["lalitpur", "patan"],
  bhaktapur: ["bhaktapur", "madhyapurthimi"],
  bharatpur: ["bharatpur", "chitwan"],
  chitwan: ["bharatpur", "chitwan"],
  bhairahawa: ["bhairahawa", "siddharthanagar"],
  siddharthanagar: ["bhairahawa", "siddharthanagar"],
  surkhet: ["surkhet", "birendranagar"],
  birendranagar: ["surkhet", "birendranagar"],
  lamjung: ["lamjung", "besisahar", "besisahar"],
  besisahar: ["lamjung", "besisahar"],
  baglung: ["baglung"],
  dharan: ["dharan", "itahari"],
  itahari: ["dharan", "itahari"],
  kirtipur: ["kathmandu", "kirtipur"],
  banepa: ["kathmandu", "banepa"],
  dhulikhel: ["kathmandu", "dhulikhel"],
};

const resolveMappedBranch = (value) => {
  if (Array.isArray(value)) {
    return normalizeBranch(value.find(Boolean) || "");
  }

  return normalizeBranch(value);
};

const resolveCityBranch = (cityMap, city) => {
  const normalized = normalizeCity(city);
  const candidates = [normalized];

  if (cityAliases[normalized]) {
    candidates.push(...cityAliases[normalized]);
  }

  const directMatch = candidates
    .map((candidate) => cityMap[candidate])
    .find((value) => value !== undefined && value !== null);

  return resolveMappedBranch(directMatch || "");
};

export const resolveNcmBranches = ({ manufacturer, address }) => {
  const cityMap = parseJson(process.env.NCM_BRANCH_MAP_JSON, {});
  const manufacturerPickupBranch = normalizeBranch(manufacturer?.ncmPickupBranch || manufacturer?.pickupBranch || "");
  const destinationBranch = resolveCityBranch(cityMap, address?.city);

  return {
    origin: manufacturerPickupBranch,
    destination: destinationBranch,
  };
};
