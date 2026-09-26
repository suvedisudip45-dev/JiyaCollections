import React, { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, CreditCard, CheckCircle2, Gift, Building2,
  Calendar, Clock, AlertCircle, RefreshCcw, ShieldCheck,
  ChevronRight, MapPin
} from "lucide-react";
import { cardsApi } from "../../api";
import { getErrorMessage } from "../../api/client";
import Badge from "../../components/common/Badge";
import Skeleton from "../../components/common/Skeleton";

const TIMELINE_STEPS = [
  { key: "GENERATED", label: "Generated", desc: "Batch printed & hashed" },
  { key: "ASSIGNED", label: "Assigned", desc: "Sent to manufacturer" },
  { key: "RECEIVED", label: "Received", desc: "Confirmed by manufacturer" },
  { key: "ATTACHED", label: "Attached", desc: "Stitched to garment / order" },
  { key: "ACTIVATED", label: "Customer Activated", desc: "Linked to customer account" },
  { key: "REDEEMED", label: "Benefit Redeemed", desc: "Reward claimed" },
];

const CardDetailPage = () => {
  const { id } = useParams();
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await cardsApi.get(id);
      if (res.data?.success) {
        setCard(res.data.card);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load card details."));
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
        <Skeleton className="h-36 w-full rounded-3xl" />
        <Skeleton className="h-48 w-full rounded-3xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64 rounded-3xl" />
          <Skeleton className="h-64 rounded-3xl" />
        </div>
      </div>
    );
  }

  if (error || !card) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-3xl p-8 text-center text-red-700 max-w-lg mx-auto mt-8">
        <AlertCircle size={40} className="mx-auto mb-3 text-red-500" />
        <h3 className="text-lg font-bold">Unable to view card</h3>
        <p className="text-sm mt-1 text-red-600">{error || "Card not found or access denied."}</p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <Link
            to="/cards"
            className="px-4 py-2 bg-white border border-red-200 text-red-700 rounded-xl text-xs font-bold hover:bg-red-100"
          >
            ← Back to Cards
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

  const isActivated = card.customerLinks?.some((l) => l.status === "ACTIVE" || l.status === "LINKED");
  const isRedeemed = card.benefitRedemptions?.some((r) => r.status === "REDEEMED");

  // Determine active timeline index
  let activeStepIdx = 0;
  if (card.physicalStatus === "GENERATED") activeStepIdx = 0;
  else if (card.physicalStatus === "ASSIGNED") activeStepIdx = 1;
  else if (card.physicalStatus === "RECEIVED") activeStepIdx = 2;
  else if (card.physicalStatus === "ATTACHED" || card.physicalStatus === "AVAILABLE") activeStepIdx = 3;
  if (isActivated) activeStepIdx = 4;
  if (isRedeemed) activeStepIdx = 5;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div>
        <Link
          to="/cards"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--mp-muted)] hover:text-brand-600 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to all cards
        </Link>
      </div>

      {/* Header Banner */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[var(--mp-line)] shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge status={card.physicalStatus} />
              {isActivated && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-700 font-bold text-[10px] uppercase">
                  <CheckCircle2 size={11} />
                  Activated
                </span>
              )}
              {isRedeemed && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px] uppercase">
                  <Gift size={11} />
                  Redeemed
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-mono font-extrabold text-[var(--mp-ink)]">
              {card.cardCode}
            </h1>
            <p className="text-xs text-[var(--mp-muted)]">
              Campaign: <span className="font-bold text-[var(--mp-ink-2)]">{card.campaign?.name}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/qr-validator"
              className="px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-2"
            >
              <ShieldCheck size={14} />
              Validate / Redeem
            </Link>
            <button
              onClick={fetchDetail}
              className="p-2.5 rounded-xl border border-[var(--mp-line)] hover:bg-[var(--mp-bg)] text-[var(--mp-ink-2)] transition-colors"
              title="Refresh"
            >
              <RefreshCcw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Lifecycle Progress Bar */}
      <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-sm">
        <h3 className="text-sm font-bold text-[var(--mp-ink)] mb-6">Physical & Digital Lifecycle</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {TIMELINE_STEPS.map((step, idx) => {
            const isPast = idx < activeStepIdx;
            const isCurrent = idx === activeStepIdx;
            const isFuture = idx > activeStepIdx;

            return (
              <div
                key={step.key}
                className={`p-3.5 rounded-2xl border text-center transition-all ${
                  isCurrent
                    ? "border-brand-500 bg-[var(--mp-brand-light)] shadow-xs"
                    : isPast
                    ? "border-emerald-200 bg-emerald-50/50"
                    : "border-[var(--mp-line)] bg-[var(--mp-bg)] opacity-60"
                }`}
              >
                <div className="flex items-center justify-center mb-1.5">
                  {isPast ? (
                    <CheckCircle2 size={16} className="text-emerald-600" />
                  ) : (
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        isCurrent ? "bg-brand-600 text-white" : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {idx + 1}
                    </span>
                  )}
                </div>
                <p className={`text-xs font-bold ${isCurrent ? "text-brand-800" : "text-[var(--mp-ink)]"}`}>
                  {step.label}
                </p>
                <p className="text-[10px] text-[var(--mp-muted)] mt-0.5">{step.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid: Campaign & Manufacturer details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Campaign Info */}
        <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-[var(--mp-ink)]">Campaign Context</h3>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-2 border-b border-[var(--mp-line)]">
              <span className="text-[var(--mp-muted)]">Campaign Name</span>
              <span className="font-bold text-[var(--mp-ink)]">{card.campaign?.name}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-[var(--mp-line)]">
              <span className="text-[var(--mp-muted)]">Geographic Scope</span>
              <span className="font-bold text-[var(--mp-ink)]">{card.campaign?.targetScopeType || "Nationwide"}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-[var(--mp-line)]">
              <span className="text-[var(--mp-muted)]">Batch Reference</span>
              <span className="font-mono text-[var(--mp-ink)]">{card.batchId || "—"}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-[var(--mp-muted)]">Created Date</span>
              <span className="text-[var(--mp-ink)]">{new Date(card.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Manufacturer Assignment */}
        <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-[var(--mp-ink)]">Manufacturer Assignment</h3>
          {card.assignedManufacturer ? (
            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-2 border-b border-[var(--mp-line)]">
                <span className="text-[var(--mp-muted)]">Manufacturer</span>
                <span className="font-bold text-[var(--mp-ink)]">{card.assignedManufacturer.name}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-[var(--mp-line)]">
                <span className="text-[var(--mp-muted)]">Location</span>
                <span className="text-[var(--mp-ink)]">{card.assignedManufacturer.city || "—"}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-[var(--mp-line)]">
                <span className="text-[var(--mp-muted)]">Assigned At</span>
                <span className="text-[var(--mp-ink)]">
                  {card.assignedAt ? new Date(card.assignedAt).toLocaleString() : "—"}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-[var(--mp-muted)]">Received At</span>
                <span className="text-[var(--mp-ink)]">
                  {card.receivedAt ? new Date(card.receivedAt).toLocaleString() : "Pending confirmation"}
                </span>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-[var(--mp-muted)]">
              <Building2 size={24} className="mx-auto mb-2 opacity-50" />
              Card has not yet been assigned to a manufacturing unit.
            </div>
          )}
        </div>
      </div>

      {/* Events Audit Trail */}
      {card.events && card.events.length > 0 && (
        <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-sm">
          <h3 className="text-sm font-bold text-[var(--mp-ink)] mb-4">Lifecycle Audit Trail</h3>
          <div className="space-y-3">
            {card.events.map((ev, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 rounded-2xl bg-[var(--mp-bg)] text-xs">
                <Clock size={15} className="text-brand-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <span className="font-bold text-[var(--mp-ink)]">{ev.eventType}</span>
                  <span className="text-[var(--mp-muted)] ml-2">by {ev.actorRole || "SYSTEM"}</span>
                  <p className="text-[11px] text-[var(--mp-muted)] mt-0.5">
                    {new Date(ev.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CardDetailPage;
