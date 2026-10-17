/* eslint-disable react/prop-types */

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowUpRight, RotateCw } from "lucide-react";
import { productAnalyticsApi } from "../../api/productAnalytics";

const money = (amount) => `Rs ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const number = (amount) => Number(amount || 0).toLocaleString();

const ProductPerformanceTable = ({ token, filters, onViewTimeline }) => {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("soldQuantity");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await productAnalyticsApi.products(token, { ...filters, page, limit: 25, sort });
      if (!response.data?.success) throw new Error("Unable to load product performance.");
      setRows(response.data.products || []);
      setPagination(response.data.pagination);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load product performance.");
    } finally {
      setLoading(false);
    }
  }, [filters, page, sort, token]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-indigo-600">Catalog performance</p>
          <h2 className="mt-1 text-sm font-black text-slate-900">Products &amp; returns</h2>
          <p className="mt-0.5 text-xs text-slate-500">Sales, completed returns, and revenue for this period.</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          Sort by
          <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800">
            <option value="soldQuantity">Pieces sold</option>
            <option value="revenue">Revenue</option>
            <option value="returnedQuantity">Pieces returned</option>
          </select>
        </label>
      </div>

      {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading products…</p> : error ? (
        <div role="alert" className="p-6 text-sm text-red-800">
          <p className="flex items-center gap-2 font-bold"><AlertCircle size={16} /> Product data unavailable</p>
          <p className="mt-1">{error}</p>
          <button type="button" onClick={loadProducts} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white"><RotateCw size={13} /> Try again</button>
        </div>
      ) : rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">No product sales or completed returns in this date range.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">
                <tr>
                  <th className="px-5 py-3">Product</th>
                  <th className="px-5 py-3 text-right">Pieces sold</th>
                  <th className="px-5 py-3 text-right">Gross revenue</th>
                  <th className="px-5 py-3 text-right">Returned</th>
                  <th className="px-5 py-3 text-right">Return rate</th>
                  <th className="px-5 py-3 text-right">Net revenue</th>
                  <th className="px-5 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((product) => (
                  <tr key={product.productId} className="transition-colors hover:bg-indigo-50/30">
                    <td className="px-5 py-3">
                      <p className="font-bold text-slate-800">{product.name}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">{product.category || "Uncategorized"}</p>
                    </td>
                    <td className="px-5 py-3 text-right font-bold tabular-nums">{number(product.soldQuantity)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{money(product.grossRevenue)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{number(product.returnedQuantity)} <span className="text-slate-400">({number(product.returnCases)} cases)</span></td>
                    <td className="px-5 py-3 text-right tabular-nums">{Number(product.returnRate).toFixed(1)}%</td>
                    <td className="px-5 py-3 text-right font-bold tabular-nums">{money(product.netRevenue)}</td>
                    <td className="px-5 py-3">
                      <button type="button" onClick={() => onViewTimeline(product)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-bold text-indigo-700 hover:bg-indigo-50">
                        View timeline <ArrowUpRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination?.totalPages > 1 && (
            <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              <span>{number(pagination.total)} products · page {pagination.page} of {pagination.totalPages}</span>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 font-bold disabled:opacity-40">Previous</button>
                <button type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 font-bold disabled:opacity-40">Next</button>
              </div>
            </footer>
          )}
        </>
      )}
    </section>
  );
};

export default ProductPerformanceTable;
