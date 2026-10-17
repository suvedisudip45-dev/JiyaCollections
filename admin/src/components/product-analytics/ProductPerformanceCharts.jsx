/* eslint-disable react/prop-types */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, PieChart, RotateCw } from "lucide-react";
import { productAnalyticsApi } from "../../api/productAnalytics";

const SERIES_COLORS = ["#3157D5", "#168C78", "#E39B32", "#8A5BD1", "#D85B65", "#398DB5", "#7D9B3B", "#C16D35", "#57718F", "#BD579E", "#529D96", "#A67F3C"];
const number = (value) => Number(value || 0).toLocaleString();
const METRICS = [
  { id: "soldQuantity", label: "Pieces sold", format: (value) => `${Number(value || 0).toLocaleString()} pcs`, color: "#3157D5" },
  { id: "grossRevenue", label: "Gross revenue", format: (value) => `Rs ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: "#168C78" },
  { id: "grossProfit", label: "Est. gross profit", format: (value) => `Rs ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: "#8A5BD1" },
];

const VerticalBars = ({ title, subtitle, rows, metric, emptyLabel = "No sales recorded for this period." }) => {
  const sortedRows = useMemo(
    () => [...rows].sort((left, right) => Number(right[metric.id] || 0) - Number(left[metric.id] || 0)).slice(0, 10),
    [metric.id, rows],
  );
  const maxValue = Math.max(1, ...sortedRows.map((row) => Math.abs(Number(row[metric.id] || 0))));

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">{title}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{subtitle}</p>
        </div>
        <span className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-black" style={{ color: metric.color, backgroundColor: `${metric.color}14` }}>
          {metric.label}
        </span>
      </div>
      {sortedRows.length === 0 ? (
        <p className="py-9 text-center text-xs text-slate-400">{emptyLabel}</p>
      ) : (
        <div className="mt-4 overflow-x-auto pb-2">
          <div className="flex h-60 min-w-max items-stretch gap-3">
          {sortedRows.map((row, index) => {
            const value = Number(row[metric.id] || 0);
            const height = value !== 0 ? Math.max(3, (Math.abs(value) / maxValue) * 100) : 0;
            const label = row.district ? `${row.district}, ${row.name}` : row.name;
            const color = value < 0 ? "#D85B65" : SERIES_COLORS[index % SERIES_COLORS.length];
            return (
              <div key={row.id} role="img" aria-label={`${label}: ${metric.format(value)}`} className="flex w-[4.75rem] flex-col items-center">
                <span className="mb-2 flex h-7 max-w-full items-end justify-center truncate text-center text-[9px] font-bold tabular-nums text-slate-600" title={metric.format(value)}>
                  {metric.format(value)}
                </span>
                <div
                  className="relative flex w-full flex-1 items-end justify-center border-b border-slate-200"
                  style={{
                    backgroundImage: "linear-gradient(to bottom, transparent calc(25% - 1px), #e2e8f0 25%, transparent calc(25% + 1px), transparent calc(50% - 1px), #e2e8f0 50%, transparent calc(50% + 1px), transparent calc(75% - 1px), #e2e8f0 75%, transparent calc(75% + 1px))",
                  }}
                >
                  <div className="w-7 rounded-t-md transition-[height] duration-300" style={{ height: `${height}%`, backgroundColor: color }} />
                </div>
                <span className="mt-2 line-clamp-2 h-8 w-full text-center text-[9px] leading-4 text-slate-500" title={label}>{label}</span>
              </div>
            );
          })}
          </div>
        </div>
      )}
    </article>
  );
};

const DistributionPie = ({ rows, metric, title, subtitle, emptyLabel }) => {
  const segments = useMemo(() => {
    const positive = rows
      .filter((row) => Number(row[metric.id]) > 0)
      .sort((left, right) => Number(right[metric.id]) - Number(left[metric.id]))
      .slice(0, 8);
    const total = positive.reduce((sum, row) => sum + Number(row[metric.id]), 0);
    let start = 0;
    return positive.map((row, index) => {
      const share = total ? Number(row[metric.id]) / total * 100 : 0;
      const segment = { ...row, share, start, color: SERIES_COLORS[index % SERIES_COLORS.length] };
      start += share;
      return segment;
    });
  }, [metric.id, rows]);

  if (segments.length === 0) {
    return (
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-black text-slate-900">{title}</h3>
        <p className="mt-1 text-[11px] text-slate-500">{subtitle}</p>
        <p className="py-9 text-center text-xs text-slate-400">{emptyLabel}</p>
      </article>
    );
  }
  const gradient = segments.map(({ color, start, share }) => `${color} ${start}% ${start + share}%`).join(", ");

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-black text-slate-900">{title}</h3>
      <p className="mt-1 text-[11px] text-slate-500">{subtitle}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-6 sm:justify-start">
        <div
          role="img"
          aria-label={`${metric.label} pie chart: ${segments.map(({ name, district, share }) => `${district ? `${name}, ${district}` : name} ${share.toFixed(1)} percent`).join(", ")}`}
          className="h-36 w-36 shrink-0 rounded-full"
          style={{ background: `conic-gradient(${gradient})` }}
        />
        <ul className="min-w-[160px] flex-1 space-y-2">
          {segments.map((segment) => (
            <li key={segment.id} className="flex items-center justify-between gap-3 text-[10px]">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: segment.color }} />
                <span className="truncate font-semibold text-slate-600">{segment.district ? `${segment.name}, ${segment.district}` : segment.name}</span>
              </span>
              <span className="shrink-0 text-right font-black tabular-nums text-slate-800">
                {metric.format(segment[metric.id])} · {segment.share.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-[10px] text-slate-400">Share among the leading positive values.</p>
    </article>
  );
};

const ProductPerformanceCharts = ({ token, filters }) => {
  const [charts, setCharts] = useState({ products: [], locations: [], distributors: [], costCoverage: { uncostedQuantity: 0 } });
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [displayMode, setDisplayMode] = useState("bars");
  const [selectedMetricId, setSelectedMetricId] = useState("grossRevenue");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCharts = useCallback(async (productId) => {
    setLoading(true);
    setError("");
    try {
      const response = await productAnalyticsApi.charts(token, {
        ...filters,
        ...(productId ? { productId } : {}),
      });
      if (!response.data?.success) throw new Error("Unable to load performance charts.");
      setCharts(response.data.charts || { products: [], locations: [], distributors: [], costCoverage: { uncostedQuantity: 0 } });
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load performance charts.");
    } finally {
      setLoading(false);
    }
  }, [filters, token]);

  useEffect(() => {
    let active = true;
    const loadOptions = async () => {
      try {
        const response = await productAnalyticsApi.products(token, { ...filters, page: 1, limit: 100, sort: "soldQuantity" });
        if (!response.data?.success) throw new Error("Unable to load product choices.");
        if (active) {
          const options = response.data.products || [];
          setProducts(options);
          setSelectedProductId((current) => options.some(({ productId }) => productId === current)
            ? current
            : options[0]?.productId || "");
        }
      } catch (requestError) {
        if (active) setError(requestError.response?.data?.message || "Unable to load product choices.");
      }
    };
    loadOptions();
    return () => { active = false; };
  }, [filters, token]);

  useEffect(() => {
    loadCharts(selectedProductId);
  }, [loadCharts, selectedProductId]);

  const selectedProduct = products.find(({ productId }) => productId === selectedProductId);
  const selectedMetric = METRICS.find(({ id }) => id === selectedMetricId) || METRICS[0];
  const uncostedQuantity = Number(charts.costCoverage?.uncostedQuantity || 0);

  if (loading && !charts.products.length && !charts.locations.length) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Preparing sales charts…</div>;
  }
  if (error && !charts.products.length && !charts.locations.length) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        <p className="flex items-center gap-2 font-bold"><AlertCircle size={16} /> Performance charts unavailable</p>
        <p className="mt-1">{error}</p>
        <button type="button" onClick={() => loadCharts(selectedProductId)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white"><RotateCw size={13} /> Try again</button>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 size={17} className="text-indigo-600" />
                <h2 className="text-sm font-black text-slate-900">Performance charts</h2>
              </div>
              <p className="mt-1 text-xs text-slate-500">Compare sales, revenue and estimated gross profit by product, place and distributor.</p>
          </div>
          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Compare distributors for
            <select
              aria-label="Select a product for distributor comparison"
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
              className="min-w-56 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold normal-case tracking-normal text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">All products</option>
              {products.map((product) => <option key={product.productId} value={product.productId}>{product.name}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Visualization</p>
              <div role="group" aria-label="Choose chart type" className="mt-1 inline-flex rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  aria-pressed={displayMode === "bars"}
                  onClick={() => setDisplayMode("bars")}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] font-bold transition-colors ${displayMode === "bars" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  <BarChart3 size={13} /> Bar diagram
                </button>
                <button
                  type="button"
                  aria-pressed={displayMode === "pie"}
                  onClick={() => setDisplayMode("pie")}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] font-bold transition-colors ${displayMode === "pie" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  <PieChart size={13} /> Pie chart
                </button>
              </div>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Measure</p>
              <div role="group" aria-label="Select measure for charts" className="mt-1 inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-1">
                {METRICS.map((metric) => (
                  <button
                    key={metric.id}
                    type="button"
                    aria-pressed={selectedMetricId === metric.id}
                    onClick={() => setSelectedMetricId(metric.id)}
                    className={`rounded-md px-2.5 py-1.5 text-[10px] font-bold transition-colors ${selectedMetricId === metric.id ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}
                  >
                    {metric.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500">Up to 10 leading results in each comparison.</p>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">{error}</p>}
      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-[10px] ${uncostedQuantity > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-100 bg-emerald-50/70 text-emerald-800"}`}>
        <span className="font-bold">Profit basis: gross product profit</span>
        <span>{uncostedQuantity > 0 ? `${number(uncostedQuantity)} sold units have no recorded cost; profit is incomplete.` : "No missing item costs reported for this selection."}</span>
      </div>

      {displayMode === "bars" ? (
        <>
          <VerticalBars
            title="Top products"
            subtitle="Across the selected date range."
            rows={charts.products}
            metric={selectedMetric}
          />
          <VerticalBars
            title="Top provinces & districts"
            subtitle="Customer delivery address captured on the order."
            rows={charts.locations}
            metric={selectedMetric}
          />
          <VerticalBars
            title="Distributor comparison"
            subtitle={selectedProduct ? `Performance for ${selectedProduct.name}.` : "All products combined; choose one product to compare its distributors."}
            rows={charts.distributors}
            metric={selectedMetric}
            emptyLabel={selectedProduct ? "No attributed distributor sales for this product in this range." : "No distributor-attributed sales in this period."}
          />
        </>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <DistributionPie
            rows={charts.products}
            metric={selectedMetric}
            title="Product contribution"
            subtitle="Share of the selected measure by product."
            emptyLabel="No positive product values for this measure in this period."
          />
          <DistributionPie
            rows={charts.locations}
            metric={selectedMetric}
            title="Sales by place"
            subtitle="Share of the selected measure by province and district."
            emptyLabel="No positive location values for this measure in this period."
          />
          <DistributionPie
            rows={charts.distributors}
            metric={selectedMetric}
            title="Distributor comparison"
            subtitle={selectedProduct ? `Share for ${selectedProduct.name}.` : "Share across all products; select a product above to compare."}
            emptyLabel="No positive distributor values for this measure in this period."
          />
        </div>
      )}
      <p className="rounded-lg bg-slate-50 px-4 py-3 text-[10px] leading-relaxed text-slate-500">
        Gross profit = item revenue minus recorded item COGS and completed refunds. Delivery and operating expenses are excluded. Returns are grouped by refund completion date. Distributor comparisons include direct distributor orders and assigned orders; revenue is shown to Admin only.
      </p>
    </section>
  );
};

export default ProductPerformanceCharts;
