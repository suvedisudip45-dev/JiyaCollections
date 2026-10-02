/* eslint-disable react/prop-types */
import { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";
import CryptoJS from "crypto-js";

// Encrypt a plaintext password with AES-256-CBC using a random IV
const encryptPassword = (plaintext) => {
  const keyHex = import.meta.env.VITE_AES_KEY;
  const key = CryptoJS.enc.Hex.parse(keyHex);
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return {
    encryptedPassword: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
    iv: iv.toString(CryptoJS.enc.Hex),
  };
};

const ChangePassword = ({ token, forced = false, onPasswordChanged }) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const getPasswordStrength = (pwd) => {
    if (!pwd) return null;
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    if (score <= 1) return { label: "Weak", color: "bg-red-500", width: "w-1/5" };
    if (score <= 2) return { label: "Fair", color: "bg-orange-400", width: "w-2/5" };
    if (score <= 3) return { label: "Good", color: "bg-yellow-400", width: "w-3/5" };
    if (score <= 4) return { label: "Strong", color: "bg-emerald-500", width: "w-4/5" };
    return { label: "Very Strong", color: "bg-emerald-600", width: "w-full" };
  };

  const strength = getPasswordStrength(newPassword);

  const onSubmitHandler = async (e) => {
    e.preventDefault();

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("All fields are required");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    if (currentPassword === newPassword) {
      toast.error("New password must be different from the current password");
      return;
    }

    try {
      setLoading(true);

      // AES-encrypt both current and new passwords
      const { encryptedPassword: currentEncryptedPassword, iv: currentIv } =
        encryptPassword(currentPassword);
      const { encryptedPassword: newEncryptedPassword, iv: newIv } =
        encryptPassword(newPassword);

      const response = await axios.post(
        backendUrl + "/api/user/admin/change-password",
        {
          currentEncryptedPassword,
          currentIv,
          newEncryptedPassword,
          newIv,
        },
        { headers: { token } }
      );

      if (response.data.success) {
        toast.success("Password changed successfully!");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        onPasswordChanged?.();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Password could not be changed.");
    } finally {
      setLoading(false);
    }
  };

  const EyeIcon = ({ show, toggle }) => (
    <button
      type="button"
      onClick={toggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
      tabIndex={-1}
    >
      {show ? (
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
        </svg>
      ) : (
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      )}
    </button>
  );

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          {forced ? "Set your Admin password" : "Change Admin Password"}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {forced ? "Change the initial password before continuing to the Admin Portal." : "Update your admin panel password. All passwords are AES-256 encrypted in transit."}
        </p>
      </div>

      {/* Security note */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl mb-6">
        <svg className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <div className="text-xs text-blue-700">
          <p className="font-semibold mb-0.5">Security Notice</p>
          <p>Your password is stored as a bcrypt hash in the database. It is never stored in plain text.</p>
        </div>
      </div>

      <form onSubmit={onSubmitHandler} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        {/* Current Password */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Current Password
          </label>
          <div className="relative">
            <input
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              required
              className="w-full px-3 py-2.5 pr-10 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition"
            />
            <EyeIcon show={showCurrent} toggle={() => setShowCurrent((v) => !v)} />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-slate-100" />

        {/* New Password */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            New Password
          </label>
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              required
              className="w-full px-3 py-2.5 pr-10 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition"
            />
            <EyeIcon show={showNew} toggle={() => setShowNew((v) => !v)} />
          </div>

          {/* Password strength bar */}
          {newPassword && strength && (
            <div className="mt-2">
              <div className="w-full bg-slate-100 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${strength.color} ${strength.width}`}
                />
              </div>
              <p className={`text-xs mt-1 font-medium ${
                strength.label === "Weak" ? "text-red-500" :
                strength.label === "Fair" ? "text-orange-500" :
                strength.label === "Good" ? "text-yellow-600" :
                "text-emerald-600"
              }`}>
                {strength.label} password
              </p>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Confirm New Password
          </label>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              required
              className={`w-full px-3 py-2.5 pr-10 border rounded-lg text-sm focus:outline-none focus:ring-1 transition ${
                confirmPassword && confirmPassword !== newPassword
                  ? "border-red-400 focus:border-red-400 focus:ring-red-200"
                  : confirmPassword && confirmPassword === newPassword
                  ? "border-emerald-400 focus:border-emerald-500 focus:ring-emerald-200"
                  : "border-slate-300 focus:border-slate-600 focus:ring-slate-600"
              }`}
            />
            <EyeIcon show={showConfirm} toggle={() => setShowConfirm((v) => !v)} />
          </div>
          {confirmPassword && confirmPassword !== newPassword && (
            <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
          )}
          {confirmPassword && confirmPassword === newPassword && (
            <p className="text-xs text-emerald-600 mt-1">✓ Passwords match</p>
          )}
        </div>

        {/* Requirements */}
        <div className="text-xs text-slate-500 space-y-1 bg-slate-50 rounded-lg p-3">
          <p className="font-medium text-slate-600 mb-1.5">Password requirements:</p>
          {[
            { check: newPassword.length >= 8, text: "At least 8 characters" },
            { check: /[A-Z]/.test(newPassword), text: "One uppercase letter" },
            { check: /[0-9]/.test(newPassword), text: "One number" },
            { check: /[^A-Za-z0-9]/.test(newPassword), text: "One special character (recommended)" },
          ].map(({ check, text }) => (
            <div key={text} className="flex items-center gap-1.5">
              <span className={check && newPassword ? "text-emerald-500" : "text-slate-300"}>
                {check && newPassword ? "✓" : "○"}
              </span>
              <span className={check && newPassword ? "text-emerald-600" : ""}>{text}</span>
            </div>
          ))}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading && (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
          {loading ? "Updating..." : "Update Password"}
        </button>
      </form>
    </div>
  );
};

export default ChangePassword;
