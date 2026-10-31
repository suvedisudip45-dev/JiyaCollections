import express from "express";
import {
  completeProduction,
  getAdminProductionOptions,
  getManufacturerProductionDashboard,
  listProductionRequests,
  reviewProductionRequest,
  startProduction,
  submitProductionForAdminAcceptance,
  updateAdminProductionRequest,
} from "../controllers/manufacturerProductionController.js";
import { authenticate, authorize, authorizeAny, setManufacturerContext } from "../middleware/unifiedAuth.js";

const router = express.Router();
const requireAdminRole = (req, res, next) => {
  if (req.auth?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_ROLE_REQUIRED",
      message: "Only administrators can access manufacturer production administration.",
    });
  }
  return next();
};

router.get("/dashboard", authenticate, authorize("manufacturer:production_manage"), setManufacturerContext, getManufacturerProductionDashboard);
router.get("/requests", authenticate, authorize("manufacturer:production_manage"), setManufacturerContext, listProductionRequests);
router.post("/requests/:id/start", authenticate, authorize("manufacturer:production_manage"), setManufacturerContext, startProduction);
router.post("/requests/:id/complete", authenticate, authorize("manufacturer:production_manage"), setManufacturerContext, submitProductionForAdminAcceptance);

router.get("/admin/requests", authenticate, requireAdminRole, authorizeAny("manufacturer:production_admin", "manufacturer:admin_production_read"), listProductionRequests);
router.get("/admin/options", authenticate, requireAdminRole, authorize("manufacturer:production_admin"), getAdminProductionOptions);
router.patch("/admin/requests/:id", authenticate, requireAdminRole, authorize("manufacturer:production_admin"), updateAdminProductionRequest);
router.post("/admin/requests/:id/review", authenticate, requireAdminRole, authorize("manufacturer:production_admin"), reviewProductionRequest);
router.post("/admin/requests/:id/acceptance", authenticate, requireAdminRole, authorize("manufacturer:production_admin"), completeProduction);

export default router;
