/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { CalendarDays, Camera, Command, LogOut, Menu, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { assets } from "../assets/assets";
import { usePermissions } from "../auth/PermissionsContext";
import { revokeAuthSession } from "../auth/tokenStorage";
import NotificationBell from "./NotificationBell";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
const profileImageMaxSize = 10 * 1024 * 1024;
const allowedProfileImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const QUICK_LINKS = [
  { label: "Customer orders", description: "Order management", path: "/orders", keywords: "sales orders", permissions: ["order:list_admin"] },
  { label: "Customer profiles", description: "Customer and loyalty records", path: "/customers", keywords: "customer crm", permissions: ["customer:admin_list"] },
  { label: "Product catalog", description: "Search and manage products", path: "/list", keywords: "products sku catalog", permissions: ["product:list_admin", "product:create", "product:update", "product:delete"] },
  { label: "Delivery monitor", description: "Shipment tracking and COD settlements", path: "/delivery-monitor", keywords: "delivery courier ncm consignment", permissions: ["delivery:admin_list", "delivery:settlements_read", "delivery:logs_read", "delivery:ncm_handoff_recover"] },
  { label: "Inventory", description: "Product stock overview", path: "/inventory", keywords: "inventory stock", permissions: ["inventory:admin_read_all"] },
  { label: "Finance dashboard", description: "Business finance overview", path: "/finance", keywords: "finance dashboard", permissions: ["finance:dashboard_read"] },
];

const Navbar = ({ token, setToken, onProfileImageUpdated, onToggleSidebar }) => {
  const navigate = useNavigate();
  const { account, canAny } = usePermissions();
  const [quickNavOpen, setQuickNavOpen] = useState(false);
  const [quickNavQuery, setQuickNavQuery] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [uploadingProfileImage, setUploadingProfileImage] = useState(false);
  const quickNavInput = useRef(null);
  const profileMenuRef = useRef(null);
  const profileImageInputRef = useRef(null);
  const todayFormatted = new Intl.DateTimeFormat("en-NZ", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kathmandu",
  }).format(new Date());

  const availableLinks = useMemo(
    () => QUICK_LINKS.filter((link) => canAny(link.permissions)),
    [canAny],
  );
  const filteredLinks = availableLinks.filter((link) =>
    `${link.label} ${link.description} ${link.keywords}`
      .toLowerCase()
      .includes(quickNavQuery.trim().toLowerCase()),
  );
  const profile = account?.profile || {};
  const displayName = profile.displayName ||
    [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
    account?.email ||
    "Administrator";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "A";
  const profileImageUrl = account?.profileImageUrl || "";

  useEffect(() => {
    if (quickNavOpen) quickNavInput.current?.focus();
  }, [quickNavOpen]);

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

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuickNavOpen((open) => !open);
      }
      if (event.key === "Escape") setQuickNavOpen(false);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const openPage = (path) => {
    setQuickNavOpen(false);
    setQuickNavQuery("");
    navigate(path);
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
      onProfileImageUpdated?.(response.data.profileImageUrl);
      toast.success("Profile image updated.");
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Profile image could not be updated.");
    } finally {
      setUploadingProfileImage(false);
    }
  };

  const handleLogout = async () => {
    try {
      await revokeAuthSession(backendUrl);
    } catch (error) {
      toast.error(error.response?.data?.message || "Server logout failed; this device has been logged out.");
    }
    setToken("");
  };

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border-light bg-white/95 px-4 py-3 shadow-subtle backdrop-blur sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Toggle navigation menu"
            className="rounded-lg border border-border-light p-2 text-ink-secondary hover:bg-surface-subtle sm:hidden"
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </button>
          <img className="h-8 w-36 object-contain" src={assets.logo} alt="Aashrit Corner" />
          <div className="hidden border-l border-border-light pl-3 sm:block">
            <h1 className="text-sm font-bold leading-none tracking-tight text-ink-primary">
              Aashrit Corner
            </h1>
            <p className="mt-1 text-[11px] font-medium text-ink-muted">
              Admin Management Console
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setQuickNavOpen(true)}
            aria-label="Jump to an admin page"
            className="inline-flex items-center gap-2 rounded-lg border border-border-light bg-surface-base px-2.5 py-2 text-xs font-medium text-ink-muted transition hover:border-border-brand hover:bg-surface-tint hover:text-brand-700 sm:px-3"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Jump to a page</span>
            <kbd className="hidden rounded border border-border-light bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted lg:inline-flex">
              <Command className="mr-1 h-3 w-3" aria-hidden="true" /> K
            </kbd>
          </button>

          <div className="hidden items-center gap-1.5 rounded-lg border border-border-light bg-surface-base px-3 py-2 text-xs font-medium text-ink-secondary md:flex">
            <CalendarDays className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
            <span>{todayFormatted} NPT</span>
          </div>

          <NotificationBell />
          <div ref={profileMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setProfileMenuOpen((open) => !open)}
              aria-label="Open account profile menu"
              aria-haspopup="menu"
              aria-expanded={profileMenuOpen}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-light bg-white text-sm font-bold text-brand-800 shadow-subtle transition hover:border-brand-300 hover:bg-surface-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {profileImageUrl ? (
                <img src={profileImageUrl} alt="" className="h-full w-full rounded-full object-cover" />
              ) : (
                initials
              )}
            </button>

            {profileMenuOpen && (
              <div
                role="menu"
                aria-label="Account profile"
                className="absolute right-0 top-full z-[70] mt-2 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-border-light bg-white shadow-elevated"
              >
                <div className="flex items-center gap-3 border-b border-border-light p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-900 text-sm font-bold text-white">
                    {profileImageUrl ? (
                      <img src={profileImageUrl} alt="" className="h-full w-full object-cover" />
                    ) : initials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-primary">{displayName}</p>
                    <p className="truncate text-xs text-ink-muted">{account?.email || "Admin account"}</p>
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-brand-700">Administrator</p>
                  </div>
                </div>
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
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-ink-secondary transition hover:bg-surface-base disabled:cursor-wait disabled:opacity-60"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-surface-base text-ink-muted">
                    <Camera className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {uploadingProfileImage ? "Uploading image…" : "Update profile image"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleLogout()}
                  className="flex w-full items-center gap-2 border-t border-border-light px-4 py-3 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                >
                  <LogOut className="ml-1 h-4 w-4" aria-hidden="true" />
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {quickNavOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-950/40 px-4 pt-[12vh] backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setQuickNavOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-nav-title"
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-border-light bg-white shadow-elevated"
          >
            <div className="flex items-center gap-3 border-b border-border-light px-4">
              <Search className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
              <label id="quick-nav-title" className="sr-only">Jump to an admin page</label>
              <input
                ref={quickNavInput}
                value={quickNavQuery}
                onChange={(event) => setQuickNavQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && filteredLinks[0]) openPage(filteredLinks[0].path);
                }}
                placeholder="Search pages, orders, customers, products..."
                className="h-14 min-w-0 flex-1 border-0 bg-transparent text-sm text-ink-primary outline-none ring-0 placeholder:text-ink-subtle focus:border-0 focus:outline-none focus:ring-0"
              />
              <button
                type="button"
                onClick={() => setQuickNavOpen(false)}
                aria-label="Close quick navigation"
                className="rounded-md p-1.5 text-ink-subtle hover:bg-surface-subtle hover:text-ink-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[min(55vh,24rem)] overflow-y-auto p-2">
              {filteredLinks.length ? filteredLinks.map((link) => (
                <button
                  type="button"
                  key={link.path}
                  onClick={() => openPage(link.path)}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition hover:bg-surface-tint focus:bg-surface-tint"
                >
                  <span>
                    <span className="block text-sm font-semibold text-ink-primary">{link.label}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">{link.description}</span>
                  </span>
                  <span className="font-mono text-[10px] text-ink-subtle">{link.path}</span>
                </button>
              )) : (
                <p className="px-3 py-8 text-center text-sm text-ink-muted">No matching pages.</p>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border-light bg-surface-base px-4 py-2 text-[10px] text-ink-muted">
              <span>Navigation only — use each page’s filters to search its records.</span>
              <span>ESC to close</span>
            </div>
          </section>
        </div>
      )}
    </>
  );
};

export default Navbar;
