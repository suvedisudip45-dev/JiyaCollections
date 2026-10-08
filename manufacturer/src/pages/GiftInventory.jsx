import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Check, Gift, PackageCheck, RefreshCw, X } from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";

const statusStyles = {
  PENDING_ACCEPTANCE: "bg-amber-50 text-amber-800",
  ACCEPTED: "bg-emerald-50 text-emerald-800",
  REJECTED: "bg-rose-50 text-rose-800",
};

const GiftInventory = () => {
  const { token, backendUrl, currency } = useManufacturer();
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState("");

  const fetchInventory = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/distributor/gifts/inbound`, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Unable to load gift stock.");
      setInventory(response.data.inventory || []);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to load gift stock.");
    } finally {
      setLoading(false);
    }
  }, [backendUrl, token]);

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  const respond = async (item, decision) => {
    setRespondingId(item.id);
    try {
      const response = await axios.post(`${backendUrl}/api/distributor/gifts/${item.id}/respond`, { decision }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Unable to update gift stock.");
      toast.success(decision === "ACCEPTED" ? "Gift stock accepted." : "Gift stock rejected.");
      await fetchInventory();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to update gift stock.");
    } finally {
      setRespondingId("");
    }
  };

  const pendingCount = inventory.filter((item) => item.status === "PENDING_ACCEPTANCE").length;
  const acceptedCount = inventory.filter((item) => item.status === "ACCEPTED").length;
  const availableUnits = inventory.filter((item) => item.status === "ACCEPTED").reduce((sum, item) => sum + Number(item.quantityAvailable || 0), 0);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end">
        <div><p className="text-[11px] font-bold uppercase text-emerald-800">Customer care</p><h1 className="mt-1 text-2xl font-black text-slate-950">Gift stock</h1><p className="mt-1 text-sm text-slate-600">Review incoming retention gifts and track stock reserved for customer orders.</p></div>
        <button type="button" onClick={fetchInventory} disabled={loading} title="Refresh gift stock" className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:self-auto"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Gift stock overview">
        <Metric label="Pending decisions" value={pendingCount} tone="amber" />
        <Metric label="Accepted gifts" value={acceptedCount} tone="green" />
        <Metric label="Available units" value={availableUnits} tone="dark" />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><h2 className="font-bold text-slate-900">Assigned gift stock</h2><span className="text-xs text-slate-500">{inventory.length} item{inventory.length === 1 ? "" : "s"}</span></div>
        {loading ? <div className="flex min-h-48 items-center justify-center text-sm text-slate-500">Loading your stock...</div> : inventory.length ? <div className="divide-y divide-slate-100">{inventory.map((item) => {
          const pending = item.status === "PENDING_ACCEPTANCE";
          return <article key={item.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
            <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Gift className="h-5 w-5" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-bold text-slate-900">{item.gift?.name || "Gift item"}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusStyles[item.status] || "bg-slate-100 text-slate-700"}`}>{String(item.status || "").replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-slate-500">{item.gift?.sku || "No SKU"} · {currency}{Number(item.gift?.priceValue || 0).toLocaleString()}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600"><span>Available <strong className="text-slate-900">{item.quantityAvailable}</strong></span><span>Reserved <strong className="text-slate-900">{item.quantityReserved}</strong></span></div>{item.notes && <p className="mt-1 max-w-xl text-xs text-slate-500">{item.notes}</p>}</div></div>
            {pending && <div className="flex gap-2 sm:justify-end"><button type="button" onClick={() => respond(item, "ACCEPTED")} disabled={respondingId === item.id} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50 sm:flex-none"><Check className="h-4 w-4" /> Accept</button><button type="button" onClick={() => respond(item, "REJECTED")} disabled={respondingId === item.id} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-rose-50 hover:text-rose-800 disabled:opacity-50 sm:flex-none"><X className="h-4 w-4" /> Reject</button></div>}
            {!pending && item.status === "ACCEPTED" && <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800"><PackageCheck className="h-4 w-4" /> Ready for allocation</span>}
          </article>;
        })}</div> : <div className="px-5 py-14 text-center"><Gift className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No gift stock assigned yet</p><p className="mt-1 text-xs text-slate-500">New stock assignments will appear here for your review.</p></div>}
      </section>
    </div>
  );
};

const Metric = ({ label, value, tone }) => {
  const styles = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-950" : tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-950";
  return <div className={`rounded-xl border px-4 py-3 ${styles}`}><p className="text-[10px] font-bold uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-black">{value}</p></div>;
};

export default GiftInventory;
