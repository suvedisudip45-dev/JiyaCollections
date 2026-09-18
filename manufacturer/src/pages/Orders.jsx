import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Package,
  Clock,
  CheckCircle,
  Truck,
  Search,
  Filter,
  ArrowRight,
  AlertCircle,
  RefreshCw,
  X,
  Printer,
  MapPin,
  Phone,
  Layers,
  ShieldCheck,
  Check,
  ChevronRight,
} from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";
import StatusBadge from "../components/StatusBadge";
import ShippingLabelModal from "../components/ShippingLabelModal";

const Orders = () => {
  const { token, backendUrl, currency, setStats, manufacturer } = useManufacturer();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const manufacturerPickupReadiness = (() => {
    const branch = (manufacturer?.ncmPickupBranch || "").trim();
    const pickupAddress = (manufacturer?.pickupAddress || "").trim();
    const pickupContactName = (manufacturer?.pickupContactName || "").trim();
    const pickupContactPhone = (manufacturer?.pickupContactPhone || "").trim();
    const pickupWindow = (manufacturer?.pickupWindow || "").trim();

    const missingFields = [];
    if (!branch) missingFields.push("NCM pickup branch assignment");
    if (!pickupAddress) missingFields.push("pickup address");
    if (!pickupContactName) missingFields.push("contact name");
    if (!pickupContactPhone) missingFields.push("contact phone");
    if (!pickupWindow) missingFields.push("pickup window");

    return {
      isReady: !missingFields.length,
      missingFields,
      branch,
    };
  })();

  // Reject Modal State
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  // Shipping Label Print State
  const [printOrdersList, setPrintOrdersList] = useState(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());

  const fetchOrders = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await axios.get(`${backendUrl}/api/order-assignment/my`, {
        headers: { token },
      });
      if (res.data.success) {
        const list = res.data.assignments || [];
        setAssignments(list);

        const pending = list.filter((a) => a.status === "assigned").length;
        const accepted = list.filter((a) => a.status === "accepted").length;
        const preparing = list.filter((a) => a.status === "preparing").length;
        const packed = list.filter((a) => a.status === "packed").length;
        const ready = list.filter((a) => a.status === "ready_for_pickup").length;
        const delivered = list.filter((a) => a.status === "delivered").length;

        setStats({
          pending,
          accepted,
          preparing,
          packed,
          ready,
          delivered,
          total: list.length,
          active: accepted + preparing + packed + ready,
        });
      }
    } catch (err) {
      toast.error("Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [token, backendUrl, setStats]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(() => fetchOrders(), 15000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const handleAccept = async (id) => {
    try {
      const res = await axios.post(
        `${backendUrl}/api/order-assignment/accept/${id}`,
        {},
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Order accepted for hub production!");
        fetchOrders();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Error accepting order");
    }
  };

  const handleRejectSubmit = async (e) => {
    e.preventDefault();
    if (!selectedAssignmentId) return;
    try {
      const res = await axios.post(
        `${backendUrl}/api/order-assignment/reject/${selectedAssignmentId}`,
        { reason: rejectReason || "Out of capacity" },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.info("Order declined. Auto-reallocating to next nearest hub.");
        setRejectModalOpen(false);
        setRejectReason("");
        setSelectedAssignmentId(null);
        fetchOrders();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to reject order");
    }
  };

  const handleUpdateStatus = async (id, status, extraData = {}) => {
    try {
      // If marking ready for pickup, use dedicated endpoint that notifies delivery fleet
      if (status === "ready_for_pickup") {
        const res = await axios.post(
          `${backendUrl}/api/delivery-job/ready/${id}`,
          {},
          { headers: { token } }
        );
        if (res.data.success) {
          toast.success("Marked ready! Delivery partner notified for pickup.");
          fetchOrders();
          return;
        }
      }

      const res = await axios.put(
        `${backendUrl}/api/order-assignment/status/${id}`,
        { status, ...extraData },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(`Fulfillment stage updated to ${status}!`);
        fetchOrders();
      } else {
        toast.error(res.data.message || "Failed to update status");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Error updating status");
    }
  };

  const toggleSelectOrder = (id) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePrintSelected = () => {
    const selected = assignments
      .filter((a) => selectedOrderIds.has(a.id))
      .map((a) => a.order || { id: a.orderId });
    if (selected.length === 0) {
      toast.warning("Please select at least 1 order to print shipping labels.");
      return;
    }
    setPrintOrdersList(selected);
  };

  // Filter logic
  const filteredOrders = assignments.filter((item) => {
    // 1. Tab filter
    if (activeTab === "pending" && item.status !== "assigned") return false;
    if (
      activeTab === "production" &&
      item.status !== "accepted" &&
      item.status !== "preparing"
    )
      return false;
    if (
      activeTab === "ready" &&
      item.status !== "packed" &&
      item.status !== "ready_for_pickup"
    )
      return false;
    if (
      activeTab === "completed" &&
      item.status !== "picked_up" &&
      item.status !== "in_transit" &&
      item.status !== "arrived_at_destination" &&
      item.status !== "out_for_delivery" &&
      item.status !== "delivered"
    )
      return false;
    if (
      activeTab === "rejected" &&
      item.status !== "rejected" &&
      item.status !== "cancelled"
    )
      return false;

    // 2. Search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const orderId = (item.order?.id || item.orderId || "").toLowerCase();
      const name = (item.order?.address?.name || item.order?.address?.firstName || "").toLowerCase();
      const phone = (item.order?.address?.phone || "").toLowerCase();
      const city = (item.order?.address?.city || "").toLowerCase();
      return orderId.includes(term) || name.includes(term) || phone.includes(term) || city.includes(term);
    }
    return true;
  });

  const tabCounts = {
    all: assignments.length,
    pending: assignments.filter((a) => a.status === "assigned").length,
    production: assignments.filter((a) => ["accepted", "preparing"].includes(a.status)).length,
    ready: assignments.filter((a) => ["packed", "ready_for_pickup"].includes(a.status)).length,
    completed: assignments.filter((a) => ["picked_up", "in_transit", "arrived_at_destination", "out_for_delivery", "delivered"].includes(a.status)).length,
    rejected: assignments.filter((a) => ["rejected", "cancelled"].includes(a.status)).length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-emerald-600" />
            Manufacturing &amp; Fulfillment Orders
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Produce, package, and dispatch orders assigned to your hub. Print thermal courier slips for delivery fleet.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedOrderIds.size > 0 && (
            <button
              onClick={handlePrintSelected}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Slips ({selectedOrderIds.size})
            </button>
          )}

          <button
            onClick={fetchOrders}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200">
        {[
          { id: "all", label: "All Assigned Orders", count: tabCounts.all },
          { id: "pending", label: "Pending Acceptance", count: tabCounts.pending, color: "text-rose-600" },
          { id: "production", label: "In Production / Stitching", count: tabCounts.production },
          { id: "ready", label: "Packed & Ready for Courier", count: tabCounts.ready },
          { id: "completed", label: "Delivered / In Transit", count: tabCounts.completed },
          { id: "rejected", label: "Declined", count: tabCounts.rejected },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold border-b-2 whitespace-nowrap cursor-pointer transition-all ${
              activeTab === tab.id
                ? "border-emerald-600 text-emerald-800 bg-emerald-50/50 rounded-t-xl"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                activeTab === tab.id
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by customer name, phone number, order ID, city..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center text-slate-400">
          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs">Loading fulfillment pipeline...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center text-slate-400">
          <Package className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="font-semibold text-slate-600 text-sm">No orders in this stage</p>
          <p className="text-xs text-slate-400 mt-1">
            New customer orders routed to your hub will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((item) => {
            const order = item.order || {};
            const items = Array.isArray(order.items) ? order.items : [];
            const address = order.address || {};
            const isSelected = selectedOrderIds.has(item.id);
            const isNewAssigned = item.status === "assigned";
            const pickupReadyForThisOrder = manufacturerPickupReadiness.isReady;
            const dispatchWarningText = manufacturerPickupReadiness.missingFields.length
              ? `Pickup blocked: ${manufacturerPickupReadiness.missingFields[0]} missing.`
              : "Dispatch ready: all required pickup details are complete.";
            const benefits = order.fulfillmentBenefits || {};

            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl border transition-all shadow-xs hover:shadow-md ${
                  isSelected
                    ? "border-indigo-500 ring-2 ring-indigo-200"
                    : isNewAssigned
                    ? "border-amber-300 ring-2 ring-amber-100"
                    : "border-slate-200/80"
                }`}
              >
                {/* Order Top Bar */}
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/60 rounded-t-2xl flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectOrder(item.id)}
                      className="rounded text-emerald-600 cursor-pointer w-4 h-4"
                      title="Select for batch shipping label"
                    />

                    {isNewAssigned && (
                      <span className="px-2 py-0.5 bg-amber-500 text-white text-[10px] font-extrabold rounded-md uppercase tracking-wider animate-pulse">
                        NEW ALLOCATION
                      </span>
                    )}

                    <span className="font-mono font-bold text-slate-900">
                      ORDER #{order.id?.slice(-8).toUpperCase() || item.orderId?.slice(-8).toUpperCase()}
                    </span>
                    <span className="text-slate-300">•</span>
                    <span className="text-slate-500 text-[11px]">
                      {new Date(item.assignedAt || item.createdAt).toLocaleDateString()}
                    </span>

                    {item.notes && (
                      <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 max-w-xs truncate">
                        {item.notes}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Courier Slip Print Button */}
                    <button
                      type="button"
                      onClick={() => setPrintOrdersList([order])}
                      className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-slate-500" />
                      <span>Courier Slip (4×6)</span>
                    </button>

                    <StatusBadge status={item.status} deliveryStatus={item.delivery?.ncmStatus} />
                  </div>
                </div>

                {/* Main Order Content */}
                <div className="p-5 grid grid-cols-1 md:grid-cols-12 gap-5 text-xs">
                  {/* Column 1: Ordered Items & Variants (5 cols) */}
                  <div className="md:col-span-5 space-y-2.5 border-b md:border-b-0 md:border-r border-slate-100 pb-4 md:pb-0 md:pr-4">
                    <div className="flex items-center gap-1.5 text-slate-400 uppercase text-[10px] font-bold tracking-wider">
                      <Layers className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Garment Varieties to Produce ({items.length})</span>
                    </div>

                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {items.map((it, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100"
                        >
                          <div className="flex items-center gap-2.5">
                            {it.image && it.image[0] ? (
                              <img
                                src={it.image[0]}
                                alt={it.name}
                                className="w-10 h-10 object-cover rounded-lg border border-slate-200"
                              />
                            ) : (
                              <div className="w-10 h-10 bg-slate-200 rounded-lg flex items-center justify-center text-slate-400">
                                <Package className="w-5 h-5" />
                              </div>
                            )}
                            <div>
                              <p className="font-bold text-slate-900 line-clamp-1">{it.name}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="bg-white border border-slate-200 px-1.5 py-0.2 rounded font-bold text-slate-800 text-[10px]">
                                  Size: {it.size || "Standard"}
                                </span>
                                {it.color && it.color !== "Standard" && (
                                  <span className="bg-white border border-slate-200 px-1.5 py-0.2 rounded text-slate-600 text-[10px]">
                                    Color: {it.color}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="text-right whitespace-nowrap">
                            <span className="font-black text-slate-900 text-sm">
                              ×{it.quantity}
                            </span>
                            <p className="text-[10px] text-slate-400">
                              {currency}{it.price} each
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Column 2: Customer Address & Destination (4 cols) */}
                  <div className="md:col-span-4 space-y-2 border-b md:border-b-0 md:border-r border-slate-100 pb-4 md:pb-0 md:pr-4">
                    <div className="flex items-center gap-1.5 text-slate-400 uppercase text-[10px] font-bold tracking-wider">
                      <MapPin className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Destination &amp; Customer</span>
                    </div>

                    <div className="space-y-1 text-slate-700">
                      <p className="font-bold text-slate-900 text-sm">
                        {address.name || `${address.firstName || ""} ${address.lastName || ""}`.trim() || "Customer"}
                      </p>
                      <p className="font-mono font-bold text-indigo-700 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {address.phone || "No phone provided"}
                      </p>
                      <p className="text-slate-600 font-medium">{address.street || "Direct delivery"}</p>

                      {address.landmark && (
                        <div className="p-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] font-medium">
                            <strong>Landmark:</strong> {address.landmark}
                        </div>
                      )}

                      <p className="text-slate-700 font-bold">
                        {address.city}, {address.state || "Nepal"}
                      </p>
                    </div>

                    {/* Payment Snapshot */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">COD / Total:</span>
                      <span className="font-bold text-slate-900">
                        {currency}{order.amount || 0} ({order.payment ? "PAID" : "Collect Cash"})
                      </span>
                    </div>
                  </div>

                  {/* Column 3: Production Action Stepper (3 cols) */}
                  <div className="md:col-span-3 flex flex-col justify-between space-y-3">
                    <div className="space-y-2">
                      {(benefits.loyaltyTier !== "Standard customer" || benefits.totalDiscount > 0 || benefits.giftDescription || benefits.handwrittenCard || benefits.customPerk) && (
                        <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-2.5 space-y-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-teal-800">Customer benefits</p>
                          <p className="text-[11px] font-bold text-slate-900">{benefits.loyaltyTier}</p>
                          {benefits.totalDiscount > 0 && <p className="text-[10px] text-teal-800">Discount applied: {currency}{benefits.totalDiscount.toLocaleString()}</p>}
                          {benefits.giftDescription && <p className="text-[10px] text-slate-700">Gift: {benefits.giftDescription}</p>}
                          {benefits.handwrittenCard && <p className="text-[10px] font-semibold text-amber-800">Include handwritten thank-you card</p>}
                          {benefits.customPerk && <p className="text-[10px] text-slate-700">{benefits.customPerk}</p>}
                        </div>
                      )}

                      <span className="text-slate-400 uppercase text-[10px] font-bold tracking-wider block">
                        Fulfillment Stage Action
                      </span>

                      {item.status === "packed" && (
                        <div
                          className={`rounded-xl border p-2 text-[10px] font-semibold ${
                            pickupReadyForThisOrder
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-amber-200 bg-amber-50 text-amber-800"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            {pickupReadyForThisOrder ? (
                              <CheckCircle className="w-3.5 h-3.5" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5" />
                            )}
                            <span>{dispatchWarningText}</span>
                          </div>
                        </div>
                      )}

                      {/* Stage Transitions */}
                      {item.status === "assigned" && (
                        <div className="space-y-2">
                          <button
                            onClick={() => handleAccept(item.id)}
                            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                          >
                            <Check className="w-4 h-4" />
                            <span>Accept for Production</span>
                          </button>
                          <button
                            onClick={() => {
                              setSelectedAssignmentId(item.id);
                              setRejectModalOpen(true);
                            }}
                            className="w-full py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl font-semibold text-xs border border-rose-200 cursor-pointer"
                          >
                            Decline / Reallocate
                          </button>
                        </div>
                      )}

                      {item.status === "accepted" && (
                        <button
                          onClick={() => handleUpdateStatus(item.id, "preparing")}
                          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Layers className="w-4 h-4" />
                          <span>Start Cutting &amp; Stitching</span>
                        </button>
                      )}

                      {item.status === "preparing" && (
                        <button
                          onClick={() => handleUpdateStatus(item.id, "packed")}
                          className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          <span>Quality Check &amp; Package</span>
                        </button>
                      )}

                      {item.status === "packed" && (
                        <div className="space-y-2">
                          <button
                            onClick={() => handleUpdateStatus(item.id, "ready_for_pickup")}
                            disabled={!pickupReadyForThisOrder}
                            className={`w-full py-2.5 rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5 ${
                              pickupReadyForThisOrder
                                ? "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                                : "bg-slate-200 text-slate-500 cursor-not-allowed"
                            }`}
                          >
                            <Truck className="w-4 h-4" />
                            <span>{pickupReadyForThisOrder ? "Ready for Courier Pickup" : "Pickup blocked"}</span>
                          </button>
                          <button
                            onClick={() => setPrintOrdersList([order])}
                            className="w-full py-1.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-semibold text-xs hover:bg-slate-50 cursor-pointer flex items-center justify-center gap-1"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Print Courier Slip
                          </button>
                        </div>
                      )}

                      {item.status === "ready_for_pickup" && (
                        <div className="space-y-2">
                          <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[11px] font-semibold text-center">
                            Awaiting Delivery Fleet Pickup
                          </div>
                          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-600 text-[11px] text-center">
                            Delivery progress will update automatically from Nepal Can Move.
                          </div>
                        </div>
                      )}

                      {["picked_up", "in_transit", "arrived_at_destination", "out_for_delivery", "delivered"].includes(item.status) && (() => {
                        const delivery = item.delivery || {};
                        const statusDisplay = {
                          picked_up: { label: "Picked Up by Courier", color: "bg-teal-50 border-teal-200 text-teal-800" },
                          in_transit: { label: "In Transit / Dispatched", color: "bg-slate-50 border-slate-200 text-slate-800" },
                          arrived_at_destination: { label: "Arrived at Destination Hub", color: "bg-teal-50 border-teal-200 text-teal-800" },
                          out_for_delivery: { label: "Out for Delivery", color: "bg-amber-50 border-amber-200 text-amber-800" },
                          delivered: { label: "Delivered to Customer", color: "bg-emerald-50 border-emerald-200 text-emerald-800" },
                        };
                        const info = statusDisplay[item.status] || { label: item.status, color: "bg-slate-50 border-slate-200 text-slate-800" };
                        return (
                          <div className={`rounded-xl border p-2.5 ${info.color} space-y-2`}>
                            <div className="font-bold text-[11px] flex items-center gap-1.5">
                              <span>{info.label}</span>
                            </div>

                            {/* NCM Courier Tracking Info */}
                            {delivery.ncmOrderId && (
                              <div className="space-y-1.5 pt-1.5 border-t border-current/10">
                                <div className="flex items-center justify-between text-[10px]">
                                  <span className="opacity-70">NCM Waybill:</span>
                                  <span className="font-mono font-black">#{delivery.ncmOrderId}</span>
                                </div>
                                {delivery.ncmStatus && (
                                  <div className="flex items-center justify-between text-[10px]">
                                    <span className="opacity-70">Courier Status:</span>
                                    <span className="font-bold">{delivery.ncmStatus}</span>
                                  </div>
                                )}
                                {(delivery.originBranchName || delivery.destinationBranchName) && (
                                  <div className="flex items-center gap-1 text-[10px]">
                                    <span className="font-bold">{delivery.originBranchName || "Hub"}</span>
                                    <span className="opacity-50">→</span>
                                    <span className="font-bold">{delivery.destinationBranchName || "Destination"}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    <Link
                      to={`/orders/${item.id}`}
                      className="text-[11px] text-slate-500 hover:text-slate-900 font-bold flex items-center justify-end gap-1 pt-1"
                    >
                      <span>Full Audit Log</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Decline / Reallocation Modal */}
      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Decline &amp; Reallocate Order
              </h3>
              <button
                onClick={() => setRejectModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Declining will automatically route this order to the next nearest licensed manufacturer in the proximity network.
            </p>

            <form onSubmit={handleRejectSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason for Declining
                </label>
                <select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-emerald-500"
                >
                  <option value="Out of fabric stock">Out of fabric stock</option>
                  <option value="Sewing capacity full">Sewing capacity full</option>
                  <option value="Temporary maintenance">Temporary maintenance</option>
                  <option value="Delivery radius issue">Delivery radius issue</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRejectModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs shadow-xs cursor-pointer"
                >
                  Confirm &amp; Reallocate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4x6 Thermal Courier Label Modal */}
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
