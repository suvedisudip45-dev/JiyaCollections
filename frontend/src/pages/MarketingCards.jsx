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
  Store,
  Clock,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { ShopContext } from "../context/ShopContext";
import { useContext } from "react";
import DigitalScratchCard from "../components/DigitalScratchCard";
import SponsorAdModal from "../components/SponsorAdModal";

const notifyRequestError = (error, fallback) => {
  if (error.response?.status === 401) return;
  toast.error(error.response?.data?.message || error.message || fallback);
};

const MarketingCards = () => {
  const { backendUrl, token, navigate } = useContext(ShopContext);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  // Verification step state
  const [step, setStep] = useState(1); // 1: Scan QR, 2: Reveal offer
  const [qrToken, setQrToken] = useState("");
  const [scannedOfferResult, setScannedOfferResult] = useState(null); // { hasBenefit, benefit, partner, message }
  const canClaimScannedReward = Boolean(
    scannedOfferResult?.campaign?.isOwnStore &&
    ["DISCOUNT", "GIFT", "VOUCHER"].includes(scannedOfferResult?.benefit?.benefitType)
  );
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
      notifyRequestError(error, "Unable to load your marketing cards.");
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

  // Scan and validate the QR token directly; card ownership is enforced by the API.
  const submitQrToken = useCallback(
    async (tokenValue) => {
      if (!tokenValue?.trim()) return;
      setWorking(true);
      try {
        const response = await axios.post(
          `${backendUrl}/api/marketing-cards/customer/cards/scan`,
          { token: tokenValue.trim() },
          { headers: { token } }
        );
        if (!response.data.success) throw new Error(response.data.message);

        const result = response.data.card;
        if (!result?.success || !result.cardId) {
          throw new Error(response.data.message || "This QR code is invalid or not allocated to your account.");
        }
        setScannedOfferResult(result);
        setIsScratchRevealed(false);
        setStep(2);
        setScannerOpen(false);
        setQrToken("");
        setScannerError("");
        if (result.ad) setSponsorAdOpen(true);
        toast.success(result.message || "Card validated. Scratch to reveal your reward.");
      } catch (error) {
        setScannerOpen(false);
        setScannerError(error.response?.data?.message || error.message || "This QR code is invalid or not allocated to your account. Please try another card.");
        notifyRequestError(error, "This QR code is invalid or not allocated to your account.");
      } finally {
        setWorking(false);
      }
    },
    [backendUrl, token]
  );

  const revealScannedCard = async () => {
    if (!scannedOfferResult?.cardId) return null;
    setWorking(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/marketing-cards/customer/cards/${scannedOfferResult.cardId}/reveal`,
        {},
        { headers: { token } }
      );
      if (!response.data.success || !response.data.card) {
        throw new Error(response.data.message || "Unable to reveal this card.");
      }
      setScannedOfferResult((current) => ({ ...current, ...response.data.card }));
      setIsScratchRevealed(true);
      return response.data.card;
    } catch (error) {
      notifyRequestError(error, "Unable to reveal this card. Please scratch it again.");
      return null;
    } finally {
      setWorking(false);
    }
  };

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
      setQrToken("");
      setScannedOfferResult(null);
      await loadCards();
    } catch (error) {
      notifyRequestError(error, "Unable to activate card.");
    } finally {
      setWorking(false);
    }
  };

  const handleClaimReward = async (cardId) => {
    setWorking(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/marketing-cards/customer/claim-reward`,
        { cardId },
        { headers: { token } }
      );
      if (!response.data.success) throw new Error(response.data.message);
      toast.success(response.data.message || "Reward claimed and ready to use at checkout.");
      if (scannedOfferResult?.cardId === cardId) handleResetVerification();
      await loadCards();
    } catch (error) {
      notifyRequestError(error, "Unable to claim this reward.");
    } finally {
      setWorking(false);
    }
  };

  const handleResetVerification = () => {
    setStep(1);
    setQrToken("");
    setScannedOfferResult(null);
    setScannerOpen(false);
    setScannerError("");
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
        setScannerError("Camera QR scanning is not supported in this browser. Paste the QR token below instead.");
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
        setScannerError("Camera access was unavailable. Allow camera permissions or paste the QR token below.");
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
            Scan public or organization-assigned Own Store cards, or claim distributor-issued Own Store and partner cards attached to your delivered orders.
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
              Scan Card
            </span>
            <ArrowRight size={14} className="text-slate-400" />
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${
                step >= 2 ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
              }`}
            >
              2
            </span>
            <span className={`text-xs font-bold ${step === 2 ? "text-emerald-700" : "text-[var(--muted)]"}`}>
              Scratch &amp; Reveal
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

        {/* STEP 1: Direct QR scan */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Camera size={22} className="text-slate-800" />
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-[var(--ink)]">Scan your card QR code</h2>
                <p className="text-xs text-[var(--muted)]">
                  No card code is needed. We will check the card and your eligibility after you scan it.
                </p>
              </div>
            </div>
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
                    {scannerError && <p role="alert" className="text-xs text-rose-700 font-medium">{scannerError}</p>}
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
                      disabled={working}
                      onClick={() => setScannerOpen(true)}
                      className="inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-slate-800 transition"
                    >
                      <Camera size={15} /> Start Camera Scanner
                    </button>
                    {scannerError && <p role="alert" className="max-w-sm text-xs text-rose-700 font-medium">{scannerError}</p>}
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
                    If camera scanning is unavailable, paste the token encoded in the card QR code.
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
                    {working ? "Checking card..." : "Check QR Code"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* STEP 2: Reveal Offer & Activate Card */}
        {step === 2 && scannedOfferResult && (
          <div className="space-y-6">
            {/* Gamified Digital Scratch Card */}
            <div className="space-y-3 text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                ✨ Rub to Reveal Your Exclusive Partnership Reward ✨
              </p>
              <DigitalScratchCard
                onRevealed={revealScannedCard}
              />
            </div>

            {isScratchRevealed && (scannedOfferResult.hasBenefit && scannedOfferResult.benefit ? (
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
                      ? `${scannedOfferResult.benefit.value}% Discount Offer${scannedOfferResult.benefit.maxDiscountAmount ? ` (up to Rs ${scannedOfferResult.benefit.maxDiscountAmount})` : ""}`
                      : scannedOfferResult.benefit.benefitType === "VOUCHER"
                      ? `Rs ${scannedOfferResult.benefit.value} Voucher`
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
                    onClick={() => canClaimScannedReward
                      ? handleClaimReward(scannedOfferResult.cardId)
                      : handleActivateCard()}
                    className="w-full max-w-sm rounded-xl bg-slate-900 py-3.5 text-sm font-bold uppercase tracking-wider text-white shadow-md hover:bg-slate-800 disabled:opacity-50 transition"
                  >
                    {working
                      ? (canClaimScannedReward ? "Claiming Reward..." : "Activating Card...")
                      : (canClaimScannedReward ? "✨ Claim Reward" : "✨ Activate Card Now")}
                  </button>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {canClaimScannedReward
                      ? scannedOfferResult.benefit.benefitType === "GIFT"
                        ? "Claim this gift to save it for your next eligible order."
                        : "Claim this reward now to make it available as an offer at checkout."
                      : `Once activated, take your physical card to ${scannedOfferResult.partner?.name}'s shopping store to claim!`}
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
            ))}
            {step === 2 && isScratchRevealed && scannedOfferResult?.isDistributorOrderReward && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950">
                <p className="font-bold">Reward from your delivered order</p>
                <p className="mt-1">
                  This card is linked to your delivered order. Campaign scan caps do not apply to distributor-issued cards, so cards attached to your other eligible orders can each unlock a reward once.
                </p>
              </div>
            )}
            {step === 2 && scannedOfferResult?.scanLimits && (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-xs text-[var(--ink)]">
                <p className="font-bold">Own Store scan limits for this campaign</p>
                <p className="mt-1">
                  This week: {scannedOfferResult.scanLimits.weekly.used}/{scannedOfferResult.scanLimits.weekly.limit} cards · {scannedOfferResult.scanLimits.weekly.remaining} remaining
                </p>
                {scannedOfferResult.scanLimits.campaign && (
                  <p>
                    Campaign account limit: {scannedOfferResult.scanLimits.campaign.used}/{scannedOfferResult.scanLimits.campaign.limit} scans · {scannedOfferResult.scanLimits.campaign.remaining} remaining
                  </p>
                )}
                {scannedOfferResult.scanLimits.organization && (
                  <p>
                    {scannedOfferResult.assignedOrganization || scannedOfferResult.partner?.name}, campaign limit: {scannedOfferResult.scanLimits.organization.used}/{scannedOfferResult.scanLimits.organization.limit} cards · {scannedOfferResult.scanLimits.organization.remaining} remaining
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sponsor Ad Interstitial Modal */}
      {sponsorAdOpen && scannedOfferResult?.ad && (
        <SponsorAdModal
          isOpen={sponsorAdOpen}
          onClose={() => setSponsorAdOpen(false)}
          onProceed={() => setSponsorAdOpen(false)}
          proceedLabel="Continue to scratch card"
          ad={scannedOfferResult.ad}
          partner={scannedOfferResult.partner}
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
              Public and organization-assigned Own Store cards do not require an order. Distributor-issued Own Store cards must be attached to your delivered order.
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

                {card.revealPending ? (
                  <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3.5 border border-slate-100">
                    <span className="text-2xl">🎁</span>
                    <div>
                      <p className="text-xs font-bold text-slate-800">Scratch to reveal</p>
                      <p className="text-[11px] text-slate-500">The result is hidden until you scratch this card.</p>
                    </div>
                  </div>
                ) : !card.hasBenefit || card.benefits.length === 0 ? (
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
                      const isClaimed = benefit.status === "CLAIMED";
                      return (
                        <div key={benefit.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Gift size={16} className="text-amber-600 flex-shrink-0" />
                              <span className="text-sm font-black text-slate-900">{benefit.name}</span>
                            </div>
                            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800 whitespace-nowrap">
                              {benefit.benefitType === "DISCOUNT" ? `${benefit.value}% OFF${benefit.maxDiscountAmount ? ` (up to Rs ${benefit.maxDiscountAmount})` : ""}` : `Rs ${benefit.value}`}
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
                            ) : card.campaign.isOwnStore ? (
                              <div className="space-y-2">
                                <p className="text-[11px] text-slate-600">
                                  {isClaimed
                                    ? "Claimed. Choose this card reward during checkout."
                                    : "Claim this reward when you are ready to apply it during checkout."}
                                </p>
                                {!isClaimed && (
                                  <button
                                    type="button"
                                    disabled={working}
                                    onClick={() => handleClaimReward(card.id)}
                                    className="w-full rounded-lg bg-[#d85b3f] px-3 py-2 text-xs font-bold text-white hover:bg-[#bd4c34] disabled:opacity-50"
                                  >
                                    {working ? "Claiming..." : "Apply / Claim Reward"}
                                  </button>
                                )}
                              </div>
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
