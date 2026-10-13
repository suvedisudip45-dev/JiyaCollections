import { getPlatformFeatures, updatePlatformFeatures } from "../services/platformFeatureService.js";

export const getPublicPlatformFeatures = async (_req, res) => {
  try {
    return res.json({ success: true, features: await getPlatformFeatures() });
  } catch (error) {
    console.error("Error loading platform feature configuration:", error);
    return res.status(500).json({ success: false, message: "Unable to load feature settings." });
  }
};

export const updatePlatformFeatureSettings = async (req, res) => {
  try {
    const features = await updatePlatformFeatures(req.body || {});
    return res.json({ success: true, message: "Feature settings updated.", features });
  } catch (error) {
    console.error("Error updating platform feature configuration:", error);
    return res.status(error.status || 500).json({
      success: false,
      code: error.code || "FEATURE_SETTINGS_UPDATE_FAILED",
      message: error.status ? error.message : "Unable to update feature settings.",
    });
  }
};
