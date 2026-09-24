import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { CheckCircle2, PackageCheck, RefreshCw } from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";

const MarketingCards = () => {
  const { token, backendUrl } = useManufacturer();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/marketing-cards/manufacturer/cards?status=all`, { headers: { token } });
      setCards(response.data.cards || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load marketing card inventory.");
    } finally { setLoading(false); }
  }, [backendUrl, token]);

  useEffect(() => { load(); }, [load]);

  const receive = async (cardId) => {
    setWorkingId(cardId);
    try {
      const response = await axios.post(`${backendUrl}/api/marketing-cards/manufacturer/cards/${cardId}/receive`, {}, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message);
      toast.success("Card receipt confirmed.");
      await load();
    } catch (error) { toast.error(error.response?.data?.message || error.message || "Unable to confirm receipt."); }
    finally { setWorkingId(""); }
  };

  const counts = cards.reduce((result, card) => { result[card.physicalStatus] = (result[card.physicalStatus] || 0) + 1; return result; }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Manufacturer inventory</p><h1 className="mt-1 text-2xl font-black text-slate-950">Marketing cards</h1><p className="mt-1 text-sm text-slate-500">Confirm receipt before cards become available for order packaging.</p></div><button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"><RefreshCw className="h-4 w-4" /> Refresh</button></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{["ASSIGNED", "AVAILABLE", "ATTACHED", "CANCELLED"].map((status) => <div key={status} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{status}</p><p className="mt-2 text-2xl font-black text-slate-900">{counts[status] || 0}</p></div>)}</div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-black text-slate-900">Assigned card inventory</h2></div>{loading ? <p className="p-6 text-sm text-slate-500">Loading inventory...</p> : cards.length === 0 ? <p className="p-6 text-sm text-slate-500">No cards have been assigned to this manufacturer.</p> : <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Card</th><th className="px-5 py-3">Partner / campaign</th><th className="px-5 py-3">Target</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{cards.map((card) => <tr key={card.id}><td className="px-5 py-4 font-mono font-bold text-slate-800">{card.cardCode}</td><td className="px-5 py-4"><p className="font-bold text-slate-800">{card.campaign?.marketingPartner?.name || "-"}</p><p className="text-slate-500">{card.campaign?.name || "-"}</p></td><td className="px-5 py-4 text-slate-600">{card.campaign?.targetScopeType || "NATIONWIDE"}</td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700">{card.physicalStatus}</span></td><td className="px-5 py-4">{card.physicalStatus === "ASSIGNED" ? <button type="button" disabled={workingId === card.id} onClick={() => receive(card.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"><PackageCheck className="h-3.5 w-3.5" /> Confirm receipt</button> : card.physicalStatus === "AVAILABLE" ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Ready for packaging</span> : <span className="text-[11px] text-slate-500">Attached to order</span>}</td></tr>)}</tbody></table></div>}</div>
    </div>
  );
};

export default MarketingCards;
