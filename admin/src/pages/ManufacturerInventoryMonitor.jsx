/* eslint-disable react/prop-types */
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Boxes,
  Search,
  RefreshCw,
  Building2,
  Package,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { backendUrl, currency } from "../App";

const ManufacturerInventoryMonitor = ({ token }) => {
  const [inventoryList, setInventoryList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [expandedProduct, setExpandedProduct] = useState(null);

  const fetchInventoryData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await axios.get(`${backendUrl}/api/manufacturer-inventory/admin/all`, {
        headers: { token },
      });
      if (res.data.success) {
        setInventoryList(res.data.inventory || []);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Failed to load multi-hub inventory");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchInventoryData();
  }, [fetchInventoryData]);

  // Group by Product
  const productMap = {};
  inventoryList.forEach((item) => {
    const pId = item.productId;
    if (!productMap[pId]) {
      productMap[pId] = {
        product: item.product,
        totalStock: 0,
        totalReserved: 0,
        totalAvailable: 0,
        skuIds: new Set(),
        hubs: [],
        hubMap: new Map(),
      };
    }
    const product = productMap[pId];
    const quantity = Number(item.quantity || 0);
    const reservedQty = Number(item.reservedQty || 0);
    const available = Math.max(0, quantity - reservedQty);
    product.totalStock += quantity;
    product.totalReserved += reservedQty;
    product.totalAvailable += available;
    if (item.sku?.id) product.skuIds.add(item.sku.id);

    const hubKey = `${item.hub?.type}:${item.hub?.id}`;
    let hub = product.hubMap.get(hubKey);
    if (!hub) {
      hub = {
        ...item.hub,
        quantity: 0,
        reservedQty: 0,
        available: 0,
        skus: [],
      };
      product.hubMap.set(hubKey, hub);
      product.hubs.push(hub);
    }
    hub.quantity += quantity;
    hub.reservedQty += reservedQty;
    hub.available += available;
    hub.skus.push({ ...item.sku, quantity, reservedQty, available });
  });

  const productsList = Object.values(productMap);

  const filtered = productsList.filter((p) => {
    if (filterType === "low" && p.totalAvailable > 15) return false;
    if (filterType === "out" && p.totalAvailable > 0) return false;
    if (filterType === "instock" && p.totalAvailable <= 0) return false;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const name = (p.product?.name || "").toLowerCase();
      const cat = (p.product?.category || "").toLowerCase();
      return name.includes(term) || cat.includes(term);
    }
    return true;
  });

  const totalPhysicalNetworkStock = productsList.reduce((sum, p) => sum + p.totalStock, 0);
  const totalReservedAcrossNepal = productsList.reduce((sum, p) => sum + p.totalReserved, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900">
            Multi-Hub Network Stock Monitor
          </h1>
          <p className="text-xs text-slate-500">
            Real-time SKU stock across active manufacturer factories and distributor hubs
          </p>
        </div>

        <button
          onClick={fetchInventoryData}
          className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Stock
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Products with Ledger Stock
          </span>
          <p className="text-2xl font-black text-slate-900 mt-1">{productsList.length} Products</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total Physical Stock Across All Hubs
          </span>
          <p className="text-2xl font-black text-slate-900 mt-1">
            {totalPhysicalNetworkStock}{" "}
            <span className="text-xs font-normal text-slate-500">garments</span>
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Reserved for Live Customer Orders
          </span>
          <p className="text-2xl font-black text-amber-600 mt-1">
            {totalReservedAcrossNepal}{" "}
            <span className="text-xs font-normal text-slate-500">units reserved</span>
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search product or category..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-900"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          {[
            { id: "all", label: "All SKUs" },
            { id: "instock", label: "Healthy Stock" },
            { id: "low", label: "Low in Hubs" },
            { id: "out", label: "Out of Stock" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                filterType === tab.id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Product Hub Breakdown Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs">Loading multi-hub inventory breakdown...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Boxes className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600 text-sm">No items found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((item) => {
              const p = item.product;
              const isExpanded = expandedProduct === p?.id;

              return (
                <div key={p?.id || item.productId} className="p-4 hover:bg-slate-50/50 transition-colors">
                  <div
                    onClick={() => setExpandedProduct(isExpanded ? null : p?.id)}
                    className="flex items-center justify-between gap-4 cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      {p?.image ? (
                        <img
                          src={Array.isArray(p.image) ? p.image[0] : p.image}
                          alt={p.name}
                          className="w-12 h-12 rounded-xl object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                          <Package className="w-6 h-6" />
                        </div>
                      )}
                      <div>
                        <h4 className="text-xs sm:text-sm font-bold text-slate-900">{p?.name}</h4>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                          <span>{p?.category}</span>
                          <span>•</span>
                          <span>
                            {currency}
                            {p?.price}
                          </span>
                          <span>•</span>
                          <span className="font-semibold text-slate-700">
                            {item.skuIds.size} SKU variant{item.skuIds.size === 1 ? "" : "s"}
                            {" · "}
                            {item.hubs.length} Hub{item.hubs.length === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-right text-xs">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">
                          Total Stock
                        </span>
                        <span className="font-black text-slate-900 text-sm">
                          {item.totalStock} pcs
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">
                          Available to Sell
                        </span>
                        <span
                          className={`font-black text-sm ${
                            item.totalAvailable > 0 ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {item.totalAvailable} pcs
                        </span>
                      </div>

                      <button className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Hub Breakdown Details */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-slate-100 bg-slate-50/80 rounded-xl p-4">
                      <h5 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-slate-600" />
                        Manufacturer and Distributor Inventory by SKU
                      </h5>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {item.hubs.map((hub) => (
                          <div
                            key={`${hub.type}:${hub.id}`}
                            className="bg-white p-3 rounded-xl border border-slate-200/80 text-xs space-y-1.5 shadow-2xs"
                          >
                            <div className="flex items-center justify-between font-bold text-slate-900">
                              <span>{hub.name}</span>
                              <span className="text-[11px] text-emerald-600 font-semibold">
                                {hub.type === "FACTORY" ? "Manufacturer" : "Distributor"}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500">{hub.city || hub.locationName}</p>

                            <div className="flex items-center justify-between text-slate-600 pt-1 border-t border-slate-100">
                              <span>Hub physical units:</span>
                              <strong>{hub.quantity}</strong>
                            </div>

                            <div className="flex items-center justify-between text-amber-700">
                              <span>Hub reserved:</span>
                              <strong>{hub.reservedQty}</strong>
                            </div>

                            <div className="flex items-center justify-between text-emerald-700 font-bold">
                              <span>Hub available:</span>
                              <span>{hub.available} units</span>
                            </div>

                            <div className="mt-2 border-t border-slate-100 pt-2">
                              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">SKU breakdown</p>
                              <div className="space-y-2">
                                {hub.skus.map((sku) => (
                                  <div key={sku.id} className="rounded-lg bg-slate-50 p-2">
                                    <div className="font-semibold text-slate-800">
                                      {sku.size} / {sku.color}
                                      {sku.code && <span className="ml-1 font-mono text-[10px] text-slate-500">({sku.code})</span>}
                                    </div>
                                    <div className="mt-1 grid grid-cols-3 gap-1 text-[10px]">
                                      <span>On hand <strong>{sku.quantity}</strong></span>
                                      <span>Reserved <strong className="text-amber-700">{sku.reservedQty}</strong></span>
                                      <span>Available <strong className="text-emerald-700">{sku.available}</strong></span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ManufacturerInventoryMonitor;
