/* eslint-disable react/prop-types */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";
import Pagination from "../components/Pagination";

const formatDate = (value) => {
  if (!value) return "—";
  const date = typeof value === "number" || /^\d+$/.test(String(value)) ? new Date(Number(value)) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
};
const initialFilters = { status: "", province: "", district: "", period: "all", date: "", from: "", to: "" };
const filterPeriodLabels = {
  all: "All time",
  week: "This week",
  month: "This month",
  year: "This year",
  date: "Specific date",
  range: "Date range",
};

const Customers = ({ token }) => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [search, setSearch] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [pagination, setPagination] = useState(null);
  const requestId = useRef(0);
  const analyticsRequestId = useRef(0);
  const pageLimit = 10;

  const fetchAnalytics = useCallback(async (selectedFilters = initialFilters) => {
    const currentRequest = ++analyticsRequestId.current;
    setAnalyticsLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/customer/admin/analytics`, {
        headers: { token },
        params: selectedFilters,
      });
      if (currentRequest !== analyticsRequestId.current) return;
      if (!response.data?.success) {
        toast.error(response.data?.message || "Unable to load customer analytics.");
        return;
      }
      setAnalytics(response.data.metrics || null);
    } catch (error) {
      if (currentRequest === analyticsRequestId.current) {
        console.error(error);
        toast.error(error.response?.data?.message || "Unable to load customer analytics.");
      }
    } finally {
      if (currentRequest === analyticsRequestId.current) setAnalyticsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAnalytics(initialFilters);
  }, [fetchAnalytics]);

  const fetchCustomers = async (query, requestedPage, selectedFilters) => {
    const normalizedQuery = String(query || "").trim();
    if (normalizedQuery && normalizedQuery.length < 2) {
      toast.info("Enter at least two characters to search for a customer.");
      return;
    }
    const currentRequest = ++requestId.current;
    setLoading(true);
    setHasSearched(true);
    setCustomers([]);
    setPagination(null);
    try {
      const response = await axios.get(
        `${backendUrl}/api/customer/admin/search`,
        {
          headers: { token },
          params: { ...selectedFilters, search: normalizedQuery, page: requestedPage, limit: pageLimit },
        },
      );
      if (currentRequest !== requestId.current) return;
      if (!response.data?.success) {
        toast.error(response.data?.message || "Unable to search customers.");
        return;
      }
      setCustomers(response.data.customers || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      if (currentRequest === requestId.current) {
        console.error(error);
        toast.error(error.response?.data?.message || "Unable to search customers.");
        setCustomers([]);
        setPagination(null);
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  const submitSearch = (event) => {
    event.preventDefault();
    const hasFilter = filters.status || filters.province || filters.district || filters.period !== "all";
    if (!search.trim() && !hasFilter) {
      toast.info("Search by name or choose at least one customer filter.");
      return;
    }
    setAppliedFilters(filters);
    fetchCustomers(search, 1, filters);
    fetchAnalytics(filters);
  };

  const changePage = (nextPage) => {
    fetchCustomers(search, nextPage, appliedFilters);
  };

  const clearSearch = () => {
    requestId.current += 1;
    setSearch("");
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
    setCustomers([]);
    setPagination(null);
    setHasSearched(false);
    setLoading(false);
    fetchAnalytics(initialFilters);
  };

  const updateFilter = (key, value) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "province" ? { district: "" } : {}),
    }));
  };

  const provinceOptions = analytics?.provinceBreakdown || [];
  const districtOptions = (analytics?.districtBreakdown || []).filter(
    (item) => !filters.province || item.province === filters.province,
  );
  const metrics = analytics || {};
  const newCustomers = metrics.newCustomers || {};
  const number = (value) => Number(value || 0).toLocaleString();
  const money = (value) => `${currency}${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const renderSalesTable = (title, rows, locationLabel) => (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5">
        <h3 className="font-bold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs text-slate-500">All-time, non-cancelled purchase transactions; multi-package checkouts count once.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{locationLabel}</th>
              <th className="px-4 py-3 text-right">Customers</th>
              <th className="px-4 py-3 text-right">Transactions</th>
              <th className="px-4 py-3 text-right">Sales</th>
              <th className="px-4 py-3 text-right">COGS</th>
              <th className="px-4 py-3 text-right">Allocated fixed overhead</th>
              <th className="px-4 py-3 text-right">NCM delivery</th>
              <th className="px-4 py-3 text-right">Approx. profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(rows || []).map((row) => (
              <tr key={locationLabel === "Province" ? row.province : `${row.province}-${row.district}`}>
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                  {locationLabel === "Province" ? row.province : <>{row.district}<span className="ml-1 text-xs font-normal text-slate-400">{row.province}</span></>}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-600">{number(row.customerCount)}</td>
                <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-600">{number(row.transactionCount)}</td>
                <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-800">{money(row.sales)}</td>
                <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-600">{money(row.cogs)}</td>
                <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-600">{money(row.productionOverhead)}</td>
                <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-600">
                  {money(row.ncmDeliveryCost)}
                  {row.ncmPackageCount > 0 && (
                    <span className="block text-[10px] text-slate-400">{number(row.ncmPackagesWithRecordedCost)}/{number(row.ncmPackageCount)} packages recorded</span>
                  )}
                </td>
                <td className={`px-4 py-3 text-right text-sm font-bold tabular-nums ${Number(row.estimatedProfit || 0) < 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {money(row.estimatedProfit)}
                </td>
              </tr>
            ))}
            {!rows?.length && (
              <tr><td colSpan="8" className="px-4 py-8 text-center text-sm text-slate-500">{analyticsLoading ? "Loading sales…" : "No sales recorded."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      <header className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">Customer records</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">Filter customer records, review account status, and track customer growth and repeat purchases.</p>
        </div>
        <form onSubmit={submitSearch} className="space-y-3">
          <div>
            <label className="sr-only" htmlFor="customer-search">Search customers</label>
            <input
              id="customer-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, email, contact number or customer code"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              Account status
              <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800">
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              Province
              <select value={filters.province} onChange={(event) => updateFilter("province", event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800">
                <option value="">All provinces</option>
                {provinceOptions.map((item) => <option key={item.province} value={item.province}>{item.province} ({number(item.total)})</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              District
              <select
                value={filters.district ? `${filters.province}::${filters.district}` : ""}
                onChange={(event) => {
                  const selectedDistrict = districtOptions.find((item) => `${item.province}::${item.district}` === event.target.value);
                  setFilters((current) => ({
                    ...current,
                    province: selectedDistrict?.province || current.province,
                    district: selectedDistrict?.district || "",
                  }));
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800"
              >
                <option value="">All districts</option>
                {districtOptions.map((item) => (
                  <option key={`${item.province}-${item.district}`} value={`${item.province}::${item.district}`}>
                    {item.district} — {item.province} ({number(item.total)})
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              New customer period
              <select value={filters.period} onChange={(event) => updateFilter("period", event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800">
                {Object.entries(filterPeriodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          {filters.period === "date" && (
            <label className="block max-w-xs space-y-1 text-xs font-semibold text-slate-600">
              Customer sign-up date
              <input type="date" required value={filters.date} onChange={(event) => updateFilter("date", event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800" />
            </label>
          )}
          {filters.period === "range" && (
            <div className="grid max-w-xl gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                From
                <input type="date" required value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-600">
                To
                <input type="date" required value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800" />
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={loading} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
              {loading ? "Loading records…" : "Apply filters"}
            </button>
            {(hasSearched || search || filters.status || filters.province || filters.district || filters.period !== "all") && (
              <button type="button" onClick={clearSearch} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                Clear filters
              </button>
            )}
          </div>
        </form>
      </header>

      <section aria-label="Customer overview" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Total customers", value: metrics.totalCustomers },
            { label: "Active customers", value: metrics.activeCustomers, color: "text-emerald-700" },
            { label: "Disabled customers", value: metrics.disabledCustomers, color: "text-red-700" },
            { label: "Customer retention ratio", value: `${Number(metrics.retentionRate || 0).toFixed(1)}%`, note: `Repeat-purchase rate: ${number(metrics.repeatCustomers)} of ${number(metrics.purchasingCustomers)} customers with orders bought more than once` },
          ].map((item) => (
            <article key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
              <p className={`mt-2 text-2xl font-black ${item.color || "text-slate-900"}`}>{analyticsLoading && !analytics ? "…" : typeof item.value === "number" ? number(item.value) : item.value}</p>
              {item.note && <p className="mt-1 text-xs text-slate-500">{item.note}</p>}
            </article>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900">New customers</h2>
                <p className="mt-1 text-xs text-slate-500">Based on customer account creation date.</p>
              </div>
              {analyticsLoading && <span className="text-xs text-slate-400">Updating…</span>}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                { label: "This week", value: newCustomers.weekly },
                { label: "This month", value: newCustomers.monthly },
                { label: "This year", value: newCustomers.yearly },
                { label: filterPeriodLabels[newCustomers.selectedPeriod] || "Selected period", value: newCustomers.selected },
              ].map((item) => (
                <div key={item.label} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-500">{item.label}</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{number(item.value)}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-bold text-slate-900">Customers by province</h2>
              <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                {(analytics?.provinceBreakdown || []).map((item) => (
                  <div key={item.province} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-600">{item.province}</span>
                    <span className="font-bold tabular-nums text-slate-900">{number(item.total)}</span>
                  </div>
                ))}
                {!provinceOptions.length && <p className="text-sm text-slate-500">{analyticsLoading ? "Loading…" : "No location data available."}</p>}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-bold text-slate-900">Customers by district</h2>
              <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                {(analytics?.districtBreakdown || []).map((item) => (
                  <div key={`${item.province}-${item.district}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-slate-600">{item.district} <span className="text-xs text-slate-400">· {item.province}</span></span>
                    <span className="font-bold tabular-nums text-slate-900">{number(item.total)}</span>
                  </div>
                ))}
                {!analytics?.districtBreakdown?.length && <p className="text-sm text-slate-500">{analyticsLoading ? "Loading…" : "No location data available."}</p>}
              </div>
            </div>
          </section>
        </div>
      </section>

      <section aria-label="Sales and approximate profit" className="space-y-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">Sales by customer location</h2>
          <p className="mt-1 text-xs text-slate-500">All-time, non-cancelled orders grouped by the delivery address saved with each purchase.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Sales", value: metrics.salesSummary?.sales },
            { label: "Estimated COGS", value: metrics.salesSummary?.cogs },
            { label: "Allocated fixed overhead", value: metrics.salesSummary?.productionOverhead },
            { label: "Recorded NCM delivery", value: metrics.salesSummary?.ncmDeliveryCost },
            { label: "Approximate profit", value: metrics.salesSummary?.estimatedProfit, color: "text-emerald-700" },
          ].map((item) => (
            <article key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
              <p className={`mt-2 text-2xl font-black ${item.color || "text-slate-900"}`}>{analyticsLoading && !analytics ? "…" : money(item.value)}</p>
            </article>
          ))}
        </div>
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
          Fixed overhead is calculated per product as total approved batch overhead (per-piece amount × good units produced) divided by that product&apos;s all-time non-cancelled units sold, then allocated to those sales. Profit also subtracts available COGS and recorded NCM delivery charges. Unrecorded NCM charges and local distributor delivery costs are not included; returns/refunds and other operating expenses are not deducted.
        </p>
        <div className="space-y-4">
          {renderSalesTable("Province sales", metrics.salesByProvince, "Province")}
          {renderSalesTable("District sales", metrics.salesByDistrict, "District / province")}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500">Searching customer records…</div>
        ) : !hasSearched ? (
          <div className="p-12 text-center">
            <p className="text-sm font-semibold text-slate-700">Apply a filter or search to view customer records</p>
            <p className="mt-1 text-xs text-slate-500">Individual customer information is not loaded until you choose a filter or search.</p>
          </div>
        ) : customers.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-semibold text-slate-700">No customers found</p>
            <p className="mt-1 text-xs text-slate-500">Try another name, email, phone number, or customer code.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Customer</th>
                    <th className="px-5 py-3">Province / district</th>
                    <th className="px-5 py-3">Joined</th>
                    <th className="px-5 py-3">Lifetime order value</th>
                    <th className="px-5 py-3">Orders</th>
                    <th className="px-5 py-3">Exchanges</th>
                    <th className="px-5 py-3">Most recent order</th>
                    <th className="px-5 py-3">Account</th>
                    <th className="px-5 py-3 text-right"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-4">
                        <p className="font-bold text-slate-900">{customer.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{customer.email || customer.phone || "No contact details"}</p>
                        {customer.email && customer.phone && <p className="mt-0.5 text-xs text-slate-500">{customer.phone}</p>}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-700">
                        <p>{customer.province || "Not provided"}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{customer.district || "Not provided"}</p>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-600">{formatDate(customer.createdAt)}</td>
                      <td className="px-5 py-4 text-sm font-bold text-slate-800">{currency}{Number(customer.totalSpend || 0).toLocaleString()}</td>
                      <td className="px-5 py-4 text-sm text-slate-700">{Number(customer.totalOrders || 0).toLocaleString()}</td>
                      <td className="px-5 py-4 text-sm text-slate-700">{Number(customer.exchangeCount || 0).toLocaleString()}</td>
                      <td className="px-5 py-4 text-sm text-slate-600">{formatDate(customer.latestOrderDate)}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${customer.isDisabled ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                          {customer.isDisabled ? "Disabled" : "Active"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => navigate(`/customers/${customer.id}`)}
                          className="whitespace-nowrap rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pagination && (
              <div className="border-t border-slate-100 px-5">
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  total={pagination.total}
                  limit={pagination.limit}
                  onPageChange={changePage}
                  loading={loading}
                />
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
};

export default Customers;
