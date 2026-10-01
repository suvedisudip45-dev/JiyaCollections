/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";

const PRESET_ICONS = ["🥉", "🥈", "🥇", "💎", "👑", "⭐", "🎁", "🔥", "🚀", "🌟", "🎖️", "🏆"];
const PRESET_COLORS = ["#CD7F32", "#94A3B8", "#F59E0B", "#3B82F6", "#8B5CF6", "#EC4899", "#10B981", "#1E293B"];

const LoyaltyLevels = ({ token }) => {
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form State
  const [form, setForm] = useState({
    id: "",
    levelNumber: 1,
    name: "",
    badgeIcon: "🥉",
    color: "#CD7F32",
    minSpend: 0,
    minOrders: 0,
    rewardType: "COMBO",
    rewardTitle: "",
    rewardDescription: "",
    rewardOrderLimit: 3,
    freeShipping: false,
    discountAmount: 0,
    giftAmount: 0,
    giftDescription: "",
    letterIncluded: false,
    customPerk: "",
  });

  const fetchLevels = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/loyalty/levels`);
      if (res.data.success) {
        setLevels(res.data.levels || []);
      } else {
        toast.error(res.data.message || "Failed to load levels");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error loading loyalty levels");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLevels();
  }, []);

  const handleStartAdd = () => {
    const nextNum = levels.length > 0 ? Math.max(...levels.map((l) => l.levelNumber)) + 1 : 1;
    setForm({
      id: "",
      levelNumber: nextNum,
      name: `Level ${nextNum} VIP`,
      badgeIcon: PRESET_ICONS[nextNum % PRESET_ICONS.length] || "⭐",
      color: PRESET_COLORS[nextNum % PRESET_COLORS.length] || "#3B82F6",
      minSpend: nextNum * 4000,
      minOrders: nextNum * 2,
      rewardType: "COMBO",
      rewardTitle: `Rs. ${nextNum * 50} Off on Next 3 Orders`,
      rewardDescription: "Special discount on next 3 orders + handwritten thank you note.",
      rewardOrderLimit: 3,
      freeShipping: nextNum >= 3,
      discountAmount: nextNum * 50,
      giftAmount: 0,
      giftDescription: "",
      letterIncluded: true,
      customPerk: "",
    });
    setIsEditing(true);
  };

  const handleStartEdit = (lvl) => {
    setForm({
      id: lvl.id,
      levelNumber: lvl.levelNumber,
      name: lvl.name,
      badgeIcon: lvl.badgeIcon || "⭐",
      color: lvl.color || "#3B82F6",
      minSpend: lvl.minSpend || 0,
      minOrders: lvl.minOrders || 0,
      rewardType: lvl.rewardType || "COMBO",
      rewardTitle: lvl.rewardTitle || "",
      rewardDescription: lvl.rewardDescription || "",
      rewardOrderLimit: lvl.rewardOrderLimit || 3,
      freeShipping: Boolean(lvl.freeShipping || lvl.rewardType === "FREE_SHIPPING" || lvl.rewardType === "FREE_SHIPPING_AND_DISCOUNT"),
      discountAmount: lvl.discountAmount || (lvl.rewardType === "DISCOUNT_AMOUNT" || lvl.rewardType === "FREE_SHIPPING_AND_DISCOUNT" ? lvl.rewardValue : 0) || 0,
      giftAmount: lvl.giftAmount || 0,
      giftDescription: lvl.giftDescription || "",
      letterIncluded: Boolean(lvl.letterIncluded || lvl.rewardType === "HANDWRITTEN_LETTER"),
      customPerk: lvl.customPerk || "",
    });
    setIsEditing(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.rewardTitle.trim()) {
      toast.error("Please fill in level name and reward title");
      return;
    }
    if ((Number(form.giftAmount) > 0) !== Boolean(form.giftDescription.trim())) {
      toast.error("Set both a gift product description and its maximum value, or leave both empty.");
      return;
    }

    try {
      setSaving(true);
      const res = await axios.post(`${backendUrl}/api/loyalty/level`, form, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success(res.data.message || "Level saved successfully");
        setIsEditing(false);
        fetchLevels();
      } else {
        toast.error(res.data.message || "Failed to save level");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error saving level");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this level?")) return;
    try {
      const res = await axios.delete(`${backendUrl}/api/loyalty/level/${id}`, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success("Level removed");
        fetchLevels();
      } else {
        toast.error(res.data.message || "Failed to delete");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error deleting level");
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
            <span>🏆</span> Loyalty & Purchase Levels Config
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Configure gamified customer purchase levels, minimum spend and order requirements, and level rewards.
          </p>
        </div>

        <button
          type="button"
          onClick={handleStartAdd}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-2 self-start sm:self-auto"
        >
          <span>➕</span> Add New Level
        </button>
      </div>

      {/* Level List Grid */}
      {loading ? (
        <div className="p-12 text-center text-gray-400 bg-white rounded-2xl border border-gray-200">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs font-semibold">Loading loyalty tiers...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {levels.map((lvl) => (
            <div
              key={lvl.id}
              className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden"
            >
              <div
                className="absolute top-0 left-0 right-0 h-1.5"
                style={{ backgroundColor: lvl.color || "#3B82F6" }}
              />

              <div>
                <div className="flex items-center justify-between mt-1 mb-3">
                  <span
                    className="text-2xl w-10 h-10 rounded-xl flex items-center justify-center border shadow-xs"
                    style={{
                      backgroundColor: `${lvl.color}15`,
                      borderColor: `${lvl.color}30`,
                    }}
                  >
                    {lvl.badgeIcon || "⭐"}
                  </span>
                  <span
                    className="text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${lvl.color}20`,
                      color: lvl.color,
                    }}
                  >
                    Level {lvl.levelNumber}
                  </span>
                </div>

                <h3 className="text-base font-black text-gray-900">{lvl.name}</h3>

                {/* Qualification Criteria */}
                <div className="mt-3 bg-gray-50 p-2.5 rounded-xl border border-gray-100 space-y-1 text-xs">
                  <div className="flex justify-between text-gray-600">
                    <span className="text-[11px] text-gray-400 font-semibold uppercase">Min Total Spend:</span>
                    <strong className="text-gray-900">{currency}{Number(lvl.minSpend).toLocaleString()}</strong>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span className="text-[11px] text-gray-400 font-semibold uppercase">Min Orders Count:</span>
                    <strong className="text-gray-900">{lvl.minOrders} order(s)</strong>
                  </div>
                </div>

                {/* Level Rewards */}
                <div className="mt-3 p-2.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">🎁 Level Reward / Perks</p>
                    <span className="text-[10px] font-extrabold px-1.5 py-0.5 bg-amber-200 text-amber-900 rounded">
                      Next {lvl.rewardOrderLimit || 3} Orders
                    </span>
                  </div>
                  <p className="font-bold text-gray-900 mt-1">{lvl.rewardTitle}</p>
                  {lvl.rewardDescription && (
                    <p className="text-[11px] text-gray-600 mt-1 line-clamp-2">{lvl.rewardDescription}</p>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => handleStartEdit(lvl)}
                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-xs transition-colors"
                >
                  Edit
                </button>
                {levels.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDelete(lvl.id)}
                    className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-lg text-xs transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {isEditing && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
              <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                <span>{form.id ? "✏️ Edit Loyalty Level" : "➕ Create New Loyalty Level"}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-4 text-xs">
              {/* Live Preview Bar */}
              <div
                className="p-4 rounded-xl text-white shadow-md flex items-center justify-between"
                style={{
                  background: `linear-gradient(135deg, #111827 0%, ${form.color} 100%)`,
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{form.badgeIcon}</span>
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-widest text-white/70">
                      Level {form.levelNumber}
                    </span>
                    <h4 className="text-base font-black">{form.name || "Untitled Level"}</h4>
                    <p className="text-[11px] text-white/90">🎁 {form.rewardTitle || "Reward Title"}</p>
                  </div>
                </div>

                <div className="text-right text-[11px] bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
                  <p>Min Spend: <strong>{currency}{Number(form.minSpend).toLocaleString()}</strong></p>
                  <p>Min Orders: <strong>{form.minOrders}</strong></p>
                </div>
              </div>

              {/* Form Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                    Level Number *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={form.levelNumber}
                    onChange={(e) => setForm({ ...form, levelNumber: Number(e.target.value) })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:border-indigo-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                    Level Name *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Silver VIP, Gold Champion"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:border-indigo-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* Badge Icon & Color Picker */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                    Badge Emoji / Icon
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_ICONS.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        onClick={() => setForm({ ...form, badgeIcon: icon })}
                        className={`w-8 h-8 rounded-lg text-sm flex items-center justify-center border transition-all ${
                          form.badgeIcon === icon
                            ? "border-indigo-600 bg-indigo-50 scale-110 shadow-xs"
                            : "border-gray-200 hover:bg-gray-100"
                        }`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                    Theme Color
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm({ ...form, color: c })}
                        className={`w-6 h-6 rounded-full border-2 transition-transform ${
                          form.color === c ? "scale-125 border-black shadow" : "border-transparent"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) => setForm({ ...form, color: e.target.value })}
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Threshold Requirements */}
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
                <p className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                  <span>🎯</span> Level Achievement Requirements (Both Must Be Met)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                      Minimum Total Purchases ({currency})
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={form.minSpend}
                      onChange={(e) => setForm({ ...form, minSpend: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl text-xs focus:border-indigo-600 focus:outline-none"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Total lifetime spend needed across all orders.</p>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                      Minimum Total Orders Count
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={form.minOrders}
                      onChange={(e) => setForm({ ...form, minOrders: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl text-xs focus:border-indigo-600 focus:outline-none"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Total number of completed orders required.</p>
                  </div>
                </div>
              </div>

              {/* Modular Rewards & Perks Configuration Builder */}
              <div className="p-4 bg-amber-50/70 rounded-xl border border-amber-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-amber-900 text-xs flex items-center gap-1.5">
                      <span>🎁</span> Custom Reward & Perk Combination Builder
                    </p>
                    <p className="text-[11px] text-amber-800">
                      Configure discounts, delivery, a physical gift allowance, and handwritten letters.
                    </p>
                  </div>

                  {/* Preset Dropdown */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-gray-500 uppercase">Quick Preset:</span>
                    <select
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) return;
                        if (val === "NONE") {
                          setForm((prev) => ({
                            ...prev,
                            freeShipping: false,
                            discountAmount: 0,
                            giftAmount: 0,
                            giftDescription: "",
                            letterIncluded: false,
                            customPerk: "",
                            rewardTitle: "Entry Level (No Perks)",
                            rewardDescription: "Welcome tier. Place more orders to unlock discounts and perks.",
                          }));
                        } else if (val === "FREE_DELIVERY_ONLY") {
                          setForm((prev) => ({
                            ...prev,
                            freeShipping: true,
                            discountAmount: 0,
                            giftAmount: 0,
                            giftDescription: "",
                            letterIncluded: false,
                            customPerk: "",
                            rewardTitle: "Free Delivery on Next 3 Orders",
                            rewardDescription: "Enjoy 100% free delivery on your next 3 purchases.",
                          }));
                        } else if (val === "DISCOUNT_100") {
                          setForm((prev) => ({
                            ...prev,
                            freeShipping: false,
                            discountAmount: 100,
                            giftAmount: 0,
                            giftDescription: "",
                            letterIncluded: true,
                            customPerk: "",
                            rewardTitle: "Rs. 100 Off + Handwritten Note",
                            rewardDescription: "Rs. 100 flat discount on your next 3 orders + personalized letter.",
                          }));
                        } else if (val === "DISCOUNT_150") {
                          setForm((prev) => ({
                            ...prev,
                            freeShipping: false,
                            discountAmount: 150,
                            giftAmount: 0,
                            giftDescription: "",
                            letterIncluded: true,
                            customPerk: "",
                            rewardTitle: "Rs. 150 Off on Next 3 Orders",
                            rewardDescription: "Rs. 150 flat discount on your next 3 orders.",
                          }));
                        } else if (val === "FREE_DELIVERY_AND_100") {
                          setForm((prev) => ({
                            ...prev,
                            freeShipping: true,
                            discountAmount: 100,
                            giftAmount: 0,
                            giftDescription: "",
                            letterIncluded: true,
                            customPerk: "",
                            rewardTitle: "Free Delivery + Rs. 100 Off",
                            rewardDescription: "Free shipping and Rs. 100 off on next 3 orders + thank you letter.",
                          }));
                        } else if (val === "FREE_DELIVERY_AND_150") {
                          setForm((prev) => ({
                            ...prev,
                            freeShipping: true,
                            discountAmount: 150,
                            giftAmount: 0,
                            giftDescription: "",
                            letterIncluded: true,
                            customPerk: "",
                            rewardTitle: "Free Delivery + Rs. 150 Off",
                            rewardDescription: "Free shipping and Rs. 150 off on next 3 orders + thank you letter.",
                          }));
                        } else if (val === "FREE_DELIVERY_AND_200_GIFT") {
                          setForm((prev) => ({
                            ...prev,
                            freeShipping: true,
                            discountAmount: 200,
                            giftAmount: 500,
                            giftDescription: "Loyalty gift",
                            letterIncluded: true,
                            customPerk: "VIP Priority Dispatch",
                            rewardTitle: "Free Delivery + Rs. 200 Off + Gift up to Rs. 500",
                            rewardDescription: "VIP combo with free delivery, Rs. 200 off, a physical hub gift up to Rs. 500, and a letter.",
                          }));
                        }
                      }}
                      className="px-2.5 py-1 text-xs bg-white border border-amber-300 rounded-lg text-gray-700 font-semibold focus:outline-none focus:border-indigo-600"
                      defaultValue=""
                    >
                      <option value="" disabled>Choose a Combination Preset...</option>
                      <option value="NONE">1. None / Bronze (No Perks)</option>
                      <option value="FREE_DELIVERY_ONLY">2. Free Delivery Only</option>
                      <option value="DISCOUNT_100">3. Rs. 100 Off + Note</option>
                      <option value="DISCOUNT_150">4. Rs. 150 Off Only</option>
                      <option value="FREE_DELIVERY_AND_100">5. Free Delivery + Rs. 100 Off</option>
                      <option value="FREE_DELIVERY_AND_150">6. Free Delivery + Rs. 150 Off</option>
                      <option value="FREE_DELIVERY_AND_200_GIFT">7. Free Delivery + Rs. 200 Off + Gift up to Rs. 500</option>
                    </select>
                  </div>
                </div>

                {/* Grid of Modular Perks */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Perk 1: Free Delivery */}
                  <label className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                    form.freeShipping ? "bg-emerald-50 border-emerald-300 ring-1 ring-emerald-200" : "bg-white border-gray-200 hover:bg-gray-50"
                  }`}>
                    <input
                      type="checkbox"
                      checked={form.freeShipping}
                      onChange={(e) => setForm({ ...form, freeShipping: e.target.checked })}
                      className="mt-0.5 w-4 h-4 rounded text-emerald-600 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-gray-900 text-xs flex items-center gap-1">
                        <span>🚚</span> Free Delivery
                      </span>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        Zeros the courier fee for the customer on eligible orders.
                      </p>
                    </div>
                  </label>

                  {/* Perk 2: Handwritten Letter */}
                  <label className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                    form.letterIncluded ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200" : "bg-white border-gray-200 hover:bg-gray-50"
                  }`}>
                    <input
                      type="checkbox"
                      checked={form.letterIncluded}
                      onChange={(e) => setForm({ ...form, letterIncluded: e.target.checked })}
                      className="mt-0.5 w-4 h-4 rounded text-indigo-600 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-gray-900 text-xs flex items-center gap-1">
                        <span>💌</span> Handwritten Thank-You Letter
                      </span>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        Notifies packing team to write and enclose a letter in thermal receipt.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Perk 3: Price Discount */}
                <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-900 text-xs flex items-center gap-1">
                      <span>🏷️</span> Direct Price Discount ({currency})
                    </span>
                    <span className="text-[10px] text-gray-400">Set 0 for no price discount</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      value={form.discountAmount}
                      onChange={(e) => setForm({ ...form, discountAmount: Number(e.target.value) })}
                      placeholder="e.g. 50, 100, 150, 200, 500"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:border-indigo-600 focus:outline-none"
                    />
                    <div className="flex gap-1">
                      {[50, 100, 150, 200].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setForm({ ...form, discountAmount: amt })}
                          className={`px-2 py-1 text-[10px] font-bold rounded border ${
                            form.discountAmount === amt
                              ? "bg-amber-100 border-amber-400 text-amber-900"
                              : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                          }`}
                        >
                          +{amt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Perk 4: Manufacturer-selected physical gift */}
                <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-900 text-xs flex items-center gap-1">
                      <span>🎁</span> Loyalty Gift Product
                    </span>
                    <span className="text-[10px] text-gray-400">Automatically offered on eligible orders</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="number"
                      min="0.01"
                      value={form.giftAmount}
                      onChange={(e) => setForm({ ...form, giftAmount: Number(e.target.value) })}
                      placeholder="Maximum gift value (Rs)"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:border-indigo-600 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={form.giftDescription}
                      onChange={(e) => setForm({ ...form, giftDescription: e.target.value })}
                      placeholder="Gift note or suggested item"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:border-indigo-600 focus:outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-gray-500">When this reward is active, the assigned manufacturer can select a product from accepted hub gift stock up to this value.</p>
                </div>

                {/* Perk 5: Custom Perk & Order Limit */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                      Eligible Transactions / Orders *
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={form.rewardOrderLimit}
                      onChange={(e) => setForm({ ...form, rewardOrderLimit: Number(e.target.value) })}
                      placeholder="e.g. 3 (applies to next 3 purchases)"
                      required
                      className="w-full px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs focus:border-indigo-600 focus:outline-none"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Number of orders this gift/discount applies to.</p>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                      Extra VIP Perk Note (Optional)
                    </label>
                    <input
                      type="text"
                      value={form.customPerk}
                      onChange={(e) => setForm({ ...form, customPerk: e.target.value })}
                      placeholder="e.g. Priority dispatch & VIP luxury box"
                      className="w-full px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs focus:border-indigo-600 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Reward Headline & Description */}
                <div className="space-y-2 pt-1 border-t border-amber-200">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[10px] font-bold text-gray-500 uppercase">
                        Reward Headline / Display Title *
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const parts = [];
                          if (form.freeShipping) parts.push("Free Delivery");
                          if (form.discountAmount > 0) parts.push(`Rs. ${form.discountAmount} Off`);
                          if (form.giftAmount > 0 || form.giftDescription) parts.push(form.giftAmount > 0 ? `${form.giftDescription || "Gift"} up to Rs. ${form.giftAmount}` : form.giftDescription);
                          if (form.letterIncluded) parts.push("Handwritten Letter");
                          if (form.customPerk) parts.push(form.customPerk);
                          const generated = parts.length > 0 ? parts.join(" + ") : "Entry Level (No Perks)";
                          setForm({ ...form, rewardTitle: generated });
                        }}
                        className="text-[10px] text-indigo-600 font-bold hover:underline"
                      >
                        ⚡ Auto-Generate Title from Perks
                      </button>
                    </div>
                    <input
                      type="text"
                      value={form.rewardTitle}
                      onChange={(e) => setForm({ ...form, rewardTitle: e.target.value })}
                      placeholder="e.g. Free Delivery + Rs. 150 Off + Handwritten Note"
                      required
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl text-xs focus:border-indigo-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                      Reward Description & Packing Team Instructions
                    </label>
                    <textarea
                      rows="2"
                      value={form.rewardDescription}
                      onChange={(e) => setForm({ ...form, rewardDescription: e.target.value })}
                      placeholder="Instructions for packing team or explanation of benefits to customer..."
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl text-xs focus:border-indigo-600 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-sm transition-all"
                >
                  {saving ? "Saving Level..." : "Save Loyalty Level"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoyaltyLevels;
