import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { CheckSquare, Clock3, ExternalLink, Package, RefreshCw, Search, Truck } from "lucide-react";
import { backendUrl, currency, useManufacturer } from "../context/ManufacturerContext";

const TABS = [
  { key: "ON_HOLD", label: "On hold", countKey: "onHold" },
  { key: "FAILED", label: "Failed NCM orders", countKey: "failed" },
  { key: "BOOKED", label: "Booked", countKey: "booked" },
  { key: "DELIVERED", label: "Delivered", countKey: "delivered" },
  { key: "ALL", label: "All NCM orders", countKey: "all" },
];

const CARRIER_STATUSES = [
  "Pickup Order Created",
  "Sent for Pickup",
  "Drop off Order Created",
  "Pickup Complete",
  "Sent for Delivery",
  "Dispatched",
  "In Transit",
  "Arrived",
  "Out for Delivery",
  "Delivered",
  "Returned",
];

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

const getFirstItemImage = (items = []) => {
  const image = items.find((item) => item?.image)?.image;
  return Array.isArray(image) ? image[0] : image;
};

const getCustomerName = (address = {}) =>
  String(address.name || `${address.firstName || ""} ${address.lastName || ""}`).trim() || "Customer";

const getSelectedDeliveryType = (record, overrides) =>
  overrides[record?.assignmentId] ||
  (record?.deliveryOptionsAvailable && record?.order?.address?.deliveryType === "Door2Branch"
    ? "Door2Branch"
    : "Door2Door");

const NcmDeliveries = () => {
  const { token } = useManufacturer();
  const [activeTab, setActiveTab] = useState("ON_HOLD");
  const [statusFilter, setStatusFilter] = useState("");
  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState({ all: 0, onHold: 0, failed: 0, booked: 0, delivered: 0 });
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchResults, setBatchResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [retryingAssignmentId, setRetryingAssignmentId] = useState(null);
  const [deliveryTypes, setDeliveryTypes] = useState({});

  const loadOrders = useCallback(async ({ preserveBatchResults = false } = {}) => {
    if (!token) return;
    if (!preserveBatchResults) setBatchResults([]);
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/distributor/orders/ncm`, {
        headers: { token },
        params: { type: activeTab, status: statusFilter || undefined, page, limit: 25 },
      });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load NCM orders.");
      setOrders(response.data.orders || []);
      setCounts(response.data.counts || { all: 0, onHold: 0, failed: 0, booked: 0, delivered: 0 });
      setPagination(response.data.pagination || null);
      setSelectedIds(new Set());
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to load NCM orders.");
      setOrders([]);
      setCounts({ all: 0, onHold: 0, failed: 0, booked: 0, delivered: 0 });
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [activeTab, page, statusFilter, token]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const visibleOrders = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return orders;
    return orders.filter(({ order, orderId, delivery }) => {
      const address = order?.address || {};
      const searchable = [
        orderId,
        getCustomerName(address),
        address.phone,
        address.district,
        address.city,
        delivery?.ncmOrderId,
        delivery?.displayStatus,
        delivery?.ncmStatus,
      ].join(" ").toLowerCase();
      return searchable.includes(query);
    });
  }, [orders, searchTerm]);

  const toggleSelected = (assignmentId) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(assignmentId)) next.delete(assignmentId);
      else next.add(assignmentId);
      return next;
    });
  };

  const toggleSelectVisible = () => {
    setSelectedIds((current) => {
      const visibleIds = visibleOrders.map(({ assignmentId }) => assignmentId);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      const next = new Set(current);
      visibleIds.forEach((id) => {
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  const handleBulkBook = async () => {
    if (!selectedIds.size || booking) return;
    const count = selectedIds.size;
    if (!window.confirm(`Submit ${count} individual NCM booking${count === 1 ? "" : "s"} for pickup from your hub?`)) return;

    setBooking(true);
    setBatchResults([]);
    try {
      const response = await axios.post(
        `${backendUrl}/api/distributor/orders/ncm/bulk-book`,
        {
          assignmentIds: [...selectedIds],
          deliveryTypes: Object.fromEntries([...selectedIds].map((id) => [
            id,
            getSelectedDeliveryType(orders.find((record) => record.assignmentId === id), deliveryTypes),
          ])),
        },
        { headers: { token } },
      );
      const results = response.data?.results || [];
      setBatchResults(results);
      const succeeded = results.filter((result) => result.success).length;
      if (succeeded === results.length && results.length > 0) {
        toast.success(response.data.message || `NCM booking submitted for ${succeeded} orders.`);
      } else if (succeeded > 0) {
        toast.warning(response.data.message || `${succeeded} of ${results.length} NCM bookings were submitted.`);
      } else {
        toast.error(response.data?.message || "None of the selected orders could be booked.");
      }
      await loadOrders({ preserveBatchResults: true });
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to submit NCM bookings.");
    } finally {
      setBooking(false);
    }
  };

  const handleReapply = async (record) => {
    if (!record?.assignmentId || booking || retryingAssignmentId) return;
    if (!window.confirm("Reapply this failed order for delivery partner booking?")) return;

    setRetryingAssignmentId(record.assignmentId);
    try {
      const response = await axios.post(
        `${backendUrl}/api/distributor/orders/ncm/bulk-book`,
        {
          assignmentIds: [record.assignmentId],
          deliveryTypes: {
            [record.assignmentId]: getSelectedDeliveryType(record, deliveryTypes),
          },
        },
        { headers: { token } },
      );
      const result = response.data?.results?.[0];
      if (result?.success) {
        toast.success("Order reapplied to the delivery partner.");
      } else {
        toast.error(result?.message || response.data?.message || "Unable to reapply this order.");
      }
      await loadOrders({ preserveBatchResults: true });
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to reapply this order.");
    } finally {
      setRetryingAssignmentId(null);
    }
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-700">Distributor delivery desk</p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-black text-slate-950 sm:text-2xl">
            <Truck className="h-6 w-6 text-sky-700" />
            NCM deliveries
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-600">
            Hold completed parcels until you are ready, then submit selected orders together for NCM pickup.
            Each parcel receives its own NCM booking and tracking reference.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search orders or customers"
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs sm:w-64"
            />
          </label>
          <button
            type="button"
            onClick={() => loadOrders()}
            disabled={loading}
            aria-label="Refresh NCM orders"
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <nav aria-label="NCM order filters" className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key);
              setStatusFilter("");
              setPage(1);
            }}
            className={`flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3 py-2 text-xs font-bold ${
              activeTab === tab.key
                ? "border-sky-700 bg-sky-50 text-sky-900"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            {tab.label}
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px]">{counts[tab.countKey] || 0}</span>
          </button>
        ))}
      </nav>

      {["BOOKED", "DELIVERED", "ALL"].includes(activeTab) && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="ncm-carrier-status" className="text-xs font-bold text-slate-700">Carrier status</label>
          <select
            id="ncm-carrier-status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
            className="min-w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
          >
            <option value="">All statuses</option>
            {CARRIER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          {statusFilter && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter("");
                setPage(1);
              }}
              className="text-xs font-semibold text-sky-800 hover:underline"
            >
              Clear status
            </button>
          )}
        </div>
      )}

      {activeTab === "ON_HOLD" && (
        <div className="flex flex-col gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-xs text-sky-950">
            <CheckSquare className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Select door-to-door or door-to-hub for each packed order, then submit their individual NCM bookings together. A failed booking stays available for review; successful bookings are not repeated.</p>
          </div>
          <button
            type="button"
            onClick={handleBulkBook}
            disabled={!selectedIds.size || booking}
            className="shrink-0 rounded-xl bg-sky-800 px-4 py-2.5 text-xs font-bold text-white hover:bg-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {booking ? "Submitting bookings..." : `Book selected with NCM (${selectedIds.size})`}
          </button>
        </div>
      )}

      {batchResults.some((result) => !result.success) && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
          <p className="font-bold">Some bookings need attention:</p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            {batchResults.filter((result) => !result.success).map((result) => (
              <li key={result.assignmentId}>{String(result.orderId || result.assignmentId).slice(0, 12)} — {result.message}</li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">Loading NCM orders…</div>
      ) : visibleOrders.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <Package className="mx-auto h-9 w-9 text-slate-300" />
          <p className="mt-3 text-sm font-bold text-slate-800">No orders in this NCM view</p>
          <p className="mt-1 text-xs text-slate-500">Orders appear here after the delivery method is selected and the packed order is put on hold.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1000px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                {activeTab === "ON_HOLD" && (
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all visible held orders"
                      checked={visibleOrders.length > 0 && visibleOrders.every(({ assignmentId }) => selectedIds.has(assignmentId))}
                      onChange={toggleSelectVisible}
                    />
                  </th>
                )}
                <th className="px-4 py-3">Order / Products</th>
                <th className="px-4 py-3">Customer / Destination</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">NCM delivery</th>
                <th className="px-4 py-3">Delivery status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Likely delivery</th>
                <th className="px-4 py-3">Details</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleOrders.map((record) => {
                const order = record.order || {};
                const address = order.address || {};
                const delivery = record.delivery;
                const held = record.status === "on_hold";
                const canChooseDeliveryType = held || delivery?.canReapply;
                const selectedDeliveryType = getSelectedDeliveryType(record, deliveryTypes);
                const status = held
                  ? "On hold"
                  : delivery?.displayStatus || delivery?.ncmStatus ||
                    (delivery?.state === "SUBMISSION_FAILED" ? "Submission failed" : delivery?.state) ||
                    "Booking pending";
                const firstImage = getFirstItemImage(order.items || []);
                const createdAt = order.date || order.createdAt;
                return (
                  <tr key={record.assignmentId} className="hover:bg-slate-50/70">
                    {activeTab === "ON_HOLD" && (
                      <td className="px-3 py-3 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select order ${record.orderId}`}
                          checked={selectedIds.has(record.assignmentId)}
                          onChange={() => toggleSelected(record.assignmentId)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex min-w-64 items-start gap-3">
                        {firstImage
                          ? <img src={firstImage} alt="" className="h-11 w-11 rounded-lg border border-slate-200 object-cover" />
                          : <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><Package className="h-5 w-5" /></div>}
                        <div>
                          <Link to={`/orders/${record.assignmentId}`} className="font-bold text-slate-900 hover:text-sky-800">
                            #{String(record.orderId).slice(0, 12).toUpperCase()}
                          </Link>
                          <p className="mt-1 max-w-xs text-slate-600">
                            {(order.items || []).map((item) => `${item.name || "Product"} ×${item.quantity || 1}`).join(", ") || "Order items unavailable"}
                          </p>
                          {delivery?.ncmOrderId && <p className="mt-1 font-mono text-[10px] text-sky-800">NCM #{delivery.ncmOrderId}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{getCustomerName(address)}</p>
                      <p className="mt-1 text-slate-500">{address.phone || "No phone"} · {[address.city, address.district, address.province].filter(Boolean).join(", ") || "No destination"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${order.payment ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                        {order.payment ? "Paid" : `Unpaid · ${order.paymentMethod || "COD"}`}
                      </span>
                      <p className="mt-1 text-slate-500">{currency}{Number(order.amount || 0).toLocaleString()}</p>
                    </td>
                    <td className="px-4 py-3">
                      {canChooseDeliveryType ? (
                        <fieldset disabled={booking || retryingAssignmentId === record.assignmentId} className="space-y-1.5">
                          <legend className="sr-only">NCM delivery method for order {record.orderId}</legend>
                          {[
                            ["Door2Door", "Door to door"],
                            ...(record.deliveryOptionsAvailable ? [["Door2Branch", "Door to hub"]] : []),
                          ].map(([type, label]) => (
                            <label key={type} className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold text-slate-700">
                              <input
                                type="radio"
                                name={`delivery-type-${record.assignmentId}`}
                                value={type}
                                checked={selectedDeliveryType === type}
                                onChange={() => setDeliveryTypes((current) => ({
                                  ...current,
                                  [record.assignmentId]: type,
                                }))}
                              />
                              {label}
                            </label>
                          ))}
                        </fieldset>
                      ) : (
                        <span className="whitespace-nowrap font-semibold text-slate-700">
                          {(delivery?.deliveryType || address.deliveryType) === "Door2Branch" ? "Door to hub" : "Door to door"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${held ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800"}`}>{status}</span>
                      {delivery?.ncmPaymentStatus && <p className="mt-1 text-[10px] text-slate-500">NCM payment: {delivery.ncmPaymentStatus}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatDate(createdAt)}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{delivery?.likelyDeliveryAt ? formatDate(delivery.likelyDeliveryAt) : "Not provided by NCM"}</td>
                    <td className="px-4 py-3">
                      <Link to={`/orders/${record.assignmentId}`} className="inline-flex items-center gap-1 font-bold text-sky-800 hover:text-sky-950">
                        Open <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {delivery?.canReapply && (
                        <button
                          type="button"
                          onClick={() => handleReapply(record)}
                          disabled={Boolean(retryingAssignmentId) || booking}
                          className="whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-bold text-rose-800 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-50"
                        >
                          {retryingAssignmentId === record.assignmentId ? "Reapplying..." : "Reapply for delivery"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination?.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>Page {pagination.page} of {pagination.totalPages} · {pagination.total} orders</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading} className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold disabled:opacity-40">Previous</button>
            <button type="button" onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))} disabled={page >= pagination.totalPages || loading} className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </section>
  );
};

export default NcmDeliveries;
