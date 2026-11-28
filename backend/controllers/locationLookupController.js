import { getLocationLookupData } from "../services/locationLookupService.js";

export const getNepalLocationLookups = async (req, res) => {
  try {
    const data = await getLocationLookupData({
      province: req.query.province,
      district: req.query.district,
      branch: req.query.branch,
    });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error("getNepalLocationLookups error:", error);
    return res.status(503).json({
      success: false,
      code: "LOCATION_LOOKUPS_UNAVAILABLE",
      message: "Unable to load location options. Please try again.",
    });
  }
};
