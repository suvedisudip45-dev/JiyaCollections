/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../../App";
import { NcmToolField } from "./NcmToolShared";
import NcmTicketDetails from "./NcmTicketDetails";

const unwrapTicketDetail = (payload) => {
  let current = payload;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if (current.ticket && typeof current.ticket === "object") {
      return {
        ...current.ticket,
        responses: Array.isArray(current.responses)
          ? current.responses
          : current.ticket.responses || [],
      };
    }
    if (current.data && typeof current.data === "object") {
      current = current.data;
      continue;
    }
    return {
      ...current,
      responses: Array.isArray(current.responses) ? current.responses : [],
    };
  }
  return null;
};

const NcmSupportTools = ({ token }) => {
  const [ticketType, setTicketType] = useState("General");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketBranch, setTicketBranch] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [reply, setReply] = useState("");
  const [ticketDetails, setTicketDetails] = useState(null);
  const [submittedReply, setSubmittedReply] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ticketFilter, setTicketFilter] = useState("active");
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketList, setTicketList] = useState([]);
  const [ticketPagination, setTicketPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [ticketListLoading, setTicketListLoading] = useState(false);
  const [ticketListError, setTicketListError] = useState("");
  const [assignedBranches, setAssignedBranches] = useState([]);

  const refreshTicketList = useCallback(async ({
    status = ticketFilter,
    page = ticketPage,
    search = ticketSearch,
  } = {}) => {
    setTicketListLoading(true);
    setTicketListError("");
    try {
      const response = await axios.get(`${backendUrl}/api/delivery/admin/ncm/tickets`, {
        headers: { token },
        params: {
          status,
          search: search.trim() || undefined,
          page,
          limit: 10,
        },
      });
      setTicketList(response.data?.tickets || []);
      setTicketPagination(response.data?.pagination || { page: 1, pages: 1, total: 0 });
    } catch (error) {
      const message = error.response?.data?.message || "Unable to load saved NCM tickets.";
      setTicketListError(message);
      setTicketList([]);
    } finally {
      setTicketListLoading(false);
    }
  }, [ticketFilter, ticketPage, ticketSearch, token]);

  useEffect(() => {
    const timeout = setTimeout(refreshTicketList, ticketSearch ? 250 : 0);
    return () => clearTimeout(timeout);
  }, [refreshTicketList, ticketSearch]);

  useEffect(() => {
    if (ticketType !== "Pickup") return undefined;
    const controller = new AbortController();
    axios.get(`${backendUrl}/api/delivery/admin/ncm/assigned-branches`, {
      headers: { token },
      signal: controller.signal,
    }).then((response) => {
      const value = response.data?.data;
      setAssignedBranches(Array.isArray(value) ? value : value?.results || value?.branches || []);
    }).catch((error) => {
      if (!axios.isCancel(error) && error.name !== "CanceledError") {
        toast.error(error.response?.data?.message || "Unable to load assigned NCM branches.");
      }
    });
    return () => controller.abort();
  }, [ticketType, token]);

  const execute = async (action) => {
    setLoading(true);
    try {
      const response = await action();
      if (!response.data?.success) throw new Error(response.data?.message || "NCM request failed.");
      return response.data.data;
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "NCM request failed.");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const createTicket = async (event) => {
    event.preventDefault();
    const value = await execute(() => axios.post(
      `${backendUrl}/api/delivery/admin/ncm/tickets`,
      { ticket_type: ticketType, message: ticketMessage, ...(ticketType === "Pickup" ? { branch: ticketBranch } : {}) },
      { headers: { token } },
    ));
    if (!value) return;
    setTicketMessage("");
    setTicketFilter("active");
    setTicketPage(1);
    await refreshTicketList({ status: "active", page: 1 });
    toast.success("NCM ticket created.");
  };

  const loadTicket = async (id = ticketId) => {
    const value = await execute(() => axios.get(
      `${backendUrl}/api/delivery/admin/ncm/tickets/${encodeURIComponent(id)}`,
      { headers: { token } },
    ));
    if (value) {
      setTicketDetails(unwrapTicketDetail(value));
      await refreshTicketList();
      return true;
    }
    return false;
  };

  const fetchTicket = () => {
    setSubmittedReply(null);
    return loadTicket();
  };

  const sendReply = async (event) => {
    event.preventDefault();
    const message = reply.trim();
    const value = await execute(() => axios.post(
      `${backendUrl}/api/delivery/admin/ncm/tickets/${encodeURIComponent(ticketId)}/response`,
      { message },
      { headers: { token } },
    ));
    if (!value) return;
    setReply("");
    setSubmittedReply({ message, date: new Date().toISOString() });
    toast.success("NCM ticket response sent.");
    await refreshTicketList();
    await loadTicket();
  };

  const closeTicket = async () => {
    if (!window.confirm("Close this ticket in NCM?")) return;
    const value = await execute(() => axios.post(
      `${backendUrl}/api/delivery/admin/ncm/tickets/${encodeURIComponent(ticketId)}/close`,
      {},
      { headers: { token } },
    ));
    if (value) {
      await refreshTicketList();
      await loadTicket();
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={createTicket} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Create an NCM support ticket</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-600">Type
            <select value={ticketType} onChange={(event) => setTicketType(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              {["General", "Order Processing", "Return", "Pickup"].map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          {ticketType === "Pickup" && (
            <label className="block text-xs font-semibold text-slate-600">Assigned branch
              <select required value={ticketBranch} onChange={(event) => setTicketBranch(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">Choose an assigned branch</option>
                {assignedBranches.map((branch) => {
                  const id = branch.pk ?? branch.id;
                  const name = branch.name || branch.branch_name || branch.branch || branch.code || String(id);
                  return <option key={id} value={name}>{name}</option>;
                })}
              </select>
            </label>
          )}
        </div>
        <label className="mt-3 block text-xs font-semibold text-slate-600">Message (up to 500 characters)
          <textarea required maxLength={500} value={ticketMessage} onChange={(event) => setTicketMessage(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-indigo-400" />
        </label>
        <button type="submit" disabled={loading} className="mt-3 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">Create ticket</button>
      </form>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Saved NCM tickets</h2>
            <p className="mt-1 text-xs text-slate-500">Loaded from this system’s database. Older tickets can be added by fetching their ID below.</p>
          </div>
          <button type="button" onClick={refreshTicketList} disabled={ticketListLoading} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">
            {ticketListLoading ? "Refreshing..." : "Refresh list"}
          </button>
        </header>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="inline-flex rounded-lg bg-slate-100 p-1" aria-label="Ticket status filter">
            {["active", "closed"].map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => {
                  setTicketFilter(filter);
                  setTicketPage(1);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize ${ticketFilter === filter ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                {filter}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={ticketSearch}
            onChange={(event) => {
              setTicketSearch(event.target.value);
              setTicketPage(1);
            }}
            placeholder="Search tickets"
            aria-label="Search saved tickets"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 sm:max-w-xs"
          />
        </div>
        {ticketListError && <p role="alert" className="m-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ticketListError}</p>}
        {ticketListLoading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Loading saved tickets…</p>
        ) : ticketList.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            {ticketListError ? "Saved tickets could not be loaded." : `No ${ticketFilter} tickets have been saved yet.`}
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {ticketList.map((ticket) => (
              <article key={ticket.ncmTicketId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50/70">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">Ticket #{ticket.ncmTicketId}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ticket.status === "CLOSED" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                      {ticket.status === "CLOSED" ? "Closed" : ticket.status || "Active"}
                    </span>
                    <span className="text-xs text-slate-500">{ticket.ticketType}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-700">{ticket.message || "No message"}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {[ticket.vendorName, ticket.branch, ticket.addedOn ? `Created ${new Date(ticket.addedOn).toLocaleString()}` : null]
                      .filter(Boolean)
                      .join(" · ") || "Ticket details not yet synced"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const id = String(ticket.ncmTicketId);
                    setTicketId(id);
                    setSubmittedReply(null);
                    loadTicket(id);
                  }}
                  disabled={loading}
                  className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
                >
                  View details
                </button>
              </article>
            ))}
          </div>
        )}
        {ticketPagination.pages > 1 && (
          <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <span>{ticketPagination.total} saved tickets · Page {ticketPagination.page} of {ticketPagination.pages}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setTicketPage((page) => Math.max(1, page - 1))} disabled={ticketPage <= 1 || ticketListLoading} className="rounded-md border border-slate-200 px-2.5 py-1.5 disabled:opacity-40">Previous</button>
              <button type="button" onClick={() => setTicketPage((page) => Math.min(ticketPagination.pages, page + 1))} disabled={ticketPage >= ticketPagination.pages || ticketListLoading} className="rounded-md border border-slate-200 px-2.5 py-1.5 disabled:opacity-40">Next</button>
            </div>
          </footer>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Manage an NCM ticket</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1"><NcmToolField label="Ticket ID" type="number" min="1" value={ticketId} onChange={(event) => {
            setTicketId(event.target.value);
            setTicketDetails(null);
            setSubmittedReply(null);
          }} /></div>
          <button type="button" onClick={fetchTicket} disabled={loading || !ticketId} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Fetch ticket</button>
          <button type="button" onClick={closeTicket} disabled={loading || !ticketId} className="rounded-md border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700">Close ticket</button>
        </div>
        <form onSubmit={sendReply} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1"><NcmToolField label="Reply" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={2000} required /></div>
          <button type="submit" disabled={loading || !ticketId} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Send reply</button>
        </form>
      </section>

      {ticketDetails && <NcmTicketDetails ticket={ticketDetails} submittedReply={submittedReply} />}
    </div>
  );
};

export default NcmSupportTools;
