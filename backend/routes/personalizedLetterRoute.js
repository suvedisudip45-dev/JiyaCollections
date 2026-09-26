import express from "express";
import { authenticate, authorize, setManufacturerContext } from "../middleware/unifiedAuth.js";
import { getPersonalizedLetterStatus, printPersonalizedLetter } from "../services/personalizedLetterService.js";

const personalizedLetterRouter = express.Router();

personalizedLetterRouter.get("/:orderId", authenticate, authorize("manufacturer:letter_status_read"), setManufacturerContext, async (req, res) => {
  try {
    const status = await getPersonalizedLetterStatus(req.params.orderId, req.manufacturerId);
    return res.json({ success: true, data: status });
  } catch (error) {
    console.error("getPersonalizedLetterStatus error:", error);
    return res.status(400).json({ success: false, message: error.message || "Unable to fetch personalized letter status." });
  }
});

personalizedLetterRouter.post("/:orderId/print", authenticate, authorize("manufacturer:letter_print"), setManufacturerContext, async (req, res) => {
  try {
    const result = await printPersonalizedLetter(req.params.orderId, req.manufacturerId, req.body?.idempotencyKey || null);
    return res.json(result);
  } catch (error) {
    console.error("printPersonalizedLetter error:", error);
    return res.status(400).json({ success: false, message: error.message || "Unable to print personalized letter." });
  }
});

export default personalizedLetterRouter;
