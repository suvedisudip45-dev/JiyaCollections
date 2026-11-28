/* eslint-disable react/prop-types */
import { useState } from "react";
import { CheckCircle2, FileText, ListPlus, Plus, Ruler, Shirt, Sparkles, Table2, Trash2 } from "lucide-react";
import { transliterateText } from "../utils/transliteration";

const normalizeSection = (section) => {
  if (typeof section === "string") {
    return { blocks: section ? [{ type: "paragraph", text: section }] : [] };
  }
  if (section && typeof section === "object" && Array.isArray(section.blocks)) {
    return { blocks: section.blocks };
  }
  return { blocks: [] };
};

const createSizeChart = () => ({
  title: "Garment Sizing Guide",
  subtitle: "",
  headers: ["Size", "Chest", "Shoulder"],
  rows: [["S", "", ""], ["M", "", ""], ["L", "", ""]],
  fitTip: "",
});

const StructuredDescriptionEditor = ({ values = {}, onChange, token }) => {
  const [activeTab, setActiveTab] = useState("about");
  const [isTransliterating, setIsTransliterating] = useState(false);
  const isSizeChartTab = activeTab === "sizeChart";
  const section = normalizeSection(values[activeTab]);
  const sizeChart = values.sizeChart;

  const updateBlocks = (blocks) => {
    onChange({ ...values, [activeTab]: { blocks } });
  };

  const updateBlock = (index, updatedBlock) => {
    updateBlocks(section.blocks.map((block, blockIndex) =>
      blockIndex === index ? updatedBlock : block
    ));
  };

  const addParagraph = () => updateBlocks([...section.blocks, { type: "paragraph", text: "" }]);
  const addList = () => updateBlocks([...section.blocks, { type: "list", items: [""] }]);
  const addTable = () => updateBlocks([
    ...section.blocks,
    { type: "table", headers: ["Detail", "Information"], rows: [["", ""]] },
  ]);
  const updateSizeChart = (updates) => onChange({
    ...values,
    sizeChart: { ...sizeChart, ...updates },
  });

  const handleAutoTransliterate = async (blockIndex, itemIndex = null) => {
    const block = section.blocks[blockIndex];
    const text = itemIndex === null ? block.text : block.items[itemIndex];
    if (!text?.trim()) return;

    setIsTransliterating(true);
    try {
      const transliterated = await transliterateText(text, token);
      if (!transliterated) return;
      if (itemIndex === null) {
        updateBlock(blockIndex, { ...block, text: transliterated });
      } else {
        const items = [...block.items];
        items[itemIndex] = transliterated;
        updateBlock(blockIndex, { ...block, items });
      }
    } finally {
      setIsTransliterating(false);
    }
  };

  const tabs = [
    { id: "about", label: "About & Story", icon: FileText },
    { id: "fabricCare", label: "Fabric & Care", icon: Shirt },
    { id: "sizeChart", label: "Size Chart", icon: Ruler },
  ];

  return (
    <div className="w-full space-y-4 rounded-2xl border border-slate-200/90 bg-slate-50 p-4">
      <div className="flex flex-col justify-between gap-3 border-b border-slate-200/80 pb-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Product Description &amp; Size Chart
            </h4>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Descriptions support paragraphs, lists, and tables. A product size chart is optional and editable.
          </p>
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-200/70 p-1">
          {tabs.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            const hasContent = id === "sizeChart"
              ? Boolean(sizeChart)
              : normalizeSection(values[id]).blocks.length > 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all ${
                  isActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? "text-indigo-600" : "text-slate-400"}`} />
                {label}
                {hasContent && <CheckCircle2 className="ml-0.5 h-3 w-3 text-emerald-500" />}
              </button>
            );
          })}
        </div>
      </div>

      {isSizeChartTab ? (
        sizeChart ? (
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700">
                Chart title
                <input
                  value={sizeChart.title || ""}
                  onChange={(event) => updateSizeChart({ title: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal"
                />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Subtitle / unit
                <input
                  value={sizeChart.subtitle || ""}
                  onChange={(event) => updateSizeChart({ subtitle: event.target.value })}
                  placeholder="For example: Measurements in cm"
                  className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal"
                />
              </label>
            </div>
            {sizeChart.headers?.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-xs">
                  <caption className="sr-only">Product size measurement chart</caption>
                  <thead>
                    <tr>
                      {sizeChart.headers.map((header, columnIndex) => (
                        <th key={columnIndex} className="min-w-32 border border-slate-200 bg-slate-50 p-1.5">
                          <input
                            value={header}
                            aria-label={`Size chart column ${columnIndex + 1}`}
                            onChange={(event) => {
                              const headers = [...sizeChart.headers];
                              headers[columnIndex] = event.target.value;
                              updateSizeChart({ headers });
                            }}
                            className="w-full bg-transparent p-1 font-bold focus:outline-none"
                          />
                        </th>
                      ))}
                      <th scope="col" className="w-10 border border-slate-200 bg-slate-50 p-1">
                        <button
                          type="button"
                          onClick={() => updateSizeChart({
                            headers: [...sizeChart.headers, `Measurement ${sizeChart.headers.length}`],
                            rows: sizeChart.rows.map((row) => [...row, ""]),
                          })}
                          aria-label="Add measurement column"
                          className="rounded p-1 text-indigo-700 hover:bg-indigo-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sizeChart.rows || []).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {sizeChart.headers.map((_, columnIndex) => (
                          <td key={columnIndex} className="border border-slate-200 p-1">
                            <input
                              value={row[columnIndex] || ""}
                              aria-label={`Size chart row ${rowIndex + 1}, column ${columnIndex + 1}`}
                              onChange={(event) => {
                                const rows = sizeChart.rows.map((currentRow) => [...currentRow]);
                                rows[rowIndex][columnIndex] = event.target.value;
                                updateSizeChart({ rows });
                              }}
                              className="w-full min-w-24 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                            />
                          </td>
                        ))}
                        <td className="border border-slate-200 p-1 text-center">
                          <button
                            type="button"
                            onClick={() => updateSizeChart({ rows: sizeChart.rows.filter((_, index) => index !== rowIndex) })}
                            aria-label="Remove size chart row"
                            className="p-1 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 flex gap-4">
                  <button
                    type="button"
                    onClick={() => updateSizeChart({ rows: [...sizeChart.rows, sizeChart.headers.map(() => "")] })}
                    className="text-xs font-semibold text-indigo-700 hover:text-indigo-900"
                  >
                    + Add size row
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSizeChart({
                      headers: sizeChart.headers.slice(0, -1),
                      rows: sizeChart.rows.map((row) => row.slice(0, -1)),
                    })}
                    disabled={sizeChart.headers.length <= 2}
                    className="text-xs font-semibold text-slate-500 hover:text-red-600 disabled:opacity-40"
                  >
                    Remove last column
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center">
                <p className="text-xs text-slate-600">Set up a table with a size column and measurement columns.</p>
                <button
                  type="button"
                  onClick={() => updateSizeChart({
                    headers: ["Size", "Chest", "Shoulder"],
                    rows: [["S", "", ""], ["M", "", ""], ["L", "", ""]],
                  })}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-indigo-400"
                >
                  <Plus className="h-3.5 w-3.5" /> Set up measurement table
                </button>
              </div>
            )}
            {sizeChart.headers?.length > 0 && (
              <p className="text-[11px] text-slate-500">
                Enter a size in the first column and measurements in the remaining columns. Complete every cell before saving.
              </p>
            )}
            <label className="block text-xs font-semibold text-slate-700">
              Fit tip (optional)
              <textarea
                value={sizeChart.fitTip || ""}
                onChange={(event) => updateSizeChart({ fitTip: event.target.value })}
                rows={3}
                placeholder="Add fitting guidance or measurement notes."
                className="mt-1 w-full rounded-lg border border-slate-200 p-3 font-normal leading-relaxed"
              />
            </label>
            <button type="button" onClick={() => onChange({ ...values, sizeChart: null })} className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-800">
              <Trash2 className="h-3.5 w-3.5" /> Remove size chart
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
            <p className="text-sm font-semibold text-slate-800">No size chart configured</p>
            <p className="mt-1 text-xs text-slate-500">Add a chart only when this product needs product-specific measurements.</p>
            <button type="button" onClick={() => onChange({ ...values, sizeChart: createSizeChart() })} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700">
              <Plus className="h-3.5 w-3.5" /> Add size chart
            </button>
          </div>
        )
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={addParagraph} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-indigo-300">
              <Plus className="h-3.5 w-3.5" /> Paragraph
            </button>
            <button type="button" onClick={addList} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-indigo-300">
              <ListPlus className="h-3.5 w-3.5" /> Bullet list
            </button>
            <button type="button" onClick={addTable} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-indigo-300">
              <Table2 className="h-3.5 w-3.5" /> Table
            </button>
          </div>

          {section.blocks.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center text-xs text-slate-500">
              Add a paragraph, bullet list, or table to this section.
            </div>
          )}

          <div className="space-y-3">
            {section.blocks.map((block, blockIndex) => (
              <section key={`${block.type}-${blockIndex}`} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {block.type === "paragraph" ? "Paragraph" : block.type === "list" ? "Bullet list" : "Table"}
                  </span>
                  <button type="button" onClick={() => updateBlocks(section.blocks.filter((_, index) => index !== blockIndex))} aria-label="Remove content block" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {block.type === "paragraph" && (
                  <>
                    <textarea
                      value={block.text || ""}
                      onChange={(event) => updateBlock(blockIndex, { ...block, text: event.target.value })}
                      rows={4}
                      placeholder="Write a paragraph. Line breaks and blank lines are preserved."
                      className="w-full rounded-lg border border-slate-200 p-3 text-xs leading-relaxed text-slate-800 focus:border-indigo-500 focus:outline-none"
                    />
                    <button type="button" disabled={isTransliterating || !block.text?.trim()} onClick={() => handleAutoTransliterate(blockIndex)} className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 disabled:opacity-40">
                      <Sparkles className="h-3 w-3" /> {isTransliterating ? "Transliterating..." : "Auto-transliterate paragraph"}
                    </button>
                  </>
                )}

                {block.type === "list" && (
                  <div className="space-y-2">
                    {(block.items || []).map((item, itemIndex) => (
                      <div key={itemIndex} className="flex items-start gap-2">
                        <span className="pt-2 text-slate-400">•</span>
                        <textarea
                          value={item}
                          rows={2}
                          onChange={(event) => {
                            const items = [...block.items];
                            items[itemIndex] = event.target.value;
                            updateBlock(blockIndex, { ...block, items });
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-slate-200 p-2 text-xs leading-relaxed focus:border-indigo-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={isTransliterating || !item?.trim()}
                          onClick={() => handleAutoTransliterate(blockIndex, itemIndex)}
                          aria-label="Auto-transliterate list point"
                          className="p-2 text-indigo-600 disabled:opacity-40"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => updateBlock(blockIndex, { ...block, items: block.items.filter((_, index) => index !== itemIndex) })} aria-label="Remove list point" className="p-2 text-slate-400 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => updateBlock(blockIndex, { ...block, items: [...(block.items || []), ""] })} className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">
                      + Add point
                    </button>
                  </div>
                )}

                {block.type === "table" && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-xs">
                      <thead>
                        <tr>
                          {(block.headers || []).map((header, columnIndex) => (
                            <th key={columnIndex} className="min-w-28 border border-slate-200 bg-slate-50 p-1.5">
                              <input value={header} aria-label={`Table column ${columnIndex + 1} heading`} onChange={(event) => {
                                const headers = [...block.headers];
                                headers[columnIndex] = event.target.value;
                                updateBlock(blockIndex, { ...block, headers });
                              }} className="w-full bg-transparent p-1 font-bold focus:outline-none" />
                            </th>
                          ))}
                          <th className="w-10 border border-slate-200 bg-slate-50 p-1">
                            <button type="button" onClick={() => updateBlock(blockIndex, {
                              ...block,
                              headers: [...block.headers, `Column ${block.headers.length}`],
                              rows: block.rows.map((row) => [...row, ""]),
                            })} aria-label="Add table column" className="rounded p-1 text-indigo-700 hover:bg-indigo-50">
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(block.rows || []).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {block.headers.map((_, columnIndex) => (
                              <td key={columnIndex} className="border border-slate-200 p-1">
                                <input value={row[columnIndex] || ""} aria-label={`Table row ${rowIndex + 1}, column ${columnIndex + 1}`} onChange={(event) => {
                                  const rows = block.rows.map((currentRow) => [...currentRow]);
                                  rows[rowIndex][columnIndex] = event.target.value;
                                  updateBlock(blockIndex, { ...block, rows });
                                }} className="w-full min-w-24 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                              </td>
                            ))}
                            <td className="border border-slate-200 p-1 text-center">
                              <button type="button" onClick={() => updateBlock(blockIndex, { ...block, rows: block.rows.filter((_, index) => index !== rowIndex) })} aria-label="Remove table row" className="p-1 text-slate-400 hover:text-red-600">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button type="button" onClick={() => updateBlock(blockIndex, { ...block, rows: [...(block.rows || []), block.headers.map(() => "")] })} className="mt-2 text-xs font-semibold text-indigo-700 hover:text-indigo-900">
                      + Add table row
                    </button>
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default StructuredDescriptionEditor;
