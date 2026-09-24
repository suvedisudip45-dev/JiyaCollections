/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import QRCode from "qrcode";
import { toast } from "react-toastify";
import { backendUrl } from "../App";

const emptyPartner = { code: "", name: "", description: "" };
const emptyCampaign = { marketingPartnerId: "", name: "", targetScopeType: "NATIONWIDE", targetProvince: "", targetDistrict: "", requestedQuantity: 0, benefitName: "", benefitDescription: "", benefitType: "CUSTOM", benefitValue: 0, benefitTerms: "", benefitExpiresAt: "" };

const MarketingCards = ({ token }) => {
  const [partners, setPartners] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [manufacturers, setManufacturers] = useState([]);
  const [cards, setCards] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [partner, setPartner] = useState(emptyPartner);
  const [campaign, setCampaign] = useState(emptyCampaign);
  const [batch, setBatch] = useState({ campaignId: "", quantity: 1 });
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
        <h1 className="mt-1 text-2xl font-black text-slate-900">Card assignment control</h1>
        <p className="mt-1 text-sm text-slate-500">Generate controlled inventory, then allocate it to the manufacturer best positioned for campaign demand.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {["GENERATED", "ASSIGNED", "RECEIVED", "AVAILABLE", "ATTACHED", "DELIVERED", "ACTIVATED", "REDEEMED"].map((status) => (
          <div key={status} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{status}</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{lifecycleMetrics[status] || 0}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-black text-slate-900">1. Create partner</h2>
          <div className="mt-4 space-y-3">
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Partner code" value={partner.code} onChange={(e) => setPartner({ ...partner, code: e.target.value })} />
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Partner name" value={partner.name} onChange={(e) => setPartner({ ...partner, name: e.target.value })} />
            <button disabled={working} onClick={async () => { const result = await submit("/api/marketing-cards/admin/partners", partner, "Partner created."); if (result) setPartner(emptyPartner); }} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Create partner</button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-black text-slate-900">2. Create campaign</h2>
          <div className="mt-4 space-y-3">
            <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={campaign.marketingPartnerId} onChange={(e) => setCampaign({ ...campaign, marketingPartnerId: e.target.value })}>
              <option value="">Select partner</option>{partners.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}
            </select>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Campaign name" value={campaign.name} onChange={(e) => setCampaign({ ...campaign, name: e.target.value })} />
            <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={campaign.targetScopeType} onChange={(e) => setCampaign({ ...campaign, targetScopeType: e.target.value })}><option>NATIONWIDE</option><option>PROVINCE</option><option>DISTRICT</option></select>
            {campaign.targetScopeType !== "NATIONWIDE" && <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder={campaign.targetScopeType === "PROVINCE" ? "Province" : "District"} value={campaign.targetScopeType === "PROVINCE" ? campaign.targetProvince : campaign.targetDistrict} onChange={(e) => setCampaign({ ...campaign, [campaign.targetScopeType === "PROVINCE" ? "targetProvince" : "targetDistrict"]: e.target.value })} />}
            <div className="border-t border-slate-100 pt-3"><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Campaign benefit</p><input required className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Benefit name" value={campaign.benefitName} onChange={(e) => setCampaign({ ...campaign, benefitName: e.target.value })} /><textarea className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Benefit description" value={campaign.benefitDescription} onChange={(e) => setCampaign({ ...campaign, benefitDescription: e.target.value })} /><div className="mt-2 grid grid-cols-2 gap-2"><select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={campaign.benefitType} onChange={(e) => setCampaign({ ...campaign, benefitType: e.target.value })}><option value="CUSTOM">Custom</option><option value="DISCOUNT">Discount</option><option value="VOUCHER">Voucher</option><option value="GIFT">Gift</option></select><input type="number" min="0" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Value" value={campaign.benefitValue} onChange={(e) => setCampaign({ ...campaign, benefitValue: Number(e.target.value) })} /></div><input className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Terms" value={campaign.benefitTerms} onChange={(e) => setCampaign({ ...campaign, benefitTerms: e.target.value })} /><input type="date" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={campaign.benefitExpiresAt} onChange={(e) => setCampaign({ ...campaign, benefitExpiresAt: e.target.value })} /></div>
            <button disabled={working} onClick={async () => { const result = await submit("/api/marketing-cards/admin/campaigns", { ...campaign, benefits: [{ name: campaign.benefitName, description: campaign.benefitDescription, benefitType: campaign.benefitType, value: campaign.benefitValue, terms: campaign.benefitTerms, expiresAt: campaign.benefitExpiresAt || null }] }, "Campaign created with benefit."); if (result) setCampaign(emptyCampaign); }} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Create campaign</button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-black text-slate-900">3. Generate inventory</h2>
          <div className="mt-4 space-y-3">
            <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={batch.campaignId} onChange={(e) => setBatch({ ...batch, campaignId: e.target.value })}><option value="">Select campaign</option>{campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <input type="number" min="1" max="5000" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={batch.quantity} onChange={(e) => setBatch({ ...batch, quantity: Number(e.target.value) })} />
            <button disabled={working} onClick={async () => { const result = await submit("/api/marketing-cards/admin/batches", batch, "Card batch generated and print files downloaded."); if (result) { await exportBatchForPrint(result); setBatch({ campaignId: "", quantity: 1 }); } }} className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Generate cards &amp; export</button>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-black text-slate-900">Assign inventory to manufacturer</h2><p className="mt-1 text-xs text-slate-500">Use campaign demand and manufacturer location when choosing the receiving hub.</p></div></div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={assignment.campaignId} onChange={(e) => setAssignment({ ...assignment, campaignId: e.target.value })}><option value="">Select campaign</option>{campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={assignment.manufacturerId} onChange={(e) => setAssignment({ ...assignment, manufacturerId: e.target.value })}><option value="">Select manufacturer</option>{manufacturers.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name} - {item.city}</option>)}</select>
          <input type="number" min="1" max="5000" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={assignment.quantity} onChange={(e) => setAssignment({ ...assignment, quantity: Number(e.target.value) })} />
          <button disabled={working} onClick={async () => { const result = await submit("/api/marketing-cards/admin/assignments", assignment, "Cards assigned."); if (result) setAssignment({ ...assignment, quantity: 1 }); }} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Assign cards</button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-black text-slate-900">Card inventory</h2></div>
        {loading ? <p className="p-6 text-sm text-slate-500">Loading card inventory...</p> : cards.length === 0 ? <p className="p-6 text-sm text-slate-500">No cards generated yet.</p> : <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Card</th><th className="px-5 py-3">Campaign</th><th className="px-5 py-3">Manufacturer</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{cards.map((card) => <tr key={card.id}><td className="px-5 py-3 font-mono font-bold text-slate-800">{card.cardCode}</td><td className="px-5 py-3 text-slate-600">{card.campaign?.name || "-"}</td><td className="px-5 py-3 text-slate-600">{card.assignedManufacturer?.name || "Unassigned"}</td><td className="px-5 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700">{card.physicalStatus}</span></td></tr>)}</tbody></table></div>}
      </section>
    </div>
  );
};

export default MarketingCards;
