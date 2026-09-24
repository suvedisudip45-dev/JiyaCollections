/* eslint-disable react/prop-types */
import { useEffect, useState, useMemo } from "react";
import QRCode from "qrcode";
import { Printer, Download, FileText, LayoutGrid, Tag, X, Sparkles } from "lucide-react";

export const PrintSheetModal = ({
  isOpen,
  onClose,
  title = "Packaging Card & Sticker Sheet",
  cards = [],
  frontendUrl = window.location.origin.replace(":5175", ":5173"),
}) => {
  const [layout, setLayout] = useState("STICKER_LABELS"); // STICKER_LABELS | GIFT_CARDS
  const [qrMap, setQrMap] = useState({});
  const [generatingQr, setGeneratingQr] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!isOpen || !cards.length) return;
    let active = true;
    setGeneratingQr(true);

    const generateQrs = async () => {
      const entries = {};
      for (const card of cards) {
        if (!active) break;
        const code = card.cardCode || card.code || "";
        const payload = `${frontendUrl}/marketing-cards?code=${encodeURIComponent(code)}`;

        try {
          const dataUrl = await QRCode.toDataURL(payload, {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 220,
            color: { dark: "#0f172a", light: "#ffffff" },
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
    return () => { active = false; };
  }, [isOpen, cards, frontendUrl]);

  const filteredCards = useMemo(() => {
    if (!searchTerm.trim()) return cards;
    const term = searchTerm.toLowerCase().trim();
    return cards.filter((c) => (c.cardCode || "").toLowerCase().includes(term));
  }, [cards, searchTerm]);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #mfr-printable-sheet, #mfr-printable-sheet * {
            visibility: visible !important;
          }
          #mfr-printable-sheet {
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

      <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50 rounded-t-2xl">
          <div>
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Printer className="h-4 w-4 text-amber-700" /> {title}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Print-ready packaging stickers &amp; enclosure cards ({cards.length} cards)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              disabled={generatingQr}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow hover:bg-slate-800 disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" /> Print A4 Sheet
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

        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-2.5 bg-white text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLayout("STICKER_LABELS")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold ${
                layout === "STICKER_LABELS"
                  ? "bg-amber-100 text-amber-900 border border-amber-300"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              <Tag className="h-3.5 w-3.5" /> 3×7 Sticker Grid
            </button>
            <button
              type="button"
              onClick={() => setLayout("GIFT_CARDS")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold ${
                layout === "GIFT_CARDS"
                  ? "bg-amber-100 text-amber-900 border border-amber-300"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> 2×5 Card Grid
            </button>
          </div>

          <input
            type="text"
            placeholder="Search code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs w-40"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-100/70">
          {generatingQr ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-500 text-sm">
              <Sparkles className="h-5 w-5 animate-spin text-amber-600" />
              <span>Generating scannable QR codes ({cards.length} cards)...</span>
            </div>
          ) : (
            <div id="mfr-printable-sheet" className="mx-auto bg-white p-6 shadow-md rounded-xl border border-slate-200 max-w-[210mm]">
              {layout === "STICKER_LABELS" ? (
                <div className="grid grid-cols-3 gap-3">
                  {filteredCards.map((card) => {
                    const qrData = qrMap[card.id || card.cardCode] || "";
                    const pName = card.campaign?.marketingPartner?.name || "Brand Partner";
                    return (
                      <div
                        key={card.id || card.cardCode}
                        className="rounded-lg border border-slate-300 bg-white p-2.5 flex flex-col items-center justify-between text-center"
                        style={{ minHeight: "44mm", breakInside: "avoid" }}
                      >
                        <div className="w-full flex justify-between items-center text-[8px] font-bold text-slate-500 border-b border-slate-100 pb-1">
                          <span>AAMA CLOTHINGS</span>
                          <span className="text-amber-700 truncate max-w-[70px]">{pName}</span>
                        </div>
                        {qrData && <img src={qrData} alt="QR" className="h-20 w-20 my-1 rounded border border-slate-100" />}
                        <div className="w-full">
                          <p className="font-mono text-[9.5px] font-black text-slate-900 truncate">{card.cardCode}</p>
                          <p className="text-[7.5px] text-slate-400">Enclose in garment package</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {filteredCards.map((card) => {
                    const qrData = qrMap[card.id || card.cardCode] || "";
                    const pName = card.campaign?.marketingPartner?.name || "Brand Partner";
                    const cName = card.campaign?.name || "Customer Reward";
                    return (
                      <div
                        key={card.id || card.cardCode}
                        className="rounded-xl border border-slate-900 p-4 flex flex-col justify-between bg-white shadow-sm"
                        style={{ minHeight: "65mm", breakInside: "avoid" }}
                      >
                        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                          <span className="text-[10px] font-black tracking-wider text-slate-900">AAMA CLOTHINGS</span>
                          <span className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">× {pName}</span>
                        </div>
                        <p className="mt-1 text-center text-[10px] font-bold text-slate-700 truncate">{cName}</p>
                        <div className="flex justify-center my-2">
                          {qrData && <img src={qrData} alt="QR" className="h-24 w-24 rounded-lg border border-slate-200 p-1" />}
                        </div>
                        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2 py-1 text-center">
                          <p className="font-mono text-xs font-black tracking-wider text-slate-900">{card.cardCode}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PrintSheetModal;
