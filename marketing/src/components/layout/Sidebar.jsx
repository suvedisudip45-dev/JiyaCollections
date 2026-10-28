import React, { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Megaphone, CreditCard, RefreshCcw,
  QrCode, BarChart3, User, Settings, LogOut, ChevronDown,
  Menu, X, BadgeCheck,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";

const NAV = [
  { to: "/dashboard",   label: "Dashboard",    icon: LayoutDashboard },
  { to: "/campaigns",   label: "Campaigns",    icon: Megaphone },
  { to: "/cards",       label: "Cards",        icon: CreditCard },
  { to: "/redemptions", label: "Redemptions",  icon: RefreshCcw },
  { to: "/qr-validator",label: "QR Validator", icon: QrCode },
  { to: "/reports",     label: "Reports",      icon: BarChart3 },
];

const ACCOUNT_NAV = [
  { to: "/profile",     label: "Profile",      icon: User },
  { to: "/settings",    label: "Settings",     icon: Settings },
];

const NavItem = ({ to, label, icon: Icon, mobile, onClick }) => (
  <NavLink
    to={to}
    onClick={onClick}
    className={({ isActive }) =>
      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
      ${isActive
        ? "bg-brand-600 text-white shadow-sm"
        : "text-[var(--mp-ink-2)] hover:bg-[var(--mp-brand-light)] hover:text-brand-700"
      }
      ${mobile ? "text-base py-3" : ""}`
    }
  >
    <Icon size={mobile ? 20 : 17} strokeWidth={1.8} />
    {label}
  </NavLink>
);

const SidebarContent = ({ onNavClick }) => {
  const { partner, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 pt-5 pb-4 border-b border-[var(--mp-line)]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-sm">
            <BadgeCheck size={18} className="text-white" strokeWidth={2} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-brand-600">Marketing</p>
            <p className="text-[10px] text-[var(--mp-muted)] -mt-0.5">Aama Clothings</p>
          </div>
        </div>
      </div>

      {/* Partner badge */}
      {partner && (
        <div className="mx-3 mt-3 px-3 py-2.5 rounded-xl bg-[var(--mp-brand-light)] border border-brand-100">
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-500 mb-0.5">Partner</p>
          <p className="text-sm font-bold text-brand-800 truncate">{partner.name}</p>
          <p className="text-xs text-brand-600 truncate">{partner.code}</p>
        </div>
      )}

      {/* Main nav */}
      <nav className="flex-1 px-3 mt-4 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => (
          <NavItem key={item.to} {...item} onClick={onNavClick} />
        ))}

        <div className="pt-4 pb-1">
          <p className="px-3 text-[10px] font-bold uppercase tracking-widest text-[var(--mp-muted)]">Account</p>
        </div>
        {ACCOUNT_NAV.map((item) => (
          <NavItem key={item.to} {...item} onClick={onNavClick} />
        ))}
      </nav>

      {/* Logout */}
      <div className="px-3 pb-5 border-t border-[var(--mp-line)] pt-3">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
        >
          <LogOut size={17} strokeWidth={1.8} />
          Logout
        </button>
      </div>
    </div>
  );
};

const Sidebar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col bg-white border-r border-[var(--mp-line)] fixed left-0 top-0 bottom-0"
        style={{ width: "var(--sidebar-w)" }}
      >
        <SidebarContent />
      </aside>

      {/* Mobile toggle button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 w-10 h-10 rounded-xl bg-white shadow-lg border border-[var(--mp-line)] flex items-center justify-center text-[var(--mp-ink)]"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="lg:hidden fixed left-0 top-0 bottom-0 z-50 w-72 bg-white border-r border-[var(--mp-line)] shadow-2xl"
            style={{ animation: "slideInLeft 0.2s ease-out" }}
          >
            <div className="absolute right-3 top-3">
              <button
                onClick={() => setMobileOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 text-[var(--mp-muted)]"
                aria-label="Close menu"
              >
                <X size={16} />
              </button>
            </div>
            <SidebarContent onNavClick={() => setMobileOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
};

export default Sidebar;
