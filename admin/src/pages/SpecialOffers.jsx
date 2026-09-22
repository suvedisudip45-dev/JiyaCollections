/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";

const SpecialOffers = ({ token }) => {
  const [offers, setOffers] = useState([]);
  const [productsList, setProductsList] = useState([]);
  const [loading, setLoading] = useState(false);

  // Form State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [badgeText, setBadgeText] = useState("FESTIVE OFFER");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [discount, setDiscount] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [isActive, setIsActive] = useState(true);
  const [searchProduct, setSearchProduct] = useState("");

  const fetchOffersAndProducts = async () => {
    setLoading(true);
    try {
      const [offersRes, prodsRes] = await Promise.all([
        axios.get(backendUrl + "/api/offer/list", { headers: { token } }),
        axios.get(backendUrl + "/api/product/list", { headers: { token } }),
      ]);

      if (offersRes.data.success) {
        setOffers(offersRes.data.offers || []);
      }
      if (prodsRes.data.success) {
        setProductsList(prodsRes.data.products || []);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load offers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOffersAndProducts();
  }, []);

  const openNewModal = () => {
    setEditingId(null);
    setTitle("");
    setSubtitle("Special holiday discounts and limited-time festive deals");
    setBadgeText("FESTIVE OFFER");
    const now = new Date();
    const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    setStartDate(now.toISOString().slice(0, 16));
    setEndDate(inAWeek.toISOString().slice(0, 16));
    setDiscount("");
    setSelectedProductIds([]);
    setIsActive(true);
    setShowModal(true);
  };

  const openEditModal = (offer) => {
    setEditingId(offer.id);
    setTitle(offer.title ? offer.title.replace(/🎉|✨|🎁|🔥/g, "").trim() : "");
    setSubtitle(offer.subtitle || "");
    setBadgeText(offer.badgeText ? offer.badgeText.replace(/🎉|✨|🎁|🔥/g, "").trim() : "FESTIVE OFFER");
    setStartDate(offer.startDate ? new Date(offer.startDate).toISOString().slice(0, 16) : "");
    setEndDate(offer.endDate ? new Date(offer.endDate).toISOString().slice(0, 16) : "");
    setDiscount(offer.discount || "");
    let pIds = [];
    try {
      pIds = Array.isArray(offer.productIds) ? offer.productIds : JSON.parse(offer.productIds);
    } catch {
      pIds = [];
    }
    setSelectedProductIds(pIds);
    setIsActive(offer.isActive !== undefined ? offer.isActive : true);
    setShowModal(true);
  };

  const toggleProductSelect = (id) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((pId) => pId !== id) : [...prev, id]
    );
  };

  const selectAllProducts = () => {
    setSelectedProductIds(productsList.map((p) => p._id || p.id));
  };

  const clearSelectedProducts = () => {
    setSelectedProductIds([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title || !startDate || !endDate) {
      toast.error("Please fill in campaign title, start date, and end date.");
      return;
    }

    if (new Date(endDate) <= new Date(startDate)) {
      toast.error("End date must be after start date.");
      return;
    }

    if (discount !== "" && discount !== null && discount !== undefined) {
      const numDiscount = Number(discount);
      if (isNaN(numDiscount) || numDiscount < 0 || numDiscount > 100) {
        toast.error("Discount percentage must be between 0% and 100%.");
        return;
      }
    }

    try {
      const payload = {
        id: editingId,
        title: title.trim(),
        subtitle: subtitle.trim(),
        badgeText: badgeText.trim(),
        startDate,
        endDate,
        discount: discount ? Number(discount) : 0,
        productIds: selectedProductIds,
        isActive,
      };

      const url = editingId ? "/api/offer/update" : "/api/offer/create";
      const res = await axios.post(backendUrl + url, payload, { headers: { token } });

      if (res.data.success) {
        toast.success(res.data.message || "Offer campaign saved!");
        setShowModal(false);
        fetchOffersAndProducts();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Failed to save offer");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this festival offer?")) return;
    try {
      const res = await axios.post(backendUrl + "/api/offer/delete", { id }, { headers: { token } });
      if (res.data.success) {
        toast.success("Offer campaign deleted.");
        fetchOffersAndProducts();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error("Error deleting offer");
    }
  };

  const getCampaignStatus = (offer) => {
    if (!offer.isActive) {
      return { label: "Disabled", color: "bg-gray-100 text-gray-700 border-gray-300" };
    }
    const now = new Date();
    const start = new Date(offer.startDate);
    const end = new Date(offer.endDate);

    if (now < start) {
      return { label: "Scheduled", color: "bg-amber-50 text-amber-800 border-amber-300" };
    }
    if (now >= start && now <= end) {
      return { label: "Active Now", color: "bg-emerald-50 text-emerald-800 border-emerald-300 font-bold" };
    }
    return { label: "Expired", color: "bg-rose-50 text-rose-700 border-rose-200" };
  };

  const filteredProducts = productsList.filter((p) =>
    p.name.toLowerCase().includes(searchProduct.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gradient-to-r from-red-50 via-rose-50 to-amber-50 p-6 rounded-2xl border border-red-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-600 text-white flex items-center justify-center shadow-xs">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-red-950">Festival &amp; Special Offers</h1>
          </div>
          <p className="text-xs sm:text-sm text-red-800/80 mt-1 max-w-xl">
            Create automated holiday promotions (Dashain, Tihar, Festive Deals) with bright celebratory themes, live countdowns, and auto-expiry.
          </p>
        </div>
        <button
          onClick={openNewModal}
          className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs sm:text-sm px-5 py-2.5 rounded-xl shadow-xs transition-all"
        >
          + Create Festival Offer
        </button>
      </div>

      {/* Campaigns List */}
      <div className="space-y-4">
        {loading ? (
          <p className="text-sm text-gray-500 py-6 text-center">Loading campaigns...</p>
        ) : offers.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
            <svg className="w-10 h-10 text-gray-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
            </svg>
            <p className="text-sm font-semibold text-gray-700 mt-2">No Special Offers Created Yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Click &quot;+ Create Festival Offer&quot; to launch a new time-limited festival campaign.
            </p>
          </div>
        ) : (
          offers.map((offer) => {
            const status = getCampaignStatus(offer);
            let pIds = [];
            try {
              pIds = Array.isArray(offer.productIds) ? offer.productIds : JSON.parse(offer.productIds);
            } catch {
              pIds = [];
            }

            return (
              <div
                key={offer.id}
                className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs hover:border-gray-300 transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full border ${status.color}`}>
                      {status.label}
                    </span>
                    <span className="text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-md uppercase">
                      {offer.badgeText ? offer.badgeText.replace(/🎉|✨|🎁|🔥/g, "").trim() || "FESTIVE OFFER" : "FESTIVE OFFER"}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900">
                    {offer.title.replace(/🎉|✨|🎁|🔥/g, "").trim()}
                  </h3>
                  <p className="text-xs text-gray-500">{offer.subtitle}</p>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600 pt-1">
                    <span>
                      <b>Start:</b> {new Date(offer.startDate).toLocaleString()}
                    </span>
                    <span>
                      <b>End:</b> {new Date(offer.endDate).toLocaleString()}
                    </span>
                    <span>
                      <b>{pIds.length}</b> Products participating
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end md:self-auto">
                  <button
                    onClick={() => openEditModal(offer)}
                    className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(offer.id)}
                    className="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg border border-rose-200 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal for Create/Edit */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl border">
            <div className="flex justify-between items-center pb-3 border-b">
              <h2 className="text-lg font-bold text-gray-900">
                {editingId ? "Edit Festival Campaign" : "Create Festival Special Offer"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-black text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 pt-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Campaign Title * (e.g. Dashain &amp; Tihar Special Offer)
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Festive Collection Offer"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:border-black focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Subtitle / Promo Description
                </label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="Special festive discounts and limited-time holiday bundles"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:border-black focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Badge Tagline
                  </label>
                  <input
                    type="text"
                    value={badgeText}
                    onChange={(e) => setsetBadgeText(e.target.value)}
                    placeholder="FESTIVE OFFER"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:border-black focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Campaign Status
                  </label>
                  <select
                    value={isActive ? "true" : "false"}
                    onChange={(e) => setIsActive(e.target.value === "true")}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="true">Enabled (Runs during schedule)</option>
                    <option value="false">Disabled / Paused</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Start Date &amp; Time *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    End Date &amp; Time * (Auto-Expires)
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded-lg text-xs"
                  />
                </div>
              </div>

              {/* Select Participating Products */}
              <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <div>
                    <p className="text-xs font-bold text-gray-800">
                      Participating Products ({selectedProductIds.length} selected)
                    </p>
                    <p className="text-[11px] text-gray-500">
                      Select which products are included in this offer.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={selectAllProducts}
                      className="text-[11px] font-semibold text-indigo-600 hover:underline"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={clearSelectedProducts}
                      className="text-[11px] font-semibold text-gray-500 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <input
                  type="text"
                  placeholder="Filter products to add..."
                  value={searchProduct}
                  onChange={(e) => setSearchProduct(e.target.value)}
                  className="w-full px-3 py-1.5 border rounded-lg text-xs"
                />

                <div className="max-h-48 overflow-y-auto space-y-1.5 border rounded-lg p-2 bg-gray-50">
                  {filteredProducts.map((p) => {
                    const isSelected = selectedProductIds.includes(p._id || p.id);
                    return (
                      <label
                        key={p._id || p.id}
                        className={`flex items-center gap-2.5 p-1.5 rounded cursor-pointer transition-colors ${
                          isSelected ? "bg-amber-50 border border-amber-200" : "hover:bg-gray-100"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleProductSelect(p._id || p.id)}
                          className="accent-amber-600 cursor-pointer"
                        />
                        <img
                          src={p.image && p.image[0]}
                          alt=""
                          className="w-8 h-8 object-cover rounded"
                        />
                        <div className="flex-1 truncate text-xs">
                          <span className="font-semibold text-gray-800">{p.name}</span>
                          <span className="text-gray-400 ml-2">
                            ({currency}{p.price})
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-black hover:bg-gray-800 text-white rounded-xl text-xs font-bold"
                >
                  {editingId ? "Save Changes" : "Launch Campaign"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpecialOffers;
