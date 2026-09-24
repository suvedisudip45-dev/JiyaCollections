import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Megaphone, Search, Filter, Calendar, MapPin, Layers,
  Gift, ArrowUpRight, AlertCircle, RefreshCcw
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-3xl" />
          ))}
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

      {/* Campaigns Grid */}
      {!loading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((campaign) => {
            const cardCount = campaign._count?.cards || 0;
            const batchCount = campaign._count?.batches || 0;
            const benefits = campaign.benefits || [];

            return (
              <div
                key={campaign.id}
                className="bg-white rounded-3xl border border-[var(--mp-line)] p-6 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
              >
                <div>
                  {/* Top line with status and geography */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <Badge status={campaign.status} />
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--mp-muted)] bg-[var(--mp-bg)] px-2.5 py-1 rounded-full">
                      <MapPin size={11} />
                      {campaign.targetScopeType === "PROVINCE" && campaign.targetProvince
                        ? campaign.targetProvince
                        : campaign.targetScopeType === "DISTRICT" && campaign.targetDistrict
                        ? `${campaign.targetDistrict}, ${campaign.targetProvince || ""}`
                        : "Nationwide"}
                    </span>
                  </div>

                  {/* Title & Description */}
                  <h3 className="text-base font-bold text-[var(--mp-ink)] group-hover:text-brand-600 transition-colors line-clamp-1">
                    {campaign.name}
                  </h3>
                  <p className="text-xs text-[var(--mp-ink-2)] mt-1 line-clamp-2 min-h-[32px]">
                    {campaign.description || "No description provided."}
                  </p>

                  {/* Benefit preview pills */}
                  {benefits.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-[var(--mp-line)] space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--mp-muted)]">
                        Benefits ({benefits.length}):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {benefits.slice(0, 2).map((b) => (
                          <span
                            key={b.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 text-[11px] font-semibold border border-emerald-100"
                          >
                            <Gift size={11} />
                            {b.name} ({b.value > 0 ? `${b.value}% OFF` : b.benefitType})
                          </span>
                        ))}
                        {benefits.length > 2 && (
                          <span className="text-[11px] font-semibold text-[var(--mp-muted)] self-center">
                            +{benefits.length - 2} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Stats snippet */}
                  <div className="mt-4 pt-3 border-t border-[var(--mp-line)] grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-[var(--mp-bg)] p-2.5 rounded-xl">
                      <span className="text-[10px] font-bold uppercase text-[var(--mp-muted)]">Total Cards</span>
                      <p className="font-bold text-[var(--mp-ink)] text-sm">{cardCount.toLocaleString()}</p>
                    </div>
                    <div className="bg-[var(--mp-bg)] p-2.5 rounded-xl">
                      <span className="text-[10px] font-bold uppercase text-[var(--mp-muted)]">Batches</span>
                      <p className="font-bold text-[var(--mp-ink)] text-sm">{batchCount.toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                {/* Footer action */}
                <div className="mt-5 pt-4 border-t border-[var(--mp-line)] flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--mp-muted)]">
                    <Calendar size={12} />
                    <span>
                      {campaign.startsAt
                        ? new Date(campaign.startsAt).toLocaleDateString()
                        : "Ongoing"}
                    </span>
                  </div>
                  <Link
                    to={`/campaigns/${campaign.id}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[var(--mp-brand-light)] hover:bg-brand-600 text-brand-700 hover:text-white font-bold text-xs transition-all"
                  >
                    <span>View Campaign</span>
                    <ArrowUpRight size={13} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CampaignListPage;
