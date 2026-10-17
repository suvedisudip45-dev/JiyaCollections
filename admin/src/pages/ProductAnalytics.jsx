/* eslint-disable react/prop-types */

import { useMemo, useState } from "react";
import { BarChart3, CalendarDays, MapPinned, PackageSearch, TrendingUp } from "lucide-react";
import ProductAnalyticsSummary from "../components/product-analytics/ProductAnalyticsSummary";
import ProductPerformanceCharts from "../components/product-analytics/ProductPerformanceCharts";
import ProductPerformanceTable from "../components/product-analytics/ProductPerformanceTable";
import ProductSalesLocations from "../components/product-analytics/ProductSalesLocations";
import ProductSalesTimeline from "../components/product-analytics/ProductSalesTimeline";

const tabs = [
  { id: "charts", label: "Charts & comparisons", icon: BarChart3 },
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "products", label: "Products & returns", icon: PackageSearch },
  { id: "locations", label: "Sales by location", icon: MapPinned },
  { id: "timeline", label: "Product timeline", icon: TrendingUp },
];

const localDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const initialStartDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return localDate(date);
};

const ProductAnalytics = ({ token }) => {
  const [period, setPeriod] = useState("month");
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(() => localDate(new Date()));
  const [activeTab, setActiveTab] = useState("charts");
  const [selectedProduct, setSelectedProduct] = useState(null);

  const filters = useMemo(() => (
    period === "custom" ? { period, startDate, endDate } : { period }
  ), [endDate, period, startDate]);

  const viewTimeline = (product) => {
    setSelectedProduct(product);
    setActiveTab("timeline");
  };

  const customRangeIncomplete = period === "custom" && (!startDate || !endDate);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-col justify-between gap-5 rounded-3xl bg-slate-950 px-6 py-6 text-white sm:flex-row sm:items-end sm:px-8">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">
            <BarChart3 size={15} /> Sales intelligence
          </div>
          <h1 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">Product performance</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">See what customers are buying, what comes back, and where your products are selling.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="product-analytics-period" className="sr-only">Date range</label>
          <select
            id="product-analytics-period"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className="rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:ring-2 focus:ring-indigo-400 [&>option]:text-slate-900"
          >
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="year">This year</option>
            <option value="custom">Custom dates</option>
          </select>
          {period === "custom" && (
            <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2">
              <CalendarDays size={15} className="text-indigo-200" />
              <input aria-label="Start date" type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} className="w-32 bg-transparent text-xs text-white outline-none [color-scheme:dark]" />
              <span className="text-xs text-slate-400">to</span>
              <input aria-label="End date" type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} className="w-32 bg-transparent text-xs text-white outline-none [color-scheme:dark]" />
            </div>
          )}
        </div>
      </header>

      <nav aria-label="Product analytics views" className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            aria-current={activeTab === id ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-colors ${activeTab === id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>

      {customRangeIncomplete ? (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Choose both dates to view a custom period.</p>
      ) : (
        <>
          {activeTab === "charts" && <ProductPerformanceCharts token={token} filters={filters} />}
          {activeTab === "overview" && <ProductAnalyticsSummary token={token} filters={filters} />}
          {activeTab === "products" && <ProductPerformanceTable token={token} filters={filters} onViewTimeline={viewTimeline} />}
          {activeTab === "locations" && <ProductSalesLocations token={token} filters={filters} product={selectedProduct} />}
          {activeTab === "timeline" && <ProductSalesTimeline token={token} filters={filters} product={selectedProduct} />}
        </>
      )}
    </div>
  );
};

export default ProductAnalytics;
