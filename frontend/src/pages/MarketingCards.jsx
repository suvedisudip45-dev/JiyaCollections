import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { CreditCard, Gift, LockKeyhole, RefreshCw } from "lucide-react";
import { ShopContext } from "../context/ShopContext";
import { useContext } from "react";

const MarketingCards = () => {
  const { backendUrl, token, navigate } = useContext(ShopContext);
  const [cards, setCards] = useState([]);
  const [cardCode, setCardCode] = useState("");
  const [qrToken, setQrToken] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const videoRef = useRef(null);
  const scannerStreamRef = useRef(null);
  const scannerFrameRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const loadCards = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/marketing-cards/customer/cards`, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message);
      setCards(response.data.cards || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load your marketing cards.");
    } finally { setLoading(false); }
  }, [backendUrl, token]);

  useEffect(() => {
    if (!token) {
      navigate("/login", { state: { from: "/marketing-cards" } });
      return;
    }
    loadCards();
  }, [loadCards, navigate, token]);

  const linkCard = async (event) => {
    event.preventDefault();
    if (!cardCode.trim()) return;
    setWorking(true);
    try {
      const response = await axios.post(`${backendUrl}/api/marketing-cards/customer/cards/link`, { cardCode: cardCode.trim() }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message);
      toast.success("Marketing card activated.");
      setCardCode("");
      await loadCards();
    } catch (error) { toast.error(error.response?.data?.message || error.message || "Unable to activate this card."); }
    finally { setWorking(false); }
  };

  const submitQrToken = useCallback(async (tokenValue) => {
    if (!tokenValue?.trim()) return;
    setWorking(true);
    try {
      const response = await axios.post(`${backendUrl}/api/marketing-cards/customer/cards/scan`, { token: tokenValue.trim() }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message);
      toast.success(`Verified card ${response.data.card.cardCode}.`);
      setQrToken("");
      setScannerOpen(false);
      await loadCards();
    } catch (error) { toast.error(error.response?.data?.message || error.message || "Unable to verify this QR token."); }
    finally { setWorking(false); }
  }, [backendUrl, loadCards, token]);

  const resolveQr = (event) => {
    event.preventDefault();
    submitQrToken(qrToken);
  };

  useEffect(() => {
    if (!scannerOpen) return undefined;
    let active = true;
    let videoElement;
    const startScanner = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !("BarcodeDetector" in window)) {
        setScannerError("Camera QR scanning is not supported in this browser. Use the secure token field below.");
        return;
      }
      try {
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!active || !videoRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        scannerStreamRef.current = stream;
        videoElement = videoRef.current;
        videoElement.srcObject = stream;
        await videoElement.play();
        const scan = async () => {
          if (!active || !videoElement) return;
          try {
            const results = await detector.detect(videoElement);
            const value = results.find((result) => result.rawValue)?.rawValue;
            if (value) {
              setQrToken(value);
              await submitQrToken(value);
              return;
            }
          } catch {
            setScannerError("Unable to read this QR code. Keep the code inside the camera frame.");
          }
          scannerFrameRef.current = window.requestAnimationFrame(scan);
        };
        scan();
      } catch {
        setScannerError("Camera access was unavailable. Allow camera access or use the secure token field below.");
      }
    };
    setScannerError("");
    startScanner();
    return () => {
      active = false;
      if (scannerFrameRef.current) window.cancelAnimationFrame(scannerFrameRef.current);
      scannerStreamRef.current?.getTracks().forEach((track) => track.stop());
      scannerStreamRef.current = null;
      if (videoElement) videoElement.srcObject = null;
    };
  }, [scannerOpen, submitQrToken]);

  const redeem = async (card, benefit) => {
    setWorking(true);
    try {
      const response = await axios.post(`${backendUrl}/api/marketing-cards/customer/cards/${card.id}/benefits/${benefit.id}/redeem`, {}, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message);
      toast.success("Benefit redeemed.");
      await loadCards();
    } catch (error) { toast.error(error.response?.data?.message || error.message || "Unable to redeem this benefit."); }
    finally { setWorking(false); }
  };

  if (!token) return null;

  return (
    <div className="mx-auto max-w-5xl py-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line)] pb-6">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Private customer area</p><h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--ink)]">My marketing cards</h1><p className="mt-2 max-w-xl text-sm text-[var(--muted)]">Activate cards delivered with your orders and manage the benefits attached to them.</p></div>
        <button type="button" onClick={loadCards} className="inline-flex items-center gap-2 border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-xs font-bold text-[var(--ink)]"><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <form onSubmit={linkCard} className="border border-[var(--line)] bg-[var(--paper)] p-5 sm:p-6">
          <div className="flex items-center gap-3"><CreditCard size={20} /><h2 className="text-sm font-black uppercase tracking-wider">Activate a card</h2></div>
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Enter the card code printed on a card that arrived with your delivered order.</p>
          <input value={cardCode} onChange={(event) => setCardCode(event.target.value.toUpperCase())} placeholder="AAMA-NAT-PAR-AB12B00001" className="mt-5 w-full border border-[var(--line)] bg-white px-3 py-3 font-mono text-sm uppercase outline-none focus:border-[var(--ink)]" maxLength={64} required />
          <button disabled={working} className="mt-3 w-full bg-[var(--ink)] px-4 py-3 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-50">{working ? "Verifying..." : "Activate card"}</button>
        </form>

        <form onSubmit={resolveQr} className="border border-[var(--line)] bg-[#f2eee6] p-5 sm:p-6">
          <div className="flex items-center gap-3"><LockKeyhole size={20} /><h2 className="text-sm font-black uppercase tracking-wider">Verify QR token</h2></div>
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">QR verification is authenticated and reveals no card details to anonymous visitors.</p>
          <button type="button" onClick={() => setScannerOpen((open) => !open)} className="mt-4 inline-flex items-center gap-2 border border-[var(--ink)] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--ink)]">{scannerOpen ? "Close camera" : "Scan with camera"}</button>
          {scannerOpen && <div className="mt-4 overflow-hidden border border-[var(--line)] bg-black"><video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline aria-label="Marketing card QR scanner" />{scannerError && <p className="bg-white px-3 py-2 text-xs text-[var(--muted)]">{scannerError}</p>}</div>}
          <input value={qrToken} onChange={(event) => setQrToken(event.target.value)} placeholder="Paste secure QR token" className="mt-5 w-full border border-[var(--line)] bg-white px-3 py-3 font-mono text-xs outline-none focus:border-[var(--ink)]" maxLength={64} required />
          <button disabled={working} className="mt-3 w-full border border-[var(--ink)] px-4 py-3 text-xs font-bold uppercase tracking-wider text-[var(--ink)] disabled:opacity-50">Verify authenticated QR</button>
        </form>
      </div>

      <div className="mt-10">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-3"><h2 className="text-sm font-black uppercase tracking-wider text-[var(--ink)]">Activated cards</h2><span className="text-xs text-[var(--muted)]">{cards.length} card{cards.length === 1 ? "" : "s"}</span></div>
        {loading ? <p className="py-10 text-sm text-[var(--muted)]">Loading your cards...</p> : cards.length === 0 ? <div className="border-b border-[var(--line)] py-12 text-center"><CreditCard className="mx-auto mb-3 text-[var(--muted)]" size={28} /><p className="text-sm font-bold text-[var(--ink)]">No activated cards yet</p><p className="mt-1 text-xs text-[var(--muted)]">Cards become available after the related order is delivered.</p></div> : <div className="mt-5 space-y-5">{cards.map((card) => <article key={card.id} className="border border-[var(--line)] bg-[var(--paper)] p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{card.partner.name}</p><h3 className="mt-1 font-mono text-lg font-black text-[var(--ink)]">{card.cardCode}</h3><p className="mt-1 text-xs text-[var(--muted)]">{card.campaign.name}</p></div><span className="border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800">{card.status}</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{card.benefits.length === 0 ? <p className="text-xs text-[var(--muted)]">No benefits have been configured for this campaign.</p> : card.benefits.map((benefit) => <div key={benefit.id} className="border border-[var(--line)] bg-white p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Gift size={15} /><p className="text-sm font-bold text-[var(--ink)]">{benefit.name}</p></div>{benefit.description && <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{benefit.description}</p>}{benefit.terms && <p className="mt-2 text-[11px] text-[var(--muted)]">{benefit.terms}</p>}</div><span className="whitespace-nowrap text-sm font-black text-[var(--ink)]">{benefit.value || ""}</span></div>{benefit.status === "REDEEMED" ? <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-emerald-700">Redeemed {benefit.redeemedAt ? new Date(benefit.redeemedAt).toLocaleDateString() : ""}</p> : <button type="button" disabled={working} onClick={() => redeem(card, benefit)} className="mt-4 w-full border border-[var(--ink)] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--ink)] disabled:opacity-50">Redeem benefit</button>}</div>)}</div></article>)}</div>}
      </div>
    </div>
  );
};

export default MarketingCards;
