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
import Performance from "./pages/Performance";
import DirectOrders from "./pages/DirectOrders";
import CustomerLoyalty from "./pages/CustomerLoyalty";
import PickupProfile from "./pages/PickupProfile";
import Finance from "./pages/Finance";
import MarketingCards from "./pages/MarketingCards";

const MainLayout = () => {
  const { token, loading } = useManufacturer();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!token) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Navbar />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden min-w-0">
          <div className="max-w-7xl mx-auto">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/:id" element={<OrderDetail />} />
              <Route path="/direct-orders" element={<DirectOrders />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/pickup-profile" element={<PickupProfile />} />
              <Route path="/performance" element={<Performance />} />
              <Route path="/finance" element={<Finance />} />
              <Route path="/customer-loyalty" element={<CustomerLoyalty />} />
              <Route path="/marketing-cards" element={<MarketingCards />} />
              <Route path="*" element={<Navigate to="/" replace />} />
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
