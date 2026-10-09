import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Archive, Gift, LoaderCircle, Plus, RefreshCw, Send, Sparkles, Trash2, Pencil } from "lucide-react";
import { backendUrl, currency } from "../App";

const initialGift = { name: "", priceValue: "", category: "GENERAL", description: "", isActive: true };
const initialTier = { id: "", tierName: "", minSpendThreshold: "", giftTargetValue: "", description: "", isActive: true };
const tabs = [
  { id: "catalog", label: "Gift catalog" },
  { id: "budgets", label: "Order value rules" },
  { id: "distribution", label: "Hub stock" },
];

const previewSku = (name) => {
  const slug = String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug ? `GFT-${slug}` : "GFT-GIFT";
};

const GiftPromotions = ({ token }) => {
  const [activeTab, setActiveTab] = useState("catalog");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gifts, setGifts] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [giftForm, setGiftForm] = useState(initialGift);
  const [tierForm, setTierForm] = useState(initialTier);
  const [stockForm, setStockForm] = useState({ distributorId: "", giftId: "", quantity: 1, notes: "" });

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [giftResponse, tierResponse, distributorResponse] = await Promise.all([
        axios.get(`${backendUrl}/api/admin/gifts/catalog`, { headers: { token } }),
        axios.get(`${backendUrl}/api/admin/gifts/tiers`, { headers: { token } }),
        axios.get(`${backendUrl}/api/admin/distributor-applications/coverage`, { headers: { token } }),
      ]);
      setGifts(giftResponse.data.gifts || []);
      setTiers(tierResponse.data.tiers || []);
      setDistributors((distributorResponse.data.distributors || [])
        .filter((distributor) => distributor.status === "ACTIVE" && distributor.isActive));
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load gift promotion data.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const saveGift = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await axios.post(`${backendUrl}/api/admin/gifts/catalog`, {
        ...giftForm,
        priceValue: Number(giftForm.priceValue),
      }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Could not save gift.");
      toast.success("Gift added to the catalog.");
      setGiftForm(initialGift);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Could not save gift.");
    } finally {
      setSaving(false);
    }
  };

  const removeGift = async (gift) => {
    if (!window.confirm(`Remove ${gift.name} from the active gift catalog?`)) return;
    try {
      const response = await axios.delete(`${backendUrl}/api/admin/gifts/catalog/${gift.id}`, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Could not remove gift.");
      toast.success("Gift removed.");
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Could not remove gift.");
    }
  };

  const saveTier = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await axios.post(`${backendUrl}/api/admin/gifts/tiers`, {
        ...tierForm,
        minSpendThreshold: Number(tierForm.minSpendThreshold || 0),
        giftTargetValue: Number(tierForm.giftTargetValue),
      }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Could not save spend rule.");
      toast.success("Gift trigger saved.");
      setTierForm(initialTier);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Could not save spend rule.");
    } finally {
      setSaving(false);
    }
  };

  const distributeStock = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await axios.post(`${backendUrl}/api/admin/gifts/assign-distributor`, {
        ...stockForm,
        quantity: Number(stockForm.quantity),
      }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Could not distribute stock.");
      toast.success("Gift stock assigned to the distributor.");
      setStockForm((current) => ({ ...current, quantity: 1, notes: "" }));
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Could not distribute stock.");
    } finally {
      setSaving(false);
    }
  };

  const tabContent = () => {
    if (activeTab === "catalog") return (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <form onSubmit={saveGift} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div><h2 className="font-bold text-slate-900">Add a gift</h2><p className="mt-1 text-xs text-slate-500">Set a reference value; active spend rules use it as an allocation ceiling.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Gift name<input required value={giftForm.name} onChange={(e) => setGiftForm({ ...giftForm, name: e.target.value })} placeholder="Everyday tote bag" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
            <label className="text-xs font-semibold text-slate-700">Reference value<input required min="0.01" step="0.01" type="number" value={giftForm.priceValue} onChange={(e) => setGiftForm({ ...giftForm, priceValue: e.target.value })} placeholder="350" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
            <label className="text-xs font-semibold text-slate-700">Category<select value={giftForm.category} onChange={(e) => setGiftForm({ ...giftForm, category: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="GENERAL">General</option><option value="PARTNER_PRODUCT">Partner product</option><option value="OTHER">Other</option></select></label>
          </div>
          <p className="text-xs text-slate-500">Generated SKU <span className="ml-1 font-mono font-bold text-slate-800">{previewSku(giftForm.name)}</span></p>
          <label className="block text-xs font-semibold text-slate-700">Description<textarea rows="2" value={giftForm.description} onChange={(e) => setGiftForm({ ...giftForm, description: e.target.value })} className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
          <button disabled={saving} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-60"><Plus className="h-4 w-4" /> Add catalog gift</button>
        </form>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><h2 className="font-bold text-slate-900">Gift catalog <span className="ml-1 text-xs font-medium text-slate-400">{gifts.length}</span></h2></div>
          {gifts.length ? <div className="divide-y divide-slate-100">{gifts.map((gift) => <div key={gift.id} className="flex items-center gap-3 px-4 py-3.5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Gift className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{gift.name}</p><p className="mt-0.5 text-xs text-slate-500">{gift.sku} · {gift.category}</p></div><p className="whitespace-nowrap text-sm font-bold text-slate-800">{currency}{Number(gift.priceValue).toLocaleString()}</p><button type="button" title="Remove gift" onClick={() => removeGift(gift)} className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button></div>)}</div> : <EmptyState text="Add catalog gifts to begin." />}
        </section>
      </div>
    );

    if (activeTab === "budgets") return (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <form onSubmit={saveTier} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div><h2 className="font-bold text-slate-900">{tierForm.id ? "Edit order-value rule" : "Add an order-value gift"}</h2><p className="mt-1 text-xs text-slate-500">Qualifying orders can choose an accepted hub gift up to the configured value. Loyalty gifts are configured on each loyalty tier.</p></div>
          <label className="block text-xs font-semibold text-slate-700">Rule name<input required value={tierForm.tierName} onChange={(e) => setTierForm({ ...tierForm, tierName: e.target.value })} placeholder="Orders over Rs 8,000" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Minimum order value<input required min="1" type="number" value={tierForm.minSpendThreshold} onChange={(e) => setTierForm({ ...tierForm, minSpendThreshold: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
            <label className="text-xs font-semibold text-slate-700">Gift value ceiling<input required min="0.01" type="number" step="0.01" value={tierForm.giftTargetValue} onChange={(e) => setTierForm({ ...tierForm, giftTargetValue: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
          </div>
          <label className="block text-xs font-semibold text-slate-700">Internal note<textarea rows="2" value={tierForm.description} onChange={(e) => setTierForm({ ...tierForm, description: e.target.value })} className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={tierForm.isActive} onChange={(e) => setTierForm({ ...tierForm, isActive: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-700" /> Trigger is active</label>
          <div className="flex gap-2"><button disabled={saving} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-60"><Sparkles className="h-4 w-4" /> {tierForm.id ? "Update trigger" : "Save trigger"}</button>{tierForm.id && <button type="button" onClick={() => setTierForm(initialTier)} className="rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-600">Cancel</button>}</div>
        </form>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="font-bold text-slate-900">Configured triggers</h2></div>
          {tiers.length ? <div className="divide-y divide-slate-100">{tiers.map((tier) => <div key={tier.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4"><div className="min-w-36 flex-1"><p className="text-sm font-bold text-slate-900">{tier.tierName}</p>{tier.description && <p className="mt-1 text-xs text-slate-500">{tier.description}</p>}</div><div><p className="text-[10px] font-bold uppercase text-slate-400">Order from</p><p className="text-sm font-semibold text-slate-800">{currency}{Number(tier.minSpendThreshold).toLocaleString()}</p></div><div><p className="text-[10px] font-bold uppercase text-slate-400">Gift cap</p><p className="text-sm font-semibold text-emerald-800">{currency}{Number(tier.giftTargetValue).toLocaleString()}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${tier.isActive ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{tier.isActive ? "ACTIVE" : "PAUSED"}</span><button type="button" title="Edit rule" onClick={() => setTierForm({ id: tier.id, tierName: tier.tierName, minSpendThreshold: String(tier.minSpendThreshold || ""), giftTargetValue: String(tier.giftTargetValue || ""), description: tier.description || "", isActive: Boolean(tier.isActive) })} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Pencil className="h-4 w-4" /></button></div>)}</div> : <EmptyState text="No order-value rules configured yet." />}
        </section>
      </div>
    );

    if (activeTab === "distribution") return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <form onSubmit={distributeStock} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div><h2 className="font-bold text-slate-900">Send stock to a hub</h2><p className="mt-1 text-xs text-slate-500">Distributed stock is available only after the distributor accepts it.</p></div>
          <label className="block text-xs font-semibold text-slate-700">Distributor<select required value={stockForm.distributorId} onChange={(e) => setStockForm({ ...stockForm, distributorId: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">Choose a hub</option>{distributors.map((distributor) => <option key={distributor.id} value={distributor.id}>{distributor.name} · {distributor.city || distributor.address || "Location not set"}</option>)}</select></label>
          <label className="block text-xs font-semibold text-slate-700">Gift<select required value={stockForm.giftId} onChange={(e) => setStockForm({ ...stockForm, giftId: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">Choose a catalog gift</option>{gifts.map((gift) => <option key={gift.id} value={gift.id}>{gift.name} · {currency}{Number(gift.priceValue).toLocaleString()}</option>)}</select></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Quantity<input required min="1" type="number" value={stockForm.quantity} onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label><label className="text-xs font-semibold text-slate-700">Note<input value={stockForm.notes} onChange={(e) => setStockForm({ ...stockForm, notes: e.target.value })} placeholder="Optional" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label></div>
          <button disabled={saving || !gifts.length || !distributors.length} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60"><Send className="h-4 w-4" /> Assign gift stock</button>
        </form>
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5"><div className="flex h-full min-h-48 flex-col justify-center"><Archive className="h-8 w-8 text-emerald-700" /><h2 className="mt-3 font-bold text-slate-900">Hub stock lifecycle</h2><p className="mt-1 max-w-md text-sm leading-6 text-slate-600">A new distribution begins as pending acceptance. It becomes eligible for order allocation only after the distributor confirms receipt.</p><p className="mt-3 text-xs font-semibold text-slate-500">Catalog {gifts.length} · Active hubs {distributors.length}</p></div></div>
      </div>
    );

    return null;
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end">
        <div><p className="text-[11px] font-bold uppercase text-emerald-800">Customer retention</p><h1 className="mt-1 text-2xl font-black text-slate-950">Gift promotions</h1><p className="mt-1 max-w-2xl text-sm text-slate-600">Manage gift products, order-value rules, and distributor stock distribution.</p></div>
        <button type="button" onClick={fetchData} disabled={loading} title="Refresh promotion data" className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:self-auto"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
      </header>
      <div role="tablist" aria-label="Gift promotion sections" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} className={`shrink-0 border-b-2 px-3 py-3 text-xs font-bold transition sm:px-4 ${activeTab === tab.id ? "border-emerald-700 text-emerald-900" : "border-transparent text-slate-500 hover:text-slate-900"}`}>{tab.label}</button>)}
      </div>
      {loading ? <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading promotion data</div> : tabContent()}
    </div>
  );
};

const EmptyState = ({ text }) => <div className="px-4 py-10 text-center text-sm text-slate-500">{text}</div>;

export default GiftPromotions;
