import React, { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Gift, HeartHandshake, PackageCheck, X } from "lucide-react";

const REQUIRED_CHECKS = [
  ["productVerified", "Product and quantity verified"],
  ["sizeColorVerified", "Size and color verified"],
  ["stitchingVerified", "Stitching completed and inspected"],
  ["brandingVerified", "Branding, tags, and labels verified"],
  ["qualityVerified", "Quality check passed"],
  ["customerLetterIncluded", "Compulsory customer letter included"],
  ["addressVerified", "Customer address and phone verified"],
  ["packagingMaterialsVerified", "Packaging materials and seal verified"],
];

const FulfillmentChecklistModal = ({ isOpen, assignment, checklist, benefits = {}, onClose, onConfirm, busy = false }) => {
  const [draft, setDraft] = useState(checklist);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setDraft(checklist);
      setError("");
    }
  }, [isOpen, checklist]);

  const completedRequired = useMemo(
    () => REQUIRED_CHECKS.filter(([key]) => draft[key] === true).length,
    [draft]
  );
  const allRequiredComplete = completedRequired === REQUIRED_CHECKS.length;
  const hasGift = Boolean(benefits.giftDescription || benefits.giftAmount > 0);
  const hasCustomPerk = Boolean(benefits.customPerk);

  if (!isOpen) return null;

  const toggle = (key) => {
    setDraft((previous) => ({ ...previous, [key]: !previous[key] }));
    setError("");
  };

  const confirm = () => {
    if (!allRequiredComplete) {
      setError(`Complete all required checks. ${REQUIRED_CHECKS.length - completedRequired} remaining.`);
      return;
    }
    if (draft.marketingCard && !String(draft.marketingCardId || "").trim()) {
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
              <span className="text-[11px] font-black text-indigo-700">{completedRequired}/{REQUIRED_CHECKS.length}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${(completedRequired / REQUIRED_CHECKS.length) * 100}%` }} /></div>
          </div>

          <div className="space-y-2">
            {REQUIRED_CHECKS.map(([key, label]) => (
              <label key={key} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-xs font-semibold transition ${draft[key] ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"}`}>
                <input type="checkbox" checked={Boolean(draft[key])} onChange={() => toggle(key)} className="sr-only" />
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${draft[key] ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white"}`}>
                  {draft[key] && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
                <span>{label}</span>
              </label>
            ))}
          </div>

          {(hasGift || hasCustomPerk || benefits.handwrittenCard) && (
            <div className="mt-6 border-t border-slate-100 pt-5">
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Optional inclusions for this customer</p>
              <div className="space-y-2">
                {hasGift && <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-xs font-semibold ${draft.loyaltyGift ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}><input type="checkbox" checked={Boolean(draft.loyaltyGift)} onChange={() => toggle("loyaltyGift")} className="h-4 w-4 rounded border-slate-300 text-emerald-600" /><Gift className="h-4 w-4 text-emerald-600" /><span>Include gift: {benefits.giftDescription || "Loyalty gift"}</span></label>}
                {benefits.handwrittenCard && <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-xs font-semibold ${draft.thankYouLetter ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}><input type="checkbox" checked={Boolean(draft.thankYouLetter)} onChange={() => toggle("thankYouLetter")} className="h-4 w-4 rounded border-slate-300 text-emerald-600" /><HeartHandshake className="h-4 w-4 text-rose-500" /><span>Include handwritten thank-you letter</span></label>}
                {hasCustomPerk && <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-xs font-semibold ${draft.customPerkIncluded ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}><input type="checkbox" checked={Boolean(draft.customPerkIncluded)} onChange={() => toggle("customPerkIncluded")} className="h-4 w-4 rounded border-slate-300 text-emerald-600" /><span>Include custom perk: {benefits.customPerk}</span></label>}
              </div>
            </div>
          )}

          {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-800">{error}</p>}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-7">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 disabled:opacity-50">Review later</button>
          <button type="button" onClick={confirm} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Confirm checklist</button>
        </footer>
      </div>
    </div>
  );
};

export default FulfillmentChecklistModal;
