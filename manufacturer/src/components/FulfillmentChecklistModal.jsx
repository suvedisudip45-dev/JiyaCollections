import React, { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Gift, HeartHandshake, PackageCheck, X } from "lucide-react";

const MANUFACTURER_REQUIRED_CHECKS = [
  ["productVerified", "Product and quantity verified"],
  ["sizeColorVerified", "Size and color verified"],
  ["stitchingVerified", "Stitching completed and inspected"],
  ["brandingVerified", "Branding, tags, and labels verified"],
  ["qualityVerified", "Quality check passed"],
  ["customerLetterIncluded", "Compulsory customer letter included"],
  ["addressVerified", "Customer address and phone verified"],
  ["packagingMaterialsVerified", "Packaging materials and seal verified"],
];

const DISTRIBUTOR_REQUIRED_CHECKS = [
  ["productVerified", "Product and quantity verified"],
  ["sizeColorVerified", "Size and color verified"],
  ["qualityVerified", "Quality check passed"],
  ["customerLetterIncluded", "Compulsory customer letter included"],
  ["addressVerified", "Customer address and phone verified"],
  ["packagingMaterialsVerified", "Packaging materials and seal verified"],
];

const FulfillmentChecklistModal = ({ isOpen, assignment, checklist, benefits = {}, giftOptions, giftOptionsLoading = false, giftOptionsError = "", onRetryGiftOptions, marketingCard, marketingCardLoading = false, onAttachMarketingCard, currency = "Rs ", onClose, onConfirm, busy = false, isDistributor = false, platformFeatures = { lettersEnabled: true, marketingCardsEnabled: true, loyaltyEnabled: true } }) => {
  const [draft, setDraft] = useState(checklist);
  const [error, setError] = useState("");
  const requiredChecks = (isDistributor ? DISTRIBUTOR_REQUIRED_CHECKS : MANUFACTURER_REQUIRED_CHECKS)
    .filter(([key]) => platformFeatures.lettersEnabled || key !== "customerLetterIncluded");
  const marketingCardRequired = isDistributor &&
    platformFeatures.marketingCardsEnabled &&
    assignment?.order?.marketingCardRequired !== false;
  const attachedCardCode = marketingCard?.card?.cardCode || marketingCard?.cardCode || "";
  const isMarketingCardAttached = Boolean(marketingCard && attachedCardCode);

  useEffect(() => {
    if (isOpen) {
      setDraft(checklist);
      setError("");
    }
  }, [isOpen, checklist]);

  const completedRequired = useMemo(
    () => requiredChecks.filter(([key]) => draft[key] === true).length,
    [draft, requiredChecks]
  );
  const assignedGift = assignment?.order?.assignedGift ||
    (!giftOptions?.groupGiftAssigned ? giftOptions?.assignedGift : null);
  const hasAssignedGift = Boolean(assignedGift?.id);
  const hasGiftOpportunity = Boolean(isDistributor && giftOptions?.eligible && !giftOptions?.alreadyAssigned);
  const totalRequired = requiredChecks.length + (hasAssignedGift ? 1 : 0) + (marketingCardRequired ? 1 : 0);
  const completedTotal = completedRequired +
    (hasAssignedGift && draft.catalogGiftIncluded ? 1 : 0) +
    (marketingCardRequired && isMarketingCardAttached ? 1 : 0);
  const allRequiredComplete = completedRequired === requiredChecks.length &&
    (!hasAssignedGift || draft.catalogGiftIncluded === true) &&
    (!marketingCardRequired || isMarketingCardAttached);
  const hasCustomPerk = platformFeatures.loyaltyEnabled && Boolean(benefits.customPerk);

  if (!isOpen) return null;

  const toggle = (key) => {
    setDraft((previous) => ({ ...previous, [key]: !previous[key] }));
    setError("");
  };

  const confirm = () => {
    if (giftOptionsLoading) {
      setError("Wait until eligible hub gifts finish loading.");
      return;
    }
    if (giftOptionsError) {
      setError("Reload eligible gifts before completing this checklist.");
      return;
    }
    if (marketingCardRequired && !isMarketingCardAttached) {
      setError("Attach a marketing card from an active campaign before confirming this checklist.");
      return;
    }
    if (!allRequiredComplete) {
      setError(`Complete all required checks. ${requiredChecks.length - completedRequired} remaining.`);
      return;
    }
    if (platformFeatures.marketingCardsEnabled && draft.marketingCard && !String(draft.marketingCardId || "").trim()) {
      setError("Enter the marketing partner card ID or uncheck the card item.");
      return;
    }
    onConfirm({ ...draft, verifiedAt: new Date().toISOString() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="checklist-title">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Final verification</p>
            <h2 id="checklist-title" className="mt-1 text-lg font-black text-slate-950">Complete the packing checklist</h2>
            <p className="mt-1 text-xs text-slate-500">Order #{assignment?.order?.id || assignment?.id}. Every required check must be confirmed before packing.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close checklist" className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-800">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-5 sm:px-7">
          <div className="mb-5 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-black text-indigo-950"><PackageCheck className="h-4 w-4 text-indigo-600" /> Required before packing</div>
              <span className="text-[11px] font-black text-indigo-700">{completedTotal}/{totalRequired}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${(completedTotal / totalRequired) * 100}%` }} /></div>
          </div>

          <div className="space-y-2">
            {requiredChecks.map(([key, label]) => (
              <label key={key} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-xs font-semibold transition ${draft[key] ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"}`}>
                <input type="checkbox" checked={Boolean(draft[key])} onChange={() => toggle(key)} className="sr-only" />
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${draft[key] ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white"}`}>
                  {draft[key] && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
                <span>{label}</span>
              </label>
            ))}
            {marketingCardRequired && (
              <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-3 text-xs font-semibold ${
                isMarketingCardAttached
                  ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                  : "border-amber-200 bg-amber-50 text-amber-950"
              }`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                  isMarketingCardAttached
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-amber-300 bg-white"
                }`}>
                  {isMarketingCardAttached && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  Marketing partner card attached
                  {isMarketingCardAttached && <span className="mt-0.5 block font-mono text-[10px]">{attachedCardCode}</span>}
                </span>
                {!isMarketingCardAttached && onAttachMarketingCard && (
                  <button
                    type="button"
                    onClick={onAttachMarketingCard}
                    disabled={busy || marketingCardLoading}
                    className="rounded-lg bg-slate-950 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"
                  >
                    {marketingCardLoading ? "Attaching..." : "Attach card"}
                  </button>
                )}
              </div>
            )}
          </div>

          {(giftOptionsLoading || giftOptionsError || hasGiftOpportunity || giftOptions?.groupGiftAssigned || hasCustomPerk || (platformFeatures.lettersEnabled && benefits.handwrittenCard) || hasAssignedGift) && (
            <div className="mt-6 border-t border-slate-100 pt-5">
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Order inclusions</p>
              <div className="space-y-2">
                {giftOptionsLoading && <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">Checking this order’s reward and accepted gift stock at your hub...</p>}
                {giftOptionsError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-800"><span>{giftOptionsError}</span><button type="button" onClick={onRetryGiftOptions} className="font-bold underline">Retry</button></div>}
                {giftOptions?.groupGiftAssigned && <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3 text-xs text-indigo-900">One gift is already assigned to another shipment in this checkout. Do not pack a second gift.</p>}
                {hasGiftOpportunity && <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><p className="text-xs font-bold text-emerald-950">Customer gift reward</p><p className="mt-1 text-[11px] text-emerald-800">{giftOptions.eligibility?.reasons?.includes("LOYALTY_TIER") && platformFeatures.loyaltyEnabled ? `Loyalty gift value ${currency}${Number(giftOptions.eligibility.loyaltyGiftValue).toLocaleString()}` : "Order-value gift promotion"}{giftOptions.eligibility?.reasons?.includes("ORDER_VALUE") && giftOptions.eligibility?.reasons?.includes("LOYALTY_TIER") && platformFeatures.loyaltyEnabled ? ` · order gift value ${currency}${Number(giftOptions.eligibility.orderValueGiftValue).toLocaleString()}` : ""}</p>{platformFeatures.loyaltyEnabled && benefits.giftDescription && <p className="mt-1 text-[10px] text-emerald-800">Tier note: {benefits.giftDescription}</p>}</div>
                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-emerald-800">Exact value {currency}{Number(giftOptions.eligibility?.requiredValue ?? giftOptions.eligibility?.budget ?? 0).toLocaleString()}</span>
                  </div>
                  <p className="mt-3 rounded-lg bg-white px-3 py-2.5 text-xs text-slate-700">The system selects one exact-value gift at random from accepted stock held by distributors assigned to this checkout. Only one shipment receives a gift; when matching stock is unavailable, the reward remains pending for a later order.</p>
                </div>}
                {hasAssignedGift && <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-xs font-semibold ${draft.catalogGiftIncluded ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}><input type="checkbox" checked={Boolean(draft.catalogGiftIncluded)} onChange={() => toggle("catalogGiftIncluded")} className="h-4 w-4 rounded border-slate-300 text-emerald-600" /><Gift className="h-4 w-4 text-emerald-600" /><span className="min-w-0 flex-1">Pack assigned gift: <strong>{assignedGift.name}</strong><span className="ml-1 block text-[10px] font-medium text-slate-500 sm:inline">{assignedGift.sku} · {currency} {Number(assignedGift.priceValue || 0).toLocaleString()}</span></span><span className="shrink-0 text-[10px] font-bold uppercase text-rose-700">Required</span></label>}
                {platformFeatures.lettersEnabled && benefits.handwrittenCard && <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-xs font-semibold ${draft.thankYouLetter ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}><input type="checkbox" checked={Boolean(draft.thankYouLetter)} onChange={() => toggle("thankYouLetter")} className="h-4 w-4 rounded border-slate-300 text-emerald-600" /><HeartHandshake className="h-4 w-4 text-rose-500" /><span>Include handwritten thank-you letter</span></label>}
                {hasCustomPerk && <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-xs font-semibold ${draft.customPerkIncluded ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}><input type="checkbox" checked={Boolean(draft.customPerkIncluded)} onChange={() => toggle("customPerkIncluded")} className="h-4 w-4 rounded border-slate-300 text-emerald-600" /><span>Include custom perk: {benefits.customPerk}</span></label>}
              </div>
            </div>
          )}

          {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-800">{error}</p>}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-7">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 disabled:opacity-50">Review later</button>
          <button type="button" onClick={confirm} disabled={busy || giftOptionsLoading || Boolean(giftOptionsError)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Confirm checklist</button>
        </footer>
      </div>
    </div>
  );
};

export default FulfillmentChecklistModal;
