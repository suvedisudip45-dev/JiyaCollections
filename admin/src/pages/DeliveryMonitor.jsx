import React, { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Truck,
  CircleDollarSign,
  MapPin,
  Factory,
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ShieldCheck,
  ArrowRight,
  Copy,
  Check,
  Package,
  Navigation,
} from "lucide-react";
import { backendUrl, currency } from "../App";

const statusColors = {
  assigned: "bg-amber-50 text-amber-700 border-amber-200",
  accepted: "bg-blue-50 text-blue-700 border-blue-200",
  preparing: "bg-indigo-50 text-indigo-700 border-indigo-200",
  packed: "bg-violet-50 text-violet-700 border-violet-200",
  ready_for_pickup: "bg-orange-50 text-orange-700 border-orange-200",
  picked_up: "bg-cyan-50 text-cyan-700 border-cyan-200",
  in_transit: "bg-sky-50 text-sky-700 border-sky-200",
  arrived_at_destination: "bg-teal-50 text-teal-700 border-teal-200",
  out_for_delivery: "bg-violet-50 text-violet-700 border-violet-200",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  return_requested: "bg-rose-50 text-rose-700 border-rose-200",
  pending_assignment: "bg-slate-100 text-slate-700 border-slate-200",
};

const ncmStatusColors = {
  "Pickup Order Created": "bg-orange-50 text-orange-700 border-orange-200",
  "Sent for Pickup": "bg-orange-50 text-orange-700 border-orange-200",
  "Pickup Complete": "bg-teal-50 text-teal-700 border-teal-200",
  "Dispatched": "bg-sky-50 text-sky-700 border-sky-200",
  "In Transit": "bg-sky-50 text-sky-700 border-sky-200",
  "Arrived": "bg-cyan-50 text-cyan-700 border-cyan-200",
  "Sent for Delivery": "bg-violet-50 text-violet-700 border-violet-200",
  "Delivered": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Returned": "bg-rose-50 text-rose-700 border-rose-200",
};

const statusLabel = (value) => {
  const labels = {
    assigned: "Assigned",
    accepted: "Accepted",
    preparing: "Preparing",
    packed: "Packed",
    ready_for_pickup: "Ready for Pickup",
    picked_up: "Picked Up",
    in_transit: "In Transit",
    arrived_at_destination: "Arrived at Hub",
    out_for_delivery: "Out for Delivery",
    delivered: "Delivered",
    rejected: "Rejected",
    return_requested: "Return Requested",
    pending_assignment: "Pending Assignment",
  };
  return labels[(value || "").toLowerCase()] || (value || "Unknown").replace(/_/g, " ");
};

const toMoney = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toLocaleString("en-US") : "0";
};

// Click-to-copy mini component
const CopyableId = ({ value, label }) => {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-slate-400 text-[11px]">—</span>;
  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(String(value)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy ${label || "ID"}`}
      className="group inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-mono text-[11px] font-bold transition-colors cursor-pointer"
    >
      <span className="truncate max-w-[90px]">{value}</span>
      {copied ? (
        <Check className="w-3 h-3 text-emerald-600 shrink-0" />
      ) : (
        <Copy className="w-3 h-3 text-slate-400 group-hover:text-slate-600 shrink-0" />
      )}
    </button>
  );
};

const DeliveryMonitor = ({ token }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("all");
  const [settlementSummary, setSettlementSummary] = useState({
    totalDeliveryChargeExpected: 0,
    totalDeliveryChargePaid: 0,
    deliveryChargeToPay: 0,
    codExpected: 0,
    codReceived: 0,
    codToReceive: 0,
    pendingSettlements: 0,
    settledCount: 0,
  });
  const [settlementModalOpen, setSettlementModalOpen] = useState(false);
  const [settlementForm, setSettlementForm] = useState({ bankName: "", bankAccountName: "", bankAccountNumber: "" });
  const [settlementSubmitting, setSettlementSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [res, summaryRes] = await Promise.all([
        axios.get(`${backendUrl}/api/order-assignment/admin/all`, { headers: { token } }),
        axios.get(`${backendUrl}/api/delivery/admin/settlements/summary`, { headers: { token } }),
      ]);
      if (res.data.success) setRows(res.data.assignments || []);
      if (summaryRes.data.success) setSettlementSummary(summaryRes.data.summary || {});
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load delivery monitor");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const requestSettlement = async (event) => {
    event.preventDefault();
    setSettlementSubmitting(true);
    try {
      const res = await axios.post(`${backendUrl}/api/delivery/admin/settlements/request`, settlementForm, { headers: { token } });
      if (!res.data.success) throw new Error(res.data.message || "Settlement request failed");
      toast.success(`COD settlement ticket ${res.data.ticketId || "created"}`);
      setSettlementModalOpen(false);
      setSettlementForm({ bankName: "", bankAccountName: "", bankAccountNumber: "" });
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Settlement request failed");
    } finally {
      setSettlementSubmitting(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return rows.filter((row) => {
      const order = row.order || {};
      const manufacturer = row.manufacturer || {};
      const delivery = row.delivery || {};
      const customerName = `${order.address?.firstName || ""} ${order.address?.lastName || ""}`.trim();
      const matchesSearch =
        !term ||
        (order.id || row.orderId || "").toLowerCase().includes(term) ||
        customerName.toLowerCase().includes(term) ||
        (manufacturer.businessName || manufacturer.name || "").toLowerCase().includes(term) ||
        (manufacturer.city || "").toLowerCase().includes(term) ||
        (manufacturer.ncmPickupBranch || "").toLowerCase().includes(term) ||
        String(delivery.ncmOrderId || "").includes(term) ||
        (delivery.ncmStatus || "").toLowerCase().includes(term) ||
        (delivery.originBranchName || "").toLowerCase().includes(term) ||
        (delivery.destinationBranchName || "").toLowerCase().includes(term);

      if (!matchesSearch) return false;

      if (filter === "ready") return ["ready_for_pickup", "picked_up", "in_transit"].includes((row.status || "").toLowerCase());
      if (filter === "in_transit") return ["picked_up", "in_transit", "arrived_at_destination", "out_for_delivery"].includes((row.status || "").toLowerCase());
      if (filter === "delivered") return (row.status || "").toLowerCase() === "delivered";
      if (filter === "cod") return (order.paymentMethod || "COD") === "COD" || !order.payment;
      if (filter === "branch") return !(manufacturer.ncmPickupBranch || "").trim();
      if (filter === "delayed") return ["assigned", "accepted", "preparing", "packed"].includes((row.status || "").toLowerCase());
      return true;
    });
  }, [rows, searchTerm, filter]);

  const dashboard = useMemo(() => {
    const total = rows.length;
    const ready = rows.filter((row) => ["ready_for_pickup", "picked_up", "in_transit"].includes((row.status || "").toLowerCase())).length;
    const inTransit = rows.filter((row) => ["picked_up", "in_transit", "arrived_at_destination", "out_for_delivery"].includes((row.status || "").toLowerCase())).length;
    const cod = rows.filter((row) => (row.order?.paymentMethod || "COD") === "COD" || !row.order?.payment).length;
    const missingBranch = rows.filter((row) => !(row.manufacturer?.ncmPickupBranch || "").trim()).length;
    const delivered = rows.filter((row) => (row.status || "").toLowerCase() === "delivered").length;
    return { total, ready, inTransit, cod, missingBranch, delivered };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900">Delivery & COD Monitor</h1>
          <p className="text-xs text-slate-500">
            Live NCM courier tracking — pickup readiness, waybill IDs, branch routes, and COD exposure across all manufacturer hubs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSettlementModalOpen(true)}
            disabled={settlementSummary.codToReceive <= 0 || settlementSubmitting}
            className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-semibold shadow-xs cursor-pointer disabled:cursor-not-allowed"
          >
            Ask NCM for COD settlement
          </button>
          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh monitor
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          ["Delivery charges paid", settlementSummary.totalDeliveryChargePaid, "Settled carrier fees"],
          ["Delivery charges to pay", settlementSummary.deliveryChargeToPay, "Unsettled carrier fees"],
          ["COD received to date", settlementSummary.codReceived, "Confirmed by NCM"],
          ["COD to be received", settlementSummary.codToReceive, `${settlementSummary.pendingSettlements || 0} open settlement(s)`],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
            <p className="mt-2 text-xl font-black text-slate-900">Rs {toMoney(value)}</p>
            <p className="mt-1 text-[10px] text-slate-400">{note}</p>
          </div>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        {[
          { label: "Total orders", value: dashboard.total, icon: <Truck className="w-4 h-4" />, tone: "bg-slate-100 text-slate-800" },
          { label: "Ready pickup", value: dashboard.ready, icon: <Package className="w-4 h-4" />, tone: "bg-emerald-50 text-emerald-700" },
          { label: "In transit", value: dashboard.inTransit, icon: <Navigation className="w-4 h-4" />, tone: "bg-sky-50 text-sky-700" },
          { label: "COD active", value: dashboard.cod, icon: <CircleDollarSign className="w-4 h-4" />, tone: "bg-amber-50 text-amber-700" },
          { label: "Missing branch", value: dashboard.missingBranch, icon: <AlertTriangle className="w-4 h-4" />, tone: "bg-rose-50 text-rose-700" },
          { label: "Delivered", value: dashboard.delivered, icon: <ShieldCheck className="w-4 h-4" />, tone: "bg-cyan-50 text-cyan-700" },
        ].map((card) => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <div className={`inline-flex items-center justify-center w-8 h-8 rounded-xl ${card.tone}`}>
              {card.icon}
            </div>
            <div className="mt-3 text-2xl font-black text-slate-900">{card.value}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-3">
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search order / manufacturer / NCM ID / city..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {[
              { value: "all", label: "All" },
              { value: "ready", label: "Ready for Pickup" },
              { value: "in_transit", label: "In Transit" },
              { value: "delivered", label: "Delivered" },
              { value: "cod", label: "COD" },
              { value: "branch", label: "Missing Branch" },
              { value: "delayed", label: "Delayed" },
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={`px-3 py-1.5 rounded-xl font-semibold cursor-pointer ${
                  filter === tab.value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs">Loading delivery monitor...</p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Factory className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600 text-sm">No delivery records match this view</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-3 px-4">Order</th>
                  <th className="py-3 px-4">Manufacturer</th>
                  <th className="py-3 px-4">NCM Courier</th>
                  <th className="py-3 px-4">Branch Route</th>
                  <th className="py-3 px-4">Pickup Branch</th>
                  <th className="py-3 px-4">COD</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Timeline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row) => {
                  const order = row.order || {};
                  const manufacturer = row.manufacturer || {};
                  const delivery = row.delivery || {};
                  const customerName = `${order.address?.firstName || ""} ${order.address?.lastName || ""}`.trim() || "Customer";
                  const codAmount = Number(order.amount || 0) || 0;
                  const branchMissing = !(manufacturer.ncmPickupBranch || "").trim();
                  const ncmStatusColor = ncmStatusColors[delivery.ncmStatus] || "bg-slate-50 text-slate-600 border-slate-200";
                  const assignmentStatusColor = statusColors[(row.status || "assigned").toLowerCase()] || statusColors.assigned;
                  const hasNcm = !!(delivery.ncmOrderId || delivery.state);
                  const isDelivered = (row.status || "").toLowerCase() === "delivered";
                  const isActive = ["picked_up", "in_transit", "arrived_at_destination", "out_for_delivery"].includes((row.status || "").toLowerCase());

                  return (
                    <tr key={row.id} className={`hover:bg-slate-50/80 transition-colors ${isDelivered ? "bg-emerald-50/20" : isActive ? "bg-sky-50/20" : ""}`}>
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-bold text-slate-900">#{(order.id || row.orderId || row.id).toString().slice(-8).toUpperCase()}</div>
                        <div className="text-[11px] text-slate-500 mt-1">{customerName}</div>
                        <div className="text-[11px] text-slate-500">{order.address?.city || "Nepal"}</div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{manufacturer.businessName || manufacturer.name || "Unassigned"}</div>
                        <div className="text-[11px] text-slate-500">{manufacturer.city || "—"}</div>
                        <div className="text-[11px] text-slate-500">Rating {manufacturer.qualityRating?.toFixed(1) || "5.0"}</div>
                      </td>

                      {/* NCM Courier Column */}
                      <td className="py-3.5 px-4 min-w-[140px]">
                        {hasNcm ? (
                          <div className="space-y-1.5">
                            {delivery.ncmOrderId && (
                              <CopyableId value={delivery.ncmOrderId} label="NCM Order ID" />
                            )}
                            {delivery.vendorReference && (
                              <div className="text-[10px] text-slate-500">
                                Ref: <span className="font-mono font-bold">{delivery.vendorReference}</span>
                              </div>
                            )}
                            {delivery.ncmStatus && (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${ncmStatusColor}`}>
                                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                                {delivery.ncmStatus}
                              </span>
                            )}
                            {delivery.state && !delivery.ncmStatus && (
                              <span className="text-[10px] text-slate-500 font-mono">{delivery.state}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">
                            {["ready_for_pickup", "packed"].includes((row.status || "").toLowerCase()) ? "Pending NCM submission" : "Not yet submitted"}
                          </span>
                        )}
                      </td>

                      {/* Branch Route Column */}
                      <td className="py-3.5 px-4 min-w-[150px]">
                        {(delivery.originBranchName || delivery.destinationBranchName) ? (
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                            <span className="px-2 py-0.5 bg-orange-50 text-orange-700 border border-orange-200 rounded-md font-bold">
                              {delivery.originBranchName || "—"}
                            </span>
                            <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-bold">
                              {delivery.destinationBranchName || "—"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        {branchMissing ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-bold">
                            <AlertTriangle className="w-3 h-3" /> Missing
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                            <MapPin className="w-3 h-3" /> {manufacturer.ncmPickupBranch}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        {((order.paymentMethod || "COD") === "COD" || !order.payment) ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-bold">
                            <CircleDollarSign className="w-3 h-3" /> Rs {toMoney(codAmount)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                            <CheckCircle2 className="w-3 h-3" /> Prepaid
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold border ${assignmentStatusColor}`}>
                          {statusLabel(row.status)}
                        </span>
                      </td>

                      {/* Timeline Column */}
                      <td className="py-3.5 px-4 min-w-[130px]">
                        {delivery.pickedUpAt && (
                          <div className="text-[10px] text-slate-600 mb-1">
                            <span className="text-slate-400">Picked up:</span>
                            <br />
                            <span className="font-semibold">{new Date(delivery.pickedUpAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        )}
                        {delivery.deliveredAt && (
                          <div className="text-[10px] text-emerald-700 mb-1">
                            <span className="text-slate-400">Delivered:</span>
                            <br />
                            <span className="font-bold">{new Date(delivery.deliveredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        )}
                        {!delivery.pickedUpAt && !delivery.deliveredAt && (
                          <div className="text-[10px] text-slate-500">
                            {row.assignedAt ? new Date(row.assignedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                          </div>
                        )}
                        {branchMissing && <div className="text-[10px] text-rose-600 mt-1">Branch missing</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {settlementModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/45 flex items-center justify-center p-4">
          <form onSubmit={requestSettlement} className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div>
              <h2 className="text-base font-black text-slate-900">Request COD transfer from NCM</h2>
              <p className="mt-1 text-xs text-slate-500">NCM requires the destination bank details before creating the transfer ticket.</p>
            </div>
            {[['bankName', 'Bank name'], ['bankAccountName', 'Account holder name'], ['bankAccountNumber', 'Account number']].map(([field, label]) => (
              <label key={field} className="block text-xs font-semibold text-slate-700">
                {label}
                <input
                  required
                  type={field === "bankAccountNumber" ? "text" : "text"}
                  value={settlementForm[field]}
                  onChange={(event) => setSettlementForm((current) => ({ ...current, [field]: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal outline-none focus:border-slate-900"
                />
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setSettlementModalOpen(false)} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
              <button type="submit" disabled={settlementSubmitting} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-50">{settlementSubmitting ? "Requesting..." : "Create settlement ticket"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default DeliveryMonitor;
