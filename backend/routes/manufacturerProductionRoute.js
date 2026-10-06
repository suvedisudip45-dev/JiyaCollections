import express from "express";
import {
  completeProduction,
  createProductionRequest,
  getProductionProducts,
  listProductionRequests,
  reviewProductionRequest,
  startProduction,
} from "../controllers/manufacturerProductionController.js";
import { authenticate, authorize, setManufacturerContext } from "../middleware/unifiedAuth.js";

const router = express.Router();

router.get("/products", authenticate, authorize("manufacturer:production_manage"), setManufacturerContext, getProductionProducts);
router.get("/requests", authenticate, authorize("manufacturer:production_manage"), setManufacturerContext, listProductionRequests);
router.post("/requests", authenticate, authorize("manufacturer:production_manage"), setManufacturerContext, createProductionRequest);
router.post("/requests/:id/start", authenticate, authorize("manufacturer:production_manage"), setManufacturerContext, startProduction);
router.post("/requests/:id/complete", authenticate, authorize("manufacturer:production_manage"), setManufacturerContext, completeProduction);

router.get("/admin/requests", authenticate, authorize("manufacturer:production_admin"), listProductionRequests);
router.post("/admin/requests/:id/review", authenticate, authorize("manufacturer:production_admin"), reviewProductionRequest);

export default router;
