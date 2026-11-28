import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ArrowLeftRight,
  Building,
  Camera,
  LogOut,
  Menu,
  MapPin,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useManufacturer, backendUrl } from "../context/ManufacturerContext";
import NotificationBell from "./NotificationBell";

const profileImageMaxSize = 10 * 1024 * 1024;
const allowedProfileImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const Navbar = ({ onToggleSidebar }) => {
  const {
    token,
    account,
    setAccount,
    manufacturer,
    distributor,
    driver,
    activeProfile,
    toggleDistributorAvailability,
    logout,
    activeWorkspace,
    availableWorkspaces,
    switchWorkspace,
  } = useManufacturer();
  const navigate = useNavigate();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [uploadingProfileImage, setUploadingProfileImage] = useState(false);
  const profileMenuRef = useRef(null);
  const profileImageInputRef = useRef(null);

  const profile = activeProfile || manufacturer || distributor || driver;
  const hasDistributor =
    availableWorkspaces?.some((workspace) => (
      (typeof workspace === "string" ? workspace : workspace.code) === "DISTRIBUTOR"
    )) || activeWorkspace === "DISTRIBUTOR";
  const hasManufacturer =
    availableWorkspaces?.some((workspace) => (
      (typeof workspace === "string" ? workspace : workspace.code) === "MANUFACTURER"
    )) || activeWorkspace === "MANUFACTURER";
  const isDualRole = hasDistributor && hasManufacturer;
  const isDistributorView = activeWorkspace === "DISTRIBUTOR";
  const isDriverView = activeWorkspace === "DRIVER";
  const isOnline = distributor?.isActive;
  const displayName = profile?.businessName || profile?.name || account?.email || "Account";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "A";
  const profileImageUrl = account?.profileImageUrl || "";
  const workspaceLabel = isDriverView
    ? "Driver workspace"
    : isDistributorView
      ? "Distributor workspace"
      : "Manufacturer workspace";

  useEffect(() => {
    if (!profileMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) setProfileMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileMenuOpen]);

  if (!activeProfile && !manufacturer && !distributor && !driver) return null;

  const handleSwitch = async () => {
    const targetRole = activeWorkspace === "MANUFACTURER" ? "DISTRIBUTOR" : "MANUFACTURER";
    setProfileMenuOpen(false);
    const switched = await switchWorkspace();
    if (switched) navigate(targetRole === "DISTRIBUTOR" ? "/distributor" : "/");
  };

  const requestDistributorAccess = async () => {
    setProfileMenuOpen(false);
    try {
      const response = await axios.post(
        `${backendUrl}/api/manufacturer/distributor-access-request`,
        {},
        { headers: { token } },
      );
      toast.success(response.data.message || "Application submitted for admin approval.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Request could not be submitted.");
    }
  };

  const handleProfileImageChange = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!allowedProfileImageTypes.has(file.type)) {
      toast.error("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > profileImageMaxSize) {
      toast.error("Profile images must be 10 MB or smaller.");
      return;
    }

    const formData = new FormData();
    formData.append("image", file);
    setUploadingProfileImage(true);
    try {
      const response = await axios.post(`${backendUrl}/api/auth/profile-image`, formData, {
        headers: { token },
      });
      if (!response.data?.success || !response.data.profileImageUrl) {
        throw new Error(response.data?.message || "Profile image could not be updated.");
      }
      setAccount((current) => current ? { ...current, profileImageUrl: response.data.profileImageUrl } : current);
      toast.success("Profile image updated.");
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Profile image could not be updated.");
    } finally {
      setUploadingProfileImage(false);
    }
  };

  const openPickupSetup = () => {
    setProfileMenuOpen(false);
    navigate("/pickup-profile");
  };

  const handleLogout = async () => {
    setProfileMenuOpen(false);
    try {
      await logout();
    } catch (error) {
      toast.error(error.response?.data?.message || "Server logout failed; this device has been logged out.");
    }
  };

  return (
    <header className="sticky top-0 z-40 flex min-h-[65px] items-center justify-between gap-3 border-b border-[#dedbd3] bg-white/95 px-3 py-3 shadow-sm backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle navigation menu"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#dedbd3] text-[#575757] transition hover:bg-[#f8f7f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 lg:hidden"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-black text-white shadow-sm ${
            isDriverView ? "bg-sky-700" : isDistributorView ? "bg-emerald-700" : "bg-[#171717]"
          }`}>
            AC
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold leading-tight tracking-tight text-[#171717] sm:text-base">
              Aashrit Corner
            </h1>
            <p className="hidden text-[11px] font-medium text-[#777] sm:block">
              {workspaceLabel}
            </p>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {isDistributorView && (
          <button
            type="button"
            onClick={toggleDistributorAvailability}
            aria-label={isOnline ? "Pause distributor orders" : "Accept distributor orders"}
            title={isOnline ? "Pause accepting orders" : "Resume accepting orders"}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2 text-xs font-semibold transition sm:px-3 ${
              isOnline
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "border-[#dedbd3] bg-[#f8f7f4] text-[#575757] hover:bg-[#dedbd3]/60"
            }`}
          >
            {isOnline
              ? <Wifi className="h-4 w-4" aria-hidden="true" />
              : <WifiOff className="h-4 w-4" aria-hidden="true" />
            }
            <span className="hidden xl:inline">{isOnline ? "Online" : "Offline"}</span>
          </button>
        )}

        <NotificationBell key={activeWorkspace} workspace={activeWorkspace} />

        <div ref={profileMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setProfileMenuOpen((open) => !open)}
            aria-label="Open account profile menu"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#dedbd3] bg-white text-sm font-bold text-[#171717] shadow-sm transition hover:border-emerald-300 hover:bg-[#f8f7f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          >
            {profileImageUrl ? (
              <img src={profileImageUrl} alt="" className="h-full w-full rounded-full object-cover" />
            ) : initials}
          </button>

          {profileMenuOpen && (
            <div
              role="menu"
              aria-label="Account profile"
              className="absolute right-0 top-full z-[70] mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-[#dedbd3] bg-white shadow-xl"
            >
              <div className="flex items-center gap-3 border-b border-[#dedbd3] p-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#171717] text-sm font-bold text-white">
                  {profileImageUrl ? (
                    <img src={profileImageUrl} alt="" className="h-full w-full object-cover" />
                  ) : initials}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#171717]">{displayName}</p>
                  <p className="truncate text-xs text-[#777]">{account?.email || profile?.email || ""}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{workspaceLabel}</p>
                </div>
              </div>

              {!isDriverView && (
                <>
                  <input
                    ref={profileImageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleProfileImageChange}
                  />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={uploadingProfileImage}
                    onClick={() => profileImageInputRef.current?.click()}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-[#383838] transition hover:bg-[#f8f7f4] disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#f8f7f4] text-[#575757]">
                      <Camera className="h-4 w-4" aria-hidden="true" />
                    </span>
                    {uploadingProfileImage ? "Uploading image…" : "Update profile image"}
                  </button>
                </>
              )}

              {!isDriverView && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={openPickupSetup}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-[#383838] transition hover:bg-[#f8f7f4]"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#f8f7f4] text-[#575757]">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                  </span>
                  Pickup setup
                </button>
              )}

              {isDualRole && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleSwitch()}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-[#383838] transition hover:bg-[#f8f7f4]"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#f8f7f4] text-[#575757]">
                    <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                  Switch to {isDistributorView ? "Manufacturer" : "Distributor"}
                </button>
              )}

              {!isDriverView && !hasDistributor && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void requestDistributorAccess()}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-[#383838] transition hover:bg-[#f8f7f4]"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#f8f7f4] text-[#575757]">
                    <Building className="h-4 w-4" aria-hidden="true" />
                  </span>
                  Request distributor access
                </button>
              )}

              <button
                type="button"
                role="menuitem"
                onClick={() => void handleLogout()}
                className="flex w-full items-center gap-2 border-t border-[#dedbd3] px-4 py-3 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </span>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Navbar;
