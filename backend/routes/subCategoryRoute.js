import express from "express";
import {
  addSubCategory,
  updateSubCategory,
  listSubCategories,
  removeSubCategory,
} from "../controllers/subCategoryController.js";
import adminAuth from "../middleware/adminAuth.js";
import upload from "../middleware/multer.js";

const subCategoryRouter = express.Router();

subCategoryRouter.post("/add", adminAuth, upload.single("image"), addSubCategory);
subCategoryRouter.post("/update", adminAuth, upload.single("image"), updateSubCategory);
subCategoryRouter.get("/list", listSubCategories);
subCategoryRouter.post("/remove", adminAuth, removeSubCategory);

export default subCategoryRouter;
