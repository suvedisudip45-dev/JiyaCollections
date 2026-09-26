import express from "express";
import {
  addSubCategory,
  updateSubCategory,
  listSubCategories,
  removeSubCategory,
} from "../controllers/subCategoryController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import upload from "../middleware/multer.js";

const subCategoryRouter = express.Router();

subCategoryRouter.post("/add", authenticate, authorize("subcategory:create"), upload.single("image"), addSubCategory);
subCategoryRouter.post("/update", authenticate, authorize("subcategory:update"), upload.single("image"), updateSubCategory);
subCategoryRouter.get("/list", listSubCategories);
subCategoryRouter.post("/remove", authenticate, authorize("subcategory:delete"), removeSubCategory);

export default subCategoryRouter;
