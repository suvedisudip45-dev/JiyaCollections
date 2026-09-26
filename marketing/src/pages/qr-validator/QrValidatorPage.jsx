import React, { useState, useEffect, useRef } from "react";
import {
  QrCode,
  Camera,
  CameraOff,
  CheckCircle2,
  AlertCircle,
  Gift,
  ShieldCheck,
  Loader2,
  X,
  AlertTriangle,
  User,
  Phone,
  Mail,
  ShoppingBag,
  Calendar,
  Clock,
  Ban,
} from "lucide-react";
import { qrApi } from "../../api";
import { getErrorMessage } from "../../api/client";
import Badge from "../../components/common/Badge";

const QrValidatorPage = () => {
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Redemption dialog state
  const [selectedBenefit, setSelectedBenefit] = useState(null);
  const [redeeming, setRedeeming] = useState(false);
  const [redemptionSuccess, setRedemptionSuccess] = useState(null);
  const [redemptionError, setRedemptionError] = useState(null);

  // Reject / Flag suspicious dialog state
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("Suspicious or tampered card");
  const [customRejectNote, setCustomRejectNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectSuccess, setRejectSuccess] = useState(null);
  const [rejectError, setRejectError] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Stop camera helper
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Start camera scanner
  const startCamera = async () => {
    setCameraError(null);
    setResult(null);
    setError(null);
    setRedemptionSuccess(null);
    setRejectSuccess(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError("Camera access is not supported in this browser. Please use manual code entry.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setScanning(true);
    } catch (err) {
      setCameraError(
        err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
          ? "Camera permission was denied. Please allow camera access in your browser settings, or use manual entry."
          : "Unable to access camera. Please enter card code manually."
      );
      setScanning(false);
    }
  };

  // Perform backend validation
  const validateCode = async (codeToVerify) => {
    const rawCode = String(codeToVerify || "").trim();
    if (!rawCode) {
      setError("Please enter a card code to validate.");
      return;
    }

    // Extract code if raw URL was pasted/scanned
    let cleanCode = rawCode;
    try {
      if (cleanCode.startsWith("http://") || cleanCode.startsWith("https://")) {
        const url = new URL(cleanCode);
        cleanCode = url.searchParams.get("code") || url.pathname.split("/").pop();
      }
    } catch {
      // not a url, use raw
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setRedemptionSuccess(null);
    setRedemptionError(null);
    setRejectSuccess(null);
    setRejectError(null);

    try {
      const res = await qrApi.validate(cleanCode);
      if (res.data?.success) {
        setResult(res.data);
      } else {
        setError(res.data?.message || "Verification failed.");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Card validation failed."));
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    validateCode(manualCode);
  };

  // Execute partner-side benefit redemption
  const handleConfirmRedeem = async () => {
    if (!result?.cardCode || !selectedBenefit) return;
    setRedeeming(true);
    setRedemptionError(null);

    try {
      const res = await qrApi.redeem({
        cardCode: result.cardCode,
        benefitId: selectedBenefit.id,
      });

      if (res.data?.success) {
        setRedemptionSuccess(res.data);
        // Refresh validation state
        validateCode(result.cardCode);
        setSelectedBenefit(null);
      } else {
        setRedemptionError(res.data?.message || "Redemption failed.");
      }
    } catch (err) {
      setRedemptionError(getErrorMessage(err, "Failed to complete redemption."));
    } finally {
      setRedeeming(false);
    }
  };

  // Execute partner-side card rejection
  const handleConfirmReject = async () => {
    if (!result?.cardCode) return;
    setRejecting(true);
    setRejectError(null);

    const fullReason = customRejectNote ? `${rejectReason} (${customRejectNote})` : rejectReason;

    try {
      const res = await qrApi.reject({
        cardCode: result.cardCode,
        reason: fullReason,
      });

      if (res.data?.success) {
        setRejectSuccess(`Card flagged and rejected: ${fullReason}`);
        validateCode(result.cardCode);
        setRejectModalOpen(false);
      } else {
        setRejectError(res.data?.message || "Rejection failed.");
      }
    } catch (err) {
      setRejectError(getErrorMessage(err, "Failed to reject card."));
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center sm:text-left">
        <h2 className="text-xl font-extrabold text-[var(--mp-ink)]">In-Store Card Scanner &amp; Offer Redemption</h2>
        <p className="text-xs text-[var(--mp-muted)] mt-0.5">
          Scan customer cards or enter card codes to verify customer details, purchase items, and approve rewards in your store.
        </p>
      </div>

      {/* Main Validation Box */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[var(--mp-line)] shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Camera Scanner Section */}
          <div className="flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed border-[var(--mp-line)] bg-[var(--mp-bg)] text-center min-h-[260px]">
            {scanning ? (
              <div className="w-full space-y-3">
                <div className="relative rounded-2xl overflow-hidden bg-black aspect-video max-h-56 mx-auto border-2 border-brand-500 shadow-md">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-4 border-2 border-dashed border-white/70 rounded-xl pointer-events-none qr-frame" />
                </div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={stopCamera}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-xs"
                  >
                    <CameraOff size={14} />
                    Stop Camera
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-[var(--mp-brand-light)] text-brand-700 flex items-center justify-center mx-auto shadow-xs">
                  <Camera size={26} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[var(--mp-ink)]">Live Camera Scanner</h4>
                  <p className="text-xs text-[var(--mp-muted)] max-w-xs mt-0.5">
                    Align the customer&apos;s physical card QR code inside camera frame to auto-scan
                  </p>
                </div>
                <button
                  onClick={startCamera}
                  className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 mx-auto"
                >
                  <Camera size={15} />
                  Start Camera Scanner
                </button>
              </div>
            )}

            {cameraError && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl flex items-start gap-2 text-left">
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                <span>{cameraError}</span>
              </div>
            )}
          </div>

          {/* Manual Entry Form */}
          <div className="flex flex-col justify-between p-6 rounded-2xl border border-[var(--mp-line)] bg-white space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <QrCode size={18} className="text-brand-600" />
                <h4 className="text-sm font-bold text-[var(--mp-ink)]">Manual Card Code Entry</h4>
              </div>
              <p className="text-xs text-[var(--mp-muted)]">
                Enter the alphanumeric card code presented by the customer or scanned via barcode reader.
              </p>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-3">
              <div>
                <label htmlFor="cardCodeInput" className="block text-[11px] font-bold uppercase text-[var(--mp-ink-2)] mb-1">
                  Card Code
                </label>
                <input
                  id="cardCodeInput"
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  placeholder="e.g. AAMA-0KTM-PAR-AB12B00001"
                  className="w-full px-4 py-3 rounded-xl border border-[var(--mp-line)] text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !manualCode.trim()}
                className="w-full py-3 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-xs transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Fetching Card &amp; Customer Details…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={15} />
                    Verify Card &amp; Customer
                  </>
                )}
              </button>
            </form>

            <p className="text-[11px] text-[var(--mp-muted)] text-center">
              🔒 Customer ownership and order delivery status are verified in real time.
            </p>
          </div>
        </div>
      </div>

      {/* Redemption Success Alert */}
      {redemptionSuccess && (
        <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-3xl text-emerald-800 flex items-start gap-3 shadow-xs">
          <CheckCircle2 size={20} className="text-emerald-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-bold">Reward Redeemed Successfully!</h4>
            <p className="text-xs mt-0.5">
              Offer: <span className="font-bold">{redemptionSuccess.benefit?.name}</span> ({redemptionSuccess.benefit?.value ? `Rs ${redemptionSuccess.benefit?.value}` : "Claimed"})
            </p>
            <p className="text-[11px] text-emerald-600 mt-1 font-mono">
              Redemption ID: {redemptionSuccess.redemptionId} • {new Date(redemptionSuccess.redeemedAt).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {/* Rejection Alert */}
      {rejectSuccess && (
        <div className="p-5 bg-rose-50 border border-rose-200 rounded-3xl text-rose-800 flex items-start gap-3 shadow-xs">
          <Ban size={20} className="text-rose-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-bold">Card Marked as Rejected</h4>
            <p className="text-xs mt-0.5">{rejectSuccess}</p>
          </div>
        </div>
      )}

      {/* Validation Error Message */}
      {error && (
        <div className="p-5 bg-red-50 border border-red-200 rounded-3xl text-red-700 flex items-start gap-3 shadow-xs">
          <AlertCircle size={20} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-bold">Verification Failed</h4>
            <p className="text-xs mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Verification Result Display */}
      {result && (
        <div
          className={`rounded-3xl p-6 sm:p-8 border shadow-sm transition-all space-y-6 ${
            result.valid
              ? "bg-white border-emerald-300 shadow-emerald-50"
              : "bg-red-50 border-red-300 text-red-800"
          }`}
        >
          {result.valid ? (
            <div className="space-y-6">
              {/* Header Status */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-[var(--mp-line)]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs uppercase tracking-wide">
                      <CheckCircle2 size={13} />
                      Genuine Partner Card
                    </span>
                    <Badge status={result.physicalStatus} />
                  </div>
                  <h3 className="text-2xl font-mono font-extrabold text-[var(--mp-ink)] mt-2">
                    {result.cardCode}
                  </h3>
                </div>

                <div className="text-left sm:text-right">
                  <span className="text-[10px] font-bold uppercase text-[var(--mp-muted)]">Campaign</span>
                  <p className="text-sm font-bold text-[var(--mp-ink)]">{result.campaign?.name}</p>
                  <p className="text-xs text-[var(--mp-muted)]">Target: {result.campaign?.targetScopeType}</p>
                </div>
              </div>

              {/* Customer Details & Order Information Cards */}
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Customer Details */}
                <div className="rounded-2xl border border-[var(--mp-line)] bg-[var(--mp-bg)] p-4 space-y-3">
                  <div className="flex items-center gap-2 text-[var(--mp-ink)] font-bold text-xs uppercase tracking-wider">
                    <User size={15} className="text-brand-600" /> Customer Information
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[var(--mp-muted)]">Name:</span>
                      <span className="font-bold text-[var(--mp-ink)]">{result.customer?.name || "Customer"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--mp-muted)]">Phone:</span>
                      <span className="font-bold text-[var(--mp-ink)] flex items-center gap-1">
                        <Phone size={12} /> {result.customer?.phone || "-"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--mp-muted)]">Email:</span>
                      <span className="text-[var(--mp-ink-2)] flex items-center gap-1">
                        <Mail size={12} /> {result.customer?.email || "-"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Activation & Timing Info */}
                <div className="rounded-2xl border border-[var(--mp-line)] bg-[var(--mp-bg)] p-4 space-y-3">
                  <div className="flex items-center gap-2 text-[var(--mp-ink)] font-bold text-xs uppercase tracking-wider">
                    <Calendar size={15} className="text-brand-600" /> Activation &amp; Validity
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[var(--mp-muted)]">Activation Status:</span>
                      <span className={`font-bold ${result.isActivated ? "text-emerald-700" : "text-amber-700"}`}>
                        {result.isActivated ? "✅ Activated by Customer" : "⏳ Not Yet Activated"}
                      </span>
                    </div>
                    {result.activatedAt && (
                      <div className="flex justify-between">
                        <span className="text-[var(--mp-muted)]">Activated On:</span>
                        <span className="text-[var(--mp-ink)]">{new Date(result.activatedAt).toLocaleString()}</span>
                      </div>
                    )}
                    {result.expiresAt && (
                      <div className="flex justify-between">
                        <span className="text-[var(--mp-muted)]">Offer Expiry:</span>
                        <span className="font-bold text-rose-700 flex items-center gap-1">
                          <Clock size={12} /> {new Date(result.expiresAt).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Delivered Order & Products Details */}
              {result.order && (
                <div className="rounded-2xl border border-[var(--mp-line)] bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--mp-ink)]">
                      <ShoppingBag size={15} className="text-brand-600" /> Ordered Products with Card
                    </div>
                    <span className="text-[11px] text-[var(--mp-muted)] font-mono">
                      Order ID: {result.order.id.slice(0, 8)}… • Total: Rs {result.order.amount}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {result.order.products && result.order.products.length > 0 ? (
                      result.order.products.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-slate-50 border border-slate-100">
                          <span className="font-medium text-slate-800">👕 {item.name} {item.size !== "-" ? `(Size: ${item.size})` : ""}</span>
                          <span className="text-slate-600 font-bold">Qty: {item.quantity}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-400 italic">Delivered order attached to card.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Offer & Benefits List */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--mp-muted)] mb-3">
                  Reward / Benefit ({result.benefits?.length || 0})
                </h4>

                {result.benefits?.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
                    <span className="text-2xl">🍀</span>
                    <p className="mt-1 text-xs font-bold text-slate-700">Better Luck Next Time</p>
                    <p className="text-[11px] text-slate-500">This card does not carry an attached reward voucher.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {result.benefits.map((b) => {
                      const isRedeemed = b.status === "REDEEMED";
                      const isRejected = b.status === "REJECTED";

                      return (
                        <div
                          key={b.id}
                          className={`p-5 rounded-2xl border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 transition-all ${
                            isRejected
                              ? "bg-rose-50 border-rose-200 text-rose-800"
                              : isRedeemed
                              ? "bg-amber-50 border-amber-200"
                              : "bg-[var(--mp-surface-2)] border-[var(--mp-line)]"
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-black text-[var(--mp-ink)]">{b.name}</span>
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wider uppercase ${
                                  isRejected
                                    ? "bg-rose-200 text-rose-900"
                                    : isRedeemed
                                    ? "bg-amber-200 text-amber-900"
                                    : "bg-emerald-100 text-emerald-800"
                                }`}
                              >
                                {isRejected ? "REJECTED" : isRedeemed ? "ALREADY REDEEMED" : "AVAILABLE"}
                              </span>
                            </div>
                            <p className="text-xs text-[var(--mp-ink-2)]">
                              Value: <span className="font-bold">{b.value > 0 ? `${b.value}% Discount / Rs ${b.value}` : b.benefitType}</span>
                              {b.redeemedAt && (
                                <span className="text-[var(--mp-muted)] ml-2">
                                  • Redeemed on {new Date(b.redeemedAt).toLocaleString()}
                                </span>
                              )}
                            </p>
                            {b.description && <p className="text-xs text-[var(--mp-muted)]">{b.description}</p>}
                          </div>

                          {!isRedeemed && !isRejected && (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={() => setRejectModalOpen(true)}
                                className="px-3.5 py-2.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs transition"
                              >
                                ⚠️ Reject / Flag
                              </button>
                              <button
                                onClick={() => setSelectedBenefit(b)}
                                disabled={!result.isActivated}
                                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all disabled:opacity-40 flex items-center gap-1.5"
                              >
                                <Gift size={14} />
                                Approve &amp; Redeem Offer
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <AlertCircle size={40} className="mx-auto mb-2 text-red-500" />
              <h3 className="text-lg font-bold">Invalid or Unrecognized Card</h3>
              <p className="text-xs mt-1 text-red-600">
                {result.message || "This card code was not found or does not belong to your partner organization."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Redemption Confirmation Modal */}
      {selectedBenefit && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[var(--mp-line)] space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-brand-700">
                <Gift size={20} />
                <h3 className="text-base font-bold">Confirm Benefit Redemption</h3>
              </div>
              <button
                onClick={() => setSelectedBenefit(null)}
                className="p-1.5 rounded-lg text-[var(--mp-muted)] hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--mp-bg)] border border-[var(--mp-line)] space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--mp-muted)]">Customer:</span>
                <span className="font-bold text-[var(--mp-ink)]">{result?.customer?.name} ({result?.customer?.phone})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--mp-muted)]">Card Code:</span>
                <span className="font-mono font-bold text-[var(--mp-ink)]">{result?.cardCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--mp-muted)]">Benefit:</span>
                <span className="font-bold text-emerald-700">{selectedBenefit.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--mp-muted)]">Reward Value:</span>
                <span className="font-bold text-[var(--mp-ink)]">
                  {selectedBenefit.value > 0 ? `${selectedBenefit.value}% OFF / Rs ${selectedBenefit.value}` : selectedBenefit.benefitType}
                </span>
              </div>
            </div>

            <p className="text-xs text-[var(--mp-ink-2)]">
              Are you sure you want to approve and apply this offer in your store for the customer?
            </p>

            {redemptionError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{redemptionError}</span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedBenefit(null)}
                disabled={redeeming}
                className="flex-1 py-2.5 rounded-xl border border-[var(--mp-line)] hover:bg-gray-50 text-xs font-bold text-[var(--mp-ink)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRedeem}
                disabled={redeeming}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-2"
              >
                {redeeming ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Approving…
                  </>
                ) : (
                  "Confirm & Redeem"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Suspicious Card Modal */}
      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-rose-200 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-700">
                <Ban size={20} />
                <h3 className="text-base font-bold">Reject / Flag Suspicious Card</h3>
              </div>
              <button
                onClick={() => setRejectModalOpen(false)}
                className="p-1.5 rounded-lg text-[var(--mp-muted)] hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              If the physical card appears duplicated, tampered, or customer details mismatch, you can reject redemption and flag this card code.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Rejection Reason
                </label>
                <select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                >
                  <option value="Suspicious or tampered card">Suspicious or tampered card</option>
                  <option value="Physical card already marked/used">Physical card already marked/used</option>
                  <option value="Customer details mismatch">Customer details mismatch</option>
                  <option value="Expired promotional window">Expired promotional window</option>
                  <option value="Other fraudulent behavior">Other fraudulent behavior</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Additional Note (Optional)
                </label>
                <input
                  type="text"
                  value={customRejectNote}
                  onChange={(e) => setCustomRejectNote(e.target.value)}
                  placeholder="e.g. Scratched code did not match QR barcode"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>
            </div>

            {rejectError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                {rejectError}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                disabled={rejecting}
                className="flex-1 py-2.5 rounded-xl border border-[var(--mp-line)] text-xs font-bold text-[var(--mp-ink)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={rejecting}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs transition"
              >
                {rejecting ? "Rejecting…" : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QrValidatorPage;
