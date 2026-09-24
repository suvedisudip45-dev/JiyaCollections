import express from "express";
import {
  addCategory,
  listCategories,
  listCollectionNavigation,
  removeCategory,
} from "../controllers/categoryController.js";
import adminAuth from "../middleware/adminAuth.js";

const categoryRouter = express.Router();

categoryRouter.post("/add", adminAuth, addCategory);
categoryRouter.get("/list", listCategories);
categoryRouter.get("/navigation", listCollectionNavigation);
categoryRouter.post("/remove", adminAuth, removeCategory);

export default categoryRouter;
