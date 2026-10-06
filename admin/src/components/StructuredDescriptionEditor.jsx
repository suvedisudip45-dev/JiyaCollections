/* eslint-disable react/prop-types */
import React, { useState } from "react";
import { Sparkles, FileText, Shirt, Ruler, CheckCircle2 } from "lucide-react";
import { transliterateText } from "../utils/transliteration";

/**
 * StructuredDescriptionEditor
 * ─────────────────────────────────────────────────────────────
 * Organizes product descriptions into three canonical catalog sections:
 * 1. About / Overview (Main story & highlights)
 * 2. Fabric & Care (Material blend, wash care)
 * 3. Size & Fit / Model Info (Measurements, fit silhouette)
 *
 * Provides real-time Nepali transliteration helpers for each section.
 */
const StructuredDescriptionEditor = ({
  values = { about: "", fabricCare: "", sizeFit: "" },
  onChange,
  token,
}) => {
  const [activeTab, setActiveTab] = useState("about"); // "about" | "fabricCare" | "sizeFit"
  const [isTransliterating, setIsTransliterating] = useState(false);

  const handleSectionChange = (field, text) => {
    onChange({
      ...values,
      [field]: text,
    });
  };

  const handleAutoTransliterateSection = async (field) => {
    const currentText = values[field];
    if (!currentText || !currentText.trim()) return;

    setIsTransliterating(true);
    try {
      const transliterated = await transliterateText(currentText, token);
      if (transliterated) {
        handleSectionChange(field, transliterated);
      }
    } finally {
      setIsTransliterating(false);
    }
  };

  const tabs = [
    {
      id: "about",
      label: "About & Story",
      icon: FileText,
      placeholder:
        "Highlight the garment inspiration, silhouette, design features, and everyday wearability...",
      hint: "Overview displayed in the primary bio & description tabs.",
    },
    {
      id: "fabricCare",
      label: "Fabric & Care",
      icon: Shirt,
      placeholder:
        "e.g. 100% Ring-spun Combed Cotton (240 GSM). Machine wash cold inside-out, tumble dry low, do not iron on print.",
      hint: "Helps customers understand washing instructions and textile longevity.",
    },
    {
      id: "sizeFit",
      label: "Size & Fit",
      icon: Ruler,
      placeholder:
        "e.g. Relaxed oversized streetwear fit. Model is 5'11\" (180 cm) with a 38\" chest wearing Size L.",
      hint: "Guides shoppers on fit aesthetics, sizing up/down, and model stats.",
    },
  ];

  const currentTabConfig = tabs.find((t) => t.id === activeTab) || tabs[0];

  return (
    <div className="w-full bg-slate-50 border border-slate-200/90 rounded-2xl p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Structured Product Description
            </h4>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Organized sections automatically rendered in Storefront tabs and story letters.
          </p>
        </div>

        {/* Section Tabs */}
        <div className="flex bg-slate-200/70 p-1 rounded-xl gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const hasContent = Boolean(values[tab.id]?.trim());
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  isActive
                    ? "bg-white text-slate-900 shadow-xs scale-[1.02]"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-indigo-600" : "text-slate-400"}`} />
                <span>{tab.label}</span>
                {hasContent && (
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 ml-0.5" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Editor Pane */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
            <span>{currentTabConfig.label} Content</span>
            <span className="text-[10px] text-slate-400 font-normal">
              ({(values[activeTab] || "").length} characters)
            </span>
          </label>

          <button
            type="button"
            disabled={isTransliterating || !values[activeTab]?.trim()}
            onClick={() => handleAutoTransliterateSection(activeTab)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/80 transition-all disabled:opacity-40 cursor-pointer"
            title="Convert English typed Roman text in this section to Nepali Unicode"
          >
            <Sparkles className="w-3 h-3 text-indigo-600" />
            <span>{isTransliterating ? "Transliterating..." : "Auto-Transliterate to Nepali"}</span>
          </button>
        </div>

        <textarea
          value={values[activeTab] || ""}
          onChange={(e) => handleSectionChange(activeTab, e.target.value)}
          placeholder={currentTabConfig.placeholder}
          rows={3}
          className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-800 leading-relaxed focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-500/20 transition-all font-sans"
        />

        <p className="text-[10px] text-slate-500 italic">
          💡 {currentTabConfig.hint}
        </p>
      </div>
    </div>
  );
};

export default StructuredDescriptionEditor;
