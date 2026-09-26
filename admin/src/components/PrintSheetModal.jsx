/* eslint-disable react/prop-types */
import { useEffect, useState, useMemo } from "react";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { AlertCircle, FileCheck, FileSpreadsheet, LayoutGrid, Printer, Tag, X, Sparkles } from "lucide-react";

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
  const [qrPayloadType] = useState("URL"); // URL | CODE | TOKEN
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

  const handleDownloadPdf = () => {
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const columns = layout === "STICKER_LABELS" ? 3 : layout === "SINGLE_PROOF" ? 1 : 2;
    const gap = 4;
    const cardWidth = (pageWidth - margin * 2 - gap * (columns - 1)) / columns;
    const cardHeight = layout === "STICKER_LABELS" ? 38 : layout === "SINGLE_PROOF" ? 105 : 62;
    const qrSize = layout === "STICKER_LABELS" ? 23 : layout === "SINGLE_PROOF" ? 48 : 32;
    const cardsPerPage = Math.max(1, Math.floor((pageHeight - margin * 2 + gap) / (cardHeight + gap)) * columns);

    filteredCards.forEach((card, index) => {
      const pageIndex = Math.floor(index / cardsPerPage);
      if (index > 0 && index % cardsPerPage === 0) pdf.addPage();

      const indexOnPage = index - pageIndex * cardsPerPage;
      const row = Math.floor(indexOnPage / columns);
      const column = indexOnPage % columns;
      const x = margin + column * (cardWidth + gap);
      const y = margin + row * (cardHeight + gap);
      const qrData = qrMap[card.id || card.cardCode];

      pdf.setDrawColor(15, 23, 42);
      pdf.setLineWidth(0.35);
      pdf.roundedRect(x, y, cardWidth, cardHeight, 2, 2, "S");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(layout === "STICKER_LABELS" ? 7 : 8);
      pdf.text("AAMA CLOTHINGS", x + cardWidth / 2, y + 6, { align: "center" });

      if (qrData) {
        pdf.addImage(qrData, "PNG", x + (cardWidth - qrSize) / 2, y + 9, qrSize, qrSize);
      }

      pdf.setFont("courier", "bold");
      pdf.setFontSize(layout === "STICKER_LABELS" ? 7 : 9);
      pdf.text(String(card.cardCode || ""), x + cardWidth / 2, y + cardHeight - 11, { align: "center" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6.5);
      pdf.text(String(partnerName || ""), x + cardWidth / 2, y + cardHeight - 6, { align: "center", maxWidth: cardWidth - 6 });
    });

    pdf.save(`Aama-Marketing-Cards-${batchCode}-${layout}.pdf`);
  };

  const handleDownloadExcel = () => {
    const rows = filteredCards.map((card, index) => {
      const code = card.cardCode || card.code || "";
      const token = card.qrToken || code;
      const qrPayload = qrPayloadType === "URL"
        ? `${frontendUrl}/marketing-cards?code=${encodeURIComponent(code)}`
        : qrPayloadType === "TOKEN"
          ? token
          : code;

      return {
        "S.N.": index + 1,
        "Card Code": code,
        "QR Token": token,
        "QR Payload": qrPayload,
        "Card ID": card.id || "",
        "Batch Code": batchCode,
        "Partner": partnerName,
        "Campaign": campaignName,
        "Scope": campaignScope,
        "Expires At": cardExpiresAt ? new Date(cardExpiresAt).toISOString() : "",
        "Status": card.physicalStatus || card.status || "",
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [
      { wch: 8 },
      { wch: 24 },
      { wch: 68 },
      { wch: 62 },
      { wch: 38 },
      { wch: 24 },
      { wch: 24 },
      { wch: 28 },
      { wch: 16 },
      { wch: 24 },
      { wch: 16 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Marketing Cards");
    XLSX.writeFile(workbook, `Aama-Marketing-Cards-${batchCode}.xlsx`);
  };

  return (
    <div id="print-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
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
            position: static !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: none !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            background: #ffffff !important;
          }
          body,
          #root {
            margin: 0 !important;
            padding: 0 !important;
          }
          body > #root,
          body > #root > * {
            display: block !important;
            position: static !important;
            min-height: 0 !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
          }
          #print-modal {
            display: block !important;
            position: static !important;
            min-height: 0 !important;
            height: auto !important;
            max-height: none !important;
            padding: 0 !important;
            background: #ffffff !important;
          }
          #print-modal-content {
            display: block !important;
            position: static !important;
            width: 100% !important;
            max-width: none !important;
            min-height: 0 !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            border: 0 !important;
            box-shadow: none !important;
          }
          #print-modal-header,
          #print-modal-toolbar {
            display: none !important;
          }
          #print-sheet-scroll {
            display: block !important;
            position: static !important;
            width: 100% !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            padding: 0 !important;
            background: #ffffff !important;
          }
          #printable-card-sheet .grid-cols-2 {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 4mm !important;
            width: 100% !important;
          }
          #printable-card-sheet .grid-cols-3 {
            display: grid !important;
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 3mm !important;
            width: 100% !important;
          }
          #printable-card-sheet .grid-cols-2 > div,
          #printable-card-sheet .grid-cols-3 > div,
          #printable-card-sheet > div {
            min-width: 0 !important;
            max-width: 100% !important;
            overflow: hidden !important;
            break-inside: avoid !important;
          }
          @page {
            size: A4 portrait;
            margin: 6mm;
          }
        }
      `}</style>

      <div id="print-modal-content" className="relative w-full max-w-5xl rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div id="print-modal-header" className="flex flex-wrap items-center justify-between border-b border-slate-100 px-6 py-4 gap-4 bg-slate-50 rounded-t-2xl">
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
              onClick={handleDownloadPdf}
              disabled={generatingQr}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              title="Download an A4 PDF ready for printing"
            >
              <FileCheck className="h-3.5 w-3.5" />
              PDF File
            </button>
            <button
              type="button"
              onClick={handleDownloadExcel}
              disabled={!filteredCards.length}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              title="Download card codes and metadata as an Excel file"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Excel File
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
        <div id="print-modal-toolbar" className="flex flex-wrap items-center justify-between border-b border-slate-100 px-6 py-3 gap-3 bg-white text-xs">
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
        <div id="print-sheet-scroll" className="flex-1 overflow-y-auto p-6 bg-slate-100/70">
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
