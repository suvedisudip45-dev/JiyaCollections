import React, { useState } from "react";
import {
  Lock, KeyRound, ShieldCheck, CheckCircle2,
  AlertCircle, Loader2, Save
} from "lucide-react";
import { profileApi } from "../../api";
import { getErrorMessage } from "../../api/client";

const SettingsPage = () => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setSuccess(false);
    setError(null);

    if (newPassword.length < 6) {
      return setError("New password must be at least 6 characters.");
    }
    if (newPassword !== confirmPassword) {
      return setError("New passwords do not match.");
    }

    setSaving(true);
    try {
      const res = await profileApi.changePassword({
        currentPassword,
        newPassword,
      });

      if (res.data?.success) {
        setSuccess(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setError(res.data?.message || "Failed to change password.");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to update password."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-xl font-extrabold text-[var(--mp-ink)]">Account & Security Settings</h2>
        <p className="text-xs text-[var(--mp-muted)] mt-0.5">
          Update portal access password and review security authentication controls
        </p>
      </div>

      {/* Success alert */}
      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
          <span>Password changed successfully. Your next login will require the new credentials.</span>
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-center gap-2">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Password Change Card */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[var(--mp-line)] shadow-sm space-y-6">
        <div className="flex items-center gap-2.5 pb-4 border-b border-[var(--mp-line)]">
          <div className="w-10 h-10 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
            <KeyRound size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--mp-ink)]">Change Password</h3>
            <p className="text-xs text-[var(--mp-muted)]">Ensure your account uses a strong, unique password</p>
          </div>
        </div>

        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[var(--mp-ink-2)] mb-1">
              Current Password
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter existing password"
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--mp-line)] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[var(--mp-ink-2)] mb-1">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full px-4 py-2.5 rounded-xl border border-[var(--mp-line)] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--mp-ink-2)] mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-type new password"
                className="w-full px-4 py-2.5 rounded-xl border border-[var(--mp-line)] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                required
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Updating password…
                </>
              ) : (
                <>
                  <Save size={14} />
                  Update Password
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Security Architecture Card */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[var(--mp-line)] shadow-sm space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--mp-line)]">
          <div className="w-10 h-10 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--mp-ink)]">Security & Data Isolation Controls</h3>
            <p className="text-xs text-[var(--mp-muted)]">Enterprise protection standards applied to your account</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-[var(--mp-ink-2)]">
          <div className="p-3 rounded-2xl bg-[var(--mp-bg)] border border-[var(--mp-line)]">
            <span className="font-bold text-[var(--mp-ink)]">🔒 JWT Token Auth</span>
            <p className="text-[11px] text-[var(--mp-muted)] mt-0.5">
              Cryptographically signed tokens sent via authorization headers.
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-[var(--mp-bg)] border border-[var(--mp-line)]">
            <span className="font-bold text-[var(--mp-ink)]">🛡️ Partner-Scoped DB Isolation</span>
            <p className="text-[11px] text-[var(--mp-muted)] mt-0.5">
              Backend strictly enforces tenant data separation on all queries.
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-[var(--mp-bg)] border border-[var(--mp-line)]">
            <span className="font-bold text-[var(--mp-ink)]">🔑 AES-256 Payload Encryption</span>
            <p className="text-[11px] text-[var(--mp-muted)] mt-0.5">
              Credentials encrypted in flight before dispatching to API.
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-[var(--mp-bg)] border border-[var(--mp-line)]">
            <span className="font-bold text-[var(--mp-ink)]">⚡ Rate-Limiting Active</span>
            <p className="text-[11px] text-[var(--mp-muted)] mt-0.5">
              Protects QR validation endpoints against brute-force attempts.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
