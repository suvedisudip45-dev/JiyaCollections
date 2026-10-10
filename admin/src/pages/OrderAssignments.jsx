import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Layers, Package, RefreshCw, RotateCw, Search, ShieldCheck, Truck, Weight, X } from "lucide-react";
import { backendUrl, currency } from "../App";
import { usePermissions } from "../auth/PermissionsContext";

const getAssignmentNotes = (assignment) => {
  try {
    return assignment?.notes ? JSON.parse(assignment.notes) : {};
  } catch {
    return {};
  }
};

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
  const [ncmAssignment, setNcmAssignment] = useState(null);
  const [ncmForm, setNcmForm] = useState({});
  const [bookingAssignmentId, setBookingAssignmentId] = useState("");

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

  const openNcmForm = (assignment) => {
    const notes = getAssignmentNotes(assignment);
    const firstItem = assignment.order?.items?.[0] || {};
    setNcmAssignment(assignment);
    setNcmForm({
      productType: notes.productType || firstItem.productType || firstItem.category || firstItem.name || "",
      productDescription: notes.productDescription || firstItem.description || firstItem.productDescription || firstItem.name || "",
      packageType: notes.packageType || "Box",
      deliveryInstruction: notes.deliveryInstruction || assignment.order?.address?.deliveryInstruction || assignment.order?.address?.orderNotes || "",
      packageWeight: notes.packageWeight || "",
      packageDimensions: notes.packageDimensions || "",
      isFragile: Boolean(notes.isFragile),
      packagingNotes: notes.packagingNotes || "",
    });
  };

  const requestNcmDelivery = async (event) => {
    event.preventDefault();
    if (!ncmAssignment || bookingAssignmentId) return;
    setBookingAssignmentId(ncmAssignment.id);
    try {
      const response = await axios.post(
        `${backendUrl}/api/delivery/admin/assignment/${ncmAssignment.id}/ncm`,
        ncmForm,
        { headers: { token } },
      );
      if (!response.data.success) throw new Error(response.data.message || "NCM booking failed");
      toast.success(response.data.duplicate ? "NCM delivery is already booked." : "NCM delivery booking submitted.");
      setNcmAssignment(null);
      await fetchAssignmentsData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "NCM booking failed");
    } finally {
      setBookingAssignmentId("");
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
                  <th className="py-3 px-4">NCM / Action</th>
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
                          {a.delivery?.ncmStatus && (
                            <span className="mt-1 block text-[10px] font-semibold text-sky-700">
                              NCM: {a.delivery.ncmStatus}
                            </span>
                          )}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-slate-600">
                        {a.distributorId ? "Distributor" : a.manufacturerId ? "Legacy manufacturer" : "Unassigned"}
                      </td>
                      <td className="py-3.5 px-4 min-w-40">
                        {a.delivery?.ncmOrderId ? (
                          <div className="space-y-1">
                            <span className="font-mono text-[11px] font-bold text-sky-800">Waybill #{a.delivery.ncmOrderId}</span>
                            <span className="block text-[10px] text-slate-500">{a.delivery.ncmStatus || a.delivery.state}</span>
                          </div>
                        ) : ["packed", "package_details_complete", "ready_for_pickup"].includes(String(a.status || "").toLowerCase()) &&
                          !["NCM_SUBMISSION_STARTED", "NCM_CREATED", "PICKUP_CONFIRMED", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "OUT_FOR_DELIVERY", "DELIVERED"].includes(a.delivery?.state) ? (
                          <button
                            type="button"
                            onClick={() => openNcmForm(a)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-2 text-[11px] font-semibold text-white hover:bg-slate-700"
                          >
                            <Truck className="h-3.5 w-3.5" />
                            Request NCM delivery
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400">
                            {a.delivery?.state || "Pack first"}
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

      {ncmAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-6">
          <form onSubmit={requestNcmDelivery} className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-slate-50 shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <Truck className="h-4 w-4 text-sky-600" />
                  Request NCM delivery
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Order #{ncmAssignment.order?.id?.slice(-8)} · Pickup {ncmAssignment.distributor?.ncmPickupBranch || ncmAssignment.manufacturer?.ncmPickupBranch || "branch not configured"} · Destination {ncmAssignment.order?.address?.ncmBranch || ncmAssignment.order?.address?.city || "not set"}
                </p>
              </div>
              <button type="button" onClick={() => setNcmAssignment(null)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close package details">
                <X className="h-4 w-4" />
              </button>
            </div>

            <section className="m-4 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Packaging &amp; Quality Dispatch Parameters
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Add package details before submitting this packed order to NCM. The booking uses the assigned hub pickup branch and customer delivery address.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">
                  Product Type
                  <input required value={ncmForm.productType || ""} onChange={(event) => setNcmForm({ ...ncmForm, productType: event.target.value })} placeholder="e.g. Shirt, Kurta, Jacket" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-normal text-slate-800" />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Package Type
                  <select required value={ncmForm.packageType || "Box"} onChange={(event) => setNcmForm({ ...ncmForm, packageType: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-normal text-slate-800">
                    {["Box", "Polybag", "Envelope", "Carton", "Gift Box"].map((type) => <option key={type}>{type}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Product Description
                  <textarea required rows={2} value={ncmForm.productDescription || ""} onChange={(event) => setNcmForm({ ...ncmForm, productDescription: event.target.value })} placeholder="Describe the item in the package" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-normal text-slate-800" />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Delivery Instructions
                  <textarea rows={2} value={ncmForm.deliveryInstruction || ""} onChange={(event) => setNcmForm({ ...ncmForm, deliveryInstruction: event.target.value })} placeholder="Call before delivery, handle with care" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-normal text-slate-800" />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Package Weight (approx. kg)
                  <span className="relative mt-1 block">
                    <Weight className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input required type="number" min="0.1" step="0.1" value={ncmForm.packageWeight || ""} onChange={(event) => setNcmForm({ ...ncmForm, packageWeight: event.target.value })} placeholder="e.g. 0.8" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs font-normal text-slate-800" />
                  </span>
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Package Dimensions (L × W × H cm)
                  <span className="relative mt-1 block">
                    <Layers className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input required value={ncmForm.packageDimensions || ""} onChange={(event) => setNcmForm({ ...ncmForm, packageDimensions: event.target.value })} placeholder="e.g. 30 x 20 x 5 cm" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs font-normal text-slate-800" />
                  </span>
                </label>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <span>
                  <span className="block font-semibold text-slate-700">Fragile item</span>
                  <span className="text-[10px] text-slate-500">Mark this package for extra handling</span>
                </span>
                <input type="checkbox" checked={Boolean(ncmForm.isFragile)} onChange={(event) => setNcmForm({ ...ncmForm, isFragile: event.target.checked })} className="h-4 w-4 accent-amber-500" />
              </label>

              <label className="block text-xs font-semibold text-slate-700">
                Quality Inspection &amp; Packaging Notes
                <textarea rows={3} value={ncmForm.packagingNotes || ""} onChange={(event) => setNcmForm({ ...ncmForm, packagingNotes: event.target.value })} placeholder="e.g. Ironed, tagged with Aama hologram, wrapped in waterproof polybag." className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-normal text-slate-800" />
              </label>
            </section>

            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
              <button type="button" onClick={() => setNcmAssignment(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Cancel</button>
              <button type="submit" disabled={bookingAssignmentId === ncmAssignment.id} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                <Truck className="h-3.5 w-3.5" />
                {bookingAssignmentId === ncmAssignment.id ? "Submitting..." : "Submit to NCM"}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};

export default OrderAssignments;
