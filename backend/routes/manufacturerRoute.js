import express from "express";
import multer from "multer";
import {
  loginManufacturer,
  getProfile,
  updateAvailability,
  registerManufacturer,
  registerManufacturerSelf,
  listManufacturers,
  syncRatings,
  updateQualityRating,
  updateContractStatus,
  uploadContractDoc,
  updateManufacturer,
  updateCommissionAgreement,
  updatePickupProfile,
  getManufacturerStats,
  getAvailableNcmBranches,
  syncNcmBranches,
} from "../controllers/manufacturerController.js";
import { authenticate, authorize, setManufacturerContext } from "../middleware/unifiedAuth.js";

const manufacturerRouter = express.Router();
const upload = multer({ dest: "uploads/" });

// Public
manufacturerRouter.post("/login", loginManufacturer);
manufacturerRouter.get("/branches", getAvailableNcmBranches);
manufacturerRouter.post("/admin/branches/sync", authenticate, authorize("manufacturer:branches_sync"), syncNcmBranches);
manufacturerRouter.post("/register", upload.single("contractDoc"), registerManufacturerSelf);

// Manufacturer-authenticated
manufacturerRouter.get("/profile", authenticate, authorize("manufacturer:profile_read"), setManufacturerContext, getProfile);
manufacturerRouter.post("/profile", authenticate, authorize("manufacturer:profile_read"), setManufacturerContext, getProfile);
manufacturerRouter.put("/availability", authenticate, authorize("manufacturer:availability_update"), setManufacturerContext, updateAvailability);
manufacturerRouter.post("/availability", authenticate, authorize("manufacturer:availability_update"), setManufacturerContext, updateAvailability);
manufacturerRouter.get("/stats", authenticate, authorize("manufacturer:stats_read"), setManufacturerContext, getManufacturerStats);
manufacturerRouter.post("/pickup-profile", authenticate, authorize("manufacturer:pickup_update"), setManufacturerContext, updatePickupProfile);
manufacturerRouter.put("/pickup-profile", authenticate, authorize("manufacturer:pickup_update"), setManufacturerContext, updatePickupProfile);
manufacturerRouter.get("/pickup-profile", authenticate, authorize("manufacturer:profile_read"), setManufacturerContext, getProfile);
manufacturerRouter.post("/commission", authenticate, authorize("manufacturer:commission_propose"), setManufacturerContext, updateCommissionAgreement);
manufacturerRouter.put("/commission", authenticate, authorize("manufacturer:commission_propose"), setManufacturerContext, updateCommissionAgreement);
manufacturerRouter.put("/admin/commission/:id", authenticate, authorize("manufacturer:admin_commission_update"), updateCommissionAgreement);

// Admin-only (support both direct and /admin/ prefixed paths)
manufacturerRouter.get("/list", authenticate, authorize("manufacturer:admin_list"), listManufacturers);
manufacturerRouter.get("/admin/list", authenticate, authorize("manufacturer:admin_list"), listManufacturers);
manufacturerRouter.post("/sync-ratings", authenticate, authorize("manufacturer:admin_sync_ratings"), syncRatings);
manufacturerRouter.post("/admin/sync-ratings", authenticate, authorize("manufacturer:admin_sync_ratings"), syncRatings);

manufacturerRouter.post("/register", authenticate, authorize("manufacturer:admin_register"), upload.single("contractDoc"), registerManufacturer);
manufacturerRouter.post("/admin/register", authenticate, authorize("manufacturer:admin_register"), upload.single("contractDoc"), registerManufacturer);

manufacturerRouter.post("/quality-rating", authenticate, authorize("manufacturer:admin_quality_update"), updateQualityRating);
manufacturerRouter.put("/admin/quality/:id", authenticate, authorize("manufacturer:admin_quality_update"), updateQualityRating);
manufacturerRouter.put("/quality/:id", authenticate, authorize("manufacturer:admin_quality_update"), updateQualityRating);

manufacturerRouter.post("/contract-status", authenticate, authorize("manufacturer:admin_contract_update"), updateContractStatus);
manufacturerRouter.put("/admin/contract/:id", authenticate, authorize("manufacturer:admin_contract_update"), updateContractStatus);
manufacturerRouter.put("/contract/:id", authenticate, authorize("manufacturer:admin_contract_update"), updateContractStatus);

manufacturerRouter.post("/upload-contract", authenticate, authorize("manufacturer:admin_contract_upload"), upload.single("contractDoc"), uploadContractDoc);
manufacturerRouter.post("/admin/contract-upload/:id", authenticate, authorize("manufacturer:admin_contract_upload"), upload.single("contractDoc"), uploadContractDoc);
manufacturerRouter.post("/contract-upload/:id", authenticate, authorize("manufacturer:admin_contract_upload"), upload.single("contractDoc"), uploadContractDoc);

manufacturerRouter.post("/update", authenticate, authorize("manufacturer:admin_update"), updateManufacturer);
manufacturerRouter.post("/admin/update", authenticate, authorize("manufacturer:admin_update"), updateManufacturer);
manufacturerRouter.put("/admin/update/:id", authenticate, authorize("manufacturer:admin_update"), updateManufacturer);

export default manufacturerRouter;
