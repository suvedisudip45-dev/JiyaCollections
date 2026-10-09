import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Truck,
  Package,
  CheckCircle2,
  RotateCcw,
  Clock,
  MapPin,
  Phone,
  User,
  AlertTriangle,
  RotateCw,
  Search,
} from "lucide-react";
import { backendUrl, useManufacturer, currency } from "../context/ManufacturerContext";

const DistributorSelfDelivery = () => {
  const { token, manufacturer: distributor } = useManufacturer();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [updatingId, setUpdatingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Return QA Modal state
  const [returnOrder, setReturnOrder] = useState(null);
  const [returnReason, setReturnReason] = useState("");
  const [returnItems, setReturnItems] = useState([]);
  const [damageType, setDamageType] = useState("DELIVERY_DAMAGE");
  const [damageNotes, setDamageNotes] = useState("");
  const [submittingReturn, setSubmittingReturn] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(
        `${backendUrl}/api/distributor/orders/assigned`,
        {
          headers: { token },
          params: { status: statusFilter !== "all" ? statusFilter : undefined },
        }
      );
      setOrders(response.data.orders || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not load assigned deliveries.");
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleStatusUpdate = async (orderRef, nextStatus) => {
    setUpdatingId(orderRef.assignmentId);
    try {
      const response = await axios.patch(
        `${backendUrl}/api/distributor/orders/${orderRef.assignmentId}/status`,
        { status: nextStatus },
        { headers: { token } }
      );
      toast.success(response.data.message || `Status updated to ${nextStatus}.`);
      await loadOrders();
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to update delivery status.");
    } finally {
      setUpdatingId(null);
    }
  };

  const openReturnModal = (orderRef) => {
    setReturnOrder(orderRef);
    setReturnReason("Customer Return Request");
    setDamageType("DELIVERY_DAMAGE");
    setDamageNotes("");
    const items = (orderRef.order?.items || []).map((item) => ({
      productId: item.productId || item._id || item.id,
      name: item.name || "Product",
      size: item.size || "Standard",
      color: item.color || "Standard",
      quantity: Number(item.quantity || 1),
      maxQuantity: Number(item.quantity || 1),
      condition: "GOOD", // 'GOOD' or 'DAMAGED'
    }));
    setReturnItems(items);
  };

  const updateReturnItem = (idx, field, val) => {
    setReturnItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: val } : item))
    );
  };

  const handleReturnSubmit = async (e) => {
    e.preventDefault();
    if (!returnOrder) return;
    setSubmittingReturn(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/distributor/orders/${returnOrder.assignmentId}/return`,
        {
          reason: returnReason,
          damageType,
          damageNotes: damageNotes || undefined,
          items: returnItems.map((item) => ({
            productId: item.productId,
            size: item.size,
            color: item.color,
            quantity: Number(item.quantity),
            condition: item.condition,
          })),
        },
        { headers: { token } }
      );
      toast.success(response.data.message || "Customer return and QA recorded successfully.");
      setReturnOrder(null);
      await loadOrders();
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to process customer return.");
    } finally {
      setSubmittingReturn(false);
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const orderId = (o.orderId || "").toLowerCase();
    const customer = (
      `${o.order?.address?.firstName || ""} ${o.order?.address?.lastName || ""}`
    ).toLowerCase();
    const city = (o.order?.address?.city || "").toLowerCase();
    return orderId.includes(q) || customer.includes(q) || city.includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#dedbd3] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#171717]">Self-Delivery Management</h1>
          <p className="text-xs text-[#575757] mt-1">
            Dispatch, track, and complete local customer deliveries fulfilled by {distributor?.name || "Hub"}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#575757]" />
            <input
              type="text"
              placeholder="Search order or customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-[#ffffff] border border-[#dedbd3] rounded-xl focus:outline-none focus:border-[#171717] w-48 sm:w-64"
            />
          </div>

          <button
            onClick={loadOrders}
            className="p-2 text-[#575757] hover:text-[#171717] bg-[#ffffff] border border-[#dedbd3] rounded-xl"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { key: "all", label: "All Orders" },
          { key: "assigned", label: "Assigned" },
          { key: "dispatched", label: "Dispatched" },
          { key: "on_the_way", label: "On The Way" },
          { key: "delivered", label: "Delivered" },
          { key: "returned", label: "Returned" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
              statusFilter === f.key
                ? "bg-[#171717] text-white border-[#171717]"
                : "bg-[#ffffff] text-[#575757] border-[#dedbd3] hover:bg-[#f8f7f4]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl p-8 text-center text-xs text-[#575757]">
          Loading self-delivery orders...
        </div>
      ) : !filteredOrders.length ? (
        <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl p-8 text-center text-xs text-[#575757]">
          No self-delivery orders found matching filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrders.map((orderRef) => {
            const currentStatus = String(orderRef.status || "").toLowerCase();
            const order = orderRef.order || {};
            const address = order.address || {};
            const customerName = `${address.firstName || ""} ${address.lastName || ""}`.trim() || "Customer";

            return (
              <div
                key={orderRef.assignmentId}
                className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-[#171717]/40 transition-colors"
              >
                <div className="space-y-3">
                  {/* Order header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-[#171717]">Order #{orderRef.orderId?.slice(0, 8)}</span>
                      <p className="text-[10px] text-[#575757] flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        {new Date(orderRef.assignedAt).toLocaleDateString()}
                      </p>
                    </div>

                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                        currentStatus === "delivered"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : currentStatus === "on_the_way"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : currentStatus === "dispatched"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : currentStatus === "returned"
                          ? "bg-rose-50 text-rose-700 border-rose-200"
                          : "bg-[#f8f7f4] text-[#171717] border-[#dedbd3]"
                      }`}
                    >
                      {currentStatus.replace("_", " ")}
                    </span>
                  </div>

                  {/* Customer & Address Details */}
                  <div className="p-3 bg-[#f8f7f4] rounded-xl border border-[#dedbd3] space-y-1.5 text-xs text-[#575757]">
                    <p className="font-semibold text-[#171717] flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-[#171717]" />
                      {customerName}
                    </p>
                    <p className="flex items-center gap-1.5 text-[11px]">
                      <Phone className="w-3.5 h-3.5" />
                      {address.phone || "No contact phone"}
                    </p>
                    <p className="flex items-start gap-1.5 text-[11px]">
                      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        {address.street || address.city}, {address.district || ""}, {address.province || ""}
                      </span>
                    </p>
                  </div>

                  {/* Items list */}
                  <div className="text-xs space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#575757]">Package Items</p>
                    <ul className="divide-y divide-[#dedbd3]/50">
                      {(order.items || []).map((item, idx) => (
                        <li key={idx} className="py-1 flex justify-between text-[11px]">
                          <span className="text-[#171717]">
                            {item.quantity}x {item.name || "Item"} ({item.size}/{item.color})
                          </span>
                          <span className="font-semibold text-[#171717]">
                            {currency}
                            {(item.price || item.purchasedUnitPrice || 0) * (item.quantity || 1)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Financial Total */}
                  <div className="flex items-center justify-between text-xs pt-2 border-t border-[#dedbd3]/60 font-semibold">
                    <span className="text-[#575757]">Total Collection ({order.paymentMethod || "COD"}):</span>
                    <span className="text-sm font-bold text-[#171717]">
                      {currency}
                      {order.amount?.toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Status Action Buttons */}
                <div className="space-y-2 pt-2">
                  {["assigned", "pending_acceptance", "accepted", "packed", "ready_for_pickup"].includes(currentStatus) && (
                    <button
                      onClick={() => handleStatusUpdate(orderRef, "Dispatched")}
                      disabled={updatingId === orderRef.assignmentId}
                      className="w-full py-2 bg-[#171717] text-white text-xs font-bold rounded-xl hover:bg-[#262626] transition-colors"
                    >
                      {updatingId === orderRef.assignmentId ? "Updating..." : "1. Mark Dispatched"}
                    </button>
                  )}

                  {currentStatus === "dispatched" && (
                    <button
                      onClick={() => handleStatusUpdate(orderRef, "On the Way")}
                      disabled={updatingId === orderRef.assignmentId}
                      className="w-full py-2 bg-amber-600 text-white text-xs font-bold rounded-xl hover:bg-amber-700 transition-colors"
                    >
                      {updatingId === orderRef.assignmentId ? "Updating..." : "2. Mark On The Way"}
                    </button>
                  )}

                  {currentStatus === "on_the_way" && (
                    <button
                      onClick={() => handleStatusUpdate(orderRef, "Delivered")}
                      disabled={updatingId === orderRef.assignmentId}
                      className="w-full py-2 bg-emerald-700 text-white text-xs font-bold rounded-xl hover:bg-emerald-800 transition-colors"
                    >
                      {updatingId === orderRef.assignmentId ? "Completing..." : "3. Mark Delivered & Collect"}
                    </button>
                  )}

                  {currentStatus === "delivered" && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 py-1.5 text-center text-xs font-bold text-emerald-700 bg-emerald-50 rounded-xl border border-emerald-200">
                        ✓ Delivered
                      </div>
                      <button
                        onClick={() => openReturnModal(orderRef)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 rounded-xl border border-rose-200 hover:bg-rose-100 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Return QA
                      </button>
                    </div>
                  )}

                  {currentStatus === "returned" && (
                    <div className="w-full py-1.5 text-center text-xs font-bold text-rose-700 bg-rose-50 rounded-xl border border-rose-200">
                      Returned &amp; Reconciled
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Customer Return QA Modal */}
      {returnOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#dedbd3] bg-[#f8f7f4]">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-[#171717]" />
                <h3 className="text-sm font-bold text-[#171717]">
                  Process Customer Return QA (Order #{returnOrder.orderId?.slice(0, 8)})
                </h3>
              </div>
              <button onClick={() => setReturnOrder(null)} className="text-[#575757] p-1">
                ✕
              </button>
            </div>

            <form onSubmit={handleReturnSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-[#171717] mb-1">Return Reason</label>
                <input
                  type="text"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="e.g., Customer requested size change / defective item"
                  className="w-full p-2 border border-[#dedbd3] rounded-lg focus:outline-none focus:border-[#171717]"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-[#171717] mb-1.5">Inspected Return Items &amp; QA Condition</label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {returnItems.map((item, idx) => (
                    <div key={idx} className="p-2.5 bg-[#f8f7f4] rounded-xl border border-[#dedbd3] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#171717]">
                          {item.name} ({item.size}/{item.color})
                        </span>
                        <span className="text-[11px] text-[#575757]">Purchased: {item.maxQuantity}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="w-24">
                          <label className="block text-[10px] text-[#575757]">Qty to Return</label>
                          <input
                            type="number"
                            min="1"
                            max={item.maxQuantity}
                            value={item.quantity}
                            onChange={(e) => updateReturnItem(idx, "quantity", e.target.value)}
                            className="w-full p-1.5 border border-[#dedbd3] rounded-lg text-center font-bold bg-[#ffffff]"
                          />
                        </div>

                        <div className="flex-1">
                          <label className="block text-[10px] text-[#575757]">QA Decision</label>
                          <select
                            value={item.condition}
                            onChange={(e) => updateReturnItem(idx, "condition", e.target.value)}
                            className="w-full p-1.5 border border-[#dedbd3] rounded-lg bg-[#ffffff] font-semibold"
                          >
                            <option value="GOOD">Good Condition (Restock)</option>
                            <option value="DAMAGED">Damaged / Defect (Write-off)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {returnItems.some((i) => i.condition === "DAMAGED") && (
                <div className="space-y-2">
                  <div>
                    <label className="block font-bold text-rose-600 mb-1">Damage Classification</label>
                    <select
                      value={damageType}
                      onChange={(e) => setDamageType(e.target.value)}
                      className="w-full p-2 border border-[#dedbd3] rounded-lg bg-[#ffffff]"
                    >
                      <option value="DELIVERY_DAMAGE">Delivery Transit Damage</option>
                      <option value="STITCH_DAMAGE">Stitching / Manufacturing Flaw</option>
                      <option value="OTHER_DAMAGE">Other Damage</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-[#171717] mb-1">Damage Description</label>
                    <input
                      type="text"
                      value={damageNotes}
                      onChange={(e) => setDamageNotes(e.target.value)}
                      placeholder="e.g., Torn seams near collar"
                      className="w-full p-2 border border-[#dedbd3] rounded-lg focus:outline-none focus:border-[#171717]"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#dedbd3]">
                <button
                  type="button"
                  onClick={() => setReturnOrder(null)}
                  className="px-3.5 py-1.5 border border-[#dedbd3] rounded-lg text-[#575757]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReturn}
                  className="px-4 py-1.5 bg-[#171717] text-white font-bold rounded-lg hover:bg-[#262626] transition-colors disabled:opacity-50"
                >
                  {submittingReturn ? "Processing..." : "Process Return & Restock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DistributorSelfDelivery;
