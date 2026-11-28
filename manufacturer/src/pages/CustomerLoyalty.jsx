import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Users,
  Search,
  RefreshCw,
  Star,
  Gift,
  Phone,
  Mail,
  ShoppingBag,
  TrendingUp,
  Award,
  CheckCircle,
  ChevronRight,
  AlertCircle,
  Crown,
  Sparkles,
  Package,
  Clock,
  Plus,
  X,
} from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";

// ─── Loyalty Level Badge ──────────────────────────────────────────────────────
const LoyaltyBadge = ({ level, size = "md" }) => {
  if (!level) return null;
  const sizes = {
    sm: "text-[10px] px-1.5 py-0.5",
    md: "text-xs px-2 py-1",
    lg: "text-sm px-3 py-1.5",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold border ${sizes[size]}`}
      style={{
        backgroundColor: `${level.color || "#3B82F6"}18`,
        color: level.color || "#3B82F6",
        borderColor: `${level.color || "#3B82F6"}40`,
      }}
    >
      <span>{level.badgeIcon || "⭐"}</span>
      <span>{level.name}</span>
    </span>
  );
};

// ─── Perk Tag ────────────────────────────────────────────────────────────────
const PerkTag = ({ perk }) => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-bold">
    <Sparkles className="w-2.5 h-2.5" />
    {perk}
  </span>
);

// ─── Loyalty Card (full customer tier view) ───────────────────────────────────
const LoyaltyCard = ({ customer, loyalty, onRecordGift }) => {
  if (!loyalty) return null;
  const { currentLevel, nextLevel, totalSpend, totalOrders, progressPercentage, activeReward } = loyalty;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ background: `linear-gradient(135deg, ${currentLevel?.color || "#3B82F6"}18, ${currentLevel?.color || "#3B82F6"}08)` }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shadow-sm"
            style={{ backgroundColor: `${currentLevel?.color || "#3B82F6"}20`, border: `2px solid ${currentLevel?.color || "#3B82F6"}40` }}
          >
            {currentLevel?.badgeIcon || "⭐"}
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Loyalty Status</p>
            <p className="font-black text-slate-900 text-lg leading-tight">{currentLevel?.name}</p>
            {customer && (
              <p className="text-xs text-slate-600 font-semibold">{customer.name}</p>
            )}
          </div>
        </div>
        {activeReward?.isEligible && (
          <div className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-[11px] font-bold flex items-center gap-1 animate-pulse">
            <Gift className="w-3.5 h-3.5" />
            Reward Ready!
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
        <div className="px-4 py-3 text-center">
          <p className="text-base font-black text-slate-900">Rs {totalSpend?.toLocaleString()}</p>
          <p className="text-[10px] text-slate-400 font-medium">Total Spend</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-base font-black text-slate-900">{totalOrders}</p>
          <p className="text-[10px] text-slate-400 font-medium">Total Orders</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-base font-black text-slate-900">{progressPercentage}%</p>
          <p className="text-[10px] text-slate-400 font-medium">
            {nextLevel ? `To ${nextLevel.name}` : "Max Tier"}
          </p>
        </div>
      </div>

      {/* Progress to next tier */}
      {nextLevel && (
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1.5">
            <span className="font-semibold">{currentLevel?.name}</span>
            <span className="font-semibold">{nextLevel.name} {nextLevel.badgeIcon}</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progressPercentage}%`,
                backgroundColor: currentLevel?.color || "#3B82F6",
              }}
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            {loyalty.remainingSpend > 0 && `Rs ${loyalty.remainingSpend?.toLocaleString()} more spend`}
            {loyalty.remainingSpend > 0 && loyalty.remainingOrders > 0 && " + "}
            {loyalty.remainingOrders > 0 && `${loyalty.remainingOrders} more orders`}
            {" "}to unlock {nextLevel.name}
          </p>
        </div>
      )}

      {/* Active Reward */}
      <div className="px-5 py-4">
        <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-2">Active Perks</p>
        {activeReward?.isEligible ? (
          <div>
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl mb-3">
              <p className="text-xs font-bold text-emerald-800 flex items-center gap-1.5 mb-1">
                <Gift className="w-3.5 h-3.5" />
                {activeReward.title}
              </p>
              <p className="text-[11px] text-emerald-700">{activeReward.description}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {(activeReward.perkTags || []).map((perk, i) => (
                  <PerkTag key={i} perk={perk} />
                ))}
              </div>
              <p className="text-[10px] text-emerald-600 mt-1.5">
                {activeReward.remainingUses} of {activeReward.orderLimit} uses remaining
              </p>
            </div>
            {onRecordGift && (
              <button
                onClick={() => onRecordGift(customer)}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Mark Gift as Handed Over
              </button>
            )}
          </div>
        ) : (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {activeReward?.usageBadge || "No active perks at this tier"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Record Gift Modal ────────────────────────────────────────────────────────
const RecordGiftModal = ({ customer, onClose, onSubmit, loading }) => {
  const GIFT_TYPES = [
    "Discount Voucher",
    "Free Delivery Coupon",
    "Handwritten Letter",
    "Gift Voucher",
    "Custom Perk",
    "Other",
  ];
  const [giftType, setGiftType] = useState("Handwritten Letter");
  const [giftNote, setGiftNote] = useState("");
  const [orderId, setOrderId] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      giftType,
      giftNote,
      orderId: orderId.trim() || undefined,
      customerPhone: customer?.phone || "",
      customerName: customer?.name || "",
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Gift className="w-5 h-5 text-emerald-600" />
            Record Loyalty Gift
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {customer && (
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-200 flex items-center justify-center text-slate-600 font-black text-base">
              {(customer.name || "?")[0].toUpperCase()}
            </div>
            <div>
              <p className="font-bold text-slate-900 text-sm">{customer.name}</p>
              <p className="text-xs text-slate-500">📞 {customer.phone}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Gift Type</label>
            <div className="grid grid-cols-2 gap-2">
              {GIFT_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setGiftType(type)}
                  className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                    giftType === type
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Note / Remark <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={giftNote}
              onChange={(e) => setGiftNote(e.target.value)}
              placeholder="e.g. Handed personalized thank-you letter with order..."
              rows={2}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Related Order ID <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="Paste order ID if linked to a specific order"
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <CheckCircle className="w-4 h-4" />
              {loading ? "Saving..." : "Confirm Gift Handed Over"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
const CustomerLoyalty = () => {
  const { token, backendUrl, currency } = useManufacturer();

  // Phone lookup state
  const [phoneQuery, setPhoneQuery] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState(null); // { found, customer, loyalty }

  // Hub customers list state
  const [activeTab, setActiveTab] = useState("search"); // "search" | "customers" | "gifts"
  const [hubCustomers, setHubCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersSearch, setCustomersSearch] = useState("");
  const [customersPage, setCustomersPage] = useState(1);
  const [customersTotal, setCustomersTotal] = useState(0);
  const [customersPages, setCustomersPages] = useState(1);

  // Gifts state
  const [hubGifts, setHubGifts] = useState([]);
  const [giftsLoading, setGiftsLoading] = useState(false);

  // Loyalty tiers (for reference display)
  const [loyaltyLevels, setLoyaltyLevels] = useState([]);

  // Gift modal state
  const [giftModalCustomer, setGiftModalCustomer] = useState(null);
  const [giftModalLoading, setGiftModalLoading] = useState(false);

  // Selected customer for full detail view
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  useEffect(() => {
    fetchLoyaltyLevels();
  }, []);

  useEffect(() => {
    if (activeTab === "customers") fetchHubCustomers();
    if (activeTab === "gifts") fetchHubGifts();
  }, [activeTab, customersPage]);

  const fetchLoyaltyLevels = async () => {
    try {
      const res = await axios.get(`${backendUrl}/api/loyalty/levels`);
      if (res.data.success) setLoyaltyLevels(res.data.levels || []);
    } catch {}
  };

  const handlePhoneLookup = async (e) => {
    e?.preventDefault();
    if (!phoneQuery.trim()) return;
    setLookupLoading(true);
    setLookupResult(null);
    setSelectedCustomer(null);
    try {
      const res = await axios.get(
        `${backendUrl}/api/loyalty/customer-by-phone?phone=${encodeURIComponent(phoneQuery.trim())}`,
        { headers: { token } }
      );
      if (res.data.success) {
        setLookupResult(res.data);
        if (res.data.found) {
          setSelectedCustomer({ name: res.data.customer.name, phone: res.data.customer.phone });
        }
      } else {
        toast.error(res.data.message || "Lookup failed");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to fetch customer loyalty");
    } finally {
      setLookupLoading(false);
    }
  };

  const fetchHubCustomers = useCallback(async () => {
    if (!token) return;
    setCustomersLoading(true);
    try {
      const res = await axios.get(
        `${backendUrl}/api/loyalty/hub-customers?page=${customersPage}&limit=15&search=${encodeURIComponent(customersSearch)}`,
        { headers: { token } }
      );
      if (res.data.success) {
        setHubCustomers(res.data.customers || []);
        setCustomersTotal(res.data.total || 0);
        setCustomersPages(res.data.pages || 1);
      }
    } catch (err) {
      toast.error("Failed to load hub customers");
    } finally {
      setCustomersLoading(false);
    }
  }, [token, backendUrl, customersPage, customersSearch]);

  const fetchHubGifts = async () => {
    setGiftsLoading(true);
    try {
      const res = await axios.get(`${backendUrl}/api/loyalty/hub-gifts`, { headers: { token } });
      if (res.data.success) setHubGifts(res.data.gifts || []);
    } catch {
      toast.error("Failed to load gift records");
    } finally {
      setGiftsLoading(false);
    }
  };

  const handleRecordGift = async (giftData) => {
    setGiftModalLoading(true);
    try {
      const res = await axios.post(`${backendUrl}/api/loyalty/hub-gift`, giftData, { headers: { token } });
      if (res.data.success) {
        toast.success("Gift recorded successfully!");
        setGiftModalCustomer(null);
        if (activeTab === "gifts") fetchHubGifts();
      } else {
        toast.error(res.data.message || "Failed to record gift");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Error recording gift");
    } finally {
      setGiftModalLoading(false);
    }
  };

  const GIFT_TYPE_ICONS = {
    "Discount Voucher": "🏷️",
    "Free Delivery Coupon": "🚚",
    "Handwritten Letter": "✉️",
    "Gift Voucher": "🎁",
    "Custom Perk": "✨",
    Other: "🎀",
  };

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
            <Crown className="w-6 h-6 text-amber-500" />
            Customer Loyalty
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Look up customer loyalty tiers, apply perks on direct orders, and record gift handovers.
          </p>
        </div>

        {/* Tier Legend */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {loyaltyLevels.map((lvl) => (
            <LoyaltyBadge key={lvl.id} level={lvl} size="sm" />
          ))}
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <div className="flex items-center gap-0 border-b border-slate-200">
        {[
          { id: "search", label: "Customer Lookup", icon: <Search className="w-3.5 h-3.5" /> },
          { id: "customers", label: "Hub Customers", icon: <Users className="w-3.5 h-3.5" />, badge: customersTotal },
          { id: "gifts", label: "Gift Tracker", icon: <Gift className="w-3.5 h-3.5" />, badge: hubGifts.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === tab.id
                ? "border-emerald-600 text-emerald-700 bg-emerald-50/50"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${activeTab === tab.id ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════ TAB: CUSTOMER SEARCH ══════════════════════════ */}
      {activeTab === "search" && (
        <div className="space-y-6">
          {/* Phone Search Panel */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Phone className="w-4 h-4 text-emerald-600" />
              Look Up Customer by Phone
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Enter the customer's registered phone number to view their loyalty tier and active rewards.
            </p>
            <form onSubmit={handlePhoneLookup} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  value={phoneQuery}
                  onChange={(e) => setPhoneQuery(e.target.value)}
                  placeholder="e.g. 9801234567"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 font-medium"
                />
              </div>
              <button
                type="submit"
                disabled={lookupLoading || !phoneQuery.trim()}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
              >
                {lookupLoading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                {lookupLoading ? "Searching..." : "Search"}
              </button>
            </form>
          </div>

          {/* Lookup Result */}
          {lookupResult && (
            <>
              {!lookupResult.found ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-amber-900 text-sm">No Account Found</p>
                    <p className="text-xs text-amber-700 mt-0.5">{lookupResult.message}</p>
                    <p className="text-[11px] text-amber-600 mt-2">
                      You can still serve this customer but loyalty perks won't apply. Encourage them to register on the website to start earning rewards.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                  {/* Customer summary (left) */}
                  <div className="lg:col-span-2 space-y-4">
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                      <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-3">Customer</p>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-black text-xl">
                          {(lookupResult.customer.name || "?")[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 text-base">{lookupResult.customer.name}</p>
                          <p className="text-xs text-slate-500 flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {lookupResult.customer.phone}
                          </p>
                          {lookupResult.customer.email && (
                            <p className="text-xs text-slate-400">{lookupResult.customer.email}</p>
                          )}
                        </div>
                      </div>
                      <LoyaltyBadge level={lookupResult.loyalty?.currentLevel} size="md" />

                      <button
                        onClick={() => setGiftModalCustomer({ name: lookupResult.customer.name, phone: lookupResult.customer.phone })}
                        className="mt-4 w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <Gift className="w-3.5 h-3.5" />
                        Record Gift for This Customer
                      </button>
                    </div>

                    {/* All tiers reference */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                      <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-3">All Loyalty Tiers</p>
                      <div className="space-y-2">
                        {loyaltyLevels.map((lvl) => {
                          const isCurrent = lvl.id === lookupResult.loyalty?.currentLevel?.id;
                          return (
                            <div
                              key={lvl.id}
                              className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-all ${
                                isCurrent
                                  ? "border-2 shadow-sm"
                                  : "border-slate-100 bg-slate-50/50"
                              }`}
                              style={isCurrent ? { borderColor: lvl.color, backgroundColor: `${lvl.color}0D` } : {}}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-base">{lvl.badgeIcon}</span>
                                <div>
                                  <p className="font-bold text-slate-900">{lvl.name}</p>
                                  <p className="text-[10px] text-slate-400">
                                    Rs {Number(lvl.minSpend).toLocaleString()} + {lvl.minOrders} orders
                                  </p>
                                </div>
                              </div>
                              {isCurrent && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full text-white" style={{ backgroundColor: lvl.color }}>
                                  Current
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Loyalty card (right) */}
                  <div className="lg:col-span-3">
                    <LoyaltyCard
                      customer={lookupResult.customer}
                      loyalty={lookupResult.loyalty}
                      onRecordGift={(c) => setGiftModalCustomer(c)}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Empty state if no lookup yet */}
          {!lookupResult && (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <Crown className="w-12 h-12 mx-auto text-slate-200 mb-3" />
              <p className="font-semibold text-slate-500 text-sm">Enter a phone number above to check loyalty status</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                Works for customers who have registered on the Aashrit Corner website using that phone number.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════ TAB: HUB CUSTOMERS ════════════════════════════ */}
      {activeTab === "customers" && (
        <div className="space-y-4">
          {/* Search + Refresh bar */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by name, phone, email..."
                value={customersSearch}
                onChange={(e) => { setCustomersSearch(e.target.value); setCustomersPage(1); }}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500"
              />
            </div>
            <button
              onClick={() => { setCustomersPage(1); fetchHubCustomers(); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-semibold cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${customersLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {/* Customers List */}
          {customersLoading ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-400">Loading hub customers...</p>
            </div>
          ) : hubCustomers.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <Users className="w-10 h-10 mx-auto text-slate-200 mb-3" />
              <p className="font-semibold text-slate-500 text-sm">No customers yet</p>
              <p className="text-xs text-slate-400 mt-1">Customers who place direct orders at your hub will appear here.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {hubCustomers.map((customer, idx) => {
                  const lvl = customer.loyalty?.currentLevel;
                  const reward = customer.loyalty?.activeReward;
                  return (
                    <div
                      key={idx}
                      className="bg-white rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-all p-4"
                    >
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-3">
                          {/* Avatar */}
                          <div
                            className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-lg flex-shrink-0"
                            style={lvl ? {
                              backgroundColor: `${lvl.color}20`,
                              color: lvl.color,
                              border: `2px solid ${lvl.color}40`,
                            } : { backgroundColor: "#F1F5F9", color: "#64748B" }}
                          >
                            {(customer.name || "?")[0].toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-bold text-slate-900 text-sm">{customer.name}</p>
                              {customer.isRegistered ? (
                                <LoyaltyBadge level={lvl} size="sm" />
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full font-medium">
                                  Unregistered
                                </span>
                              )}
                              {reward?.isEligible && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full font-bold animate-pulse">
                                  🎁 Reward Ready
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-500">
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3" /> {customer.phone}
                              </span>
                              {customer.email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="w-3 h-3" /> {customer.email}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-center flex-wrap">
                          <div>
                            <p className="font-black text-slate-900 text-base">{customer.visitCount}</p>
                            <p className="text-[10px] text-slate-400">Hub Visits</p>
                          </div>
                          <div>
                            <p className="font-black text-slate-900 text-base">
                              Rs {customer.totalSpentAtHub?.toLocaleString()}
                            </p>
                            <p className="text-[10px] text-slate-400">At Hub</p>
                          </div>
                          {customer.loyalty && (
                            <div>
                              <p className="font-black text-slate-900 text-base">
                                Rs {customer.loyalty.totalSpend?.toLocaleString()}
                              </p>
                              <p className="text-[10px] text-slate-400">Total Spend</p>
                            </div>
                          )}
                          <div>
                            <p className="text-[11px] text-slate-400">
                              Last: {customer.lastVisit ? new Date(customer.lastVisit).toLocaleDateString() : "—"}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => { setPhoneQuery(customer.phone); setActiveTab("search"); setTimeout(() => handlePhoneLookup(), 100); }}
                              className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-[11px] font-bold cursor-pointer flex items-center gap-1 transition-colors"
                            >
                              <Award className="w-3 h-3" />
                              View Loyalty
                            </button>
                            <button
                              onClick={() => setGiftModalCustomer({ name: customer.name, phone: customer.phone })}
                              className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-[11px] font-bold cursor-pointer flex items-center gap-1 transition-colors"
                            >
                              <Gift className="w-3 h-3" />
                              Record Gift
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Perk tags */}
                      {customer.isRegistered && (reward?.perkTags?.length > 0) && (
                        <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-1">
                          <span className="text-[10px] text-slate-400 font-medium mr-1">Perks:</span>
                          {reward.perkTags.map((p, i) => (
                            <PerkTag key={i} perk={p} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {customersPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button
                    disabled={customersPage <= 1}
                    onClick={() => setCustomersPage((p) => p - 1)}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 disabled:opacity-40 cursor-pointer hover:bg-slate-50"
                  >
                    ← Prev
                  </button>
                  <span className="text-xs text-slate-500 font-medium">
                    Page {customersPage} of {customersPages} ({customersTotal} customers)
                  </span>
                  <button
                    disabled={customersPage >= customersPages}
                    onClick={() => setCustomersPage((p) => p + 1)}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 disabled:opacity-40 cursor-pointer hover:bg-slate-50"
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════ TAB: GIFT TRACKER ══════════════════════════════ */}
      {activeTab === "gifts" && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              All loyalty gifts and perks physically handed to customers at your hub.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setGiftModalCustomer({ name: "", phone: "" })}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Record New Gift
              </button>
              <button
                onClick={fetchHubGifts}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold cursor-pointer hover:bg-slate-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${giftsLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>

          {giftsLoading ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-400">Loading gift records...</p>
            </div>
          ) : hubGifts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <Gift className="w-10 h-10 mx-auto text-slate-200 mb-3" />
              <p className="font-semibold text-slate-500 text-sm">No gifts recorded yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Record loyalty gifts and perks handed to customers for a full audit trail.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-bold text-slate-700">Gift Type</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-700">Customer</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-700">Note</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-700">Order</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-700">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {hubGifts.map((gift) => (
                    <tr key={gift.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{GIFT_TYPE_ICONS[gift.giftType] || "🎀"}</span>
                          <span className="font-semibold text-slate-900">{gift.giftType}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{gift.customerName || "—"}</p>
                        {gift.customerPhone && (
                          <p className="text-slate-400 text-[10px]">📞 {gift.customerPhone}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs">
                        <p className="line-clamp-2">{gift.giftNote || "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        {gift.orderId ? (
                          <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                            #{gift.orderId.slice(-8).toUpperCase()}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {gift.handedOverAt
                          ? new Date(gift.handedOverAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Record Gift Modal ─── */}
      {giftModalCustomer !== null && (
        <RecordGiftModal
          customer={giftModalCustomer}
          onClose={() => setGiftModalCustomer(null)}
          onSubmit={handleRecordGift}
          loading={giftModalLoading}
        />
      )}
    </div>
  );
};

export default CustomerLoyalty;
