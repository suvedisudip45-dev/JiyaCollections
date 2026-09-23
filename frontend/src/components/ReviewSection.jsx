/* eslint-disable react/prop-types */
import { useState, useEffect, useContext } from "react";
import axios from "axios";
import { ShopContext } from "../context/ShopContext";
import { toast } from "react-toastify";
import Pagination from "./Pagination";

const STAR_LABELS = {
  1: "Poor",
  2: "Fair",
  3: "Average",
  4: "Good",
  5: "Excellent",
};

const ReviewSection = ({ productId, productName, onStatsUpdate }) => {
  const { backendUrl, token, navigate } = useContext(ShopContext);

  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState({
    totalReviews: 0,
    averageRating: 0,
    breakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("likes");
  const [filterRating, setFilterRating] = useState(null); // null = all
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  // User review status
  const [userStatus, setUserStatus] = useState({
    canReview: false,
    hasReviewed: false,
    userReview: null,
  });

  // Modal / Form state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);

  // Fetch reviews from backend
  const fetchReviews = async () => {
    try {
      setLoading(true);
      const headers = token ? { token } : {};
      const res = await axios.get(
        `${backendUrl}/api/review/product/${productId}?sortBy=${sortBy}&page=${page}&limit=10`,
        { headers }
      );

      if (res.data.success) {
        setReviews(res.data.reviews || []);
        setPagination(res.data.pagination || null);
        if (res.data.stats) {
          setStats(res.data.stats);
          if (onStatsUpdate) {
            onStatsUpdate(res.data.stats);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching reviews:", err);
    } finally {
      setLoading(false);
    }
  };

  // Check if current logged-in user has purchased product or already reviewed
  const checkUserStatus = async () => {
    if (!token) {
      setUserStatus({ canReview: false, hasReviewed: false, userReview: null });
      return;
    }
    try {
      const res = await axios.post(
        `${backendUrl}/api/review/status/${productId}`,
        {},
        { headers: { token } }
      );
      if (res.data.success) {
        setUserStatus({
          canReview: res.data.canReview,
          hasReviewed: res.data.hasReviewed,
          userReview: res.data.userReview,
        });
        if (res.data.userReview) {
          setRating(res.data.userReview.rating || 5);
          setTitle(res.data.userReview.title || "");
          setComment(res.data.userReview.comment || "");
        }
      }
    } catch (err) {
      console.error("Error checking user status:", err);
    }
  };

  useEffect(() => {
    if (productId) {
      fetchReviews();
    }
  }, [productId, sortBy, token, page]);

  const handlePageChange = (nextPage) => setPage(nextPage);

  useEffect(() => {
    if (productId && token) {
      checkUserStatus();
    } else {
      setUserStatus({ canReview: false, hasReviewed: false, userReview: null });
    }
  }, [productId, token]);

  // Handle Review Submission
  const handleSubmitReview = async (e) => {
    e.preventDefault();
    if (!token) {
      toast.error("Please login to submit a review");
      navigate("/login");
      return;
    }

    if (!userStatus.canReview) {
      toast.error("Only customers who have purchased this product can leave a review.");
      return;
    }

    if (!comment.trim()) {
      toast.error("Please provide review feedback");
      return;
    }

    try {
      setSubmitting(true);
      const res = await axios.post(
        `${backendUrl}/api/review/add`,
        {
          productId,
          rating,
          title,
          comment,
        },
        { headers: { token } }
      );

      if (res.data.success) {
        toast.success(res.data.message || "Review submitted successfully!");
        setIsModalOpen(false);
        fetchReviews();
        checkUserStatus();
      } else {
        toast.error(res.data.message || "Failed to submit review");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Like Toggle
  const handleToggleLike = async (reviewId) => {
    if (!token) {
      toast.info("Please login to like this review");
      return;
    }
    if (actionInProgress) return;

    // Optimistic UI update
    setReviews((prev) =>
      prev.map((r) => {
        if (r._id === reviewId) {
          const wasLiked = r.isLiked;
          const wasDisliked = r.isDisliked;
          return {
            ...r,
            isLiked: !wasLiked,
            isDisliked: false,
            likesCount: wasLiked ? r.likesCount - 1 : r.likesCount + 1,
            dislikesCount: wasDisliked ? r.dislikesCount - 1 : r.dislikesCount,
          };
        }
        return r;
      })
    );

    try {
      setActionInProgress(true);
      const res = await axios.post(
        `${backendUrl}/api/review/like`,
        { reviewId },
        { headers: { token } }
      );
      if (res.data.success) {
        setReviews((prev) =>
          prev.map((r) =>
            r._id === reviewId
              ? {
                  ...r,
                  likesCount: res.data.likesCount,
                  dislikesCount: res.data.dislikesCount,
                  isLiked: res.data.isLiked,
                  isDisliked: res.data.isDisliked,
                }
              : r
          )
        );
      }
    } catch (err) {
      console.error("Error liking review:", err);
      fetchReviews();
    } finally {
      setActionInProgress(false);
    }
  };

  // Handle Dislike Toggle
  const handleToggleDislike = async (reviewId) => {
    if (!token) {
      toast.info("Please login to rate this review");
      return;
    }
    if (actionInProgress) return;

    // Optimistic UI update
    setReviews((prev) =>
      prev.map((r) => {
        if (r._id === reviewId) {
          const wasLiked = r.isLiked;
          const wasDisliked = r.isDisliked;
          return {
            ...r,
            isDisliked: !wasDisliked,
            isLiked: false,
            dislikesCount: wasDisliked ? r.dislikesCount - 1 : r.dislikesCount + 1,
            likesCount: wasLiked ? r.likesCount - 1 : r.likesCount,
          };
        }
        return r;
      })
    );

    try {
      setActionInProgress(true);
      const res = await axios.post(
        `${backendUrl}/api/review/dislike`,
        { reviewId },
        { headers: { token } }
      );
      if (res.data.success) {
        setReviews((prev) =>
          prev.map((r) =>
            r._id === reviewId
              ? {
                  ...r,
                  likesCount: res.data.likesCount,
                  dislikesCount: res.data.dislikesCount,
                  isLiked: res.data.isLiked,
                  isDisliked: res.data.isDisliked,
                }
              : r
          )
        );
      }
    } catch (err) {
      console.error("Error disliking review:", err);
      fetchReviews();
    } finally {
      setActionInProgress(false);
    }
  };

  // Handle Delete Own Review
  const handleDeleteOwnReview = async (reviewId) => {
    if (!window.confirm("Are you sure you want to delete your review?")) return;
    try {
      const res = await axios.post(
        `${backendUrl}/api/review/delete`,
        { reviewId },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Review deleted successfully");
        fetchReviews();
        checkUserStatus();
        setTitle("");
        setComment("");
        setRating(5);
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Filter reviews by rating if set
  const filteredReviews = filterRating
    ? reviews.filter((r) => r.rating === filterRating)
    : reviews;

  // Render Stars Helper
  const renderStars = (score, sizeClass = "w-4 h-4") => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <svg
          key={i}
          className={`${sizeClass} ${
            i <= score ? "text-amber-400 fill-amber-400" : "text-gray-300 fill-gray-200"
          } transition-colors`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
        >
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      );
    }
    return stars;
  };

  // Format Date Helper
  const formatDate = (timestamp) => {
    if (!timestamp) return "";
    const d = new Date(Number(timestamp));
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Get Initials Helper
  const getInitials = (name) => {
    if (!name) return "U";
    const parts = name.trim().split(" ");
    if (parts.length > 1) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Avatar colors
  const avatarGradients = [
    "from-purple-500 to-indigo-600",
    "from-blue-500 to-cyan-600",
    "from-emerald-500 to-teal-600",
    "from-rose-500 to-pink-600",
    "from-amber-500 to-orange-600",
  ];
  const getGradient = (name) => {
    const charCode = (name || "A").charCodeAt(0);
    return avatarGradients[charCode % avatarGradients.length];
  };

  return (
    <div className="w-full mt-6">
      {/* Ratings Summary Card */}
      <div className="bg-gradient-to-br from-slate-50 to-gray-100 border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          {/* Big Score Block */}
          <div className="md:col-span-4 flex flex-col items-center justify-center text-center md:border-r border-gray-200 md:pr-6">
            <div className="text-5xl sm:text-6xl font-extrabold text-gray-900 tracking-tight">
              {stats.averageRating > 0 ? stats.averageRating : "0.0"}
            </div>
            <div className="flex items-center gap-1 my-2">
              {renderStars(Math.round(stats.averageRating || 0), "w-5 h-5")}
            </div>
            <p className="text-sm text-gray-500 font-medium">
              Based on {stats.totalReviews} verified {stats.totalReviews === 1 ? "review" : "reviews"}
            </p>

            {/* Write Review Trigger Button */}
            <div className="mt-4 w-full sm:w-auto">
              {token ? (
                userStatus.canReview ? (
                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="w-full sm:w-auto bg-black text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-800 transition-all shadow-sm hover:shadow active:scale-95 flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    {userStatus.hasReviewed ? "Edit Your Review" : "Write a Review"}
                  </button>
                ) : (
                  <div className="flex flex-col items-center">
                    <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 text-xs px-3 py-1.5 rounded-full border border-amber-200">
                      <svg className="w-3.5 h-3.5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      Verified buyers only
                    </span>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Purchase this item to leave a review
                    </p>
                  </div>
                )
              ) : (
                <button
                  onClick={() => navigate("/login")}
                  className="w-full sm:w-auto bg-gray-900 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-black transition-all shadow-sm"
                >
                  Sign in to Review
                </button>
              )}
            </div>
          </div>

          {/* Star Distribution Progress Bars */}
          <div className="md:col-span-8 flex flex-col gap-2.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = stats.breakdown[star] || 0;
              const percentage = stats.totalReviews > 0 ? (count / stats.totalReviews) * 100 : 0;
              const isSelected = filterRating === star;

              return (
                <button
                  key={star}
                  onClick={() => setFilterRating(isSelected ? null : star)}
                  className={`flex items-center gap-3 w-full group text-left px-2 py-1 rounded-lg transition-colors ${
                    isSelected ? "bg-amber-50 ring-1 ring-amber-300" : "hover:bg-white/60"
                  }`}
                >
                  <span className="text-xs font-semibold text-gray-700 w-12 flex items-center gap-1">
                    {star} <span className="text-amber-500">★</span>
                  </span>
                  <div className="flex-1 bg-gray-200 h-2.5 rounded-full overflow-hidden">
                    <div
                      className="bg-amber-400 h-full rounded-full transition-all duration-500 ease-out group-hover:bg-amber-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-12 text-right tabular-nums">
                    {count} ({Math.round(percentage)}%)
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filter & Sorting Controls Bar */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
        {/* Filter Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilterRating(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filterRating === null
                ? "bg-black text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All Reviews ({stats.totalReviews})
          </button>
          {[5, 4, 3, 2, 1].map((star) => (
            <button
              key={star}
              onClick={() => setFilterRating(filterRating === star ? null : star)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1 ${
                filterRating === star
                  ? "bg-amber-500 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {star} ★ ({stats.breakdown[star] || 0})
            </button>
          ))}
          {filterRating && (
            <button
              onClick={() => setFilterRating(null)}
              className="text-xs text-red-600 hover:underline ml-1"
            >
              Clear filter
            </button>
          )}
        </div>

        {/* Sort Options */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500 font-medium">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-700 bg-white font-medium focus:outline-none focus:ring-1 focus:ring-black cursor-pointer shadow-sm"
          >
            <option value="likes">Most Helpful</option>
            <option value="recent">Newest First</option>
            <option value="rating_high">Highest Rating</option>
            <option value="rating_low">Lowest Rating</option>
          </select>
        </div>
      </div>

      {/* Reviews List */}
      <div className="mt-6 flex flex-col gap-4">
        {loading ? (
          <div className="py-12 flex justify-center items-center">
            <div className="w-8 h-8 border-3 border-gray-300 border-t-black rounded-full animate-spin"></div>
          </div>
        ) : filteredReviews.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-gray-300 rounded-2xl bg-gray-50/50">
            <div className="w-12 h-12 mx-auto bg-gray-100 rounded-full flex items-center justify-center text-gray-400 mb-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h4 className="text-base font-semibold text-gray-800">
              {filterRating ? `No ${filterRating}-star reviews yet` : "No customer reviews yet"}
            </h4>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              {filterRating
                ? "Try selecting another star rating or viewing all reviews."
                : "Be the first verified customer to share your thoughts on this product!"}
            </p>
          </div>
        ) : (
          filteredReviews.map((review) => {
            const isTopReview = review.likesCount >= 3;

            return (
              <div
                key={review._id}
                className="bg-white border border-gray-100 hover:border-gray-300/80 rounded-xl p-5 sm:p-6 transition-all duration-200 shadow-sm hover:shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* User info & Stars */}
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full bg-gradient-to-tr ${getGradient(
                        review.userName
                      )} text-white font-bold flex items-center justify-center text-sm shadow-inner`}
                    >
                      {getInitials(review.userName)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-gray-900">
                          {review.userName}
                        </span>
                        {review.verified && (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-emerald-200">
                            <svg className="w-3 h-3 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Verified Buyer
                          </span>
                        )}
                        {isTopReview && (
                          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-amber-200">
                            Top Review
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-0.5">
                          {renderStars(review.rating, "w-3.5 h-3.5")}
                        </div>
                        <span className="text-[11px] text-gray-400">
                          • {formatDate(review.date)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Delete Button (If Owner) */}
                  {review.isOwner && (
                    <button
                      onClick={() => handleDeleteOwnReview(review._id)}
                      className="text-xs text-gray-400 hover:text-red-600 transition-colors p-1"
                      title="Delete your review"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Review Title & Body */}
                <div className="mt-3.5 pl-0 sm:pl-[52px]">
                  {review.title && (
                    <h5 className="font-semibold text-sm text-gray-900 mb-1">
                      {review.title}
                    </h5>
                  )}
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                    {review.comment}
                  </p>

                  {/* Helpful Voting Bar (Likes & Dislikes) */}
                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                    <span className="text-[11px] text-gray-400">
                      Was this review helpful?
                    </span>
                    <div className="flex items-center gap-2">
                      {/* Like Button */}
                      <button
                        onClick={() => handleToggleLike(review._id)}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all active:scale-95 ${
                          review.isLiked
                            ? "bg-blue-50 border-blue-300 text-blue-700 shadow-sm"
                            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <svg
                          className={`w-3.5 h-3.5 ${review.isLiked ? "fill-blue-600 text-blue-600" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                        </svg>
                        <span>{review.likesCount}</span>
                      </button>

                      {/* Dislike Button */}
                      <button
                        onClick={() => handleToggleDislike(review._id)}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all active:scale-95 ${
                          review.isDisliked
                            ? "bg-rose-50 border-rose-300 text-rose-700 shadow-sm"
                            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <svg
                          className={`w-3.5 h-3.5 ${review.isDisliked ? "fill-rose-600 text-rose-600" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76 1.04m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                        </svg>
                        <span>{review.dislikesCount}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <Pagination
          page={pagination?.page || page}
          totalPages={pagination?.totalPages || 0}
          total={pagination?.total || 0}
          onPageChange={handlePageChange}
          loading={loading}
        />
      </div>

      {/* Write / Edit Review Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl border border-gray-100 animate-scaleUp">
            {/* Modal Header */}
            <div className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold">
                  {userStatus.hasReviewed ? "Update Your Review" : "Write a Customer Review"}
                </h3>
                <p className="text-xs text-gray-300 truncate max-w-xs">{productName}</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-white transition-colors p-1 rounded-full hover:bg-gray-800"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmitReview} className="p-6 flex flex-col gap-4">
              {/* Star Rating Picker */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                  Overall Rating *
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        type="button"
                        key={star}
                        onClick={() => setRating(star)}
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(0)}
                        className="p-1 focus:outline-none transition-transform hover:scale-110"
                      >
                        <svg
                          className={`w-7 h-7 ${
                            star <= (hoverRating || rating)
                              ? "text-amber-400 fill-amber-400"
                              : "text-gray-300 fill-gray-200"
                          } transition-colors`}
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                        </svg>
                      </button>
                    ))}
                  </div>
                  <span className="text-sm font-semibold text-amber-600 ml-2">
                    {STAR_LABELS[hoverRating || rating]}
                  </span>
                </div>
              </div>

              {/* Review Title Input */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Headline / Title (Optional)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Excellent fabric quality and true to size!"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black transition-all"
                  maxLength={100}
                />
              </div>

              {/* Review Comment Textarea */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Detailed Review *
                  </label>
                  <span className="text-[11px] text-gray-400">{comment.length} / 1000</span>
                </div>
                <textarea
                  rows={4}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="What did you like or dislike about this product? How is the fitting, material, and comfort?"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black transition-all resize-none"
                  maxLength={1000}
                  required
                />
              </div>

              {/* Verified Badge Notice */}
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center gap-2.5 text-xs text-emerald-800">
                <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>You are submitting as a <strong>Verified Buyer</strong> of this product.</span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-black text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-800 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm"
                >
                  {submitting && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  )}
                  {userStatus.hasReviewed ? "Update Review" : "Submit Review"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewSection;
