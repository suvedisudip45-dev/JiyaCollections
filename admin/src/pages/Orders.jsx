/* eslint-disable no-undef */
/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";
import { assets } from "../assets/assets";
import ShippingLabelModal from "../components/ShippingLabelModal";
import { Link } from "react-router-dom";

const ADMIN_ORDER_STATUSES = [
  "All",
  "Order Placed",
  "Packing",
  "Shipped",
  "Out for delivery",
  "Delivered",
];

// ─── Status Badge Styles ──────────────────────────────────────────────────────
const getStatusBadgeStyle = (status) => {
  switch (status) {
    case "Order Placed":      return "bg-blue-50 text-blue-700 border-blue-200";
    case "Packing":           return "bg-amber-50 text-amber-700 border-amber-200";
    case "Shipped":           return "bg-purple-50 text-purple-700 border-purple-200";
    case "Out for delivery":  return "bg-cyan-50 text-cyan-700 border-cyan-200";
    case "Delivered":         return "bg-emerald-50 text-emerald-700 border-emerald-200";
    default:                  return "bg-gray-50 text-gray-700 border-gray-200";
  }
};

// ─── Fulfillment Status Styles (Hub Monitor) ──────────────────────────────────
const getFulfillmentBadge = (fs) => {
  switch ((fs || "").toUpperCase()) {
    case "PENDING_ASSIGNMENT":        return "bg-rose-50 text-rose-700 border-rose-200";
    case "ASSIGNED":                   return "bg-amber-50 text-amber-700 border-amber-200";
    case "ACCEPTED":                   return "bg-blue-50 text-blue-700 border-blue-200";
    case "MANUFACTURING":
    case "PREPARING":                  return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "QUALITY_CHECK":
    case "PACKAGED":
    case "PACKED":                     return "bg-purple-50 text-purple-700 border-purple-200";
    case "SUBMISSION_PENDING":         return "bg-orange-50 text-orange-700 border-orange-200";
    case "READY_FOR_PICKUP":           return "bg-orange-50 text-orange-700 border-orange-200";
    case "NCM_CREATED":
    case "PICKUP_ORDER_CREATED":       return "bg-orange-50 text-orange-700 border-orange-200";
    case "PICKED_UP":
    case "PICKUP_CONFIRMED":           return "bg-teal-50 text-teal-700 border-teal-200";
    case "IN_TRANSIT":                 return "bg-sky-50 text-sky-700 border-sky-200";
    case "ARRIVED_AT_DESTINATION":     return "bg-cyan-50 text-cyan-700 border-cyan-200";
    case "OUT_FOR_DELIVERY":           return "bg-violet-50 text-violet-700 border-violet-200";
    case "DELIVERED":                  return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "RETURN_REQUESTED":           return "bg-rose-50 text-rose-700 border-rose-200";
    case "FAILED":                     return "bg-red-50 text-red-700 border-red-200";
    default:                           return "bg-gray-50 text-gray-700 border-gray-200";
  }
};

const getFulfillmentLabel = (fs) => {
  switch ((fs || "").toUpperCase()) {
    case "PENDING_ASSIGNMENT":        return "Pending Hub";
    case "ASSIGNED":                   return "Hub Assigned";
    case "ACCEPTED":                   return "Hub Accepted";
    case "MANUFACTURING":
    case "PREPARING":                  return "In Production";
    case "QUALITY_CHECK":              return "Quality Check";
    case "PACKAGED":
    case "PACKED":                     return "Packaged";
    case "SUBMISSION_PENDING":         return "NCM Submitting";
    case "NCM_CREATED":
    case "PICKUP_ORDER_CREATED":       return "Courier Booked";
    case "READY_FOR_PICKUP":           return "Ready for Pickup";
    case "PICKED_UP":
    case "PICKUP_CONFIRMED":           return "Picked Up";
    case "IN_TRANSIT":                 return "In Transit";
    case "ARRIVED_AT_DESTINATION":     return "Arrived at Hub";
    case "OUT_FOR_DELIVERY":           return "Out for Delivery";
    case "DELIVERED":                  return "Delivered";
    case "RETURN_REQUESTED":           return "Return Requested";
    case "FAILED":                     return "Failed";
    default:                           return fs ? fs.replace(/_/g, " ") : "Unknown";
  }
};

// ─── ORDER CARD — Admin-managed (with full controls) ─────────────────────────
const AdminOrderCard = ({
  order,
  isSelected,
  toggleSelect,
  onPrint,
  customerLoyaltyMap,
}) => {
  const customerFullName = (order.address?.firstName || "")
    .concat(" ")
    .concat(order.address?.lastName || "")
    .trim();

  const isNewOrder = order.status === "Order Placed";
  const orderDateStr = new Date(order.date).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const itemsSubtotal = (order.items || []).reduce(
    (acc, it) => acc + (Number(it.purchasedUnitPrice ?? it.price ?? 0) * Number(it.quantity || 1)),
    0
  );
  const deliveryFee = Math.max(0, Math.round(Number(order.amount || 0) - itemsSubtotal));

  return (
    <div
      className={`bg-white rounded-xl border transition-all shadow-xs hover:shadow-md ${
        isSelected
          ? "border-indigo-500 ring-2 ring-indigo-200"
          : isNewOrder
          ? "border-blue-300 ring-1 ring-blue-100"
          : "border-gray-200"
      }`}
    >
      {/* Top Bar */}
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60 rounded-t-xl flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelect(order._id)}
            className="rounded text-indigo-600 cursor-pointer w-4 h-4"
          />
          {isNewOrder && (
            <span className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-extrabold rounded-md uppercase tracking-wider animate-pulse">
              NEW
            </span>
          )}
          <span className="font-mono font-bold text-gray-900">
            #{order._id?.slice(-8).toUpperCase()}
          </span>
          <span className="text-gray-400">•</span>
          <span className="text-gray-500">{orderDateStr}</span>
          {order.address?.source && (
            <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-md text-[10px] font-bold">
              {order.address.source}
              {order.address.socialUsername && ` (@${order.address.socialUsername})`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPrint([order])}
            className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-md text-xs font-semibold shadow-2xs transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print Courier Slip
          </button>

          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${getStatusBadgeStyle(order.status)}`}>
            {order.status}
          </span>

        </div>
      </div>

      {/* Body */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-12 gap-5 text-xs">
        {/* Items */}
        <div className="md:col-span-5 space-y-2 border-b md:border-b-0 md:border-r border-gray-100 pb-4 md:pb-0 md:pr-4">
          <div className="flex items-center gap-2 mb-2">
            <img className="w-6 h-6 opacity-70" src={assets.parcel_icon} alt="Parcel" />
            <span className="font-bold text-gray-800 uppercase text-[11px] tracking-wide">
              Order Items ({order.items?.length || 0})
            </span>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {order.items?.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-gray-50/80 border border-gray-100">
                <div className="flex items-center gap-2.5">
                  {item.image?.[0] ? (
                    <img src={item.image[0]} alt={item.name} className="w-9 h-9 object-cover rounded border border-gray-200" />
                  ) : (
                    <div className="w-9 h-9 bg-gray-200 rounded flex items-center justify-center text-[10px] text-gray-500">Item</div>
                  )}
                  <div>
                    <p className="font-bold text-gray-800 line-clamp-1">{item.name}</p>
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                      <span>Qty: <strong className="text-gray-700">{item.quantity}</strong></span>
                      {item.size && <span className="bg-white border border-gray-200 px-1 py-0.2 rounded text-[10px] font-semibold text-gray-700">{item.size}</span>}
                      {item.color && <span className="bg-white border border-gray-200 px-1 py-0.2 rounded text-[10px] font-medium text-gray-600">{item.color}</span>}
                    </div>
                  </div>
                </div>
                <div className="text-right whitespace-nowrap">
                  <p className="font-bold text-gray-800">{currency} {((item.purchasedUnitPrice || item.price || 0) * (item.quantity || 1))}</p>
                  <p className="text-[10px] text-gray-500">{item.quantity} x {currency}{item.purchasedUnitPrice || item.price}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Customer */}
        <div className="md:col-span-4 border-b md:border-b-0 md:border-r border-gray-100 pb-4 md:pb-0 md:pr-4">
          <span className="font-bold text-gray-800 uppercase text-[11px] tracking-wide block mb-2">Recipient & Destination</span>
          <div className="space-y-1 text-gray-700">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-extrabold text-gray-900 text-sm">{customerFullName}</p>
              {(() => {
                const lvl = customerLoyaltyMap[order.userId] || customerLoyaltyMap[order.address?.email?.toLowerCase()];
                if (!lvl) return null;
                return (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1"
                    style={{ backgroundColor: `${lvl.color || "#3B82F6"}15`, color: lvl.color || "#3B82F6", borderColor: `${lvl.color || "#3B82F6"}40` }}>
                    <span>{lvl.badgeIcon || "⭐"}</span><span>{lvl.name}</span>
                  </span>
                );
              })()}
            </div>
            <p className="font-semibold text-indigo-700">📞 {order.address?.phone}</p>
            {order.address?.email && <p className="text-gray-500 text-[11px]">✉️ {order.address.email}</p>}
            {order.address?.source && (
              <p className="text-[11px] text-purple-700 font-semibold">Channel: <strong>{order.address.source}</strong>
                {order.address.socialUsername && <span className="text-purple-500"> (@{order.address.socialUsername})</span>}
              </p>
            )}
            <p className="text-gray-700 pt-1">{order.address?.street}</p>
            {order.address?.landmark && (
              <div className="my-1.5 p-1.5 bg-yellow-50/80 border border-yellow-300 rounded text-yellow-900 text-[11px] font-medium flex items-start gap-1">
                <div><span className="font-bold">Landmark: </span>{order.address.landmark}</div>
              </div>
            )}
            <p className="text-gray-600 font-medium">{order.address?.city}, {order.address?.state}</p>
            <p className="text-gray-500 text-[11px]">{order.address?.country || "Nepal"} {order.address?.zipcode ? `(${order.address.zipcode})` : ""}</p>
          </div>
        </div>

        {/* Payment + Status Controls */}
        <div className="md:col-span-3 flex flex-col justify-between">
          <div className="space-y-1 bg-gray-50 p-3 rounded-lg border border-gray-100 text-xs">
            <div className="flex justify-between items-center text-gray-600">
              <span>Items Subtotal:</span>
              <span className="font-semibold text-gray-800">{currency} {itemsSubtotal}</span>
            </div>
            <div className="flex justify-between items-center text-gray-600">
              <span>Delivery Fee:</span>
              <span className="font-semibold text-gray-800">{deliveryFee > 0 ? `${currency} ${deliveryFee}` : "FREE"}</span>
            </div>
            <div className="pt-1.5 border-t border-gray-200 flex justify-between items-center">
              <span className="font-bold text-gray-900">Total:</span>
              <span className="text-base font-extrabold text-indigo-700">{currency} {order.amount}</span>
            </div>
            <div className="pt-1 border-t border-gray-100 flex justify-between items-center text-[11px]">
              <span className="text-gray-500">Method:</span>
              <span className="font-bold text-gray-800">{order.paymentMethod}</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-gray-500">Payment:</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${order.payment ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {order.payment ? "Done" : "Pending (COD)"}
              </span>
            </div>
          </div>

          <p className="mt-3 text-[10px] text-gray-500">Fulfilment is handled by the manufacturer hub.</p>
        </div>
      </div>
    </div>
  );
};

// ─── ORDER CARD — Hub Monitor (read-only) ────────────────────────────────────
const MonitorOrderCard = ({ order, onPrint, customerLoyaltyMap }) => {
  const customerFullName = (order.address?.firstName || "")
    .concat(" ")
    .concat(order.address?.lastName || "")
    .trim();

  const orderDateStr = new Date(order.date).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const itemsSubtotal = (order.items || []).reduce(
    (acc, it) => acc + (Number(it.purchasedUnitPrice ?? it.price ?? 0) * Number(it.quantity || 1)),
    0
  );

  const fs = order.fulfillmentStatus || "PENDING_ASSIGNMENT";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-xs hover:shadow-md transition-all">
      {/* Top Bar */}
      <div className="px-5 py-3 border-b border-gray-100 bg-slate-50/60 rounded-t-xl flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2.5">
          <span className="font-mono font-bold text-gray-900">#{order._id?.slice(-8).toUpperCase()}</span>
          <span className="text-gray-400">•</span>
          <span className="text-gray-500">{orderDateStr}</span>
          {order.address?.source && (
            <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded text-[10px] font-bold">
              {order.address.source}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Fulfillment Status */}
          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${getFulfillmentBadge(fs)}`}>
            {getFulfillmentLabel(fs)}
          </span>

          {/* Live NCM Courier Tracking Pill */}
          {order.deliveryOrder?.ncmOrderId && (
            <span
              title={`NCM Order #${order.deliveryOrder.ncmOrderId}`}
              className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-bold"
            >
              NCM #{order.deliveryOrder.ncmOrderId}
              {order.deliveryOrder.ncmStatus && (
                <span className="ml-1 opacity-75">· {order.deliveryOrder.ncmStatus}</span>
              )}
            </span>
          )}

          {/* Print */}
          <button
            type="button"
            onClick={() => onPrint([order])}
            className="flex items-center gap-1 px-2 py-1 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-md text-[11px] font-semibold transition-all"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        {/* Items summary */}
        <div>
          <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider block mb-1.5">Items ({order.items?.length || 0})</span>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {order.items?.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                {item.image?.[0] && <img src={item.image[0]} alt={item.name} className="w-7 h-7 object-cover rounded border border-gray-100 flex-shrink-0" />}
                <span className="text-gray-700 line-clamp-1 flex-1">{item.name}</span>
                <span className="text-gray-500 whitespace-nowrap">×{item.quantity}</span>
                {item.size && <span className="text-[10px] bg-gray-100 px-1 py-0.2 rounded">{item.size}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Customer + Destination */}
        <div>
          <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider block mb-1.5">Customer</span>
          <p className="font-bold text-gray-900">{customerFullName || "—"}</p>
          <p className="text-indigo-700 font-semibold">📞 {order.address?.phone}</p>
          {order.address?.landmark && (
            <p className="text-amber-800 text-[11px] mt-0.5">{order.address.landmark}</p>
          )}
          <p className="text-gray-600 mt-0.5">{order.address?.city}, {order.address?.state}</p>
        </div>

        {/* Financial + Read-only notice */}
        <div>
          <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider block mb-1.5">Payment</span>
          <p className="font-extrabold text-gray-900 text-sm">{currency} {order.amount}</p>
          <p className="text-gray-500">{order.paymentMethod}</p>
          <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${order.payment ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            {order.payment ? "Paid" : "COD - Pending"}
          </span>
          {/* Read-only notice */}
          <div className="mt-3 p-2 bg-slate-50 border border-slate-200 rounded-lg text-[10px] text-slate-500 flex items-start gap-1.5">
            <span>🔒</span>
            <span>Managed by assigned hub. Status changes are made by the manufacturer.</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
const Orders = ({ token }) => {
  // Active tab: "admin" = admin-created orders, "monitor" = all orders hub monitor
  const [activeTab, setActiveTab] = useState("admin");

  // Admin Orders (admin-created only)
  const [adminOrders, setAdminOrders] = useState([]);
  const [loadingAdmin, setLoadingAdmin] = useState(true);

  // All Orders (hub monitor view)
  const [allOrders, setAllOrders] = useState([]);
  const [loadingMonitor, setLoadingMonitor] = useState(false);

  // Shared UI state
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());
  const [printOrdersList, setPrintOrdersList] = useState(null);
  const [customerLoyaltyMap, setCustomerLoyaltyMap] = useState({});

  // Monitor-specific filters
  const [monitorFulfillmentFilter, setMonitorFulfillmentFilter] = useState("All");
  const [monitorSearchQuery, setMonitorSearchQuery] = useState("");

  const fetchCustomerLoyalty = async () => {
    try {
      if (!token) return;
      const res = await axios.get(`${backendUrl}/api/customer/list`, { headers: { token } });
      if (res.data.success && res.data.customers) {
        const map = {};
        res.data.customers.forEach((c) => {
          if (c.id) map[c.id] = c.currentLevel;
          if (c.email) map[c.email.toLowerCase()] = c.currentLevel;
        });
        setCustomerLoyaltyMap(map);
      }
    } catch (e) { console.error("Error fetching loyalty map:", e); }
  };

  // Fetch admin-created orders
  const fetchAdminOrders = async () => {
    if (!token) return;
    try {
      setLoadingAdmin(true);
      const response = await axios.post(backendUrl + "/api/order/admin-list", {}, { headers: { token } });
      if (response.data.success) {
        const sorted = (response.data.orders || []).sort((a, b) => Number(b.date) - Number(a.date));
        setAdminOrders(sorted);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    } finally {
      setLoadingAdmin(false);
    }
  };

  // Fetch all orders (hub monitor)
  const fetchAllOrders = async () => {
    if (!token) return;
    try {
      setLoadingMonitor(true);
      const response = await axios.post(backendUrl + "/api/order/list", {}, { headers: { token } });
      if (response.data.success) {
        const sorted = (response.data.orders || []).sort((a, b) => Number(b.date) - Number(a.date));
        setAllOrders(sorted);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    } finally {
      setLoadingMonitor(false);
    }
  };

  useEffect(() => {
    fetchAdminOrders();
    fetchCustomerLoyalty();
    const interval = setInterval(() => {
      fetchAdminOrders();
      fetchCustomerLoyalty();
      if (activeTab === "monitor") fetchAllOrders();
    }, 15000);
    return () => clearInterval(interval);
  }, [token, activeTab]);

  // Lazy-load monitor tab
  useEffect(() => {
    if (activeTab === "monitor" && allOrders.length === 0) {
      fetchAllOrders();
    }
  }, [activeTab, allOrders.length]);

  // ── Admin Orders filtering ──
  const filteredAdminOrders = useMemo(() => {
    return adminOrders.filter((order) => {
      if (selectedStatus !== "All" && order.status !== selectedStatus) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const fullName = `${order.address?.firstName || ""} ${order.address?.lastName || ""}`.toLowerCase();
        const phone = (order.address?.phone || "").toLowerCase();
        const city = (order.address?.city || "").toLowerCase();
        const orderId = (order._id || "").toLowerCase();
        return fullName.includes(query) || phone.includes(query) || city.includes(query) || orderId.includes(query);
      }
      return true;
    });
  }, [adminOrders, selectedStatus, searchQuery]);

  const adminStatusCounts = useMemo(() => {
    const counts = { All: adminOrders.length };
    ADMIN_ORDER_STATUSES.slice(1).forEach((s) => {
      counts[s] = adminOrders.filter((o) => o.status === s).length;
    });
    return counts;
  }, [adminOrders]);

  const newAdminOrders = useMemo(() => adminOrders.filter((o) => o.status === "Order Placed"), [adminOrders]);

  // ── Monitor Orders filtering ──
  const FULFILLMENT_FILTERS = ["All", "PENDING_ASSIGNMENT", "ASSIGNED", "ACCEPTED", "PREPARING", "PACKAGED", "READY_FOR_PICKUP", "IN_TRANSIT", "DELIVERED"];

  const filteredMonitorOrders = useMemo(() => {
    return allOrders.filter((order) => {
      // Exclude admin-created orders from monitor (they're in the admin tab)
      try {
        const reward = typeof order.rewardApplied === "string" ? JSON.parse(order.rewardApplied) : order.rewardApplied;
        if (reward && reward.adminCreated === true) return false;
      } catch {}
      if (order.orderType === "ADMIN_DIRECT") return false;

      if (monitorFulfillmentFilter !== "All" && (order.fulfillmentStatus || "PENDING_ASSIGNMENT") !== monitorFulfillmentFilter) return false;

      if (monitorSearchQuery.trim()) {
        const query = monitorSearchQuery.toLowerCase();
        const fullName = `${order.address?.firstName || ""} ${order.address?.lastName || ""}`.toLowerCase();
        const phone = (order.address?.phone || "").toLowerCase();
        const city = (order.address?.city || "").toLowerCase();
        const orderId = (order._id || "").toLowerCase();
        return fullName.includes(query) || phone.includes(query) || city.includes(query) || orderId.includes(query);
      }
      return true;
    });
  }, [allOrders, monitorFulfillmentFilter, monitorSearchQuery]);

  const monitorFulfillmentCounts = useMemo(() => {
    const websiteOrders = allOrders.filter((order) => {
      try {
        const reward = typeof order.rewardApplied === "string" ? JSON.parse(order.rewardApplied) : order.rewardApplied;
        if (reward && reward.adminCreated === true) return false;
      } catch {}
      return order.orderType !== "ADMIN_DIRECT";
    });
    const counts = { All: websiteOrders.length };
    FULFILLMENT_FILTERS.slice(1).forEach((fs) => {
      counts[fs] = websiteOrders.filter((o) => (o.fulfillmentStatus || "PENDING_ASSIGNMENT") === fs).length;
    });
    return counts;
  }, [allOrders]);

  // ── Select/Print helpers ──
  const toggleSelectOrder = (id) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const current = filteredAdminOrders;
    if (selectedOrderIds.size === current.length && current.length > 0) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(current.map((o) => o._id)));
    }
  };

  const handlePrintSelected = () => {
    const selected = adminOrders.filter((o) => selectedOrderIds.has(o._id));
    if (selected.length === 0) { toast.info("Please select at least one order to print."); return; }
    setPrintOrdersList(selected);
  };

  const handlePrintAllNew = () => {
    if (newAdminOrders.length === 0) { toast.info("No new orders."); return; }
    setPrintOrdersList(newAdminOrders);
  };

  const loading = activeTab === "admin" ? loadingAdmin : loadingMonitor;

  return (
    <div className="pb-16">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 tracking-tight">Order Management</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {activeTab === "admin"
              ? "Manage your manually created orders (Social Media, Phone, Walk-in)."
              : "Read-only hub monitor for all website & storefront orders fulfilled by manufacturer hubs."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {activeTab === "admin" && (
            <>
              <Link
                to="/create-order"
                className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                + Create Order
              </Link>
              <button
                type="button"
                onClick={handlePrintAllNew}
                disabled={newAdminOrders.length === 0}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all ${
                  newAdminOrders.length > 0
                    ? "bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95 ring-2 ring-indigo-200"
                    : "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Print All New ({newAdminOrders.length})
              </button>
            </>
          )}
          <button
            onClick={() => { activeTab === "admin" ? fetchAdminOrders() : fetchAllOrders(); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 shadow-xs transition-all"
          >
            <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Primary Tabs ── */}
      <div className="flex items-center gap-0 mb-5 border-b border-gray-200">
        <button
          onClick={() => { setActiveTab("admin"); setSelectedStatus("All"); setSearchQuery(""); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-all ${
            activeTab === "admin"
              ? "border-indigo-600 text-indigo-700 bg-indigo-50/50"
              : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"
          }`}
        >
          <span>📋</span>
          <span>My Created Orders</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${activeTab === "admin" ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-700"}`}>
            {adminOrders.length}
          </span>
        </button>

        <button
          onClick={() => { setActiveTab("monitor"); setMonitorFulfillmentFilter("All"); setMonitorSearchQuery(""); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-all ${
            activeTab === "monitor"
              ? "border-indigo-600 text-indigo-700 bg-indigo-50/50"
              : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"
          }`}
        >
          <span>Website Orders — Hub Monitor</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${activeTab === "monitor" ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-700"}`}>
            {allOrders.filter(o => { try { const r = typeof o.rewardApplied === "string" ? JSON.parse(o.rewardApplied) : o.rewardApplied; if (r?.adminCreated) return false; } catch {} return o.orderType !== "ADMIN_DIRECT"; }).length}
          </span>
          <span className="px-1.5 py-0.5 bg-rose-50 text-rose-600 border border-rose-200 rounded text-[10px] font-bold">READ ONLY</span>
        </button>
      </div>

      {/* ══════════════ ADMIN ORDERS TAB ══════════════ */}
      {activeTab === "admin" && (
        <>
          {/* New orders banner */}
          {newAdminOrders.length > 0 && (
            <div className="mb-5 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-sm flex-shrink-0">
                  {newAdminOrders.length}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-900">{newAdminOrders.length} New {newAdminOrders.length === 1 ? "Order" : "Orders"} Ready</h4>
                  <p className="text-xs text-gray-600">Print all shipping labels with one click.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handlePrintAllNew}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
              >
                Print All {newAdminOrders.length} Slips →
              </button>
            </div>
          )}

          {/* Status filter tabs */}
          <div className="bg-white border border-gray-200 rounded-xl p-2.5 mb-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              {ADMIN_ORDER_STATUSES.map((status) => {
                const isActive = selectedStatus === status;
                const count = adminStatusCounts[status] || 0;
                return (
                  <button
                    key={status}
                    onClick={() => setSelectedStatus(status)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      isActive ? "bg-indigo-600 text-white shadow-sm" : "bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200/60"
                    }`}
                  >
                    <span>{status === "All" ? "All Orders" : status}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${isActive ? "bg-white/20 text-white" : "bg-gray-200 text-gray-700"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search + Select All */}
            <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative flex-1 w-full max-w-lg">
                <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search by customer name, phone, city, order ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
                )}
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end text-xs">
                {filteredAdminOrders.length > 0 && (
                  <button type="button" onClick={toggleSelectAll} className="text-gray-600 hover:text-gray-900 font-semibold flex items-center gap-1.5">
                    <input type="checkbox" checked={selectedOrderIds.size === filteredAdminOrders.length && filteredAdminOrders.length > 0} onChange={toggleSelectAll} className="rounded text-indigo-600 cursor-pointer" />
                    <span>Select All ({filteredAdminOrders.length})</span>
                  </button>
                )}
                {selectedOrderIds.size > 0 && (
                  <button type="button" onClick={handlePrintSelected} className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold rounded-lg transition-all flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Print Selected ({selectedOrderIds.size})
                  </button>
                )}
                <div className="text-gray-500 whitespace-nowrap">
                  Showing <strong className="text-gray-800">{filteredAdminOrders.length}</strong> of {adminOrders.length}
                </div>
              </div>
            </div>
          </div>

          {/* Orders List */}
          {loadingAdmin ? (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
              <div className="inline-block animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mb-3" />
              <p className="text-sm font-semibold text-gray-700">Loading admin orders...</p>
            </div>
          ) : filteredAdminOrders.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
              <img src={assets.parcel_icon} alt="No orders" className="w-12 h-12 mx-auto opacity-40 mb-3" />
              <h3 className="text-base font-bold text-gray-700">No admin-created orders found</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                {searchQuery
                  ? "No orders match your search. Try a different keyword."
                  : `No orders under "${selectedStatus}". Use "+ Create Order" to add social media or phone orders.`}
              </p>
              {(selectedStatus !== "All" || searchQuery) && (
                <button onClick={() => { setSelectedStatus("All"); setSearchQuery(""); }}
                  className="mt-3 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-semibold hover:bg-indigo-100">
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredAdminOrders.map((order, index) => (
                <AdminOrderCard
                  key={order._id || index}
                  order={order}
                  isSelected={selectedOrderIds.has(order._id)}
                  toggleSelect={toggleSelectOrder}
                  onPrint={setPrintOrdersList}
                  customerLoyaltyMap={customerLoyaltyMap}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ══════════════ HUB MONITOR TAB ══════════════ */}
      {activeTab === "monitor" && (
        <>
          {/* Read-only notice banner */}
          <div className="mb-5 bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-slate-200 text-slate-600 flex items-center justify-center flex-shrink-0 text-lg">🔒</div>
            <div>
              <h4 className="text-sm font-bold text-slate-800">Hub Monitor — Read Only</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Website and storefront orders are fulfilled exclusively by assigned manufacturer hubs. Admin can monitor orders and print courier slips, but cannot change fulfillment status here.
              </p>
            </div>
          </div>

          {/* Fulfillment status filter */}
          <div className="bg-white border border-gray-200 rounded-xl p-2.5 mb-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              {FULFILLMENT_FILTERS.map((fs) => {
                const isActive = monitorFulfillmentFilter === fs;
                const count = monitorFulfillmentCounts[fs] || 0;
                return (
                  <button
                    key={fs}
                    onClick={() => setMonitorFulfillmentFilter(fs)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      isActive ? "bg-slate-800 text-white shadow-sm" : "bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200/60"
                    }`}
                  >
                    <span>{fs === "All" ? "All Website Orders" : getFulfillmentLabel(fs)}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${isActive ? "bg-white/20 text-white" : "bg-gray-200 text-gray-700"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="relative max-w-lg">
                <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search by customer name, phone, city, order ID..."
                  value={monitorSearchQuery}
                  onChange={(e) => setMonitorSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-slate-500"
                />
                {monitorSearchQuery && (
                  <button onClick={() => setMonitorSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
                )}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">Showing <strong className="text-gray-700">{filteredMonitorOrders.length}</strong> of {monitorFulfillmentCounts.All} website orders</p>
            </div>
          </div>

          {/* Monitor Orders List */}
          {loadingMonitor ? (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
              <div className="inline-block animate-spin w-8 h-8 border-4 border-slate-600 border-t-transparent rounded-full mb-3" />
              <p className="text-sm font-semibold text-gray-700">Loading website orders...</p>
            </div>
          ) : filteredMonitorOrders.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
              <img src={assets.parcel_icon} alt="No orders" className="w-12 h-12 mx-auto opacity-40 mb-3" />
              <h3 className="text-base font-bold text-gray-700">No website orders found</h3>
              <p className="text-xs text-gray-500 mt-1">
                {monitorSearchQuery || monitorFulfillmentFilter !== "All"
                  ? "No orders match your filters."
                  : "No website/storefront orders yet. They appear here automatically when customers place orders."}
              </p>
              {(monitorFulfillmentFilter !== "All" || monitorSearchQuery) && (
                <button onClick={() => { setMonitorFulfillmentFilter("All"); setMonitorSearchQuery(""); }}
                  className="mt-3 px-3 py-1.5 bg-slate-50 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-100">
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredMonitorOrders.map((order, index) => (
                <MonitorOrderCard
                  key={order._id || index}
                  order={order}
                  onPrint={setPrintOrdersList}
                  customerLoyaltyMap={customerLoyaltyMap}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* 4x6 Courier Shipping Label Modal */}
      {printOrdersList && (
        <ShippingLabelModal
          orders={printOrdersList}
          currency={currency}
          onClose={() => setPrintOrdersList(null)}
        />
      )}
    </div>
  );
};

export default Orders;
