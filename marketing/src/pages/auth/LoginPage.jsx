import React, { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { ArrowLeft, BadgeCheck, Eye, EyeOff, Loader2, AlertCircle, MailCheck, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { authApi } from "../../api/auth";

const formatCountdown = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

const LoginPage = () => {
  const { login, verifyTwoFactor, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/dashboard";

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [loginStep, setLoginStep] = useState("credentials");
  const [challenge, setChallenge] = useState(null);
  const [method, setMethod] = useState("");
  const [otp, setOtp] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [resendAvailableAt, setResendAvailableAt] = useState("");
  const [clock, setClock] = useState(0);

  useEffect(() => {
    const updateClock = () => setClock(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const secondsUntil = (timestamp) => Math.max(0, Math.ceil((Date.parse(timestamp || "") - clock) / 1000) || 0);
  const expiresIn = secondsUntil(expiresAt);
  const resendIn = secondsUntil(resendAvailableAt);

  // Already authenticated → redirect
  if (isAuthenticated) {
    navigate(from, { replace: true });
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.trim())    return setError("Email is required.");
    if (!password)        return setError("Password is required.");

    setLoading(true);
    try {
      if (loginStep === "credentials") {
        const result = await login(email, password);
        if (result.requiresTwoFactor) {
          setChallenge(result.challenge);
          setMethod(result.challenge.availableMethods?.[0] || "");
          setLoginStep("method");
        } else if (result.success) {
          navigate(from, { replace: true });
        } else {
          setError(result.message || "Login failed. Please check your credentials.");
        }
      } else if (loginStep === "method") {
        const response = await authApi.sendTwoFactorCode(challenge.challengeId, method);
        setExpiresAt(response.data.expiresAt);
        setResendAvailableAt(response.data.resendAvailableAt);
        setOtp("");
        setLoginStep("otp");
      } else {
        const result = await verifyTwoFactor(challenge.challengeId, otp);
        if (result.success) navigate(from, { replace: true });
        else setError(result.message || "Invalid or expired verification code.");
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Verification could not be completed.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await authApi.resendTwoFactorCode(challenge.challengeId);
      setExpiresAt(response.data.expiresAt);
      setResendAvailableAt(response.data.resendAvailableAt);
      setOtp("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "A new code could not be sent.");
    } finally {
      setLoading(false);
    }
  };

  const restartLogin = () => {
    setChallenge(null);
    setMethod("");
    setOtp("");
    setExpiresAt("");
    setResendAvailableAt("");
    setLoginStep("credentials");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-950 via-brand-800 to-brand-600 flex items-center justify-center px-4 py-12">
      {/* Decorative blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-brand-700/30 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Card */}
        <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden">
          {/* Top accent strip */}
          <div className="h-1.5 bg-gradient-to-r from-brand-400 via-brand-600 to-brand-800" />

          <div className="px-8 py-10">
            {/* Logo */}
            <div className="flex flex-col items-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 flex items-center justify-center shadow-lg mb-4">
                <BadgeCheck size={28} className="text-white" strokeWidth={2} />
              </div>
              <h1 className="text-2xl font-bold text-[var(--mp-ink)]">Marketing Portal</h1>
              <p className="text-sm text-[var(--mp-muted)] mt-1">Aama Clothings Partner Access</p>
            </div>

            {/* Error */}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-5 text-sm"
              >
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            {loginStep === "credentials" && <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-[var(--mp-ink)] mb-1.5">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  placeholder="partner@company.com"
                  autoComplete="email"
                  className="w-full rounded-xl border border-[var(--mp-line)] px-4 py-3 text-sm text-[var(--mp-ink)] placeholder:text-[var(--mp-muted)] focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                  required
                />
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-[var(--mp-ink)] mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-[var(--mp-line)] px-4 py-3 pr-12 text-sm text-[var(--mp-ink)] placeholder:text-[var(--mp-muted)] focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--mp-muted)] hover:text-[var(--mp-ink)] transition-colors"
                    aria-label={showPwd ? "Hide password" : "Show password"}
                  >
                    {showPwd ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                id="btn-login"
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-800 text-white font-bold text-sm shadow-lg hover:shadow-brand-500/30 hover:from-brand-500 hover:to-brand-700 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Signing in…
                  </>
                ) : "Sign In"}
              </button>
            </form>}

            {loginStep === "method" && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="text-center pb-2">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                    <ShieldCheck size={26} />
                  </div>
                  <h2 className="text-xl font-bold text-[var(--mp-ink)]">Verify your identity</h2>
                  <p className="mt-1 text-sm text-[var(--mp-muted)]">Choose where to receive your sign-in code.</p>
                </div>
                <div className="space-y-2">
                  {challenge?.availableMethods?.map((availableMethod) => {
                    const destination = availableMethod === "SMS" ? challenge.maskedPhone : challenge.maskedEmail;
                    const Icon = availableMethod === "SMS" ? Smartphone : MailCheck;
                    return (
                      <label key={availableMethod} className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${method === availableMethod ? "border-emerald-700 bg-emerald-50/70" : "border-[var(--mp-line)] hover:bg-slate-50"}`}>
                        <input type="radio" name="verification-method" value={availableMethod} checked={method === availableMethod} onChange={() => setMethod(availableMethod)} className="accent-emerald-700" />
                        <Icon size={18} className="text-emerald-800" />
                        <span className="text-sm font-semibold text-[var(--mp-ink)]">{availableMethod === "SMS" ? "Text message" : "Email"}</span>
                        <span className="ml-auto max-w-[55%] break-all text-right text-xs text-[var(--mp-muted)]">{destination}</span>
                      </label>
                    );
                  })}
                </div>
                <button type="submit" disabled={loading || !method} className="w-full rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60">
                  {loading ? <><Loader2 size={16} className="mr-2 inline animate-spin" />Sending code</> : "Send verification code"}
                </button>
                <button type="button" onClick={restartLogin} className="flex w-full items-center justify-center gap-2 py-2 text-sm font-medium text-[var(--mp-muted)] hover:text-[var(--mp-ink)]">
                  <ArrowLeft size={15} /> Back to sign in
                </button>
              </form>
            )}

            {loginStep === "otp" && (
              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                    {method === "SMS" ? <Smartphone size={24} /> : <MailCheck size={24} />}
                  </div>
                  <h2 className="text-xl font-bold text-[var(--mp-ink)]">Enter your verification code</h2>
                  <p className="mt-2 text-sm text-[var(--mp-muted)]">Sent to <span className="font-semibold text-[var(--mp-ink)]">{method === "SMS" ? challenge?.maskedPhone : challenge?.maskedEmail}</span></p>
                </div>
                <div>
                  <label htmlFor="marketing-otp" className="sr-only">One-time verification code</label>
                  <input
                    id="marketing-otp"
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, challenge?.codeLength || 6))}
                    className="w-full rounded-xl border border-[var(--mp-line)] bg-slate-50 px-4 py-4 text-center font-mono text-2xl tracking-[0.45em] text-[var(--mp-ink)] outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={challenge?.codeLength || 6}
                    autoFocus
                    required
                  />
                </div>
                <div className="flex items-center justify-between border-y border-[var(--mp-line)] py-3 text-sm">
                  <span className="text-[var(--mp-muted)]">{expiresIn ? "Code expires in" : "Code expired"}</span>
                  <span aria-live="polite" className={`font-mono font-semibold ${expiresIn ? "text-[var(--mp-ink)]" : "text-red-700"}`}>{expiresIn ? formatCountdown(expiresIn) : "00:00"}</span>
                </div>
                <button type="submit" disabled={loading || otp.length !== (challenge?.codeLength || 6) || expiresIn === 0} className="w-full rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60">
                  {loading ? <><Loader2 size={16} className="mr-2 inline animate-spin" />Checking code</> : "Verify and sign in"}
                </button>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-[var(--mp-muted)]">Didn&apos;t receive the code?</span>
                  <button type="button" onClick={handleResend} disabled={loading || resendIn > 0} className="inline-flex items-center gap-1.5 font-semibold text-emerald-800 hover:text-emerald-700 disabled:text-slate-400">
                    <RefreshCw size={14} />{resendIn > 0 ? `Resend in ${formatCountdown(resendIn)}` : "Resend code"}
                  </button>
                </div>
                <button type="button" onClick={restartLogin} className="flex w-full items-center justify-center gap-2 py-1 text-sm font-medium text-[var(--mp-muted)] hover:text-[var(--mp-ink)]">
                  <ArrowLeft size={15} /> Start over
                </button>
              </form>
            )}

            {/* Footer note */}
            <p className="text-center text-xs text-[var(--mp-muted)] mt-1">
              Don&apos;t have an account?{" "}
              <Link to="/signup" className="text-brand-600 font-semibold hover:underline">Sign up</Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-brand-200/70 mt-6">
          Marketing Partner Portal · Aama Clothings
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
