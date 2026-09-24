import React from "react";
import { useLocation } from "react-router-dom";
import { Bell } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";

const PAGE_TITLES = {
  "/dashboard":    { title: "Dashboard",     sub: "Your marketing overview" },
  "/campaigns":    { title: "Campaigns",     sub: "Manage your card campaigns" },
  "/cards":        { title: "Cards",         sub: "Track physical card distribution" },
  "/redemptions":  { title: "Redemptions",   sub: "View benefit redemption history" },
  "/qr-validator": { title: "QR Validator",  sub: "Scan or enter card codes" },
  "/reports":      { title: "Reports",       sub: "Analytics and insights" },
  "/profile":      { title: "Profile",       sub: "Your account information" },
  "/settings":     { title: "Settings",      sub: "Account and security settings" },
};

const Header = () => {
  const location = useLocation();
  const { partner } = useAuth();

  const base = "/" + location.pathname.split("/")[1];
  const page = PAGE_TITLES[base] || { title: "Marketing Portal", sub: "" };

  const initials = (partner?.name || "MP")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-[var(--mp-line)] px-4 sm:px-6 h-16 flex items-center justify-between">
      {/* Page title — left-padded on mobile for menu button */}
      <div className="pl-12 lg:pl-0">
        <h1 className="text-lg font-bold text-[var(--mp-ink)] leading-tight">{page.title}</h1>
        {page.sub && <p className="text-xs text-[var(--mp-muted)] hidden sm:block">{page.sub}</p>}
      </div>

      {/* Right area */}
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white text-xs font-bold shadow-sm">
            {initials}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-semibold text-[var(--mp-ink)] leading-tight truncate max-w-[140px]">
              {partner?.name || "Partner"}
            </p>
            <p className="text-xs text-[var(--mp-muted)]">{partner?.code || ""}</p>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
