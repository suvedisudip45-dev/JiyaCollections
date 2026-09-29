/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { Search } from "lucide-react";
import Pagination from "../components/Pagination";
import { backendUrl } from "../App";
import { usePermissions } from "../auth/PermissionsContext";

const AccessPermissions = ({ token }) => {
  const { can } = usePermissions();
  const [permissions, setPermissions] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(query.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let current = true;
    const fetchPermissions = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await axios.get(`${backendUrl}/api/admin/access/permissions`, {
          params: { search, page, limit: 25 },
          headers: { token },
        });
        if (current && response.data.success) {
          setPermissions(response.data.permissions || []);
          setPagination(response.data.pagination || null);
        }
      } catch (requestError) {
        if (current) setError(requestError.response?.data?.message || "Could not load permissions.");
      } finally {
        if (current) setLoading(false);
      }
    };
    if (token && can("access:permissions_read")) fetchPermissions();
    return () => { current = false; };
  }, [token, can, search, page]);

  if (!can("access:permissions_read")) return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">You do not have permission to view the permission catalog.</div>;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      <div className="border-b border-slate-200 pb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Access control</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">Permission catalog</h1>
        <p className="mt-1 text-sm text-slate-500">System-defined permissions available to Admin portal roles.</p>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-slate-500">{pagination?.total ?? 0} permissions · read-only</span>
          <label className="relative block w-full sm:max-w-sm"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search code or description" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" /></label>
        </div>
        {error && <div role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 font-semibold">Domain</th><th className="px-4 py-3 font-semibold">Permission</th><th className="px-4 py-3 font-semibold">Description</th><th className="px-4 py-3 text-right font-semibold">Admin roles</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan="4" className="px-4 py-12 text-center text-slate-500">Loading permissions...</td></tr>}
              {!loading && !error && permissions.length === 0 && <tr><td colSpan="4" className="px-4 py-14 text-center text-slate-500">No permissions found.</td></tr>}
              {!loading && permissions.map((permission) => <tr key={permission.id} className="hover:bg-slate-50/70"><td className="px-4 py-3.5"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{permission.group}</span></td><td className="px-4 py-3.5 font-mono text-xs font-semibold text-slate-800">{permission.code}</td><td className="px-4 py-3.5 text-slate-600">{permission.description || "No description"}</td><td className="px-4 py-3.5 text-right text-slate-600">{permission.adminRoleCount}</td></tr>)}
            </tbody>
          </table>
        </div>
        {pagination && <div className="border-t border-slate-100 px-4"><Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} limit={pagination.limit} onPageChange={setPage} loading={loading} /></div>}
      </section>
    </div>
  );
};

export default AccessPermissions;