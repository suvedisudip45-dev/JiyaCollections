/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { backendUrl } from "../App";
import { toast } from "react-toastify";
import Pagination from "../components/Pagination";

const pageLimit = 20;

const DistributorDirectory = ({ token }) => {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [distributors, setDistributors] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const loadDistributors = useCallback(async () => {
    if (!search) {
      setDistributors([]);
      setPagination(null);
      return;
    }
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/admin/distributors`, {
        params: { q: search, page, limit: pageLimit },
        headers: { token },
      });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to search distributors.");
      setDistributors(response.data.distributors || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to search distributors.");
      setDistributors([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [page, search, token]);

  useEffect(() => {
    loadDistributors();
  }, [loadDistributors]);

  const submitSearch = (event) => {
    event.preventDefault();
    setSearched(true);
    setPage(1);
    setSearch(query.trim());
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Operations · Partners</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">Distributor directory</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">Search for a distributor to view its profile, financial activity, stock and delivery history.</p>
      </header>

      <form onSubmit={submitSearch} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row">
        <label className="sr-only" htmlFor="distributor-search">Search distributors</label>
        <input
          id="distributor-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, phone, email, city or district"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        <button type="submit" className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-700">
          Search distributors
        </button>
      </form>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-bold text-slate-900">Search results</h2>
            <p className="mt-0.5 text-xs text-slate-500">{pagination ? `${pagination.total} distributors · sorted by latest profile activity` : "Results appear after a search."}</p>
          </div>
          {loading && <span className="text-xs font-medium text-slate-500">Searching…</span>}
        </div>
        {!searched ? (
          <p className="px-5 py-14 text-center text-sm text-slate-500">Search by distributor name, contact number, email, city or district.</p>
        ) : !loading && distributors.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-slate-500">{search ? "No distributors matched that search." : "Enter a search term to find a distributor."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-bold">Distributor</th>
                  <th className="px-5 py-3 font-bold">Location</th>
                  <th className="px-5 py-3 font-bold">Orders</th>
                  <th className="px-5 py-3 font-bold">Latest order assigned</th>
                  <th className="px-5 py-3 font-bold">Status</th>
                  <th className="px-5 py-3 text-right font-bold">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {distributors.map((distributor) => (
                  <tr key={distributor.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <p className="font-bold text-slate-900">{distributor.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{distributor.phone || "No phone"} · {distributor.account?.email || "No email"}</p>
                    </td>
                    <td className="px-5 py-4 text-slate-700">{[distributor.city, distributor.district, distributor.province].filter(Boolean).join(", ") || "Location not set"}</td>
                    <td className="px-5 py-4 font-semibold text-slate-700">{distributor._count?.assignments || 0}</td>
                    <td className="px-5 py-4 text-slate-600">{distributor.assignments?.[0]?.assignedAt ? new Date(distributor.assignments[0].assignedAt).toLocaleDateString() : "—"}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${distributor.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {distributor.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link to={`/distributors/${distributor.id}`} className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700">
                        View details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pagination && pagination.total > 0 && (
          <div className="border-t border-slate-100 px-5">
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={pagination.limit}
              onPageChange={setPage}
              loading={loading}
            />
          </div>
        )}
      </section>
    </main>
  );
};

export default DistributorDirectory;
