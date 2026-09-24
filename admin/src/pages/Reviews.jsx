/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { backendUrl } from "../App";
import { toast } from "react-toastify";
import Pagination from "../components/Pagination";

const Reviews = ({ token }) => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [deletingId, setDeletingId] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/review/admin/list?page=${page}&limit=10`, {
        headers: { token },
      });
      if (res.data.success) {
        setReviews(res.data.reviews || []);
        setPagination(res.data.pagination || null);
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, [token, page]);

  const handlePageChange = (nextPage) => setPage(nextPage);

  const handleDeleteReview = async (reviewId) => {
    if (
      !window.confirm(
        "Are you sure you want to permanently remove this review? This action cannot be undone."
      )
    ) {
      return;
    }

    try {
      setDeletingId(reviewId);
      const res = await axios.post(
        `${backendUrl}/api/review/admin/delete`,
        { reviewId },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(res.data.message || "Review removed successfully");
        setReviews((prev) => prev.filter((r) => r._id !== reviewId));
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  // Filter reviews
  const filteredReviews = reviews.filter((item) => {
    const matchesSearch =
      (item.productName &&
        item.productName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.userName &&
        item.userName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.userEmail &&
        item.userEmail.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.comment &&
        item.comment.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.title && item.title.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesRating =
      ratingFilter === "all" || item.rating === Number(ratingFilter);

    return matchesSearch && matchesRating;
  });

  // Calculate stats
  const totalCount = reviews.length;
  const avgRating =
    totalCount > 0
      ? (
          reviews.reduce((acc, curr) => acc + curr.rating, 0) / totalCount
        ).toFixed(1)
      : "0.0";
  const fiveStarCount = reviews.filter((r) => r.rating === 5).length;
  const lowRatingCount = reviews.filter((r) => r.rating <= 2).length;

  const renderStars = (count) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <span
          key={i}
          className={`text-sm ${
            i <= count ? "text-amber-400" : "text-gray-300"
          }`}
        >
          ★
        </span>
      );
    }
    return stars;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "-";
    const d = new Date(Number(timestamp));
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="w-full pb-10">
      {/* Title & Description */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Customer Reviews & Moderation</h2>
        <p className="text-xs text-gray-500 mt-1">
          Monitor customer feedback, verify authenticity, and moderate or remove inappropriate reviews.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase">Total Reviews</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalCount}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase">Avg Store Rating</p>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-2xl font-bold text-gray-900">{avgRating}</span>
            <span className="text-amber-400 text-lg">★</span>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-emerald-600 uppercase">5-Star Ratings</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{fiveStarCount}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-rose-500 uppercase">Low Ratings (1-2★)</p>
          <p className="text-2xl font-bold text-rose-600 mt-1">{lowRatingCount}</p>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm mb-6 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <input
            type="text"
            placeholder="Search by product, user, or review text..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-black"
          />
          <svg
            className="w-4 h-4 text-gray-400 absolute left-3 top-2.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs text-gray-500 whitespace-nowrap">Filter Rating:</label>
          <select
            value={ratingFilter}
            onChange={(e) => setRatingFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-xs bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-black cursor-pointer"
          >
            <option value="all">All Stars</option>
            <option value="5">5 Stars ★</option>
            <option value="4">4 Stars ★</option>
            <option value="3">3 Stars ★</option>
            <option value="2">2 Stars ★</option>
            <option value="1">1 Star ★</option>
          </select>
        </div>
      </div>

      {/* Reviews Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center items-center">
            <div className="w-8 h-8 border-3 border-gray-300 border-t-black rounded-full animate-spin"></div>
          </div>
        ) : filteredReviews.length === 0 ? (
          <div className="py-16 text-center text-gray-500">
            <p className="text-sm font-medium">No reviews found matching your filter criteria.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-600 font-semibold uppercase tracking-wider">
                  <th className="py-3.5 px-4">Product</th>
                  <th className="py-3.5 px-4">Customer</th>
                  <th className="py-3.5 px-4">Rating & Review</th>
                  <th className="py-3.5 px-4 text-center">Helpful Votes</th>
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredReviews.map((item) => (
                  <tr key={item._id} className="hover:bg-gray-50/60 transition-colors">
                    {/* Product */}
                    <td className="py-4 px-4 max-w-[180px]">
                      <div className="flex items-center gap-3">
                        {item.productImage ? (
                          <img
                            src={item.productImage}
                            alt=""
                            className="w-10 h-10 object-cover rounded border border-gray-200 flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-gray-100 rounded border border-gray-200 flex items-center justify-center text-gray-400 text-[10px] flex-shrink-0">
                            No Img
                          </div>
                        )}
                        <div className="truncate">
                          <p className="font-semibold text-gray-900 truncate" title={item.productName}>
                            {item.productName}
                          </p>
                          <p className="text-[10px] text-gray-400">{item.productCategory || "Product"}</p>
                        </div>
                      </div>
                    </td>

                    {/* Customer */}
                    <td className="py-4 px-4 whitespace-nowrap">
                      <p className="font-semibold text-gray-900">{item.userName}</p>
                      <p className="text-[11px] text-gray-400">{item.userEmail}</p>
                      {item.verified && (
                        <span className="inline-block mt-0.5 bg-emerald-50 text-emerald-700 text-[9px] font-semibold px-1.5 py-0.2 rounded border border-emerald-200">
                          ✓ Verified Buyer
                        </span>
                      )}
                    </td>

                    {/* Rating & Review */}
                    <td className="py-4 px-4 max-w-[320px]">
                      <div className="flex items-center gap-1 mb-1">
                        {renderStars(item.rating)}
                        <span className="font-semibold text-gray-700 ml-1">{item.rating}/5</span>
                      </div>
                      {item.title && (
                        <p className="font-semibold text-gray-800 text-xs mb-0.5">{item.title}</p>
                      )}
                      <p className="text-gray-600 line-clamp-3 leading-relaxed">{item.comment}</p>
                    </td>

                    {/* Helpful Votes */}
                    <td className="py-4 px-4 text-center whitespace-nowrap">
                      <div className="inline-flex items-center gap-3 text-xs">
                        <span className="text-blue-600 font-medium" title="Likes">
                          👍 {item.likesCount}
                        </span>
                        <span className="text-rose-600 font-medium" title="Dislikes">
                          👎 {item.dislikesCount}
                        </span>
                      </div>
                    </td>

                    {/* Date */}
                    <td className="py-4 px-4 whitespace-nowrap text-gray-500">
                      {formatDate(item.date)}
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-4 text-center whitespace-nowrap">
                      <button
                        onClick={() => handleDeleteReview(item._id)}
                        disabled={deletingId === item._id}
                        className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 hover:border-rose-300 font-medium px-3 py-1.5 rounded-lg text-xs transition-all active:scale-95 disabled:opacity-50 inline-flex items-center gap-1"
                        title="Remove inappropriate review"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>Remove</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={pagination?.page || page}
          totalPages={pagination?.totalPages || 0}
          total={pagination?.total || 0}
          onPageChange={handlePageChange}
          loading={loading}
        />
      </div>
    </div>
  );
};

export default Reviews;
