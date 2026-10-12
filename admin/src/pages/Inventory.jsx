/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";
import {
  Boxes,
  Search,
  AlertTriangle,
  RefreshCw,
  Package,
  Layers,
  Building2,
  Info,
  CheckCircle2,
  XCircle,
} from "lucide-react";

const Inventory = ({ token }) => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all"); // 'all' | 'low' | 'out' | 'in'
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${backendUrl}/api/product/list`, { headers: { token }, params: { limit: 50 } });
      if (res.data.success) {
        setProducts(res.data.products || []);
      }
    } catch (error) {
      console.error("Error loading inventory data:", error);
      toast.error("Failed to load inventory data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchData();
    }
  }, [token, fetchData]);

  // Calculated Stats
  const totalProducts = products.length;
  const totalUnits = products.reduce((acc, p) => acc + (Number(p.stockQuantity) || 0), 0);
  const lowStockCount = products.filter(
    (p) => (Number(p.stockQuantity) || 0) <= (Number(p.lowStockThreshold) || 5) && (Number(p.stockQuantity) || 0) > 0
  ).length;
  const outOfStockCount = products.filter((p) => (Number(p.stockQuantity) || 0) === 0).length;

  // Filtered Products
  const filteredProducts = products.filter((p) => {
    const qty = Number(p.stockQuantity) || 0;
    const threshold = Number(p.lowStockThreshold) || 5;

    let matchesStatus = true;
    if (filterStatus === "low") matchesStatus = qty <= threshold && qty > 0;
    else if (filterStatus === "out") matchesStatus = qty === 0;
    else if (filterStatus === "in") matchesStatus = qty > threshold;

    const matchesSearch =
      p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.category && p.category.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.subCategory && p.subCategory.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
            <Boxes className="w-6 h-6 text-slate-900" />
            Central Catalog Stock Monitor
          </h1>
          <p className="text-xs text-slate-500">
            Read-only aggregated inventory across all regional manufacturer hubs. Stock levels are updated directly by authorized manufacturers.
          </p>
        </div>

        <button
          onClick={fetchData}
          className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Stock
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-900">
          <p className="font-bold">Decentralized Stock Management Active</p>
          <p className="text-blue-800 mt-0.5">
            Admin defines garment varieties (sizes and colors). Physical inventory is verified and supplied exclusively by regional manufacturer hubs to guarantee real-world fulfillment accuracy.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Total Catalog SKUs
          </span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">
              {totalProducts}
            </span>
            <span className="text-xs text-slate-400">Products</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Total Physical Stock
          </span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900">
              {totalUnits}
            </span>
            <span className="text-xs text-slate-400">Garments</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Low Stock Alerts
          </span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-amber-600">
              {lowStockCount}
            </span>
            <span className="text-xs text-slate-400">SKUs</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Out of Stock
          </span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-rose-600">
              {outOfStockCount}
            </span>
            <span className="text-xs text-slate-400">SKUs</span>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search product, category, or subcategory..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-900"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          {[
            { id: "all", label: "All Items" },
            { id: "in", label: "In Stock" },
            { id: "low", label: "Low Stock (≤5)" },
            { id: "out", label: "Out of Stock" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterStatus(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                filterStatus === tab.id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Product Stock Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs">Loading catalog stock...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Package className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600 text-sm">No items match your filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-3.5 px-4">Garment</th>
                  <th className="py-3.5 px-4">Category</th>
                  <th className="py-3.5 px-4">Retail Price</th>
                  <th className="py-3.5 px-4 text-center">Configured Sizes &amp; Colors</th>
                  <th className="py-3.5 px-4 text-center">Network Stock</th>
                  <th className="py-3.5 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredProducts.map((p) => {
                  const qty = Number(p.stockQuantity) || 0;
                  const threshold = Number(p.lowStockThreshold) || 5;
                  const isOut = qty === 0;
                  const isLow = qty <= threshold && !isOut;

                  let sizesArr = [];
                  if (typeof p.sizes === "string") {
                    try { sizesArr = JSON.parse(p.sizes); } catch {}
                  } else if (Array.isArray(p.sizes)) sizesArr = p.sizes;

                  let colorsArr = [];
                  if (typeof p.colors === "string") {
                    try { colorsArr = JSON.parse(p.colors); } catch {}
                  } else if (Array.isArray(p.colors)) colorsArr = p.colors;

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          {p.image ? (
                            <img
                              src={Array.isArray(p.image) ? p.image[0] : p.image}
                              alt={p.name}
                              className="w-10 h-10 rounded-xl object-cover border border-slate-200 shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                              <Package className="w-5 h-5" />
                            </div>
                          )}
                          <div>
                            <span className="font-bold text-slate-900 block">{p.name}</span>
                            <span className="text-[10px] text-slate-400">
                              SKU: {p.id.slice(-8)}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-slate-600">
                        {p.category}
                        {p.subCategory && <span className="text-slate-400 block text-[10px]">{p.subCategory}</span>}
                      </td>

                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {currency}{p.price}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <div className="flex flex-wrap gap-1 justify-center max-w-[200px] mx-auto">
                          {sizesArr.slice(0, 4).map((s, idx) => (
                            <span key={idx} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">
                              {s}
                            </span>
                          ))}
                          {sizesArr.length > 4 && (
                            <span className="text-[10px] text-slate-400">+{sizesArr.length - 4}</span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-center font-black text-sm">
                        <span className={isOut ? "text-rose-600" : isLow ? "text-amber-600" : "text-emerald-700"}>
                          {qty} units
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                            isOut
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : isLow
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200"
                          }`}
                        >
                          {isOut ? "Out of Stock" : isLow ? "Low Stock" : "In Stock"}
                        </span>
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

export default Inventory;
