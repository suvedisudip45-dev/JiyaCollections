import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { ManufacturerProvider, useManufacturer } from "./context/ManufacturerContext";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import Inventory from "./pages/Inventory";
import Production from "./pages/Production";
import FactoryTransfers from "./pages/FactoryTransfers";
import Performance from "./pages/Performance";
import DirectOrders from "./pages/DirectOrders";
import CustomerLoyalty from "./pages/CustomerLoyalty";
import GiftInventory from "./pages/GiftInventory";
import PickupProfile from "./pages/PickupProfile";
import Finance from "./pages/Finance";
import MarketingCards from "./pages/MarketingCards";
import DistributorHome from "./pages/DistributorHome";
import DistributorSelfDelivery from "./pages/DistributorSelfDelivery";
import DistributorDemandReceipt from "./pages/DistributorDemandReceipt";
import DistributorFinanceDashboard from "./pages/DistributorFinanceDashboard";
import { installAuthInterceptor } from "./api/authInterceptor";

installAuthInterceptor();

const MainLayout = () => {
  const { token, loading, manufacturer, distributor, activeWorkspace } = useManufacturer();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center text-[#171717]">
        <div className="w-8 h-8 border-3 border-[#171717] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!token) {
    return <Login />;
  }

  // Wait until at least one profile is loaded
  if (!manufacturer && !distributor) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center text-[#171717]">
        <div className="w-8 h-8 border-3 border-[#171717] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col font-sans">
      <Navbar />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden min-w-0">
          <div className="max-w-7xl mx-auto">
            <Routes>
              {/* ── Manufacturer Portal Routes ──────────────────────────── */}
              <Route
                path="/"
                element={
                  activeWorkspace === "DISTRIBUTOR"
                    ? <Navigate to="/distributor" replace />
                    : <Dashboard />
                }
              />
              <Route path="/production" element={<Production />} />
              <Route path="/bulk-transfers" element={<FactoryTransfers />} />
              <Route path="/performance" element={<Performance />} />
              <Route path="/finance" element={<Finance />} />

              {/* ── Shared (Pickup Profile works for both roles) ────────── */}
              <Route path="/pickup-profile" element={<PickupProfile />} />

              {/* ── Distributor Portal Routes ───────────────────────────── */}
              <Route path="/distributor" element={<DistributorHome />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/:id" element={<OrderDetail />} />
              <Route path="/direct-orders" element={<DirectOrders />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/distributor/deliveries" element={<DistributorSelfDelivery />} />
              <Route path="/distributor/demand" element={<DistributorDemandReceipt />} />
              <Route path="/distributor/finance" element={<DistributorFinanceDashboard />} />
              <Route path="/customer-loyalty" element={<CustomerLoyalty />} />
              <Route path="/gift-inventory" element={<GiftInventory />} />
              <Route path="/marketing-cards" element={<MarketingCards />} />

              {/* ── Fallback ─────────────────────────────────────────────── */}
              <Route
                path="*"
                element={
                  <Navigate
                    to={activeWorkspace === "DISTRIBUTOR" ? "/distributor" : "/"}
                    replace
                  />
                }
              />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
};

const App = () => {
  return (
    <BrowserRouter>
      <ManufacturerProvider>
        <ToastContainer position="top-right" autoClose={3000} />
        <MainLayout />
      </ManufacturerProvider>
    </BrowserRouter>
  );
};

export default App;
