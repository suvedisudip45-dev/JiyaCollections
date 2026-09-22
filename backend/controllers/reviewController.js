import { prisma } from "../config/db.js";
import jwt from "jsonwebtoken";
import { syncManufacturerRatingForProduct } from "../services/manufacturerRatingService.js";
import { sanitizeText } from "../middleware/sanitize.js";

// Helper: Safely parse JSON array field from Prisma
const parseJsonArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

// Helper: Safely get user ID from token if present in headers
const getUserIdFromOptionalToken = (req) => {
  try {
    const { token } = req.headers;
    if (!token) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded?.id || null;
  } catch {
    return null;
  }
};

// Helper: Check if user purchased a specific product
const userHasPurchasedProduct = async (userId, productId) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId },
    });

    for (const order of orders) {
      if (order.status && order.status.toLowerCase().includes("cancelled")) {
        continue;
      }
      const items = parseJsonArray(order.items);
      const hasItem = items.some((item) => {
        const pId = item._id || item.productId || item.id;
        return String(pId) === String(productId);
      });
      if (hasItem) {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error("Error checking purchase status:", err);
    return false;
  }
};

// Add or Update a product review (Logged-in verified buyers only)
const addReview = async (req, res) => {
  try {
    const { userId, productId, rating, title, comment } = req.body;

    if (!productId) {
      return res.json({ success: false, message: "Product ID is required" });
    }

    const numRating = Number(rating);
    if (!numRating || numRating < 1 || numRating > 5) {
      return res.json({ success: false, message: "Please select a valid rating between 1 and 5 stars" });
    }

    const cleanTitle = sanitizeText(title, { stripAllHtml: true }) || "";
    const cleanComment = sanitizeText(comment) || "";

    if (!cleanComment) {
      return res.json({ success: false, message: "Please write a review comment" });
    }

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.json({ success: false, message: "User not found. Please log in again." });
    }

    // Verify user purchased this product
    const hasPurchased = await userHasPurchasedProduct(userId, productId);
    if (!hasPurchased) {
      return res.json({
        success: false,
        message: "Only customers who have purchased this product can leave a review.",
      });
    }

    // Formulate full name using firstName.concat(" ").concat(lastName)
    const userFullName =
      user.firstName && user.lastName
        ? user.firstName.trim().concat(" ").concat(user.lastName.trim())
        : (user.name || "Customer");

    // Check if user already reviewed this product
    const existingReview = await prisma.review.findFirst({
      where: { productId, userId },
    });

    if (existingReview) {
      // Update existing review
      await prisma.review.update({
        where: { id: existingReview.id },
        data: {
          rating: numRating,
          title: cleanTitle,
          comment: cleanComment,
          userName: userFullName,
          userEmail: user.email,
          date: BigInt(Date.now()),
        },
      });

      // Synchronize manufacturer ratings dynamically based on customer review
      syncManufacturerRatingForProduct(productId, userId).catch((err) =>
        console.error("Error syncing manufacturer rating on review update:", err)
      );

      return res.json({ success: true, message: "Review updated successfully!" });
    }

    // Create new review
    await prisma.review.create({
      data: {
        productId,
        userId,
        userName: userFullName,
        userEmail: user.email,
        rating: numRating,
        title: cleanTitle,
        comment: cleanComment,
        likes: [],
        dislikes: [],
        verified: true,
        date: BigInt(Date.now()),
      },
    });

    // Synchronize manufacturer ratings dynamically based on customer review
    syncManufacturerRatingForProduct(productId, userId).catch((err) =>
      console.error("Error syncing manufacturer rating on new review:", err)
    );

    res.json({ success: true, message: "Review submitted successfully!" });
  } catch (error) {
    console.error("Error adding review:", error);
    res.json({ success: false, message: error.message });
  }
};

// Get reviews for a specific product with stats and sorting
const getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    const { sortBy = "likes" } = req.query; // 'likes', 'recent', 'rating_high', 'rating_low'
    const currentUserId = getUserIdFromOptionalToken(req);

    const rawReviews = await prisma.review.findMany({
      where: { productId },
    });

    // Compute stats
    const totalReviews = rawReviews.length;
    let totalRatingSum = 0;
    const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    const formattedReviews = rawReviews.map((item) => {
      const likes = parseJsonArray(item.likes);
      const dislikes = parseJsonArray(item.dislikes);
      const rating = Number(item.rating) || 5;

      totalRatingSum += rating;
      if (breakdown[rating] !== undefined) {
        breakdown[rating] += 1;
      }

      return {
        _id: item.id,
        id: item.id,
        productId: item.productId,
        userId: item.userId,
        userName: item.userName,
        userEmail: item.userEmail,
        rating: rating,
        title: item.title || "",
        comment: item.comment,
        verified: Boolean(item.verified),
        date: Number(item.date),
        likesCount: likes.length,
        dislikesCount: dislikes.length,
        isLiked: currentUserId ? likes.includes(currentUserId) : false,
        isDisliked: currentUserId ? dislikes.includes(currentUserId) : false,
        isOwner: currentUserId === item.userId,
      };
    });

    const averageRating = totalReviews > 0 ? Number((totalRatingSum / totalReviews).toFixed(1)) : 0;

    // Apply Sorting
    formattedReviews.sort((a, b) => {
      if (sortBy === "likes") {
        const netA = a.likesCount - a.dislikesCount;
        const netB = b.likesCount - b.dislikesCount;
        if (netB !== netA) return netB - netA;
        if (b.likesCount !== a.likesCount) return b.likesCount - a.likesCount;
        return b.date - a.date;
      } else if (sortBy === "recent") {
        return b.date - a.date;
      } else if (sortBy === "rating_high") {
        if (b.rating !== a.rating) return b.rating - a.rating;
        return b.likesCount - a.likesCount;
      } else if (sortBy === "rating_low") {
        if (a.rating !== b.rating) return a.rating - b.rating;
        return b.likesCount - a.likesCount;
      }
      return b.date - a.date;
    });

    res.json({
      success: true,
      reviews: formattedReviews,
      stats: {
        totalReviews,
        averageRating,
        breakdown,
      },
    });
  } catch (error) {
    console.error("Error getting product reviews:", error);
    res.json({ success: false, message: error.message });
  }
};

// Check user review status (Has purchased? Has reviewed?)
const checkUserReviewStatus = async (req, res) => {
  try {
    const { userId } = req.body;
    const { productId } = req.params;

    if (!productId) {
      return res.json({ success: false, message: "Product ID is required" });
    }

    const hasPurchased = await userHasPurchasedProduct(userId, productId);
    const existingReview = await prisma.review.findFirst({
      where: { productId, userId },
    });

    let userReview = null;
    if (existingReview) {
      const likes = parseJsonArray(existingReview.likes);
      const dislikes = parseJsonArray(existingReview.dislikes);
      userReview = {
        _id: existingReview.id,
        id: existingReview.id,
        rating: existingReview.rating,
        title: existingReview.title,
        comment: existingReview.comment,
        likesCount: likes.length,
        dislikesCount: dislikes.length,
        date: Number(existingReview.date),
      };
    }

    res.json({
      success: true,
      canReview: hasPurchased,
      hasReviewed: Boolean(existingReview),
      userReview,
    });
  } catch (error) {
    console.error("Error checking user review status:", error);
    res.json({ success: false, message: error.message });
  }
};

// Toggle Like on review
const toggleLikeReview = async (req, res) => {
  try {
    const { userId, reviewId } = req.body;

    if (!reviewId) {
      return res.json({ success: false, message: "Review ID is required" });
    }

    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) {
      return res.json({ success: false, message: "Review not found" });
    }

    let likes = parseJsonArray(review.likes);
    let dislikes = parseJsonArray(review.dislikes);

    const isAlreadyLiked = likes.includes(userId);

    if (isAlreadyLiked) {
      // Toggle off
      likes = likes.filter((id) => id !== userId);
    } else {
      // Add like and remove dislike if present
      likes.push(userId);
      dislikes = dislikes.filter((id) => id !== userId);
    }

    await prisma.review.update({
      where: { id: reviewId },
      data: {
        likes,
        dislikes,
      },
    });

    res.json({
      success: true,
      likesCount: likes.length,
      dislikesCount: dislikes.length,
      isLiked: !isAlreadyLiked,
      isDisliked: false,
    });
  } catch (error) {
    console.error("Error toggling like:", error);
    res.json({ success: false, message: error.message });
  }
};

// Toggle Dislike on review
const toggleDislikeReview = async (req, res) => {
  try {
    const { userId, reviewId } = req.body;

    if (!reviewId) {
      return res.json({ success: false, message: "Review ID is required" });
    }

    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) {
      return res.json({ success: false, message: "Review not found" });
    }

    let likes = parseJsonArray(review.likes);
    let dislikes = parseJsonArray(review.dislikes);

    const isAlreadyDisliked = dislikes.includes(userId);

    if (isAlreadyDisliked) {
      // Toggle off
      dislikes = dislikes.filter((id) => id !== userId);
    } else {
      // Add dislike and remove like if present
      dislikes.push(userId);
      likes = likes.filter((id) => id !== userId);
    }

    await prisma.review.update({
      where: { id: reviewId },
      data: {
        likes,
        dislikes,
      },
    });

    res.json({
      success: true,
      likesCount: likes.length,
      dislikesCount: dislikes.length,
      isLiked: false,
      isDisliked: !isAlreadyDisliked,
    });
  } catch (error) {
    console.error("Error toggling dislike:", error);
    res.json({ success: false, message: error.message });
  }
};

// Delete user's own review
const deleteUserReview = async (req, res) => {
  try {
    const { userId, reviewId } = req.body;

    const review = await prisma.review.findFirst({
      where: { id: reviewId, userId },
    });

    if (!review) {
      return res.json({ success: false, message: "Review not found or unauthorized" });
    }

    const productId = review.productId;
    await prisma.review.delete({ where: { id: reviewId } });

    syncManufacturerRatingForProduct(productId, userId).catch((err) =>
      console.error("Error syncing manufacturer rating on review delete:", err)
    );

    res.json({ success: true, message: "Review deleted successfully" });
  } catch (error) {
    console.error("Error deleting review:", error);
    res.json({ success: false, message: error.message });
  }
};

// Admin: Get all reviews across all products with product details
const adminListReviews = async (req, res) => {
  try {
    const rawReviews = await prisma.review.findMany({
      orderBy: { date: "desc" },
    });

    // Fetch products to attach product info
    const productIds = [...new Set(rawReviews.map((r) => r.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    const productMap = {};
    products.forEach((p) => {
      let img = [];
      if (Array.isArray(p.image)) img = p.image;
      else if (typeof p.image === "string") {
        try { img = JSON.parse(p.image); } catch { img = []; }
      }
      productMap[p.id] = {
        name: p.name,
        price: p.price,
        image: img[0] || "",
        category: p.category,
      };
    });

    const reviews = rawReviews.map((item) => {
      const likes = parseJsonArray(item.likes);
      const dislikes = parseJsonArray(item.dislikes);
      const prodInfo = productMap[item.productId] || {
        name: "Unknown / Deleted Product",
        image: "",
        category: "",
        price: 0,
      };

      return {
        _id: item.id,
        id: item.id,
        productId: item.productId,
        productName: prodInfo.name,
        productImage: prodInfo.image,
        productCategory: prodInfo.category,
        userId: item.userId,
        userName: item.userName,
        userEmail: item.userEmail,
        rating: Number(item.rating),
        title: item.title || "",
        comment: item.comment,
        likesCount: likes.length,
        dislikesCount: dislikes.length,
        verified: Boolean(item.verified),
        date: Number(item.date),
      };
    });

    res.json({ success: true, reviews });
  } catch (error) {
    console.error("Error listing reviews for admin:", error);
    res.json({ success: false, message: error.message });
  }
};

// Admin: Delete/moderate inappropriate review
const adminDeleteReview = async (req, res) => {
  try {
    const { reviewId } = req.body;

    if (!reviewId) {
      return res.json({ success: false, message: "Review ID is required" });
    }

    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) {
      return res.json({ success: false, message: "Review not found" });
    }

    const productId = review.productId;
    const userId = review.userId;
    await prisma.review.delete({ where: { id: reviewId } });

    syncManufacturerRatingForProduct(productId, userId).catch((err) =>
      console.error("Error syncing manufacturer rating on admin review delete:", err)
    );

    res.json({ success: true, message: "Review removed successfully by admin" });
  } catch (error) {
    console.error("Error removing review by admin:", error);
    res.json({ success: false, message: error.message });
  }
};

export {
  addReview,
  getProductReviews,
  checkUserReviewStatus,
  toggleLikeReview,
  toggleDislikeReview,
  deleteUserReview,
  adminListReviews,
  adminDeleteReview,
};
