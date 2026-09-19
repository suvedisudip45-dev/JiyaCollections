/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState } from "react";
import { ShopContext } from "../context/ShopContext";
import Title from "../components/Title";
import axios from "axios";
import { toast } from "react-toastify";
import {
  isSoundEnabled,
  setSoundEnabled,
  playSwitchSound,
  playCountSound,
  playAddToCartSound,
} from "../utils/soundEffects";

// ── Small reusable field component ───────────────────────────────────────────
const Field = ({ label, value, name, type = "text", readOnly, placeholder, onChange, hint }) => (
  <div>
    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">
      {label}
    </label>
    <div className="relative">
      <input
        type={type}
        name={name}
        value={value}
        readOnly={readOnly}
        disabled={readOnly}
        placeholder={placeholder}
        onChange={onChange}
        className={`w-full border rounded-xl py-2.5 px-4 text-sm transition-all focus:outline-none ${
          readOnly
            ? "bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed"
            : "bg-white border-gray-300 text-gray-900 focus:border-black focus:ring-1 focus:ring-black/10"
        }`}
      />
      {readOnly && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2">
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </span>
      )}
    </div>
    {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
  </div>
);

// ── Password field with show/hide toggle ─────────────────────────────────────
const PasswordField = ({ label, name, value, onChange, placeholder }) => {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          name={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full border border-gray-300 rounded-xl py-2.5 px-4 pr-10 text-sm focus:outline-none focus:border-black focus:ring-1 focus:ring-black/10 text-gray-900"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {show ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
};

// ── Password strength bar ─────────────────────────────────────────────────────
const PasswordStrength = ({ password }) => {
  if (!password) return null;
  const score =
    (password.length >= 8 ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0);
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  const colors = ["", "bg-red-400", "bg-amber-400", "bg-blue-400", "bg-emerald-500"];
  const textColors = ["", "text-red-500", "text-amber-500", "text-blue-500", "text-emerald-600"];
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i <= score ? colors[score] : "bg-gray-200"}`} />
        ))}
      </div>
      <p className={`text-[11px] font-medium ${textColors[score]}`}>{labels[score]}</p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const Profile = () => {
  const { token, backendUrl, navigate, currency = "Rs " } = useContext(ShopContext);

  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [loyalty, setLoyalty] = useState(null);

  const [profile, setProfile] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [editData, setEditData] = useState({ ...profile });
  const [soundEnabled, setSoundEnabledState] = useState(isSoundEnabled());

  const [pwData, setPwData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!token) {
      navigate("/login");
    }
  }, [token]);

  // Fetch user profile and loyalty on mount
  useEffect(() => {
    const fetchProfileAndLoyalty = async () => {
      if (!token) return;
      try {
        setLoading(true);
        const [profRes, loyRes] = await Promise.all([
          axios.get(`${backendUrl}/api/user/profile`, { headers: { token } }),
          axios.get(`${backendUrl}/api/loyalty/my-status`, { headers: { token } }),
        ]);

        if (profRes.data.success && profRes.data.user) {
          const u = profRes.data.user;
          const data = {
            firstName: u.firstName || "",
            lastName: u.lastName || "",
            email: u.email || "",
            phone: u.phone || "",
          };
          setProfile(data);
          setEditData(data);
        }

        if (loyRes.data.success && loyRes.data.loyalty) {
          setLoyalty(loyRes.data.loyalty);
        }
      } catch (err) {
        console.error(err);
        toast.error("Error loading account data");
      } finally {
        setLoading(false);
      }
    };
    fetchProfileAndLoyalty();
  }, [token]);

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCancelEdit = () => {
    setEditData({ ...profile });
    setEditMode(false);
  };

  const handleSaveProfile = async () => {
    if (!editData.firstName.trim() || !editData.lastName.trim()) {
      toast.error("First and last name are required");
      return;
    }
    if (editData.phone && editData.phone.trim().length > 0 && editData.phone.trim().length < 7) {
      toast.error("Please enter a valid phone number");
      return;
    }
    try {
      setSavingProfile(true);
      const res = await axios.post(
        `${backendUrl}/api/user/profile/update`,
        {
          firstName: editData.firstName.trim(),
          lastName: editData.lastName.trim(),
          phone: editData.phone.trim(),
        },
        { headers: { token } }
      );
      if (res.data.success) {
        const u = res.data.user;
        const updated = {
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          phone: u.phone || "",
        };
        setProfile(updated);
        setEditData(updated);
        setEditMode(false);
        toast.success("Profile updated successfully!");
      } else {
        toast.error(res.data.message || "Failed to update profile");
      }
    } catch (err) {
      toast.error(err.message || "Network error");
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (!pwData.currentPassword) {
      toast.error("Please enter your current password");
      return;
    }
    if (pwData.newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (pwData.newPassword !== pwData.confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    if (pwData.currentPassword === pwData.newPassword) {
      toast.error("New password must be different from current password");
      return;
    }
    try {
      setSavingPassword(true);
      const res = await axios.post(
        `${backendUrl}/api/user/password/change`,
        {
          currentPassword: pwData.currentPassword,
          newPassword: pwData.newPassword,
        },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Password changed successfully!");
        setPwData({ currentPassword: "", newPassword: "", confirmPassword: "" });
      } else {
        toast.error(res.data.message || "Failed to change password");
      }
    } catch (err) {
      toast.error(err.message || "Network error");
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="border-t min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-gray-200 border-t-black rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading your profile...</p>
        </div>
      </div>
    );
  }

  const initials = `${profile.firstName?.[0] || ""}${profile.lastName?.[0] || ""}`.toUpperCase();

  return (
    <div className="border-t pt-10 pb-20">
      {/* Page Header */}
      <div className="text-2xl mb-8">
        <Title text1={"MY"} text2={"PROFILE"} />
      </div>

      <div className="max-w-3xl mx-auto space-y-6">

        {/* ── Avatar + Name Banner ─────────────────────────────────────── */}
        <div className="bg-gradient-to-br from-gray-900 to-gray-700 rounded-2xl p-6 flex items-center gap-5 shadow-lg">
          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-white text-2xl font-black ring-2 ring-white/30 select-none shrink-0">
            {initials || "👤"}
          </div>
          <div>
            <h2 className="text-white text-xl font-bold leading-tight">
              {profile.firstName} {profile.lastName}
            </h2>
            <p className="text-gray-300 text-sm mt-0.5">{profile.email}</p>
            {profile.phone && (
              <p className="text-gray-400 text-xs mt-0.5 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {profile.phone}
              </p>
            )}
          </div>
          <div className="ml-auto">
            <span className="inline-flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 text-xs font-semibold px-3 py-1.5 rounded-full border border-emerald-400/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Active
            </span>
          </div>
        </div>

        {/* ── Gamified Purchase Level & Rewards Card ──────────────────────── */}
        {loyalty && (
          <div className="bg-gradient-to-br from-gray-900 via-slate-900 to-indigo-950 text-white rounded-2xl p-6 shadow-xl border border-indigo-900/50 relative overflow-hidden">
            {/* Background Glow */}
            <div
              className="absolute -right-16 -top-16 w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none"
              style={{ backgroundColor: loyalty.currentLevel?.color || "#3B82F6" }}
            />

            <div className="relative z-10 space-y-5">
              {/* Header: Level Badge & Tier Info */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shadow-lg border-2"
                    style={{
                      backgroundColor: `${loyalty.currentLevel?.color || "#3B82F6"}25`,
                      borderColor: `${loyalty.currentLevel?.color || "#3B82F6"}80`,
                    }}
                  >
                    {loyalty.currentLevel?.badgeIcon || "⭐"}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: `${loyalty.currentLevel?.color || "#3B82F6"}30`,
                          color: loyalty.currentLevel?.color || "#60A5FA",
                        }}
                      >
                        Level {loyalty.currentLevel?.levelNumber || 1}
                      </span>
                      <span className="text-xs text-gray-400 font-semibold">• VIP Customer</span>
                    </div>
                    <h3 className="text-xl font-black text-white mt-0.5">
                      {loyalty.currentLevel?.name}
                    </h3>
                  </div>
                </div>

                {/* Lifetime Stats Pill */}
                <div className="flex items-center gap-4 bg-white/5 backdrop-blur-md px-4 py-2.5 rounded-xl border border-white/10 self-start sm:self-auto">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-gray-400">Membership</p>
                    <p className="text-sm font-black text-emerald-400">
                      Active VIP
                    </p>
                  </div>
                  <div className="w-px h-8 bg-white/10" />
                  <div>
                    <p className="text-[10px] font-bold uppercase text-gray-400">Total Orders</p>
                    <p className="text-sm font-black text-amber-400">
                      {loyalty.totalOrders || 0}
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress Bar Towards Next Level */}
              {loyalty.nextLevel ? (
                <div className="p-4 bg-white/5 backdrop-blur-md rounded-xl border border-white/10 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-gray-200 flex items-center gap-1.5">
                      <span>Next Level:</span>
                      <strong className="text-white">
                        {loyalty.nextLevel.name}
                      </strong>
                    </span>
                    <span className="font-black text-indigo-300">
                      {loyalty.progressPercentage}% Completed
                    </span>
                  </div>

                  {/* Visual Bar */}
                  <div className="w-full bg-white/10 h-3 rounded-full overflow-hidden p-0.5 border border-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 via-indigo-400 to-emerald-400 transition-all duration-700 shadow-sm"
                      style={{ width: `${Math.min(100, loyalty.progressPercentage)}%` }}
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-gray-300 gap-1 pt-0.5">
                    <span>
                      {loyalty.remainingOrders > 0
                        ? `Place ${loyalty.remainingOrders} more order(s) to unlock next tier`
                        : "Ready for next tier unlock"}
                    </span>
                    <span className="text-gray-400">
                      Tier Progress: {loyalty.progressPercentage}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs font-bold flex items-center gap-2">
                  <span>✓</span> Congratulations! You have reached the Maximum VIP Tier!
                </div>
              )}

              {/* Unlocked Benefits & Rewards Breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* Active Level Perks */}
                <div className="p-3 bg-emerald-950/40 rounded-xl border border-emerald-500/30 text-xs space-y-1">
                  <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                    <span>✓</span> Current Unlocked Rewards
                  </p>
                  <p className="font-bold text-white text-sm">
                    {loyalty.currentLevel?.rewardTitle}
                  </p>
                  {loyalty.currentLevel?.rewardDescription && (
                    <p className="text-[11px] text-gray-300">{loyalty.currentLevel.rewardDescription}</p>
                  )}
                </div>

                {/* Upcoming Next Level Teaser */}
                {loyalty.nextLevel ? (
                  <div className="p-3 bg-indigo-950/40 rounded-xl border border-indigo-500/30 text-xs space-y-1">
                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                      <span>•</span> Unlock at Next Level ({loyalty.nextLevel.name})
                    </p>
                    <p className="font-bold text-white text-sm">
                      {loyalty.nextLevel.rewardTitle}
                    </p>
                    {loyalty.nextLevel.rewardDescription && (
                      <p className="text-[11px] text-gray-300">{loyalty.nextLevel.rewardDescription}</p>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-xs flex items-center justify-center text-gray-300 text-center">
                    Enjoy lifetime highest-priority packaging & personalized handwritten letters!
                  </div>
                )}
              </div>

              {/* Tier Roadmap Pills */}
              {loyalty.allLevels && loyalty.allLevels.length > 0 && (
                <div className="pt-2 border-t border-white/10">
                  <p className="text-[10px] uppercase font-bold text-gray-400 mb-2">Purchase Level Milestones</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {loyalty.allLevels.map((lvl) => {
                      const isAchieved = (loyalty.currentLevel?.levelNumber || 1) >= lvl.levelNumber;
                      const isCurrent = (loyalty.currentLevel?.levelNumber || 1) === lvl.levelNumber;
                      return (
                        <div
                          key={lvl.id}
                          className={`p-2 rounded-xl text-center border transition-all ${
                            isCurrent
                              ? "bg-white/15 border-white ring-1 ring-white/50 shadow-md scale-102"
                              : isAchieved
                              ? "bg-white/5 border-white/20 text-gray-200"
                              : "bg-black/20 border-white/5 text-gray-500 opacity-60"
                          }`}
                        >
                          <div className="text-lg">{lvl.badgeIcon}</div>
                          <p className="font-bold text-[11px] truncate mt-0.5">{lvl.name}</p>
                          <p className="text-[9px] text-gray-400">
                            {lvl.minOrders} order(s) required
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Personal Information Card ─────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <h3 className="font-bold text-gray-900 text-sm">Personal Information</h3>
            </div>
            {!editMode ? (
              <button
                onClick={() => setEditMode(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-black border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 active:scale-95 transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleCancelEdit}
                  className="text-xs font-semibold text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 active:scale-95 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveProfile}
                  disabled={savingProfile}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-black border border-black rounded-lg px-3 py-1.5 hover:bg-gray-800 active:scale-95 transition-all disabled:opacity-50"
                >
                  {savingProfile ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  Save Changes
                </button>
              </div>
            )}
          </div>

          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field
              label="First Name"
              name="firstName"
              value={editMode ? editData.firstName : profile.firstName}
              readOnly={!editMode}
              placeholder="First name"
              onChange={handleEditChange}
            />
            <Field
              label="Last Name"
              name="lastName"
              value={editMode ? editData.lastName : profile.lastName}
              readOnly={!editMode}
              placeholder="Last name"
              onChange={handleEditChange}
            />
            <Field
              label="Email Address"
              name="email"
              type="email"
              value={profile.email}
              readOnly
              hint="Email address cannot be changed"
            />
            <Field
              label="Phone Number"
              name="phone"
              type="tel"
              value={editMode ? editData.phone : profile.phone}
              readOnly={!editMode}
              placeholder="e.g. 9841234567"
              onChange={handleEditChange}
            />
          </div>

          {editMode && (
            <div className="px-6 pb-5">
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <svg className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  Your name and phone can be updated. <strong>Email cannot be changed.</strong> Past orders will retain the information they were placed with.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── Change Password Card ──────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-100">
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <h3 className="font-bold text-gray-900 text-sm">Change Password</h3>
          </div>

          <form onSubmit={handlePasswordChange} className="p-6 space-y-5">
            <PasswordField
              label="Current Password *"
              name="currentPassword"
              value={pwData.currentPassword}
              onChange={(e) => setPwData((p) => ({ ...p, currentPassword: e.target.value }))}
              placeholder="Enter your current password"
            />

            <div>
              <PasswordField
                label="New Password *"
                name="newPassword"
                value={pwData.newPassword}
                onChange={(e) => setPwData((p) => ({ ...p, newPassword: e.target.value }))}
                placeholder="At least 8 characters"
              />
              <PasswordStrength password={pwData.newPassword} />
            </div>

            <PasswordField
              label="Confirm New Password *"
              name="confirmPassword"
              value={pwData.confirmPassword}
              onChange={(e) => setPwData((p) => ({ ...p, confirmPassword: e.target.value }))}
              placeholder="Re-enter your new password"
            />

            {/* Match indicator */}
            {pwData.confirmPassword && pwData.newPassword && (
              <div className={`flex items-center gap-1.5 text-xs font-medium ${
                pwData.newPassword === pwData.confirmPassword ? "text-emerald-600" : "text-red-500"
              }`}>
                {pwData.newPassword === pwData.confirmPassword ? (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                    </svg>
                    Passwords match
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Passwords do not match
                  </>
                )}
              </div>
            )}

            <div className="pt-1">
              <button
                type="submit"
                disabled={savingPassword}
                className="w-full sm:w-auto bg-black text-white font-semibold px-8 py-2.5 rounded-xl text-sm hover:bg-gray-800 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {savingPassword ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                )}
                {savingPassword ? "Updating..." : "Update Password"}
              </button>
            </div>
          </form>
        </div>

        {/* ── Sound & Audio Experience Preferences ───────────────────── */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center shadow-xs">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M11 5L6 9H2v6h4l5 4V5z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-sm">Interactive Audio & Sound Feedback</h3>
                <p className="text-[11px] text-gray-500">Tactile acoustic feedback when switching garment varieties, adjusting quantities, and adding items to cart.</p>
              </div>
            </div>
            {/* Master Toggle Switch */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={(e) => {
                  const val = e.target.checked;
                  setSoundEnabledState(val);
                  setSoundEnabled(val);
                  if (val) {
                    playAddToCartSound();
                    toast.success("Sound effects enabled!");
                  } else {
                    toast.info("Sound effects muted.");
                  }
                }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black"></div>
            </label>
          </div>

          <div className="p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 rounded-xl p-4 border border-gray-100">
              <div>
                <p className="text-xs font-bold text-gray-800">
                  Current Status:{" "}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${soundEnabled ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-600"}`}>
                    {soundEnabled ? "Audio Enabled (Active)" : "Muted"}
                  </span>
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">Test individual studio synthesizers below:</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!soundEnabled) {
                      setSoundEnabledState(true);
                      setSoundEnabled(true);
                    }
                    playSwitchSound();
                  }}
                  className="px-3 py-1.5 bg-white border border-gray-300 hover:border-black rounded-lg text-xs font-semibold text-gray-700 hover:text-black transition-all active:scale-95 shadow-2xs"
                >
                  🔊 Variety Pop
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!soundEnabled) {
                      setSoundEnabledState(true);
                      setSoundEnabled(true);
                    }
                    playCountSound("inc", 3);
                  }}
                  className="px-3 py-1.5 bg-white border border-gray-300 hover:border-black rounded-lg text-xs font-semibold text-gray-700 hover:text-black transition-all active:scale-95 shadow-2xs"
                >
                  🔢 Stepper Tick
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!soundEnabled) {
                      setSoundEnabledState(true);
                      setSoundEnabled(true);
                    }
                    playAddToCartSound();
                  }}
                  className="px-3 py-1.5 bg-black text-white hover:bg-gray-800 rounded-lg text-xs font-bold transition-all active:scale-95 shadow-xs"
                >
                  ✨ Cart Chime
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Quick Links ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => navigate("/orders")}
            className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-2xl shadow-sm hover:border-gray-400 hover:shadow-md active:scale-[0.98] transition-all text-left group"
          >
            <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center group-hover:bg-black group-hover:text-white transition-all">
              <svg className="w-5 h-5 text-gray-600 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-sm text-gray-900">My Orders</p>
              <p className="text-xs text-gray-500">View order history & track deliveries</p>
            </div>
            <svg className="w-4 h-4 text-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            onClick={() => navigate("/collection")}
            className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-2xl shadow-sm hover:border-gray-400 hover:shadow-md active:scale-[0.98] transition-all text-left group"
          >
            <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center group-hover:bg-black group-hover:text-white transition-all">
              <svg className="w-5 h-5 text-gray-600 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-sm text-gray-900">Browse Collection</p>
              <p className="text-xs text-gray-500">Explore our latest arrivals</p>
            </div>
            <svg className="w-4 h-4 text-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

      </div>
    </div>
  );
};

export default Profile;
