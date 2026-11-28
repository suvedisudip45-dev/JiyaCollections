/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Tag } from "lucide-react";
import { discountAnalyticsApi } from "../api/discountAnalytics";

const localDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const money = (value) => `Rs. ${Number(value || 0).toLocaleString("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "customers", label: "Customers" },
  { id: "orders", label: "Orders & discount details" },
];

const SummaryCard = ({ label, value, detail }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
    {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
  </div>
);

const BreakdownTable = ({ title, columns, rows, emptyMessage = "No discount activity for these filters." }) => (
  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    {title && <div className="border-b border-slate-100 px-4 py-3">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
    </div>}
    {rows.length ? (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>{columns.map((column) => <th key={column.key} className="px-4 py-2.5 font-bold">{column.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id || row.key || row.category || row.province || row.district || row.productId || row.customer?.id || row.distributorId || row.label}>
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-3 text-slate-700">
                    {column.render ? column.render(row) : row[column.key] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : <p className="px-4 py-6 text-xs text-slate-500">{emptyMessage}</p>}
  </section>
);

const Pagination = ({ page, pageCount, onChange }) => (
  <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
    <span>Page {page} of {Math.max(1, pageCount)}</span>
    <div className="flex gap-2">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-40">
        <ChevronLeft size={14} /> Previous
      </button>
      <button type="button" disabled={page >= pageCount} onClick={() => onChange(page + 1)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-40">
        Next <ChevronRight size={14} />
      </button>
    </div>
  </div>
);

const DiscountAnalytics = ({ token }) => {
  const [period, setPeriod] = useState("all");
  const [startDate, setStartDate] = useState(() => localDate(new Date(Date.now() - 29 * 86400000)));
  const [endDate, setEndDate] = useState(() => localDate(new Date()));
  const [category, setCategory] = useState("");
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [distributorId, setDistributorId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("overview");
  const [customerPage, setCustomerPage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const [filtersData, setFiltersData] = useState({ categories: [], distributors: [], provinces: [], districts: [] });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    discountAnalyticsApi.filters(token).then((response) => {
      if (active && response.data?.success) setFiltersData(response.data);
      else if (active) throw new Error(response.data?.message || "Unable to load discount filter options.");
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.message || requestError.message || "Unable to load discount filter options.");
    });
    return () => { active = false; };
  }, [token]);

  const query = useMemo(() => ({
    period,
    ...(period === "custom" ? { startDate, endDate } : {}),
    category,
    province,
    district,
    distributorId,
    customerId,
    search: search.trim(),
    customerPage: String(customerPage),
    orderPage: String(orderPage),
    limit: "25",
  }), [category, customerId, customerPage, district, distributorId, endDate, orderPage, period, province, search, startDate]);

  useEffect(() => {
    if (period === "custom" && (!startDate || !endDate)) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    discountAnalyticsApi.report(token, query).then((response) => {
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load discount analytics.");
      if (active) setReport(response.data);
    }).catch((requestError) => {
      if (active) {
        setReport(null);
        setError(requestError.response?.data?.message || requestError.message || "Unable to load discount analytics.");
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [period, query, token, startDate, endDate]);

  const filteredDistricts = filtersData.districts.filter((entry) => !province || entry.province === province);
  const clearCustomerFilter = () => {
    setCustomerId("");
    setSearch("");
  };
  const resetPages = () => {
    setCustomerPage(1);
    setOrderPage(1);
  };
  const applyCategory = (value) => {
    setCategory(value);
    resetPages();
  };
  const rangeLabel = report?.range?.startDate
    ? `${report.range.startDate} – ${report.range.endDate}`
    : `All recorded orders through ${report?.range?.endDate || ""}`;
  const breakdowns = report?.breakdowns;
  const activeFilters = [category, province, district, distributorId, customerId, search].filter(Boolean).length;

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-3 sm:p-5">
      <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-600">Sales controls</p>
            <h1 className="mt-1 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">Discount Analytics</h1>
            <p className="mt-1 max-w-3xl text-xs text-slate-500">Track customer savings by discount source, time, location, distributor, product, customer, and order.</p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
            {[
              ["today", "Today"], ["week", "This week"], ["month", "This month"],
              ["year", "This year"], ["all", "All time"], ["custom", "Custom"],
            ].map(([value, label]) => (
              <button key={value} type="button" aria-pressed={period === value} onClick={() => { setPeriod(value); resetPages(); }}
                className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${period === value ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {period === "custom" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
            <CalendarDays size={15} className="text-slate-400" />
            <label className="text-xs text-slate-500" htmlFor="discount-start-date">From</label>
            <input id="discount-start-date" type="date" value={startDate} max={endDate || undefined} onChange={(event) => { setStartDate(event.target.value); resetPages(); }} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs" />
            <label className="text-xs text-slate-500" htmlFor="discount-end-date">To</label>
            <input id="discount-end-date" type="date" value={endDate} min={startDate || undefined} onChange={(event) => { setEndDate(event.target.value); resetPages(); }} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs" />
            <span className="text-[11px] text-slate-400">Custom ranges are limited to 366 days.</span>
          </div>
        )}
        <div className="grid gap-2 border-t border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <select aria-label="Discount category" value={category} onChange={(event) => applyCategory(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
            <option value="">All discount categories</option>
            {filtersData.categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <select aria-label="Province" value={province} onChange={(event) => { setProvince(event.target.value); setDistrict(""); resetPages(); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
            <option value="">All provinces</option>
            {filtersData.provinces.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
          <select aria-label="District" value={district} onChange={(event) => { setDistrict(event.target.value); resetPages(); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
            <option value="">All districts</option>
            {filteredDistricts.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
          </select>
          <select aria-label="Distributor" value={distributorId} onChange={(event) => { setDistributorId(event.target.value); resetPages(); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
            <option value="">All distributors</option>
            {filtersData.distributors.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
          <input aria-label="Search customer" value={search} onChange={(event) => { setSearch(event.target.value); setCustomerId(""); resetPages(); }} placeholder="Search customer name, email, phone" className="rounded-lg border border-slate-200 px-3 py-2 text-xs lg:col-span-2" />
          {customerId && <button type="button" onClick={clearCustomerFilter} className="text-left text-xs font-semibold text-indigo-700 underline">Clear selected customer</button>}
        </div>
        <nav aria-label="Discount analytics sections" className="flex gap-5 overflow-x-auto border-t border-slate-100 px-5">
          {tabs.map((entry) => (
            <button key={entry.id} type="button" onClick={() => setTab(entry.id)} aria-current={tab === entry.id ? "page" : undefined}
              className={`shrink-0 border-b-2 px-1 py-3 text-xs font-bold ${tab === entry.id ? "border-indigo-600 text-slate-900" : "border-transparent text-slate-500"}`}>
              {entry.label}
            </button>
          ))}
          <span className="ml-auto self-center whitespace-nowrap text-[10px] text-slate-400">{rangeLabel}{activeFilters ? ` · ${activeFilters} filter(s)` : ""}</span>
        </nav>
      </header>

      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</div>}
      {loading && <div role="status" className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-800"><RefreshCw size={14} className="animate-spin" />Calculating discount totals and breakdowns…</div>}
      {!loading && report && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Total recorded discount" value={money(report.summary.totalDiscount)} detail="Across orders matching the selected filters" />
            <SummaryCard label="Orders with discount" value={report.summary.ordersWithDiscount.toLocaleString()} detail="Canceled orders are excluded" />
            <SummaryCard label="Average discount per order" value={money(report.summary.averageDiscountPerOrder)} detail={`${report.summary.discountComponents.toLocaleString()} classified discount entries`} />
            <SummaryCard label="Average per discount entry" value={money(report.summary.averageDiscountPerComponent)} detail="Item or order-level discount component" />
          </section>

          {tab === "overview" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <BreakdownTable title="Discount classification" rows={breakdowns.categories} columns={[
                { key: "label", label: "Discount type", render: (row) => <button type="button" onClick={() => applyCategory(row.category)} className="font-semibold text-indigo-700 hover:underline">{row.label}</button> },
                { key: "orderCount", label: "Orders" },
                { key: "componentCount", label: "Entries" },
                { key: "amount", label: "Discount given", render: (row) => <strong>{money(row.amount)}</strong> },
              ]} />
              <BreakdownTable title="Discount by province" rows={breakdowns.provinces} columns={[
                { key: "province", label: "Province", render: (row) => <button type="button" onClick={() => { setProvince(row.province === "Not recorded" ? "" : row.province); setDistrict(""); resetPages(); }} className="font-semibold text-indigo-700 hover:underline">{row.province}</button> },
                { key: "orderCount", label: "Orders" },
                { key: "amount", label: "Discount given", render: (row) => <strong>{money(row.amount)}</strong> },
              ]} />
              <BreakdownTable title="Discount by district" rows={breakdowns.districts} columns={[
                { key: "district", label: "District", render: (row) => <button type="button" onClick={() => { setProvince(row.province === "Not recorded" ? "" : row.province); setDistrict(row.district === "Not recorded" ? "" : row.district); resetPages(); }} className="font-semibold text-indigo-700 hover:underline">{row.district}</button> },
                { key: "province", label: "Province" },
                { key: "orderCount", label: "Orders" },
                { key: "amount", label: "Discount given", render: (row) => <strong>{money(row.amount)}</strong> },
              ]} />
              <BreakdownTable title="Discount by distributor" rows={breakdowns.distributors} columns={[
                { key: "distributorName", label: "Distributor", render: (row) => <button type="button" onClick={() => setDistributorId(row.distributorId)} disabled={!row.distributorId} className="font-semibold text-indigo-700 hover:underline disabled:text-slate-700 disabled:no-underline">{row.distributorName}</button> },
                { key: "orderCount", label: "Orders" },
                { key: "componentCount", label: "Entries" },
                { key: "amount", label: "Discount given", render: (row) => <strong>{money(row.amount)}</strong> },
              ]} />
              <BreakdownTable title="Distributor discount by category" rows={breakdowns.distributorCategories} columns={[
                { key: "distributorName", label: "Distributor", render: (row) => <button type="button" onClick={() => { setDistributorId(row.distributorId); applyCategory(row.category); }} disabled={!row.distributorId} className="font-semibold text-indigo-700 hover:underline disabled:text-slate-700 disabled:no-underline">{row.distributorName}</button> },
                { key: "label", label: "Discount category", render: (row) => <button type="button" onClick={() => applyCategory(row.category)} className="font-semibold text-indigo-700 hover:underline">{row.label}</button> },
                { key: "orderCount", label: "Orders" },
                { key: "amount", label: "Discount given", render: (row) => <strong>{money(row.amount)}</strong> },
              ]} />
              <BreakdownTable title="District discount by category" rows={breakdowns.districtCategories} columns={[
                { key: "district", label: "District", render: (row) => <button type="button" onClick={() => { setProvince(row.province === "Not recorded" ? "" : row.province); setDistrict(row.district === "Not recorded" ? "" : row.district); applyCategory(row.category); }} className="font-semibold text-indigo-700 hover:underline">{row.district}</button> },
                { key: "province", label: "Province" },
                { key: "label", label: "Discount category", render: (row) => <button type="button" onClick={() => applyCategory(row.category)} className="font-semibold text-indigo-700 hover:underline">{row.label}</button> },
                { key: "orderCount", label: "Orders" },
                { key: "amount", label: "Discount given", render: (row) => <strong>{money(row.amount)}</strong> },
              ]} />
              <div className="xl:col-span-2">
                <BreakdownTable title="Discount by product" rows={breakdowns.products} columns={[
                  { key: "productName", label: "Product" },
                  { key: "productCategory", label: "Product category" },
                  { key: "orderCount", label: "Orders" },
                  { key: "amount", label: "Discount given", render: (row) => <strong>{money(row.amount)}</strong> },
                ]} />
              </div>
            </div>
          )}

          {tab === "customers" && (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-bold text-slate-900">Customer discount history</h2>
                <p className="mt-1 text-xs text-slate-500">Select a customer to see their matching orders and discount categories.</p>
              </div>
              <BreakdownTable title="" rows={breakdowns.customers.rows} columns={[
                { key: "customer", label: "Customer", render: (row) => (
                  <button type="button" onClick={() => { setCustomerId(row.customer.id); setSearch(""); setOrderPage(1); setTab("orders"); }} className="text-left font-semibold text-indigo-700 hover:underline">
                    {row.customer.name}<span className="block font-normal text-slate-500">{row.customer.email || row.customer.phone || row.customer.id}</span>
                  </button>
                ) },
                { key: "orderCount", label: "Orders with discount" },
                { key: "componentCount", label: "Discount entries" },
                { key: "totalDiscount", label: "Total discount", render: (row) => <strong>{money(row.totalDiscount)}</strong> },
              ]} />
              <Pagination page={breakdowns.customers.page} pageCount={breakdowns.customers.pageCount} onChange={setCustomerPage} />
            </section>
          )}

          {tab === "orders" && (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Order-level discount details</h2>
                  <p className="mt-1 text-xs text-slate-500">Each order shows the customer, fulfillment distributor, location, and its individual discount sources.</p>
                </div>
                {customerId && <button type="button" onClick={clearCustomerFilter} className="text-xs font-semibold text-indigo-700 underline">Show all customers</button>}
              </div>
              <div className="divide-y divide-slate-100">
                {breakdowns.orders.rows.map((order) => (
                  <article key={order.orderId} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{order.orderReference}</p>
                        <p className="mt-0.5 break-all font-mono text-[10px] text-slate-400">Order ID: {order.orderId}</p>
                        <p className="mt-1 text-xs text-slate-600">{order.customer.name} · {order.customer.email || order.customer.phone || "No contact saved"}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{order.localDate} · {order.province} / {order.district} · {order.distributorName} · {order.status}</p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-slate-500">Order amount: {money(order.orderAmount)}</p>
                        <p className="mt-1 font-black text-emerald-700">Discount: {money(order.totalDiscount)}</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[600px] text-left text-[11px]">
                        <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>
                          <th className="px-3 py-2">Category</th><th className="px-3 py-2">Item / reward</th><th className="px-3 py-2">Variant / quantity</th><th className="px-3 py-2">Rate</th><th className="px-3 py-2 text-right">Amount</th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {order.discountBreakdown.map((entry, index) => (
                            <tr key={`${entry.category}-${entry.productName}-${index}`}>
                              <td className="px-3 py-2 font-semibold text-slate-700">{entry.label}</td>
                              <td className="px-3 py-2 text-slate-600">{entry.productName || entry.rewardName || (entry.cardCode ? `Card ${entry.cardCode}` : "Order-level discount")}{entry.productCategory ? <span className="block text-slate-400">{entry.productCategory}</span> : null}</td>
                              <td className="px-3 py-2 text-slate-600">{entry.quantity ? `${entry.size || "—"} ${entry.color ? `· ${entry.color}` : ""} · Qty ${entry.quantity}` : "—"}</td>
                              <td className="px-3 py-2 text-slate-600">{entry.percentage ? `${entry.percentage}%` : "—"}</td>
                              <td className="px-3 py-2 text-right font-bold text-emerald-700">{money(entry.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                ))}
                {!breakdowns.orders.rows.length && <p className="p-6 text-xs text-slate-500">No orders have recorded discounts for these filters.</p>}
              </div>
              <Pagination page={breakdowns.orders.page} pageCount={breakdowns.orders.pageCount} onChange={setOrderPage} />
            </section>
          )}

          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-900"><Tag size={14} /> Reporting notes</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-amber-900/80">
              {report.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </section>
        </>
      )}
    </div>
  );
};

export default DiscountAnalytics;
