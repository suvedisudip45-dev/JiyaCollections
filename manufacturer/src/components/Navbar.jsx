import React from "react";
import { useManufacturer } from "../context/ManufacturerContext";
import { LogOut, Power, MapPin, Building2, Star, ShieldCheck } from "lucide-react";

const Navbar = () => {
  const { manufacturer, toggleAvailability, logout } = useManufacturer();

  if (!manufacturer) return null;

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 py-3 flex items-center justify-between shadow-xs">
      {/* Left: Brand / Hub Identity */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-slate-950 flex items-center justify-center text-white font-black text-lg shadow-sm">
          A
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">
              {manufacturer.businessName}
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-semibold border border-emerald-200">
              <ShieldCheck className="w-3 h-3" />
              Verified Hub
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3 text-emerald-600" />
              {manufacturer.city}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-amber-600 font-medium">
              <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
              {manufacturer.qualityRating?.toFixed(1) || "5.0"} Quality
            </span>
          </div>
        </div>
      </div>

      {/* Right: Availability Toggle + User Actions */}
      <div className="flex items-center gap-3">
        {/* Availability Toggle */}
        <button
          onClick={toggleAvailability}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
            manufacturer.isAvailable
              ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
              : "bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200"
          }`}
          title="Toggle receiving new auto-assigned orders"
        >
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              manufacturer.isAvailable ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
            }`}
          />
          <span className="hidden md:inline">
            {manufacturer.isAvailable ? "Accepting Orders (Online)" : "Paused (Offline)"}
          </span>
          <span className="md:hidden">
            {manufacturer.isAvailable ? "Online" : "Offline"}
          </span>
        </button>

        {/* Logout */}
        <button
          onClick={logout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50 transition-colors border border-transparent hover:border-rose-100"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
};

export default Navbar;
