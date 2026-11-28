/* eslint-disable react/prop-types */

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowUpRight, RotateCw, ShoppingBag, Gift, TrendingDown, Banknote } from "lucide-react";
import { productAnalyticsApi } from "../../api/productAnalytics";

const money = (amount) => `Rs ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const number = (amount) => Number(amount || 0).toLocaleString();

const SummaryCard = ({ title, value, note, icon: Icon, tone, accent }) => (
  <article className={`overflow-hidden rounded-xl border border-slate-200 border-t-2 ${accent} bg-white p-4 shadow-sm sm:p-5`}>
    <div className="flex items-center justify-between">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{title}</p>
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}><Icon size={15} /></span>
    </div>
    <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">{value}</p>
    <p className="mt-1 text-[11px] text-slate-500">{note}</p>
  </article>
);

const ProductAnalyticsSummary = ({ token, filters, onShowProducts }) => {
  const [summary, setSummary] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [error, setError] = useState("");
  const [productsError, setProductsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await productAnalyticsApi.summary(token, filters);
      if (!response.data?.success) throw new Error("Unable to load product sales summary.");
      setSummary(response.data.summary);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load product sales summary.");
    } finally {
      setLoading(false);
    }
  }, [filters, token]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const loadTopProducts = useCallback(async () => {
    setProductsLoading(true);
    setProductsError("");
    try {
      const response = await productAnalyticsApi.products(token, {
        ...filters,
        page: 1,
        limit: 5,
        sort: "soldQuantity",
      });
      if (!response.data?.success) throw new Error("Unable to load top products.");
      setTopProducts(response.data.products || []);
    } catch (requestError) {
      setProductsError(requestError.response?.data?.message || "Unable to load top products.");
    } finally {
      setProductsLoading(false);
    }
  }, [filters, token]);

  useEffect(() => {
    loadTopProducts();
  }, [loadTopProducts]);

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading sales overview…</div>;
  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        <div className="flex items-center gap-2 font-bold"><AlertCircle size={16} /> Sales overview unavailable</div>
        <p className="mt-1">{error}</p>
        <button type="button" onClick={loadSummary} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white">
          <RotateCw size={13} /> Try again
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Gross revenue" value={money(summary?.grossRevenue)} note={`${money(summary?.netRevenue)} net after refunds`} icon={Banknote} tone="bg-blue-50 text-blue-700" accent="border-t-blue-600" />
        <SummaryCard title="Pieces sold" value={number(summary?.soldQuantity)} note={`${number(summary?.orderCount)} orders included`} icon={ShoppingBag} tone="bg-indigo-50 text-indigo-700" accent="border-t-indigo-500" />
        <SummaryCard title="Items returned" value={number(summary?.returnedQuantity)} note={`${number(summary?.returnCases)} completed cases`} icon={TrendingDown} tone="bg-amber-50 text-amber-700" accent="border-t-emerald-500" />
        <SummaryCard title="Return rate" value={`${Number(summary?.returnRate || 0).toFixed(1)}%`} note="Returned pieces ÷ pieces sold" icon={Gift} tone="bg-rose-50 text-rose-700" accent="border-t-rose-500" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 sm:px-5">
            <div>
              <h2 className="text-sm font-black text-slate-900">Top contributing products</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Leading products by pieces sold in this period.</p>
            </div>
            <button type="button" onClick={onShowProducts} className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
              Product details <ArrowUpRight size={13} />
            </button>
          </header>
          {productsLoading ? (
            <p className="p-6 text-center text-xs text-slate-500">Loading product contributions…</p>
          ) : productsError ? (
            <div role="alert" className="p-5 text-xs text-red-700">
              <p>{productsError}</p>
              <button type="button" onClick={loadTopProducts} className="mt-2 inline-flex items-center gap-1 font-bold"><RotateCw size={12} /> Try again</button>
            </div>
          ) : topProducts.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">No product sales in this period.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {topProducts.map((product, index) => (
                <li key={product.productId} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-black ${index === 0 ? "bg-indigo-50 text-indigo-700" : "bg-slate-50 text-slate-500"}`}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-slate-800">{product.name}</p>
                    <p className="mt-0.5 truncate text-[10px] text-slate-400">{product.category || "Uncategorized"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-black tabular-nums text-slate-800">{number(product.soldQuantity)} pcs</p>
                    <p className="mt-0.5 text-[10px] tabular-nums text-slate-500">{money(product.grossRevenue)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">How to read this report</p>
            <h2 className="mt-2 text-sm font-black text-slate-900">Sales performance, at a glance</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">Revenue is calculated from the item prices saved with orders. Net revenue subtracts completed item refunds; delivery charges and order-level discounts are not allocated across products.</p>
          </div>
          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-semibold text-slate-500">Return rate</p>
            <p className="mt-1 text-xs font-bold text-slate-700">Returned pieces ÷ pieces sold for this period.</p>
          </div>
        </aside>
      </div>
    </section>
  );
};

export default ProductAnalyticsSummary;
