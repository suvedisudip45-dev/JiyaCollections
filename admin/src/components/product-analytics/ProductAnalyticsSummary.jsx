/* eslint-disable react/prop-types */

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RotateCw, ShoppingBag, Gift, TrendingDown, Banknote } from "lucide-react";
import { productAnalyticsApi } from "../../api/productAnalytics";

const money = (amount) => `Rs ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const number = (amount) => Number(amount || 0).toLocaleString();

const SummaryCard = ({ title, value, note, icon: Icon, tone }) => (
  <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between">
      <p className="text-xs font-semibold text-slate-500">{title}</p>
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon size={17} /></span>
    </div>
    <p className="mt-4 text-2xl font-black tracking-tight text-slate-900">{value}</p>
    <p className="mt-1 text-[11px] text-slate-500">{note}</p>
  </article>
);

const ProductAnalyticsSummary = ({ token, filters }) => {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
        <SummaryCard title="Product revenue" value={money(summary?.grossRevenue)} note={`${money(summary?.netRevenue)} after completed refunds`} icon={Banknote} tone="bg-emerald-50 text-emerald-700" />
        <SummaryCard title="Pieces sold" value={number(summary?.soldQuantity)} note={`${number(summary?.orderCount)} orders included`} icon={ShoppingBag} tone="bg-indigo-50 text-indigo-700" />
        <SummaryCard title="Items returned" value={number(summary?.returnedQuantity)} note={`${number(summary?.returnCases)} completed return cases`} icon={TrendingDown} tone="bg-amber-50 text-amber-700" />
        <SummaryCard title="Return rate" value={`${Number(summary?.returnRate || 0).toFixed(1)}%`} note="Returned pieces ÷ pieces sold in this range" icon={Gift} tone="bg-rose-50 text-rose-700" />
      </div>
      <p className="rounded-xl bg-slate-100 px-4 py-3 text-xs leading-relaxed text-slate-600">
        Product revenue uses the price saved with each order item and excludes delivery. Net revenue subtracts completed item refunds; order-level discounts are not allocated across products.
      </p>
    </section>
  );
};

export default ProductAnalyticsSummary;
