import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Boxes,
  Award,
  ShoppingBag,
  Crown,
  MapPin,
  Wallet,
  CreditCard,
} from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";

const Sidebar = () => {
  const { stats } = useManufacturer();

  const navLinkStyle = ({ isActive }) =>
    `flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
      isActive
        ? "bg-slate-950 text-white shadow-sm font-semibold"
        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
    }`;

  return (
    <aside className="w-64 shrink-0 min-h-[calc(100vh-65px)] bg-white border-r border-slate-200/80 p-4 flex flex-col justify-between select-none">
      <div className="space-y-6">
        <div>
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Operations Portal
          </p>
          <nav className="space-y-1.5">
            <NavLink to="/" className={navLinkStyle} end>
              <div className="flex items-center gap-3">
                <LayoutDashboard className="w-4 h-4" />
                <span>Dashboard Overview</span>
              </div>
            </NavLink>

            <NavLink to="/orders" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <Package className="w-4 h-4" />
                <span>Order Assignments</span>
              </div>
              {stats.pending > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold animate-bounce">
                  {stats.pending}
                </span>
              )}
            </NavLink>

            <NavLink to="/direct-orders" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <ShoppingBag className="w-4 h-4" />
                <span>Direct Hub Orders</span>
              </div>
            </NavLink>

            <NavLink to="/inventory" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <Boxes className="w-4 h-4" />
                <span>Hub Inventory</span>
              </div>
            </NavLink>

            <NavLink to="/marketing-cards" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <CreditCard className="w-4 h-4" />
                <span>Marketing Cards</span>
              </div>
            </NavLink>

            <NavLink to="/pickup-profile" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <MapPin className="w-4 h-4" />
                <span>Pickup Setup</span>
              </div>
            </NavLink>

            <NavLink to="/finance" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <Wallet className="w-4 h-4" />
                <span>Finance Summary</span>
              </div>
            </NavLink>
          </nav>
        </div>

        <div>
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Governance &amp; Quality
          </p>
          <nav className="space-y-1.5">
            <NavLink to="/performance" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <Award className="w-4 h-4" />
                <span>Quality &amp; Contract</span>
              </div>
            </NavLink>
          </nav>
        </div>

        <div>
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Customer Care
          </p>
          <nav className="space-y-1.5">
            <NavLink to="/customer-loyalty" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <Crown className="w-4 h-4" />
                <span>Customer Loyalty</span>
              </div>
            </NavLink>
          </nav>
        </div>
      </div>

      {/* System Indicator */}
      <div className="pt-4 border-t border-slate-100">
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-100">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <div className="text-[11px] leading-tight">
            <p className="font-semibold text-slate-700">Manufacturer Hub</p>
            <p className="text-[10px] text-slate-400">Aama Distributed Network</p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
