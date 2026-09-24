/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import QRCode from "qrcode";
import { toast } from "react-toastify";
import { backendUrl } from "../App";
import {
  NEPAL_PROVINCES,
  DISTRICTS_BY_PROVINCE,
  ALL_DISTRICTS,
} from "../data/nepalLocations";

const createDefaultOffer = (overrides = {}) => ({
  id: Date.now() + Math.random(),
  name: "",
  description: "",
  benefitType: "DISCOUNT",
  value: 10,
  allocationMode: "PERCENTAGE", // "PERCENTAGE" or "QUANTITY"
  percentage: 10,
  quantity: 20,
  terms: "",
  expiresAt: "",
  ...overrides,
});

const emptyPartner = { code: "", name: "", description: "" };

const createInitialCampaign = () => ({
  marketingPartnerId: "",
  name: "",
  targetScopeType: "NATIONWIDE",
  targetProvince: "",
  targetDistrict: "",
  requestedQuantity: 0,
  offers: [
    createDefaultOffer({
      name: "10% Discount Voucher",
      description: "10% discount on orders",
      benefitType: "DISCOUNT",
      value: 10,
      allocationMode: "PERCENTAGE",
      percentage: 10,
    }),
  ],
});

const MarketingCards = ({ token }) => {
  const [partners, setPartners] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [manufacturers, setManufacturers] = useState([]);
  const [cards, setCards] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [partner, setPartner] = useState(emptyPartner);
  const [campaign, setCampaign] = useState(createInitialCampaign);
  const [batch, setBatch] = useState({ campaignId: "", quantity: 500 });
  const [assignment, setAssignment] = useState({ campaignId: "", manufacturerId: "", quantity: 1 });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [partnerRes, campaignRes, manufacturerRes, cardRes, metricsRes] = await Promise.all([
        axios.get(`${backendUrl}/api/marketing-cards/admin/partners`, { headers: { token } }),
        axios.get(`${backendUrl}/api/marketing-cards/admin/campaigns`, { headers: { token } }),
        axios.get(`${backendUrl}/api/manufacturer/admin/list`, { headers: { token } }),
        axios.get(`${backendUrl}/api/marketing-cards/admin/cards?status=all`, { headers: { token } }),
        axios.get(`${backendUrl}/api/marketing-cards/admin/metrics`, { headers: { token } }),
      ]);
      setPartners(partnerRes.data.partners || []);
      setCampaigns(campaignRes.data.campaigns || []);
      setManufacturers(manufacturerRes.data.manufacturers || []);
      setCards(cardRes.data.cards || []);
      setMetrics(metricsRes.data.metrics || null);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load marketing card data.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const submit = async (url, body, successMessage) => {
    setWorking(true);
    try {
      const response = await axios.post(`${backendUrl}${url}`, body, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message);
      toast.success(successMessage);
      await load();
      return response.data;
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Operation failed.");
      return null;
    } finally { setWorking(false); }
  };

  const exportBatchForPrint = async (result) => {
    const rows = (result.cards || []).map((card) => [result.batch.batchCode, card.cardCode, card.qrToken]);
    const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = ["batchCode,cardCode,qrToken", ...rows.map((row) => row.map(escapeCsv).join(","))].join("\n");
    const download = (content, filename, type) => {
      const url = window.URL.createObjectURL(new Blob([content], { type }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    };
    download(csv, `${result.batch.batchCode}-print-data.csv`, "text/csv;charset=utf-8");

    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]));
    const printableCards = await Promise.all((result.cards || []).map(async (card) => ({
      cardCode: escapeHtml(card.cardCode),
      qrDataUrl: await QRCode.toDataURL(card.qrToken, { errorCorrectionLevel: "M", margin: 1, width: 220 }),
    })));
    const printSheet = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(result.batch.batchCode)} Marketing Cards</title><style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;color:#111;margin:0}.sheet{display:grid;grid-template-columns:repeat(2,1fr);gap:10mm}.card{break-inside:avoid;border:1px solid #111;padding:8mm;text-align:center;min-height:72mm}.card img{width:42mm;height:42mm}.code{font:700 14px monospace;margin-top:5mm;letter-spacing:.5px}.batch{font-size:9px;color:#555;margin-top:2mm}</style></head><body><div class="sheet">${printableCards.map((card) => `<section class="card"><img src="${card.qrDataUrl}" alt="QR code for ${card.cardCode}"><div class="code">${card.cardCode}</div><div class="batch">${escapeHtml(result.batch.batchCode)}</div></section>`).join("")}</div></body></html>`;
    download(printSheet, `${result.batch.batchCode}-print-sheet.html`, "text/html;charset=utf-8");
  };

  // Offer management helpers
  const addOffer = () => {
    setCampaign((prev) => ({
      ...prev,
      offers: [
        ...prev.offers,
        createDefaultOffer({
          name: "",
          description: "",
          benefitType: "DISCOUNT",
          value: 5,
          allocationMode: "PERCENTAGE",
          percentage: 5,
        }),
      ],
    }));
  };

  const removeOffer = (index) => {
    setCampaign((prev) => ({
      ...prev,
      offers: prev.offers.filter((_, i) => i !== index),
    }));
  };

  const updateOffer = (index, field, value) => {
    setCampaign((prev) => {
      const nextOffers = [...prev.offers];
      nextOffers[index] = { ...nextOffers[index], [field]: value };
      return { ...prev, offers: nextOffers };
    });
  };

  const loadExampleStrategy = () => {
    setCampaign((prev) => ({
      ...prev,
      offers: [
        createDefaultOffer({
          name: "10% Discount Voucher",
          description: "10% off entire order",
          benefitType: "DISCOUNT",
          value: 10,
          allocationMode: "PERCENTAGE",
          percentage: 10,
        }),
        createDefaultOffer({
          name: "20% Super Discount Voucher",
          description: "20% off entire order",
          benefitType: "DISCOUNT",
          value: 20,
          allocationMode: "PERCENTAGE",
          percentage: 5,
        }),
        createDefaultOffer({
          name: "Free Accessory Gift (Worth Rs 100)",
          description: "Complimentary accessory item included",
          benefitType: "GIFT",
          value: 100,
          allocationMode: "PERCENTAGE",
          percentage: 5,
        }),
      ],
    }));
    toast.info("Loaded example multi-offer strategy: 10% (10%), 20% (5%), Free Gift (5%), Better Luck (80%).");
  };

  // Distribution calculations
  const totalPercentageAllocated = campaign.offers.reduce((acc, offer) => {
    if (offer.allocationMode === "PERCENTAGE") {
      return acc + (Number(offer.percentage) || 0);
    }
    return acc;
  }, 0);

  const betterLuckPercentage = Math.max(0, 100 - totalPercentageAllocated);

  const selectedCampaignForBatch = campaigns.find((c) => c.id === batch.campaignId);

  const summary = cards.reduce((result, card) => {
    result[card.physicalStatus] = (result[card.physicalStatus] || 0) + 1;
    return result;
  }, {});
  const lifecycleMetrics = {
    ...summary,
    ...(metrics?.physical || {}),
    ASSIGNED: metrics?.physical?.ASSIGNED || metrics?.assigned || 0,
    RECEIVED: metrics?.physical?.RECEIVED || metrics?.received || 0,
    ATTACHED: metrics?.physical?.ATTACHED || metrics?.attached || 0,
    DELIVERED: metrics?.delivered || 0,
    ACTIVATED: metrics?.activated || 0,
    REDEEMED: metrics?.redeemed || 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Marketing Partners</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">Card &amp; Offer Distribution Engine</h1>
        <p className="mt-1 text-sm text-slate-500">Create multi-tier custom offers (e.g. 10% discount to 10%, 20% to 5%, Free gift to 5%, remaining 80% better luck next time) with random card distribution.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {["GENERATED", "ASSIGNED", "RECEIVED", "AVAILABLE", "ATTACHED", "DELIVERED", "ACTIVATED", "REDEEMED"].map((status) => (
          <div key={status} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{status}</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{lifecycleMetrics[status] || 0}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Step 1: Create Partner */}
        <div className="lg:col-span-4 space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-black text-slate-900">1. Create Partner</h2>
            <p className="mt-0.5 text-xs text-slate-500">Register brand partner before creating campaigns.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] font-bold uppercase text-slate-500">Partner Code (3-6 chars)</label>
                <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase" placeholder="e.g. NIKE, AAMA, REDB" value={partner.code} onChange={(e) => setPartner({ ...partner, code: e.target.value })} />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-slate-500">Partner Name</label>
                <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="e.g. Nike Nepal, RedBull" value={partner.name} onChange={(e) => setPartner({ ...partner, name: e.target.value })} />
              </div>
              <button disabled={working} onClick={async () => { const result = await submit("/api/marketing-cards/admin/partners", partner, "Partner created."); if (result) setPartner(emptyPartner); }} className="w-full rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">Create partner</button>
            </div>
          </section>

          {/* Step 3: Generate Inventory */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-black text-slate-900">3. Generate Inventory &amp; Print QR</h2>
            <p className="mt-0.5 text-xs text-slate-500">Generates batch with randomly shuffled prize cards.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] font-bold uppercase text-slate-500">Select Campaign</label>
                <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={batch.campaignId} onChange={(e) => setBatch({ ...batch, campaignId: e.target.value })}>
                  <option value="">-- Choose Campaign --</option>
                  {campaigns.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.marketingPartner?.name || "Partner"})</option>)}
                </select>
              </div>

              {selectedCampaignForBatch && (
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-200 text-xs space-y-1.5">
                  <p className="font-bold text-slate-800">Campaign Offers Distribution Breakdown:</p>
                  {selectedCampaignForBatch.benefits && selectedCampaignForBatch.benefits.length > 0 ? (
                    selectedCampaignForBatch.benefits.map((b, idx) => {
                      const estimatedCards = b.percentage ? Math.round((b.percentage / 100) * (batch.quantity || 0)) : (b.quantity || 0);
                      return (
                        <div key={b.id || idx} className="flex justify-between items-center text-slate-600">
                          <span>🎁 {b.name} ({b.benefitType}):</span>
                          <span className="font-bold text-amber-700">{b.percentage ? `${b.percentage}% (~${estimatedCards} cards)` : `${b.quantity} cards`}</span>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-slate-400 italic">No specific offers configured.</p>
                  )}
                  <div className="flex justify-between items-center pt-1 border-t border-slate-200 font-bold text-slate-700">
                    <span>🍀 &quot;Better luck next time&quot;:</span>
                    <span className="text-slate-500">Remainder of {batch.quantity || 0} cards</span>
                  </div>
                </div>
              )}

              <div>
                <label className="text-[11px] font-bold uppercase text-slate-500">Number of Cards (e.g. 500)</label>
                <input type="number" min="1" max="5000" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono font-bold" value={batch.quantity} onChange={(e) => setBatch({ ...batch, quantity: Number(e.target.value) })} />
              </div>

              <button disabled={working || !batch.campaignId} onClick={async () => {
                const result = await submit("/api/marketing-cards/admin/batches", batch, `Generated ${batch.quantity} cards with random offer distribution.`);
                if (result) {
                  await exportBatchForPrint(result);
                  setBatch({ campaignId: "", quantity: 500 });
                }
              }} className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">
                <span>🖨️</span> Generate Cards &amp; Download Print CSV/HTML
              </button>
            </div>
          </section>
        </div>

        {/* Step 2: Create Campaign with Custom Offers Builder */}
        <div className="lg:col-span-8">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-black text-slate-900">2. Create Campaign &amp; Configure Custom Offers</h2>
                <p className="mt-0.5 text-xs text-slate-500">Define custom discount tiers, gifts, and random distribution probabilities.</p>
              </div>
              <button type="button" onClick={loadExampleStrategy} className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition">
                ⚡ Load Example Multi-Offer Strategy
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {/* Campaign Basic Info */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[11px] font-bold uppercase text-slate-500">Partner</label>
                  <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={campaign.marketingPartnerId} onChange={(e) => setCampaign({ ...campaign, marketingPartnerId: e.target.value })}>
                    <option value="">Select partner</option>
                    {partners.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase text-slate-500">Campaign Name</label>
                  <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="e.g. Dashain Mega Offer 2083" value={campaign.name} onChange={(e) => setCampaign({ ...campaign, name: e.target.value })} />
                </div>
              </div>

              {/* Geographic Targeting */}
              <div className="rounded-xl bg-slate-50 p-4 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Geographic Targeting (Nepal 4-Char Mapping)</p>
                  <span className="text-[11px] text-slate-400">Order allocation weights: District 5 : Province 3 : Nation 2</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-500">Scope Type</label>
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium"
                      value={campaign.targetScopeType}
                      onChange={(e) => {
                        const scope = e.target.value;
                        setCampaign({
                          ...campaign,
                          targetScopeType: scope,
                          targetProvince: scope === "NATIONWIDE" ? "" : campaign.targetProvince,
                          targetDistrict: scope === "DISTRICT" ? campaign.targetDistrict : "",
                        });
                      }}
                    >
                      <option value="NATIONWIDE">NATIONWIDE</option>
                      <option value="PROVINCE">PROVINCE WISE</option>
                      <option value="DISTRICT">DISTRICT WISE</option>
                    </select>
                  </div>

                  {(campaign.targetScopeType === "PROVINCE" || campaign.targetScopeType === "DISTRICT") && (
                    <div>
                      <label className="text-[11px] font-bold uppercase text-slate-500">Target Province</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        value={campaign.targetProvince || ""}
                        onChange={(e) => {
                          const selectedProv = e.target.value;
                          const allowedDistricts = DISTRICTS_BY_PROVINCE[selectedProv] || [];
                          const newDistrict = allowedDistricts.includes(campaign.targetDistrict) ? campaign.targetDistrict : "";
                          setCampaign({
                            ...campaign,
                            targetProvince: selectedProv,
                            targetDistrict: newDistrict,
                          });
                        }}
                      >
                        <option value="">-- Select Province --</option>
                        {NEPAL_PROVINCES.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {campaign.targetScopeType === "DISTRICT" && (
                    <div>
                      <label className="text-[11px] font-bold uppercase text-slate-500">Target District</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        value={campaign.targetDistrict || ""}
                        onChange={(e) => {
                          const selectedDist = e.target.value;
                          let prov = campaign.targetProvince;
                          if (!prov && selectedDist) {
                            for (const [pName, distList] of Object.entries(DISTRICTS_BY_PROVINCE)) {
                              if (distList.includes(selectedDist)) {
                                prov = pName;
                                break;
                              }
                            }
                          }
                          setCampaign({
                            ...campaign,
                            targetProvince: prov,
                            targetDistrict: selectedDist,
                          });
                        }}
                      >
                        <option value="">
                          {campaign.targetProvince ? `-- District in ${campaign.targetProvince} --` : "-- Select District --"}
                        </option>
                        {(campaign.targetProvince
                          ? DISTRICTS_BY_PROVINCE[campaign.targetProvince] || []
                          : ALL_DISTRICTS
                        ).map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Custom Offers Builder */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">Custom Offers &amp; Prize Distribution</h3>
                    <p className="text-[11px] text-slate-500">Configure how many cards in any generated batch (e.g. 500 cards) win each offer.</p>
                  </div>
                  <button type="button" onClick={addOffer} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition flex items-center gap-1">
                    <span>+</span> Add Another Offer
                  </button>
                </div>

                {/* Visual Distribution Summary Bar */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-700">Total Winning Cards Share: <span className={totalPercentageAllocated > 100 ? "text-rose-600 font-black" : "text-emerald-700 font-black"}>{totalPercentageAllocated}%</span></span>
                    <span className="text-slate-500">🍀 &quot;Better luck next time&quot; Cards: <span className="text-slate-800 font-bold">{betterLuckPercentage}%</span></span>
                  </div>

                  {/* Multi-segment progress bar */}
                  <div className="h-4 w-full overflow-hidden rounded-full bg-slate-200 flex">
                    {campaign.offers.map((offer, idx) => {
                      const pct = offer.allocationMode === "PERCENTAGE" ? Number(offer.percentage) || 0 : 0;
                      if (pct <= 0) return null;
                      const colors = ["bg-amber-500", "bg-indigo-500", "bg-emerald-500", "bg-purple-500", "bg-pink-500"];
                      return (
                        <div
                          key={offer.id || idx}
                          style={{ width: `${Math.min(100, pct)}%` }}
                          className={`${colors[idx % colors.length]} flex items-center justify-center text-[9px] font-bold text-white transition-all`}
                          title={`${offer.name || `Offer ${idx + 1}`}: ${pct}%`}
                        >
                          {pct >= 5 ? `${pct}%` : ""}
                        </div>
                      );
                    })}
                    {betterLuckPercentage > 0 && (
                      <div
                        style={{ width: `${betterLuckPercentage}%` }}
                        className="bg-slate-300 flex items-center justify-center text-[9px] font-bold text-slate-600"
                        title={`Better luck next time: ${betterLuckPercentage}%`}
                      >
                        {betterLuckPercentage >= 10 ? `${betterLuckPercentage}% No-Prize` : ""}
                      </div>
                    )}
                  </div>
                  {totalPercentageAllocated > 100 && (
                    <p className="text-[11px] font-bold text-rose-600">⚠️ Total percentage exceeds 100%. Please adjust offer percentages.</p>
                  )}
                </div>

                {/* Offer Cards List */}
                <div className="space-y-3">
                  {campaign.offers.map((offer, index) => (
                    <div key={offer.id || index} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm relative space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[11px] font-black text-amber-800">{index + 1}</span>
                          <span className="text-xs font-bold text-slate-800">Offer #{index + 1}</span>
                        </div>
                        {campaign.offers.length > 1 && (
                          <button type="button" onClick={() => removeOffer(index)} className="text-xs text-rose-500 hover:text-rose-700 font-bold">
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-12">
                        <div className="sm:col-span-6">
                          <label className="text-[11px] font-bold uppercase text-slate-500">Offer Name</label>
                          <input
                            required
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            placeholder="e.g. 10% Discount Voucher, Free Accessories"
                            value={offer.name}
                            onChange={(e) => updateOffer(index, "name", e.target.value)}
                          />
                        </div>

                        <div className="sm:col-span-3">
                          <label className="text-[11px] font-bold uppercase text-slate-500">Benefit Type</label>
                          <select
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            value={offer.benefitType}
                            onChange={(e) => updateOffer(index, "benefitType", e.target.value)}
                          >
                            <option value="DISCOUNT">DISCOUNT (%)</option>
                            <option value="VOUCHER">VOUCHER (Rs)</option>
                            <option value="GIFT">FREE GIFT / ITEM</option>
                            <option value="CUSTOM">CUSTOM REWARD</option>
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <label className="text-[11px] font-bold uppercase text-slate-500">Reward Value</label>
                          <input
                            type="number"
                            min="0"
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            placeholder={offer.benefitType === "DISCOUNT" ? "Discount % (e.g. 10)" : "Value in Rs"}
                            value={offer.value}
                            onChange={(e) => updateOffer(index, "value", Number(e.target.value))}
                          />
                        </div>

                        <div className="sm:col-span-4">
                          <label className="text-[11px] font-bold uppercase text-slate-500">Distribution Mode</label>
                          <select
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium"
                            value={offer.allocationMode}
                            onChange={(e) => updateOffer(index, "allocationMode", e.target.value)}
                          >
                            <option value="PERCENTAGE">Percentage of Cards (%)</option>
                            <option value="QUANTITY">Fixed Number of Cards</option>
                          </select>
                        </div>

                        <div className="sm:col-span-4">
                          <label className="text-[11px] font-bold uppercase text-slate-500">
                            {offer.allocationMode === "PERCENTAGE" ? "Offer Card Share (%)" : "Winning Cards Count"}
                          </label>
                          <div className="relative mt-1">
                            <input
                              type="number"
                              min="0"
                              max={offer.allocationMode === "PERCENTAGE" ? 100 : 5000}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold"
                              placeholder={offer.allocationMode === "PERCENTAGE" ? "e.g. 10 for 10%" : "e.g. 20 cards"}
                              value={offer.allocationMode === "PERCENTAGE" ? offer.percentage : offer.quantity}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                if (offer.allocationMode === "PERCENTAGE") {
                                  updateOffer(index, "percentage", val);
                                } else {
                                  updateOffer(index, "quantity", val);
                                }
                              }}
                            />
                            {offer.allocationMode === "PERCENTAGE" && (
                              <span className="absolute right-3 top-2 text-sm font-bold text-slate-400">%</span>
                            )}
                          </div>
                        </div>

                        <div className="sm:col-span-4">
                          <label className="text-[11px] font-bold uppercase text-slate-500">Card Calculation Example</label>
                          <div className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 border border-slate-100">
                            {offer.allocationMode === "PERCENTAGE"
                              ? `~${Math.round(((offer.percentage || 0) / 100) * 500)} cards per 500 batch`
                              : `${offer.quantity || 0} cards total`}
                          </div>
                        </div>

                        <div className="sm:col-span-6">
                          <label className="text-[11px] font-bold uppercase text-slate-500">Description (Optional)</label>
                          <input
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            placeholder="e.g. Valid on all winter jackets"
                            value={offer.description}
                            onChange={(e) => updateOffer(index, "description", e.target.value)}
                          />
                        </div>

                        <div className="sm:col-span-6">
                          <label className="text-[11px] font-bold uppercase text-slate-500">Terms &amp; Expiration</label>
                          <div className="mt-1 grid grid-cols-2 gap-2">
                            <input
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                              placeholder="Terms (e.g. 1 use)"
                              value={offer.terms}
                              onChange={(e) => updateOffer(index, "terms", e.target.value)}
                            />
                            <input
                              type="date"
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                              value={offer.expiresAt}
                              onChange={(e) => updateOffer(index, "expiresAt", e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submit Campaign Button */}
              <button
                disabled={working}
                onClick={async () => {
                  if (!campaign.marketingPartnerId) {
                    return toast.error("Please select a marketing partner.");
                  }
                  if (!campaign.name.trim()) {
                    return toast.error("Please enter a campaign name.");
                  }
                  if (campaign.targetScopeType === "PROVINCE" && !campaign.targetProvince) {
                    return toast.error("Please select a target province.");
                  }
                  if (campaign.targetScopeType === "DISTRICT" && !campaign.targetDistrict) {
                    return toast.error("Please select a target district.");
                  }
                  if (campaign.offers.length === 0 || campaign.offers.some((o) => !o.name.trim())) {
                    return toast.error("Please provide a name for all offers.");
                  }
                  if (totalPercentageAllocated > 100) {
                    return toast.error("Total offer percentage cannot exceed 100%.");
                  }

                  const formattedBenefits = campaign.offers.map((offer) => ({
                    name: offer.name.trim(),
                    description: offer.description || null,
                    benefitType: offer.benefitType,
                    value: Number(offer.value || 0),
                    percentage: offer.allocationMode === "PERCENTAGE" ? Number(offer.percentage || 0) : 0,
                    quantity: offer.allocationMode === "QUANTITY" ? Number(offer.quantity || 0) : 0,
                    terms: offer.terms || null,
                    expiresAt: offer.expiresAt || null,
                  }));

                  const payload = {
                    marketingPartnerId: campaign.marketingPartnerId,
                    name: campaign.name.trim(),
                    targetScopeType: campaign.targetScopeType,
                    targetProvince: campaign.targetScopeType === "NATIONWIDE" ? null : campaign.targetProvince,
                    targetDistrict: campaign.targetScopeType === "DISTRICT" ? campaign.targetDistrict : null,
                    benefits: formattedBenefits,
                  };

                  const result = await submit("/api/marketing-cards/admin/campaigns", payload, `Campaign created with ${formattedBenefits.length} custom offer(s).`);
                  if (result) setCampaign(createInitialCampaign());
                }}
                className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
              >
                Create Campaign with Configured Offers
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Assign Inventory to Manufacturer */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-900">4. Assign Generated Cards to Manufacturer</h2>
            <p className="mt-1 text-xs text-slate-500">Allocate generated cards to manufacturer hubs to attach to outgoing customer orders.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={assignment.campaignId} onChange={(e) => setAssignment({ ...assignment, campaignId: e.target.value })}>
            <option value="">Select campaign</option>
            {campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={assignment.manufacturerId} onChange={(e) => setAssignment({ ...assignment, manufacturerId: e.target.value })}>
            <option value="">Select manufacturer</option>
            {manufacturers.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name} - {item.city}</option>)}
          </select>
          <input type="number" min="1" max="5000" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono" value={assignment.quantity} onChange={(e) => setAssignment({ ...assignment, quantity: Number(e.target.value) })} />
          <button disabled={working} onClick={async () => { const result = await submit("/api/marketing-cards/admin/assignments", assignment, "Cards assigned."); if (result) setAssignment({ ...assignment, quantity: 1 }); }} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Assign cards</button>
        </div>
      </section>

      {/* Card Inventory Table */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-black text-slate-900">Live Card Inventory (Latest 500)</h2>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading card inventory...</p>
        ) : cards.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No cards generated yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-5 py-3">Card Code</th>
                  <th className="px-5 py-3">Campaign</th>
                  <th className="px-5 py-3">Assigned Reward / Offer</th>
                  <th className="px-5 py-3">Manufacturer</th>
                  <th className="px-5 py-3">Physical Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cards.map((card) => (
                  <tr key={card.id}>
                    <td className="px-5 py-3 font-mono font-bold text-slate-800">{card.cardCode}</td>
                    <td className="px-5 py-3 text-slate-600">{card.campaign?.name || "-"}</td>
                    <td className="px-5 py-3">
                      {card.hasBenefit && card.benefit ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800 border border-amber-200">
                          🎁 {card.benefit.name} {card.benefit.value ? `(${card.benefit.benefitType === "DISCOUNT" ? `${card.benefit.value}% off` : `Rs ${card.benefit.value}`})` : ""}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                          🍀 Better luck next time
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{card.assignedManufacturer?.name || "Unassigned"}</td>
                    <td className="px-5 py-3">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-700">
                        {card.physicalStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default MarketingCards;
