import React, { useEffect, useRef, useState } from "react";
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
  const { stats, availableWorkspaces, manufacturer, distributor, activeWorkspace, token, platformFeatures } = useManufacturer();
  const [applying, setApplying] = useState(false);
  const [pendingPreparationCount, setPendingPreparationCount] = useState(0);
  const previousPreparationCount = useRef(null);

  useEffect(() => {
    if (activeWorkspace !== "MANUFACTURER" || !token) {
      setPendingPreparationCount(0);
      previousPreparationCount.current = null;
      return undefined;
    }
    let isMounted = true;
    let failureShown = false;
    const refreshDemandCount = async () => {
      try {
        const response = await axios.get(`${backendUrl}/api/stock-transfers/manufacturer`, {
          headers: { token },
          params: { limit: 1 },
        });
        if (isMounted) {
          const count = Number(response.data.pendingPreparationCount || 0);
          if (previousPreparationCount.current !== null && count > previousPreparationCount.current) {
            toast.info("A new distributor demand was approved. Open Distributor Demands to inspect and prepare it.");
          }
          previousPreparationCount.current = count;
          setPendingPreparationCount(count);
          failureShown = false;
        }
      } catch (error) {
        if (isMounted && !failureShown) {
          toast.error(error.response?.data?.message || "Could not refresh approved distributor demands.");
          failureShown = true;
        }
      }
    };
    refreshDemandCount();
    const interval = window.setInterval(refreshDemandCount, 60000);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [activeWorkspace, token]);

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
    `flex w-max shrink-0 items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-medium transition-all lg:w-full lg:shrink ${
      isActive
        ? "bg-[#171717] text-white shadow-xs font-semibold"
        : "text-[#575757] hover:text-[#171717] hover:bg-[#f8f7f4]"
    }`;

  const activeProfile = activeWorkspace === "DISTRIBUTOR" ? distributor : manufacturer;

  // ── DISTRIBUTOR VIEW ─────────────────────────────────────────
  if (activeWorkspace === "DISTRIBUTOR") {
    return (
      <aside className="flex w-full shrink-0 flex-col justify-between border-b border-[#dedbd3] bg-white p-2 select-none lg:min-h-[calc(100vh-65px)] lg:w-64 lg:border-b-0 lg:border-r lg:p-4">
        <div className="min-w-0 lg:max-h-[calc(100vh-140px)] lg:space-y-6 lg:overflow-y-auto lg:pr-1">
          <div>
            <div className="mb-1 hidden items-center justify-between px-3 lg:flex">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#171717]">
                Distributor Hub
              </p>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                ACTIVE
              </span>
            </div>
            <nav aria-label="Distributor navigation" className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 lg:block lg:space-y-1 lg:overflow-visible">
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

              <NavLink to="/ncm" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <Truck className="w-4 h-4 text-sky-600" />
                  <span>NCM Deliveries</span>
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

              {platformFeatures?.marketingCardsEnabled && <NavLink to="/marketing-cards" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  <span>Marketing Cards</span>
                </div>
              </NavLink>}

              {platformFeatures?.loyaltyEnabled && <NavLink to="/customer-loyalty" className={navLinkStyle}>
                <div className="flex items-center gap-3">
                  <Crown className="w-4 h-4" />
                  <span>Customer Loyalty</span>
                </div>
              </NavLink>}

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
        <div className="hidden border-t border-[#dedbd3] pt-3 lg:block">
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
    <aside className="flex w-full shrink-0 flex-col justify-between border-b border-[#dedbd3] bg-white p-2 select-none lg:min-h-[calc(100vh-65px)] lg:w-64 lg:border-b-0 lg:border-r lg:p-4">
      <div className="min-w-0 lg:max-h-[calc(100vh-140px)] lg:space-y-6 lg:overflow-y-auto lg:pr-1">
        <div>
          <p className="mb-2 hidden px-3 text-[10px] font-bold uppercase tracking-wider text-[#575757] lg:block">
            Manufacturer Portal (Factory)
          </p>
          <nav aria-label="Manufacturer navigation" className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 lg:block lg:space-y-1 lg:overflow-visible">
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
                <span>Distributor Demands</span>
              </div>
              {pendingPreparationCount > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                  {pendingPreparationCount}
                </span>
              )}
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
          <div className="hidden space-y-2.5 rounded-2xl border border-[#dedbd3] bg-[#f8f7f4] p-3.5 lg:block">
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
      <div className="hidden border-t border-[#dedbd3] pt-3 lg:block">
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
