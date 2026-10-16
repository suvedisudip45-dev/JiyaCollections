import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  RotateCcw,
  RotateCw,
  Search,
  CheckSquare,
  Clock3,
  ExternalLink,
  Package,
} from "lucide-react";
import { backendUrl, useManufacturer, currency } from "../context/ManufacturerContext";

const PAGE_SIZE = 25;
const DISPATCHABLE_STATUSES = new Set([
  "assigned",
  "pending_acceptance",
  "accepted",
  "packed",
  "package_details_complete",
  "ready_for_pickup",
  "on_hold",
]);

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

const getCustomerName = (address = {}) =>
  String(address.name || `${address.firstName || ""} ${address.lastName || ""}`).trim() || "Customer";

const DistributorSelfDelivery = () => {
  const { token, manufacturer: distributor } = useManufacturer();
  const [orders, setOrders] = useState([]);
  const [customerReturnRequests, setCustomerReturnRequests] = useState([]);
  const [exchangeRequests, setExchangeRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [updatingId, setUpdatingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchResults, setBatchResults] = useState([]);
  const [dispatching, setDispatching] = useState(false);

  // Return QA Modal state
  const [returnOrder, setReturnOrder] = useState(null);
  const [returnRequestId, setReturnRequestId] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [returnItems, setReturnItems] = useState([]);
  const [damageType, setDamageType] = useState("DELIVERY_DAMAGE");
  const [damageNotes, setDamageNotes] = useState("");
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [exchangeToInspect, setExchangeToInspect] = useState(null);
  const [exchangeInspectionItems, setExchangeInspectionItems] = useState([]);
  const [exchangeInspectionNotes, setExchangeInspectionNotes] = useState("");
  const [submittingExchange, setSubmittingExchange] = useState(false);

  const loadOrders = useCallback(async ({ preserveBatchResults = false } = {}) => {
    if (!preserveBatchResults) setBatchResults([]);
    setLoading(true);
    try {
      const response = await axios.get(
        `${backendUrl}/api/distributor/orders/assigned`,
        {
          headers: { token },
          params: {
            status: statusFilter !== "all" ? statusFilter : undefined,
            page,
            limit: PAGE_SIZE,
          },
        }
      );
      setOrders(response.data.orders || []);
      setPagination(response.data.pagination || null);
      setSelectedIds(new Set());
      const [returnsResult, exchangesResult] = await Promise.allSettled([
        axios.get(`${backendUrl}/api/returns/customer/manufacturer`, { headers: { token } }),
        axios.get(`${backendUrl}/api/returns/exchange/distributor`, { headers: { token } }),
      ]);
      if (returnsResult.status === "fulfilled") {
        setCustomerReturnRequests(returnsResult.value.data.returns || []);
      } else {
        setCustomerReturnRequests([]);
        toast.error(returnsResult.reason?.response?.data?.message || "Could not load approved return requests.");
      }
      if (exchangesResult.status === "fulfilled") {
        setExchangeRequests(exchangesResult.value.data.requests || []);
      } else {
        setExchangeRequests([]);
        toast.error(exchangesResult.reason?.response?.data?.message || "Could not load approved exchange requests.");
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not load assigned deliveries.");
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, page]);

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

  const handleBulkDispatch = async () => {
    if (!selectedIds.size || dispatching) return;
    const count = selectedIds.size;
    if (!window.confirm(`Dispatch ${count} selected self-delivery order${count === 1 ? "" : "s"}?`)) return;

    setDispatching(true);
    setBatchResults([]);
    try {
      const response = await axios.post(
        `${backendUrl}/api/distributor/orders/self-delivery/bulk-dispatch`,
        { assignmentIds: [...selectedIds] },
        { headers: { token } }
      );
      const results = response.data?.results || [];
      setBatchResults(results);
      const succeeded = results.filter((result) => result.success).length;
      if (succeeded === results.length && results.length > 0) {
        toast.success(response.data.message || `Dispatched ${succeeded} orders.`);
      } else if (succeeded > 0) {
        toast.warning(response.data.message || `Dispatched ${succeeded} of ${results.length} orders.`);
      } else {
        toast.error(response.data?.message || "None of the selected orders could be dispatched.");
      }
      await loadOrders({ preserveBatchResults: true });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to dispatch selected orders.");
    } finally {
      setDispatching(false);
    }
  };

  const openReturnModal = (orderRef, approvedReturn) => {
    setReturnOrder(orderRef);
    setReturnRequestId(approvedReturn?.id || "");
    setReturnReason(approvedReturn?.reason || "Customer Return Request");
    setDamageType("DELIVERY_DAMAGE");
    setDamageNotes("");
    const items = (approvedReturn?.items || orderRef.order?.items || []).map((item) => ({
      productId: item.productId || item._id || item.id,
      name: item.name || "Product",
      size: item.size || "Standard",
      color: item.color || "Standard",
      quantity: Number(item.quantity || 1),
      maxQuantity: Number(item.quantity || 1),
      condition: "GOOD",
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
          returnRequestId,
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
      setReturnRequestId("");
      await loadOrders();
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to process customer return.");
    } finally {
      setSubmittingReturn(false);
    }
  };

  const openExchangeInspection = (request) => {
    setExchangeToInspect(request);
    setExchangeInspectionNotes("");
    setExchangeInspectionItems((request.items || []).map((item) => ({
      productId: item.productId,
      name: item.name || "Product",
      size: item.size || "Standard",
      color: item.color || "Standard",
      quantity: Number(item.quantity || 1),
      condition: "GOOD",
    })));
  };

  const handleExchangeAction = async (request, action, items, notes) => {
    setUpdatingId(request.id);
    try {
      const response = await axios.post(
        `${backendUrl}/api/returns/exchange/distributor/${request.id}/process`,
        { action, items, notes },
        { headers: { token } }
      );
      toast.success(response.data.message || (
        action === "RECEIVE_AND_INSPECT" ? "Returned items received and inspected." :
          action === "DISPATCH" ? "Replacement dispatched." : "Replacement marked delivered."
      ));
      setExchangeToInspect(null);
      await loadOrders();
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to update the exchange.");
    } finally {
      setUpdatingId(null);
      setSubmittingExchange(false);
    }
  };

  const submitExchangeInspection = async (event) => {
    event.preventDefault();
    if (!exchangeToInspect) return;
    setSubmittingExchange(true);
    await handleExchangeAction(
      exchangeToInspect,
      "RECEIVE_AND_INSPECT",
      exchangeInspectionItems,
      exchangeInspectionNotes
    );
  };

  const filteredOrders = orders.filter((o) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const orderId = (o.orderId || "").toLowerCase();
    const customer = getCustomerName(o.order?.address || {}).toLowerCase();
    const city = (o.order?.address?.city || "").toLowerCase();
    const phone = String(o.order?.address?.phone || "").toLowerCase();
    return orderId.includes(q) || customer.includes(q) || city.includes(q) || phone.includes(q);
  });

  const dispatchableOrders = filteredOrders.filter((orderRef) =>
    DISPATCHABLE_STATUSES.has(String(orderRef.status || "").toLowerCase())
  );
  const allVisibleDispatchableSelected = dispatchableOrders.length > 0 &&
    dispatchableOrders.every(({ assignmentId }) => selectedIds.has(assignmentId));
  const toggleSelectVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      dispatchableOrders.forEach(({ assignmentId }) => {
        if (allVisibleDispatchableSelected) next.delete(assignmentId);
        else next.add(assignmentId);
      });
      return next;
    });
  };
  const toggleSelected = (assignmentId) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(assignmentId)) next.delete(assignmentId);
      else next.add(assignmentId);
      return next;
    });
  };

  const openApprovedReturn = async (returnRecord) => {
    let orderRef = orders.find((order) => order.orderId === returnRecord.orderId);
    if (!orderRef) {
      try {
        const response = await axios.get(`${backendUrl}/api/distributor/orders/assigned`, {
          headers: { token },
        });
        const allOrders = response.data.orders || [];
        orderRef = allOrders.find((order) => order.orderId === returnRecord.orderId);
        if (orderRef) setOrders(allOrders);
      } catch (error) {
        toast.error(error.response?.data?.message || "Could not load the assigned delivery for this return.");
        return;
      }
      if (!orderRef) {
        toast.error("The assigned delivery for this approved return is not available in your hub.");
        return;
      }
    }
    openReturnModal(orderRef, returnRecord);
  };

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

      {(customerReturnRequests.length > 0 || exchangeRequests.length > 0) && (
        <section className="rounded-2xl border border-[#dedbd3] bg-[#ffffff] p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#171717]">Approved return & exchange requests</h2>
              <p className="mt-1 text-[11px] text-[#575757]">These self-delivery requests were approved by admin and routed to your hub.</p>
            </div>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">
              {customerReturnRequests.length + exchangeRequests.length} pending
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {customerReturnRequests.map((request) => (
              <article key={request.id} className="rounded-xl border border-rose-200 bg-rose-50/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-[#171717]">Return · Order #{String(request.orderId || "").slice(0, 8).toUpperCase()}</p>
                    <p className="mt-1 text-[11px] text-[#575757]">{request.customerName || "Customer"} · {request.reason}</p>
                    <p className="mt-2 text-[11px] text-[#575757]">
                      {(Array.isArray(request.items) ? request.items : []).map((item) => `${item.name || "Product"} ${item.size || "One size"}/${item.color || "Default"} ×${item.quantity}`).join(", ")}
                    </p>
                  </div>
                  <button type="button" onClick={() => openApprovedReturn(request)} className="shrink-0 rounded-lg bg-rose-700 px-3 py-2 text-[10px] font-bold text-white hover:bg-rose-800">
                    Receive & inspect
                  </button>
                </div>
              </article>
            ))}
            {exchangeRequests.map((request) => (
              <article key={request.id} className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
                <p className="text-xs font-bold text-[#171717]">Exchange · Order #{String(request.orderId || "").slice(0, 8).toUpperCase()}</p>
                <p className="mt-1 text-[11px] text-[#575757]">{request.customerName || "Customer"} · {request.reasonDetails || request.reasonCode}</p>
                <p className="mt-2 text-[10px] font-semibold text-indigo-800">
                  Return: {request.returnPickupStatus || "Awaiting return"} · Replacement: {request.replacementStatus || "Reserved"}
                </p>
                <p className="mt-2 text-[11px] text-[#575757]">
                  Returned: {(Array.isArray(request.items) ? request.items : []).map((item) => `${item.name || "Product"} ${item.size || "One size"}/${item.color || "Default"} ×${item.quantity}`).join(", ")}
                </p>
                <p className="mt-2 text-[11px] text-[#575757]">
                  Replacement: {(Array.isArray(request.replacementItems) ? request.replacementItems : []).map((item) => `${item.name || "Product"} ${item.size || "One size"}/${item.color || "Default"} ×${item.quantity}`).join(", ")}
                </p>
                {!request.inspectedAt && (
                  <button
                    type="button"
                    onClick={() => openExchangeInspection(request)}
                    disabled={updatingId === request.id}
                    className="mt-3 rounded-lg bg-indigo-700 px-3 py-2 text-[10px] font-bold text-white hover:bg-indigo-800 disabled:opacity-50"
                  >
                    Receive & inspect return
                  </button>
                )}
                {request.inspectedAt && !request.replacementStockConsumedAt && (
                  <button
                    type="button"
                    onClick={() => handleExchangeAction(request, "DISPATCH")}
                    disabled={updatingId === request.id}
                    className="mt-3 rounded-lg bg-indigo-700 px-3 py-2 text-[10px] font-bold text-white hover:bg-indigo-800 disabled:opacity-50"
                  >
                    {updatingId === request.id ? "Updating..." : "Dispatch reserved replacement"}
                  </button>
                )}
                {request.replacementStatus === "DISPATCHED" && (
                  <button
                    type="button"
                    onClick={() => handleExchangeAction(request, "DELIVER")}
                    disabled={updatingId === request.id}
                    className="mt-3 rounded-lg bg-emerald-700 px-3 py-2 text-[10px] font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {updatingId === request.id ? "Updating..." : "Mark replacement delivered"}
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Filter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { key: "all", label: "All Orders" },
          { key: "on_hold", label: "On hold" },
          { key: "assigned", label: "Assigned" },
          { key: "dispatched", label: "Dispatched" },
          { key: "on_the_way", label: "On The Way" },
          { key: "delivered", label: "Delivered" },
          { key: "returned", label: "Returned" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setStatusFilter(f.key);
              setPage(1);
            }}
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

      {dispatchableOrders.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-xs text-amber-950">
            <CheckSquare className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Select ready orders to dispatch them together. Each order is dispatched and recorded individually.</p>
          </div>
          <button
            type="button"
            onClick={handleBulkDispatch}
            disabled={!selectedIds.size || dispatching}
            className="shrink-0 rounded-xl bg-[#171717] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#262626] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {dispatching ? "Dispatching orders..." : `Dispatch selected (${selectedIds.size})`}
          </button>
        </div>
      )}

      {batchResults.some((result) => !result.success) && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
          <p className="font-bold">Some orders need attention:</p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            {batchResults.filter((result) => !result.success).map((result) => (
              <li key={result.assignmentId}>
                {String(result.orderId || result.assignmentId).slice(0, 12)} — {result.message}
              </li>
            ))}
          </ul>
        </div>
      )}

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
        <div className="overflow-x-auto rounded-2xl border border-[#dedbd3] bg-white shadow-sm">
          <table className="w-full min-w-[1120px] text-left text-xs">
            <thead className="bg-[#f8f7f4] text-[10px] uppercase tracking-wider text-[#575757]">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all dispatchable visible orders"
                    checked={allVisibleDispatchableSelected}
                    onChange={toggleSelectVisible}
                  />
                </th>
                <th className="px-4 py-3">Order / Products</th>
                <th className="px-4 py-3">Customer / Destination</th>
                <th className="px-4 py-3">Payment / COD</th>
                <th className="px-4 py-3">Delivery status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Expected delivery charge income</th>
                <th className="px-4 py-3">Details</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#dedbd3]/70">
              {filteredOrders.map((orderRef) => {
                const currentStatus = String(orderRef.status || "").toLowerCase().replaceAll(" ", "_");
                const order = orderRef.order || {};
                const address = order.address || {};
                const items = Array.isArray(order.items) ? order.items : [];
                const firstImage = items.find((item) => item?.image)?.image;
                const image = Array.isArray(firstImage) ? firstImage[0] : firstImage;
                const canDispatch = DISPATCHABLE_STATUSES.has(currentStatus);
                const statusLabel = currentStatus === "on_hold"
                  ? "On hold"
                  : currentStatus.replaceAll("_", " ");

                return (
                  <tr key={orderRef.assignmentId} className="hover:bg-[#f8f7f4]/70">
                    <td className="px-3 py-3 align-top">
                      {canDispatch && (
                        <input
                          type="checkbox"
                          aria-label={`Select order ${orderRef.orderId}`}
                          checked={selectedIds.has(orderRef.assignmentId)}
                          onChange={() => toggleSelected(orderRef.assignmentId)}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-64 items-start gap-3">
                        {image
                          ? <img src={image} alt="" className="h-11 w-11 shrink-0 rounded-lg border border-[#dedbd3] object-cover" />
                          : <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#f8f7f4] text-[#575757]"><Package className="h-5 w-5" /></div>}
                        <div>
                          <p className="font-bold text-[#171717]">
                            #{String(orderRef.orderId || "").slice(0, 12).toUpperCase()}
                          </p>
                          <p className="mt-1 max-w-xs text-[#575757]">
                            {items.map((item) =>
                              `${item.name || "Product"}${item.size || item.color ? ` (${item.size || "One size"}/${item.color || "Default"})` : ""} ×${item.quantity || 1}`
                            ).join(", ") || "Order items unavailable"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#171717]">{getCustomerName(address)}</p>
                      <p className="mt-1 text-[#575757]">{address.phone || "No phone"}</p>
                      <p className="mt-1 max-w-xs text-[#575757]">
                        {[address.street, address.city, address.district, address.province].filter(Boolean).join(", ") || "No destination"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${order.payment ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                        {order.payment ? "Paid" : String(order.paymentMethod || "COD").toUpperCase() === "COD" ? "COD due" : `Unpaid · ${order.paymentMethod || "Unknown"}`}
                      </span>
                      <p className="mt-1 font-semibold text-[#171717]">
                        {currency}{Number(order.amount || 0).toLocaleString()}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-bold capitalize ${
                        currentStatus === "delivered" ? "bg-emerald-50 text-emerald-700" :
                          currentStatus === "on_hold" ? "bg-amber-50 text-amber-800" :
                            currentStatus === "dispatched" || currentStatus === "on_the_way" ? "bg-sky-50 text-sky-800" :
                              currentStatus === "returned" ? "bg-rose-50 text-rose-700" : "bg-[#f1f0ec] text-[#575757]"
                      }`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#575757]">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />
                        {formatDate(order.date || orderRef.assignedAt)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-emerald-800">
                      {currency}{Number(orderRef.expectedDeliveryCharge || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/orders/${orderRef.assignmentId}`} className="inline-flex items-center gap-1 font-bold text-[#171717] hover:text-[#575757]">
                        Open <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {canDispatch && (
                        <button
                          type="button"
                          onClick={() => handleStatusUpdate(orderRef, "Dispatched")}
                          disabled={updatingId === orderRef.assignmentId || dispatching}
                          className="whitespace-nowrap rounded-lg bg-[#171717] px-3 py-2 text-[10px] font-bold text-white hover:bg-[#262626] disabled:opacity-50"
                        >
                          {updatingId === orderRef.assignmentId ? "Updating..." : "Mark dispatched"}
                        </button>
                      )}
                      {currentStatus === "dispatched" && (
                        <button
                          type="button"
                          onClick={() => handleStatusUpdate(orderRef, "On the Way")}
                          disabled={updatingId === orderRef.assignmentId || dispatching}
                          className="whitespace-nowrap rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          {updatingId === orderRef.assignmentId ? "Updating..." : "Mark on the way"}
                        </button>
                      )}
                      {currentStatus === "on_the_way" && (
                        <button
                          type="button"
                          onClick={() => handleStatusUpdate(orderRef, "Delivered")}
                          disabled={updatingId === orderRef.assignmentId || dispatching}
                          className="whitespace-nowrap rounded-lg bg-emerald-700 px-3 py-2 text-[10px] font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {updatingId === orderRef.assignmentId ? "Updating..." : "Mark delivered & collect"}
                        </button>
                      )}
                      {currentStatus === "delivered" && <span className="font-bold text-emerald-700">Delivered</span>}
                      {currentStatus === "returned" && <span className="font-bold text-rose-700">Returned</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && pagination?.pages > 1 && (
        <div className="flex items-center justify-between gap-3 text-xs text-[#575757]">
          <span>
            Page {pagination.page} of {pagination.pages} · {pagination.total} orders
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded-lg border border-[#dedbd3] bg-white px-3 py-2 font-semibold disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= pagination.pages}
              onClick={() => setPage((current) => Math.min(pagination.pages, current + 1))}
              className="rounded-lg border border-[#dedbd3] bg-white px-3 py-2 font-semibold disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Customer Return QA Modal */}
      {exchangeToInspect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={submitExchangeInspection} className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div>
              <h2 className="text-base font-bold text-[#171717]">Receive and inspect exchange return</h2>
              <p className="mt-1 text-xs text-[#575757]">Classify every approved return item. Replacement stock is already reserved and can be dispatched after inspection.</p>
            </div>
            <div className="space-y-2">
              {exchangeInspectionItems.map((item, index) => (
                <div key={`${item.productId}-${item.size}-${item.color}`} className="flex items-center justify-between gap-3 rounded-xl border border-[#dedbd3] p-3 text-xs">
                  <span className="font-semibold text-[#171717]">{item.quantity} × {item.name} ({item.size}/{item.color})</span>
                  <select
                    value={item.condition}
                    onChange={(event) => setExchangeInspectionItems((current) =>
                      current.map((entry, itemIndex) => itemIndex === index ? { ...entry, condition: event.target.value } : entry)
                    )}
                    className="rounded-lg border border-[#dedbd3] bg-white p-2"
                  >
                    <option value="GOOD">Good · restock</option>
                    <option value="DAMAGED">Damaged · record discrepancy</option>
                  </select>
                </div>
              ))}
            </div>
            <textarea
              value={exchangeInspectionNotes}
              onChange={(event) => setExchangeInspectionNotes(event.target.value)}
              placeholder="Inspection notes (required for damaged items)"
              className="min-h-20 w-full rounded-lg border border-[#dedbd3] p-3 text-xs focus:outline-none focus:border-[#171717]"
            />
            <div className="flex justify-end gap-2 border-t border-[#dedbd3] pt-3">
              <button type="button" onClick={() => setExchangeToInspect(null)} className="rounded-lg border border-[#dedbd3] px-3 py-2 text-xs text-[#575757]">Cancel</button>
              <button type="submit" disabled={submittingExchange} className="rounded-lg bg-indigo-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                {submittingExchange ? "Processing..." : "Confirm receipt & inspection"}
              </button>
            </div>
          </form>
        </div>
      )}

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
