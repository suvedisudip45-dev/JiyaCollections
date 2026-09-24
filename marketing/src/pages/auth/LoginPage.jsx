import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Eye, EyeOff, BadgeCheck, Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";

const LoginPage = () => {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/dashboard";

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

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
    const result = await login(email, password);
    setLoading(false);

    if (result.success) {
      navigate(from, { replace: true });
    } else {
      setError(result.message || "Login failed. Please check your credentials.");
    }
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
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
            </form>

            {/* Footer note */}
            <p className="text-center text-xs text-[var(--mp-muted)] mt-6">
              🔒 Credentials are encrypted in transit
            </p>
            <p className="text-center text-xs text-[var(--mp-muted)] mt-1">
              Don't have an account?{" "}
              <span className="text-brand-600 font-medium">Contact your Aama Clothings representative</span>
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
