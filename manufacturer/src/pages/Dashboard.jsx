import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarDays,
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

const fetchAllPages = async ({ url, token, recordKey, limit }) => {
  const headers = { token };
  const firstResponse = await axios.get(url, { headers, params: { page: 1, limit } });
  const records = [...(firstResponse.data[recordKey] || [])];
  const totalPages = Number(firstResponse.data.pagination?.totalPages || 1);

  if (totalPages > 1) {
    const responses = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        axios.get(url, { headers, params: { page: index + 2, limit } })
      )
    );
    responses.forEach((response) => records.push(...(response.data[recordKey] || [])));
  }

  return records;
};

const getProductPortfolio = ({ productionRequests, transfers, inventory }) => {
  const products = new Map();
  const getProduct = (productId, productName) => {
    if (!products.has(productId)) {
      products.set(productId, {
        id: productId,
        name: productName || "Product",
        requestedAt: null,
        batches: [],
        plannedUnits: 0,
        producedUnits: 0,
        damagedUnits: 0,
        distributedUnits: 0,
        distributors: new Map(),
        availableUnits: 0,
        reservedUnits: 0,
      });
    }
    const product = products.get(productId);
    if (productName) product.name = productName;
    return product;
  };

  productionRequests.forEach((request) => {
    const productId = request.productId || request.product?.id;
    if (!productId) return;
    const product = getProduct(productId, request.product?.name || request.productName);
    const requestedAt = request.requestedAt || request.createdAt;
    if (requestedAt && (!product.requestedAt || new Date(requestedAt) < new Date(product.requestedAt))) {
      product.requestedAt = requestedAt;
    }
    const plannedUnits = (request.lines || []).reduce((total, line) => total + Number(line.quantity || 0), 0);
    const actualUnits = (request.lines || []).reduce((total, line) => total + Number(line.actualQuantity || 0), 0);
    const damagedUnits = (request.lines || []).reduce((total, line) => total + Number(line.damagedQuantity || 0), 0);
    product.plannedUnits += plannedUnits;
    product.producedUnits += actualUnits;
    product.damagedUnits += damagedUnits;
    product.batches.push({
      id: request.id,
      requestedAt,
      status: request.status,
      plannedUnits,
      producedUnits: actualUnits,
      damagedUnits,
    });
  });

  transfers.forEach((transfer) => {
    (transfer.lines || []).forEach((line) => {
      const productId = line.inventorySku?.productId || line.inventorySku?.product?.id;
      if (!productId) return;
      const product = getProduct(productId, line.inventorySku?.product?.name);
      const dispatchedUnits = Number(line.dispatchedQuantity || 0);
      if (!dispatchedUnits) return;
      product.distributedUnits += dispatchedUnits;
      const distributorId = transfer.distributor?.id || transfer.distributorId || "unknown";
      const distributorName = transfer.distributor?.name || "Distributor";
      const distributor = product.distributors.get(distributorId) || {
        id: distributorId,
        name: distributorName,
        units: 0,
      };
      distributor.units += dispatchedUnits;
      product.distributors.set(distributorId, distributor);
    });
  });

  inventory.forEach((item) => {
    const product = products.get(item.productId);
    if (!product) return;
    product.availableUnits = Number(item.availableQty ?? item.quantity ?? 0);
    product.reservedUnits = Number(item.reservedQty || 0);
  });

  return [...products.values()]
    .map((product) => ({
      ...product,
      batches: product.batches.sort((left, right) =>
        new Date(right.requestedAt || 0) - new Date(left.requestedAt || 0)
      ),
      distributors: [...product.distributors.values()].sort((left, right) => right.units - left.units),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
};

const Dashboard = () => {
  const { manufacturer, token, activeWorkspace } = useManufacturer();
  const [productionDashboard, setProductionDashboard] = useState(null);
  const [productPortfolio, setProductPortfolio] = useState([]);
  const [loadingProductionDashboard, setLoadingProductionDashboard] = useState(false);
  const isManufacturerWorkspace = activeWorkspace === "MANUFACTURER";

  const loadProductionDashboard = useCallback(async () => {
    if (!token || !isManufacturerWorkspace) return;
    setLoadingProductionDashboard(true);
    try {
      const [dashboardResponse, productionRequests, transfers, inventory] = await Promise.all([
        axios.get(`${backendUrl}/api/manufacturer-production/dashboard`, { headers: { token } }),
        fetchAllPages({
          url: `${backendUrl}/api/manufacturer-production/requests`,
          token,
          recordKey: "requests",
          limit: 50,
        }),
        fetchAllPages({
          url: `${backendUrl}/api/stock-transfers/manufacturer`,
          token,
          recordKey: "transfers",
          limit: 100,
        }),
        fetchAllPages({
          url: `${backendUrl}/api/manufacturer-inventory/my`,
          token,
          recordKey: "inventory",
          limit: 50,
        }),
      ]);
      setProductionDashboard(dashboardResponse.data.dashboard);
      setProductPortfolio(getProductPortfolio({ productionRequests, transfers, inventory }));
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
          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
            <div className="border-b border-slate-100 px-5 py-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Product-wise history</p>
              <h3 className="mt-1 text-base font-black text-slate-900">Production, distributor dispatch &amp; factory stock</h3>
              <p className="mt-1 text-xs text-slate-500">Production batch dates and quantities are shown alongside dispatched quantities by distributor and current factory stock.</p>
            </div>
            {loadingProductionDashboard && productPortfolio.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">Loading product history...</p>
            ) : productPortfolio.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No production or distributor dispatch history is available yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {productPortfolio.map((product) => (
                  <article key={product.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="font-bold text-slate-900">{product.name}</h4>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                          <CalendarDays className="h-3.5 w-3.5" />
                          First batch: {product.requestedAt ? new Date(product.requestedAt).toLocaleDateString() : "No production request"}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-4">
                        <div><p className="text-[10px] uppercase text-slate-500">Planned</p><p className="font-bold text-slate-800">{product.plannedUnits.toLocaleString()}</p></div>
                        <div><p className="text-[10px] uppercase text-slate-500">Produced</p><p className="font-bold text-indigo-700">{Math.max(0, product.producedUnits - product.damagedUnits).toLocaleString()} good</p></div>
                        <div><p className="text-[10px] uppercase text-slate-500">Dispatched</p><p className="font-bold text-blue-700">{product.distributedUnits.toLocaleString()}</p></div>
                        <div><p className="text-[10px] uppercase text-slate-500">Factory available</p><p className="font-bold text-emerald-700">{product.availableUnits.toLocaleString()}</p></div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Distributor allocation</p>
                        {product.distributors.length ? (
                          <ul className="mt-2 space-y-1.5">
                            {product.distributors.map((distributor) => (
                              <li key={distributor.id} className="flex justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                                <span className="font-medium text-slate-700">{distributor.name}</span>
                                <span className="font-bold text-slate-900">{distributor.units.toLocaleString()} units</span>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="mt-2 text-xs text-slate-500">No units dispatched to distributors yet.</p>}
                        {product.reservedUnits > 0 && <p className="mt-2 text-xs text-amber-700">{product.reservedUnits.toLocaleString()} units currently reserved for shipments.</p>}
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Production batches</p>
                        {product.batches.length ? (
                          <ul className="mt-2 space-y-1.5">
                            {product.batches.map((batch) => (
                              <li key={batch.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                                <span className="text-slate-700">
                                  {batch.requestedAt ? new Date(batch.requestedAt).toLocaleDateString() : "Date unavailable"}
                                  {" · "}Batch {batch.id.slice(0, 8)}
                                </span>
                                <span className="font-medium text-slate-700">
                                  {batch.producedUnits > 0
                                    ? `${Math.max(0, batch.producedUnits - batch.damagedUnits).toLocaleString()} good / ${batch.producedUnits.toLocaleString()} produced`
                                    : `${batch.plannedUnits.toLocaleString()} planned`}
                                  {" · "}{batch.status.replaceAll("_", " ")}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="mt-2 text-xs text-slate-500">No production batches recorded.</p>}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
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
