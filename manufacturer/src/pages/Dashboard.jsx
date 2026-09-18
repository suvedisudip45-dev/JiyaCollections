import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Package,
  Clock,
  CheckCircle2,
  Truck,
  Boxes,
  Star,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  RefreshCw,
  ShoppingBag,
  MapPin,
  ShieldCheck,
  BellRing,
} from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";
import StatusBadge from "../components/StatusBadge";

const Dashboard = () => {
  const { token, manufacturer, backendUrl, currency, setStats } = useManufacturer();
  const [loading, setLoading] = useState(true);
  const [recentAssignments, setRecentAssignments] = useState([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [hubStats, setHubStats] = useState({
    pending: 0,
    accepted: 0,
    preparing: 0,
    packed: 0,
    ready: 0,
    inDelivery: 0,
    delivered: 0,
    total: 0,
  });

  const readinessSummary = (() => {
    const branch = (manufacturer?.ncmPickupBranch || "").trim();
    const branchStatus = (manufacturer?.pickupBranchStatus || "UNVERIFIED").toUpperCase();
    const pickupAddress = (manufacturer?.pickupAddress || "").trim();
    const pickupContactName = (manufacturer?.pickupContactName || "").trim();
    const pickupContactPhone = (manufacturer?.pickupContactPhone || "").trim();
    const pickupWindow = (manufacturer?.pickupWindow || "").trim();

    const missingFields = [];
    if (!branch) missingFields.push("NCM branch assignment");
    if (!pickupAddress) missingFields.push("Pickup address");
    if (!pickupContactName) missingFields.push("Contact name");
    if (!pickupContactPhone) missingFields.push("Contact phone");
    if (!pickupWindow) missingFields.push("Pickup window");

    const readinessScore = Math.max(0, 100 - missingFields.length * 20);
    const isReady = branch && !missingFields.length;

    return {
      branch,
      branchStatus,
      missingFields,
      readinessScore,
      isReady,
    };
  })();

  const loadDashboardData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      // 1. Fetch assignments
      const assignRes = await axios.get(`${backendUrl}/api/order-assignment/my`, {
        headers: { token },
      });
      if (assignRes.data.success) {
        const list = assignRes.data.assignments || [];
        setRecentAssignments(list.slice(0, 6));

        const pending = list.filter((a) => a.status === "assigned").length;
        const accepted = list.filter((a) => a.status === "accepted").length;
        const preparing = list.filter((a) => a.status === "preparing").length;
        const packed = list.filter((a) => a.status === "packed").length;
        const ready = list.filter((a) => a.status === "ready_for_pickup").length;
        const inDelivery = list.filter((a) => ["picked_up", "in_transit", "arrived_at_destination", "out_for_delivery"].includes(a.status)).length;
        const delivered = list.filter((a) => a.status === "delivered").length;

        const currentCounts = {
          pending,
          accepted,
          preparing,
          packed,
          ready,
          inDelivery,
          delivered,
          total: list.length,
          active: accepted + preparing + packed + ready + inDelivery,
        };
        setHubStats(currentCounts);
        setStats(currentCounts);
      }

      // 2. Fetch inventory for low stock count
      const invRes = await axios.get(`${backendUrl}/api/manufacturer-inventory/my`, {
        headers: { token },
      });
      if (invRes.data.success) {
        const low = invRes.data.inventory.filter(
          (item) => item.quantity - item.reservedQty <= item.lowStockThreshold
        );
        setLowStockCount(low.length);
      }
    } catch (err) {
      console.error("Dashboard data load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [token, backendUrl, setStats]);

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(() => loadDashboardData(), 15000);
    return () => clearInterval(interval);
  }, [loadDashboardData]);

  const handleQuickAccept = async (assignmentId) => {
    try {
      const res = await axios.post(
        `${backendUrl}/api/order-assignment/accept/${assignmentId}`,
        {},
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Order accepted! Moved to production.");
        loadDashboardData();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to accept order");
    }
  };

  return (
    <div className="dashboard-shell space-y-5">
      {/* Top Banner / Greeting */}
      <div className="bg-slate-950 text-white rounded-2xl p-6 sm:p-8 shadow-sm relative overflow-hidden border border-slate-800">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full bg-teal-400/10 text-teal-300 text-xs font-semibold border border-teal-400/20">
                City Hub: {manufacturer?.city}
              </span>
              <span className="text-xs text-slate-300">
                Contract: <span className="text-teal-300 font-semibold">{manufacturer?.contractStatus}</span>
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              {manufacturer?.businessName} Operations
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm mt-1 max-w-xl">
              Real-time regional dispatch engine. Fulfill localized orders, manage fabric stock, and maintain strict Aama quality standards.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={loadDashboardData}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all border border-white/10 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <Link
              to="/direct-orders"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition-all border border-white/10 cursor-pointer"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Direct Sale</span>
            </Link>
            <Link
              to="/orders"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer"
            >
              <span>View Orders</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-5 p-5 border-b border-slate-100">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 w-11 h-11 rounded-xl flex items-center justify-center ${readinessSummary.isReady ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {readinessSummary.isReady ? <ShieldCheck className="w-5 h-5" /> : <BellRing className="w-5 h-5" />}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Pickup readiness status</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">
                {readinessSummary.isReady ? "Operationally ready for pickup" : "Action required before dispatch"}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full font-bold ${readinessSummary.isReady ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
              {readinessSummary.isReady ? "READY" : "CHECKLIST"}
            </span>
            <span className="text-slate-500">Readiness score: {readinessSummary.readinessScore}%</span>
          </div>
        </div>

        <div className="grid xl:grid-cols-[1.2fr_0.8fr] gap-4 p-5">
          <div className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Admin-assigned NCM branch</p>
                <p className="mt-2 font-black text-slate-900">{readinessSummary.branch || "Not assigned yet"}</p>
                <p className="mt-1 text-slate-500">Status: {readinessSummary.branchStatus || "UNVERIFIED"}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Local pickup setup</p>
                <p className="mt-2 font-black text-slate-900">{manufacturer?.pickupAddress ? "Configured" : "Incomplete"}</p>
                <p className="mt-1 text-slate-500">{manufacturer?.pickupWindow || "No pickup window entered"}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Operational alert queue</p>
              <div className="mt-2 space-y-2 text-xs text-slate-700">
                {readinessSummary.missingFields.length === 0 ? (
                  <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-4 h-4" />
                    All required pickup details are complete. Courier dispatch can proceed without delay.
                  </div>
                ) : (
                  readinessSummary.missingFields.map((field) => (
                    <div key={field} className="flex items-center gap-2 text-amber-700 font-semibold">
                      <AlertTriangle className="w-4 h-4" />
                      {field} is missing from the local pickup profile.
                    </div>
                  ))
                )}
                {!readinessSummary.branch && (
                  <div className="flex items-center gap-2 text-rose-700 font-semibold">
                    <MapPin className="w-4 h-4" />
                    Admin has not assigned a valid NCM pickup branch yet. Please escalate to admin approval.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-white">
            <div className="flex items-center justify-between text-xs text-teal-300">
              <span>Hub snapshot</span>
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Assigned branch</span>
                <span className="font-bold">{readinessSummary.branch || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Contact</span>
                <span className="font-bold">{manufacturer?.pickupContactName || "Not set"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Phone</span>
                <span className="font-bold">{manufacturer?.pickupContactPhone || "Not set"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Venue</span>
                <span className="font-bold text-right">{manufacturer?.pickupAddress ? "Configured" : "Missing"}</span>
              </div>
            </div>

            <Link
              to="/pickup-profile"
              className="mt-5 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition-all"
            >
              Update pickup setup
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Pending Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Pending Acceptance
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">
              {hubStats.pending}
            </span>
            {hubStats.pending > 0 && (
              <span className="text-[11px] font-bold text-amber-600 animate-pulse">
                Action needed
              </span>
            )}
          </div>
        </div>

        {/* In Production */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              In Production
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">
              {hubStats.accepted + hubStats.preparing}
            </span>
            <span className="text-[11px] text-slate-500">packaging</span>
          </div>
        </div>

        {/* Ready for Pickup */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Ready for Pickup
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">
              {hubStats.packed + hubStats.ready}
            </span>
            <span className="text-[11px] text-emerald-600 font-medium">Awaiting driver</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">In Delivery</span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">{hubStats.inDelivery}</span>
            <span className="text-[11px] text-sky-600 font-medium">Live courier movement</span>
          </div>
        </div>

        {/* Quality Rating */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Customer Quality Score
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Star className="w-4 h-4 fill-amber-500" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">
              {manufacturer?.qualityRating?.toFixed(1) || "5.0"}
            </span>
            <span className="text-[11px] text-slate-500">
              / 5.0 ({manufacturer?.ratingCount || 0} reviews)
            </span>
          </div>
        </div>
      </div>

      {/* Low Stock Warning Banner if any */}
      {lowStockCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs sm:text-sm font-bold text-amber-900">
                {lowStockCount} item{lowStockCount > 1 ? "s" : ""} running low on stock in your hub!
              </p>
              <p className="text-xs text-amber-700">
                Replenish inventory to avoid missing out on auto-assigned customer orders.
              </p>
            </div>
          </div>
          <Link
            to="/inventory"
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shrink-0"
          >
            Update Stock
          </Link>
        </div>
      )}

      {/* Recent Assigned Orders Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Recent Assignments</h2>
            <p className="text-xs text-slate-500">
              Live orders routed to your hub by the proximity allocation engine
            </p>
          </div>
          <Link
            to="/orders"
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
          >
            View All ({hubStats.total})
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {recentAssignments.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Package className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600 text-sm">No orders assigned yet</p>
            <p className="text-xs text-slate-400 mt-1">
              When customers order in or near {manufacturer?.city}, orders will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-3 px-4">Order ID</th>
                  <th className="py-3 px-4">Customer City</th>
                  <th className="py-3 px-4">Items / Qty</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {recentAssignments.map((assignment) => {
                  const order = assignment.order;
                  const totalQty = order?.items?.reduce((sum, i) => sum + (i.quantity || 1), 0) || 0;
                  return (
                    <tr key={assignment.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        #{order?.id?.slice(-6) || assignment.id.slice(-6)}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {order?.address?.city || order?.shippingAddress?.city || "Nepal"}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        <span className="font-semibold text-slate-900">{totalQty} pcs</span>
                        <span className="text-slate-400 block text-[11px]">
                          {order?.items?.map((i) => i.name || i.product?.name).filter(Boolean).slice(0, 2).join(", ")}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {currency}
                        {order?.amount?.toLocaleString() || "0"}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={assignment.status} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        {assignment.status === "assigned" ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleQuickAccept(assignment.id)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
                            >
                              Accept
                            </button>
                            <Link
                              to={`/orders/${assignment.id}`}
                              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs"
                            >
                              View
                            </Link>
                          </div>
                        ) : (
                          <Link
                            to={`/orders/${assignment.id}`}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs"
                          >
                            Manage
                          </Link>
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
    </div>
  );
};

export default Dashboard;
