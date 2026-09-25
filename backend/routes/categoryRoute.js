import express from "express";
import {
  addCategory,
  listCategories,
  listCollectionNavigation,
  removeCategory,
} from "../controllers/categoryController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const categoryRouter = express.Router();

categoryRouter.post("/add", authenticate, authorize("category:create"), addCategory);
categoryRouter.get("/list", listCategories);
categoryRouter.get("/navigation", listCollectionNavigation);
categoryRouter.post("/remove", authenticate, authorize("category:delete"), removeCategory);

export default categoryRouter;
