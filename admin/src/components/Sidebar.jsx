/* eslint-disable no-unused-vars */
import React, { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

// ─── Icons ───────────────────────────────────────────────────────────────────
const ChevronIcon = ({ open }) => (
  <svg
    className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    fill="none" stroke="currentColor" viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
  </svg>
);

// ─── NavItem ─────────────────────────────────────────────────────────────────
const NavItem = ({ to, icon, label, indent = false }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] font-medium transition-all duration-150 group ${
        indent ? "ml-3 pl-3" : ""
      } ${
        isActive
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/80"
      }`
    }
  >
    {({ isActive }) => (
      <>
        <span className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-white" : "text-slate-400 group-hover:text-slate-700"}`}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </>
    )}
  </NavLink>
);

// ─── SectionGroup (collapsible dropdown) ─────────────────────────────────────
const SectionGroup = ({ label, icon, children, defaultOpen = false, routes = [] }) => {
  const location = useLocation();
  // Auto-open if any child route is active
  const isAnyChildActive = routes.some((r) => location.pathname === r);
  const [open, setOpen] = useState(defaultOpen || isAnyChildActive);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11.5px] font-semibold uppercase tracking-wide transition-all duration-150 group ${
          open ? "text-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100/60"
        }`}
      >
        <span className={`w-4 h-4 flex-shrink-0 ${open ? "text-slate-700" : "text-slate-400 group-hover:text-slate-600"}`}>
          {icon}
        </span>
        <span className="flex-1 text-left">{label}</span>
        <ChevronIcon open={open} />
      </button>

      <div
        style={{
          maxHeight: open ? "600px" : "0px",
          overflow: "hidden",
          transition: "max-height 0.25s ease",
        }}
      >
        <nav className="mt-1 ml-2 pl-3 border-l border-slate-100 space-y-0.5 pb-1">
          {children}
        </nav>
      </div>
    </div>
  );
};

// ─── SVG icon helpers ─────────────────────────────────────────────────────────
const Icon = {
  products:    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>,
  add:         <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 4v16m8-8H4"/></svg>,
  categories:  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>,
  offers:      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"/></svg>,
  orders:      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>,
  createOrder: <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>,
  routing:     <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>,
  factory:     <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>,
  box:         <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>,
  inventory:   <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>,
  cogs:        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>,
  shipping:    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1"/></svg>,
  money:       <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>,
  bank:        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>,
  asset:       <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>,
  partners:    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>,
  expense:     <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>,
  tax:         <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>,
  returns:     <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z"/></svg>,
  payables:    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>,
  statements:  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>,
  chartAcct:   <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>,
  journal:     <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>,
  ledger:      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>,
  balance:     <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"/></svg>,
  customers:   <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>,
  loyalty:     <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>,
  reviews:     <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>,
  letter:      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v13a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 18.5v-13zm3 3h10M7 11h10M7 15h7"/></svg>,
  lock:        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>,
  // Section header icons
  catalog:     <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>,
  sales:       <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>,
  supply:      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>,
  ops:         <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>,
  finance:     <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>,
  gl:          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>,
  crm:         <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>,
  marketing:   <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h8m2 0h4v4m-9 5h6m-6 4h4M14 3l7 7"/></svg>,
};

// ─── Main Sidebar ─────────────────────────────────────────────────────────────
const Sidebar = () => {
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200/80 flex flex-col select-none" style={{ height: "calc(100vh - 65px)", position: "sticky", top: "65px" }}>

      {/* Scrollable nav area */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-1" style={{ scrollbarWidth: "thin", scrollbarColor: "#dfe7e3 transparent" }}>

        {/* ── CATALOG & PRODUCTS ── */}
        <SectionGroup
          label="Catalog & Products"
          icon={Icon.catalog}
          defaultOpen={true}
          routes={["/list", "/add", "/categories", "/special-offers"]}
        >
          <NavItem to="/list"          icon={Icon.products}   label="All Products" />
          <NavItem to="/add"           icon={Icon.add}        label="Add Product" />
          <NavItem to="/categories"    icon={Icon.categories} label="Categories & Types" />
          <NavItem to="/special-offers" icon={Icon.offers}   label="Festive Campaigns" />
        </SectionGroup>

        <div className="h-px bg-slate-100 my-1" />

        {/* ── SALES & ORDERS ── */}
        <SectionGroup
          label="Sales & Orders"
          icon={Icon.sales}
          routes={["/orders", "/create-order"]}
        >
          <NavItem to="/orders"        icon={Icon.orders}      label="Customer Orders" />
          <NavItem to="/create-order"  icon={Icon.createOrder} label="Create Direct Order" />
        </SectionGroup>

        <div className="h-px bg-slate-100 my-1" />

        {/* ── SUPPLY CHAIN ── */}
        <SectionGroup
          label="Supply Chain"
          icon={Icon.supply}
          routes={["/order-assignments", "/delivery-monitor", "/manufacturers", "/manufacturer-inventory"]}
        >
          <NavItem to="/order-assignments"     icon={Icon.routing}   label="Order Routing Engine" />
          <NavItem to="/delivery-monitor"      icon={Icon.shipping}  label="Delivery & COD Monitor" />
          <NavItem to="/manufacturers"         icon={Icon.factory}   label="Manufacturers" />
          <NavItem to="/manufacturer-inventory" icon={Icon.box}      label="Multi-Hub Stock" />
        </SectionGroup>

        <div className="h-px bg-slate-100 my-1" />

        <SectionGroup
          label="Marketing Partners"
          icon={Icon.marketing}
          routes={["/marketing-cards"]}
        >
          <NavItem to="/marketing-cards" icon={Icon.marketing} label="Card Assignment" />
        </SectionGroup>

        <div className="h-px bg-slate-100 my-1" />

        {/* ── OPERATIONS ── */}
        <SectionGroup
          label="Operations"
          icon={Icon.ops}
          routes={["/inventory", "/cogs", "/shipping"]}
        >
          <NavItem to="/inventory" icon={Icon.inventory} label="Inventory & Stock" />
          <NavItem to="/cogs"      icon={Icon.cogs}      label="COGS & Margins" />
          <NavItem to="/shipping"  icon={Icon.shipping}  label="Shipping Rates" />
        </SectionGroup>

        <div className="h-px bg-slate-100 my-1" />

        {/* ── FINANCE ── */}
        <SectionGroup
          label="Finance"
          icon={Icon.finance}
          routes={["/finance", "/treasury", "/assets", "/partners", "/expenses", "/tax", "/returns", "/payables", "/statements"]}
        >
          <NavItem to="/finance"     icon={Icon.money}      label="Financial Dashboard" />
          <NavItem to="/treasury"    icon={Icon.bank}       label="Cash & Banks" />
          <NavItem to="/assets"      icon={Icon.asset}      label="Assets & Depreciation" />
          <NavItem to="/partners"    icon={Icon.partners}   label="Partners & Investors" />
          <NavItem to="/expenses"    icon={Icon.expense}    label="Expenses & Overhead" />
          <NavItem to="/tax"         icon={Icon.tax}        label="13% VAT & Tax" />
          <NavItem to="/returns"     icon={Icon.returns}    label="Returns & Debit Notes" />
          <NavItem to="/payables"    icon={Icon.payables}   label="Payables & Receivables" />
          <NavItem to="/statements"  icon={Icon.statements} label="Financial Statements" />
        </SectionGroup>

        <div className="h-px bg-slate-100 my-1" />

        {/* ── GENERAL LEDGER ── */}
        <SectionGroup
          label="General Ledger"
          icon={Icon.gl}
          routes={["/chart-of-accounts", "/journal-entries", "/general-ledger", "/trial-balance"]}
        >
          <NavItem to="/chart-of-accounts" icon={Icon.chartAcct} label="Chart of Accounts" />
          <NavItem to="/journal-entries"   icon={Icon.journal}   label="Journal Entries" />
          <NavItem to="/general-ledger"    icon={Icon.ledger}    label="General Ledger" />
          <NavItem to="/trial-balance"     icon={Icon.balance}   label="Trial Balance" />
        </SectionGroup>

        <div className="h-px bg-slate-100 my-1" />

        {/* ── CUSTOMERS ── */}
        <SectionGroup
          label="Customers & CRM"
          icon={Icon.crm}
          routes={["/customers", "/loyalty-levels", "/reviews", "/story-letter-library"]}
        >
          <NavItem to="/customers"     icon={Icon.customers} label="Customer Profiles" />
          <NavItem to="/loyalty-levels" icon={Icon.loyalty}  label="VIP Loyalty Tiers" />
          <NavItem to="/reviews"       icon={Icon.reviews}  label="Product Reviews" />
          <NavItem to="/story-letter-library" icon={Icon.letter} label="Story Letter Library" />
        </SectionGroup>

      </div>

      {/* ── Sticky Footer ── */}
      <div className="flex-shrink-0 border-t border-slate-100 px-3 py-3 space-y-2">
        <NavLink
          to="/change-password"
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all duration-150 group ${
              isActive
                ? "bg-slate-900 text-white"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/80"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-white" : "text-slate-400 group-hover:text-slate-600"}`}>
                {Icon.lock}
              </span>
              <span>Change Password</span>
            </>
          )}
        </NavLink>

        {/* System status badge */}
        <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded-xl">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
          <div className="text-[11px] leading-tight min-w-0">
            <p className="font-semibold text-slate-700 truncate">Aama Store Active</p>
            <p className="text-[10px] text-slate-400">v2.4 Management</p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
