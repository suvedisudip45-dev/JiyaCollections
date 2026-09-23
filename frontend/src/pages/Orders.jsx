/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { ShopContext } from "../context/ShopContext";
import Title from "../components/Title";
import axios from "axios";
import { toast } from "react-toastify";
import Pagination from "../components/Pagination";
import {
  Package,
  Truck,
  CheckCircle2,
  Clock,
  AlertCircle,
  Search,
  RotateCcw,
  Copy,
  FileText,
  MapPin,
  Calendar,
  CreditCard,
  ChevronRight,
  Printer,
  X,
  ShoppingBag,
  ExternalLink,
  Box,
  Layers,
  Sparkles,
} from "lucide-react";

const Orders = () => {
  const { backendUrl, token, setToken, currency, navigate } = useContext(ShopContext);
  const [orders, setOrders] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  // Modals
  const [trackingOrder, setTrackingOrder] = useState(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [activeDeliveryData, setActiveDeliveryData] = useState(null);

  const [invoiceOrder, setInvoiceOrder] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const loadOrderData = async (isManualRefresh = false) => {
    if (!token) {
      setLoading(false);
      navigate("/login", { replace: true });
      return;
    }

    if (isManualRefresh) setRefreshing(true);

    try {
      const response = await axios.post(
        `${backendUrl}/api/order/userorders`,
        {},
        { headers: { token }, params: { page, limit: 10 } }
      );

      if (response.data.success) {
        // Keep orders intact as individual order records (do NOT flatten items)
        const formattedOrders = (response.data.orders || []).map((order) => {
          let parsedReward = null;
          if (order.rewardApplied) {
            try {
              parsedReward =
                typeof order.rewardApplied === "string"
                  ? JSON.parse(order.rewardApplied)
                  : order.rewardApplied;
            } catch {
              parsedReward = null;
            }
          }

          let items = [];
          if (Array.isArray(order.items)) {
            items = order.items;
          } else if (typeof order.items === "string") {
            try {
              items = JSON.parse(order.items);
            } catch {
              items = [];
            }
          }

          return {
            ...order,
            id: order._id || order.id,
            items,
            parsedReward,
            dateNum: Number(order.date || 0),
          };
        });

        setOrders(formattedOrders);
        setPagination(response.data.pagination || null);
      } else {
        const msg = (response.data.message || "").toLowerCase();
        if (
          msg.includes("not authorized") ||
          msg.includes("jwt") ||
          msg.includes("user not found") ||
          msg.includes("invalid token")
        ) {
          localStorage.removeItem("token");
          setToken("");
          navigate("/login", { replace: true });
          return;
        }
        toast.error(response.data.message || "Failed to load orders");
      }
    } catch (error) {
      console.error("loadOrderData error:", error);
      toast.error(error.response?.data?.message || "Failed to load orders");
    } finally {
      setLoading(false);
      if (isManualRefresh) setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }
    loadOrderData();
    const interval = setInterval(() => loadOrderData(), 20000);
    return () => clearInterval(interval);
  }, [token, backendUrl, page]);

  const handlePageChange = (nextPage) => setPage(nextPage);


  // Order Metrics Summary Report
  const metrics = useMemo(() => {
    const totalOrders = orders.length;
    const totalItems = orders.reduce((sum, o) => {
      const items = o.items || [];
      return sum + items.reduce((iSum, it) => iSum + Number(it.quantity || 1), 0);
    }, 0);
    const activeOrders = orders.filter((o) => {
      const s = (o.status || "").toLowerCase();
      const f = (o.fulfillmentStatus || "").toLowerCase();
      return (
        !s.includes("delivered") &&
        !s.includes("cancelled") &&
        !f.includes("delivered") &&
        !f.includes("failed")
      );
    }).length;
    const deliveredOrders = orders.filter((o) => {
      const s = (o.status || "").toLowerCase();
      const f = (o.fulfillmentStatus || "").toLowerCase();
      return s.includes("delivered") || f.includes("delivered");
    }).length;

    return { totalOrders, totalItems, activeOrders, deliveredOrders };
  }, [orders]);

  // Filter & Sort Orders
  const filteredOrders = useMemo(() => {
    return orders
      .filter((order) => {
        // Status filter
        const s = (order.status || "").toLowerCase();
        const f = (order.fulfillmentStatus || "").toLowerCase();
        const isDelivered = s.includes("delivered") || f.includes("delivered");
        const isCancelled = s.includes("cancelled") || f.includes("failed");
        const isActive = !isDelivered && !isCancelled;

        if (statusFilter === "active" && !isActive) return false;
        if (statusFilter === "delivered" && !isDelivered) return false;
        if (statusFilter === "cancelled" && !isCancelled) return false;

        // Search term filter
        if (searchTerm.trim()) {
          const query = searchTerm.toLowerCase().trim();
          const matchId = (order.id || "").toLowerCase().includes(query);
          const matchCity = (order.address?.city || "").toLowerCase().includes(query);
          const matchItems = (order.items || []).some(
            (item) =>
              (item.name || "").toLowerCase().includes(query) ||
              (item.category || "").toLowerCase().includes(query) ||
              (item.subCategory || "").toLowerCase().includes(query)
          );
          if (!matchId && !matchCity && !matchItems) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === "newest") return b.dateNum - a.dateNum;
        if (sortBy === "oldest") return a.dateNum - b.dateNum;
        if (sortBy === "highest") return (b.amount || 0) - (a.amount || 0);
        if (sortBy === "lowest") return (a.amount || 0) - (b.amount || 0);
        return 0;
      });
  }, [orders, statusFilter, searchTerm, sortBy]);

  // Open Tracking Modal
  const handleOpenTracking = async (order) => {
    setTrackingOrder(order);
    setActiveDeliveryData(order.delivery || null);

    const lookupId = order.deliveryOrder?.id || order.deliveryJobId || order.delivery?.id || order.id;
    if (lookupId) {
      setTrackingLoading(true);
      try {
        const response = await axios.get(`${backendUrl}/api/delivery/customer/${lookupId}`, {
          headers: { token },
        });
        if (response.data.success && response.data.delivery) {
          setActiveDeliveryData(response.data.delivery);
        }
      } catch (err) {
        // Keep fallback data from order.delivery
      } finally {
        setTrackingLoading(false);
      }
    }
  };

  const copyOrderId = (id) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    toast.success("Order ID copied to clipboard!");
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Helper for Status Badges
  const getStatusBadge = (status = "", fulfillmentStatus = "") => {
    const s = status.toLowerCase();
    const f = (fulfillmentStatus || "").toLowerCase();

    if (s.includes("delivered") || f.includes("delivered")) {
      return {
        label: "Delivered",
        bg: "bg-emerald-50 text-emerald-700 border-emerald-200",
        dot: "bg-emerald-500",
        icon: CheckCircle2,
      };
    }
    if (s.includes("cancelled") || f.includes("failed")) {
      return {
        label: "Cancelled",
        bg: "bg-rose-50 text-rose-700 border-rose-200",
        dot: "bg-rose-500",
        icon: AlertCircle,
      };
    }
    if (s.includes("shipped") || s.includes("out for delivery") || f.includes("in_transit")) {
      return {
        label: s.includes("out for delivery") ? "Out for Delivery" : "In Transit",
        bg: "bg-blue-50 text-blue-700 border-blue-200",
        dot: "bg-blue-500",
        icon: Truck,
      };
    }
    if (f.includes("ready_for_pickup") || f.includes("picked_up")) {
      return {
        label: "Handed to Courier",
        bg: "bg-indigo-50 text-indigo-700 border-indigo-200",
        dot: "bg-indigo-500",
        icon: Box,
      };
    }
    if (f.includes("manufacturing") || f.includes("quality_check") || f.includes("packed")) {
      return {
        label: "Processing in Factory",
        bg: "bg-amber-50 text-amber-700 border-amber-200",
        dot: "bg-amber-500 animate-pulse",
        icon: Clock,
      };
    }
    return {
      label: status || "Order Placed",
      bg: "bg-slate-100 text-slate-800 border-slate-200",
      dot: "bg-slate-500",
      icon: Package,
    };
  };

  // Calculate Tracking Progress Stage (1 to 5)
  const calculateTrackingStage = (order, deliveryData) => {
    const s = (order.status || "").toLowerCase();
    const f = (order.fulfillmentStatus || "").toLowerCase();
    const dState = (deliveryData?.state || deliveryData?.ncmStatus || "").toLowerCase();

    if (s.includes("delivered") || f.includes("delivered") || dState.includes("delivered")) return 5;
    if (s.includes("out for delivery") || dState.includes("out_for_delivery") || dState.includes("reached")) return 4;
    if (s.includes("shipped") || f.includes("in_transit") || dState.includes("in_transit") || dState.includes("dispatched") || dState.includes("picked_up")) return 3;
    if (f.includes("manufacturing") || f.includes("quality_check") || f.includes("packed") || f.includes("assigned") || s.includes("processing")) return 2;
    return 1; // Order Placed
  };

  return (
    <div className="min-h-screen bg-slate-50/50 py-10 px-4 sm:px-6 lg:px-8 border-t">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              <ShoppingBag className="w-7 h-7 text-slate-900" />
              <span>MY ORDER HISTORY & TRACKING</span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Track deliveries in real-time, view itemized receipts, and manage your purchase history
            </p>
          </div>

          <button
            onClick={() => loadOrderData(true)}
            disabled={refreshing}
            className="self-start md:self-auto flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs transition cursor-pointer disabled:opacity-60"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-slate-900" : "text-slate-500"}`} />
            <span>{refreshing ? "Refreshing..." : "Refresh Status"}</span>
          </button>
        </div>

        {/* Order History Report Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5 sm:w-6 sm:h-6 text-slate-800" />
            </div>
            <div>
              <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400">Total Orders</p>
              <h3 className="text-lg sm:text-2xl font-black text-slate-900">{metrics.totalOrders}</h3>
            </div>
          </div>

          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600" />
            </div>
            <div>
              <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400">Total Items</p>
              <h3 className="text-lg sm:text-2xl font-black text-slate-900">
                {metrics.totalItems}
              </h3>
            </div>
          </div>

          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400">In-Transit</p>
              <h3 className="text-lg sm:text-2xl font-black text-slate-900">{metrics.activeOrders}</h3>
            </div>
          </div>

          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400">Delivered</p>
              <h3 className="text-lg sm:text-2xl font-black text-slate-900">{metrics.deliveredOrders}</h3>
            </div>
          </div>
        </div>

        {/* Filter and Search Controls */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl w-full md:w-auto overflow-x-auto">
            {[
              { key: "all", label: "All Orders", count: orders.length },
              { key: "active", label: "In-Transit", count: metrics.activeOrders },
              { key: "delivered", label: "Delivered", count: metrics.deliveredOrders },
              { key: "cancelled", label: "Cancelled", count: orders.filter((o) => (o.status || "").toLowerCase().includes("cancel")).length },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  statusFilter === tab.key
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/60"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    statusFilter === tab.key ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search & Sort */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search order ID, item name..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:bg-white transition"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full sm:w-auto bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-slate-900 cursor-pointer"
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
              <option value="highest">Sort: Highest Amount</option>
              <option value="lowest">Sort: Lowest Amount</option>
            </select>
          </div>
        </div>

        {/* Orders Listing */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div key={n} className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse space-y-4">
                <div className="h-6 bg-slate-200 rounded w-1/3"></div>
                <div className="h-20 bg-slate-100 rounded-xl"></div>
                <div className="h-10 bg-slate-100 rounded-xl"></div>
              </div>
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center max-w-md mx-auto space-y-4 shadow-sm">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto text-slate-400">
              <ShoppingBag className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">No Orders Found</h3>
              <p className="text-xs text-slate-500 mt-1">
                {searchTerm || statusFilter !== "all"
                  ? "Try adjusting your search terms or status filter."
                  : "You haven't placed any apparel orders yet."}
              </p>
            </div>
            <Link
              to="/collection"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition shadow-sm"
            >
              <span>Explore Collection</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredOrders.map((order) => {
              const statusBadge = getStatusBadge(order.status, order.fulfillmentStatus);
              const StatusIcon = statusBadge.icon;
              const itemCount = (order.items || []).reduce(
                (sum, item) => sum + Number(item.quantity || 1),
                0
              );

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition overflow-hidden"
                >
                  {/* Order Header Card */}
                  <div className="p-4 sm:p-5 bg-slate-50/70 border-b border-slate-200/70 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-slate-900">
                            #{order.id.slice(0, 8).toUpperCase()}
                          </span>
                          <button
                            onClick={() => copyOrderId(order.id)}
                            title="Copy Order ID"
                            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          {copiedId === order.id && (
                            <span className="text-[10px] text-emerald-600 font-bold">Copied!</span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>
                            {new Date(order.dateNum).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}{" "}
                            at {new Date(order.dateNum).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </p>
                      </div>

                      <div className="hidden sm:block h-6 w-px bg-slate-200"></div>

                      <div className="flex items-center gap-2">
                        {/* Status Badge */}
                        <div
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold ${statusBadge.bg}`}
                        >
                          <span className={`w-2 h-2 rounded-full ${statusBadge.dot}`} />
                          <StatusIcon className="w-3 h-3" />
                          <span>{statusBadge.label}</span>
                        </div>

                        {/* Payment Badge */}
                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-700">
                          <CreditCard className="w-3 h-3 text-slate-500" />
                          <span>{order.paymentMethod}</span>
                          <span
                            className={`text-[10px] font-bold ml-1 ${
                              order.payment ? "text-emerald-600" : "text-amber-600"
                            }`}
                          >
                            ({order.payment ? "Paid" : "Pay on Delivery"})
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-0 border-slate-200">
                      <div className="text-left md:text-right">
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                          Order Total ({itemCount} {itemCount === 1 ? "item" : "items"})
                        </p>
                        <p className="text-base sm:text-lg font-black text-slate-900">
                          {currency}{order.amount.toLocaleString()}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenTracking(order)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                        >
                          <Truck className="w-3.5 h-3.5" />
                          <span>Track</span>
                        </button>
                        <button
                          onClick={() => setInvoiceOrder(order)}
                          className="p-1.5 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition cursor-pointer"
                          title="View Invoice & Receipt"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Items List Inside Single Order */}
                  <div className="divide-y divide-slate-100">
                    {order.items.map((item, idx) => {
                      const unitPrice = Number(item.purchasedUnitPrice ?? item.price ?? 0);
                      const qty = Number(item.quantity || 1);
                      const lineTotal = Number(item.lineTotal || unitPrice * qty);
                      const itemImg = Array.isArray(item.image) ? item.image[0] : item.image;

                      return (
                        <div
                          key={`${order.id}-item-${idx}`}
                          className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/40 transition"
                        >
                          <div className="flex items-start gap-4">
                            {/* Product Image */}
                            <div className="w-16 h-20 sm:w-20 sm:h-24 bg-slate-100 rounded-xl overflow-hidden border border-slate-200/80 shrink-0 relative group">
                              <img
                                src={itemImg}
                                alt={item.name}
                                className="w-full h-full object-cover object-center group-hover:scale-105 transition duration-300"
                              />
                            </div>

                            {/* Product Info */}
                            <div className="space-y-1">
                              <Link
                                to={`/product/${item._id || item.productId || item.id}`}
                                className="text-sm sm:text-base font-bold text-slate-900 hover:text-slate-600 transition line-clamp-1"
                              >
                                {item.name}
                              </Link>

                              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                {item.category && (
                                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium">
                                    {item.category}
                                  </span>
                                )}
                                {item.size && (
                                  <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-[11px] font-bold">
                                    Size: {item.size}
                                  </span>
                                )}
                                {item.color && (
                                  <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium flex items-center gap-1">
                                    <span
                                      className="w-2 h-2 rounded-full border border-slate-300"
                                      style={{ backgroundColor: item.color.toLowerCase() }}
                                    />
                                    {item.color}
                                  </span>
                                )}
                                {item.offerTag && (
                                  <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-bold flex items-center gap-1">
                                    <Sparkles className="w-2.5 h-2.5" />
                                    {item.offerTag}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 text-xs text-slate-500 pt-1">
                                <span className="font-semibold text-slate-700">
                                  {currency}{unitPrice.toLocaleString()}
                                </span>
                                <span>×</span>
                                <span className="font-semibold text-slate-700">{qty} qty</span>
                                {item.discountPercentage > 0 && (
                                  <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.2 rounded">
                                    {item.discountPercentage}% OFF
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Line Total */}
                          <div className="text-right sm:text-right flex sm:flex-col justify-between items-center sm:items-end border-t sm:border-0 pt-2 sm:pt-0 border-slate-100">
                            <span className="sm:hidden text-xs text-slate-400">Item Total:</span>
                            <div>
                              <p className="text-sm sm:text-base font-black text-slate-900">
                                {currency}{lineTotal.toLocaleString()}
                              </p>
                              <p className="text-[10px] text-slate-400">Snapshot price guaranteed</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Order Footer & Shipping Destination */}
                  <div className="p-4 bg-slate-50/50 border-t border-slate-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="line-clamp-1 font-medium">
                        Ship to:{" "}
                        <strong className="text-slate-800">
                          {order.address?.firstName} {order.address?.lastName}
                        </strong>{" "}
                        ({[order.address?.street, order.address?.city, order.address?.state].filter(Boolean).join(", ")})
                      </span>
                    </div>

                    <div className="flex items-center gap-4 self-end sm:self-auto">
                      {order.loyaltyDiscount > 0 && (
                        <span className="text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          Loyalty Saved: -{currency}{order.loyaltyDiscount}
                        </span>
                      )}
                      <button
                        onClick={() => handleOpenTracking(order)}
                        className="text-slate-900 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <span>Detailed Tracking</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            <Pagination
              page={pagination?.page || page}
              totalPages={pagination?.totalPages || 0}
              total={pagination?.total || 0}
              onPageChange={handlePageChange}
              loading={loading}
            />
          </div>
        )}
      </div>

      {/* Systematic Live Delivery Tracking Modal */}
      {trackingOrder && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setTrackingOrder(null)}
        >
          <div
            className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden my-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                  Live Courier & Fulfillment Tracking
                </p>
                <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2 mt-0.5">
                  <Truck className="w-5 h-5 text-emerald-400" />
                  <span>Order #{trackingOrder.id.slice(0, 8).toUpperCase()}</span>
                </h3>
              </div>
              <button
                onClick={() => setTrackingOrder(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto text-xs">
              {/* Active Route Box */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold">Logistics Carrier:</span>
                  <span className="font-bold text-slate-900 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200">
                    Nepal Can Move (NCM) Logistics
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold">Courier Consignment / AWB:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {activeDeliveryData?.ncmOrderId || activeDeliveryData?.id || trackingOrder.deliveryJobId || "Processing in Hub"}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold">Destination City:</span>
                  <span className="font-bold text-slate-900">{trackingOrder.address?.city || "Nepal Hub"}</span>
                </div>

                {activeDeliveryData?.originBranchName && activeDeliveryData?.destinationBranchName && (
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
                    <span>Origin: <strong>{activeDeliveryData.originBranchName}</strong></span>
                    <span>→</span>
                    <span>Hub: <strong>{activeDeliveryData.destinationBranchName}</strong></span>
                  </div>
                )}
              </div>

              {/* 5-Step Visual Stepper */}
              <div>
                <h4 className="font-bold text-slate-900 uppercase tracking-wider text-[11px] mb-4">
                  Order Progression Timeline
                </h4>
                {(() => {
                  const stage = calculateTrackingStage(trackingOrder, activeDeliveryData);
                  const steps = [
                    {
                      num: 1,
                      title: "Order Placed & Confirmed",
                      desc: "Your order has been validated and recorded.",
                      time: new Date(trackingOrder.dateNum).toLocaleString(),
                    },
                    {
                      num: 2,
                      title: "Factory Manufacturing & Quality Check",
                      desc: "Assigned to regional apparel hub for sizing, packaging & quality audit.",
                      time: stage >= 2 ? "Completed" : "In Queue",
                    },
                    {
                      num: 3,
                      title: "Dispatched to NCM Logistics",
                      desc: "Handed over to courier hub for transit.",
                      time: activeDeliveryData?.pickedUpAt ? new Date(activeDeliveryData.pickedUpAt).toLocaleString() : stage >= 3 ? "In Transit" : "Pending Handover",
                    },
                    {
                      num: 4,
                      title: "Out for Doorstep Delivery",
                      desc: "Arrived at local city branch and assigned to delivery agent.",
                      time: stage >= 4 ? "Active" : "Pending Arrival",
                    },
                    {
                      num: 5,
                      title: "Delivered to Customer",
                      desc: "Package safely handed to recipient.",
                      time: activeDeliveryData?.deliveredAt ? new Date(activeDeliveryData.deliveredAt).toLocaleString() : stage >= 5 ? "Delivered" : "Estimated 1-3 Days",
                    },
                  ];

                  return (
                    <div className="space-y-4 relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                      {steps.map((step) => {
                        const isDone = stage >= step.num;
                        const isCurrent = stage === step.num;

                        return (
                          <div key={step.num} className="relative flex items-start gap-4 pl-1">
                            <div
                              className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 z-10 ${
                                isDone
                                  ? "bg-emerald-600 text-white ring-4 ring-emerald-50"
                                  : isCurrent
                                  ? "bg-slate-900 text-white ring-4 ring-slate-100"
                                  : "bg-white border-2 border-slate-300 text-slate-400"
                              }`}
                            >
                              {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : step.num}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <p className={`font-bold ${isDone ? "text-slate-900" : "text-slate-500"}`}>
                                  {step.title}
                                </p>
                                <span className="text-[10px] text-slate-400 font-medium">{step.time}</span>
                              </div>
                              <p className="text-[11px] text-slate-500 mt-0.5">{step.desc}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Event Log if available */}
              {activeDeliveryData?.events && activeDeliveryData.events.length > 0 && (
                <div className="pt-4 border-t border-slate-200 space-y-2">
                  <h4 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                    Detailed Carrier Events Log
                  </h4>
                  <div className="space-y-2 bg-slate-50 p-3 rounded-xl max-h-36 overflow-y-auto">
                    {activeDeliveryData.events.map((ev, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] text-slate-600">
                        <span className="font-semibold text-slate-800">
                          {String(ev.toState || ev.eventType || ev.ncmStatus || "").replaceAll("_", " ")}
                        </span>
                        <span className="text-slate-400">{new Date(ev.occurredAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end">
              <button
                onClick={() => setTrackingOrder(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl cursor-pointer transition"
              >
                Close Tracking
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Order Receipt / Invoice Modal */}
      {invoiceOrder && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setInvoiceOrder(null)}
        >
          <div
            className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden my-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header / Actions */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between print:hidden">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-400" />
                <span className="font-bold text-sm">Official Order Receipt</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Receipt</span>
                </button>
                <button
                  onClick={() => setInvoiceOrder(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Invoice Area */}
            <div className="p-6 sm:p-8 space-y-6 text-xs text-slate-700" id="printable-invoice">
              {/* Brand & Invoice Details */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-900">Aama Clothings</h2>
                  <p className="text-xs text-slate-500">Premium Apparel & Sustainable Nepalese Fashion</p>
                  <p className="text-[11px] text-slate-400 mt-1">Kathmandu, Nepal | support@aamaclothings.com</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Order Reference</p>
                  <p className="text-base font-mono font-bold text-slate-900">
                    #{invoiceOrder.id.slice(0, 8).toUpperCase()}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Date: {new Date(invoiceOrder.dateNum).toLocaleDateString()}
                  </p>
                  <p className="text-[11px] font-bold text-emerald-600">
                    Payment: {invoiceOrder.paymentMethod} ({invoiceOrder.payment ? "Paid" : "Due on Delivery"})
                  </p>
                </div>
              </div>

              {/* Customer & Shipping Information */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200/80">
                <div>
                  <h4 className="font-bold text-slate-900 uppercase text-[10px] tracking-wider mb-1">
                    Billed / Delivered To:
                  </h4>
                  <p className="font-bold text-slate-900">
                    {invoiceOrder.address?.firstName} {invoiceOrder.address?.lastName}
                  </p>
                  <p className="text-slate-600">Phone: {invoiceOrder.address?.phone || "N/A"}</p>
                  <p className="text-slate-600">Email: {invoiceOrder.address?.email || "N/A"}</p>
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 uppercase text-[10px] tracking-wider mb-1">
                    Delivery Address:
                  </h4>
                  <p className="text-slate-600">{invoiceOrder.address?.street}</p>
                  <p className="text-slate-600">
                    {invoiceOrder.address?.city}, {invoiceOrder.address?.state} {invoiceOrder.address?.zipcode}
                  </p>
                  <p className="text-slate-600">{invoiceOrder.address?.country || "Nepal"}</p>
                </div>
              </div>

              {/* Itemized Table */}
              <div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b-2 border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                      <th className="py-2.5">Item Description</th>
                      <th className="py-2.5 text-center">Size / Color</th>
                      <th className="py-2.5 text-right">Unit Price</th>
                      <th className="py-2.5 text-center">Qty</th>
                      <th className="py-2.5 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoiceOrder.items.map((item, idx) => {
                      const unitPrice = Number(item.purchasedUnitPrice ?? item.price ?? 0);
                      const qty = Number(item.quantity || 1);
                      const lineTotal = Number(item.lineTotal || unitPrice * qty);

                      return (
                        <tr key={idx} className="text-xs">
                          <td className="py-3 font-semibold text-slate-900">{item.name}</td>
                          <td className="py-3 text-center text-slate-600">
                            {[item.size, item.color].filter(Boolean).join(" / ") || "-"}
                          </td>
                          <td className="py-3 text-right font-mono text-slate-700">
                            {currency}{unitPrice.toLocaleString()}
                          </td>
                          <td className="py-3 text-center font-bold">{qty}</td>
                          <td className="py-3 text-right font-mono font-bold text-slate-900">
                            {currency}{lineTotal.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Financial Calculation */}
              <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="text-[11px] text-slate-500 max-w-xs">
                  <p>Thank you for choosing Aama Clothings.</p>
                  <p>All items covered under our 7-day hassle-free return and exchange policy.</p>
                </div>

                <div className="w-full sm:w-60 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Items Subtotal:</span>
                    <span className="font-mono">
                      {currency}
                      {invoiceOrder.items
                        .reduce((sum, item) => sum + (Number(item.purchasedUnitPrice ?? item.price ?? 0) * Number(item.quantity || 1)), 0)
                        .toLocaleString()}
                    </span>
                  </div>

                  {invoiceOrder.loyaltyDiscount > 0 && (
                    <div className="flex justify-between text-emerald-600 font-semibold">
                      <span>Loyalty / Reward:</span>
                      <span className="font-mono">-{currency}{invoiceOrder.loyaltyDiscount}</span>
                    </div>
                  )}

                  <div className="flex justify-between font-black text-base text-slate-900 pt-2 border-t border-slate-200">
                    <span>Grand Total:</span>
                    <span className="font-mono text-emerald-600">
                      {currency}{invoiceOrder.amount.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end print:hidden">
              <button
                onClick={() => setInvoiceOrder(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl cursor-pointer transition"
              >
                Close Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Orders;
