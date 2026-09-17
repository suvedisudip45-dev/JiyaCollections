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
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  pending_assignment: "bg-slate-100 text-slate-700 border-slate-200",
};

const statusLabel = (value) => {
  const v = (value || "").toString().replace(/_/g, " ").toUpperCase();
  if (!v) return "UNKNOWN";
  if (v === "READY FOR PICKUP") return "READY FOR PICKUP";
  if (v === "PENDING ASSIGNMENT") return "PENDING ASSIGNMENT";
  return v;
};

const toMoney = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toLocaleString("en-US") : "0";
};

const DeliveryMonitor = ({ token }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("all");

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await axios.get(`${backendUrl}/api/order-assignment/admin/all`, {
        headers: { token },
      });
      if (res.data.success) {
        setRows(res.data.assignments || []);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load delivery monitor");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return rows.filter((row) => {
      const order = row.order || {};
      const manufacturer = row.manufacturer || {};
      const customerName = `${order.address?.firstName || ""} ${order.address?.lastName || ""}`.trim();
      const matchesSearch =
        !term ||
        (order.id || row.orderId || "").toLowerCase().includes(term) ||
        customerName.toLowerCase().includes(term) ||
        (manufacturer.businessName || manufacturer.name || "").toLowerCase().includes(term) ||
        (manufacturer.city || "").toLowerCase().includes(term) ||
        (manufacturer.ncmPickupBranch || "").toLowerCase().includes(term);

      if (!matchesSearch) return false;

      if (filter === "ready") return (row.status || "").toLowerCase().includes("ready") || (row.status || "").toLowerCase().includes("picked") || (row.status || "").toLowerCase().includes("transit");
      if (filter === "cod") return (order.paymentMethod || "COD") === "COD" || !order.payment;
      if (filter === "branch") return !(manufacturer.ncmPickupBranch || "").trim();
      if (filter === "operational") return !(manufacturer.pickupAddress || "").trim();
      if (filter === "delayed") return ["assigned", "accepted", "preparing", "packed"].includes((row.status || "").toLowerCase());
      return true;
    });
  }, [rows, searchTerm, filter]);

  const dashboard = useMemo(() => {
    const total = rows.length;
    const ready = rows.filter((row) => ["ready_for_pickup", "picked_up", "in_transit"].includes((row.status || "").toLowerCase())).length;
    const cod = rows.filter((row) => (row.order?.paymentMethod || "COD") === "COD" || !row.order?.payment).length;
    const missingBranch = rows.filter((row) => !(row.manufacturer?.ncmPickupBranch || "").trim()).length;
    const missingLocal = rows.filter((row) => !(row.manufacturer?.pickupAddress || "").trim()).length;
    const delivered = rows.filter((row) => (row.status || "").toLowerCase() === "delivered").length;
    return { total, ready, cod, missingBranch, missingLocal, delivered };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900">Delivery & COD Monitor</h1>
          <p className="text-xs text-slate-500">
            Track manufacturer pickup readiness, assigned NCM branches, and COD exposure across distributed hubs.
          </p>
        </div>

        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh monitor
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        {[
          { label: "Total orders", value: dashboard.total, icon: <Truck className="w-4 h-4" />, tone: "bg-slate-100 text-slate-800" },
          { label: "Ready pickup", value: dashboard.ready, icon: <CheckCircle2 className="w-4 h-4" />, tone: "bg-emerald-50 text-emerald-700" },
          { label: "COD active", value: dashboard.cod, icon: <CircleDollarSign className="w-4 h-4" />, tone: "bg-amber-50 text-amber-700" },
          { label: "Missing branch", value: dashboard.missingBranch, icon: <AlertTriangle className="w-4 h-4" />, tone: "bg-rose-50 text-rose-700" },
          { label: "Missing local setup", value: dashboard.missingLocal, icon: <MapPin className="w-4 h-4" />, tone: "bg-orange-50 text-orange-700" },
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
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search order / manufacturer / city"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {[
              { value: "all", label: "All" },
              { value: "ready", label: "Ready" },
              { value: "cod", label: "COD" },
              { value: "branch", label: "Missing branch" },
              { value: "operational", label: "Missing local setup" },
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
                  <th className="py-3 px-4">Pickup branch</th>
                  <th className="py-3 px-4">Local setup</th>
                  <th className="py-3 px-4">COD</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row) => {
                  const order = row.order || {};
                  const manufacturer = row.manufacturer || {};
                  const customerName = `${order.address?.firstName || ""} ${order.address?.lastName || ""}`.trim() || "Customer";
                  const codAmount = Number(order.amount || 0) || 0;
                  const branchMissing = !(manufacturer.ncmPickupBranch || "").trim();
                  const localMissing = !(manufacturer.pickupAddress || "").trim();
                  const readyState = ["ready_for_pickup", "picked_up", "in_transit"].includes((row.status || "").toLowerCase());

                  return (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-bold text-slate-900">#{(order.id || row.orderId || row.id).toString().slice(-8).toUpperCase()}</div>
                        <div className="text-[11px] text-slate-500 mt-1">{customerName}</div>
                        <div className="text-[11px] text-slate-500">{order.address?.city || "Nepal"}</div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{manufacturer.businessName || manufacturer.name || "Unassigned"}</div>
                        <div className="text-[11px] text-slate-500">{manufacturer.city || "—"}</div>
                        <div className="text-[11px] text-slate-500">Quality {manufacturer.qualityRating?.toFixed(1) || "5.0"}</div>
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
                        {localMissing ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-bold">
                            <Clock3 className="w-3 h-3" /> Incomplete
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                            <CheckCircle2 className="w-3 h-3" /> Ready
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
                            Prepaid
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold border ${statusColors[(row.status || "assigned").toLowerCase()] || statusColors.assigned}`}>
                          {statusLabel(row.status)}
                        </span>
                        {readyState && (
                          <div className="mt-1 text-[10px] text-emerald-600 font-semibold">Pickup-ready</div>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="text-slate-700 font-semibold">
                          {row.assignedAt ? new Date(row.assignedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </div>
                        {branchMissing && <div className="text-[10px] text-rose-600 mt-1">Branch assignment missing</div>}
                        {localMissing && <div className="text-[10px] text-amber-600 mt-1">Operational profile missing</div>}
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

export default DeliveryMonitor;
