/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";
import {
  DollarSign,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  Building2,
  Package,
  Layers,
  Search,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Percent,
  ShieldCheck,
  ArrowRight,
  Info,
} from "lucide-react";

const CogsCalculator = ({ token }) => {
  const [activeTab, setActiveTab] = useState("matrix"); // 'matrix' | 'proposals' | 'comparison'
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [marginFilter, setMarginFilter] = useState("ALL");
  const [selectedProductDetails, setSelectedProductDetails] = useState(null);

  // Proposal Action State
  const [actionLoading, setActionLoading] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState({
    open: false,
    type: "ACCEPT", // 'ACCEPT' | 'REJECT'
    item: null,
    note: "",
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewRes, proposalsRes] = await Promise.all([
        axios.get(`${backendUrl}/api/cogs/overview`, { headers: { token } }),
        axios.get(`${backendUrl}/api/cogs/pending-proposals`, { headers: { token } }),
      ]);

      if (overviewRes.data.success) {
        setData(overviewRes.data.data);
      }
      if (proposalsRes.data.success) {
        setProposals(proposalsRes.data.proposals || []);
      }
    } catch (err) {
      console.error("Failed to load pricing data:", err);
      toast.error("Failed to load manufacturer pricing overview");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAcceptPrice = async (item, note) => {
    setActionLoading(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/cogs/accept-price`,
        {
          inventoryId: item.id,
          adminFeedback: note || "Agreed supply cost price accepted by Admin",
        },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(res.data.message);
        setFeedbackModal({ open: false, type: "ACCEPT", item: null, note: "" });
        fetchData();
      } else {
        toast.error(res.data.message || "Failed to accept price");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Error accepting proposed price");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectPrice = async (item, note) => {
    setActionLoading(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/cogs/reject-price`,
        {
          inventoryId: item.id,
          rejectionReason: note || "Cost quotation exceeds target gross margin.",
        },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.info("Manufacturer price rejected. Revised quotation requested.");
        setFeedbackModal({ open: false, type: "REJECT", item: null, note: "" });
        fetchData();
      } else {
        toast.error(res.data.message || "Failed to reject price");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Error rejecting proposed price");
    } finally {
      setActionLoading(false);
    }
  };

  const filteredMatrix = (data?.matrix || []).filter((p) => {
    const matchesSearch =
      p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.subCategory?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.category?.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (marginFilter === "HEALTHY") return p.avgMarginPercentage >= 45;
    if (marginFilter === "MODERATE") return p.avgMarginPercentage >= 25 && p.avgMarginPercentage < 45;
    if (marginFilter === "LOW") return p.avgMarginPercentage > 0 && p.avgMarginPercentage < 25;
    if (marginFilter === "UNSET") return p.avgAgreedCost === 0;

    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-emerald-600" />
            Manufacturer Supply Cost Quotes &amp; Indicative Margins
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Compares proposed or approved manufacturer supply costs with catalog selling prices. These are indicative price margins, not posted COGS, realized profit, or inventory valuation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh Margins
          </button>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Pending Proposals */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Pending Price Quotes
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">
              {proposals.length}
            </span>
            {proposals.length > 0 && (
              <span className="text-[11px] font-bold text-amber-600 animate-pulse">
                Action required
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Awaiting admin mutual approval</p>
        </div>

        {/* Products With Agreed Pricing */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Priced Catalog SKUs
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">
              {data?.summary?.productsWithAgreedPricing || 0}
            </span>
            <span className="text-[11px] text-slate-400">
              / {data?.summary?.totalProducts || 0} Total
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">With locked manufacturer cost</p>
        </div>

        {/* Overall Average Margin */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Average Indicative Margin
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Percent className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-emerald-600">
              {data?.summary?.overallAvgMargin || 0}%
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Across all active manufacturer agreements</p>
        </div>

        {/* Registered Manufacturing Hubs */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Active Regional Hubs
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">
              {data?.summary?.totalRegisteredManufacturers || 0}
            </span>
            <span className="text-[11px] text-slate-400">Hubs in Nepal</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Supplying apparel catalog</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab("matrix")}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
            activeTab === "matrix"
              ? "bg-slate-900 text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          Product Margin Matrix
        </button>

        <button
          onClick={() => setActiveTab("proposals")}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-2 cursor-pointer ${
            activeTab === "proposals"
              ? "bg-slate-900 text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <span>Price Proposals &amp; Approvals</span>
          {proposals.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-black">
              {proposals.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("comparison")}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
            activeTab === "comparison"
              ? "bg-slate-900 text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          Regional Hub Price Comparison
        </button>
      </div>

      {/* ─── TAB 1: PRODUCT MARGIN MATRIX ─────────────────────────────────── */}
      {activeTab === "matrix" && (
        <div className="space-y-4">
          {/* Search and Filters */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search product name or category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-slate-900"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
              {[
                { id: "ALL", label: "All Items" },
                { id: "HEALTHY", label: "Healthy (≥45%)" },
                { id: "MODERATE", label: "Moderate (25-45%)" },
                { id: "LOW", label: "Low (<25%)" },
                { id: "UNSET", label: "Unset Cost" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setMarginFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                    marginFilter === tab.id
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Matrix Table */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-slate-400">
                <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-xs">Computing indicative price margins...</p>
              </div>
            ) : filteredMatrix.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <Package className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="font-semibold text-slate-600 text-sm">No products found matching criteria</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredMatrix.map((product) => {
                  const isExpanded = selectedProductDetails === product.id;
                  const hasAgreedCost = product.avgAgreedCost > 0;

                  return (
                    <div key={product.id} className="p-4 hover:bg-slate-50/50 transition-colors">
                      <div
                        onClick={() => setSelectedProductDetails(isExpanded ? null : product.id)}
                        className="flex items-center justify-between gap-4 cursor-pointer"
                      >
                        {/* Left: Product Info */}
                        <div className="flex items-center gap-3 min-w-0">
                          {product.image ? (
                            <img
                              src={Array.isArray(product.image) ? product.image[0] : product.image}
                              alt={product.name}
                              className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                              <Package className="w-6 h-6" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <h4 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                              {product.name}
                            </h4>
                            <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                              <span>{Array.isArray(product.category) ? product.category.join(", ") : product.category}</span>
                              <span>•</span>
                              <span className="font-semibold text-slate-700">
                                {product.hubsCount} Hub{product.hubsCount > 1 ? "s" : ""} Supplying
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Right: Financial Margin Metrics */}
                        <div className="flex items-center gap-4 sm:gap-8 text-right text-xs shrink-0">
                          {/* Retail Selling Price */}
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-bold">
                              Selling Price
                            </span>
                            <span className="font-black text-slate-900 text-sm">
                              {currency}{product.sellingPrice?.toLocaleString()}
                            </span>
                          </div>

                          {/* Manufacturer Agreed Cost */}
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-bold">
                              Avg Supply Cost
                            </span>
                            <span className="font-bold text-slate-700 text-sm">
                              {hasAgreedCost ? `${currency}${product.avgAgreedCost}` : "Pending"}
                            </span>
                          </div>

                          {/* Profit Margin Amount */}
                          <div className="hidden sm:block">
                            <span className="text-slate-400 block text-[10px] uppercase font-bold">
                              Gross Margin (Rs)
                            </span>
                            <span className="font-black text-slate-900 text-sm">
                              {hasAgreedCost ? `+${currency}${product.avgMarginAmount}` : "—"}
                            </span>
                          </div>

                          {/* Margin Percentage Badge */}
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-bold">
                              Margin %
                            </span>
                            {hasAgreedCost ? (
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black border ${
                                  product.avgMarginPercentage >= 45
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : product.avgMarginPercentage >= 25
                                    ? "bg-blue-50 text-blue-700 border-blue-200"
                                    : "bg-rose-50 text-rose-700 border-rose-200"
                                }`}
                              >
                                {product.avgMarginPercentage}%
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                Unpriced
                              </span>
                            )}
                          </div>

                          <button className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Expanded View: Per-Manufacturer Supply Price Breakdown */}
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-slate-100 bg-slate-50/80 rounded-xl p-4 space-y-3">
                          <h5 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-slate-600" />
                            Manufacturer-Specific Supply Price &amp; Profit Margins
                          </h5>

                          {product.manufacturerPricing.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">
                              No manufacturer hubs have submitted stock or cost quotations for this product yet.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {product.manufacturerPricing.map((m) => (
                                <div
                                  key={m.id}
                                  className="bg-white p-3.5 rounded-xl border border-slate-200 text-xs space-y-2 shadow-2xs"
                                >
                                  <div className="flex items-center justify-between font-bold text-slate-900">
                                    <span>{m.manufacturerName}</span>
                                    <span className="text-[11px] text-emerald-600 font-semibold">
                                      {m.manufacturerCity}
                                    </span>
                                  </div>

                                  <div className="space-y-1 text-slate-600 pt-1 border-t border-slate-100 text-[11px]">
                                    <div className="flex items-center justify-between">
                                      <span>Quoted Supply Cost (13% VAT Inc):</span>
                                      <strong className="text-slate-900">
                                        {m.agreedCostPrice ? `${currency}${m.agreedCostPrice}` : (m.proposedCostPrice ? `${currency}${m.proposedCostPrice} (Pending)` : "Unset")}
                                      </strong>
                                    </div>

                                    {m.activeCostPrice > 0 && (
                                      <div className="flex items-center justify-between text-[10px] text-emerald-700 font-medium">
                                        <span>13% Input VAT Credit:</span>
                                        <strong>+{currency}{(m.activeCostPrice - m.activeCostPrice / 1.13).toFixed(2)}</strong>
                                      </div>
                                    )}

                                    <div className="flex items-center justify-between">
                                      <span>Indicative price difference per unit:</span>
                                      <strong className="text-emerald-700">
                                        +{currency}{m.marginAmount}
                                      </strong>
                                    </div>

                                    <div className="flex items-center justify-between">
                                      <span>Indicative margin %:</span>
                                      <span
                                        className={`font-black ${
                                          m.marginPercentage >= 45
                                            ? "text-emerald-600"
                                            : m.marginPercentage >= 25
                                            ? "text-blue-600"
                                            : "text-rose-600"
                                        }`}
                                      >
                                        {m.marginPercentage}%
                                      </span>
                                    </div>

                                    <div className="flex items-center justify-between">
                                      <span>Agreement Status:</span>
                                      <span
                                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                                          m.priceStatus === "APPROVED"
                                            ? "bg-emerald-50 text-emerald-700"
                                            : m.priceStatus === "REJECTED"
                                            ? "bg-rose-50 text-rose-700"
                                            : "bg-amber-50 text-amber-700"
                                        }`}
                                      >
                                        {m.priceStatus}
                                      </span>
                                    </div>

                                    {m.priceNote && (
                                      <div className="pt-1 text-[10px] text-slate-400 italic">
                                        Note: &quot;{m.priceNote}&quot;
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB 2: PRICE PROPOSALS & MUTUAL AGREEMENT ────────────────────── */}
      {activeTab === "proposals" && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900">
              <p className="font-bold">Mutual Cost Price Protocol</p>
              <p className="text-amber-800 mt-0.5">
                Manufacturers set their supply cost quotations based on localized raw material, fabric, and tailoring costs.
                Admins review the quoted price and indicative catalog-price margin before clicking <strong>Accept</strong> or <strong>Reject</strong>. This is not posted COGS or realized profit.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Pending Quotations from Manufacturers ({proposals.length})
              </h3>
            </div>

            {proposals.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-400" />
                <p className="font-semibold text-slate-700 text-sm">All Manufacturer Prices Up-to-Date</p>
                <p className="text-xs text-slate-400 mt-1">
                  No pending supply cost proposals awaiting approval.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {proposals.map((item) => (
                  <div
                    key={item.id}
                    className="p-5 hover:bg-slate-50/50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    {/* Left: Product & Hub Details */}
                    <div className="flex items-start gap-3">
                      {item.productImage ? (
                        <img
                          src={Array.isArray(item.productImage) ? item.productImage[0] : item.productImage}
                          alt={item.productName}
                          className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                          <Package className="w-6 h-6" />
                        </div>
                      )}
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{item.productName}</h4>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                          <span className="font-semibold text-slate-700">Hub: {item.manufacturerName}</span>
                          <span>•</span>
                          <span className="text-emerald-600 font-medium">{item.manufacturerCity}</span>
                          <span>•</span>
                          <span className="text-slate-400">Score: {item.qualityRating?.toFixed(1)}</span>
                        </div>
                        {item.priceNote && (
                          <p className="text-xs text-slate-600 mt-1.5 bg-slate-100/80 rounded-lg px-2.5 py-1 inline-block">
                            Manufacturer note: <em>&quot;{item.priceNote}&quot;</em>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Middle: Financial Comparison */}
                    <div className="grid grid-cols-3 gap-4 text-xs text-right bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">
                          Retail Price
                        </span>
                        <span className="font-black text-slate-900 text-sm">
                          {currency}{item.sellingPrice}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">
                          Proposed Cost
                        </span>
                        <span className="font-black text-blue-600 text-sm">
                          {currency}{item.proposedCostPrice}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">
                          Projected Margin
                        </span>
                        <span
                          className={`font-black text-sm ${
                            item.projectedMarginPercentage >= 45
                              ? "text-emerald-600"
                              : item.projectedMarginPercentage >= 25
                              ? "text-blue-600"
                              : "text-rose-600"
                          }`}
                        >
                          {item.projectedMarginPercentage}%
                        </span>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() =>
                          setFeedbackModal({
                            open: true,
                            type: "ACCEPT",
                            item,
                            note: "Agreed cost price accepted by Admin",
                          })
                        }
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Accept Price
                      </button>

                      <button
                        onClick={() =>
                          setFeedbackModal({
                            open: true,
                            type: "REJECT",
                            item,
                            note: "Cost quotation exceeds target gross margin.",
                          })
                        }
                        className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold cursor-pointer flex items-center gap-1.5"
                      >
                        <XCircle className="w-4 h-4" />
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB 3: REGIONAL HUB COMPARISON ───────────────────────────────── */}
      {activeTab === "comparison" && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-1">
              Cross-City Manufacturing Cost Comparison
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Compare supply prices charged by different regional hubs for identical garments to optimize production margins.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
                  <tr>
                    <th className="py-3 px-4">Garment / SKU</th>
                    <th className="py-3 px-4">Retail Price</th>
                    <th className="py-3 px-4">Lowest Cost Hub</th>
                    <th className="py-3 px-4">Highest Cost Hub</th>
                    <th className="py-3 px-4">Cost Spread</th>
                    <th className="py-3 px-4 text-right">Max Potential Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredMatrix.map((product) => {
                    const pricing = product.manufacturerPricing.filter((m) => m.activeCostPrice > 0);
                    if (pricing.length === 0) return null;

                    const lowest = [...pricing].sort((a, b) => a.activeCostPrice - b.activeCostPrice)[0];
                    const highest = [...pricing].sort((a, b) => b.activeCostPrice - a.activeCostPrice)[0];
                    const spread = highest.activeCostPrice - lowest.activeCostPrice;

                    return (
                      <tr key={product.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4 font-bold text-slate-900">
                          {product.name}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-800">
                          {currency}{product.sellingPrice}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-bold text-emerald-600">
                            {currency}{lowest.activeCostPrice}
                          </span>
                          <span className="text-[10px] text-slate-400 block">
                            {lowest.manufacturerCity} ({lowest.manufacturerName})
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-bold text-slate-700">
                            {currency}{highest.activeCostPrice}
                          </span>
                          <span className="text-[10px] text-slate-400 block">
                            {highest.manufacturerCity} ({highest.manufacturerName})
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-600">
                          {currency}{spread}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <span className="px-2.5 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {lowest.marginPercentage}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── FEEDBACK / ACTION MODAL ─────────────────────────────────────── */}
      {feedbackModal.open && feedbackModal.item && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              {feedbackModal.type === "ACCEPT" ? "Confirm Supply Price Approval" : "Decline Price Quotation"}
            </h3>

            <p className="text-xs text-slate-500">
              {feedbackModal.type === "ACCEPT"
                ? `You are approving Rs ${feedbackModal.item.proposedCostPrice} as the active supply cost from ${feedbackModal.item.manufacturerName} for "${feedbackModal.item.productName}".`
                : `Please provide feedback to ${feedbackModal.item.manufacturerName} on why the quote was rejected.`}
            </p>

            <div className="space-y-2 text-xs">
              <label className="block font-semibold text-slate-700">
                Admin Note / Remarks (Optional)
              </label>
              <textarea
                rows={3}
                value={feedbackModal.note}
                onChange={(e) =>
                  setFeedbackModal({ ...feedbackModal, note: e.target.value })
                }
                placeholder="e.g. Approved for bulk fulfillment / target margin is 40%."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:border-slate-900"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFeedbackModal({ open: false, type: "ACCEPT", item: null, note: "" })}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={actionLoading}
                onClick={() => {
                  if (feedbackModal.type === "ACCEPT") {
                    handleAcceptPrice(feedbackModal.item, feedbackModal.note);
                  } else {
                    handleRejectPrice(feedbackModal.item, feedbackModal.note);
                  }
                }}
                className={`px-5 py-2 rounded-xl text-xs font-bold text-white cursor-pointer disabled:opacity-50 ${
                  feedbackModal.type === "ACCEPT"
                    ? "bg-emerald-600 hover:bg-emerald-700 shadow-md"
                    : "bg-rose-600 hover:bg-rose-700 shadow-md"
                }`}
              >
                {actionLoading ? "Processing..." : feedbackModal.type === "ACCEPT" ? "Confirm Acceptance" : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CogsCalculator;
