/* eslint-disable react/prop-types */
import { useEffect, useState, useMemo } from "react";
import QRCode from "qrcode";
import { Printer, Download, FileText, LayoutGrid, Tag, FileCheck, X, Sparkles, AlertCircle } from "lucide-react";

export const PrintSheetModal = ({
  isOpen,
  onClose,
  batchCode = "BATCH",
  partnerName = "Brand Partner",
  campaignName = "Marketing Campaign",
  campaignScope = "Nationwide",
  cardExpiresAt = null,
  cards = [],
  frontendUrl = window.location.origin.replace(":5174", ":5173"),
}) => {
  const [layout, setLayout] = useState("GIFT_CARDS"); // GIFT_CARDS | STICKER_LABELS | SINGLE_PROOF
  const [inkSaver, setInkSaver] = useState(false);
  const [qrPayloadType, setQrPayloadType] = useState("URL"); // URL | CODE | TOKEN
  const [qrMap, setQrMap] = useState({});
  const [generatingQr, setGeneratingQr] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Pre-generate QR Data URLs for all cards in this batch
  useEffect(() => {
    if (!isOpen || !cards.length) return;
    let active = true;
    setGeneratingQr(true);

    const generateQrs = async () => {
      const entries = {};
      for (const card of cards) {
        if (!active) break;
        const code = card.cardCode || card.code || "";
        const token = card.qrToken || code;
        
        let payload = code;
        if (qrPayloadType === "URL") {
          payload = `${frontendUrl}/marketing-cards?code=${encodeURIComponent(code)}`;
        } else if (qrPayloadType === "TOKEN") {
          payload = token;
        }

        try {
          const dataUrl = await QRCode.toDataURL(payload, {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 250,
            color: {
              dark: "#0f172a",
              light: "#ffffff",
            },
          });
          entries[card.id || code] = dataUrl;
        } catch {
          entries[card.id || code] = "";
        }
      }

      if (active) {
        setQrMap(entries);
        setGeneratingQr(false);
      }
    };

    generateQrs();
    return () => {
      active = false;
    };
  }, [isOpen, cards, qrPayloadType, frontendUrl]);

  const filteredCards = useMemo(() => {
    if (!searchTerm.trim()) return cards;
    const term = searchTerm.toLowerCase().trim();
    return cards.filter(
      (c) =>
        (c.cardCode || "").toLowerCase().includes(term) ||
        (c.id || "").toLowerCase().includes(term)
    );
  }, [cards, searchTerm]);

  if (!isOpen) return null;

  // Direct Browser Print
  const handlePrint = () => {
    window.print();
  };

  // Download Standalone Offline HTML Sheet
  const handleDownloadHtml = () => {
    const esc = (v) =>
      String(v ?? "").replace(
        /[&<>"']/g,
        (m) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          }[m])
      );

    const cardsHtml = cards
      .map((c) => {
        const qr = qrMap[c.id || c.cardCode] || "";
        if (layout === "STICKER_LABELS") {
          return `
            <div class="sticker-card">
              <div class="sticker-header">AAMA CLOTHINGS</div>
              <img class="sticker-qr" src="${qr}" alt="QR" />
              <div class="sticker-code">${esc(c.cardCode)}</div>
              <div class="sticker-partner">${esc(partnerName)}</div>
            </div>
          `;
        }
        return `
          <div class="gift-card ${inkSaver ? "ink-saver" : ""}">
            <div class="card-brand">
              <span>AAMA CLOTHINGS</span>
              <span class="partner-badge">× ${esc(partnerName)}</span>
            </div>
            <div class="campaign-title">${esc(campaignName)}</div>
            <div class="qr-container">
              <img class="qr-img" src="${qr}" alt="QR" />
            </div>
            <div class="scratch-box">
              <div class="scratch-inner">
                <span class="scratch-label">SCAN OR SCRATCH REVEAL</span>
                <span class="card-code">${esc(c.cardCode)}</span>
              </div>
            </div>
            <div class="card-footer">
              <span>Scope: ${esc(campaignScope)}</span>
              <span>${cardExpiresAt ? `Expires: ${new Date(cardExpiresAt).toLocaleDateString()}` : "Active Offer"}</span>
            </div>
          </div>
        `;
      })
      .join("");

    const gridClass = layout === "STICKER_LABELS" ? "sticker-grid" : "gift-grid";

    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Aama Marketing Cards - ${esc(batchCode)}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 10px; background: #fff; color: #0f172a; }
    .print-sheet { width: 100%; max-width: 210mm; margin: 0 auto; }
    .gift-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6mm; }
    .sticker-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
    
    /* Gift Card 2x5 Styling */
    .gift-card { border: 1.5px solid #0f172a; border-radius: 8px; padding: 10px; page-break-inside: avoid; background: #fdfdfd; min-height: 52mm; display: flex; flex-direction: column; justify-content: space-between; }
    .gift-card.ink-saver { border: 1px dashed #64748b; background: #fff; }
    .card-brand { display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: 900; letter-spacing: 0.08em; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    .partner-badge { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 9px; color: #b45309; }
    .campaign-title { font-size: 10px; font-weight: 700; color: #334155; margin-top: 4px; text-align: center; }
    .qr-container { display: flex; justify-content: center; margin: 4px 0; }
    .qr-img { width: 28mm; height: 28mm; border-radius: 4px; }
    .scratch-box { border: 1px dashed #cbd5e1; border-radius: 6px; padding: 4px; background: #f8fafc; text-align: center; }
    .scratch-label { display: block; font-size: 7.5px; font-weight: 800; color: #64748b; letter-spacing: 0.05em; }
    .card-code { font-family: monospace; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; color: #0f172a; display: block; margin-top: 2px; }
    .card-footer { display: flex; justify-content: space-between; font-size: 8px; color: #64748b; margin-top: 4px; border-top: 1px solid #f1f5f9; padding-top: 2px; }
    
    /* Sticker Label 3x7 Styling */
    .sticker-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; text-align: center; page-break-inside: avoid; min-height: 38mm; display: flex; flex-direction: column; justify-content: space-between; align-items: center; background: #fff; }
    .sticker-header { font-size: 8px; font-weight: 900; letter-spacing: 0.05em; color: #475569; }
    .sticker-qr { width: 20mm; height: 20mm; }
    .sticker-code { font-family: monospace; font-size: 9.5px; font-weight: 800; color: #0f172a; }
    .sticker-partner { font-size: 7.5px; color: #b45309; font-weight: 700; }
  </style>
</head>
<body>
  <div class="print-sheet">
    <div class="${gridClass}">
      ${cardsHtml}
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Aama-Marketing-Cards-${batchCode}-${layout}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Download CSV Data File
  const handleDownloadCsv = () => {
    const escCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const headers = [
      "batchCode",
      "cardCode",
      "partnerName",
      "campaignName",
      "geographicScope",
      "cardExpiresAt",
      "qrScanUrl",
    ];

    const rows = cards.map((c) => [
      batchCode,
      c.cardCode || "",
      partnerName,
      campaignName,
      campaignScope,
      cardExpiresAt || "",
      `${frontendUrl}/marketing-cards?code=${encodeURIComponent(c.cardCode || "")}`,
    ]);

    const csvContent = [headers.map(escCsv).join(","), ...rows.map((r) => r.map(escCsv).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Marketing-Cards-${batchCode}-Data.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      {/* Print-specific Isolated Styling */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-card-sheet, #printable-card-sheet * {
            visibility: visible !important;
          }
          #printable-card-sheet {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 4mm !important;
            background: #ffffff !important;
          }
          @page {
            size: A4 portrait;
            margin: 6mm;
          }
        }
      `}</style>

      <div className="relative w-full max-w-5xl rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-100 px-6 py-4 gap-4 bg-slate-50 rounded-t-2xl">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                <Printer className="h-4 w-4" />
              </span>
              <h2 className="text-base font-black text-slate-900">
                Print &amp; Export Batch Cards
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Batch: <span className="font-mono font-bold text-slate-700">{batchCode}</span> •{" "}
              {partnerName} ({cards.length} cards)
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              disabled={generatingQr}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow hover:bg-slate-800 disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Sheet (A4)
            </button>
            <button
              type="button"
              onClick={handleDownloadHtml}
              disabled={generatingQr}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              title="Download standalone offline HTML file"
            >
              <Download className="h-3.5 w-3.5" />
              HTML File
            </button>
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              title="Download CSV dataset for industrial printer machines"
            >
              <FileText className="h-3.5 w-3.5" />
              CSV Data
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Toolbar & Filter Controls */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-100 px-6 py-3 gap-3 bg-white text-xs">
          {/* Layout Selector */}
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-500 mr-1">Layout:</span>
            <button
              type="button"
              onClick={() => setLayout("GIFT_CARDS")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold transition-all ${
                layout === "GIFT_CARDS"
                  ? "bg-amber-100 text-amber-900 border border-amber-300"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Gift Cards (2×5 Grid)
            </button>
            <button
              type="button"
              onClick={() => setLayout("STICKER_LABELS")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold transition-all ${
                layout === "STICKER_LABELS"
                  ? "bg-amber-100 text-amber-900 border border-amber-300"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              Packaging Stickers (3×7 Grid)
            </button>
            <button
              type="button"
              onClick={() => setLayout("SINGLE_PROOF")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold transition-all ${
                layout === "SINGLE_PROOF"
                  ? "bg-amber-100 text-amber-900 border border-amber-300"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <FileCheck className="h-3.5 w-3.5" />
              Proof View
            </button>
          </div>

          {/* Quick Options */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-600">
              <input
                type="checkbox"
                checked={inkSaver}
                onChange={(e) => setInkSaver(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span>Eco / Ink-Saver Borders</span>
            </label>

            <input
              type="text"
              placeholder="Search code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs w-36"
            />
          </div>
        </div>

        {/* Sheet Preview Scrollable Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-100/70">
          {generatingQr && (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-500 text-sm">
              <Sparkles className="h-5 w-5 animate-spin text-amber-600" />
              <span>Generating scannable vector QR codes ({cards.length} cards)...</span>
            </div>
          )}

          {!generatingQr && (
            <div
              id="printable-card-sheet"
              className="mx-auto bg-white p-6 shadow-md rounded-xl border border-slate-200 max-w-[210mm] transition-all"
            >
              {layout === "GIFT_CARDS" && (
                <div className="grid grid-cols-2 gap-4">
                  {filteredCards.map((card) => {
                    const qrData = qrMap[card.id || card.cardCode] || "";
                    return (
                      <div
                        key={card.id || card.cardCode}
                        className={`rounded-xl border p-4 flex flex-col justify-between transition-all ${
                          inkSaver
                            ? "border-dashed border-slate-300 bg-white"
                            : "border-slate-900 bg-gradient-to-b from-slate-50 to-white shadow-sm"
                        }`}
                        style={{ minHeight: "68mm", breakInside: "avoid" }}
                      >
                        {/* Card Header */}
                        <div>
                          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                            <span className="text-[10px] font-black tracking-wider text-slate-900">
                              AAMA CLOTHINGS
                            </span>
                            <span className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
                              × {partnerName}
                            </span>
                          </div>
                          <p className="mt-1.5 text-center text-[10px] font-bold text-slate-700 truncate">
                            {campaignName}
                          </p>
                        </div>

                        {/* Center QR Code */}
                        <div className="flex justify-center my-2">
                          {qrData ? (
                            <img
                              src={qrData}
                              alt="QR"
                              className="h-28 w-28 rounded-lg border border-slate-200 p-1 bg-white"
                            />
                          ) : (
                            <div className="h-28 w-28 rounded-lg bg-slate-100 flex items-center justify-center text-xs text-slate-400">
                              QR
                            </div>
                          )}
                        </div>

                        {/* Scratch-Off / Reveal Guide Box */}
                        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/80 px-2 py-1.5 text-center">
                          <p className="text-[8px] font-bold uppercase tracking-wider text-slate-500">
                            Scan QR or Enter Code on Portal
                          </p>
                          <p className="mt-0.5 font-mono text-xs font-black tracking-wider text-slate-900">
                            {card.cardCode}
                          </p>
                        </div>

                        {/* Card Footer */}
                        <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5 text-[8px] text-slate-400 font-medium">
                          <span>Scope: {campaignScope}</span>
                          <span>
                            {cardExpiresAt
                              ? `Expires: ${new Date(cardExpiresAt).toLocaleDateString()}`
                              : "Exclusive Reward"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {layout === "STICKER_LABELS" && (
                <div className="grid grid-cols-3 gap-3">
                  {filteredCards.map((card) => {
                    const qrData = qrMap[card.id || card.cardCode] || "";
                    return (
                      <div
                        key={card.id || card.cardCode}
                        className="rounded-lg border border-slate-300 bg-white p-2.5 flex flex-col items-center justify-between text-center"
                        style={{ minHeight: "45mm", breakInside: "avoid" }}
                      >
                        <div className="w-full flex justify-between items-center text-[8px] font-bold text-slate-500 border-b border-slate-100 pb-1">
                          <span>AAMA</span>
                          <span className="text-amber-700 truncate max-w-[60px]">
                            {partnerName}
                          </span>
                        </div>

                        {qrData && (
                          <img
                            src={qrData}
                            alt="QR"
                            className="h-20 w-20 my-1 rounded border border-slate-100"
                          />
                        )}

                        <div className="w-full">
                          <p className="font-mono text-[9.5px] font-black text-slate-900 truncate">
                            {card.cardCode}
                          </p>
                          <p className="text-[7.5px] text-slate-400 mt-0.5">
                            Packaging Enclosure Card
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {layout === "SINGLE_PROOF" && filteredCards[0] && (
                <div className="max-w-md mx-auto rounded-2xl border-2 border-slate-900 bg-white p-6 shadow-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <div>
                      <h3 className="text-xs font-black tracking-wider text-slate-900 uppercase">
                        Aama Clothings Customer Reward
                      </h3>
                      <p className="text-xs text-amber-700 font-bold mt-0.5">
                        Brand Partner: {partnerName}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[9px] font-bold text-white uppercase">
                      Official Proof
                    </span>
                  </div>

                  <div className="text-center py-2">
                    <p className="text-xs text-slate-600 font-medium">
                      Campaign: <span className="font-bold text-slate-800">{campaignName}</span>
                    </p>
                    {qrMap[filteredCards[0].id || filteredCards[0].cardCode] && (
                      <img
                        src={qrMap[filteredCards[0].id || filteredCards[0].cardCode]}
                        alt="QR Proof"
                        className="mx-auto my-3 h-40 w-40 rounded-xl border border-slate-200 p-2 shadow-sm"
                      />
                    )}
                    <div className="rounded-xl bg-slate-100 border border-slate-200 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Card Code (Verification Key)
                      </p>
                      <p className="font-mono text-sm font-black tracking-widest text-slate-900 mt-1">
                        {filteredCards[0].cardCode}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg bg-amber-50/70 border border-amber-200/60 p-3 text-[11px] text-amber-900 space-y-1">
                    <p className="font-bold flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" /> Customer Redemption Instructions:
                    </p>
                    <ol className="list-decimal list-inside text-[10px] space-y-0.5 pl-1 text-slate-700">
                      <li>Receive garment package with enclosed card.</li>
                      <li>Visit customer portal &amp; enter the unique card code.</li>
                      <li>Scan this QR code to unlock and activate your gift voucher.</li>
                      <li>Present active card at {partnerName}&apos;s outlet to redeem.</li>
                    </ol>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 bg-slate-50 rounded-b-2xl text-xs text-slate-500">
          <span>
            Displaying {filteredCards.length} of {cards.length} cards in this batch.
          </span>
          <span className="font-medium">
            Tip: Press <kbd className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-800">Ctrl+P</kbd> or click <strong>Print Sheet</strong>.
          </span>
        </div>
      </div>
    </div>
  );
};

export default PrintSheetModal;
