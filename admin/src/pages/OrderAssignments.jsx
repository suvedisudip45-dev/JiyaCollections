import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Package,
  ArrowRight,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Truck,
  Building2,
  X,
  AlertCircle,
} from "lucide-react";
import { backendUrl, currency } from "../App";

const canAdminReassignAssignment = ({ status, hasDeliveryOrder = false } = {}) => {
  const normalized = String(status || "").toLowerCase();

  if (hasDeliveryOrder) return false;

  const lockedStatuses = new Set([
    "accepted",
    "preparing",
    "quality_check",
    "packed",
    "ready_for_pickup",
    "picked_up",
    "out_for_delivery",
    "in_transit",
    "arrived_at_destination",
    "delivered",
    "return_requested",
  ]);

  if (lockedStatuses.has(normalized)) return false;

  return ["assigned", "pending_acceptance", "pending_assignment", "rejected"].includes(normalized) || normalized === "";
};

const OrderAssignments = ({ token }) => {
  const [assignments, setAssignments] = useState([]);
  const [manufacturers, setManufacturers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Re-assign Modal
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [targetMfgId, setTargetMfgId] = useState("");
  const [reassignReason, setReassignReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchAssignmentsData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [assignRes, mfgRes] = await Promise.all([
        axios.get(`${backendUrl}/api/order-assignment/admin/all`, {
          headers: { token },
        }),
        axios.get(`${backendUrl}/api/manufacturer/admin/list`, {
          headers: { token },
        }),
      ]);

      if (assignRes.data.success) {
        setAssignments(assignRes.data.assignments || []);
      }
      if (mfgRes.data.success) {
        setManufacturers(mfgRes.data.manufacturers || []);
      }
    } catch (err) {
      toast.error("Failed to load order assignments");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAssignmentsData();
  }, [fetchAssignmentsData]);

  const handleManualReassign = async (e) => {
    e.preventDefault();
    if (!selectedAssignment || !targetMfgId) return;
    setSubmitting(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/order-assignment/admin/manual-assign`,
        {
          orderId: selectedAssignment.orderId,
          manufacturerId: targetMfgId,
          reason: reassignReason || "Admin manual routing override",
        },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Order re-allocated successfully!");
        setReassignModalOpen(false);
        fetchAssignmentsData();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to re-assign order");
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = assignments.filter((a) => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const orderId = (a.order?.id || a.id).toLowerCase();
      const mfgName = (a.manufacturer?.businessName || "").toLowerCase();
      const city = (a.order?.address?.city || a.order?.shippingAddress?.city || "").toLowerCase();
      return orderId.includes(term) || mfgName.includes(term) || city.includes(term);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900">
            Order Allocation &amp; Routing Engine
          </h1>
          <p className="text-xs text-slate-500">
            Monitor real-time proximity manufacturer assignments and delivery handoffs across Nepal
          </p>
        </div>

        <button
          onClick={fetchAssignmentsData}
          className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Pipeline
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by order ID, manufacturer, or city..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-900"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          {[
            { id: "all", label: "All Assignments" },
            { id: "assigned", label: "Pending Acceptance" },
            { id: "preparing", label: "In Production" },
            { id: "ready_for_pickup", label: "Ready for Pickup" },
            { id: "in_transit", label: "In Transit" },
            { id: "delivered", label: "Delivered" },
            { id: "rejected", label: "Rejected" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                statusFilter === tab.id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs">Loading order assignments...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Package className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600 text-sm">No assignments found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-3 px-4">Order ID &amp; Date</th>
                  <th className="py-3 px-4">Destination City</th>
                  <th className="py-3 px-4">Assigned Manufacturer Hub</th>
                  <th className="py-3 px-4">Items / Total</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Admin Override</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filtered.map((a) => {
                  const order = a.order;
                  const mfg = a.manufacturer;
                  const items = order?.items || [];
                  const totalQty = items.reduce((sum, i) => sum + (i.quantity || 1), 0);
                  const canAdminReassign = canAdminReassignAssignment({
                    status: a.status,
                    hasDeliveryOrder: Boolean(a.delivery),
                  });

                  return (
                    <tr key={a.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        #{order?.id?.slice(-8) || a.id.slice(-8)}
                        <span className="text-[10px] text-slate-400 block font-normal">
                          {new Date(a.createdAt).toLocaleDateString()}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-slate-800 font-bold">
                        {order?.address?.city || order?.shippingAddress?.city || "Nepal"}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="font-bold text-slate-900 block">
                          {mfg?.businessName || "Pending Assignment"}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {mfg?.city} (Score: {mfg?.qualityRating?.toFixed(1) || "5.0"})
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="font-bold text-slate-900">
                          {currency}{order?.amount?.toLocaleString() || 0}
                        </span>
                        <span className="text-[11px] text-slate-500 block">
                          {totalQty} garment{totalQty > 1 ? "s" : ""}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                            a.status === "delivered"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : a.status === "rejected"
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : a.status === "ready_for_pickup"
                              ? "bg-purple-50 text-purple-700 border border-purple-200"
                              : "bg-blue-50 text-blue-700 border border-blue-200"
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        {canAdminReassign ? (
                          <button
                            onClick={() => {
                              setSelectedAssignment(a);
                              setTargetMfgId(a.manufacturerId || "");
                              setReassignReason("");
                              setReassignModalOpen(true);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs cursor-pointer shadow-xs"
                          >
                            Re-route Hub
                          </button>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-bold border border-slate-200">
                            Locked
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual Re-assign Modal */}
      {reassignModalOpen && selectedAssignment && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Manual Hub Re-Allocation
              </h3>
              <button
                onClick={() => setReassignModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Manually override the proximity algorithm and assign this order to a specific manufacturer hub.
            </p>

            <form onSubmit={handleManualReassign} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Select Target Manufacturer Hub
                </label>
                <select
                  required
                  value={targetMfgId}
                  onChange={(e) => setTargetMfgId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                >
                  <option value="">Select manufacturer...</option>
                  {manufacturers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.businessName} — {m.city} ({m.qualityRating?.toFixed(1)} Rating)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Reason for Manual Override
                </label>
                <input
                  type="text"
                  placeholder="e.g. Prioritized rush order / capacity balancing"
                  value={reassignReason}
                  onChange={(e) => setReassignReason(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReassignModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl font-bold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer disabled:opacity-50"
                >
                  {submitting ? "Re-assigning..." : "Confirm Re-assignment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderAssignments;
