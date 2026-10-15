/* eslint-disable react/prop-types */
import { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../../App";
import { NcmToolField, NcmToolResult } from "./NcmToolShared";

const NcmReferenceTools = ({ token }) => {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [rate, setRate] = useState({ creation: "", destination: "", type: "Door2Door" });

  const fetchResult = async (key, url, params) => {
    setLoading(key);
    try {
      const response = await axios.get(`${backendUrl}${url}`, { headers: { token }, params });
      if (!response.data?.success) throw new Error(response.data?.message || "NCM request failed.");
      setResult({ title: key, value: response.data.data });
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "NCM request failed.");
    } finally {
      setLoading("");
    }
  };

  const fetchRate = (event) => {
    event.preventDefault();
    fetchResult("Shipping rate", "/api/delivery/admin/ncm/shipping-rate", rate);
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Branches and staff</h2>
        <p className="mt-1 text-xs text-slate-500">Read-only information returned by the documented NCM vendor API.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => fetchResult("NCM branches", "/api/delivery/admin/ncm/branches")} disabled={!!loading} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">All branches</button>
          <button type="button" onClick={() => fetchResult("Assigned branches", "/api/delivery/admin/ncm/assigned-branches")} disabled={!!loading} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Assigned branches</button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); fetchResult("NCM staff", "/api/delivery/admin/ncm/staff", { q: staffSearch, page: 1, page_size: 20 }); }} className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1"><NcmToolField label="Search staff by name" value={staffSearch} onChange={(event) => setStaffSearch(event.target.value)} /></div>
          <button type="submit" disabled={!!loading} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Search staff</button>
        </form>
      </section>

      <form onSubmit={fetchRate} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Delivery rate lookup</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <NcmToolField label="Origin branch name" required value={rate.creation} onChange={(event) => setRate((current) => ({ ...current, creation: event.target.value }))} />
          <NcmToolField label="Destination branch name" required value={rate.destination} onChange={(event) => setRate((current) => ({ ...current, destination: event.target.value }))} />
          <label className="block text-xs font-semibold text-slate-600">Delivery type
            <select value={rate.type} onChange={(event) => setRate((current) => ({ ...current, type: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              {["Door2Door", "Branch2Door", "Door2Branch", "Branch2Branch"].map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
        </div>
        <button type="submit" disabled={!!loading} className="mt-3 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">{loading === "Shipping rate" ? "Fetching…" : "Fetch rate"}</button>
      </form>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">NCM vendor customers</h2>
        <p className="mt-1 text-xs text-slate-500">Customer records are fetched only when requested. NCM provides paginated results.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => fetchResult("NCM customers", "/api/delivery/admin/ncm/customers", { page: 1, page_size: 20 })} disabled={!!loading} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Fetch first 20</button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); fetchResult("NCM customer detail", `/api/delivery/admin/ncm/customers/${encodeURIComponent(customerId)}`); }} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1"><NcmToolField label="NCM customer ID" value={customerId} onChange={(event) => setCustomerId(event.target.value)} required /></div>
          <button type="submit" disabled={!!loading || !customerId} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Fetch detail</button>
        </form>
        <form onSubmit={(event) => { event.preventDefault(); fetchResult("NCM customer ratings", "/api/delivery/admin/ncm/ratings", { phone: customerPhone }); }} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1"><NcmToolField label="Customer phone" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} required /></div>
          <button type="submit" disabled={!!loading || !customerPhone} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Fetch ratings</button>
        </form>
      </section>

      {result && <NcmToolResult title={result.title} value={result.value} />}
    </div>
  );
};

export default NcmReferenceTools;
