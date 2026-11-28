import { getPlatformFeatures } from "../services/platformFeatureService.js";

const requirePlatformFeature = (feature) => async (_req, res, next) => {
  try {
    const features = await getPlatformFeatures();
    if (!features[feature]) {
      return res.status(403).json({
        success: false,
        code: "FEATURE_DISABLED",
        message: "This feature is currently unavailable.",
      });
    }
    return next();
  } catch (error) {
    console.error(`Error checking platform feature "${feature}":`, error);
    return res.status(500).json({ success: false, message: "Unable to verify feature availability." });
  }
};

export default requirePlatformFeature;
