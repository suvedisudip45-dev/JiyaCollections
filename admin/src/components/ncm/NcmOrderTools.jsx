/* eslint-disable react/prop-types */
import { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../../App";
import { NcmToolField, NcmToolResult, parseIds } from "./NcmToolShared";

const NcmOrderTools = ({ token }) => {
  const [orderId, setOrderId] = useState("");
  const [bulkIds, setBulkIds] = useState("");
  const [comment, setComment] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState("");

  const run = async (key, action) => {
    setLoading(key);
    try {
      const value = await action();
      setResult({ title: key, value });
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "NCM request failed.");
    } finally {
      setLoading("");
    }
  };
  const getOrder = (suffix = "") => run("NCM order", async () => {
    if (!orderId) throw new Error("Enter an NCM order ID.");
    const response = await axios.get(`${backendUrl}/api/delivery/admin/ncm/orders/${encodeURIComponent(orderId)}${suffix}`, { headers: { token } });
    if (!response.data?.success) throw new Error(response.data?.message || "NCM request failed.");
    return response.data.data;
  });
  const fetchLabels = () => run("NCM labels", async () => {
    const ids = parseIds(bulkIds);
    if (!ids.length || ids.length > 50) throw new Error("Enter between 1 and 50 comma-separated numeric NCM IDs.");
    const response = await axios.post(`${backendUrl}/api/delivery/admin/ncm/orders/labels`, { ids }, { headers: { token } });
    if (!response.data?.success) throw new Error(response.data?.message || "NCM request failed.");
    return response.data.data;
  });
  const fetchBulkStatus = () => run("NCM bulk status", async () => {
    const orders = parseIds(bulkIds);
    if (!orders.length || orders.length > 50) throw new Error("Enter between 1 and 50 comma-separated numeric NCM IDs.");
    const response = await axios.post(`${backendUrl}/api/delivery/admin/ncm/orders/statuses`, { orders }, { headers: { token } });
    if (!response.data?.success) throw new Error(response.data?.message || "NCM request failed.");
    return response.data.data;
  });
  const submitComment = (event) => {
    event.preventDefault();
    run("NCM comment", async () => {
      if (!orderId) throw new Error("Enter an NCM order ID.");
      const response = await axios.post(`${backendUrl}/api/delivery/admin/ncm/orders/comments`, { orderid: Number(orderId), comments: comment }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "NCM request failed.");
      setComment("");
      return response.data.data;
    });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">NCM order lookup</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1"><NcmToolField label="NCM order ID" type="number" min="1" value={orderId} onChange={(event) => setOrderId(event.target.value)} /></div>
          <button type="button" onClick={() => getOrder()} disabled={!!loading} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Order detail</button>
          <button type="button" onClick={() => getOrder("/status")} disabled={!!loading} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Status history</button>
          <button type="button" onClick={() => getOrder("/comments")} disabled={!!loading} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Comments</button>
          <button type="button" onClick={() => getOrder("/label")} disabled={!!loading} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Label data</button>
        </div>
        {loading && <p className="mt-2 text-xs text-slate-500">Contacting NCM…</p>}
        <form onSubmit={submitComment} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <div className="min-w-56 flex-1"><NcmToolField label="Add comment to linked local order" value={comment} maxLength={2000} onChange={(event) => setComment(event.target.value)} required /></div>
          <button type="submit" disabled={!!loading || !orderId} className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">Send comment</button>
        </form>
        <p className="mt-2 text-[11px] text-slate-500">Comment changes require a matching local NCM delivery and are recorded locally. Returns/exchanges remain in the existing order workflow.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Bulk status / labels</h2>
        <p className="mt-1 text-xs text-slate-500">Maximum 50 NCM order IDs per request.</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1"><NcmToolField label="Comma-separated NCM IDs" value={bulkIds} onChange={(event) => setBulkIds(event.target.value)} placeholder="1234, 1235" /></div>
          <button type="button" onClick={fetchBulkStatus} disabled={!!loading} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Fetch statuses</button>
          <button type="button" onClick={fetchLabels} disabled={!!loading} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Fetch labels</button>
        </div>
      </section>

      {result && <NcmToolResult title={result.title} value={result.value} />}
    </div>
  );
};

export default NcmOrderTools;
