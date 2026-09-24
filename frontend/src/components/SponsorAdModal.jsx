/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import { Sparkles, ExternalLink, ArrowRight, X } from "lucide-react";

export const SponsorAdModal = ({
  isOpen,
  onClose,
  onProceed,
  ad = null,
  partner = {},
}) => {
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    if (!isOpen || !ad) return;
    setCountdown(3);
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, ad]);

  if (!isOpen || !ad || ad.mediaType === "NONE" || !ad.mediaUrl) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-4 animate-fade-in">
      <div className="relative w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden border border-slate-200 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-400 text-slate-950">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                Exclusive Partner Spotlight
              </p>
              <h3 className="text-sm font-black tracking-wide">
                {partner.name || "Brand Partner"} × Aama Clothings
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Media Container */}
        <div className="relative bg-slate-100 max-h-[300px] overflow-hidden flex items-center justify-center">
          {ad.mediaType === "VIDEO" ? (
            <video
              src={ad.mediaUrl}
              autoPlay
              muted
              playsInline
              controls
              className="w-full max-h-[280px] object-cover"
            />
          ) : (
            <img
              src={ad.mediaUrl}
              alt="Partner Sponsor"
              className="w-full max-h-[280px] object-cover"
            />
          )}
        </div>

        {/* Ad Details */}
        <div className="p-6 space-y-4">
          <div>
            <h4 className="text-base font-black text-slate-900 leading-tight">
              {ad.headline || `${partner.name} Exclusive Reward`}
            </h4>
            {ad.description && (
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                {ad.description}
              </p>
            )}
          </div>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row items-center gap-2 pt-2 border-t border-slate-100">
            {ad.externalLink && (
              <a
                href={ad.externalLink}
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                <span>Visit Store</span>
                <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
              </a>
            )}

            <button
              type="button"
              onClick={onProceed}
              className="w-full flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 py-2.5 px-4 text-xs font-black text-white shadow hover:bg-slate-800 transition-all"
            >
              <span>{countdown > 0 ? `Proceed in ${countdown}s` : "Proceed to Scan QR"}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SponsorAdModal;
