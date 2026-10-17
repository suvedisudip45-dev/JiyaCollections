/* eslint-disable react/prop-types */

import { useMemo, useState } from "react";
import { BarChart3, CalendarDays, MapPinned, PackageSearch, TrendingUp } from "lucide-react";
import ProductAnalyticsSummary from "../components/product-analytics/ProductAnalyticsSummary";
import ProductPerformanceCharts from "../components/product-analytics/ProductPerformanceCharts";
import ProductPerformanceTable from "../components/product-analytics/ProductPerformanceTable";
import ProductSalesLocations from "../components/product-analytics/ProductSalesLocations";
import ProductSalesTimeline from "../components/product-analytics/ProductSalesTimeline";

const tabs = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "charts", label: "Charts & comparisons", icon: BarChart3 },
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
  const [activeTab, setActiveTab] = useState("overview");
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
    <div className="mx-auto max-w-[1600px] space-y-4 p-3 sm:p-5">
      <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-600">Retail analytics</p>
            <h1 className="mt-1 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">Product Performance &amp; Sales Analytics</h1>
            <p className="mt-1 text-xs text-slate-500">Sales mix, returns, and product performance across your business.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div role="group" aria-label="Select reporting period" className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1">
              {[
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
                { value: "year", label: "Year" },
                { value: "custom", label: "Custom" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={period === option.value}
                  onClick={() => setPeriod(option.value)}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${period === option.value ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {period === "custom" && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <CalendarDays size={15} className="shrink-0 text-slate-400" />
                <input aria-label="Start date" type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} className="w-32 text-xs text-slate-700 outline-none" />
                <span className="text-xs text-slate-400">to</span>
                <input aria-label="End date" type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} className="w-32 text-xs text-slate-700 outline-none" />
              </div>
            )}
          </div>
        </div>
        <nav aria-label="Product analytics views" className="flex gap-5 overflow-x-auto border-t border-slate-100 px-5">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              aria-current={activeTab === id ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-1 py-3 text-xs font-bold transition-colors ${activeTab === id ? "border-indigo-600 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
      </header>

      {customRangeIncomplete ? (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Choose both dates to view a custom period.</p>
      ) : (
        <>
          {activeTab === "charts" && <ProductPerformanceCharts token={token} filters={filters} />}
          {activeTab === "overview" && <ProductAnalyticsSummary token={token} filters={filters} onShowProducts={() => setActiveTab("products")} />}
          {activeTab === "products" && <ProductPerformanceTable token={token} filters={filters} onViewTimeline={viewTimeline} />}
          {activeTab === "locations" && <ProductSalesLocations token={token} filters={filters} product={selectedProduct} />}
          {activeTab === "timeline" && <ProductSalesTimeline token={token} filters={filters} product={selectedProduct} />}
        </>
      )}
    </div>
  );
};

export default ProductAnalytics;
