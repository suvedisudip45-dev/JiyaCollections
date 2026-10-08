import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Package, RefreshCw, RotateCw, Search } from "lucide-react";
import { backendUrl, currency } from "../App";
import { usePermissions } from "../auth/PermissionsContext";

const OrderAssignments = ({ token }) => {
  const { can } = usePermissions();
  const canRetryAllocation = can("assignment:create");
  const [assignments, setAssignments] = useState([]);
  const [unassignedOrders, setUnassignedOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retryingOrderId, setRetryingOrderId] = useState("");
  const [allocationFailures, setAllocationFailures] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchAssignmentsData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [assignRes, unassignedRes] = await Promise.all([
        axios.get(`${backendUrl}/api/order-assignment/admin/all`, { headers: { token } }),
        axios.get(`${backendUrl}/api/order-assignment/admin/unassigned`, { headers: { token } }),
      ]);

      if (assignRes.data.success) {
        setAssignments(assignRes.data.assignments || []);
      }
      if (unassignedRes.data.success) {
        setUnassignedOrders(unassignedRes.data.orders || []);
      }
    } catch {
      toast.error("Failed to load order assignments");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const retryAllocation = async (orderId) => {
    setRetryingOrderId(orderId);
    setAllocationFailures((current) => {
      const next = { ...current };
      delete next[orderId];
      return next;
    });
    try {
      const response = await axios.post(
        `${backendUrl}/api/order-assignment/assign`,
        { orderId },
        { headers: { token } },
      );
      if (!response.data.success) {
        setAllocationFailures((current) => ({
          ...current,
          [orderId]: {
            message: response.data.message || "This order could not be assigned.",
            stockShortages: response.data.stockShortages || [],
          },
        }));
        toast.error(response.data.message || "This order could not be assigned.");
        return;
      }
      setAllocationFailures((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
      toast.success(`Order assigned to ${response.data.distributor || "a distributor"}.`);
      await fetchAssignmentsData();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "This order could not be assigned.");
    } finally {
      setRetryingOrderId("");
    }
  };

  useEffect(() => {
    fetchAssignmentsData();
  }, [fetchAssignmentsData]);

  const filtered = assignments.filter((a) => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const orderId = (a.order?.id || a.id).toLowerCase();
      const hubName = (a.distributor?.name || a.manufacturer?.name || a.manufacturer?.businessName || "").toLowerCase();
      const city = (a.order?.address?.city || a.order?.shippingAddress?.city || "").toLowerCase();
      return orderId.includes(term) || hubName.includes(term) || city.includes(term);
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
            Monitor distributor allocations and delivery handoffs across Nepal
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
            placeholder="Search by order ID, distributor, or city..."
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

      <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Orders awaiting distributor assignment</h2>
            <p className="text-xs text-slate-600">Coverage sets routing priority, while available ledger stock is required. Retry after updating coverage or inventory.</p>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
            {unassignedOrders.length}
          </span>
        </div>
        {loading ? (
          <p className="py-3 text-center text-xs text-slate-500">Loading pending orders...</p>
        ) : unassignedOrders.length === 0 ? (
          <p className="rounded-lg bg-white/70 p-3 text-xs text-slate-500">No customer orders are currently waiting for allocation.</p>
        ) : (
          <div className="space-y-2">
            {unassignedOrders.map((order) => (
              <div key={order.id} className="rounded-lg bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-48">
                    <p className="font-mono text-xs font-bold text-slate-900">#{order.id.slice(-8)}</p>
                    <p className="text-xs text-slate-600">
                      {[order.address?.district, order.address?.province || order.address?.state].filter(Boolean).join(", ") || "Destination not set"}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {order.items?.length || 0} line item{order.items?.length === 1 ? "" : "s"} · {currency}{Number(order.amount || 0).toLocaleString()} · {order.fulfillmentStatus || "pending"}
                    </p>
                  </div>
                  {canRetryAllocation && (
                    <button
                      type="button"
                      onClick={() => retryAllocation(order.id)}
                      disabled={retryingOrderId === order.id}
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      <RotateCw className={`h-3.5 w-3.5 ${retryingOrderId === order.id ? "animate-spin" : ""}`} />
                      {retryingOrderId === order.id ? "Retrying..." : "Retry allocation"}
                    </button>
                  )}
                </div>
                {allocationFailures[order.id] && (
                  <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                    <p>{allocationFailures[order.id].message}</p>
                    {allocationFailures[order.id].stockShortages.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {allocationFailures[order.id].stockShortages.flatMap((candidate) =>
                          candidate.shortages.map((shortage) => (
                            <li key={`${candidate.distributor}-${shortage.productId}-${shortage.size}-${shortage.color}`}>
                              {candidate.distributor}: product {shortage.productId}, {shortage.size} / {shortage.color} — need {shortage.requiredQuantity}, available {shortage.availableQuantity}.
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

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
                  <th className="py-3 px-4">Assigned Distributor Hub</th>
                  <th className="py-3 px-4">Items / Total</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Assignment Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filtered.map((a) => {
                  const order = a.order;
                  const hub = a.distributor || a.manufacturer;
                  const items = order?.items || [];
                  const totalQty = items.reduce((sum, i) => sum + (i.quantity || 1), 0);

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
                          {hub?.name || hub?.businessName || "Pending Assignment"}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {hub?.city || ""}
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

                      <td className="py-3.5 px-4 text-slate-600">
                        {a.distributorId ? "Distributor" : a.manufacturerId ? "Legacy manufacturer" : "Unassigned"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};

export default OrderAssignments;
