import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";
import PrintSheetModal from "../components/PrintSheetModal";
import {
  NEPAL_PROVINCES,
  DISTRICTS_BY_PROVINCE,
  ALL_DISTRICTS,
} from "../data/nepalLocations";

// ─── helpers ────────────────────────────────────────────────────────────────
const fmt = (n) => (n ?? 0).toLocaleString();
const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(1)}%` : "0%");

const STATUS_COLOR = {
  GENERATED: "bg-slate-100 text-slate-700",
  ASSIGNED:  "bg-amber-100 text-amber-800",
  AVAILABLE: "bg-sky-100 text-sky-800",
  ATTACHED:  "bg-indigo-100 text-indigo-700",
  CANCELLED: "bg-red-100 text-red-700",
  REDEEMED:  "bg-emerald-100 text-emerald-800",
  DELIVERED: "bg-teal-100 text-teal-800",
  ACTIVATED: "bg-violet-100 text-violet-800",
};

const Badge = ({ status, label }) => {
  const cls = STATUS_COLOR[status] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {label || status}
    </span>
  );
};

const MiniBar = ({ value, total, color = "bg-slate-700" }) => {
  const w = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
      </div>
      <span className="text-[10px] text-slate-500 w-8 text-right">{w}%</span>
    </div>
  );
};

const StatCard = ({ label, value, sub, color = "text-slate-900" }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    <p className={`mt-2 text-2xl font-black ${color}`}>{fmt(value)}</p>
    {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
  </div>
);

// ─── Campaign status toggle ───────────────────────────────────────────────────
const createDefaultOffer = (overrides = {}) => ({
  id: Date.now() + Math.random(),
  name: "",
  description: "",
  benefitType: "DISCOUNT",
  value: 10,
  allocationMode: "PERCENTAGE",
  percentage: 10,
  quantity: 20,
  terms: "",
  expiresAt: "",
  ...overrides,
});

const emptyPartner = { code: "", name: "", description: "", email: "", password: "" };

const createInitialCampaign = () => ({
  marketingPartnerId: "",
  name: "",
  targetScopeType: "NATIONWIDE",
  targetProvince: "",
  targetDistrict: "",
  requestedQuantity: 0,
  endsAt: "",
  cardExpiresAt: "",
  adMediaType: "NONE",
  adMediaUrl: "",
  adHeadline: "",
  adDescription: "",
  adExternalLink: "",
  offers: [
    createDefaultOffer({ name: "10% Discount Voucher", description: "10% discount on orders", benefitType: "DISCOUNT", value: 10, allocationMode: "PERCENTAGE", percentage: 10 }),
  ],
});

// ─── Paginator ───────────────────────────────────────────────────────────────
const Paginator = ({ page, totalPages, onPage }) => {
  if (totalPages <= 1) return null;
  const pages = [];
  const range = 2;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - range && i <= page + range)) pages.push(i);
    else if (pages[pages.length - 1] !== "...") pages.push("...");
  }
  return (
    <div className="flex items-center justify-center gap-1 py-3">
      <button onClick={() => onPage(page - 1)} disabled={page === 1} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40 hover:bg-slate-50">←</button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`e${i}`} className="px-2 text-xs text-slate-400">…</span>
        ) : (
          <button key={p} onClick={() => onPage(p)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${p === page ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{p}</button>
        )
      )}
      <button onClick={() => onPage(page + 1)} disabled={page === totalPages} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40 hover:bg-slate-50">→</button>
    </div>
  );
};

// ─── Invalidate confirm modal ────────────────────────────────────────────────
const InvalidateModal = ({ count, onConfirm, onClose, working }) => {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-base font-black text-red-700">⚠️ Invalidate {count} Card{count !== 1 ? "s" : ""}?</h2>
        <p className="mt-2 text-sm text-slate-600">This will permanently cancel the selected card(s). This action cannot be undone.</p>
        <div className="mt-4">
          <label className="block text-xs font-bold text-slate-600 mb-1">Reason <span className="text-slate-400 font-normal">(optional)</span></label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Printed incorrectly, fraud prevention…" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} disabled={working} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button onClick={() => onConfirm(reason)} disabled={working} className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">
            {working ? "Invalidating…" : `Invalidate ${count} Card${count !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── TABS ────────────────────────────────────────────────────────────────────
const TABS = [
  { key: "overview",  label: "📊 Overview & Stats" },
  { key: "tracker",   label: "🗃️ Card Tracker" },
  { key: "setup",     label: "⚙️ Setup & Generate" },
];

// ════════════════════════════════════════════════════════════════════════════
const MarketingCards = ({ token }) => {
  const [tab, setTab] = useState("overview");

  // Core data
  const [partners, setPartners] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [manufacturers, setManufacturers] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [stats, setStats] = useState(null);

  // Card tracker state
  const [cards, setCards] = useState([]);
  const [cardTotal, setCardTotal] = useState(0);
  const [cardTotalPages, setCardTotalPages] = useState(1);
  const [cardPage, setCardPage] = useState(1);
  const [filters, setFilters] = useState({ partnerId: "", campaignId: "", manufacturerId: "", status: "all", search: "" });
  const [selected, setSelected] = useState(new Set());
  const [showInvalidate, setShowInvalidate] = useState(false);

  // Setup forms
  const [partner, setPartner] = useState(emptyPartner);
  const [campaign, setCampaign] = useState(createInitialCampaign);
  const [batch, setBatch] = useState({ campaignId: "", quantity: 500 });
  const [assignment, setAssignment] = useState({ campaignId: "", manufacturerId: "", quantity: 1 });

  // Print Sheet Modal state
  const [printModalData, setPrintModalData] = useState({
    isOpen: false,
    batchCode: "BATCH",
    partnerName: "Brand Partner",
    campaignName: "Marketing Campaign",
    campaignScope: "Nationwide",
    cardExpiresAt: null,
    cards: [],
  });

  const [loading, setLoading] = useState(true);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [approvalCodes, setApprovalCodes] = useState({});

  // ── Base data load ────────────────────────────────────────────────────────
  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const [partnerRes, campaignRes, manufacturerRes, metricsRes, statsRes] = await Promise.all([
        axios.get(`${backendUrl}/api/marketing-cards/admin/partners`, { headers: { token } }),
        axios.get(`${backendUrl}/api/marketing-cards/admin/campaigns`, { headers: { token } }),
        axios.get(`${backendUrl}/api/manufacturer/admin/list`, { headers: { token } }),
        axios.get(`${backendUrl}/api/marketing-cards/admin/metrics`, { headers: { token } }),
        axios.get(`${backendUrl}/api/marketing-cards/admin/stats`, { headers: { token } }),
      ]);
      setPartners(partnerRes.data.partners || []);
      setCampaigns(campaignRes.data.campaigns || []);
      setManufacturers(manufacturerRes.data.manufacturers || []);
      setMetrics(metricsRes.data.metrics || null);
      setStats(statsRes.data.stats || null);
    } catch (err) {
      toast.error(err.response?.data?.message || "Unable to load marketing card data.");
    } finally { setLoading(false); }
  }, [token]);

  // ── Paginated cards load ──────────────────────────────────────────────────
  const loadCards = useCallback(async (page = 1, f = filters) => {
    setCardsLoading(true);
    setSelected(new Set());
    try {
      const params = new URLSearchParams({ page, pageSize: 50 });
      if (f.partnerId) params.set("partnerId", f.partnerId);
      if (f.campaignId) params.set("campaignId", f.campaignId);
      if (f.manufacturerId) params.set("manufacturerId", f.manufacturerId);
      if (f.status && f.status !== "all") params.set("status", f.status);
      if (f.search) params.set("search", f.search);
      const res = await axios.get(`${backendUrl}/api/marketing-cards/admin/cards?${params}`, { headers: { token } });
      setCards(res.data.cards || []);
      setCardTotal(res.data.total || 0);
      setCardTotalPages(res.data.totalPages || 1);
      setCardPage(res.data.page || 1);
    } catch (err) {
      toast.error(err.response?.data?.message || "Unable to load cards.");
    } finally { setCardsLoading(false); }
  }, [token, filters]);

  useEffect(() => { loadBase(); }, [loadBase]);
  useEffect(() => { if (tab === "tracker") loadCards(1, filters); }, [tab]); // eslint-disable-line

  // ── Campaigns filtered by partner ─────────────────────────────────────────
  const filteredCampaigns = useMemo(() =>
    filters.partnerId ? campaigns.filter((c) => c.marketingPartnerId === filters.partnerId) : campaigns,
    [campaigns, filters.partnerId]
  );

  // ── Tracker filter submit ─────────────────────────────────────────────────
  const applyFilters = () => { setCardPage(1); loadCards(1, filters); };

  // ── Deactivate campaign ───────────────────────────────────────────────────
  const handleDeactivateCampaign = async (campaignId, campaignName) => {
    if (!window.confirm(`Deactivate campaign "${campaignName}"?\n\nNo new cards can be attached to orders, but existing customer cards remain valid until their card expiry date.`)) return;
    setWorking(true);
    try {
      const res = await axios.patch(
        `${backendUrl}/api/marketing-cards/admin/campaigns/${campaignId}/deactivate`,
        {},
        { headers: { token } }
      );
      if (!res.data.success) throw new Error(res.data.message);
      toast.success(res.data.message);
      await loadBase();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Deactivation failed.");
    } finally { setWorking(false); }
  };

  const handleFilterChange = (key, value) => {
    const next = { ...filters, [key]: value };
    if (key === "partnerId") next.campaignId = ""; // reset campaign when partner changes
    setFilters(next);
  };

  // ── Invalidate ────────────────────────────────────────────────────────────
  const handleInvalidate = async (reason) => {
    setWorking(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/marketing-cards/admin/cards/invalidate`,
        { cardIds: [...selected], reason },
        { headers: { token } }
      );
      if (!res.data.success) throw new Error(res.data.message);
      toast.success(res.data.message);
      setShowInvalidate(false);
      setSelected(new Set());
      await Promise.all([loadCards(cardPage, filters), loadBase()]);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Invalidation failed.");
    } finally { setWorking(false); }
  };

  // ── Submit helper ─────────────────────────────────────────────────────────
  const submit = async (url, body, successMessage) => {
    setWorking(true);
    try {
      const res = await axios.post(`${backendUrl}${url}`, body, { headers: { token } });
      if (!res.data.success) throw new Error(res.data.message);
      toast.success(successMessage);
      await loadBase();
      return res.data;
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Operation failed.");
      return null;
    } finally { setWorking(false); }
  };

  const handleApprovePartner = async (partnerId) => {
    const code = approvalCodes[partnerId]?.trim();
    if (!code) return toast.error("Enter a permanent partner code before approving.");
    setWorking(true);
    try {
      const res = await axios.patch(
        `${backendUrl}/api/marketing-cards/admin/partners/${partnerId}/approve`,
        { code },
        { headers: { token } }
      );
      if (!res.data.success) throw new Error(res.data.message);
      toast.success("Partner approved and code assigned.");
      setApprovalCodes((prev) => ({ ...prev, [partnerId]: "" }));
      await loadBase();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Unable to approve partner.");
    } finally { setWorking(false); }
  };

  // ── Offer helpers ─────────────────────────────────────────────────────────
  const addOffer = () => setCampaign((prev) => ({ ...prev, offers: [...prev.offers, createDefaultOffer({ name: "", benefitType: "DISCOUNT", value: 5, allocationMode: "PERCENTAGE", percentage: 5 })] }));
  const removeOffer = (i) => setCampaign((prev) => ({ ...prev, offers: prev.offers.filter((_, idx) => idx !== i) }));
  const updateOffer = (i, field, value) => setCampaign((prev) => { const o = [...prev.offers]; o[i] = { ...o[i], [field]: value }; return { ...prev, offers: o }; });
  const loadExampleStrategy = () => {
    setCampaign((prev) => ({ ...prev, offers: [
      createDefaultOffer({ name: "10% Discount Voucher", benefitType: "DISCOUNT", value: 10, allocationMode: "PERCENTAGE", percentage: 10 }),
      createDefaultOffer({ name: "20% Super Discount", benefitType: "DISCOUNT", value: 20, allocationMode: "PERCENTAGE", percentage: 5 }),
      createDefaultOffer({ name: "Free Accessory (Rs 100)", benefitType: "GIFT", value: 100, allocationMode: "PERCENTAGE", percentage: 5 }),
    ] }));
    toast.info("Loaded example: 10%(10%), 20%(5%), Gift(5%), Better Luck(80%).");
  };

  const totalPct = campaign.offers.reduce((s, o) => s + (o.allocationMode === "PERCENTAGE" ? Number(o.percentage) || 0 : 0), 0);
  const luckPct = Math.max(0, 100 - totalPct);
  const selectedCampaignForBatch = campaigns.find((c) => c.id === batch.campaignId);

  const lifecycleMetrics = {
    ...(metrics?.physical || {}),
    DELIVERED: metrics?.delivered || 0,
    ACTIVATED: metrics?.activated || 0,
    REDEEMED: metrics?.redeemed || 0,
  };

  // ── Tracker helpers ───────────────────────────────────────────────────────
  const selectableIds = cards.filter((c) => c.physicalStatus !== "CANCELLED").map((c) => c.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allSelected) selectableIds.forEach((id) => next.delete(id));
    else selectableIds.forEach((id) => next.add(id));
    return next;
  });
  const toggleOne = (id) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Admin Control</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">Marketing Card Engine</h1>
          <p className="mt-1 text-sm text-slate-500">Full lifecycle tracking, invalidation, and distribution management.</p>
        </div>
        <button onClick={loadBase} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
          🔄 Refresh
        </button>
      </div>

      {/* Global lifecycle metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {["GENERATED", "ASSIGNED", "AVAILABLE", "ATTACHED", "DELIVERED", "ACTIVATED", "REDEEMED", "CANCELLED"].map((s) => (
          <div key={s} className={`rounded-xl border p-4 ${s === "CANCELLED" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{s}</p>
            <p className={`mt-2 text-xl font-black ${s === "CANCELLED" ? "text-red-700" : "text-slate-900"}`}>{fmt(lifecycleMetrics[s] || 0)}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
        {TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all ${tab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            {label}
          </button>
        ))}
      </div>

      {loading && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}

      {/* ══ OVERVIEW TAB ══════════════════════════════════════════════════════ */}
      {!loading && tab === "overview" && (
        <div className="space-y-6">

          {/* Partner breakdown */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-black text-slate-900">Marketing Partner Breakdown</h2>
                <p className="text-xs text-slate-500 mt-0.5">Cards printed & distributed per partner.</p>
              </div>
              <span className="text-xs text-slate-400">{(stats?.partnerBreakdown || []).length} partners</span>
            </div>
            {(stats?.partnerBreakdown || []).length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No partner data yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-5 py-3">Partner</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3 text-right">Total Cards</th>
                      <th className="px-5 py-3 text-right">Generated</th>
                      <th className="px-5 py-3 text-right">Assigned</th>
                      <th className="px-5 py-3 text-right">Available</th>
                      <th className="px-5 py-3 text-right">Attached</th>
                      <th className="px-5 py-3 text-right">Cancelled</th>
                      <th className="px-5 py-3">Distribution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(stats?.partnerBreakdown || []).map(({ partner, total, GENERATED, ASSIGNED, AVAILABLE, ATTACHED, CANCELLED }) => (
                      <tr key={partner.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3">
                          <p className="font-bold text-slate-800">{partner.name}</p>
                          <p className="text-slate-400 font-mono">{partner.code}</p>
                        </td>
                        <td className="px-5 py-3">
                          <Badge status={partner.status === "ACTIVE" ? "AVAILABLE" : "CANCELLED"} label={partner.status} />
                        </td>
                        <td className="px-5 py-3 text-right font-black text-slate-900">{fmt(total)}</td>
                        <td className="px-5 py-3 text-right text-slate-600">{fmt(GENERATED || 0)}</td>
                        <td className="px-5 py-3 text-right text-amber-700 font-bold">{fmt(ASSIGNED || 0)}</td>
                        <td className="px-5 py-3 text-right text-sky-700 font-bold">{fmt(AVAILABLE || 0)}</td>
                        <td className="px-5 py-3 text-right text-indigo-700 font-bold">{fmt(ATTACHED || 0)}</td>
                        <td className="px-5 py-3 text-right text-red-600 font-bold">{fmt(CANCELLED || 0)}</td>
                        <td className="px-5 py-3 min-w-[120px]">
                          <MiniBar value={ATTACHED || 0} total={total} color="bg-indigo-500" />
                          <MiniBar value={CANCELLED || 0} total={total} color="bg-red-400" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Pending partner approvals */}
          {(partners.filter((p) => p.status === "PENDING").length > 0) && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/50 shadow-sm overflow-hidden">
              <div className="border-b border-amber-200 px-5 py-4">
                <h2 className="text-sm font-black text-amber-950">Pending Partner Approvals</h2>
                <p className="text-xs text-amber-800 mt-0.5">Verify the business, assign a permanent code, and activate portal access.</p>
              </div>
              <div className="divide-y divide-amber-100">
                {partners.filter((p) => p.status === "PENDING").map((pendingPartner) => (
                  <div key={pendingPartner.id} className="flex flex-col md:flex-row md:items-center gap-3 px-5 py-4">
                    <div className="flex-1">
                      <p className="text-sm font-bold text-slate-900">{pendingPartner.name}</p>
                      <p className="text-xs text-slate-600">{pendingPartner.email || "No email"}</p>
                    </div>
                    <div className="flex gap-2 w-full md:w-auto">
                      <input
                        value={approvalCodes[pendingPartner.id] || ""}
                        onChange={(e) => setApprovalCodes((prev) => ({ ...prev, [pendingPartner.id]: e.target.value.toUpperCase() }))}
                        placeholder="Permanent code"
                        className="flex-1 md:w-44 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-mono uppercase"
                      />
                      <button type="button" disabled={working} onClick={() => handleApprovePartner(pendingPartner.id)} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50">Approve</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Campaign breakdown */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-black text-slate-900">Campaign Breakdown</h2>
              <p className="text-xs text-slate-500 mt-0.5">Active and inactive campaigns with card counts and offer config.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs text-left">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Campaign</th>
                    <th className="px-5 py-3">Partner</th>
                    <th className="px-5 py-3">Scope</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Generated</th>
                    <th className="px-5 py-3 text-right">Batches</th>
                    <th className="px-5 py-3">Offers</th>
                    <th className="px-5 py-3">Campaign End</th>
                    <th className="px-5 py-3">Card Expiry</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(stats?.campaignBreakdown || []).map((c) => {
                    const isActive = c.status === "ACTIVE";
                    const isExpired = c.endsAt && new Date() > new Date(c.endsAt);
                    const cardExpired = c.cardExpiresAt && new Date() > new Date(c.cardExpiresAt);
                    return (
                      <tr key={c.id} className={`hover:bg-slate-50/60 ${!isActive ? "opacity-60" : ""}`}>
                        <td className="px-5 py-3">
                          <p className="font-bold text-slate-800">{c.name}</p>
                          <p className="text-slate-400 font-mono text-[10px]">{c.id.slice(0, 8)}…</p>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{c.partner?.name || "—"}</td>
                        <td className="px-5 py-3">
                          <div className="text-[11px] font-bold text-slate-700">{c.targetScopeType}</div>
                          {c.targetProvince && <div className="text-[10px] text-slate-400">{c.targetProvince}</div>}
                          {c.targetDistrict && <div className="text-[10px] text-slate-400">{c.targetDistrict}</div>}
                        </td>
                        <td className="px-5 py-3">
                          <Badge status={isActive ? "AVAILABLE" : "CANCELLED"} label={c.status} />
                          {isActive && isExpired && <div className="text-[10px] text-amber-600 font-bold mt-0.5">⏰ Date expired</div>}
                        </td>
                        <td className="px-5 py-3 text-right font-black text-slate-900">{fmt(c.generatedQuantity)}</td>
                        <td className="px-5 py-3 text-right text-slate-500">{fmt(c.batchCount)}</td>
                        <td className="px-5 py-3">
                          {(c.benefits || []).length > 0 ? (
                            <div className="space-y-0.5">
                              {c.benefits.map((b) => (
                                <div key={b.id} className="text-[10px] text-slate-600">🎁 {b.name} <span className="text-slate-400">({b.assignedQuantity || 0} assigned)</span></div>
                              ))}
                            </div>
                          ) : <span className="text-slate-400 text-[10px]">No offers</span>}
                        </td>
                        <td className="px-5 py-3 text-[10px]">
                          {c.endsAt ? (
                            <span className={isExpired ? "text-red-600 font-bold" : "text-slate-600"}>
                              {new Date(c.endsAt).toLocaleDateString()}
                              {isExpired && " ⏰"}
                            </span>
                          ) : <span className="text-slate-300">No end date</span>}
                        </td>
                        <td className="px-5 py-3 text-[10px]">
                          {c.cardExpiresAt ? (
                            <span className={cardExpired ? "text-red-600 font-bold" : "text-emerald-700 font-bold"}>
                              {new Date(c.cardExpiresAt).toLocaleDateString()}
                              {cardExpired && " (expired)"}
                            </span>
                          ) : <span className="text-slate-300">No expiry</span>}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5">
                            {isActive && (
                              <button
                                disabled={working}
                                onClick={() => handleDeactivateCampaign(c.id, c.name)}
                                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                              >
                                Deactivate
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Manufacturer breakdown */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-black text-slate-900">Manufacturer Card Inventory</h2>
              <p className="text-xs text-slate-500 mt-0.5">Which manufacturer has how many cards, and their status.</p>
            </div>
            {(stats?.manufacturerBreakdown || []).length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No cards assigned to manufacturers yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-5 py-3">Manufacturer</th>
                      <th className="px-5 py-3 text-right">Total Assigned</th>
                      <th className="px-5 py-3 text-right">Assigned (Pending)</th>
                      <th className="px-5 py-3 text-right">Available</th>
                      <th className="px-5 py-3 text-right">Attached</th>
                      <th className="px-5 py-3 text-right">Cancelled</th>
                      <th className="px-5 py-3">Utilization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(stats?.manufacturerBreakdown || []).map(({ manufacturer, total, ASSIGNED, AVAILABLE, ATTACHED, CANCELLED }) => (
                      <tr key={manufacturer.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3">
                          <p className="font-bold text-slate-800">{manufacturer.name}</p>
                          <p className="text-slate-400 text-[10px]">{manufacturer.city || "—"}</p>
                        </td>
                        <td className="px-5 py-3 text-right font-black text-slate-900">{fmt(total)}</td>
                        <td className="px-5 py-3 text-right text-amber-700 font-bold">{fmt(ASSIGNED || 0)}</td>
                        <td className="px-5 py-3 text-right text-sky-700 font-bold">{fmt(AVAILABLE || 0)}</td>
                        <td className="px-5 py-3 text-right text-indigo-700 font-bold">{fmt(ATTACHED || 0)}</td>
                        <td className="px-5 py-3 text-right text-red-600 font-bold">{fmt(CANCELLED || 0)}</td>
                        <td className="px-5 py-3 min-w-[120px]">
                          <div className="text-[10px] text-slate-500 mb-1">{pct(ATTACHED || 0, total)} attached</div>
                          <MiniBar value={ATTACHED || 0} total={total} color="bg-indigo-500" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ══ TRACKER TAB ═══════════════════════════════════════════════════════ */}
      {!loading && tab === "tracker" && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Filter Cards</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {/* Partner filter */}
              <select
                value={filters.partnerId}
                onChange={(e) => handleFilterChange("partnerId", e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">All Partners</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>

              {/* Campaign filter (only after partner) */}
              <select
                value={filters.campaignId}
                onChange={(e) => handleFilterChange("campaignId", e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                disabled={!filters.partnerId}
              >
                <option value="">{filters.partnerId ? "All Campaigns" : "Select partner first"}</option>
                {filteredCampaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
              </select>

              {/* Manufacturer filter */}
              <select
                value={filters.manufacturerId}
                onChange={(e) => handleFilterChange("manufacturerId", e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">All Manufacturers</option>
                {manufacturers.filter((m) => m.isActive).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>

              {/* Status filter */}
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange("status", e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {["all", "GENERATED", "ASSIGNED", "AVAILABLE", "ATTACHED", "CANCELLED"].map((s) => (
                  <option key={s} value={s}>{s === "all" ? "All Statuses" : s}</option>
                ))}
              </select>

              {/* Search */}
              <div className="flex gap-2 lg:col-span-1">
                <input
                  value={filters.search}
                  onChange={(e) => handleFilterChange("search", e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  placeholder="Search card code…"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <button onClick={applyFilters} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
                  Search
                </button>
              </div>
            </div>
          </div>

          {/* Results summary */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {cardsLoading ? "Loading…" : <><span className="font-bold text-slate-800">{fmt(cardTotal)}</span> cards found</>}
              {selected.size > 0 && <span className="ml-2 font-bold text-red-700">· {selected.size} selected</span>}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const toPrint = selected.size > 0 ? cards.filter((c) => selected.has(c.id)) : cards;
                  if (!toPrint.length) return toast.info("No cards to print.");
                  const fCard = toPrint[0];
                  setPrintModalData({
                    isOpen: true,
                    batchCode: fCard?.batch?.batchCode || "BATCH",
                    partnerName: fCard?.campaign?.marketingPartner?.name || "Brand Partner",
                    campaignName: fCard?.campaign?.name || "Campaign Cards",
                    campaignScope: fCard?.campaign?.targetScopeType || "Nationwide",
                    cardExpiresAt: fCard?.campaign?.cardExpiresAt || null,
                    cards: toPrint,
                  });
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-50 flex items-center gap-1.5 shadow-sm"
              >
                🖨️ Print Sheet ({selected.size > 0 ? `${selected.size} Selected` : `${cards.length} Cards`})
              </button>
              {selected.size > 0 && (
                <button
                  onClick={() => setShowInvalidate(true)}
                  className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
                >
                  ⚠️ Invalidate {selected.size} Selected
                </button>
              )}
            </div>
          </div>

          {/* Card table */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {cardsLoading ? (
              <p className="p-6 text-sm text-slate-500">Loading cards…</p>
            ) : cards.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No cards match your filters.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs text-left">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="px-4 py-3">
                          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 cursor-pointer rounded accent-slate-800" />
                        </th>
                        <th className="px-4 py-3">Card Code</th>
                        <th className="px-4 py-3">Partner / Campaign</th>
                        <th className="px-4 py-3">Scope</th>
                        <th className="px-4 py-3">Manufacturer</th>
                        <th className="px-4 py-3">Benefit / Offer</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {cards.map((card) => {
                        const selectable = card.physicalStatus !== "CANCELLED";
                        const isChecked = selected.has(card.id);
                        return (
                          <tr key={card.id} className={`${isChecked ? "bg-red-50/60" : "hover:bg-slate-50/60"} ${selectable ? "cursor-pointer" : ""}`}
                            onClick={() => selectable && toggleOne(card.id)}>
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              {selectable ? (
                                <input type="checkbox" checked={isChecked} onChange={() => toggleOne(card.id)} className="h-4 w-4 cursor-pointer rounded accent-slate-800" />
                              ) : (
                                <span className="inline-block h-4 w-4 rounded border border-slate-200 bg-slate-100" title="Already cancelled" />
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono font-bold text-slate-800">{card.cardCode}</td>
                            <td className="px-4 py-3">
                              <p className="font-bold text-slate-800">{card.campaign?.marketingPartner?.name || "—"}</p>
                              <p className="text-slate-500">{card.campaign?.name || "—"}</p>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{card.campaign?.targetScopeType || "—"}</td>
                            <td className="px-4 py-3 text-slate-600">{card.assignedManufacturer?.name || <span className="text-slate-300">Unassigned</span>}</td>
                            <td className="px-4 py-3">
                              {card.hasBenefit && card.benefit ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                  🎁 {card.benefit.name}
                                </span>
                              ) : (
                                <span className="text-slate-300 text-[10px]">Better luck next time</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <Badge status={card.physicalStatus} />
                            </td>
                            <td className="px-4 py-3 text-slate-400">{new Date(card.createdAt).toLocaleDateString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Paginator page={cardPage} totalPages={cardTotalPages} onPage={(p) => { setCardPage(p); loadCards(p, filters); }} />
              </>
            )}
          </div>
        </div>
      )}

      {/* ══ SETUP TAB ════════════════════════════════════════════════════════ */}
      {!loading && tab === "setup" && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left column: Partner + Generate */}
            <div className="lg:col-span-4 space-y-6">
              {/* 1. Create Partner */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-black text-slate-900">1. Create Partner</h2>
                <p className="mt-0.5 text-xs text-slate-500">Create an active partner with initial login credentials.</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-500">Partner Code (3–6 chars)</label>
                    <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase" placeholder="e.g. NIKE, AAMA, REDB" value={partner.code} onChange={(e) => setPartner({ ...partner, code: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-500">Partner Name</label>
                    <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="e.g. Nike Nepal, RedBull" value={partner.name} onChange={(e) => setPartner({ ...partner, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-500">Login Email</label>
                    <input type="email" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="partner@company.com" value={partner.email} onChange={(e) => setPartner({ ...partner, email: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-500">Initial Password</label>
                    <input type="password" minLength="8" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="At least 8 characters" value={partner.password} onChange={(e) => setPartner({ ...partner, password: e.target.value })} />
                  </div>
                  <button disabled={working} onClick={async () => { const r = await submit("/api/marketing-cards/admin/partners", partner, "Partner created."); if (r) setPartner(emptyPartner); }} className="w-full rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">Create partner</button>
                </div>
              </section>

              {/* 3. Generate Inventory */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-black text-slate-900">3. Generate Inventory &amp; Print QR</h2>
                <p className="mt-0.5 text-xs text-slate-500">Generates batch with randomly shuffled prize cards.</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-500">Select Campaign</label>
                    <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={batch.campaignId} onChange={(e) => setBatch({ ...batch, campaignId: e.target.value })}>
                      <option value="">-- Choose Campaign --</option>
                      {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.marketingPartner?.name || "Partner"})</option>)}
                    </select>
                  </div>
                  {selectedCampaignForBatch && (
                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-200 text-xs space-y-1.5">
                      <p className="font-bold text-slate-800">Distribution for this campaign:</p>
                      {(selectedCampaignForBatch.benefits || []).length > 0 ? selectedCampaignForBatch.benefits.map((b, i) => (
                        <div key={b.id || i} className="flex justify-between text-slate-600">
                          <span>🎁 {b.name}:</span>
                          <span className="font-bold text-amber-700">{b.percentage ? `${b.percentage}% (~${Math.round((b.percentage / 100) * (batch.quantity || 0))} cards)` : `${b.quantity} cards`}</span>
                        </div>
                      )) : <p className="text-slate-400 italic">No specific offers configured.</p>}
                      <div className="flex justify-between pt-1 border-t border-slate-200 font-bold text-slate-700">
                        <span>🍀 "Better luck next time":</span>
                        <span className="text-slate-500">Remainder of {batch.quantity || 0} cards</span>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-500">Number of Cards</label>
                    <input type="number" min="1" max="5000" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono font-bold" value={batch.quantity} onChange={(e) => setBatch({ ...batch, quantity: Number(e.target.value) })} />
                  </div>
                  <button disabled={working || !batch.campaignId} onClick={async () => {
                    const r = await submit("/api/marketing-cards/admin/batches", batch, `Generated ${batch.quantity} cards.`);
                    if (r) {
                      const selCampaign = campaigns.find((c) => c.id === batch.campaignId);
                      setPrintModalData({
                        isOpen: true,
                        batchCode: r.batch.batchCode,
                        partnerName: selCampaign?.marketingPartner?.name || "Brand Partner",
                        campaignName: selCampaign?.name || "Marketing Campaign",
                        campaignScope: selCampaign?.targetScopeType || "Nationwide",
                        cardExpiresAt: selCampaign?.cardExpiresAt || null,
                        cards: r.cards || [],
                      });
                      setBatch({ campaignId: "", quantity: 500 });
                    }
                  }} className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">
                    🖨️ Generate Cards &amp; Open Print Sheet
                  </button>
                </div>
              </section>

              {/* 4. Assign to Manufacturer */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-black text-slate-900">4. Assign Cards to Manufacturer</h2>
                <p className="mt-0.5 text-xs text-slate-500">Allocate generated cards to manufacturing hubs.</p>
                <div className="mt-4 space-y-3">
                  <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={assignment.campaignId} onChange={(e) => setAssignment({ ...assignment, campaignId: e.target.value })}>
                    <option value="">Select campaign</option>
                    {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={assignment.manufacturerId} onChange={(e) => setAssignment({ ...assignment, manufacturerId: e.target.value })}>
                    <option value="">Select manufacturer</option>
                    {manufacturers.filter((m) => m.isActive).map((m) => <option key={m.id} value={m.id}>{m.name} – {m.city}</option>)}
                  </select>
                  <input type="number" min="1" max="5000" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono" value={assignment.quantity} onChange={(e) => setAssignment({ ...assignment, quantity: Number(e.target.value) })} />
                  <button disabled={working} onClick={async () => { const r = await submit("/api/marketing-cards/admin/assignments", assignment, "Cards assigned."); if (r) setAssignment({ ...assignment, quantity: 1 }); }} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Assign cards</button>
                </div>
              </section>
            </div>

            {/* Right column: Campaign builder */}
            <div className="lg:col-span-8">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-sm font-black text-slate-900">2. Create Campaign &amp; Configure Custom Offers</h2>
                    <p className="mt-0.5 text-xs text-slate-500">Define discount tiers, gifts, and random distribution probabilities.</p>
                  </div>
                  <button type="button" onClick={loadExampleStrategy} className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100">
                    ⚡ Load Example Strategy
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  {/* Basic info */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-[11px] font-bold uppercase text-slate-500">Partner</label>
                      <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={campaign.marketingPartnerId} onChange={(e) => setCampaign({ ...campaign, marketingPartnerId: e.target.value })}>
                        <option value="">Select partner</option>
                        {partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-bold uppercase text-slate-500">Campaign Name</label>
                      <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="e.g. Dashain Mega Offer 2083" value={campaign.name} onChange={(e) => setCampaign({ ...campaign, name: e.target.value })} />
                    </div>
                  </div>

                  {/* Geographic targeting */}
                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Geographic Targeting</p>
                      <span className="text-[11px] text-slate-400">District 5 : Province 3 : Nation 2 weighting</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="text-[11px] font-bold uppercase text-slate-500">Scope Type</label>
                        <select className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={campaign.targetScopeType}
                          onChange={(e) => { const s = e.target.value; setCampaign({ ...campaign, targetScopeType: s, targetProvince: s === "NATIONWIDE" ? "" : campaign.targetProvince, targetDistrict: s === "DISTRICT" ? campaign.targetDistrict : "" }); }}>
                          <option value="NATIONWIDE">NATIONWIDE</option>
                          <option value="PROVINCE">PROVINCE WISE</option>
                          <option value="DISTRICT">DISTRICT WISE</option>
                        </select>
                      </div>
                      {(campaign.targetScopeType === "PROVINCE" || campaign.targetScopeType === "DISTRICT") && (
                        <div>
                          <label className="text-[11px] font-bold uppercase text-slate-500">Target Province</label>
                          <select className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={campaign.targetProvince || ""}
                            onChange={(e) => { const p = e.target.value; const allowed = DISTRICTS_BY_PROVINCE[p] || []; setCampaign({ ...campaign, targetProvince: p, targetDistrict: allowed.includes(campaign.targetDistrict) ? campaign.targetDistrict : "" }); }}>
                            <option value="">-- Select Province --</option>
                            {NEPAL_PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      )}
                      {campaign.targetScopeType === "DISTRICT" && (
                        <div>
                          <label className="text-[11px] font-bold uppercase text-slate-500">Target District</label>
                          <select className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={campaign.targetDistrict || ""}
                            onChange={(e) => { const d = e.target.value; let prov = campaign.targetProvince; if (!prov && d) { for (const [pName, dList] of Object.entries(DISTRICTS_BY_PROVINCE)) { if (dList.includes(d)) { prov = pName; break; } } } setCampaign({ ...campaign, targetProvince: prov, targetDistrict: d }); }}>
                            <option value="">{campaign.targetProvince ? `-- District in ${campaign.targetProvince} --` : "-- Select District --"}</option>
                            {(campaign.targetProvince ? DISTRICTS_BY_PROVINCE[campaign.targetProvince] || [] : ALL_DISTRICTS).map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Offer builder */}
                  <div className="space-y-3 pt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">Custom Offers &amp; Prize Distribution</h3>
                        <p className="text-[11px] text-slate-500">Configure winning probability for each offer in any generated batch.</p>
                      </div>
                      <button type="button" onClick={addOffer} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 flex items-center gap-1">+ Add Offer</button>
                    </div>

                    {/* Distribution bar */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className="text-slate-700">Winning Share: <span className={totalPct > 100 ? "text-rose-600" : "text-emerald-700"}>{totalPct}%</span></span>
                        <span className="text-slate-500">🍀 No-Prize: <span className="text-slate-800">{luckPct}%</span></span>
                      </div>
                      <div className="h-4 w-full overflow-hidden rounded-full bg-slate-200 flex">
                        {campaign.offers.map((o, i) => {
                          const p = o.allocationMode === "PERCENTAGE" ? Number(o.percentage) || 0 : 0;
                          if (p <= 0) return null;
                          const colors = ["bg-amber-500", "bg-indigo-500", "bg-emerald-500", "bg-purple-500", "bg-pink-500"];
                          return <div key={o.id || i} style={{ width: `${Math.min(100, p)}%` }} className={`${colors[i % 5]} flex items-center justify-center text-[9px] font-bold text-white`} title={`${o.name || `Offer ${i + 1}`}: ${p}%`}>{p >= 5 ? `${p}%` : ""}</div>;
                        })}
                        {luckPct > 0 && <div style={{ width: `${luckPct}%` }} className="bg-slate-300 flex items-center justify-center text-[9px] font-bold text-slate-600">{luckPct >= 10 ? `${luckPct}% No-Prize` : ""}</div>}
                      </div>
                      {totalPct > 100 && <p className="text-[11px] font-bold text-rose-600">⚠️ Total percentage exceeds 100%. Adjust offer percentages.</p>}
                    </div>

                    {/* Offer cards */}
                    <div className="space-y-3">
                      {campaign.offers.map((offer, index) => (
                        <div key={offer.id || index} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[11px] font-black text-amber-800">{index + 1}</span>
                              <span className="text-xs font-bold text-slate-800">Offer #{index + 1}</span>
                            </div>
                            {campaign.offers.length > 1 && <button type="button" onClick={() => removeOffer(index)} className="text-xs text-rose-500 hover:text-rose-700 font-bold">Remove</button>}
                          </div>
                          <div className="grid gap-3 sm:grid-cols-12">
                            <div className="sm:col-span-6">
                              <label className="text-[11px] font-bold uppercase text-slate-500">Offer Name</label>
                              <input required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="e.g. 10% Discount Voucher" value={offer.name} onChange={(e) => updateOffer(index, "name", e.target.value)} />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="text-[11px] font-bold uppercase text-slate-500">Benefit Type</label>
                              <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={offer.benefitType} onChange={(e) => updateOffer(index, "benefitType", e.target.value)}>
                                <option value="DISCOUNT">DISCOUNT (%)</option>
                                <option value="VOUCHER">VOUCHER (Rs)</option>
                                <option value="GIFT">FREE GIFT</option>
                                <option value="CUSTOM">CUSTOM</option>
                              </select>
                            </div>
                            <div className="sm:col-span-3">
                              <label className="text-[11px] font-bold uppercase text-slate-500">Reward Value</label>
                              <input type="number" min="0" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={offer.value} onChange={(e) => updateOffer(index, "value", Number(e.target.value))} />
                            </div>
                            <div className="sm:col-span-4">
                              <label className="text-[11px] font-bold uppercase text-slate-500">Distribution Mode</label>
                              <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={offer.allocationMode} onChange={(e) => updateOffer(index, "allocationMode", e.target.value)}>
                                <option value="PERCENTAGE">Percentage of Cards (%)</option>
                                <option value="QUANTITY">Fixed Number of Cards</option>
                              </select>
                            </div>
                            <div className="sm:col-span-4">
                              <label className="text-[11px] font-bold uppercase text-slate-500">{offer.allocationMode === "PERCENTAGE" ? "Card Share (%)" : "Cards Count"}</label>
                              <input type="number" min="0" max={offer.allocationMode === "PERCENTAGE" ? 100 : 5000} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold"
                                value={offer.allocationMode === "PERCENTAGE" ? offer.percentage : offer.quantity}
                                onChange={(e) => { const v = Number(e.target.value); updateOffer(index, offer.allocationMode === "PERCENTAGE" ? "percentage" : "quantity", v); }} />
                            </div>
                            <div className="sm:col-span-4">
                              <label className="text-[11px] font-bold uppercase text-slate-500">Example (per 500 batch)</label>
                              <div className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 border border-slate-100">
                                {offer.allocationMode === "PERCENTAGE" ? `~${Math.round(((offer.percentage || 0) / 100) * 500)} cards` : `${offer.quantity || 0} cards total`}
                              </div>
                            </div>
                            <div className="sm:col-span-6">
                              <label className="text-[11px] font-bold uppercase text-slate-500">Description (Optional)</label>
                              <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="e.g. Valid on all winter jackets" value={offer.description} onChange={(e) => updateOffer(index, "description", e.target.value)} />
                            </div>
                            <div className="sm:col-span-6">
                              <label className="text-[11px] font-bold uppercase text-slate-500">Terms &amp; Expiration</label>
                              <div className="mt-1 grid grid-cols-2 gap-2">
                                <input className="rounded-lg border border-slate-200 px-3 py-2 text-xs" placeholder="Terms" value={offer.terms} onChange={(e) => updateOffer(index, "terms", e.target.value)} />
                                <input type="date" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" value={offer.expiresAt} onChange={(e) => updateOffer(index, "expiresAt", e.target.value)} />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Campaign dates */}
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Campaign &amp; Card Dates</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-[11px] font-bold uppercase text-slate-500">Campaign End Date</label>
                        <p className="text-[10px] text-slate-400 mb-1">After this date, no new cards can be attached to orders.</p>
                        <input
                          type="date"
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                          value={campaign.endsAt}
                          onChange={(e) => setCampaign({ ...campaign, endsAt: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold uppercase text-slate-500">Card Expiry Date <span className="text-amber-600">*</span></label>
                        <p className="text-[10px] text-slate-400 mb-1">Must be ≥ 1 day after campaign end. Customers can still redeem until this date.</p>
                        <input
                          type="date"
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                          min={campaign.endsAt ? new Date(new Date(campaign.endsAt).getTime() + 86400000).toISOString().split("T")[0] : ""}
                          value={campaign.cardExpiresAt}
                          onChange={(e) => setCampaign({ ...campaign, cardExpiresAt: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Sponsor Ad / Promo Interstitial */}
                  <div className="rounded-xl bg-indigo-50/70 border border-indigo-200 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-black uppercase tracking-wider text-indigo-900">
                        🎬 Sponsor Ad / Promo Media (Shown to Customer Before QR Scan)
                      </p>
                      <span className="text-[10px] text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded font-bold">Optional Ad Placement</span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-12">
                      <div className="sm:col-span-4">
                        <label className="text-[11px] font-bold uppercase text-slate-500">Ad Format</label>
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
                          value={campaign.adMediaType}
                          onChange={(e) => setCampaign({ ...campaign, adMediaType: e.target.value })}
                        >
                          <option value="NONE">None (Direct QR Scan)</option>
                          <option value="IMAGE">Image Banner (Photo / Poster)</option>
                          <option value="VIDEO">Video Teaser (MP4 / Short Ad)</option>
                        </select>
                      </div>

                      {campaign.adMediaType !== "NONE" && (
                        <>
                          <div className="sm:col-span-8">
                            <label className="text-[11px] font-bold uppercase text-slate-500">Media URL (Photo / Video Direct Link)</label>
                            <input
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono"
                              placeholder="https://res.cloudinary.com/.../promo.mp4 or banner.jpg"
                              value={campaign.adMediaUrl}
                              onChange={(e) => setCampaign({ ...campaign, adMediaUrl: e.target.value })}
                            />
                          </div>
                          <div className="sm:col-span-6">
                            <label className="text-[11px] font-bold uppercase text-slate-500">Ad Headline</label>
                            <input
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              placeholder="e.g. Exclusive styling perks at our flagship salon!"
                              value={campaign.adHeadline}
                              onChange={(e) => setCampaign({ ...campaign, adHeadline: e.target.value })}
                            />
                          </div>
                          <div className="sm:col-span-6">
                            <label className="text-[11px] font-bold uppercase text-slate-500">External Store / Web Link</label>
                            <input
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              placeholder="https://partnerbrand.com"
                              value={campaign.adExternalLink}
                              onChange={(e) => setCampaign({ ...campaign, adExternalLink: e.target.value })}
                            />
                          </div>
                          <div className="sm:col-span-12">
                            <label className="text-[11px] font-bold uppercase text-slate-500">Ad Description / Call to Action</label>
                            <textarea
                              rows={2}
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              placeholder="Brief message introducing the partner reward to the customer..."
                              value={campaign.adDescription}
                              onChange={(e) => setCampaign({ ...campaign, adDescription: e.target.value })}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Submit campaign */}
                  <button disabled={working}
                    onClick={async () => {
                      if (!campaign.marketingPartnerId) return toast.error("Please select a partner.");
                      if (!campaign.name.trim()) return toast.error("Please enter a campaign name.");
                      if (campaign.targetScopeType === "PROVINCE" && !campaign.targetProvince) return toast.error("Please select a target province.");
                      if (campaign.targetScopeType === "DISTRICT" && !campaign.targetDistrict) return toast.error("Please select a target district.");
                      if (campaign.offers.length === 0 || campaign.offers.some((o) => !o.name.trim())) return toast.error("Please name all offers.");
                      if (totalPct > 100) return toast.error("Total percentage cannot exceed 100%.");
                      // Date validation
                      if (campaign.endsAt && campaign.cardExpiresAt) {
                        const end = new Date(campaign.endsAt);
                        const expiry = new Date(campaign.cardExpiresAt);
                        const minExpiry = new Date(end.getTime() + 86400000);
                        if (expiry < minExpiry) return toast.error("Card expiry date must be at least 1 day after the campaign end date.");
                      }
                      const formattedBenefits = campaign.offers.map((o) => ({ name: o.name.trim(), description: o.description || null, benefitType: o.benefitType, value: Number(o.value || 0), percentage: o.allocationMode === "PERCENTAGE" ? Number(o.percentage || 0) : 0, quantity: o.allocationMode === "QUANTITY" ? Number(o.quantity || 0) : 0, terms: o.terms || null, expiresAt: o.expiresAt || null }));
                      const payload = {
                        marketingPartnerId: campaign.marketingPartnerId,
                        name: campaign.name.trim(),
                        targetScopeType: campaign.targetScopeType,
                        targetProvince: campaign.targetScopeType === "NATIONWIDE" ? null : campaign.targetProvince,
                        targetDistrict: campaign.targetScopeType === "DISTRICT" ? campaign.targetDistrict : null,
                        endsAt: campaign.endsAt || null,
                        cardExpiresAt: campaign.cardExpiresAt || null,
                        adMediaType: campaign.adMediaType || "NONE",
                        adMediaUrl: campaign.adMediaUrl || null,
                        adHeadline: campaign.adHeadline || null,
                        adDescription: campaign.adDescription || null,
                        adExternalLink: campaign.adExternalLink || null,
                        benefits: formattedBenefits,
                      };
                      const r = await submit("/api/marketing-cards/admin/campaigns", payload, `Campaign created with ${formattedBenefits.length} offer(s).`);
                      if (r) setCampaign(createInitialCampaign());
                    }}
                    className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50">
                    Create Campaign with Configured Offers
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Invalidate modal */}
      {showInvalidate && (
        <InvalidateModal count={selected.size} working={working} onConfirm={handleInvalidate} onClose={() => !working && setShowInvalidate(false)} />
      )}

      {/* Print Sheet Modal */}
      {printModalData.isOpen && (
        <PrintSheetModal
          {...printModalData}
          onClose={() => setPrintModalData((prev) => ({ ...prev, isOpen: false }))}
        />
      )}
    </div>
  );
};

export default MarketingCards;
