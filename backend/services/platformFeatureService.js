import { prisma } from "../config/db.js";

export const DEFAULT_PLATFORM_FEATURES = Object.freeze({
  loyaltyEnabled: false,
  marketingCardsEnabled: false,
  lettersEnabled: false,
});

export const getPlatformFeatures = async (client = prisma) => {
  const config = await client.platformFeatureConfig.findUnique({
    where: { id: "default" },
    select: {
      loyaltyEnabled: true,
      marketingCardsEnabled: true,
      lettersEnabled: true,
    },
  });
  return { ...DEFAULT_PLATFORM_FEATURES, ...config };
};

export const updatePlatformFeatures = async (updates, client = prisma) => {
  const data = {};
  for (const key of Object.keys(DEFAULT_PLATFORM_FEATURES)) {
    if (typeof updates[key] === "boolean") data[key] = updates[key];
  }
  if (!Object.keys(data).length) {
    const error = new Error("At least one valid feature setting is required.");
    error.status = 400;
    error.code = "NO_VALID_FEATURE_SETTINGS";
    throw error;
  }

  return client.platformFeatureConfig.upsert({
    where: { id: "default" },
    create: { id: "default", ...DEFAULT_PLATFORM_FEATURES, ...data },
    update: data,
    select: {
      loyaltyEnabled: true,
      marketingCardsEnabled: true,
      lettersEnabled: true,
    },
  });
};

export default { getPlatformFeatures, updatePlatformFeatures };
