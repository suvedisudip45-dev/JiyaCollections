/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { RefreshCw, Search, Truck, X } from "lucide-react";
import { toast } from "react-toastify";
import { backendUrl } from "../App";
import Pagination from "../components/Pagination";
import DeliveryRecordDetails from "../components/DeliveryRecordDetails";

const PAGE_SIZE = 25;
const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400";

const formatDate = (value) => {
  if (!value) return "—";
  const date = typeof value === "number" || /^\d+$/.test(String(value))
    ? new Date(Number(value))
    : new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-NP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kathmandu" });
};

const statusClass = (status) => {
  const value = String(status || "").toLowerCase();
  if (value.includes("deliver")) return "bg-emerald-50 text-emerald-700";
  if (value.includes("return") || value.includes("reject") || value.includes("cancel")) return "bg-rose-50 text-rose-700";
  if (value.includes("fail") || value.includes("unknown")) return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
};

const DeliveryRecords = ({ token, mode }) => {
  const isNcm = mode === "ncm";
  const endpoint = isNcm ? "/api/delivery/admin/ncm/deliveries" : "/api/delivery/admin/self-deliveries";
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [distributors, setDistributors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    range: "month",
    startDate: "",
    endDate: "",
    status: "all",
    distributorId: "",
  });
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementForm, setSettlementForm] = useState({
    bankName: "",
    bankAccountName: "",
    bankAccountNumber: "",
  });
  const [settlementBusy, setSettlementBusy] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (isNcm || !token) return undefined;
    const controller = new AbortController();
    axios.get(`${backendUrl}/api/delivery/admin/self-deliveries/distributors`, {
      headers: { token },
      params: { limit: 100 },
      signal: controller.signal,
    }).then((response) => {
      setDistributors(response.data?.distributors || []);
    }).catch((error) => {
      if (!axios.isCancel(error) && error.name !== "CanceledError") {
        toast.error(error.response?.data?.message || "Unable to load distributors.");
      }
    });
    return () => controller.abort();
  }, [isNcm, token]);

  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    setLoading(true);
    axios.get(`${backendUrl}${endpoint}`, {
      headers: { token },
      params: {
        ...filters,
        ...(filters.range === "custom" ? {} : { startDate: undefined, endDate: undefined }),
        search,
        page,
        limit: PAGE_SIZE,
      },
      signal: controller.signal,
    }).then((response) => {
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load delivery records.");
      setRows(response.data.deliveries || []);
      setPagination(response.data.pagination || null);
    }).catch((error) => {
      if (!axios.isCancel(error) && error.name !== "CanceledError") {
        toast.error(error.response?.data?.message || error.message || "Unable to load delivery records.");
        setRows([]);
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [token, endpoint, filters, search, page, refreshKey]);

  const title = isNcm ? "NCM deliveries" : "Distributor self-deliveries";
  const tableDescription = isNcm
    ? "NCM-linked deliveries recorded by this store."
    : "Customer orders explicitly assigned for distributor self-delivery.";
  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const submitSettlementRequest = async (event) => {
    event.preventDefault();
    setSettlementBusy(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/delivery/admin/settlements/request`,
        settlementForm,
        { headers: { token } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Settlement request failed.");
      toast.success(`NCM COD settlement request ${response.data.ticketId ? `#${response.data.ticketId} ` : ""}submitted.`);
      setSettlementOpen(false);
      setSettlementForm({ bankName: "", bankAccountName: "", bankAccountNumber: "" });
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Settlement request failed.");
    } finally {
      setSettlementBusy(false);
    }
  };

  return (
    <section className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Truck className="h-4 w-4" />
            Logistics
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{tableDescription}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isNcm ? (
            <>
              <Link to="/ncm-tools" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                NCM tools
              </Link>
              <button type="button" onClick={() => setSettlementOpen(true)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                Request COD settlement
              </button>
            </>
          ) : (
            <Link to="/ncm-deliveries" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              View NCM deliveries
            </Link>
          )}
          <button type="button" onClick={() => setRefreshKey((current) => current + 1)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      {isNcm && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          The supplied NCM API docs do not define a carrier-wide date-range order or payable/receivable ledger endpoint. This list covers locally linked orders; use order details to compare known NCM IDs.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-semibold text-slate-600">
          Date range
          <select value={filters.range} onChange={(event) => updateFilter("range", event.target.value)} className={`${inputClass} mt-1`}>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="year">This year</option>
            <option value="all">All time</option>
            <option value="custom">Custom dates</option>
          </select>
        </label>
        {filters.range === "custom" && (
          <>
            <label className="text-xs font-semibold text-slate-600">
              From
              <input type="date" value={filters.startDate} onChange={(event) => updateFilter("startDate", event.target.value)} className={`${inputClass} mt-1`} />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Through
              <input type="date" value={filters.endDate} onChange={(event) => updateFilter("endDate", event.target.value)} className={`${inputClass} mt-1`} />
            </label>
          </>
        )}
        <label className="text-xs font-semibold text-slate-600">
          Status
          <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)} className={`${inputClass} mt-1`}>
            <option value="all">All statuses</option>
            {isNcm && <option value="needs_reconciliation">Needs reconciliation</option>}
            <option value="incomplete">Incomplete</option>
            <option value="completed">Delivered</option>
            <option value="returned">Returned</option>
          </select>
        </label>
        {!isNcm && (
          <label className="text-xs font-semibold text-slate-600">
            Distributor
            <select value={filters.distributorId} onChange={(event) => updateFilter("distributorId", event.target.value)} className={`${inputClass} mt-1`}>
              <option value="">All distributors</option>
              {distributors.map((distributor) => (
                <option key={distributor.id} value={distributor.id}>
                  {distributor.name}{distributor.district ? ` · ${distributor.district}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2 lg:col-span-1">
          Search
          <span className="relative mt-1 block">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Order or delivery ID" className={`${inputClass} pl-9`} />
          </span>
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Delivery records</h2>
          <span className="text-xs text-slate-500">{pagination?.total ?? 0} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{isNcm ? "NCM record date" : "Order date"}</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Delivered</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Order ID</th>
                {isNcm ? <th className="px-4 py-3">NCM ID</th> : <th className="px-4 py-3">Distributor / rating</th>}
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-500">Loading delivery records…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-500">No matching delivery records.</td></tr>
              )}
              {!loading && rows.map((row) => (
                <tr key={isNcm ? row.id : row.assignmentId} className="hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{formatDate(isNcm ? row.createdAt : row.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{row.customerName || "Customer"}</div>
                    <div className="text-xs text-slate-400">Placed by customer</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{formatDate(row.deliveredAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(isNcm && row.ncmReconciliationRequired ? "unknown" : isNcm ? row.state : row.status)}`}>
                      {isNcm && row.ncmReconciliationRequired ? "Needs reconciliation" : isNcm ? row.ncmStatus || row.state : row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.orderId}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {isNcm ? row.ncmOrderId || "Not booked" : (
                      <span>
                        {row.distributorName}
                        <span className="ml-1 block text-[11px] text-slate-400">
                          {[row.distributorDistrict, row.distributorProvince].filter(Boolean).join(", ") || "Distributor location not set"}
                        </span>
                        <span className="ml-1 text-amber-600">
                          {row.orderRating ? `★ ${row.orderRating}` : `★ ${Number(row.distributorRating || 0).toFixed(1)}`}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="max-w-56 truncate px-4 py-3 text-xs text-slate-600" title={row.deliveryLocation || row.distributorDistrict || ""}>
                    {row.deliveryLocation || "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => setSelected({ id: isNcm ? row.id : row.assignmentId, row })} className="rounded-md px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
                      View details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-4">
          <Pagination
            page={pagination?.page || page}
            totalPages={pagination?.pages || 1}
            total={pagination?.total || 0}
            limit={PAGE_SIZE}
            onPageChange={setPage}
            loading={loading}
          />
        </div>
      </div>

      {selected && (
        <DeliveryRecordDetails
          token={token}
          mode={mode}
          recordId={selected.id}
          row={selected.row}
          onClose={() => {
            setSelected(null);
            if (isNcm) setRefreshKey((current) => current + 1);
          }}
        />
      )}

      {settlementOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="settlement-title">
          <form onSubmit={submitSettlementRequest} className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 id="settlement-title" className="font-semibold text-slate-900">Request NCM COD settlement</h2>
                <p className="mt-1 text-xs text-slate-500">Submits the documented COD transfer ticket request to NCM.</p>
              </div>
              <button type="button" onClick={() => setSettlementOpen(false)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            {[
              ["bankName", "Bank name"],
              ["bankAccountName", "Account holder"],
              ["bankAccountNumber", "Account number"],
            ].map(([key, label]) => (
              <label key={key} className="block text-xs font-semibold text-slate-600">
                {label}
                <input required value={settlementForm[key]} onChange={(event) => setSettlementForm((current) => ({ ...current, [key]: event.target.value }))} className={`${inputClass} mt-1`} />
              </label>
            ))}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSettlementOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">Cancel</button>
              <button type="submit" disabled={settlementBusy} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                {settlementBusy ? "Submitting…" : "Submit request"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};

export default DeliveryRecords;
