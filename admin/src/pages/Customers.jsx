/* eslint-disable react/prop-types */
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";
import Pagination from "../components/Pagination";

const formatDate = (value) => (value ? new Date(Number(value)).toLocaleDateString() : "—");

const Customers = ({ token }) => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const requestId = useRef(0);
  const pageLimit = 10;

  const fetchCustomers = async (query, requestedPage) => {
    const normalizedQuery = String(query || "").trim();
    if (normalizedQuery.length < 2) {
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
        `${backendUrl}/api/customer/admin/search?search=${encodeURIComponent(normalizedQuery)}&page=${requestedPage}&limit=${pageLimit}`,
        { headers: { token } },
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
    setPage(1);
    fetchCustomers(search, 1);
  };

  const changePage = (nextPage) => {
    setPage(nextPage);
    fetchCustomers(search, nextPage);
  };

  const clearSearch = () => {
    requestId.current += 1;
    setSearch("");
    setCustomers([]);
    setPagination(null);
    setHasSearched(false);
    setPage(1);
    setLoading(false);
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">Customer records</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">Search for a customer to review their account and order history.</p>
        </div>
        <form onSubmit={submitSearch} className="flex w-full gap-2 sm:max-w-xl">
          <label className="sr-only" htmlFor="customer-search">Search customers</label>
          <input
            id="customer-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email, contact number or customer code"
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <button type="submit" disabled={loading} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
            {loading ? "Searching…" : "Search"}
          </button>
          {hasSearched && (
            <button type="button" onClick={clearSearch} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              Clear
            </button>
          )}
        </form>
      </header>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500">Searching customer records…</div>
        ) : !hasSearched ? (
          <div className="p-12 text-center">
            <p className="text-sm font-semibold text-slate-700">Search to view customer records</p>
            <p className="mt-1 text-xs text-slate-500">Customer information is not loaded until you search.</p>
          </div>
        ) : customers.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-semibold text-slate-700">No customers found</p>
            <p className="mt-1 text-xs text-slate-500">Try another name, email, phone number, or customer code.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Customer</th>
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
