import React, { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Megaphone, Calendar, MapPin, Layers,
  CreditCard, CheckCircle2, Gift, AlertCircle, RefreshCcw,
  ExternalLink, Clock
} from "lucide-react";
import { campaignsApi } from "../../api";
import { getErrorMessage } from "../../api/client";
import Badge from "../../components/common/Badge";
import Skeleton from "../../components/common/Skeleton";
import EmptyState from "../../components/common/EmptyState";

const CampaignDetailPage = () => {
  const { id } = useParams();
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await campaignsApi.get(id);
      if (res.data?.success) {
        setCampaign(res.data.campaign);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load campaign details."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-40 w-full rounded-3xl" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-3xl p-8 text-center text-red-700 max-w-lg mx-auto mt-8">
        <AlertCircle size={40} className="mx-auto mb-3 text-red-500" />
        <h3 className="text-lg font-bold">Unable to display campaign</h3>
        <p className="text-sm mt-1 text-red-600">{error || "Campaign not found or access denied."}</p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <Link
            to="/campaigns"
            className="px-4 py-2 bg-white border border-red-200 text-red-700 rounded-xl text-xs font-bold hover:bg-red-100"
          >
            ← Back to Campaigns
          </Link>
          <button
            onClick={fetchDetail}
            className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const stats = campaign.stats || {};
  const physical = stats.physical || {};
  const totalCards = campaign._count?.cards || 0;
  const activated = stats.activated || 0;
  const redeemed = stats.redeemed || 0;
  const benefits = campaign.benefits || [];
  const batches = campaign.batches || [];

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div>
        <Link
          to="/campaigns"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--mp-muted)] hover:text-brand-600 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to all campaigns
        </Link>
      </div>

      {/* Header Banner */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[var(--mp-line)] shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge status={campaign.status} />
              <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--mp-muted)] bg-[var(--mp-bg)] px-3 py-1 rounded-full border border-[var(--mp-line)]">
                <MapPin size={12} />
                {campaign.targetScopeType === "PROVINCE" && campaign.targetProvince
                  ? `Province: ${campaign.targetProvince}`
                  : campaign.targetScopeType === "DISTRICT" && campaign.targetDistrict
                  ? `District: ${campaign.targetDistrict}, ${campaign.targetProvince || ""}`
                  : "Target Scope: Nationwide"}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--mp-ink)]">
              {campaign.name}
            </h1>
            <p className="text-sm text-[var(--mp-ink-2)]">
              {campaign.description || "No description provided for this campaign."}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
            <Link
              to={`/cards?campaignId=${campaign.id}`}
              className="px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-2"
            >
              <CreditCard size={14} />
              View Cards ({totalCards})
            </Link>
            <button
              onClick={fetchDetail}
              className="p-2.5 rounded-xl border border-[var(--mp-line)] hover:bg-[var(--mp-bg)] text-[var(--mp-ink-2)] transition-colors flex items-center justify-center"
              title="Refresh"
            >
              <RefreshCcw size={14} />
            </button>
          </div>
        </div>

        {/* Date Row */}
        <div className="mt-6 pt-5 border-t border-[var(--mp-line)] flex flex-wrap items-center gap-6 text-xs text-[var(--mp-muted)]">
          <div className="flex items-center gap-1.5">
            <Calendar size={14} className="text-brand-600" />
            <span className="font-medium text-[var(--mp-ink-2)]">Start:</span>
            <span>{campaign.startsAt ? new Date(campaign.startsAt).toLocaleDateString() : "Immediate"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar size={14} className="text-brand-600" />
            <span className="font-medium text-[var(--mp-ink-2)]">End:</span>
            <span>{campaign.endsAt ? new Date(campaign.endsAt).toLocaleDateString() : "Ongoing"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock size={14} className="text-brand-600" />
            <span className="font-medium text-[var(--mp-ink-2)]">Created:</span>
            <span>{new Date(campaign.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-[var(--mp-line)] shadow-xs">
          <span className="text-[10px] font-bold uppercase text-[var(--mp-muted)]">Total Cards</span>
          <div className="text-2xl font-extrabold text-[var(--mp-ink)] mt-1">{totalCards.toLocaleString()}</div>
          <p className="text-[11px] text-[var(--mp-muted)] mt-0.5">{batches.length} batch(es) generated</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-[var(--mp-line)] shadow-xs">
          <span className="text-[10px] font-bold uppercase text-[var(--mp-muted)]">Attached to Orders</span>
          <div className="text-2xl font-extrabold text-blue-600 mt-1">{(physical.ATTACHED || 0).toLocaleString()}</div>
          <p className="text-[11px] text-[var(--mp-muted)] mt-0.5">Distributed with apparel</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-[var(--mp-line)] shadow-xs">
          <span className="text-[10px] font-bold uppercase text-[var(--mp-muted)]">Customer Activated</span>
          <div className="text-2xl font-extrabold text-teal-600 mt-1">{activated.toLocaleString()}</div>
          <p className="text-[11px] text-[var(--mp-muted)] mt-0.5">
            {totalCards > 0 ? Math.round((activated / totalCards) * 100) : 0}% activation
          </p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-[var(--mp-line)] shadow-xs">
          <span className="text-[10px] font-bold uppercase text-[var(--mp-muted)]">Benefits Redeemed</span>
          <div className="text-2xl font-extrabold text-emerald-600 mt-1">{redeemed.toLocaleString()}</div>
          <p className="text-[11px] text-[var(--mp-muted)] mt-0.5">
            {activated > 0 ? Math.round((redeemed / activated) * 100) : 0}% conversion
          </p>
        </div>
      </div>

      {/* Grid: Benefits & Batches */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Benefits Section */}
        <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-[var(--mp-ink)] flex items-center gap-2">
              <Gift size={18} className="text-brand-600" />
              Configured Benefits ({benefits.length})
            </h3>
          </div>

          {benefits.length === 0 ? (
            <EmptyState
              icon={Gift}
              title="No benefits configured"
              description="This campaign currently has no customer benefits attached."
            />
          ) : (
            <div className="space-y-3">
              {benefits.map((b) => (
                <div
                  key={b.id}
                  className="p-4 rounded-2xl border border-[var(--mp-line)] bg-[var(--mp-surface-2)] flex flex-col justify-between gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-sm font-bold text-[var(--mp-ink)]">{b.name}</span>
                      <p className="text-xs text-[var(--mp-ink-2)] mt-0.5">{b.description || "No terms specified."}</p>
                    </div>
                    <Badge status={b.status} />
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-[var(--mp-line)] text-xs text-[var(--mp-muted)]">
                    <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                      {b.value > 0 ? `${b.value}% OFF` : b.benefitType}
                    </span>
                    {b.expiresAt && (
                      <span>Expires {new Date(b.expiresAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Batches Section */}
        <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-[var(--mp-ink)] flex items-center gap-2">
              <Layers size={18} className="text-brand-600" />
              Card Batches ({batches.length})
            </h3>
          </div>

          {batches.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No batches generated"
              description="No card print batches have been generated for this campaign yet."
            />
          ) : (
            <div className="space-y-2.5 overflow-y-auto max-h-[360px] pr-1">
              {batches.map((batch) => (
                <div
                  key={batch.id}
                  className="p-3.5 rounded-2xl border border-[var(--mp-line)] bg-white flex items-center justify-between"
                >
                  <div>
                    <span className="text-xs font-mono font-bold text-[var(--mp-ink)]">{batch.batchCode}</span>
                    <p className="text-[11px] text-[var(--mp-muted)] mt-0.5">
                      Created {new Date(batch.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-[var(--mp-ink)]">{batch.quantity} cards</span>
                    <Badge status={batch.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CampaignDetailPage;
