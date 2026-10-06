/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Download, RefreshCw, Search, X } from "lucide-react";
import { toast } from "react-toastify";
import Pagination from "../components/Pagination";
import { backendUrl } from "../App";
import { getAuditHistoryCache, setAuditHistoryCache, clearAuditHistoryCache } from "../utils/auditHistoryCache";

const EMPTY_FILTERS = {
  search: "",
  actorId: "",
  entityType: "",
  action: "",
  status: "",
  startDate: "",
  endDate: "",
};

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};

const AuditHistory = ({ token }) => {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState(null);
  const params = useMemo(() => ({
    page,
    limit: 20,
    ...Object.fromEntries(Object.entries(appliedFilters).filter(([, value]) => value)),
  }), [page, appliedFilters]);
  const cacheKey = useMemo(() => JSON.stringify(params), [params]);

  useEffect(() => {
    let active = true;
    if (!token) return () => { active = false; };

    const cached = getAuditHistoryCache(cacheKey);
    if (cached) {
      setRows(cached.data || []);
      setPagination(cached.pagination || null);
      setLoading(false);
      return () => { active = false; };
    }

    setLoading(true);
    axios.get(`${backendUrl}/api/admin/access/audit-logs`, { params, headers: { token } })
      .then((response) => {
        if (!response.data?.success) throw new Error(response.data?.message || "Could not load audit history.");
        const result = { data: response.data.data || [], pagination: response.data.pagination || null };
        setAuditHistoryCache(cacheKey, result);
        if (active) {
          setRows(result.data);
          setPagination(result.pagination);
        }
      })
      .catch((error) => {
        if (active) toast.error(error.response?.data?.message || error.message || "Could not load audit history.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [token, params, cacheKey, refreshKey]);

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
    setRefreshKey(0);
  };

  const refresh = () => {
    clearAuditHistoryCache();
    setRefreshKey((value) => value + 1);
  };

  const exportLogs = async () => {
    try {
      const response = await axios.get(`${backendUrl}/api/admin/access/audit-logs/export`, {
        params: { ...appliedFilters, format: "csv" },
        headers: { token },
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "audit-history.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not export audit history.");
    }
  };

  return (
    <section className="audit-history space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f6d68]">Access & security</p>
          <h1 className="audit-history-heading mt-1 text-2xl font-bold text-[#171717]">Audit history</h1>
          <p className="mt-1 text-sm text-[#6f6d68]">Review recorded changes and security signals. Failed or blocked activity is not, by itself, confirmation of a breach.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={refresh} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[#dedbd3] bg-white px-3 py-2 text-sm font-semibold text-[#171717] disabled:opacity-50">
            <RefreshCw size={15} /> Refresh
          </button>
          <button type="button" onClick={exportLogs} className="inline-flex items-center gap-2 rounded-lg bg-[#171717] px-3 py-2 text-sm font-semibold text-white hover:bg-[#333]">
            <Download size={15} /> Export CSV
          </button>
        </div>
      </header>

      <form onSubmit={applyFilters} className="grid gap-3 rounded-xl border border-[#dedbd3] bg-[#f8f7f4] p-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-semibold text-[#55534f] sm:col-span-2">
          Search
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-[#dedbd3] bg-white px-3">
            <Search size={15} className="text-[#6f6d68]" />
            <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Action, record ID, or correlation ID" className="w-full border-0 bg-transparent py-2 text-sm outline-none" />
          </div>
        </label>
        <label className="text-xs font-semibold text-[#55534f]">
          Actor account ID
          <input value={filters.actorId} onChange={(event) => setFilters({ ...filters, actorId: event.target.value })} className="mt-1 w-full bg-white px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-[#55534f]">
          Entity type
          <input value={filters.entityType} onChange={(event) => setFilters({ ...filters, entityType: event.target.value })} placeholder="e.g. Product" className="mt-1 w-full bg-white px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-[#55534f]">
          Action
          <input value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} placeholder="e.g. UPDATED" className="mt-1 w-full bg-white px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-[#55534f]">
          Result
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="mt-1 w-full bg-white px-3 py-2 text-sm">
            <option value="">All results</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
            <option value="BLOCKED">Blocked</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-[#55534f]">
          From
          <input type="date" value={filters.startDate} onChange={(event) => setFilters({ ...filters, startDate: event.target.value })} className="mt-1 w-full bg-white px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-[#55534f]">
          To
          <input type="date" value={filters.endDate} onChange={(event) => setFilters({ ...filters, endDate: event.target.value })} className="mt-1 w-full bg-white px-3 py-2 text-sm" />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="rounded-lg bg-[#d85b3f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#bd4932]">Apply filters</button>
          <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setAppliedFilters(EMPTY_FILTERS); setPage(1); }} className="rounded-lg border border-[#dedbd3] bg-white px-4 py-2 text-sm font-semibold text-[#171717]">Clear</button>
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-[#dedbd3] bg-white">
        <div className="flex items-center justify-between border-b border-[#dedbd3] px-4 py-3">
          <h2 className="font-semibold text-[#171717]">Recorded events</h2>
          <span className="text-xs text-[#6f6d68]">{pagination?.total ?? 0} events</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-[#f8f7f4] text-xs uppercase tracking-wide text-[#6f6d68]">
              <tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Record</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Result</th></tr>
            </thead>
            <tbody className="divide-y divide-[#eceae5]">
              {loading && <tr><td colSpan="6" className="px-4 py-8 text-center text-[#6f6d68]">Loading audit events…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan="6" className="px-4 py-10 text-center text-[#6f6d68]">No events match these filters.</td></tr>}
              {!loading && rows.map((row) => (
                <tr key={row.id} className="hover:bg-[#fbfaf8]">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[#55534f]">{formatDate(row.createdAt)}</td>
                  <td className="max-w-48 truncate px-4 py-3 font-mono text-xs" title={row.actorId || (row.entityType === "SecurityEvent" ? "Unidentified" : "System")}>{row.actorId || (row.entityType === "SecurityEvent" ? "Unidentified" : "System")}<span className="ml-1 text-[#6f6d68]">{row.actorRole || ""}</span></td>
                  <td className="px-4 py-3 font-semibold">{row.action}</td>
                  <td className="px-4 py-3"><button type="button" onClick={() => setSelected(row)} className="text-left text-[#147d6d] hover:underline">{row.entityType} · {row.entityId || "—"}</button></td>
                  <td className="px-4 py-3 text-xs">{row.portalSource || "—"}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700" : row.status === "BLOCKED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4">
          <Pagination page={pagination?.page || page} totalPages={pagination?.totalPages || 0} total={pagination?.total || 0} limit={pagination?.limit || 20} loading={loading} onPageChange={setPage} />
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="audit-event-title" className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-[#dedbd3] px-5 py-4">
              <div><p className="text-xs text-[#6f6d68]">{formatDate(selected.createdAt)}</p><h2 id="audit-event-title" className="audit-history-heading text-lg font-bold">{selected.action}</h2></div>
              <button type="button" aria-label="Close event details" onClick={() => setSelected(null)} className="rounded-lg p-2 hover:bg-[#f8f7f4]"><X size={18} /></button>
            </header>
            <div className="grid gap-3 p-5 text-sm sm:grid-cols-2">
              <p><b>Actor:</b> {selected.actorId || "System"} ({selected.actorRole || "—"})</p>
              <p><b>Portal:</b> {selected.portalSource || "—"}</p>
              <p><b>Entity:</b> {selected.entityType} / {selected.entityId || "—"}</p>
              <p><b>Correlation:</b> {selected.correlationId || "—"}</p>
              <p><b>IP address:</b> {selected.ipAddress || "—"}</p>
              <p><b>User agent:</b> {selected.userAgent || "—"}</p>
              {selected.failureReason && <p className="sm:col-span-2"><b>Failure reason:</b> {selected.failureReason}</p>}
              <div><h3 className="mb-2 font-semibold">Before</h3><pre className="max-h-72 overflow-auto rounded-lg bg-[#f8f7f4] p-3 text-xs">{JSON.stringify(selected.beforeState ?? {}, null, 2)}</pre></div>
              <div><h3 className="mb-2 font-semibold">After</h3><pre className="max-h-72 overflow-auto rounded-lg bg-[#f8f7f4] p-3 text-xs">{JSON.stringify(selected.afterState ?? {}, null, 2)}</pre></div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};

export default AuditHistory;
