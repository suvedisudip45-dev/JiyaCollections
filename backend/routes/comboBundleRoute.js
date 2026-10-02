import express from "express";
import {
  createComboBundle,
  updateComboBundle,
  listComboBundles,
  getComboBundle,
  removeComboBundle,
} from "../controllers/comboBundleController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import upload from "../middleware/multer.js";

const comboBundleRouter = express.Router();

comboBundleRouter.get("/", listComboBundles);
comboBundleRouter.get("/:slug", getComboBundle);
comboBundleRouter.post("/", authenticate, authorize("combo_bundle:create"), upload.fields([
  { name: "bannerImage", maxCount: 1 },
  { name: "images", maxCount: 12 },
]), createComboBundle);
comboBundleRouter.put("/:id", authenticate, authorize("combo_bundle:update"), upload.fields([
  { name: "bannerImage", maxCount: 1 },
  { name: "images", maxCount: 12 },
]), updateComboBundle);
comboBundleRouter.delete("/:id", authenticate, authorize("combo_bundle:delete"), removeComboBundle);

export default comboBundleRouter;
