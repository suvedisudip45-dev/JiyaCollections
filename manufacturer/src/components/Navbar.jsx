import React from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useManufacturer, backendUrl } from "../context/ManufacturerContext";
import { LogOut, MapPin, Star, ShieldCheck, ArrowLeftRight, Building, Wifi, WifiOff } from "lucide-react";

const Navbar = () => {
  const {
    token,
    manufacturer,
    distributor,
    activeProfile,
    toggleDistributorAvailability,
    logout,
    activeWorkspace,
    availableWorkspaces,
    switchWorkspace,
  } = useManufacturer();

  const navigate = useNavigate();

  if (!activeProfile && !manufacturer && !distributor) return null;

  const profile = activeProfile || manufacturer || distributor;

  const hasDistributor =
    availableWorkspaces?.some((w) => (typeof w === "string" ? w : w.code) === "DISTRIBUTOR") ||
    activeWorkspace === "DISTRIBUTOR";

  const hasManufacturer =
    availableWorkspaces?.some((w) => (typeof w === "string" ? w : w.code) === "MANUFACTURER") ||
    activeWorkspace === "MANUFACTURER";

  const isDualRole = hasDistributor && hasManufacturer;

  const handleSwitch = async () => {
    await switchWorkspace();
    // Navigate to the correct home for the new workspace
    const targetRole = activeWorkspace === "MANUFACTURER" ? "DISTRIBUTOR" : "MANUFACTURER";
    navigate(targetRole === "DISTRIBUTOR" ? "/distributor" : "/");
  };

  const isDistributorView = activeWorkspace === "DISTRIBUTOR";
  const isOnline = distributor?.isActive;

  return (
    <header className="sticky top-0 z-40 bg-[#ffffff]/95 backdrop-blur-md border-b border-[#dedbd3] px-4 sm:px-6 py-3 flex items-center justify-between shadow-xs">
      {/* Left: Brand / Hub Identity */}
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-xs ${
          isDistributorView ? "bg-emerald-700" : "bg-[#171717]"
        }`}>
          {isDistributorView ? "D" : "M"}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm sm:text-base font-bold text-[#171717] leading-tight">
              {profile?.businessName || profile?.name}
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#f8f7f4] text-[#171717] text-[11px] font-semibold border border-[#dedbd3]">
              <ShieldCheck className="w-3 h-3 text-emerald-600" />
              {isDistributorView ? "Distributor Hub" : "Verified Partner"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#575757]">
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3 text-emerald-600" />
              {profile?.city || "Nepal"}
            </span>
            {!isDistributorView && manufacturer?.qualityRating && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1 text-amber-600 font-medium">
                  <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                  {manufacturer.qualityRating.toFixed(1)} Quality
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 sm:gap-3">

        {/* Distributor Online/Offline Toggle — only in distributor view */}
        {isDistributorView && (
          <button
            onClick={toggleDistributorAvailability}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
              isOnline
                ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                : "bg-[#f8f7f4] text-[#575757] border-[#dedbd3] hover:bg-[#dedbd3]/50"
            }`}
            title="Toggle hub availability for accepting orders"
          >
            {isOnline
              ? <Wifi className="w-3.5 h-3.5" />
              : <WifiOff className="w-3.5 h-3.5" />
            }
            <span className="hidden md:inline">{isOnline ? "Accepting Orders (Online)" : "Paused (Offline)"}</span>
            <span className="md:hidden">{isOnline ? "Online" : "Offline"}</span>
          </button>
        )}

        {/* Dual-Role Workspace Switcher */}
        {isDualRole ? (
          <button
            type="button"
            onClick={handleSwitch}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-[#171717] bg-[#f8f7f4] hover:bg-[#dedbd3]/60 border border-[#dedbd3] transition-colors shadow-xs"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-[#575757]" />
            <span className="hidden sm:inline">
              {isDistributorView ? "→ Manufacturer View" : "→ Distributor View"}
            </span>
            <span className="sm:hidden">Switch</span>
          </button>
        ) : (
          !hasDistributor && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await axios.post(
                    `${backendUrl}/api/manufacturer/distributor-access-request`,
                    {},
                    { headers: { token } }
                  );
                  toast.success(res.data.message || "Application submitted for admin approval.");
                } catch (err) {
                  toast.error(err.response?.data?.message || "Request could not be submitted.");
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-[#171717] bg-[#f8f7f4] hover:bg-[#dedbd3]/60 border border-[#dedbd3] transition-colors shadow-xs"
            >
              <Building className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Apply for Distributor Authorization</span>
              <span className="sm:hidden">Distributor Access</span>
            </button>
          )
        )}

        {/* Logout */}
        <button
          onClick={logout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#575757] hover:text-rose-600 hover:bg-rose-50 transition-colors border border-transparent hover:border-rose-100"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
};

export default Navbar;
