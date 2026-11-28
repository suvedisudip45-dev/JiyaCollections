/* eslint-disable react/prop-types */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, AlertCircle, RefreshCcw } from "lucide-react";
import { getMarketingPartnerAnalytics } from "../api/marketingPartners";
import PartnerAnalyticsTable from "../components/marketing/PartnerAnalyticsTable";

const count = (value) => Number(value || 0).toLocaleString();
const formatDate = (value) => value ? new Date(value).toLocaleDateString() : "—";
const isExpired = (campaign) => campaign.status === "EXPIRED"
  || (campaign.endsAt && new Date(campaign.endsAt) < new Date());

const MetricCard = ({ label, value, color = "text-slate-900" }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    <p className={`mt-2 text-2xl font-black ${color}`}>{count(value)}</p>
  </div>
);

const MarketingPartnerDetail = ({ token }) => {
  const { partnerId } = useParams();
  const [report, setReport] = useState(null);
  const [campaignFilter, setCampaignFilter] = useState("current");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await getMarketingPartnerAnalytics(token, partnerId);
      if (!response.data?.success) throw new Error("Unable to load marketing partner analytics.");
      setReport(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Unable to load marketing partner analytics.");
    } finally {
      setLoading(false);
    }
  }, [partnerId, token]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const campaigns = useMemo(() => report?.campaigns || [], [report?.campaigns]);
  const currentCampaigns = useMemo(() => campaigns.filter((campaign) => (
    campaign.status === "ACTIVE" && !isExpired(campaign)
  )), [campaigns]);
  const expiredCampaigns = useMemo(() => campaigns.filter(isExpired), [campaigns]);
  const filteredCampaigns = campaignFilter === "current"
    ? currentCampaigns
    : campaignFilter === "expired"
      ? expiredCampaigns
      : campaigns;
  const totalCards = campaigns.reduce((total, campaign) => total + campaign.totalCards, 0);
  const totalAttached = campaigns.reduce((total, campaign) => total + campaign.attachedCards, 0);
  const totalScanned = campaigns.reduce((total, campaign) => total + campaign.scannedCards, 0);
  const totalRewards = campaigns.reduce((total, campaign) => total + campaign.rewardsClaimed, 0);

  if (loading) return <p className="py-12 text-center text-sm text-slate-500">Loading partner details…</p>;
  if (error) {
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-800">
        <AlertCircle size={28} className="mx-auto mb-2" />
        <p className="text-sm font-bold">Unable to load partner details</p>
        <p className="mt-1 text-xs">{error}</p>
        <button type="button" onClick={loadReport} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white">
          <RefreshCcw size={14} /> Try again
        </button>
      </div>
    );
  }

  const partner = report.partner;
  const numberColumn = (key, label) => ({ key, label, numeric: true, render: (row) => count(row[key]) });
  const campaignColumns = [
    { key: "name", label: "Campaign", render: (campaign) => <span className="font-bold text-slate-800">{campaign.name}</span> },
    {
      key: "targetScopeType",
      label: "Target",
      render: (campaign) => campaign.targetScopeType === "NATIONWIDE"
        ? "Nationwide"
        : [campaign.targetDistrict, campaign.targetProvince].filter(Boolean).join(", ") || campaign.targetScopeType,
    },
    { key: "status", label: "Status" },
    numberColumn("totalCards", "Cards"),
    numberColumn("attachedCards", "Attached"),
    numberColumn("scannedCards", "Scanned"),
    numberColumn("rewardsClaimed", "Rewards claimed"),
    { key: "endsAt", label: "Ends", render: (campaign) => formatDate(campaign.endsAt) },
  ];

  return (
    <div className="space-y-6">
      <header>
        <Link to="/marketing-cards" className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-900">
          <ArrowLeft size={14} /> Back to marketing cards
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-900">{partner.name}</h1>
            <p className="mt-1 text-xs text-slate-500">{partner.code} · {partner.status} · Partner since {formatDate(partner.createdAt)}</p>
          </div>
          <button type="button" onClick={loadReport} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <RefreshCcw size={14} /> Refresh
          </button>
        </div>
      </header>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
        <p><span className="font-bold text-slate-800">Email:</span> {partner.email || "—"}</p>
        <p><span className="font-bold text-slate-800">Phone:</span> {partner.contactPhone || "—"}</p>
        <p><span className="font-bold text-slate-800">Website:</span> {partner.website || "—"}</p>
        <p><span className="font-bold text-slate-800">Address:</span> {partner.address || "—"}</p>
        {partner.description && <p className="sm:col-span-2 lg:col-span-4">{partner.description}</p>}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total partner cards" value={totalCards} />
        <MetricCard label="Cards attached" value={totalAttached} color="text-indigo-700" />
        <MetricCard label="Cards scanned" value={totalScanned} color="text-sky-700" />
        <MetricCard label="Rewards claimed" value={totalRewards} color="text-emerald-700" />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-900">Campaigns</h2>
            <p className="mt-0.5 text-xs text-slate-500">{currentCampaigns.length} current · {expiredCampaigns.length} expired · {campaigns.length} total</p>
          </div>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {[
              ["current", "Current"],
              ["expired", "Expired"],
              ["all", "All"],
            ].map(([value, label]) => (
              <button key={value} type="button" onClick={() => setCampaignFilter(value)} className={`rounded-md px-3 py-1.5 text-xs font-bold ${campaignFilter === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <PartnerAnalyticsTable
            title=""
            columns={campaignColumns}
            rows={filteredCampaigns}
            emptyMessage="No campaigns match this filter."
          />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <PartnerAnalyticsTable
          title="Distributor card performance"
          description="Card quantities, attached cards, and rewards claimed for each distributor."
          columns={[
            { key: "name", label: "Distributor", render: (row) => <><span className="font-bold">{row.name}</span><span className="block text-[10px] text-slate-400">{row.district || "—"}, {row.province || "—"}</span></> },
            numberColumn("totalCards", "Cards assigned"),
            numberColumn("attachedCards", "Attached"),
            numberColumn("rewardsClaimed", "Rewards"),
          ]}
          rows={report.distributors || []}
          emptyMessage="No cards have been assigned to distributors for this partner."
        />
        <PartnerAnalyticsTable
          title="Customer scan locations"
          description="Province and district snapshots from the customer's saved address at scan time."
          columns={[
            { key: "province", label: "Province" },
            { key: "district", label: "District" },
            numberColumn("scannedCards", "Cards scanned"),
          ]}
          rows={report.scanLocations || []}
          emptyMessage="No customer scans have been recorded."
        />
        <PartnerAnalyticsTable
          title="Distributor distribution locations"
          description="Cards assigned to distributors, grouped by their registered province and district."
          columns={[
            { key: "province", label: "Province" },
            { key: "district", label: "District" },
            numberColumn("distributedCards", "Cards distributed"),
          ]}
          rows={report.distributionLocations || []}
          emptyMessage="No distributor card distribution has been recorded."
        />
      </section>
    </div>
  );
};

export default MarketingPartnerDetail;
