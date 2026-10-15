import React, { useState } from "react";
import axios from "axios";
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, Loader2, MessageSquareText } from "lucide-react";

const PasswordResetFlow = ({ backendUrl, portal, onBack, onComplete }) => {
  const [step, setStep] = useState("phone");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [otp, setOtp] = useState("");
  const [otpLength, setOtpLength] = useState(6);
  const [tfaToken, setTfaToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (step === "phone") {
        const response = await axios.post(`${backendUrl}/api/auth/password-reset/request`, {
          email,
          phone,
          portal,
        });
        setChallengeId(response.data.challengeId);
        setMaskedPhone(response.data.maskedPhone);
        setOtpLength(response.data.otpLength || 6);
        setStep("otp");
      } else if (step === "otp") {
        const response = await axios.post(`${backendUrl}/api/auth/password-reset/verify`, {
          challengeId,
          otp,
          portal,
        });
        setTfaToken(response.data.tfaToken);
        setStep("password");
      } else {
        const response = await axios.post(`${backendUrl}/api/auth/password-reset/complete`, {
          challengeId,
          tfaToken,
          newPassword,
          confirmPassword,
          portal,
        });
        if (response.data.success) onComplete();
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Password recovery could not be completed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      <section className="relative z-10 w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl sm:p-8">
        <button type="button" onClick={onBack} className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </button>
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-400"><KeyRound className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-bold text-white">Reset your password</h1>
            <p className="mt-1 text-xs text-slate-400">SMS verification for your {portal === "DISTRIBUTOR" ? "distributor" : "manufacturer"} account</p>
          </div>
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl border border-rose-900 bg-rose-950/60 px-3 py-2.5 text-sm text-rose-300">{error}</p>}
        <form onSubmit={submit} className="space-y-4">
          {step === "phone" && (
            <>
              <label className="block text-sm font-medium text-slate-200" htmlFor="reset-email">Account email</label>
              <input
                id="reset-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                maxLength={255}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
              />
              <label className="block text-sm font-medium text-slate-200" htmlFor="reset-phone">Account contact number</label>
              <input
                id="reset-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                maxLength={16}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="98XXXXXXXX"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
              />
              <p className="text-xs leading-5 text-slate-400">Both details must match an active {portal === "DISTRIBUTOR" ? "distributor" : "manufacturer"} account. We send a one-time code by SMS. Password reset is limited to once every 7 days and three times per month.</p>
            </>
          )}
          {step === "otp" && (
            <>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-300">
                <MessageSquareText className="mr-2 inline h-4 w-4 text-emerald-400" />
                Enter the code sent to <span className="font-semibold text-white">{maskedPhone}</span>.
              </div>
              <label className="block text-sm font-medium text-slate-200" htmlFor="reset-otp">SMS verification code</label>
              <input
                id="reset-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={otpLength}
                pattern={`[0-9]{${otpLength}}`}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, otpLength))}
                placeholder={`${otpLength}-digit code`}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-center text-lg tracking-[0.4em] text-white outline-none focus:border-emerald-500"
              />
            </>
          )}
          {step === "password" && (
            <>
              <label className="block text-sm font-medium text-slate-200" htmlFor="reset-new-password">New password</label>
              <input
                id="reset-new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
              />
              <label className="block text-sm font-medium text-slate-200" htmlFor="reset-confirm-password">Confirm new password</label>
              <input
                id="reset-confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter new password"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
              />
            </>
          )}
          <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : step === "password" ? <CheckCircle2 className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
            {loading ? "Please wait..." : step === "phone" ? "Send SMS code" : step === "otp" ? "Verify code" : "Save new password"}
          </button>
        </form>
      </section>
    </div>
  );
};

export default PasswordResetFlow;
