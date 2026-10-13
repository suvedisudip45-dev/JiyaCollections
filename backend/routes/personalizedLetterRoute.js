import express from "express";
import { authenticate, authorize, setDistributorContext } from "../middleware/unifiedAuth.js";
import requirePlatformFeature from "../middleware/requirePlatformFeature.js";
import { getPersonalizedLetterStatus, printPersonalizedLetter } from "../services/personalizedLetterService.js";

const personalizedLetterRouter = express.Router();

personalizedLetterRouter.get("/:orderId", authenticate, authorize("distributor:letter_status_read"), requirePlatformFeature("lettersEnabled"), setDistributorContext, async (req, res) => {
  try {
    const status = await getPersonalizedLetterStatus(req.params.orderId, null, req.distributorId);
    return res.json({ success: true, data: status });
  } catch (error) {
    console.error("getPersonalizedLetterStatus error:", error);
    return res.status(400).json({ success: false, message: error.message || "Unable to fetch personalized letter status." });
  }
});

personalizedLetterRouter.post("/:orderId/print", authenticate, authorize("distributor:letter_print"), requirePlatformFeature("lettersEnabled"), setDistributorContext, async (req, res) => {
  try {
    const result = await printPersonalizedLetter(req.params.orderId, null, req.body?.idempotencyKey || null, req.distributorId);
    return res.json(result);
  } catch (error) {
    console.error("printPersonalizedLetter error:", error);
    return res.status(400).json({ success: false, message: error.message || "Unable to print personalized letter." });
  }
});

export default personalizedLetterRouter;
