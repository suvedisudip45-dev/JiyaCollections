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

const normalizeCity = (value) => String(value || "").trim().toLowerCase();

export const resolveNcmBranches = ({ manufacturer, address }) => {
  const cityMap = parseJson(process.env.NCM_BRANCH_MAP_JSON, {});
  const manufacturerPickupBranch = normalizeBranch(manufacturer?.ncmPickupBranch || manufacturer?.pickupBranch || "");
  const destinationBranch = normalizeBranch(cityMap[normalizeCity(address?.city)] || "");

  return {
    origin: manufacturerPickupBranch,
    destination: destinationBranch,
  };
};
