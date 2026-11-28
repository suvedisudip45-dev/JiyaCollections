import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Archive, Gift, LoaderCircle, Plus, RefreshCw, Send, Sparkles, Trash2, Pencil } from "lucide-react";
import { backendUrl, currency } from "../App";

const initialGift = { id: "", name: "", priceValue: "", category: "GENERAL", description: "", isActive: true };
const initialTier = { id: "", tierName: "", minSpendThreshold: "", giftTargetValue: "", description: "", isActive: true };
const tabs = [
  { id: "catalog", label: "Gift catalog" },
  { id: "budgets", label: "Order value rules" },
  { id: "distribution", label: "Hub stock" },
  { id: "assigned", label: "Assigned gifts" },
];

const previewSku = (name) => {
  const slug = String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug ? `GFT-${slug}` : "GFT-GIFT";
};

// The admin package does not include prop-types; route props are supplied by the existing page router.
// eslint-disable-next-line react/prop-types
const GiftPromotions = ({ token }) => {
  const [activeTab, setActiveTab] = useState("catalog");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [gifts, setGifts] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [stock, setStock] = useState([]);
  const [stockPage, setStockPage] = useState(1);
  const [stockTotal, setStockTotal] = useState(0);
  const [assignedOrders, setAssignedOrders] = useState([]);
  const [giftForm, setGiftForm] = useState(initialGift);
  const [tierForm, setTierForm] = useState(initialTier);
  const [stockForm, setStockForm] = useState({ distributorId: "", giftId: "", quantity: 1, notes: "" });
  const [giftOptions, setGiftOptions] = useState(null);
  const [giftOptionsLoadingId, setGiftOptionsLoadingId] = useState("");
  const [selectedGiftInventoryId, setSelectedGiftInventoryId] = useState("");
  const [stockAdjustment, setStockAdjustment] = useState(null);
  const [allocationCancellation, setAllocationCancellation] = useState(null);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError("");
    try {
      const [giftResponse, tierResponse, distributorResponse, stockResponse, assignedResponse] = await Promise.all([
        axios.get(`${backendUrl}/api/admin/gifts/catalog?includeInactive=true`, { headers: { token } }),
        axios.get(`${backendUrl}/api/admin/gifts/tiers`, { headers: { token } }),
        axios.get(`${backendUrl}/api/admin/distributor-applications/coverage`, { headers: { token } }),
        axios.get(`${backendUrl}/api/admin/gifts/stock?page=${stockPage}&pageSize=50`, { headers: { token } }),
        axios.get(`${backendUrl}/api/admin/gifts/orders`, { headers: { token } }),
      ]);
      setGifts(giftResponse.data.gifts || []);
      setTiers(tierResponse.data.tiers || []);
      setStock(stockResponse.data.inventory || []);
      setStockTotal(Number(stockResponse.data.total || 0));
      setAssignedOrders(assignedResponse.data.orders || []);
      setDistributors((distributorResponse.data.distributors || [])
        .filter((distributor) => distributor.status === "ACTIVE" && distributor.isActive));
    } catch (error) {
      const message = error.response?.data?.message || "Unable to load gift promotion data.";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [stockPage, token]);

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
      toast.success(giftForm.id ? "Gift updated." : "Gift added to the catalog.");
      setGiftForm(initialGift);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Could not save gift.");
    } finally {
      setSaving(false);
    }
  };

  const editGift = (gift) => setGiftForm({
    id: gift.id,
    name: gift.name,
    priceValue: String(gift.priceValue),
    category: gift.category || "GENERAL",
    description: gift.description || "",
    isActive: Boolean(gift.isActive),
  });

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

  const toggleTierActive = async (tier) => {
    if (tier.isActive && !window.confirm(`Archive the "${tier.tierName}" order-value gift rule?`)) return;
    setSaving(true);
    try {
      const response = tier.isActive
        ? await axios.delete(`${backendUrl}/api/admin/gifts/tiers/${tier.id}`, { headers: { token } })
        : await axios.post(`${backendUrl}/api/admin/gifts/tiers`, {
          id: tier.id,
          tierName: tier.tierName,
          minSpendThreshold: Number(tier.minSpendThreshold),
          giftTargetValue: Number(tier.giftTargetValue),
          description: tier.description || "",
          isActive: true,
        }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Could not update gift rule.");
      toast.success(tier.isActive ? "Gift rule archived." : "Gift rule reactivated.");
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Could not update gift rule.");
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

  const openGiftEditor = async (order) => {
    if (giftOptionsLoadingId) return;
    setGiftOptionsLoadingId(order.id);
    try {
      const response = await axios.get(`${backendUrl}/api/admin/gifts/orders/${order.id}/options`, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Unable to load replacement gifts.");
      setGiftOptions({ ...response.data, orderId: order.id });
      setSelectedGiftInventoryId("");
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to load replacement gifts.");
    } finally {
      setGiftOptionsLoadingId("");
    }
  };

  const replaceOrderGift = async (event) => {
    event.preventDefault();
    if (!giftOptions || !selectedGiftInventoryId) return;
    setSaving(true);
    try {
      const response = await axios.put(`${backendUrl}/api/admin/gifts/orders/${giftOptions.orderId}/gift`, {
        inventoryId: selectedGiftInventoryId,
      }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Unable to update order gift.");
      toast.success("Order gift updated.");
      setGiftOptions(null);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to update order gift.");
    } finally {
      setSaving(false);
    }
  };

  const adjustGiftStock = async (event) => {
    event.preventDefault();
    if (!stockAdjustment) return;
    setSaving(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/admin/gifts/stock/${stockAdjustment.id}/adjust`,
        { adjustment: Number(stockAdjustment.adjustment), reason: stockAdjustment.reason },
        { headers: { token } },
      );
      if (!response.data.success) throw new Error(response.data.message || "Unable to adjust gift stock.");
      toast.success("Gift stock adjusted and recorded.");
      setStockAdjustment(null);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to adjust gift stock.");
    } finally {
      setSaving(false);
    }
  };

  const cancelGiftAllocation = async (event) => {
    event.preventDefault();
    if (!allocationCancellation) return;
    setSaving(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/admin/gifts/stock/${allocationCancellation.id}/cancel`,
        { reason: allocationCancellation.reason },
        { headers: { token } },
      );
      if (!response.data.success) throw new Error(response.data.message || "Unable to cancel gift allocation.");
      toast.success("Pending gift allocation cancelled.");
      setAllocationCancellation(null);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to cancel gift allocation.");
    } finally {
      setSaving(false);
    }
  };

  const tabContent = () => {
    if (activeTab === "catalog") return (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <form onSubmit={saveGift} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div><h2 className="font-bold text-slate-900">{giftForm.id ? "Edit gift" : "Add a gift"}</h2><p className="mt-1 text-xs text-slate-500">Customers receive a catalog gift only when its value exactly matches their reward.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Gift name<input required value={giftForm.name} onChange={(e) => setGiftForm({ ...giftForm, name: e.target.value })} placeholder="Everyday tote bag" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
            <label className="text-xs font-semibold text-slate-700">Gift value<input required min="0.01" step="0.01" type="number" value={giftForm.priceValue} onChange={(e) => setGiftForm({ ...giftForm, priceValue: e.target.value })} placeholder="350" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
            <label className="text-xs font-semibold text-slate-700">Category<select value={giftForm.category} onChange={(e) => setGiftForm({ ...giftForm, category: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="GENERAL">General</option><option value="PARTNER_PRODUCT">Partner product</option><option value="OTHER">Other</option></select></label>
          </div>
          <p className="text-xs text-slate-500">Generated SKU <span className="ml-1 font-mono font-bold text-slate-800">{previewSku(giftForm.name)}</span></p>
          <label className="block text-xs font-semibold text-slate-700">Description<textarea rows="2" value={giftForm.description} onChange={(e) => setGiftForm({ ...giftForm, description: e.target.value })} className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
          {giftForm.id && <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={giftForm.isActive} onChange={(e) => setGiftForm({ ...giftForm, isActive: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-700" /> Gift is active for new rewards</label>}
          <div className="flex gap-2"><button disabled={saving} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-60">{giftForm.id ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{giftForm.id ? "Save gift changes" : "Add catalog gift"}</button>{giftForm.id && <button type="button" onClick={() => setGiftForm(initialGift)} className="rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-600">Cancel</button>}</div>
        </form>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><h2 className="font-bold text-slate-900">Gift catalog <span className="ml-1 text-xs font-medium text-slate-400">{gifts.length}</span></h2></div>
          {gifts.length ? <div className="divide-y divide-slate-100">{gifts.map((gift) => <div key={gift.id} className="flex items-center gap-3 px-4 py-3.5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Gift className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{gift.name}</p><p className="mt-0.5 text-xs text-slate-500">{gift.sku} · {gift.category}{!gift.isActive && " · Archived"}</p></div><p className="whitespace-nowrap text-sm font-bold text-slate-800">{currency}{Number(gift.priceValue).toLocaleString()}</p><button type="button" title="Edit gift" onClick={() => editGift(gift)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Pencil className="h-4 w-4" /></button>{gift.isActive && <button type="button" title="Archive gift" onClick={() => removeGift(gift)} className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>}</div>)}</div> : <EmptyState text="Add catalog gifts to begin." />}
        </section>
      </div>
    );

    if (activeTab === "budgets") return (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <form onSubmit={saveTier} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div><h2 className="font-bold text-slate-900">{tierForm.id ? "Edit order-value rule" : "Add an order-value gift"}</h2><p className="mt-1 text-xs text-slate-500">Eligible orders receive a randomly selected, accepted gift whose value exactly matches this rule. Loyalty gifts are configured on each loyalty tier.</p></div>
          <label className="block text-xs font-semibold text-slate-700">Rule name<input required value={tierForm.tierName} onChange={(e) => setTierForm({ ...tierForm, tierName: e.target.value })} placeholder="Orders over Rs 8,000" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Minimum order value<input required min="1" type="number" value={tierForm.minSpendThreshold} onChange={(e) => setTierForm({ ...tierForm, minSpendThreshold: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
            <label className="text-xs font-semibold text-slate-700">Exact gift value<input required min="0.01" type="number" step="0.01" value={tierForm.giftTargetValue} onChange={(e) => setTierForm({ ...tierForm, giftTargetValue: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
          </div>
          <label className="block text-xs font-semibold text-slate-700">Internal note<textarea rows="2" value={tierForm.description} onChange={(e) => setTierForm({ ...tierForm, description: e.target.value })} className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={tierForm.isActive} onChange={(e) => setTierForm({ ...tierForm, isActive: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-700" /> Trigger is active</label>
          <div className="flex gap-2"><button disabled={saving} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-60"><Sparkles className="h-4 w-4" /> {tierForm.id ? "Update trigger" : "Save trigger"}</button>{tierForm.id && <button type="button" onClick={() => setTierForm(initialTier)} className="rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-600">Cancel</button>}</div>
        </form>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="font-bold text-slate-900">Configured triggers</h2></div>
          {tiers.length ? <div className="divide-y divide-slate-100">{tiers.map((tier) => <div key={tier.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4"><div className="min-w-36 flex-1"><p className="text-sm font-bold text-slate-900">{tier.tierName}</p>{tier.description && <p className="mt-1 text-xs text-slate-500">{tier.description}</p>}</div><div><p className="text-[10px] font-bold uppercase text-slate-400">Order from</p><p className="text-sm font-semibold text-slate-800">{currency}{Number(tier.minSpendThreshold).toLocaleString()}</p></div><div><p className="text-[10px] font-bold uppercase text-slate-400">Exact gift value</p><p className="text-sm font-semibold text-emerald-800">{currency}{Number(tier.giftTargetValue).toLocaleString()}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${tier.isActive ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{tier.isActive ? "ACTIVE" : "PAUSED"}</span><button type="button" title="Edit rule" onClick={() => setTierForm({ id: tier.id, tierName: tier.tierName, minSpendThreshold: String(tier.minSpendThreshold || ""), giftTargetValue: String(tier.giftTargetValue || ""), description: tier.description || "", isActive: Boolean(tier.isActive) })} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Pencil className="h-4 w-4" /></button><button type="button" disabled={saving} onClick={() => toggleTierActive(tier)} className={`rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${tier.isActive ? "border-rose-200 text-rose-700 hover:bg-rose-50" : "border-emerald-200 text-emerald-800 hover:bg-emerald-50"}`}>{tier.isActive ? "Archive" : "Reactivate"}</button></div>)}</div> : <EmptyState text="No order-value rules configured yet." />}
        </section>
      </div>
    );

    if (activeTab === "distribution") return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <form onSubmit={distributeStock} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div><h2 className="font-bold text-slate-900">Send stock to a hub</h2><p className="mt-1 text-xs text-slate-500">Distributed stock is available only after the distributor accepts it.</p></div>
          <label className="block text-xs font-semibold text-slate-700">Distributor<select required value={stockForm.distributorId} onChange={(e) => setStockForm({ ...stockForm, distributorId: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">Choose a hub</option>{distributors.map((distributor) => <option key={distributor.id} value={distributor.id}>{distributor.name} · {distributor.city || distributor.address || "Location not set"}</option>)}</select></label>
          <label className="block text-xs font-semibold text-slate-700">Gift<select required value={stockForm.giftId} onChange={(e) => setStockForm({ ...stockForm, giftId: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">Choose a catalog gift</option>{gifts.filter((gift) => gift.isActive).map((gift) => <option key={gift.id} value={gift.id}>{gift.name} · {currency}{Number(gift.priceValue).toLocaleString()}</option>)}</select></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Quantity<input required min="1" type="number" value={stockForm.quantity} onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label><label className="text-xs font-semibold text-slate-700">Note<input value={stockForm.notes} onChange={(e) => setStockForm({ ...stockForm, notes: e.target.value })} placeholder="Optional" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label></div>
          <button disabled={saving || !gifts.length || !distributors.length} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60"><Send className="h-4 w-4" /> Assign gift stock</button>
        </form>
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5"><div className="flex h-full min-h-48 flex-col justify-center"><Archive className="h-8 w-8 text-emerald-700" /><h2 className="mt-3 font-bold text-slate-900">Hub stock lifecycle</h2><p className="mt-1 max-w-md text-sm leading-6 text-slate-600">A distribution starts as pending. The distributor confirms the quantity actually received; only acknowledged stock is eligible for automatic gift selection.</p><p className="mt-3 text-xs font-semibold text-slate-500">Catalog {gifts.filter((gift) => gift.isActive).length} active · {distributors.length} active hubs</p></div></div>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="font-bold text-slate-900">Distributed stock <span className="ml-1 text-xs font-medium text-slate-400">{stockTotal}</span></h2><p className="mt-1 text-xs text-slate-500">Adjust acknowledged counts with a required reason. Reserved units cannot be reduced.</p></div>
          {stock.length ? <div className="divide-y divide-slate-100">{stock.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs"><span className="min-w-36 flex-1 font-semibold text-slate-900">{item.gift?.name} · {item.distributor?.name}</span><span className="text-slate-600">{item.distributor?.district || "District not set"}, {item.distributor?.province || "Province not set"}</span><span>Sent <strong>{item.quantitySent}</strong></span><span>Received <strong>{item.receivedQuantity ?? "—"}</strong></span><span>Available <strong>{item.status === "ACCEPTED" ? item.quantityAvailable : 0}</strong></span><span>Reserved <strong>{item.status === "ACCEPTED" ? item.quantityReserved : 0}</strong></span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${item.status === "ACCEPTED" ? "bg-emerald-50 text-emerald-800" : item.status === "PENDING_ACCEPTANCE" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{String(item.status).replaceAll("_", " ")}</span>{item.status === "ACCEPTED" && <button type="button" onClick={() => setStockAdjustment({ id: item.id, giftName: item.gift?.name, distributorName: item.distributor?.name, available: item.quantityAvailable, adjustment: "", reason: "" })} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"><Pencil className="h-3 w-3" /> Adjust</button>}{item.status === "PENDING_ACCEPTANCE" && <button type="button" onClick={() => setAllocationCancellation({ id: item.id, giftName: item.gift?.name, distributorName: item.distributor?.name, reason: "" })} className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1.5 font-semibold text-rose-700 hover:bg-rose-50"><Trash2 className="h-3 w-3" /> Cancel dispatch</button>}</div>)}</div> : <EmptyState text="No distributor gift stock has been assigned." />}
          {stockTotal > 50 && <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-600"><span>Page {stockPage} of {Math.ceil(stockTotal / 50)} · {stockTotal} stock records</span><div className="flex gap-2"><button type="button" disabled={stockPage <= 1 || loading} onClick={() => setStockPage((page) => page - 1)} className="rounded-md border border-slate-300 px-3 py-1.5 font-semibold disabled:opacity-40">Previous</button><button type="button" disabled={stockPage >= Math.ceil(stockTotal / 50) || loading} onClick={() => setStockPage((page) => page + 1)} className="rounded-md border border-slate-300 px-3 py-1.5 font-semibold disabled:opacity-40">Next</button></div></div>}
        </section>
      </div>
    );

    if (activeTab === "assigned") return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="font-bold text-slate-900">Gifted orders eligible for Admin changes</h2><p className="mt-1 text-xs text-slate-500">Only un-packed orders are listed. Replacement gifts must have the same value and be in accepted stock at the assigned distributor.</p></div>
        {assignedOrders.length ? <div className="divide-y divide-slate-100">{assignedOrders.map((order) => {
          const inventory = order.assignedDistributorGiftInventory;
          const gift = order.assignedGift;
          const requiredValue = Number(order.giftRewardEntitlement?.rewardValue ?? gift?.priceValue ?? 0);
          return <div key={order.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-4">
            <div className="min-w-44 flex-1"><p className="text-xs font-bold text-slate-900">Order {order.id}</p><p className="mt-1 text-xs text-slate-600">{inventory?.distributor?.name || "Distributor"} · {inventory?.distributor?.district || "—"}, {inventory?.distributor?.province || "—"}</p></div>
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Current gift</p><p className="text-sm font-semibold text-slate-800">{gift?.name}</p></div>
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Required value</p><p className="text-sm font-semibold text-emerald-800">{currency}{requiredValue.toLocaleString()}</p></div>
            <button type="button" onClick={() => openGiftEditor(order)} disabled={Boolean(giftOptionsLoadingId)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /> {giftOptionsLoadingId === order.id ? "Loading..." : "Change gift"}</button>
          </div>;
        })}</div> : <EmptyState text="There are no eligible, un-packed orders with assigned gifts." />}
      </section>
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
      {!loading && loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"><span>{loadError}</span><button type="button" onClick={fetchData} className="font-bold underline">Retry</button></div>}
      {giftOptions && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="gift-replacement-title">
        <form onSubmit={replaceOrderGift} className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl">
          <div className="flex items-start justify-between gap-3"><div><h2 id="gift-replacement-title" className="font-bold text-slate-900">Change order gift</h2><p className="mt-1 text-xs text-slate-500">Current: {giftOptions.assignedGift.name} · exact replacement value {currency}{Number(giftOptions.requiredValue).toLocaleString()}</p></div><button type="button" onClick={() => setGiftOptions(null)} aria-label="Close" className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">×</button></div>
          <label className="block text-xs font-semibold text-slate-700">Accepted gift stock at this distributor<select required value={selectedGiftInventoryId} onChange={(event) => setSelectedGiftInventoryId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">Select an exact-value replacement</option>{giftOptions.options.map((option) => <option key={option.inventoryId} value={option.inventoryId}>{option.name} · {currency}{Number(option.priceValue).toLocaleString()} · {option.quantityAvailable} available</option>)}</select></label>
          {!giftOptions.options.length && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">No other exact-value gift is currently available. The existing reservation remains unchanged.</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setGiftOptions(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Cancel</button><button type="submit" disabled={saving || !selectedGiftInventoryId} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Save replacement</button></div>
        </form>
      </div>}
      {stockAdjustment && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="gift-stock-adjustment-title">
        <form onSubmit={adjustGiftStock} className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl">
          <div className="flex items-start justify-between gap-3"><div><h2 id="gift-stock-adjustment-title" className="font-bold text-slate-900">Adjust acknowledged stock</h2><p className="mt-1 text-xs text-slate-500">{stockAdjustment.giftName} · {stockAdjustment.distributorName} · {stockAdjustment.available} available</p></div><button type="button" onClick={() => setStockAdjustment(null)} aria-label="Close" className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">×</button></div>
          <label className="block text-xs font-semibold text-slate-700">Quantity change<input required type="number" step="1" value={stockAdjustment.adjustment} onChange={(event) => setStockAdjustment({ ...stockAdjustment, adjustment: event.target.value })} placeholder="Use a negative number to reduce stock" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
          <label className="block text-xs font-semibold text-slate-700">Reason<textarea required minLength="3" maxLength="500" rows="3" value={stockAdjustment.reason} onChange={(event) => setStockAdjustment({ ...stockAdjustment, reason: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Reserved gifts are protected. The adjustment and reason are written to the inventory movement and admin audit history.</p>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setStockAdjustment(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Cancel</button><button type="submit" disabled={saving || !Number.isSafeInteger(Number(stockAdjustment.adjustment)) || Number(stockAdjustment.adjustment) === 0 || !stockAdjustment.reason.trim()} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Save adjustment</button></div>
        </form>
      </div>}
      {allocationCancellation && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="gift-allocation-cancel-title">
        <form onSubmit={cancelGiftAllocation} className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl">
          <div className="flex items-start justify-between gap-3"><div><h2 id="gift-allocation-cancel-title" className="font-bold text-slate-900">Cancel pending dispatch</h2><p className="mt-1 text-xs text-slate-500">{allocationCancellation.giftName} · {allocationCancellation.distributorName}</p></div><button type="button" onClick={() => setAllocationCancellation(null)} aria-label="Close" className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">×</button></div>
          <label className="block text-xs font-semibold text-slate-700">Cancellation reason<textarea required minLength="3" maxLength="500" rows="3" value={allocationCancellation.reason} onChange={(event) => setAllocationCancellation({ ...allocationCancellation, reason: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Only unacknowledged allocations can be cancelled. The distributor receipt action and cancellation compete safely; the first valid update wins and the movement stays in history.</p>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setAllocationCancellation(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Keep dispatch</button><button type="submit" disabled={saving || allocationCancellation.reason.trim().length < 3} className="rounded-lg bg-rose-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Cancel dispatch</button></div>
        </form>
      </div>}
    </div>
  );
};

// eslint-disable-next-line react/prop-types
const EmptyState = ({ text }) => <div className="px-4 py-10 text-center text-sm text-slate-500">{text}</div>;

export default GiftPromotions;
