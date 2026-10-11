import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Megaphone, Search, Filter, ArrowUpRight, AlertCircle, RefreshCcw
} from "lucide-react";
import { campaignsApi } from "../../api";
import { getErrorMessage } from "../../api/client";
import Badge from "../../components/common/Badge";
import Skeleton from "../../components/common/Skeleton";
import EmptyState from "../../components/common/EmptyState";

const CampaignListPage = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await campaignsApi.list({ status: statusFilter !== "all" ? statusFilter : undefined });
      if (res.data?.success) {
        setCampaigns(res.data.campaigns || []);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load campaigns."));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const filtered = campaigns.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.description && c.description.toLowerCase().includes(search.toLowerCase())) ||
      (c.targetProvince && c.targetProvince.toLowerCase().includes(search.toLowerCase())) ||
      (c.targetDistrict && c.targetDistrict.toLowerCase().includes(search.toLowerCase()));
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-[var(--mp-ink)]">Marketing Campaigns</h2>
          <p className="text-xs text-[var(--mp-muted)] mt-0.5">
            View all your promotional campaigns, card batches, and attached customer benefits
          </p>
        </div>
        <button
          onClick={fetchCampaigns}
          className="p-2.5 rounded-xl border border-[var(--mp-line)] hover:bg-white text-[var(--mp-ink-2)] transition-colors flex items-center gap-2 text-xs font-semibold"
        >
          <RefreshCcw size={14} />
          Refresh
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-[var(--mp-line)] shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--mp-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns, regions..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-[var(--mp-line)] focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all placeholder:text-[var(--mp-muted)]"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter size={15} className="text-[var(--mp-muted)] hidden sm:block" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 text-xs font-semibold rounded-xl border border-[var(--mp-line)] bg-white text-[var(--mp-ink)] focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="all">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="DRAFT">Draft</option>
            <option value="EXPIRED">Expired</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="overflow-hidden rounded-2xl border border-[var(--mp-line)] bg-white">
          <Skeleton className="h-12 w-full" />
          <div className="space-y-2 p-4">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
          </div>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <AlertCircle size={32} className="mx-auto mb-2 text-red-500" />
          <p className="font-bold text-sm">{error}</p>
          <button
            onClick={fetchCampaigns}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          icon={Megaphone}
          title="No campaigns found"
          description={
            search || statusFilter !== "all"
              ? "No campaigns matched your search or filters. Try adjusting your query."
              : "No marketing campaigns have been set up for your partner account yet."
          }
        />
      )}

      {/* Campaigns Table */}
      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-[var(--mp-line)] bg-white shadow-xs">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-[var(--mp-bg)] text-[10px] uppercase tracking-wider text-[var(--mp-muted)]">
              <tr>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Target area</th>
                <th className="px-4 py-3">Cards / Batches</th>
                <th className="px-4 py-3">Starts</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--mp-line)]">
              {filtered.map((campaign) => {
                const target = campaign.targetScopeType === "PROVINCE" && campaign.targetProvince
                  ? campaign.targetProvince
                  : campaign.targetScopeType === "DISTRICT" && campaign.targetDistrict
                    ? `${campaign.targetDistrict}, ${campaign.targetProvince || ""}`
                    : "Nationwide";
                return (
                  <tr key={campaign.id} className="hover:bg-[var(--mp-bg)]/60">
                    <td className="px-4 py-3">
                      <p className="font-bold text-[var(--mp-ink)]">{campaign.name}</p>
                      <p className="mt-1 max-w-sm truncate text-[10px] text-[var(--mp-muted)]">{campaign.description || "No description provided."}</p>
                    </td>
                    <td className="px-4 py-3">{target}</td>
                    <td className="px-4 py-3">{(campaign._count?.cards || 0).toLocaleString()} cards <span className="text-[var(--mp-muted)]">/ {(campaign._count?.batches || 0).toLocaleString()} batches</span></td>
                    <td className="px-4 py-3">{campaign.startsAt ? new Date(campaign.startsAt).toLocaleDateString() : "Ongoing"}</td>
                    <td className="px-4 py-3"><Badge status={campaign.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/campaigns/${campaign.id}`}
                        className="inline-flex items-center gap-1 rounded-xl bg-[var(--mp-brand-light)] px-3 py-1.5 font-bold text-brand-700 transition-all hover:bg-brand-600 hover:text-white"
                      >
                        <span>View details</span><ArrowUpRight size={13} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CampaignListPage;
