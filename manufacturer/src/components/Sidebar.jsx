import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  LayoutDashboard,
  Package,
  Boxes,
  Factory,
  Award,
  ShoppingBag,
  Crown,
  MapPin,
  Wallet,
  CreditCard,
  Gift,
  Truck,
  Building,
} from "lucide-react";
import { useManufacturer, backendUrl } from "../context/ManufacturerContext";

const Sidebar = () => {
  const { stats, availableWorkspaces, manufacturer, distributor, activeWorkspace, token } = useManufacturer();
  const [applying, setApplying] = useState(false);

  const hasDistributorRole =
    availableWorkspaces?.some((w) => (typeof w === "string" ? w : w.code) === "DISTRIBUTOR") ||
    activeWorkspace === "DISTRIBUTOR";

  const hasManufacturerRole =
    availableWorkspaces?.some((w) => (typeof w === "string" ? w : w.code) === "MANUFACTURER") ||
    activeWorkspace === "MANUFACTURER" ||
    (!availableWorkspaces?.length && activeWorkspace !== "DISTRIBUTOR");

  const handleApplyDistributor = async () => {
    setApplying(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/manufacturer/distributor-access-request`,
        {},
        { headers: { token } }
      );
      toast.success(response.data.message || "Distributor application submitted for Admin approval!");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to submit distributor application.");
    } finally {
      setApplying(false);
    }
  };

  const navLinkStyle = ({ isActive }) =>
    `flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
      isActive
        ? "bg-[#171717] text-white shadow-xs font-semibold"
        : "text-[#575757] hover:text-[#171717] hover:bg-[#f8f7f4]"
    }`;

  const activeProfile = activeWorkspace === "DISTRIBUTOR" ? distributor : manufacturer;

  // ── DISTRIBUTOR VIEW ─────────────────────────────────────────
  if (activeWorkspace === "DISTRIBUTOR") {
    return (
      <aside className="w-64 shrink-0 min-h-[calc(100vh-65px)] bg-[#ffffff] border-r border-[#dedbd3] p-4 flex flex-col justify-between select-none">
        <div className="space-y-6 overflow-y-auto max-h-[calc(100vh-140px)] pr-1">
          <div>
            <div className="flex items-center justify-between px-3 mb-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#171717]">
                Distributor Hub
              </p>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                ACTIVE
              </span>
            </div>
            <nav className="space-y-1">
              <NavLink to="/distributor" className={navLinkStyle} end>
                <div className="flex items-center gap-3">
                  <Building className="w-4 h-4 text-emerald-600" />
                  <span>Distributor Overview</span>
                </div>
              </NavLink>

              <NavLink to="/orders" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <Package className="w-4 h-4 text-emerald-600" />
                  <span>Order Assignments</span>
                </div>
                {stats.pending > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                    {stats.pending}
                  </span>
                )}
              </NavLink>

              <NavLink to="/direct-orders" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <ShoppingBag className="w-4 h-4 text-emerald-600" />
                  <span>Direct Hub Orders</span>
                </div>
              </NavLink>

              <NavLink to="/inventory" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <Boxes className="w-4 h-4 text-emerald-600" />
                  <span>Hub Inventory</span>
                </div>
              </NavLink>

              <NavLink to="/distributor/deliveries" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <Truck className="w-4 h-4 text-emerald-600" />
                  <span>Self-Delivery Orders</span>
                </div>
              </NavLink>

              <NavLink to="/distributor/demand" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <Boxes className="w-4 h-4 text-emerald-600" />
                  <span>Demand &amp; Receipts</span>
                </div>
              </NavLink>

              <NavLink to="/distributor/finance" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <Wallet className="w-4 h-4 text-emerald-600" />
                  <span>Distributor Finance</span>
                </div>
              </NavLink>

              <NavLink to="/pickup-profile" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                  <span>Pickup Setup</span>
                </div>
              </NavLink>

              <NavLink to="/marketing-cards" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  <span>Marketing Cards</span>
                </div>
              </NavLink>

              <NavLink to="/customer-loyalty" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <Crown className="w-4 h-4" />
                  <span>Customer Loyalty</span>
                </div>
              </NavLink>

              <NavLink to="/gift-inventory" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <Gift className="w-4 h-4" />
                  <span>Gift Stock</span>
                </div>
              </NavLink>
            </nav>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-[#dedbd3]">
          <div className="flex items-center gap-2 px-3 py-2 bg-[#f8f7f4] rounded-xl border border-[#dedbd3]">
            <span className={`w-2 h-2 rounded-full ${distributor?.isActive ? "bg-emerald-600 animate-pulse" : "bg-slate-400"}`} />
            <div className="text-[11px] leading-tight min-w-0">
              <p className="font-semibold text-[#171717] truncate">
                {activeProfile?.businessName || activeProfile?.name || "Distributor Hub"}
              </p>
              <p className="text-[10px] text-[#575757] truncate">
                {distributor?.isActive ? "Accepting Orders" : "Paused"}
              </p>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  // ── MANUFACTURER VIEW ────────────────────────────────────────
  return (
    <aside className="w-64 shrink-0 min-h-[calc(100vh-65px)] bg-[#ffffff] border-r border-[#dedbd3] p-4 flex flex-col justify-between select-none">
      <div className="space-y-6 overflow-y-auto max-h-[calc(100vh-140px)] pr-1">
        <div>
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#575757] mb-2">
            Manufacturer Portal (Factory)
          </p>
          <nav className="space-y-1">
            <NavLink to="/" className={navLinkStyle} end>
              <div className="flex items-center gap-3">
                <LayoutDashboard className="w-4 h-4" />
                <span>Factory Dashboard</span>
              </div>
            </NavLink>

            <NavLink to="/production" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <Factory className="w-4 h-4" />
                <span>Production Requests</span>
              </div>
            </NavLink>

            <NavLink to="/bulk-transfers" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <Truck className="w-4 h-4" />
                <span>Factory Dispatch</span>
              </div>
            </NavLink>

            <NavLink to="/pickup-profile" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <MapPin className="w-4 h-4" />
                <span>Pickup Setup</span>
              </div>
            </NavLink>

            <NavLink to="/performance" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <Award className="w-4 h-4" />
                <span>Quality &amp; Contract</span>
              </div>
            </NavLink>

            <NavLink to="/finance" className={navLinkStyle}>
              <div className="flex items-center gap-3">
                <Wallet className="w-4 h-4" />
                <span>Factory Finance</span>
              </div>
            </NavLink>
          </nav>
        </div>

        {/* Distributor application banner (only for pure manufacturers) */}
        {!hasDistributorRole && (
          <div className="p-3.5 bg-[#f8f7f4] border border-[#dedbd3] rounded-2xl space-y-2.5">
            <div className="flex items-center gap-2 text-[#171717]">
              <Building className="w-4 h-4" />
              <p className="text-xs font-bold">Become a Distributor</p>
            </div>
            <p className="text-[11px] text-[#575757] leading-relaxed">
              Unlock local hub order assignments, direct sales, self-delivery rates &amp; earnings.
            </p>
            <button
              onClick={handleApplyDistributor}
              disabled={applying}
              className="w-full py-1.5 text-xs font-bold text-white bg-[#171717] hover:bg-[#262626] rounded-xl transition-colors disabled:opacity-50"
            >
              {applying ? "Applying..." : "Apply for Authorization"}
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="pt-3 border-t border-[#dedbd3]">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#f8f7f4] rounded-xl border border-[#dedbd3]">
          <span className={`w-2 h-2 rounded-full ${manufacturer?.isAvailable ? "bg-emerald-600 animate-pulse" : "bg-slate-400"}`} />
          <div className="text-[11px] leading-tight min-w-0">
            <p className="font-semibold text-[#171717] truncate">
              {activeProfile?.businessName || activeProfile?.name || "Manufacturing Unit"}
            </p>
            <p className="text-[10px] text-[#575757] truncate">
              {hasDistributorRole ? "Factory + Hub (Dual Role)" : "Manufacturing Unit"}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
