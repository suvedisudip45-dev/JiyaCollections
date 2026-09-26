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
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const reviewRouter = express.Router();

// Public routes
reviewRouter.get("/product/:productId", getProductReviews);

// Customer authenticated routes
reviewRouter.post("/add", authenticate, authorize("customer:review_write"), addReview);
reviewRouter.post("/status/:productId", authenticate, authorize("customer:review_read"), checkUserReviewStatus);
reviewRouter.post("/like", authenticate, authorize("customer:review_interact"), toggleLikeReview);
reviewRouter.post("/dislike", authenticate, authorize("customer:review_interact"), toggleDislikeReview);
reviewRouter.post("/delete", authenticate, authorize("customer:review_delete"), deleteUserReview);

// Admin authenticated routes
reviewRouter.get("/admin/list", authenticate, authorize("review:admin_list"), adminListReviews);
reviewRouter.post("/admin/delete", authenticate, authorize("review:admin_delete"), adminDeleteReview);

export default reviewRouter;
