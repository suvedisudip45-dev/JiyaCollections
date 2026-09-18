/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React from "react";
import { assets } from "../assets/assets";

const Navbar = ({ setToken }) => {
  const todayFormatted = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#dfe7e3] px-4 sm:px-8 py-3 flex items-center justify-between shadow-[0_1px_12px_rgba(23,35,33,0.04)]">
      {/* Brand & Title */}
      <div className="flex items-center gap-3">
        <img className="h-9 w-auto object-contain" src={assets.logo} alt="Aama Clothings" />
        <div className="hidden sm:block border-l border-slate-200 pl-3">
          <h1 className="text-sm font-bold text-slate-900 tracking-tight leading-none">
            Aama Clothings
          </h1>
          <p className="text-[11px] text-slate-500 font-medium mt-0.5">
            Admin Management Console
          </p>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-4">
        {/* Date Display */}
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1 bg-slate-50 border border-slate-200/80 rounded-lg text-xs text-slate-600 font-medium">
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>{todayFormatted}</span>
        </div>

        {/* Admin Account & Logout */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#172321] text-white flex items-center justify-center text-xs font-bold shadow-xs">
              AD
            </div>
            <div className="text-left text-xs leading-none">
              <span className="font-semibold text-slate-800 block">Administrator</span>
              <span className="text-[10px] text-[#147d6d] font-medium">Authenticated</span>
            </div>
          </div>

          <button
            onClick={() => setToken("")}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 border border-slate-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
