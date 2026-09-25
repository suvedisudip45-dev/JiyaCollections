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
import { authAdmin } from "../middleware/auth.js";

const manufacturerRouter = express.Router();
const upload = multer({ dest: "uploads/" });

// Public
manufacturerRouter.post("/login", loginManufacturer);
manufacturerRouter.get("/branches", getAvailableNcmBranches);
manufacturerRouter.post("/admin/branches/sync", authAdmin, syncNcmBranches);
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
manufacturerRouter.put("/admin/commission/:id", authAdmin, updateCommissionAgreement);

// Admin-only (support both direct and /admin/ prefixed paths)
manufacturerRouter.get("/list", authAdmin, listManufacturers);
manufacturerRouter.get("/admin/list", authAdmin, listManufacturers);
manufacturerRouter.post("/sync-ratings", authAdmin, syncRatings);
manufacturerRouter.post("/admin/sync-ratings", authAdmin, syncRatings);

manufacturerRouter.post("/register", authAdmin, upload.single("contractDoc"), registerManufacturer);
manufacturerRouter.post("/admin/register", authAdmin, upload.single("contractDoc"), registerManufacturer);

manufacturerRouter.post("/quality-rating", authAdmin, updateQualityRating);
manufacturerRouter.put("/admin/quality/:id", authAdmin, updateQualityRating);
manufacturerRouter.put("/quality/:id", authAdmin, updateQualityRating);

manufacturerRouter.post("/contract-status", authAdmin, updateContractStatus);
manufacturerRouter.put("/admin/contract/:id", authAdmin, updateContractStatus);
manufacturerRouter.put("/contract/:id", authAdmin, updateContractStatus);

manufacturerRouter.post("/upload-contract", authAdmin, upload.single("contractDoc"), uploadContractDoc);
manufacturerRouter.post("/admin/contract-upload/:id", authAdmin, upload.single("contractDoc"), uploadContractDoc);
manufacturerRouter.post("/contract-upload/:id", authAdmin, upload.single("contractDoc"), uploadContractDoc);

manufacturerRouter.post("/update", authAdmin, updateManufacturer);
manufacturerRouter.post("/admin/update", authAdmin, updateManufacturer);
manufacturerRouter.put("/admin/update/:id", authAdmin, updateManufacturer);

export default manufacturerRouter;
