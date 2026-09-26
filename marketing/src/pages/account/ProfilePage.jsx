import React, { useState, useEffect } from "react";
import {
  User, Building2, Mail, Phone, Globe, MapPin,
  CheckCircle2, AlertCircle, Loader2, Save
} from "lucide-react";
import { profileApi } from "../../api";
import { getErrorMessage } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import Badge from "../../components/common/Badge";
import Skeleton from "../../components/common/Skeleton";

const ProfilePage = () => {
  const { partner, refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    contactPhone: "",
    website: "",
    address: "",
  });

  useEffect(() => {
    if (partner) {
      setFormData({
        name: partner.name || "",
        email: partner.email || "",
        contactPhone: partner.contactPhone || "",
        website: partner.website || "",
        address: partner.address || "",
      });
    }
  }, [partner]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);

    try {
      const res = await profileApi.update({
        name: formData.name,
        contactPhone: formData.contactPhone,
        website: formData.website,
        address: formData.address,
      });

      if (res.data?.success) {
        setSuccess(true);
        refreshUser();
      } else {
        setError(res.data?.message || "Failed to update profile.");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to update profile."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-xl font-extrabold text-[var(--mp-ink)]">Partner Profile</h2>
        <p className="text-xs text-[var(--mp-muted)] mt-0.5">
          Manage your organization credentials and representative contact information
        </p>
      </div>

      {/* Success alert */}
      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
          <span>Profile information updated successfully.</span>
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-center gap-2">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Profile Card */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[var(--mp-line)] shadow-sm space-y-6">
        {/* Top Header Badge */}
        <div className="flex items-center justify-between pb-6 border-b border-[var(--mp-line)]">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white font-bold text-base flex items-center justify-center shadow-sm">
              {(partner?.name || "MP").slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--mp-ink)]">{partner?.name}</h3>
              <p className="text-xs font-mono text-[var(--mp-muted)]">Code: {partner?.code}</p>
            </div>
          </div>
          <Badge status={partner?.status || "ACTIVE"} />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Organization Name */}
            <div>
              <label className="block text-xs font-bold text-[var(--mp-ink-2)] mb-1">
                Partner / Organization Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-[var(--mp-line)] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                required
              />
            </div>

            {/* Email (Read only) */}
            <div>
              <label className="block text-xs font-bold text-[var(--mp-ink-2)] mb-1">
                Login Email Address
              </label>
              <input
                type="email"
                value={formData.email}
                disabled
                className="w-full px-4 py-2.5 rounded-xl border border-[var(--mp-line)] bg-[var(--mp-bg)] text-sm text-[var(--mp-muted)] cursor-not-allowed"
              />
              <span className="text-[10px] text-[var(--mp-muted)] mt-0.5 block">Managed by administrator</span>
            </div>

            {/* Phone */}
            <div>
              <label className="block text-xs font-bold text-[var(--mp-ink-2)] mb-1">
                Contact Phone Number
              </label>
              <input
                type="text"
                value={formData.contactPhone}
                onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                placeholder="e.g. +977 9801234567"
                className="w-full px-4 py-2.5 rounded-xl border border-[var(--mp-line)] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            {/* Website */}
            <div>
              <label className="block text-xs font-bold text-[var(--mp-ink-2)] mb-1">
                Website / Online URL
              </label>
              <input
                type="text"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                placeholder="https://company.com"
                className="w-full px-4 py-2.5 rounded-xl border border-[var(--mp-line)] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs font-bold text-[var(--mp-ink-2)] mb-1">
              Physical Business Address
            </label>
            <textarea
              rows={2}
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="e.g. Kathmandu, Bagmati Province"
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--mp-line)] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Submit */}
          <div className="pt-3">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving changes…
                </>
              ) : (
                <>
                  <Save size={14} />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProfilePage;
