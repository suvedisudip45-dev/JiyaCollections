import express from "express";
import {
  addReview,
  getProductReviews,
  checkUserReviewStatus,
  toggleLikeReview,
  toggleDislikeReview,
  deleteUserReview,
  adminListReviews,
  adminDeleteReview,
} from "../controllers/reviewController.js";
import authUser from "../middleware/auth.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const reviewRouter = express.Router();

// Public routes
reviewRouter.get("/product/:productId", getProductReviews);

// Customer authenticated routes
reviewRouter.post("/add", authUser, addReview);
reviewRouter.post("/status/:productId", authUser, checkUserReviewStatus);
reviewRouter.post("/like", authUser, toggleLikeReview);
reviewRouter.post("/dislike", authUser, toggleDislikeReview);
reviewRouter.post("/delete", authUser, deleteUserReview);

// Admin authenticated routes
reviewRouter.get("/admin/list", authenticate, authorize("review:admin_list"), adminListReviews);
reviewRouter.post("/admin/delete", authenticate, authorize("review:admin_delete"), adminDeleteReview);

export default reviewRouter;
