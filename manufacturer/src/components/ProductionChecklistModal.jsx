import React, { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { X, CheckCircle2, AlertTriangle, ShieldCheck, Layers, Scissors, Palette } from "lucide-react";
import { backendUrl } from "../context/ManufacturerContext";

export const PreProductionChecklistModal = ({ request, token, onClose, onSuccess }) => {
  const [submitting, setSubmitting] = useState(false);
  const [fabricPassed, setFabricPassed] = useState(true);
  const [samplePassed, setSamplePassed] = useState(true);
  const [colorShadePassed, setColorShadePassed] = useState(true);
  const [notes, setNotes] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!fabricPassed || !samplePassed || !colorShadePassed) {
      toast.warn("All pre-production quality checks must pass before starting production.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await axios.patch(
        `${backendUrl}/api/manufacturer/production/${request.id}/pre-check`,
        {
          fabricCheckPassed: fabricPassed,
          sampleCheckPassed: samplePassed,
          colorShadeCheckPassed: colorShadePassed,
          notes: notes.trim() || undefined,
        },
        { headers: { token } }
      );
      toast.success(response.data.message || "Pre-production checklist passed!");
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to record pre-production check.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#dedbd3] bg-[#f8f7f4]">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#171717]" />
            <h2 className="text-base font-bold text-[#171717]">Pre-Production Quality Gate</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#575757] hover:text-[#171717] p-1 rounded-lg hover:bg-[#dedbd3]/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="p-3.5 bg-[#f8f7f4] rounded-xl border border-[#dedbd3] text-xs text-[#575757]">
            <p className="font-semibold text-[#171717]">Order #{request.id.slice(0, 8)}: {request.product?.name || "Product"}</p>
            <p className="mt-0.5">Fabric: {request.fabricType || "Standard Cotton"} • Target GSM: {request.targetGsm || "180"} • Planned: {request.requestedQuantity} units</p>
          </div>

          <div className="space-y-3">
            {/* Fabric Quality Gate */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-[#dedbd3] hover:border-[#171717]/40 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#f8f7f4] flex items-center justify-center border border-[#dedbd3]">
                  <Layers className="w-4 h-4 text-[#171717]" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#171717]">Fabric Material &amp; GSM Verified</p>
                  <p className="text-[11px] text-[#575757]">Knitting, yarn consistency &amp; GSM within tolerance</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFabricPassed(!fabricPassed)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-all ${
                  fabricPassed
                    ? "bg-[#171717] text-white border-[#171717]"
                    : "bg-[#ffffff] text-[#575757] border-[#dedbd3]"
                }`}
              >
                {fabricPassed ? "PASSED" : "FAILED"}
              </button>
            </div>

            {/* Sample Quality Gate */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-[#dedbd3] hover:border-[#171717]/40 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#f8f7f4] flex items-center justify-center border border-[#dedbd3]">
                  <Scissors className="w-4 h-4 text-[#171717]" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#171717]">Sample Pattern &amp; Sizing Approved</p>
                  <p className="text-[11px] text-[#575757]">Cut piece measurements match sizing chart</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSamplePassed(!samplePassed)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-all ${
                  samplePassed
                    ? "bg-[#171717] text-white border-[#171717]"
                    : "bg-[#ffffff] text-[#575757] border-[#dedbd3]"
                }`}
              >
                {samplePassed ? "PASSED" : "FAILED"}
              </button>
            </div>

            {/* Color Shade Gate */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-[#dedbd3] hover:border-[#171717]/40 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#f8f7f4] flex items-center justify-center border border-[#dedbd3]">
                  <Palette className="w-4 h-4 text-[#171717]" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#171717]">Color Shade &amp; Dye Consistency</p>
                  <p className="text-[11px] text-[#575757]">Dye lot matches approved color swatch standard</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setColorShadePassed(!colorShadePassed)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-all ${
                  colorShadePassed
                    ? "bg-[#171717] text-white border-[#171717]"
                    : "bg-[#ffffff] text-[#575757] border-[#dedbd3]"
                }`}
              >
                {colorShadePassed ? "PASSED" : "FAILED"}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#171717] mb-1">Pre-Check QA Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., Fabric lot #402 approved, test wash passed with 0% shrinkage."
              className="w-full text-xs p-2.5 rounded-xl border border-[#dedbd3] bg-[#ffffff] text-[#171717] focus:outline-none focus:border-[#171717] resize-none h-18"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#dedbd3]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#575757] hover:text-[#171717] rounded-xl hover:bg-[#f8f7f4] border border-[#dedbd3]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !fabricPassed || !samplePassed || !colorShadePassed}
              className="px-5 py-2 text-xs font-semibold bg-[#171717] text-white rounded-xl hover:bg-[#262626] transition-colors disabled:opacity-50"
            >
              {submitting ? "Verifying..." : "Approve Pre-Check & Enable Start"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const PostProductionChecklistModal = ({ request, token, onClose, onSuccess }) => {
  const [submitting, setSubmitting] = useState(false);
  const [stitchingPassed, setStitchingPassed] = useState(true);
  const [qualityPassed, setQualityPassed] = useState(true);
  const [colorPassed, setColorPassed] = useState(true);
  const [lines, setLines] = useState(() => {
    return (request.lines || []).map((line) => ({
      lineId: line.id,
      size: line.size,
      color: line.color,
      requestedQuantity: line.requestedQuantity || 0,
      actualQuantity: line.actualQuantity || line.requestedQuantity || 0,
      damagedQuantity: line.damagedQuantity || 0,
    }));
  });
  const [notes, setNotes] = useState("");

  const updateLine = (index, field, val) => {
    const num = Math.max(0, parseInt(val, 10) || 0);
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, [field]: num } : l))
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const response = await axios.patch(
        `${backendUrl}/api/manufacturer/production/${request.id}/post-check`,
        {
          stitchingCheckPassed: stitchingPassed,
          qualityCheckPassed: qualityPassed,
          colorCheckPassed: colorPassed,
          lines: lines.map((l) => ({
            lineId: l.lineId,
            actualQuantity: l.actualQuantity,
            damagedQuantity: l.damagedQuantity,
          })),
          notes: notes.trim() || undefined,
        },
        { headers: { token } }
      );
      toast.success(response.data.message || "Post-production inspection completed!");
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to record post-production checklist.");
    } finally {
      setSubmitting(false);
    }
  };

  const totalActual = lines.reduce((sum, l) => sum + l.actualQuantity, 0);
  const totalDamaged = lines.reduce((sum, l) => sum + l.damagedQuantity, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#dedbd3] bg-[#f8f7f4]">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-[#171717]" />
            <h2 className="text-base font-bold text-[#171717]">Post-Production QA &amp; Stock Intake</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#575757] hover:text-[#171717] p-1 rounded-lg hover:bg-[#dedbd3]/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Quality check toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => setStitchingPassed(!stitchingPassed)}
              className={`p-3 rounded-xl border text-left transition-all ${
                stitchingPassed ? "bg-[#171717] text-white border-[#171717]" : "bg-[#ffffff] text-[#575757] border-[#dedbd3]"
              }`}
            >
              <p className="text-[11px] font-bold">Stitching &amp; Trims</p>
              <p className="text-[10px] opacity-80 mt-0.5">{stitchingPassed ? "Passed" : "Failed"}</p>
            </button>

            <button
              type="button"
              onClick={() => setQualityPassed(!qualityPassed)}
              className={`p-3 rounded-xl border text-left transition-all ${
                qualityPassed ? "bg-[#171717] text-white border-[#171717]" : "bg-[#ffffff] text-[#575757] border-[#dedbd3]"
              }`}
            >
              <p className="text-[11px] font-bold">Labels &amp; Brand Tags</p>
              <p className="text-[10px] opacity-80 mt-0.5">{qualityPassed ? "Passed" : "Failed"}</p>
            </button>

            <button
              type="button"
              onClick={() => setColorPassed(!colorPassed)}
              className={`p-3 rounded-xl border text-left transition-all ${
                colorPassed ? "bg-[#171717] text-white border-[#171717]" : "bg-[#ffffff] text-[#575757] border-[#dedbd3]"
              }`}
            >
              <p className="text-[11px] font-bold">Final Color/Wash QA</p>
              <p className="text-[10px] opacity-80 mt-0.5">{colorPassed ? "Passed" : "Failed"}</p>
            </button>
          </div>

          {/* Size/Color quantity table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-[#171717]">Actual Produced vs. Damaged Units</label>
              <span className="text-[11px] text-[#575757]">
                Total Good: <strong className="text-[#171717]">{totalActual}</strong> • Damaged: <strong className="text-rose-600">{totalDamaged}</strong>
              </span>
            </div>

            <div className="border border-[#dedbd3] rounded-xl overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#f8f7f4] border-b border-[#dedbd3] text-[#575757] font-semibold">
                  <tr>
                    <th className="p-2.5">Variant</th>
                    <th className="p-2.5">Target</th>
                    <th className="p-2.5">Good Units (Actual)</th>
                    <th className="p-2.5">Damaged / Scrap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#dedbd3]">
                  {lines.map((line, idx) => (
                    <tr key={line.lineId || idx} className="hover:bg-[#f8f7f4]/50">
                      <td className="p-2.5 font-medium text-[#171717]">
                        {line.size} / {line.color}
                      </td>
                      <td className="p-2.5 text-[#575757]">{line.requestedQuantity}</td>
                      <td className="p-2.5">
                        <input
                          type="number"
                          min="0"
                          value={line.actualQuantity}
                          onChange={(e) => updateLine(idx, "actualQuantity", e.target.value)}
                          className="w-20 p-1.5 border border-[#dedbd3] rounded-lg text-xs font-semibold focus:outline-none focus:border-[#171717]"
                        />
                      </td>
                      <td className="p-2.5">
                        <input
                          type="number"
                          min="0"
                          value={line.damagedQuantity}
                          onChange={(e) => updateLine(idx, "damagedQuantity", e.target.value)}
                          className="w-20 p-1.5 border border-[#dedbd3] rounded-lg text-xs font-semibold text-rose-600 focus:outline-none focus:border-rose-600"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#171717] mb-1">QA Remarks &amp; Finishing Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., Final batch ironing & packaging completed. Good units moved to stock."
              className="w-full text-xs p-2.5 rounded-xl border border-[#dedbd3] bg-[#ffffff] text-[#171717] focus:outline-none focus:border-[#171717] resize-none h-16"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#dedbd3]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#575757] hover:text-[#171717] rounded-xl hover:bg-[#f8f7f4] border border-[#dedbd3]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-semibold bg-[#171717] text-white rounded-xl hover:bg-[#262626] transition-colors disabled:opacity-50"
            >
              {submitting ? "Finalizing..." : "Complete Production & Receive Stock"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
