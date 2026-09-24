import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  CreditCard,
  Gift,
  LockKeyhole,
  RefreshCw,
  Camera,
  CameraOff,
  CheckCircle2,
  Sparkles,
  Store,
  Clock,
  ShieldCheck,
  Tag,
  ArrowRight,
} from "lucide-react";
import { ShopContext } from "../context/ShopContext";
import { useContext } from "react";
import DigitalScratchCard from "../components/DigitalScratchCard";
import SponsorAdModal from "../components/SponsorAdModal";

const MarketingCards = () => {
  const { backendUrl, token, navigate } = useContext(ShopContext);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  // Verification step state
  const [step, setStep] = useState(1); // 1: Enter Code, 2: Scan QR, 3: Revealed Offer
  const [cardCode, setCardCode] = useState("");
  const [verifiedCardInfo, setVerifiedCardInfo] = useState(null); // { cardId, cardCode, partner, campaign, ad }
  const [qrToken, setQrToken] = useState("");
  const [scannedOfferResult, setScannedOfferResult] = useState(null); // { hasBenefit, benefit, partner, message }
  const [sponsorAdOpen, setSponsorAdOpen] = useState(false);
  const [isScratchRevealed, setIsScratchRevealed] = useState(false);

  // Camera scanner state
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const videoRef = useRef(null);
  const scannerStreamRef = useRef(null);
  const scannerFrameRef = useRef(null);

  const loadCards = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/marketing-cards/customer/cards`, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message);
      setCards(response.data.cards || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load your marketing cards.");
    } finally {
      setLoading(false);
    }
  }, [backendUrl, token]);

  useEffect(() => {
    if (!token) {
      navigate("/login", { state: { from: "/marketing-cards" } });
      return;
    }
    loadCards();
  }, [loadCards, navigate, token]);

  // Step 1: Verify Card Code
  const handleVerifyCode = async (event) => {
    event.preventDefault();
    const cleanCode = cardCode.trim().toUpperCase();
    if (!cleanCode) return;

    setWorking(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/marketing-cards/customer/cards/verify-code`,
        { cardCode: cleanCode },
        { headers: { token } }
      );
      if (!response.data.success) throw new Error(response.data.message);

      setVerifiedCardInfo(response.data);
      if (response.data.ad) {
        setSponsorAdOpen(true);
      } else {
        setStep(2);
      }
      toast.success(response.data.message || "Card code verified! Please scan the QR code.");
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to verify this card code.");
    } finally {
      setWorking(false);
    }
  };

  // Step 2: Verify Scanned QR Token
  const submitQrToken = useCallback(
    async (tokenValue) => {
      if (!tokenValue?.trim() || !cardCode.trim()) return;
      setWorking(true);
      try {
        const response = await axios.post(
          `${backendUrl}/api/marketing-cards/customer/cards/verify-qr`,
          {
            cardCode: cardCode.trim().toUpperCase(),
            token: tokenValue.trim(),
          },
          { headers: { token } }
        );
        if (!response.data.success) throw new Error(response.data.message);

        setScannedOfferResult(response.data);
        setStep(3);
        setScannerOpen(false);
        toast.success(response.data.message || "QR code verified!");
      } catch (error) {
        toast.error(error.response?.data?.message || error.message || "Unable to verify QR token.");
      } finally {
        setWorking(false);
      }
    },
    [backendUrl, cardCode, token]
  );

  const handleManualQrSubmit = (event) => {
    event.preventDefault();
    submitQrToken(qrToken);
  };

  // Step 3: Activate Card (Customer cannot self-redeem, they activate to claim at store)
  const handleActivateCard = async () => {
    if (!scannedOfferResult?.cardId) return;
    setWorking(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/marketing-cards/customer/cards/${scannedOfferResult.cardId}/activate`,
        {},
        { headers: { token } }
      );
      if (!response.data.success) throw new Error(response.data.message);

      toast.success("Card activated! Bring your physical card to the partner store to claim.");
      // Reset form & reload cards
      setStep(1);
      setCardCode("");
      setVerifiedCardInfo(null);
      setQrToken("");
      setScannedOfferResult(null);
      await loadCards();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to activate card.");
    } finally {
      setWorking(false);
    }
  };

  const handleResetVerification = () => {
    setStep(1);
    setCardCode("");
    setVerifiedCardInfo(null);
    setQrToken("");
    setScannedOfferResult(null);
    setScannerOpen(false);
    setSponsorAdOpen(false);
    setIsScratchRevealed(false);
  };

  // Live Camera QR Scanner lifecycle
  useEffect(() => {
    if (!scannerOpen) return undefined;
    let active = true;
    let videoElement;

    const startScanner = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !("BarcodeDetector" in window)) {
        setScannerError("Camera QR scanning is not supported in this browser. Use manual QR token entry below.");
        return;
      }
      try {
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
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
            setScannerError("Scanning... Keep the QR code steady inside the camera frame.");
          }
          scannerFrameRef.current = window.requestAnimationFrame(scan);
        };
        scan();
      } catch {
        setScannerError("Camera access was unavailable. Please allow camera permissions or enter the code manually.");
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

  if (!token) return null;

  return (
    <div className="mx-auto max-w-5xl py-8 sm:py-12 px-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line)] pb-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Private customer area</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--ink)]">Marketing Cards &amp; Offers</h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
            Verify cards received with your delivered orders, unlock exclusive partner rewards, and activate them for in-store shopping.
          </p>
        </div>
        <button
          type="button"
          onClick={loadCards}
          className="inline-flex items-center gap-2 border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-xs font-bold text-[var(--ink)] hover:bg-slate-100 transition"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Main Verification & Activation Flow */}
      <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 sm:p-8 shadow-sm">
        {/* Step Indicator */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
          <div className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${
                step >= 1 ? "bg-[var(--ink)] text-white" : "bg-slate-200 text-slate-600"
              }`}
            >
              1
            </span>
            <span className={`text-xs font-bold ${step === 1 ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>
              Enter Card Code
            </span>
            <ArrowRight size={14} className="text-slate-400" />
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${
                step >= 2 ? "bg-[var(--ink)] text-white" : "bg-slate-200 text-slate-600"
              }`}
            >
              2
            </span>
            <span className={`text-xs font-bold ${step === 2 ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>
              Scan QR Code
            </span>
            <ArrowRight size={14} className="text-slate-400" />
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${
                step >= 3 ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
              }`}
            >
              3
            </span>
            <span className={`text-xs font-bold ${step === 3 ? "text-emerald-700" : "text-[var(--muted)]"}`}>
              Reveal &amp; Activate Offer
            </span>
          </div>

          {step > 1 && (
            <button
              type="button"
              onClick={handleResetVerification}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 underline"
            >
              Start Over
            </button>
          )}
        </div>

        {/* STEP 1: Enter Card Code */}
        {step === 1 && (
          <form onSubmit={handleVerifyCode} className="max-w-xl space-y-4">
            <div className="flex items-center gap-3">
              <CreditCard size={22} className="text-slate-800" />
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-[var(--ink)]">Step 1: Enter Card Code</h2>
                <p className="text-xs text-[var(--muted)]">
                  Enter the card code printed on the physical card attached to your delivered order.
                </p>
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="cardCodeInput" className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                Card Code
              </label>
              <input
                id="cardCodeInput"
                value={cardCode}
                onChange={(event) => setCardCode(event.target.value.toUpperCase())}
                placeholder="e.g. AAMA-0KTM-PAR-AB12B00001"
                className="w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 font-mono text-sm uppercase outline-none focus:border-[var(--ink)] focus:ring-1 focus:ring-[var(--ink)]"
                maxLength={64}
                required
              />
            </div>

            <button
              type="submit"
              disabled={working || !cardCode.trim()}
              className="w-full rounded-xl bg-[var(--ink)] py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 transition"
            >
              {working ? "Verifying Code..." : "Verify Card Code & Proceed to Scan"}
            </button>
          </form>
        )}

        {/* STEP 2: Promotional Ad Banner + QR Scanner */}
        {step === 2 && (
          <div className="space-y-6">
            {/* Verified Card Badge */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 border border-emerald-200 p-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={20} className="text-emerald-600 flex-shrink-0" />
                <div>
                  <p className="text-xs font-bold text-emerald-900">
                    Card Verified: <span className="font-mono">{verifiedCardInfo?.cardCode}</span>
                  </p>
                  <p className="text-[11px] text-emerald-700">
                    Partner: <span className="font-bold">{verifiedCardInfo?.partner?.name}</span> • Campaign: {verifiedCardInfo?.campaign?.name}
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-full">
                Step 1 Complete
              </span>
            </div>

            {/* Promotional Ad Hook Banner (Placeholder for brand partner advertisement) */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-600 via-rose-600 to-indigo-700 p-6 text-white shadow-md">
              <div className="relative z-10 max-w-lg space-y-2">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-white backdrop-blur-xs">
                  <Sparkles size={12} /> Sponsored Partner Offer
                </div>
                <h3 className="text-xl font-black">
                  Special Rewards by {verifiedCardInfo?.partner?.name || "Our Brand Partner"}
                </h3>
                <p className="text-xs text-white/90 leading-relaxed">
                  Thank you for shopping with Aama Clothings! Scan your card&apos;s physical QR code now to reveal your exclusive discounts, vouchers, or gift hampers.
                </p>
              </div>
            </div>

            {/* QR Scanner / Manual Verification */}
            <div className="grid gap-6 md:grid-cols-2">
              <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--line)] bg-white p-6 text-center">
                {scannerOpen ? (
                  <div className="w-full space-y-3">
                    <div className="relative aspect-video max-h-52 w-full overflow-hidden rounded-xl bg-black border-2 border-slate-800">
                      <video
                        ref={videoRef}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                        aria-label="Marketing card QR scanner"
                      />
                    </div>
                    {scannerError && <p className="text-xs text-amber-700 font-medium">{scannerError}</p>}
                    <button
                      type="button"
                      onClick={() => setScannerOpen(false)}
                      className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
                    >
                      <CameraOff size={14} /> Close Camera
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
                      <Camera size={26} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-[var(--ink)]">Scan Physical Card QR</h4>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Point your camera at the QR code printed on your physical card.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setScannerOpen(true)}
                      className="inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-slate-800 transition"
                    >
                      <Camera size={15} /> Start Camera Scanner
                    </button>
                  </div>
                )}
              </div>

              {/* Manual QR Token Form */}
              <form onSubmit={handleManualQrSubmit} className="flex flex-col justify-between rounded-2xl border border-[var(--line)] bg-white p-6 space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    <LockKeyhole size={18} className="text-slate-700" />
                    <h4 className="text-sm font-bold text-[var(--ink)]">Manual QR Token Entry</h4>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    If camera is unavailable, paste the secure QR token string to verify.
                  </p>
                </div>

                <div className="space-y-3">
                  <input
                    value={qrToken}
                    onChange={(event) => setQrToken(event.target.value)}
                    placeholder="Paste 64-char QR token"
                    className="w-full rounded-xl border border-[var(--line)] bg-slate-50 px-4 py-3 font-mono text-xs outline-none focus:border-[var(--ink)] focus:bg-white"
                    maxLength={64}
                    required
                  />
                  <button
                    type="submit"
                    disabled={working || !qrToken.trim()}
                    className="w-full rounded-xl border border-[var(--ink)] py-3 text-xs font-bold uppercase tracking-wider text-[var(--ink)] hover:bg-slate-50 disabled:opacity-50 transition"
                  >
                    {working ? "Verifying QR..." : "Verify Authenticated QR Token"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* STEP 3: Reveal Offer & Activate Card */}
        {step === 3 && scannedOfferResult && (
          <div className="space-y-6">
            {/* Gamified Digital Scratch Card */}
            <div className="space-y-3 text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                ✨ Rub to Reveal Your Exclusive Partnership Reward ✨
              </p>
              <DigitalScratchCard
                hasBenefit={scannedOfferResult.hasBenefit}
                benefit={scannedOfferResult.benefit}
                partner={scannedOfferResult.partner || {}}
                onRevealed={() => setIsScratchRevealed(true)}
              />
            </div>

            {scannedOfferResult.hasBenefit && scannedOfferResult.benefit ? (
              <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/70 p-6 sm:p-8 text-center space-y-4 shadow-sm">
                <div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-200/80 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-amber-900">
                    🎉 Reward Unlocked!
                  </span>
                  <h3 className="mt-3 text-2xl font-black text-slate-900">
                    {scannedOfferResult.benefit.name}
                  </h3>
                  <p className="mt-1 text-sm font-bold text-amber-800">
                    {scannedOfferResult.benefit.benefitType === "DISCOUNT"
                      ? `${scannedOfferResult.benefit.value}% Discount Offer`
                      : scannedOfferResult.benefit.value
                      ? `Value: Rs ${scannedOfferResult.benefit.value}`
                      : scannedOfferResult.benefit.benefitType}
                  </p>
                  {scannedOfferResult.benefit.description && (
                    <p className="mt-2 text-xs text-slate-600 max-w-md mx-auto">
                      {scannedOfferResult.benefit.description}
                    </p>
                  )}
                  {scannedOfferResult.benefit.terms && (
                    <p className="mt-1 text-[11px] text-slate-500 italic">
                      Terms: {scannedOfferResult.benefit.terms}
                    </p>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    disabled={working}
                    onClick={handleActivateCard}
                    className="w-full max-w-sm rounded-xl bg-slate-900 py-3.5 text-sm font-bold uppercase tracking-wider text-white shadow-md hover:bg-slate-800 disabled:opacity-50 transition"
                  >
                    {working ? "Activating Card..." : "✨ Activate Card Now"}
                  </button>
                  <p className="mt-2 text-[11px] text-slate-500">
                    Once activated, take your physical card to {scannedOfferResult.partner?.name}&apos;s shopping store to claim!
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 text-center space-y-4">
                <span className="text-4xl">🍀</span>
                <div>
                  <h3 className="text-lg font-bold text-[var(--ink)]">Better luck next time!</h3>
                  <p className="mt-1 text-xs text-[var(--muted)] max-w-md mx-auto">
                    Thank you for participating in {scannedOfferResult.partner?.name}&apos;s promotional campaign. This specific card does not carry an attached prize, but we appreciate your purchase!
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleResetVerification}
                  className="rounded-xl border border-slate-300 px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Verify Another Card
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sponsor Ad Interstitial Modal */}
      {sponsorAdOpen && verifiedCardInfo?.ad && (
        <SponsorAdModal
          isOpen={sponsorAdOpen}
          onClose={() => {
            setSponsorAdOpen(false);
            setStep(2);
          }}
          onProceed={() => {
            setSponsorAdOpen(false);
            setStep(2);
          }}
          ad={verifiedCardInfo.ad}
          partner={verifiedCardInfo.partner}
        />
      )}

      {/* Activated Cards Section */}
      <div className="mt-12 space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-slate-800" />
            <h2 className="text-sm font-black uppercase tracking-wider text-[var(--ink)]">My Activated Cards</h2>
          </div>
          <span className="text-xs text-[var(--muted)]">
            {cards.length} card{cards.length === 1 ? "" : "s"}
          </span>
        </div>

        {loading ? (
          <p className="py-10 text-sm text-[var(--muted)]">Loading your cards...</p>
        ) : cards.length === 0 ? (
          <div className="border-b border-[var(--line)] py-12 text-center">
            <CreditCard className="mx-auto mb-3 text-[var(--muted)]" size={28} />
            <p className="text-sm font-bold text-[var(--ink)]">No activated cards yet</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Cards delivered with your orders can be verified and activated using the form above.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {cards.map((card) => (
              <article key={card.id} className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Partner: {card.partner.name}
                    </span>
                    <h3 className="font-mono text-base font-black text-[var(--ink)]">{card.cardCode}</h3>
                    <p className="text-xs text-slate-500">{card.campaign.name}</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                    {card.status}
                  </span>
                </div>

                {!card.hasBenefit || card.benefits.length === 0 ? (
                  <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3.5 border border-slate-100">
                    <span className="text-2xl">🍀</span>
                    <div>
                      <p className="text-xs font-bold text-slate-800">Better luck next time!</p>
                      <p className="text-[11px] text-slate-500">No active prize attached to this card.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {card.benefits.map((benefit) => {
                      const isRedeemed = benefit.status === "REDEEMED";
                      return (
                        <div key={benefit.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Gift size={16} className="text-amber-600 flex-shrink-0" />
                              <span className="text-sm font-black text-slate-900">{benefit.name}</span>
                            </div>
                            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800 whitespace-nowrap">
                              {benefit.benefitType === "DISCOUNT" ? `${benefit.value}% OFF` : `Rs ${benefit.value}`}
                            </span>
                          </div>

                          {benefit.description && (
                            <p className="text-xs text-slate-600">{benefit.description}</p>
                          )}

                          <div className="pt-2 border-t border-amber-100 space-y-1.5">
                            {isRedeemed ? (
                              <p className="text-[11px] font-bold uppercase text-emerald-700 flex items-center gap-1">
                                <CheckCircle2 size={13} /> Redeemed in store on {benefit.redeemedAt ? new Date(benefit.redeemedAt).toLocaleDateString() : ""}
                              </p>
                            ) : (
                              <div className="rounded-lg bg-white p-3 border border-amber-200/70 text-[11px] text-slate-700 space-y-1">
                                <div className="flex items-center gap-1.5 font-bold text-slate-900">
                                  <Store size={13} className="text-amber-700" /> In-Store Claim Instructions:
                                </div>
                                <p className="text-slate-600">
                                  Take this physical card to <strong>{card.partner.name}</strong>&apos;s store. Present the card to the cashier to scan and redeem your offer.
                                </p>
                                {benefit.expiresAt && (
                                  <p className="text-[10px] text-rose-600 font-semibold flex items-center gap-1 pt-1">
                                    <Clock size={11} /> Valid until: {new Date(benefit.expiresAt).toLocaleDateString()}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MarketingCards;
