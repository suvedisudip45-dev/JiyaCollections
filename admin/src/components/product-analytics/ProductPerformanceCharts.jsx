/* eslint-disable react/prop-types */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, PieChart, RotateCw } from "lucide-react";
import { productAnalyticsApi } from "../../api/productAnalytics";

const SERIES_COLORS = ["#3157D5", "#168C78", "#E39B32", "#8A5BD1", "#D85B65", "#398DB5", "#7D9B3B", "#C16D35", "#57718F", "#BD579E", "#529D96", "#A67F3C"];
const METRICS = [
  { id: "soldQuantity", label: "Pieces sold", format: (value) => `${Number(value || 0).toLocaleString()} pcs`, color: "#3157D5" },
  { id: "grossRevenue", label: "Gross revenue", format: (value) => `Rs ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: "#168C78" },
  { id: "grossProfit", label: "Est. gross profit", format: (value) => `Rs ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: "#8A5BD1" },
];

const HorizontalBars = ({ title, subtitle, rows, metric, emptyLabel = "No sales recorded for this period." }) => {
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
        <div className="mt-5 space-y-3.5">
          {sortedRows.map((row, index) => {
            const value = Number(row[metric.id] || 0);
            const width = value !== 0 ? Math.max(2, (Math.abs(value) / maxValue) * 100) : 0;
            return (
              <div key={row.id} className="grid grid-cols-[minmax(75px,0.8fr)_minmax(70px,1.8fr)_auto] items-center gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-bold text-slate-700" title={row.name}>{row.name}</p>
                  {row.district && <p className="truncate text-[9px] text-slate-400">{row.district}</p>}
                </div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full transition-[width] duration-300 ${value < 0 ? "ml-auto" : ""}`} style={{ width: `${width}%`, backgroundColor: value < 0 ? "#D85B65" : SERIES_COLORS[index % SERIES_COLORS.length] }} />
                </div>
                <span className="min-w-[68px] text-right text-[10px] font-black tabular-nums text-slate-700">{metric.format(value)}</span>
              </div>
            );
          })}
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
      <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold text-slate-700">Visualization</p>
            <p className="mt-0.5 text-[10px] text-slate-500">Choose one view for the same sales records.</p>
          </div>
          <div role="group" aria-label="Choose chart type" className="inline-flex w-fit rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              aria-pressed={displayMode === "bars"}
              onClick={() => setDisplayMode("bars")}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${displayMode === "bars" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              <BarChart3 size={14} /> Bar diagram
            </button>
            <button
              type="button"
              aria-pressed={displayMode === "pie"}
              onClick={() => setDisplayMode("pie")}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${displayMode === "pie" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              <PieChart size={14} /> Pie chart
            </button>
          </div>
          {displayMode === "pie" && (
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Measure
              <select
                aria-label="Select measure for pie charts"
                value={selectedMetricId}
                onChange={(event) => setSelectedMetricId(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold normal-case tracking-normal text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                {METRICS.map((metric) => <option key={metric.id} value={metric.id}>{metric.label}</option>)}
              </select>
            </label>
          )}
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">{error}</p>}
      {uncostedQuantity > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
          Estimated gross profit is incomplete: some sold units have no historical or fallback cost recorded. Missing-cost quantities are shown in the detailed product records.
        </p>
      )}

      {displayMode === "bars" ? (
        <>
          <div className="grid gap-3 xl:grid-cols-3">
            {METRICS.map((metric) => (
              <HorizontalBars
                key={`product-${metric.id}`}
                title="Top products"
                subtitle="Across the selected date range."
                rows={charts.products}
                metric={metric}
              />
            ))}
          </div>
          <div className="grid gap-3 xl:grid-cols-3">
            {METRICS.map((metric) => (
              <HorizontalBars
                key={`location-${metric.id}`}
                title="Top provinces & districts"
                subtitle="Customer delivery address captured on the order."
                rows={charts.locations}
                metric={metric}
              />
            ))}
          </div>
          <div className="grid gap-3 xl:grid-cols-3">
            {METRICS.map((metric) => (
              <HorizontalBars
                key={`distributor-${metric.id}`}
                title="Distributor comparison"
                subtitle={selectedProduct ? `Performance for ${selectedProduct.name}.` : "All products combined; choose one product to compare its distributors."}
                rows={charts.distributors}
                metric={metric}
                emptyLabel={selectedProduct ? "No attributed distributor sales for this product in this range." : "No distributor-attributed sales in this period."}
              />
            ))}
          </div>
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
      <p className="rounded-xl bg-slate-100 px-4 py-3 text-[11px] leading-relaxed text-slate-600">
        Gross profit = item revenue minus recorded item COGS and completed refunds; delivery and operating expenses are excluded. Returns are grouped by refund completion date. Distributor comparisons include direct distributor orders and orders assigned to that distributor. Distributor revenue is shown here for Admin only.
      </p>
    </section>
  );
};

export default ProductPerformanceCharts;
