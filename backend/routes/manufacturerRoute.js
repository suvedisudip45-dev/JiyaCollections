import express from "express";
import multer from "multer";
import {
  loginManufacturer,
  getProfile,
  updateAvailability,
  registerManufacturer,
  listManufacturers,
  syncRatings,
  updateQualityRating,
  updateContractStatus,
  uploadContractDoc,
  updateManufacturer,
  updatePickupProfile,
  getManufacturerStats,
} from "../controllers/manufacturerController.js";
import authManufacturer from "../middleware/manufacturerAuth.js";
import { authAdmin } from "../middleware/auth.js";

const manufacturerRouter = express.Router();
const upload = multer({ dest: "uploads/" });

// Public
manufacturerRouter.post("/login", loginManufacturer);

// Manufacturer-authenticated
manufacturerRouter.get("/profile", authManufacturer, getProfile);
manufacturerRouter.post("/profile", authManufacturer, getProfile);
manufacturerRouter.put("/availability", authManufacturer, updateAvailability);
manufacturerRouter.post("/availability", authManufacturer, updateAvailability);
manufacturerRouter.get("/stats", authManufacturer, getManufacturerStats);
manufacturerRouter.post("/pickup-profile", authManufacturer, updatePickupProfile);
manufacturerRouter.put("/pickup-profile", authManufacturer, updatePickupProfile);
manufacturerRouter.get("/pickup-profile", authManufacturer, getProfile);

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
