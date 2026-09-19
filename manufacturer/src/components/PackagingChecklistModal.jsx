import React, { useState } from "react";
import {
  ShieldCheck,
  Gift,
  HeartHandshake,
  FileText,
  CreditCard,
  CheckSquare,
  Square,
  AlertCircle,
  X,
  Sparkles,
  CheckCircle2,
  PackageCheck,
} from "lucide-react";

const PackagingChecklistModal = ({
  isOpen,
  onClose,
  onConfirm,
  assignment,
  targetStatus, // 'packed' or 'ready_for_pickup'
  currency = "Rs.",
}) => {
  const order = assignment?.order || {};
  const benefits = order?.fulfillmentBenefits || {};

  // Dynamically detect which perks apply to this specific customer / order
  const hasLoyaltyGift = Boolean(
    benefits.giftDescription || (benefits.giftAmount && benefits.giftAmount > 0)
  );
  const hasHandwrittenLetter = Boolean(benefits.handwrittenCard);
  const hasCustomPerk = Boolean(benefits.customPerk);
  const hasOfferItems = Array.isArray(benefits.offerItems) && benefits.offerItems.length > 0;
  const isVipOrLoyal =
    benefits.loyaltyTier && benefits.loyaltyTier !== "Standard customer";
  const hasAnyPerks =
    hasLoyaltyGift || hasHandwrittenLetter || hasCustomPerk || isVipOrLoyal;

  // Extract initial checklist from notes if previously saved
  const initialChecklist = (() => {
    try {
      if (assignment?.notes) {
        const parsed = JSON.parse(assignment.notes);
        if (parsed?.packagingChecklist) {
          return parsed.packagingChecklist;
        }
      }
    } catch {
      // fallback
    }
    return {};
  })();

  const [checklist, setChecklist] = useState({
    loyaltyGift: initialChecklist.loyaltyGift ?? hasLoyaltyGift,
    thankYouLetter: initialChecklist.thankYouLetter ?? hasHandwrittenLetter,
    customPerkIncluded: initialChecklist.customPerkIncluded ?? hasCustomPerk,
    additionalLetter: initialChecklist.additionalLetter ?? false,
    marketingCard: initialChecklist.marketingCard ?? false,
    marketingCardId: initialChecklist.marketingCardId ?? "",
    qualityCheck: initialChecklist.qualityCheck ?? true,
  });

  const [validationError, setValidationError] = useState("");

  if (!isOpen) return null;

  const toggleCheck = (field) => {
    setChecklist((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
    setValidationError("");
  };

  const handleMarketingCardIdChange = (val) => {
    setChecklist((prev) => ({
      ...prev,
      marketingCardId: val,
    }));
    setValidationError("");
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // Validation: only validate what is genuinely required for this specific order
    if (hasLoyaltyGift && !checklist.loyaltyGift) {
      setValidationError(
        `Please verify that the required Loyalty Card gift (${
          benefits.giftDescription || "Gift Item"
        }) is included.`
      );
      return;
    }

    if (hasHandwrittenLetter && !checklist.thankYouLetter) {
      setValidationError(
        "Please verify that the handwritten thank-you letter is enclosed as requested for this tier."
      );
      return;
    }

    if (checklist.marketingCard && !checklist.marketingCardId.trim()) {
      setValidationError("Please enter the Marketing Partner Card ID.");
      return;
    }

    const payload = {
      ...checklist,
      hasLoyaltyGift,
      hasHandwrittenLetter,
      giftDescription: benefits.giftDescription || "",
      loyaltyTier: benefits.loyaltyTier || "",
      verifiedAt: new Date().toISOString(),
    };

    onConfirm(payload);
  };

  const actionTitle =
    targetStatus === "ready_for_pickup"
      ? "Confirm & Dispatch to Courier"
      : "Confirm & Mark as Packed";

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full p-6 md:p-8 shadow-2xl space-y-6 animate-in fade-in zoom-in duration-200 my-8">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/20">
              <PackageCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-black text-slate-900">
                Packaging &amp; Inclusions Checklist
              </h2>
              <p className="text-xs text-slate-500">
                Dynamically fetched perks and package inclusions for Order #{assignment?.order?.id || assignment?.id}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dynamic Loyalty Perks Summary Banner */}
        {hasAnyPerks ? (
          <div className="rounded-2xl border border-teal-200/80 bg-teal-50/50 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-600" />
                <span className="text-xs font-bold text-teal-900 uppercase tracking-wide">
                  Loyalty Level: {benefits.loyaltyTier || "VIP Member"}
                </span>
              </div>
              {benefits.rewardUsage && (
                <span className="text-[10px] font-semibold bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full">
                  {benefits.rewardUsage}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-700">
              {benefits.giftDescription ? (
                <div className="bg-white rounded-xl p-2.5 border border-teal-100 shadow-2xs">
                  🎁 <strong>Gift to Include:</strong> {benefits.giftDescription}
                </div>
              ) : null}
              {benefits.handwrittenCard ? (
                <div className="bg-amber-50/90 rounded-xl p-2.5 border border-amber-200 text-amber-900 font-semibold shadow-2xs">
                  ✍️ <strong>Handwritten Note:</strong> Required
                </div>
              ) : null}
              {benefits.customPerk ? (
                <div className="bg-white rounded-xl p-2.5 border border-teal-100 shadow-2xs">
                  ⭐ <strong>Custom Perk:</strong> {benefits.customPerk}
                </div>
              ) : null}
              {benefits.totalDiscount > 0 ? (
                <div className="bg-white rounded-xl p-2.5 border border-teal-100 shadow-2xs">
                  🏷️ <strong>Discount:</strong> {currency}{benefits.totalDiscount.toLocaleString()}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <p className="text-xs font-bold text-slate-800">Standard Customer Package</p>
              <p className="text-[11px] text-slate-500">
                No extra physical loyalty gifts or special letters required for this order.
              </p>
            </div>
          </div>
        )}

        {/* Dynamic Checklist Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Items to be added with package
            </span>
          </div>

          {/* 1. Dynamic Loyalty Gift Checkbox (Only highlighted if customer earned a gift) */}
          {hasLoyaltyGift && (
            <div
              onClick={() => toggleCheck("loyaltyGift")}
              className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 select-none ${
                checklist.loyaltyGift
                  ? "bg-emerald-50/80 border-emerald-300 shadow-xs"
                  : "bg-slate-50 border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="mt-0.5 text-emerald-600 shrink-0">
                {checklist.loyaltyGift ? (
                  <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                ) : (
                  <Square className="w-5 h-5 text-slate-400" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Gift className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold text-slate-900">
                    Gifts from Loyalty Card Included <span className="text-rose-500">*</span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5 font-medium">
                  Pack physical gift: <span className="font-bold text-emerald-800">{benefits.giftDescription}</span>
                </p>
              </div>
            </div>
          )}

          {/* 2. Dynamic Handwritten Thank-You Letter Checkbox */}
          {hasHandwrittenLetter && (
            <div
              onClick={() => toggleCheck("thankYouLetter")}
              className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 select-none ${
                checklist.thankYouLetter
                  ? "bg-emerald-50/80 border-emerald-300 shadow-xs"
                  : "bg-slate-50 border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="mt-0.5 text-emerald-600 shrink-0">
                {checklist.thankYouLetter ? (
                  <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                ) : (
                  <Square className="w-5 h-5 text-slate-400" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <HeartHandshake className="w-4 h-4 text-rose-500" />
                  <span className="text-xs font-bold text-slate-900">
                    Handwritten Thank-You Letter Enclosed <span className="text-rose-500">*</span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Personalized thank-you letter placed inside the garment packaging.
                </p>
              </div>
            </div>
          )}

          {/* 3. Dynamic Custom Perk Checkbox if present */}
          {hasCustomPerk && (
            <div
              onClick={() => toggleCheck("customPerkIncluded")}
              className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 select-none ${
                checklist.customPerkIncluded
                  ? "bg-emerald-50/80 border-emerald-300 shadow-xs"
                  : "bg-slate-50 border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="mt-0.5 text-emerald-600 shrink-0">
                {checklist.customPerkIncluded ? (
                  <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                ) : (
                  <Square className="w-5 h-5 text-slate-400" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-teal-600" />
                  <span className="text-xs font-bold text-slate-900">
                    Custom Perk Fulfilled: {benefits.customPerk}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 4. Additional letter */}
          <div
            onClick={() => toggleCheck("additionalLetter")}
            className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 select-none ${
              checklist.additionalLetter
                ? "bg-emerald-50/80 border-emerald-300 shadow-xs"
                : "bg-slate-50 border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="mt-0.5 text-emerald-600 shrink-0">
              {checklist.additionalLetter ? (
                <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-100" />
              ) : (
                <Square className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-bold text-slate-900">
                  Additional Letter
                </span>
              </div>
            </div>
          </div>

          {/* 5. Marketing partner card */}
          <div
            className={`p-3.5 rounded-2xl border transition-all space-y-3 ${
              checklist.marketingCard
                ? "bg-amber-50/50 border-amber-300 shadow-xs"
                : "bg-slate-50 border-slate-200"
            }`}
          >
            <div
              onClick={() => toggleCheck("marketingCard")}
              className="flex items-start gap-3.5 cursor-pointer select-none"
            >
              <div className="mt-0.5 text-amber-600 shrink-0">
                {checklist.marketingCard ? (
                  <CheckSquare className="w-5 h-5 text-amber-600 fill-amber-100" />
                ) : (
                  <Square className="w-5 h-5 text-slate-400" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-bold text-slate-900">
                    Marketing Partner Card
                  </span>
                </div>
              </div>
            </div>

            {checklist.marketingCard && (
              <div className="pt-2 border-t border-amber-200/80 pl-8 space-y-1.5 animate-in fade-in duration-150">
                <label className="block text-[11px] font-bold text-amber-900">
                  Marketing Partner Card ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter Card ID"
                  value={checklist.marketingCardId}
                  onChange={(e) => handleMarketingCardIdChange(e.target.value)}
                  className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  required={checklist.marketingCard}
                />
              </div>
            )}
          </div>

          {/* 6. Garment Quality & Packaging Seal Check */}
          <div
            onClick={() => toggleCheck("qualityCheck")}
            className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 select-none ${
              checklist.qualityCheck
                ? "bg-emerald-50/80 border-emerald-300 shadow-xs"
                : "bg-slate-50 border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="mt-0.5 text-emerald-600 shrink-0">
              {checklist.qualityCheck ? (
                <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-100" />
              ) : (
                <Square className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-slate-900">
                  Garment Inspection &amp; Packaging Sealed
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Garments inspected, tag attached, and enclosed in waterproof packaging.
              </p>
            </div>
          </div>

          {/* Validation error display */}
          {validationError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs font-bold text-rose-700 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl font-bold text-xs shadow-md shadow-emerald-600/20 cursor-pointer transition-all"
            >
              {actionTitle}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PackagingChecklistModal;
