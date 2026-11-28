import React from "react";
import {
  Award,
  Star,
  FileCheck,
  Download,
  Calendar,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Percent,
  Building2,
} from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";

const Performance = () => {
  const { manufacturer } = useManufacturer();

  if (!manufacturer) return null;

  const qualityScore = manufacturer.qualityRating || 5.0;
  const isGoodQuality = qualityScore >= 4.0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900">
          Hub Governance, Quality &amp; Agreement
        </h1>
        <p className="text-xs text-slate-500">
          Compliance metrics, audit ratings, and master manufacturing agreement
        </p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Quality Rating Card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Quality Audit Rating
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Star className="w-4 h-4 fill-amber-500" />
            </div>
          </div>

          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-black text-slate-900">
              {qualityScore.toFixed(1)}
            </span>
            <span className="text-slate-400 text-sm">/ 5.0 Rating</span>
          </div>

          {/* Star Bar */}
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`w-5 h-5 ${
                  star <= Math.round(qualityScore)
                    ? "fill-amber-400 text-amber-400"
                    : "text-slate-200"
                }`}
              />
            ))}
          </div>

          <p className="text-xs text-slate-600">
            {isGoodQuality
              ? "Your hub maintains top-tier quality compliance. High rating prioritizes your hub in nearest-order auto allocation."
              : "Quality score needs improvement. Please review stitching precision and packing standards."}
          </p>

          <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl">
              <span className="text-slate-400 block text-[10px] uppercase font-bold">
                Orders Completed
              </span>
              <span className="text-base font-black text-slate-900">
                {manufacturer.totalOrdersHandled || 0}
              </span>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <span className="text-slate-400 block text-[10px] uppercase font-bold">
                Dispatch Status
              </span>
              <span className="text-base font-black text-emerald-600">
                {manufacturer.isAvailable ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </div>

        {/* Master Agreement Card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Manufacturing Agreement
            </span>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                manufacturer.contractStatus === "ACTIVE"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              }`}
            >
              {manufacturer.contractStatus || "ACTIVE"}
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <span className="text-slate-500">Legal Entity</span>
              <span className="font-bold text-slate-900">{manufacturer.businessName}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <span className="text-slate-500">Assigned City</span>
              <span className="font-bold text-slate-900">{manufacturer.city}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <span className="text-slate-500">Contract Start</span>
              <span className="font-bold text-slate-900">
                {manufacturer.contractStart
                  ? new Date(manufacturer.contractStart).toLocaleDateString()
                  : "2024-01-01"}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <span className="text-slate-500">Contract Expiry</span>
              <span className="font-bold text-slate-900">
                {manufacturer.contractEnd
                  ? new Date(manufacturer.contractEnd).toLocaleDateString()
                  : "2027-01-01"}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-slate-500">Payout Model</span>
              <span className="font-bold text-emerald-600">
                100% Agreed Supply COGS
              </span>
            </div>
          </div>

          {/* Contract Document Download Link */}
          {manufacturer.contractDocUrl ? (
            <a
              href={manufacturer.contractDocUrl}
              target="_blank"
              rel="noreferrer"
              className="w-full mt-2 py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Signed Legal Contract (PDF)
            </a>
          ) : (
            <div className="p-3 bg-slate-50 rounded-xl text-center text-xs text-slate-400">
              Contract document on digital file with Aashrit Corner Head Office
            </div>
          )}
        </div>
      </div>

      {/* Brand Standard & Quality Protocol Checklist */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
        <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          Aashrit Corner Brand Quality Standards
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900">100% Certified Organic Fabrics</p>
              <p className="text-slate-500 text-[11px] mt-0.5">
                All garments must adhere to authentic cotton/linen yarn specifications authorized by Head Office.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900">Standardized Sizing Dimensions</p>
              <p className="text-slate-500 text-[11px] mt-0.5">
                Ensure strict tolerance of less than 0.5 cm variance across S, M, L, XL, XXL templates.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900">Brand Tagging &amp; Hologram</p>
              <p className="text-slate-500 text-[11px] mt-0.5">
                Attach official Aashrit Corner woven labels and authenticity swing tags prior to sealing the parcel.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900">24-Hour Packaging Dispatch SLA</p>
              <p className="text-slate-500 text-[11px] mt-0.5">
                Assigned orders must be packed and marked ready for delivery partner pickup within 24 hours.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Performance;
