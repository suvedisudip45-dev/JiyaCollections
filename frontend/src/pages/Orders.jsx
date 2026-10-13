/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { ShopContext } from "../context/ShopContext";
import { clearAuthTokens } from "../auth/tokenStorage";
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
  Star,
} from "lucide-react";

const toCustomerDisplayItems = (items = []) => {
  const displayItems = [];
  const comboBundleRows = new Map();

  items.forEach((item) => {
    if (!item.comboBundleId) {
      displayItems.push(item);
      return;
    }

    let bundle = comboBundleRows.get(item.comboBundleId);
    if (!bundle) {
      bundle = {
        ...item,
        isComboBundle: true,
        name: item.comboBundleName || "Combo Bundle",
        category: item.comboBundleCategory || item.category || "",
        description: item.comboBundleDescription || "",
        image: item.comboBundleImage || item.image,
        quantity: Number(item.comboBundleQuantity || item.quantity || 1),
        purchasedUnitPrice: Number(item.comboBundleUnitPrice || 0),
        price: Number(item.comboBundleUnitPrice || 0),
        lineTotal: 0,
        componentCount: 0,
      };
      comboBundleRows.set(item.comboBundleId, bundle);
      displayItems.push(bundle);
    }
    bundle.lineTotal += Number(item.lineTotal || Number(item.purchasedUnitPrice || item.price || 0) * Number(item.quantity || 1));
    bundle.componentCount += 1;
  });

  return displayItems;
};

const getOrderItemKey = (item) => `${item.productId || item._id || item.id}|${item.size || ""}|${item.color || ""}`;
const getOrderLineKey = (item, index) => `${getOrderItemKey(item)}|${index}`;
const getInitialItemQuantities = (items = []) => Object.fromEntries(
  items.map((item, index) => [getOrderLineKey(item, index), index === 0 ? 1 : 0])
);

const canCancelBeforeNcmHandoff = (order) => {
  const delivery = order.deliveryOrder || order.delivery || {};
  const distributorStatus = String(order.distributorDelivery?.status || "").toLowerCase();
  const status = String(order.status || "").toLowerCase();
  const fulfillmentStatus = String(order.fulfillmentStatus || "").toLowerCase();
  const handedOffStates = new Set([
    "ncm_submission_started", "ncm_created", "pickup_confirmed", "picked_up",
    "in_transit", "arrived_at_destination", "out_for_delivery", "delivered", "return_requested",
  ]);
  return status !== "cancelled" && status !== "delivered" && status !== "returned" &&
    distributorStatus !== "delivered" && distributorStatus !== "returned" &&
    !delivery.ncmOrderId && !handedOffStates.has(String(delivery.state || "").toLowerCase()) &&
    !handedOffStates.has(fulfillmentStatus);
};

const isDeliveredOrder = (order) => String(order.status || "").toLowerCase() === "delivered" ||
  String(order.fulfillmentStatus || "").toLowerCase() === "delivered" ||
  String(order.distributorDelivery?.status || "").toLowerCase() === "delivered" ||
  String((order.deliveryOrder || order.delivery)?.state || "").toUpperCase() === "DELIVERED";

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
  const [exchangeRequests, setExchangeRequests] = useState([]);
  const [exchangeViewRequest, setExchangeViewRequest] = useState(null);
  const [returnRequests, setReturnRequests] = useState([]);
  const [cancelOrderTarget, setCancelOrderTarget] = useState(null);
  const [reviewOrderTarget, setReviewOrderTarget] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [exchangeOrderTarget, setExchangeOrderTarget] = useState(null);
  const [exchangeReasonCode, setExchangeReasonCode] = useState("SIZE_OR_FIT");
  const [exchangeReasonDetails, setExchangeReasonDetails] = useState("");
  const [exchangeQuantities, setExchangeQuantities] = useState({});
  const [replacementVariants, setReplacementVariants] = useState({});
  const [exchangeRequestKey, setExchangeRequestKey] = useState("");
  const [returnOrderTarget, setReturnOrderTarget] = useState(null);
  const [returnReason, setReturnReason] = useState("");
  const [returnQuantities, setReturnQuantities] = useState({});
  const [returnRequestKey, setReturnRequestKey] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

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
            displayItems: toCustomerDisplayItems(items),
            parsedReward,
            dateNum: Number(order.date || 0),
          };
        });

        setOrders(formattedOrders);
        setPagination(response.data.pagination || null);
        try {
          const exchangeResponse = await axios.get(`${backendUrl}/api/returns/exchange/customer`, { headers: { token } });
          if (exchangeResponse.data.success) setExchangeRequests(exchangeResponse.data.requests || []);
          const returnResponse = await axios.get(`${backendUrl}/api/returns/customer/requests`, { headers: { token } });
          if (returnResponse.data.success) setReturnRequests(returnResponse.data.returns || []);
        } catch (exchangeError) {
          console.error("loadReturnExchangeRequests error:", exchangeError);
        }
      } else {
        const msg = (response.data.message || "").toLowerCase();
        if (
          msg.includes("not authorized") ||
          msg.includes("jwt") ||
          msg.includes("user not found") ||
          msg.includes("invalid token")
        ) {
          clearAuthTokens();
          setToken("");
          navigate("/login", { replace: true });
          return;
        }
        toast.error(response.data.message || "Failed to load orders");
      }
    } catch (error) {
      console.error("loadOrderData error:", error);
      if (error.response?.status !== 401) {
        toast.error(error.response?.data?.message || "Failed to load orders");
      }
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

  const submitOrderCancellation = async (event) => {
    event.preventDefault();
    if (!cancelOrderTarget || actionLoading) return;
    setActionLoading(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/order/${cancelOrderTarget.id}/cancel`,
        { reason: cancelReason },
        { headers: { token } }
      );
      if (!response.data.success) throw new Error(response.data.message || "Cancellation failed");
      toast.success(response.data.message || "Order cancelled");
      setCancelOrderTarget(null);
      setCancelReason("");
      await loadOrderData(true);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to cancel this order");
    } finally {
      setActionLoading(false);
    }
  };

  const submitDistributorReview = async (event) => {
    event.preventDefault();
    if (!reviewOrderTarget || actionLoading) return;
    setActionLoading(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/review/distributor/${reviewOrderTarget.id}`,
        { rating: reviewRating, comment: reviewComment },
        { headers: { token } }
      );
      if (!response.data.success) throw new Error(response.data.message || "Review submission failed");
      toast.success(response.data.message || "Hub review saved");
      setReviewOrderTarget(null);
      setReviewComment("");
      await loadOrderData(true);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to save your review");
    } finally {
      setActionLoading(false);
    }
  };

  const submitExchangeRequest = async (event) => {
    event.preventDefault();
    if (!exchangeOrderTarget || actionLoading) return;
    const items = (exchangeOrderTarget.items || [])
      .map((item, index) => ({
        productId: item.productId || item._id || item.id,
        size: item.size || "",
        color: item.color || "",
        quantity: Number(exchangeQuantities[getOrderLineKey(item, index)] || 0),
      }))
      .filter((item) => item.quantity > 0);
    const replacementItems = items.map((item) => {
      const key = `${item.productId}|${item.size}|${item.color}`;
      const replacement = replacementVariants[key] || {};
      return { ...item, size: replacement.size ?? item.size, color: replacement.color ?? item.color };
    });
    if (!items.length) return toast.warn("Select at least one product quantity to exchange.");
    if (exchangeReasonCode === "OTHER" && exchangeReasonDetails.trim().length < 5) return toast.warn("Please explain the reason for your exchange request.");

    setActionLoading(true);
    try {
      const response = await axios.post(`${backendUrl}/api/returns/exchange/customer`, {
        orderId: exchangeOrderTarget.id,
        requestKey: exchangeRequestKey,
        reasonCode: exchangeReasonCode,
        reasonDetails: exchangeReasonDetails,
        items,
        replacementItems,
      }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Exchange request failed");
      toast.success("Exchange request submitted for admin review.");
      setExchangeOrderTarget(null);
      setExchangeReasonDetails("");
      setExchangeQuantities({});
      setExchangeRequestKey("");
      await loadOrderData(true);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to submit exchange request");
    } finally {
      setActionLoading(false);
    }
  };

  const openExchangeRequest = (order) => {
    setExchangeOrderTarget(order);
    setExchangeReasonCode("SIZE_OR_FIT");
    setExchangeReasonDetails("");
    setExchangeQuantities(getInitialItemQuantities(order.items || []));
    setReplacementVariants({});
    setReplacementVariants(Object.fromEntries((order.items || []).map((item) => {
      const productId = item.productId || item._id || item.id;
      const key = `${productId}|${item.size || ""}|${item.color || ""}`;
      return [key, { size: item.size || "", color: item.color || "" }];
    })));
    setExchangeRequestKey(crypto.randomUUID());
  };

  const submitReturnRequest = async (event) => {
    event.preventDefault();
    if (!returnOrderTarget || actionLoading) return;
    const items = (returnOrderTarget.items || [])
      .map((item, index) => ({
        productId: item.productId || item._id || item.id,
        size: item.size || "",
        color: item.color || "",
        quantity: Number(returnQuantities[getOrderLineKey(item, index)] || 0),
      }))
      .filter((item) => item.quantity > 0);
    if (!items.length) return toast.warn("Select at least one product quantity to return.");
    if (returnReason.trim().length < 5) return toast.warn("Please provide a return reason of at least five characters.");

    setActionLoading(true);
    try {
      const response = await axios.post(`${backendUrl}/api/returns/customer/request`, {
        orderId: returnOrderTarget.id,
        requestKey: returnRequestKey,
        reason: returnReason.trim(),
        items,
      }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Return request failed");
      toast.success("Return request submitted for admin review.");
      setReturnOrderTarget(null);
      setReturnReason("");
      setReturnQuantities({});
      setReturnRequestKey("");
      await loadOrderData(true);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to submit return request");
    } finally {
      setActionLoading(false);
    }
  };

  const openReturnRequest = (order) => {
    setReturnOrderTarget(order);
    setReturnReason("");
    setReturnQuantities(getInitialItemQuantities(order.items || []));
    setReturnRequestKey(crypto.randomUUID());
  };


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
    const isSelfDelivery = order.distributorDelivery?.deliveryType === "SELF_DELIVERY";
    setActiveDeliveryData(isSelfDelivery ? order.distributorDelivery : order.delivery || null);

    if (isSelfDelivery) {
      setTrackingLoading(false);
      return;
    }

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
  const getStatusBadge = (status = "", fulfillmentStatus = "", order = {}) => {
    const s = status.toLowerCase();
    const f = (fulfillmentStatus || "").toLowerCase();
    const distributorStatus = String(order.distributorDelivery?.status || "").toLowerCase().replaceAll(" ", "_");

    if (order.distributorDelivery?.deliveryType === "SELF_DELIVERY") {
      if (distributorStatus === "delivered") {
        return { label: "Delivered by Distributor", bg: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500", icon: CheckCircle2 };
      }
      if (distributorStatus === "on_the_way") {
        return { label: "Out for Delivery", bg: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500", icon: Truck };
      }
      if (distributorStatus === "dispatched") {
        return { label: "Dispatched by Distributor", bg: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-500", icon: Box };
      }
      if (["accepted", "packed", "ready_for_pickup"].includes(distributorStatus)) {
        return { label: "Preparing at Distributor Hub", bg: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500 animate-pulse", icon: Clock };
      }
    }

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
    if (order.distributorDelivery?.deliveryType === "SELF_DELIVERY") {
      const distributorStatus = String(order.distributorDelivery.status || "").toLowerCase().replaceAll(" ", "_");
      if (distributorStatus === "delivered") return 5;
      if (distributorStatus === "on_the_way") return 4;
      if (distributorStatus === "dispatched") return 3;
      if (["accepted", "packed", "ready_for_pickup"].includes(distributorStatus)) return 2;
      return 1;
    }
    const s = (order.status || "").toLowerCase();
    const f = (order.fulfillmentStatus || "").toLowerCase();
    const dState = (deliveryData?.state || deliveryData?.ncmStatus || "").toLowerCase();

    if (s.includes("delivered") || f.includes("delivered") || dState.includes("delivered")) return 5;
    if (s.includes("out for delivery") || dState.includes("out_for_delivery") || dState.includes("reached")) return 4;
    if (s.includes("shipped") || f.includes("in_transit") || dState.includes("in_transit") || dState.includes("dispatched") || dState.includes("picked_up")) return 3;
    if (f.includes("manufacturing") || f.includes("quality_check") || f.includes("packed") || f.includes("assigned") || s.includes("processing")) return 2;
    return 1; // Order Placed
  };

  const invoiceExchanges = invoiceOrder
    ? exchangeRequests.filter((request) => request.orderId === invoiceOrder.id)
    : [];
  const invoiceReturns = invoiceOrder
    ? returnRequests.filter((request) => request.orderId === invoiceOrder.id)
    : [];
  const invoiceHasActiveExchange = invoiceExchanges.some(
    (request) => !["REJECTED", "CANCELLED"].includes(request.status)
  );
  const invoiceHasActiveReturn = invoiceReturns.some(
    (request) => !["REJECTED_BY_ADMIN", "REFUNDED", "INSPECTED_FAILED"].includes(request.lifecycleStatus)
  );

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
              to="/shop"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition shadow-sm"
            >
              <span>Explore Shop</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
              <table className="w-full min-w-[1050px] border-collapse text-left">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Order ID</th><th className="px-4 py-3">Created At</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Order Status</th><th className="px-4 py-3 text-right">Total Amount</th><th className="px-4 py-3">Payment Status</th><th className="px-4 py-3">Delivered Date</th><th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredOrders.map((order) => {
                    const statusBadge = getStatusBadge(order.status, order.fulfillmentStatus, order);
                    const displayItems = order.displayItems || toCustomerDisplayItems(order.items || []);
                    const productNames = displayItems.map((item) => item.name || "Product");
                    const deliveredAt = order.distributorDelivery?.deliveredAt || order.deliveryOrder?.deliveredAt || order.delivery?.deliveredAt;
                    const paymentLabel = order.payment ? "Paid" : /cod|cash/i.test(String(order.paymentMethod || "")) ? "Due on delivery" : "Pending";

                    return (
                      <tr key={order.id} className="align-top hover:bg-slate-50/70">
                        <td className="whitespace-nowrap px-4 py-4 font-mono font-bold text-slate-900">#{order.id.slice(0, 8).toUpperCase()}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-slate-600">{new Date(order.dateNum).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
                        <td className="max-w-56 px-4 py-4"><p className="line-clamp-2 font-semibold text-slate-800">{productNames[0] || "Order items"}</p>{productNames.length > 1 && <p className="mt-1 text-[10px] text-slate-500">+{productNames.length - 1} more product{productNames.length === 2 ? "" : "s"}</p>}</td>
                        <td className="whitespace-nowrap px-4 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusBadge.bg}`}><span className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot}`} />{statusBadge.label}</span></td>
                        <td className="whitespace-nowrap px-4 py-4 text-right font-bold text-slate-900">{currency}{Number(order.amount || 0).toLocaleString()}</td>
                        <td className="whitespace-nowrap px-4 py-4"><span className={`font-semibold ${order.payment ? "text-emerald-700" : "text-amber-700"}`}>{paymentLabel}</span><span className="mt-0.5 block text-[10px] text-slate-500">{order.paymentMethod || "Payment"}</span></td>
                        <td className="whitespace-nowrap px-4 py-4 text-slate-600">{deliveredAt ? new Date(deliveredAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                        <td className="px-4 py-4">
                          <button type="button" onClick={() => setInvoiceOrder(order)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-slate-700">View</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>            <Pagination
              page={pagination?.page || page}
              totalPages={pagination?.totalPages || 0}
              total={pagination?.total || 0}
              onPageChange={handlePageChange}
              loading={loading}
            />
          </div>
        )}
      </div>

      {cancelOrderTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !actionLoading && setCancelOrderTarget(null)}>
          <form onSubmit={submitOrderCancellation} onClick={(event) => event.stopPropagation()} className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-base font-bold text-slate-900">Cancel order</h2><p className="text-xs text-slate-500 mt-1">#{cancelOrderTarget.id.slice(0, 8).toUpperCase()}</p></div>
              <button type="button" disabled={actionLoading} onClick={() => setCancelOrderTarget(null)} className="p-1 text-slate-400 hover:text-slate-800" aria-label="Close"> <X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-slate-600">Cancellation is available only before NCM accepts the delivery order. After handoff, contact support to request an eligible exchange.</p>
            <label className="block text-xs font-semibold text-slate-700">Reason
              <textarea required minLength={3} maxLength={1000} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={3} className="mt-1 w-full border border-slate-300 rounded-lg p-3 font-normal" placeholder="Why are you cancelling this order?" />
            </label>
            <div className="flex gap-2"><button type="button" disabled={actionLoading} onClick={() => setCancelOrderTarget(null)} className="flex-1 py-2.5 border border-slate-300 rounded-lg text-xs font-bold">Keep order</button><button type="submit" disabled={actionLoading} className="flex-1 py-2.5 bg-rose-700 text-white rounded-lg text-xs font-bold disabled:opacity-50">{actionLoading ? "Cancelling..." : "Confirm cancellation"}</button></div>
          </form>
        </div>
      )}

      {reviewOrderTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !actionLoading && setReviewOrderTarget(null)}>
          <form onSubmit={submitDistributorReview} onClick={(event) => event.stopPropagation()} className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Rate your delivery hub</h2>
                <p className="text-xs text-slate-500 mt-1">Order #{reviewOrderTarget.id.slice(0, 8).toUpperCase()}</p>
              </div>
              <button type="button" disabled={actionLoading} onClick={() => setReviewOrderTarget(null)} className="p-1 text-slate-400 hover:text-slate-800" aria-label="Close review form"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-slate-600">Your verified order rating helps choose a reliable hub when no stocked hub serves the customer’s province.</p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">Your rating</label>
              <div className="flex gap-2" role="radiogroup" aria-label="Hub rating">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    role="radio"
                    aria-checked={reviewRating === rating}
                    aria-label={`${rating} star${rating === 1 ? "" : "s"}`}
                    onClick={() => setReviewRating(rating)}
                    className={`p-1 rounded focus:outline-none focus:ring-2 focus:ring-amber-400 ${reviewRating >= rating ? "text-amber-500" : "text-slate-300"}`}
                  >
                    <Star className="w-7 h-7 fill-current" />
                  </button>
                ))}
              </div>
            </div>
            <label className="block text-xs font-semibold text-slate-700">Review (optional)
              <textarea maxLength={2000} value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} rows={4} className="mt-1 w-full border border-slate-300 rounded-lg p-3 font-normal" placeholder="Share how your hub handled the order." />
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={actionLoading} onClick={() => setReviewOrderTarget(null)} className="flex-1 py-2.5 border border-slate-300 rounded-lg text-xs font-bold">Cancel</button>
              <button type="submit" disabled={actionLoading} className="flex-1 py-2.5 bg-slate-900 text-white rounded-lg text-xs font-bold disabled:opacity-50">{actionLoading ? "Saving..." : "Save review"}</button>
            </div>
          </form>
        </div>
      )}

      {exchangeOrderTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !actionLoading && setExchangeOrderTarget(null)}>
          <form onSubmit={submitExchangeRequest} onClick={(event) => event.stopPropagation()} className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-base font-bold text-slate-900">Request an exchange</h2><p className="text-xs text-slate-500 mt-1">Order #{exchangeOrderTarget.id.slice(0, 8).toUpperCase()}</p></div>
              <button type="button" disabled={actionLoading} onClick={() => setExchangeOrderTarget(null)} className="p-1 text-slate-400 hover:text-slate-800" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-slate-600">The first product and its purchased size/color are selected by default. Set another product’s quantity to choose it; you can include multiple items. Admin approval is required. The marketing card must remain unscanned through pickup of the original product.</p>
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">Your replacement variant is recorded and stock-checked. NCM&apos;s exchange endpoint accepts only the original order ID, so the admin must verify the generated replacement waybill matches your selected variant.</p>
            <div className="space-y-2">
              {(exchangeOrderTarget.items || []).map((item, index) => {
                const key = getOrderItemKey(item);
                const lineKey = getOrderLineKey(item, index);
                const selected = Number(exchangeQuantities[lineKey] || 0) > 0;
                const replacement = replacementVariants[key] || { size: item.size || "", color: item.color || "" };
                const variants = Array.isArray(item.variants) ? item.variants : [];
                const sizes = [...new Set([...(Array.isArray(item.sizes) ? item.sizes : variants.map((variant) => variant.size)), item.size].filter(Boolean))];
                const colors = [...new Set([...(Array.isArray(item.colors) ? item.colors : variants.map((variant) => variant.color)), item.color].filter(Boolean))];
                return (
                  <div key={`${key}-${index}`} className={`grid gap-3 rounded-lg border p-3 transition-colors sm:grid-cols-[1fr_92px] ${selected ? "border-blue-300 bg-blue-50/40" : "border-slate-200"}`}>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">{item.name || "Product"}</p>
                      <p className="text-[11px] text-slate-500">Purchased {item.size || "One size"}{item.color ? ` · ${item.color}` : ""} · Qty {Number(item.quantity || 1)}</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-[10px] font-semibold text-slate-500">Replacement size<select value={replacement.size} onChange={(event) => setReplacementVariants({ ...replacementVariants, [key]: { ...replacement, size: event.target.value } })} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs text-slate-900"><option value="">One size</option>{sizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
                        <label className="text-[10px] font-semibold text-slate-500">Replacement color<select value={replacement.color} onChange={(event) => setReplacementVariants({ ...replacementVariants, [key]: { ...replacement, color: event.target.value } })} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs text-slate-900"><option value="">Default color</option>{colors.map((color) => <option key={color} value={color}>{color}</option>)}</select></label>
                      </div>
                    </div>
                    <label className="text-[10px] font-semibold text-slate-500">Qty<input type="number" min="0" max={Number(item.quantity || 1)} step="1" value={exchangeQuantities[lineKey] ?? 0} onChange={(event) => setExchangeQuantities({ ...exchangeQuantities, [lineKey]: event.target.value })} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs text-slate-900" /></label>
                  </div>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700">Cause
                <select value={exchangeReasonCode} onChange={(event) => setExchangeReasonCode(event.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 font-normal">
                  <option value="SIZE_OR_FIT">Size or fit</option><option value="DEFECTIVE">Defective product</option><option value="WRONG_ITEM">Wrong item</option><option value="DAMAGED_IN_TRANSIT">Damaged in transit</option><option value="OTHER">Other</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">Details{exchangeReasonCode === "OTHER" ? " *" : ""}
                <textarea value={exchangeReasonDetails} onChange={(event) => setExchangeReasonDetails(event.target.value)} required={exchangeReasonCode === "OTHER"} maxLength={1000} rows={2} className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 font-normal" placeholder="Add details for the admin" />
              </label>
            </div>
            <div className="flex gap-2"><button type="button" disabled={actionLoading} onClick={() => setExchangeOrderTarget(null)} className="flex-1 py-2.5 border border-slate-300 rounded-lg text-xs font-bold">Back</button><button type="submit" disabled={actionLoading} className="flex-1 py-2.5 bg-slate-900 text-white rounded-lg text-xs font-bold disabled:opacity-50">{actionLoading ? "Submitting..." : "Submit for review"}</button></div>
          </form>
        </div>
      )}

      {returnOrderTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !actionLoading && setReturnOrderTarget(null)}>
          <form onSubmit={submitReturnRequest} onClick={(event) => event.stopPropagation()} className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-base font-bold text-slate-900">Request a return</h2><p className="text-xs text-slate-500 mt-1">Order #{returnOrderTarget.id.slice(0, 8).toUpperCase()}</p></div>
              <button type="button" disabled={actionLoading} onClick={() => setReturnOrderTarget(null)} className="p-1 text-slate-400 hover:text-slate-800" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-slate-600">Your request must be approved by an admin. Refund and stock adjustments happen only after the parcel is received and inspected.</p>
            <p className="text-[11px] text-slate-500">The first product and its purchased size/color are selected by default. Change quantities to choose another product or include more than one.</p>
            <div className="space-y-2">
              {(returnOrderTarget.items || []).map((item, index) => {
                const key = getOrderItemKey(item);
                const lineKey = getOrderLineKey(item, index);
                const selected = Number(returnQuantities[lineKey] || 0) > 0;
                return (
                  <div key={`${key}-${index}`} className={`grid grid-cols-[1fr_92px] items-center gap-3 rounded-lg border p-3 transition-colors ${selected ? "border-rose-300 bg-rose-50/40" : "border-slate-200"}`}>
                    <div><p className="text-xs font-semibold text-slate-800">{item.name || "Product"}</p><p className="text-[11px] text-slate-500">{item.size || "One size"}{item.color ? ` · ${item.color}` : ""} · Purchased {Number(item.quantity || 1)}</p></div>
                    <label className="text-[10px] font-semibold text-slate-500">Qty<input type="number" min="0" max={Number(item.quantity || 1)} step="1" value={returnQuantities[lineKey] ?? 0} onChange={(event) => setReturnQuantities({ ...returnQuantities, [lineKey]: event.target.value })} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs text-slate-900" /></label>
                  </div>
                );
              })}
            </div>
            <label className="block text-xs font-semibold text-slate-700">Cause of return
              <textarea required minLength={5} maxLength={2000} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} rows={3} className="mt-1 w-full border border-slate-300 rounded-lg p-3 font-normal" placeholder="Describe why you are returning these items" />
            </label>
            <div className="flex gap-2"><button type="button" disabled={actionLoading} onClick={() => setReturnOrderTarget(null)} className="flex-1 py-2.5 border border-slate-300 rounded-lg text-xs font-bold">Back</button><button type="submit" disabled={actionLoading} className="flex-1 py-2.5 bg-rose-700 text-white rounded-lg text-xs font-bold disabled:opacity-50">{actionLoading ? "Submitting..." : "Submit for review"}</button></div>
          </form>
        </div>
      )}

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
                  Live Delivery Tracking
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
              {(() => {
                const distributorDelivery = trackingOrder.distributorDelivery;
                const isSelfDelivery = distributorDelivery?.deliveryType === "SELF_DELIVERY";
                const deliveryStatus = String(distributorDelivery?.status || trackingOrder.status || "Processing").replaceAll("_", " ");
                const isCod = /cod|cash/i.test(String(trackingOrder.paymentMethod || ""));
                return (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold">Delivery Provider:</span>
                  <span className={`font-bold px-2 py-0.5 rounded border ${
                    isSelfDelivery
                      ? "text-indigo-700 bg-indigo-50 border-indigo-200"
                      : "text-emerald-700 bg-emerald-50 border-emerald-200"
                  }`}>
                    {isSelfDelivery
                      ? `${distributorDelivery.distributor?.name || "Local Distributor"} · Self delivery`
                      : "Nepal Can Move (NCM) Logistics"}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold">{isSelfDelivery ? "Delivery Status:" : "Courier Consignment / AWB:"}</span>
                  <span className="font-mono font-bold text-slate-900">
                    {isSelfDelivery
                      ? deliveryStatus
                      : activeDeliveryData?.ncmOrderId || activeDeliveryData?.id || trackingOrder.deliveryJobId || "Processing in Hub"}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold">Destination City:</span>
                  <span className="font-bold text-slate-900">{trackingOrder.address?.city || "Nepal Hub"}</span>
                </div>

                {!isSelfDelivery && activeDeliveryData?.originBranchName && activeDeliveryData?.destinationBranchName && (
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
                    <span>Origin: <strong>{activeDeliveryData.originBranchName}</strong></span>
                    <span>→</span>
                    <span>Hub: <strong>{activeDeliveryData.destinationBranchName}</strong></span>
                  </div>
                )}
                {isCod && (
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 font-semibold">Cash on Delivery:</span>
                    <strong className={trackingOrder.payment ? "text-emerald-700" : "text-amber-700"}>
                      {trackingOrder.payment
                        ? isSelfDelivery && distributorDelivery?.status?.toLowerCase() === "delivered"
                          ? "Collected by distributor"
                          : "Paid"
                        : "Due on delivery"}
                    </strong>
                  </div>
                )}
              </div>
                );
              })()}

              {/* 5-Step Visual Stepper */}
              <div>
                <h4 className="font-bold text-slate-900 uppercase tracking-wider text-[11px] mb-4">
                  Order Progression Timeline
                </h4>
                {(() => {
                  const stage = calculateTrackingStage(trackingOrder, activeDeliveryData);
                  const isSelfDelivery = trackingOrder.distributorDelivery?.deliveryType === "SELF_DELIVERY";
                  const distributorDelivery = trackingOrder.distributorDelivery || {};
                  const formatTime = (value, fallback) => value ? new Date(value).toLocaleString() : fallback;
                  const steps = isSelfDelivery ? [
                    {
                      num: 1,
                      title: "Order Placed & Confirmed",
                      desc: "Your order has been validated and recorded.",
                      time: new Date(trackingOrder.dateNum).toLocaleString(),
                    },
                    {
                      num: 2,
                      title: "Preparing at Distributor Hub",
                      desc: `Your order is prepared for local delivery by ${distributorDelivery.distributor?.name || "the assigned distributor"}.`,
                      time: stage >= 2 ? "Completed" : "Pending",
                    },
                    {
                      num: 3,
                      title: "Dispatched by Distributor",
                      desc: "The distributor has dispatched your order for local delivery.",
                      time: formatTime(distributorDelivery.dispatchedAt, stage >= 3 ? "Dispatched" : "Pending dispatch"),
                    },
                    {
                      num: 4,
                      title: "Out for Delivery",
                      desc: "The distributor is delivering your order to the delivery address.",
                      time: formatTime(distributorDelivery.onTheWayAt, stage >= 4 ? "Out for delivery" : "Pending"),
                    },
                    {
                      num: 5,
                      title: "Delivered to Customer",
                      desc: "Your order has been handed to you.",
                      time: formatTime(distributorDelivery.deliveredAt, stage >= 5 ? "Delivered" : "Pending delivery"),
                    },
                  ] : [
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
              {trackingOrder.distributorDelivery?.deliveryType !== "SELF_DELIVERY" &&
                activeDeliveryData?.events && activeDeliveryData.events.length > 0 && (
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

      {exchangeViewRequest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setExchangeViewRequest(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="exchange-details-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 p-5">
              <div>
                <h2 id="exchange-details-title" className="text-base font-bold text-slate-900">Exchange request details</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Order #{String(exchangeViewRequest.orderId || "").slice(0, 8).toUpperCase()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExchangeViewRequest(null)}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                aria-label="Close exchange details"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="space-y-5 p-5 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</p>
                  <p className="mt-1 font-bold text-slate-900">{String(exchangeViewRequest.status || "Requested").replace(/_/g, " ")}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Requested</p>
                  <p className="mt-1 font-semibold text-slate-800">{exchangeViewRequest.createdAt ? new Date(exchangeViewRequest.createdAt).toLocaleString() : "—"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Reason</p>
                  <p className="mt-1 font-semibold text-slate-800">{String(exchangeViewRequest.reasonCode || "—").replace(/_/g, " ")}</p>
                  {exchangeViewRequest.reasonDetails && <p className="mt-1 text-slate-600">{exchangeViewRequest.reasonDetails}</p>}
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Price difference</p>
                  <p className="mt-1 font-semibold text-slate-800">{currency}{Number(exchangeViewRequest.priceDifference || 0).toLocaleString()}</p>
                </div>
              </div>

              {[["Items requested for exchange", exchangeViewRequest.items], ["Replacement items", exchangeViewRequest.replacementItems]].map(([title, items]) => (
                <div key={title}>
                  <h3 className="mb-2 font-bold text-slate-900">{title}</h3>
                  {Array.isArray(items) && items.length ? (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                          <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">Size / Color</th><th className="px-3 py-2 text-right">Quantity</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {items.map((item, index) => (
                            <tr key={`${item.productId || item.name || "item"}-${index}`}>
                              <td className="px-3 py-2 font-semibold text-slate-800">{item.name || item.productName || item.productId || "Product"}</td>
                              <td className="px-3 py-2 text-slate-600">{[item.size, item.color].filter(Boolean).join(" / ") || "—"}</td>
                              <td className="px-3 py-2 text-right font-bold text-slate-800">{item.quantity || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="rounded-xl bg-slate-50 p-3 text-slate-500">No item details available.</p>}
                </div>
              ))}

              {(exchangeViewRequest.ncmSubmissionError || exchangeViewRequest.decisionReason || exchangeViewRequest.ncmTotalCharge > 0) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <h3 className="font-bold text-amber-950">Delivery and review notes</h3>
                  {exchangeViewRequest.decisionReason && <p className="mt-1 text-amber-900">{exchangeViewRequest.decisionReason}</p>}
                  {exchangeViewRequest.ncmSubmissionError && <p className="mt-1 text-rose-800">Carrier update: {exchangeViewRequest.ncmSubmissionError}</p>}
                  {Number(exchangeViewRequest.ncmTotalCharge || 0) > 0 && <p className="mt-1 text-amber-900">Carrier charges: {currency}{Number(exchangeViewRequest.ncmTotalCharge).toLocaleString()} ({exchangeViewRequest.ncmChargePayer || "payer not specified"})</p>}
                </div>
              )}

              {Array.isArray(exchangeViewRequest.events) && exchangeViewRequest.events.length > 0 && (
                <div>
                  <h3 className="mb-2 font-bold text-slate-900">Request history</h3>
                  <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
                    {exchangeViewRequest.events.map((event, index) => (
                      <li key={`${event.eventType || event.toStatus || "event"}-${index}`} className="relative">
                        <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-slate-400" />
                        <p className="font-semibold text-slate-800">{String(event.toStatus || event.eventType || "Update").replace(/_/g, " ")}</p>
                        {event.reason && <p className="mt-0.5 text-slate-600">{event.reason}</p>}
                        <p className="mt-0.5 text-[10px] text-slate-400">{event.occurredAt ? new Date(event.occurredAt).toLocaleString() : ""}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </section>
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
                <span className="font-bold text-sm">Order Details & Receipt</span>
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
                    {(invoiceOrder.displayItems || toCustomerDisplayItems(invoiceOrder.items)).map((item, idx) => {
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
                      {(invoiceOrder.displayItems || toCustomerDisplayItems(invoiceOrder.items))
                        .reduce((sum, item) => sum + Number(item.lineTotal || (Number(item.purchasedUnitPrice ?? item.price ?? 0) * Number(item.quantity || 1))), 0)
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

            <div className="border-t border-slate-200 bg-slate-50 p-4 print:hidden">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const order = invoiceOrder;
                    setInvoiceOrder(null);
                    handleOpenTracking(order);
                  }}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700"
                >
                  <span className="inline-flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" />Track order</span>
                </button>
                {canCancelBeforeNcmHandoff(invoiceOrder) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCancelOrderTarget(invoiceOrder);
                      setCancelReason("");
                      setInvoiceOrder(null);
                    }}
                    className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50"
                  >
                    Cancel order
                  </button>
                )}
                {isDeliveredOrder(invoiceOrder) && !invoiceHasActiveExchange && (
                  <button
                    type="button"
                    onClick={() => {
                      openExchangeRequest(invoiceOrder);
                      setInvoiceOrder(null);
                    }}
                    className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-50"
                  >
                    Request exchange
                  </button>
                )}
                {isDeliveredOrder(invoiceOrder) && !invoiceHasActiveReturn && (
                  <button
                    type="button"
                    onClick={() => {
                      openReturnRequest(invoiceOrder);
                      setInvoiceOrder(null);
                    }}
                    className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-50"
                  >
                    Request return
                  </button>
                )}
                {isDeliveredOrder(invoiceOrder) && Boolean(invoiceOrder.assignedDistributorId) && (
                  <button
                    type="button"
                    onClick={() => {
                      setReviewOrderTarget(invoiceOrder);
                      setReviewRating(invoiceOrder.distributorReview?.rating || 5);
                      setReviewComment(invoiceOrder.distributorReview?.comment || "");
                      setInvoiceOrder(null);
                    }}
                    className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50"
                  >
                    {invoiceOrder.distributorReview ? "View / edit hub rating" : "Rate hub"}
                  </button>
                )}
                {invoiceExchanges.map((request) => (
                  <button
                    key={request.id}
                    type="button"
                    onClick={() => {
                      setExchangeViewRequest(request);
                      setInvoiceOrder(null);
                    }}
                    className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-indigo-800 hover:bg-indigo-50"
                  >
                    View exchange · {String(request.status || "REQUESTED").replace(/_/g, " ")}
                  </button>
                ))}
              </div>
              {invoiceReturns.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
                  {invoiceReturns.map((request) => (
                    <span key={request.id}>
                      Return request: <strong>{String(request.lifecycleStatus || request.status || "REQUESTED").replace(/_/g, " ")}</strong>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setInvoiceOrder(null)}
                  className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Orders;
