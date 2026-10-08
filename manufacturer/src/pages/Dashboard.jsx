import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Factory,
  MapPin,
  PackageCheck,
  PackageOpen,
  RefreshCw,
  ShieldCheck,
  Star,
  Wrench,
} from "lucide-react";
import { toast } from "react-toastify";
import { backendUrl, useManufacturer } from "../context/ManufacturerContext";

const Dashboard = () => {
  const { manufacturer, token, activeWorkspace } = useManufacturer();
  const [productionDashboard, setProductionDashboard] = useState(null);
  const [loadingProductionDashboard, setLoadingProductionDashboard] = useState(false);
  const isManufacturerWorkspace = activeWorkspace === "MANUFACTURER";

  const loadProductionDashboard = useCallback(async () => {
    if (!token || !isManufacturerWorkspace) return;
    setLoadingProductionDashboard(true);
    try {
      const response = await axios.get(`${backendUrl}/api/manufacturer-production/dashboard`, {
        headers: { token },
      });
      setProductionDashboard(response.data.dashboard);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load production and factory stock metrics.");
    } finally {
      setLoadingProductionDashboard(false);
    }
  }, [backendUrl, isManufacturerWorkspace, token]);

  useEffect(() => {
    loadProductionDashboard();
  }, [loadProductionDashboard]);

  const pickupFields = [
    ["NCM branch assignment", manufacturer?.ncmPickupBranch],
    ["Pickup address", manufacturer?.pickupAddress],
    ["Contact name", manufacturer?.pickupContactName],
    ["Contact phone", manufacturer?.pickupContactPhone],
    ["Pickup window", manufacturer?.pickupWindow],
  ];
  const missingFields = pickupFields.filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
  const isPickupReady = missingFields.length === 0;

  return (
    <div className="dashboard-shell space-y-5">
      <div className="bg-slate-950 text-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="inline-flex px-2.5 py-0.5 rounded-full bg-teal-400/10 text-teal-300 text-xs font-semibold border border-teal-400/20">
              Factory Operations
            </span>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight mt-2">
              {manufacturer?.businessName || manufacturer?.name || "Manufacturer"} Workspace
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm mt-1 max-w-xl">
              Manage production and replenish distributor hubs. Customer hub orders,
              hub inventory, gift stock, and physical marketing cards are handled
              in the distributor workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to="/production"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition-all"
            >
              Production orders
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              to="/bulk-transfers"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold border border-white/10 transition-all"
            >
              Distributor replenishment
              <Boxes className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {isManufacturerWorkspace && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Production overview</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">Factory output &amp; stock</h2>
            </div>
            <button
              type="button"
              onClick={loadProductionDashboard}
              disabled={loadingProductionDashboard}
              aria-label="Refresh production metrics"
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:text-slate-900 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loadingProductionDashboard ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {[
              {
                label: "Products in factory",
                value: productionDashboard?.factoryProductCount,
                icon: PackageOpen,
                color: "text-blue-700 bg-blue-50",
              },
              {
                label: "SKU variants in factory",
                value: productionDashboard?.factorySkuCount,
                icon: Boxes,
                color: "text-violet-700 bg-violet-50",
              },
              {
                label: "Factory units available",
                value: productionDashboard?.factoryUnitsAvailable,
                icon: PackageCheck,
                color: "text-emerald-700 bg-emerald-50",
              },
              {
                label: "Units produced",
                value: productionDashboard?.producedUnits,
                icon: Factory,
                color: "text-indigo-700 bg-indigo-50",
              },
              {
                label: "Good units produced",
                value: productionDashboard?.goodUnitsProduced,
                icon: Factory,
                color: "text-indigo-700 bg-indigo-50",
              },
              {
                label: "Units damaged",
                value: productionDashboard?.damagedUnits,
                icon: Wrench,
                color: "text-rose-700 bg-rose-50",
              },
            ].map(({ label, value, icon: Icon, color }) => (
              <article key={label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-3 text-2xl font-black text-slate-900">
                  {loadingProductionDashboard && productionDashboard === null
                    ? "—"
                    : Number(value || 0).toLocaleString()}
                </p>
              </article>
            ))}
          </div>
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            Factory inventory is not available to customers. Stock becomes storefront-eligible only after the distributor receives it.
          </p>
        </section>
      )}

      <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-4">
        <section className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
          <div className="flex items-start gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${isPickupReady ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {isPickupReady ? <ShieldCheck className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Factory pickup readiness</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">
                {isPickupReady ? "Pickup details are complete" : "Complete pickup setup"}
              </h2>
            </div>
          </div>
          <div className="mt-5 grid sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">NCM pickup branch</p>
              <p className="mt-2 font-bold text-slate-900">{manufacturer?.ncmPickupBranch || "Not assigned"}</p>
              <p className="mt-1 text-slate-500">
                Status: {manufacturer?.pickupBranchStatus || "UNVERIFIED"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Pickup address</p>
              <p className="mt-2 font-bold text-slate-900">{manufacturer?.pickupAddress || "Not configured"}</p>
              <p className="mt-1 text-slate-500">{manufacturer?.pickupWindow || "No pickup window entered"}</p>
            </div>
          </div>
          {missingFields.length > 0 && (
            <p className="mt-4 text-xs text-amber-700">
              Missing: {missingFields.join(", ")}.
            </p>
          )}
          <Link
            to="/pickup-profile"
            className="mt-5 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all"
          >
            Update pickup setup
            <MapPin className="w-3.5 h-3.5" />
          </Link>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Factory className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Production profile</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">Factory performance</h2>
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">Customer quality score</p>
            <div className="mt-2 flex items-center gap-2">
              <Star className="w-5 h-5 fill-amber-500 text-amber-500" />
              <span className="text-2xl font-black text-slate-900">
                {manufacturer?.qualityRating?.toFixed(1) || "5.0"}
              </span>
              <span className="text-xs text-slate-500">
                / 5.0 ({manufacturer?.ratingCount || 0} reviews)
              </span>
            </div>
          </div>
          <Link
            to="/performance"
            className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-indigo-700 hover:text-indigo-800"
          >
            View factory performance
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
