import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, BadgeCheck, CheckCircle2, Loader2 } from "lucide-react";
import { authApi } from "../../api/auth";
import { getErrorMessage } from "../../api/client";

const SignupPage = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "", contactPhone: "", website: "", address: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const updateField = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    if (!form.name.trim() || !form.email.trim() || !form.password) return setError("Business name, email, and password are required.");
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    if (form.password !== form.confirmPassword) return setError("Passwords do not match.");

    setLoading(true);
    try {
      const response = await authApi.signup({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        contactPhone: form.contactPhone.trim() || undefined,
        website: form.website.trim() || undefined,
        address: form.address.trim() || undefined,
      });
      if (!response.data?.success) throw new Error(response.data?.message || "Signup failed.");
      setSuccess(response.data.message || "Signup submitted for review.");
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Signup failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-950 via-brand-800 to-brand-600 flex items-center justify-center px-4 py-10">
      <div className="relative w-full max-w-xl">
        <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-brand-400 via-brand-600 to-brand-800" />
          <div className="px-7 py-8 sm:px-10">
            <div className="flex flex-col items-center mb-7">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 flex items-center justify-center shadow-lg mb-3">
                <BadgeCheck size={26} className="text-white" />
              </div>
              <h1 className="text-2xl font-bold text-[var(--mp-ink)]">Create Partner Account</h1>
              <p className="text-sm text-[var(--mp-muted)] mt-1 text-center">Submit your business details for Aama Clothings verification</p>
            </div>

            {error && <div role="alert" className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-5 text-sm"><AlertCircle size={16} className="mt-0.5 flex-shrink-0" /><span>{error}</span></div>}
            {success && <div role="status" className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 mb-5 text-sm"><CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" /><span>{success}</span></div>}

            {!success ? (
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label className="block text-sm font-semibold text-[var(--mp-ink)] mb-1.5" htmlFor="partner-name">Business / Partner Name</label>
                  <input id="partner-name" value={form.name} onChange={(event) => updateField("name", event.target.value)} className="w-full rounded-xl border border-[var(--mp-line)] px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" required />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-[var(--mp-ink)] mb-1.5" htmlFor="partner-email">Email</label>
                    <input id="partner-email" type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} className="w-full rounded-xl border border-[var(--mp-line)] px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[var(--mp-ink)] mb-1.5" htmlFor="partner-phone">Phone</label>
                    <input id="partner-phone" value={form.contactPhone} onChange={(event) => updateField("contactPhone", event.target.value)} className="w-full rounded-xl border border-[var(--mp-line)] px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-[var(--mp-ink)] mb-1.5" htmlFor="partner-password">Password</label>
                    <input id="partner-password" type="password" value={form.password} onChange={(event) => updateField("password", event.target.value)} className="w-full rounded-xl border border-[var(--mp-line)] px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" required minLength={8} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[var(--mp-ink)] mb-1.5" htmlFor="partner-confirm-password">Confirm Password</label>
                    <input id="partner-confirm-password" type="password" value={form.confirmPassword} onChange={(event) => updateField("confirmPassword", event.target.value)} className="w-full rounded-xl border border-[var(--mp-line)] px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" required />
                  </div>
                </div>
                <input value={form.website} onChange={(event) => updateField("website", event.target.value)} placeholder="Website or social link (optional)" className="w-full rounded-xl border border-[var(--mp-line)] px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                <textarea value={form.address} onChange={(event) => updateField("address", event.target.value)} placeholder="Business address (optional)" rows={2} className="w-full rounded-xl border border-[var(--mp-line)] px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none" />
                <button type="submit" disabled={loading} className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-800 text-white font-bold text-sm shadow-lg disabled:opacity-60 flex items-center justify-center gap-2">
                  {loading ? <><Loader2 size={16} className="animate-spin" />Submitting...</> : "Submit Signup"}
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-[var(--mp-ink-2)] text-center">Your account remains pending until an administrator verifies your business and assigns your partner code.</p>
                <button type="button" onClick={() => navigate("/login")} className="w-full py-3 rounded-xl bg-brand-700 text-white font-bold text-sm">Return to Sign In</button>
              </div>
            )}

            <p className="text-center text-xs text-[var(--mp-muted)] mt-6">Already have an account? <Link to="/login" className="text-brand-600 font-semibold hover:underline">Sign in</Link></p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
