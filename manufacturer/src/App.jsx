import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { ManufacturerProvider, useManufacturer } from "./context/ManufacturerContext";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import Breadcrumbs from "./components/Breadcrumbs";
import { installAuthInterceptor } from "./api/authInterceptor";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Orders = lazy(() => import("./pages/Orders"));
const OrderDetail = lazy(() => import("./pages/OrderDetail"));
const DistributorInventory = lazy(() => import("./pages/DistributorInventory"));
const Production = lazy(() => import("./pages/Production"));
const FactoryTransfers = lazy(() => import("./pages/FactoryTransfers"));
const Performance = lazy(() => import("./pages/Performance"));
const DirectOrders = lazy(() => import("./pages/DirectOrders"));
const CustomerLoyalty = lazy(() => import("./pages/CustomerLoyalty"));
const GiftInventory = lazy(() => import("./pages/GiftInventory"));
const PickupProfile = lazy(() => import("./pages/PickupProfile"));
const Finance = lazy(() => import("./pages/Finance"));
const MarketingCards = lazy(() => import("./pages/MarketingCards"));
const DistributorHome = lazy(() => import("./pages/DistributorHome"));
const DistributorSelfDelivery = lazy(() => import("./pages/DistributorSelfDelivery"));
const DistributorLogistics = lazy(() => import("./pages/DistributorLogistics"));
const DistributorPeerTransfers = lazy(() => import("./pages/DistributorPeerTransfers"));
const NcmDeliveries = lazy(() => import("./pages/NcmDeliveries"));
const DistributorDemandReceipt = lazy(() => import("./pages/DistributorDemandReceipt"));
const DistributorFinanceDashboard = lazy(() => import("./pages/DistributorFinanceDashboard"));
const DistributorOperations = lazy(() => import("./pages/DistributorOperations"));
const DistributorPaperBills = lazy(() => import("./pages/DistributorPaperBills"));
const WholesaleDealers = lazy(() => import("./pages/WholesaleDealers"));
const DriverDeliveries = lazy(() => import("./pages/DriverDeliveries"));

installAuthInterceptor();

const PortalLoader = () => (
  <div className="flex min-h-[50vh] items-center justify-center text-[#171717]" role="status">
    <span className="sr-only">Loading workspace...</span>
    <div aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-3 border-[#171717] border-t-transparent" />
  </div>
);

const MainLayout = () => {
  const { token, loading, manufacturer, distributor, driver, activeWorkspace, platformFeatures } = useManufacturer();

  if (loading) {
    return <PortalLoader />;
  }

  if (!token) {
    return <Login />;
  }

  // Wait until at least one profile is loaded
  if (!manufacturer && !distributor && !driver) {
    return <PortalLoader />;
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col font-sans">
      <Navbar />
      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <Sidebar />
        <main className="w-full min-w-0 flex-1 overflow-x-hidden p-3 sm:p-5 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">
            <Breadcrumbs />
            <Suspense fallback={<PortalLoader />}>
              <Routes>
                {/* ── Manufacturer Portal Routes ──────────────────────────── */}
                <Route
                  path="/"
                  element={
                    activeWorkspace === "DISTRIBUTOR"
                      ? <Navigate to="/distributor" replace />
                      : activeWorkspace === "DRIVER"
                        ? <Navigate to="/driver" replace />
                        : <Dashboard />
                  }
                />
                <Route path="/production" element={activeWorkspace === "MANUFACTURER" ? <Production /> : <Navigate to="/" replace />} />
                <Route path="/bulk-transfers" element={activeWorkspace === "MANUFACTURER" ? <FactoryTransfers /> : <Navigate to="/" replace />} />
                <Route path="/bulk-transfers/:transferId" element={activeWorkspace === "MANUFACTURER" ? <FactoryTransfers /> : <Navigate to="/" replace />} />
                <Route path="/performance" element={activeWorkspace === "MANUFACTURER" ? <Performance /> : <Navigate to="/" replace />} />
                <Route path="/finance" element={activeWorkspace === "MANUFACTURER" ? <Finance /> : <Navigate to="/" replace />} />

                {/* ── Shared (Pickup Profile works for both roles) ────────── */}
                <Route path="/pickup-profile" element={["MANUFACTURER", "DISTRIBUTOR"].includes(activeWorkspace) ? <PickupProfile /> : <Navigate to="/" replace />} />

                {/* ── Distributor Portal Routes ───────────────────────────── */}
                <Route path="/distributor" element={activeWorkspace === "DISTRIBUTOR" ? <DistributorHome /> : <Navigate to="/" replace />} />
                <Route path="/orders" element={activeWorkspace === "DISTRIBUTOR" ? <Orders /> : <Navigate to="/" replace />} />
                <Route path="/orders/:id" element={activeWorkspace === "DISTRIBUTOR" ? <OrderDetail /> : <Navigate to="/" replace />} />
                <Route path="/direct-orders" element={activeWorkspace === "DISTRIBUTOR" ? <DirectOrders /> : <Navigate to="/" replace />} />
                <Route path="/wholesale/dealers" element={activeWorkspace === "DISTRIBUTOR" ? <WholesaleDealers /> : <Navigate to="/" replace />} />
                <Route path="/inventory" element={activeWorkspace === "DISTRIBUTOR" ? <DistributorInventory /> : <Navigate to="/" replace />} />
                <Route path="/distributor/deliveries" element={activeWorkspace === "DISTRIBUTOR" ? <DistributorSelfDelivery /> : <Navigate to="/" replace />} />
                <Route path="/distributor/logistics" element={activeWorkspace === "DISTRIBUTOR" ? <DistributorLogistics /> : <Navigate to="/" replace />} />
                <Route path="/distributor/peer-transfers" element={activeWorkspace === "DISTRIBUTOR" ? <DistributorPeerTransfers /> : <Navigate to="/" replace />} />
                <Route path="/ncm" element={activeWorkspace === "DISTRIBUTOR" ? <NcmDeliveries /> : <Navigate to="/" replace />} />
                <Route path="/distributor/demand" element={activeWorkspace === "DISTRIBUTOR" ? <DistributorDemandReceipt /> : <Navigate to="/" replace />} />
                <Route path="/distributor/demand/:transferId" element={activeWorkspace === "DISTRIBUTOR" ? <DistributorDemandReceipt /> : <Navigate to="/" replace />} />
                <Route path="/distributor/finance" element={activeWorkspace === "DISTRIBUTOR" ? <DistributorFinanceDashboard /> : <Navigate to="/" replace />} />
                <Route path="/distributor/operations" element={activeWorkspace === "DISTRIBUTOR" ? <DistributorOperations /> : <Navigate to="/" replace />} />
                <Route path="/distributor/paper-bills" element={activeWorkspace === "DISTRIBUTOR" ? <DistributorPaperBills /> : <Navigate to="/" replace />} />
                <Route path="/customer-loyalty" element={activeWorkspace === "DISTRIBUTOR" && platformFeatures?.loyaltyEnabled !== undefined ? (platformFeatures.loyaltyEnabled ? <CustomerLoyalty /> : <Navigate to="/" replace />) : null} />
                <Route path="/gift-inventory" element={activeWorkspace === "DISTRIBUTOR" ? <GiftInventory /> : <Navigate to="/" replace />} />
                <Route path="/marketing-cards" element={activeWorkspace === "DISTRIBUTOR" && platformFeatures?.marketingCardsEnabled !== undefined ? (platformFeatures.marketingCardsEnabled ? <MarketingCards /> : <Navigate to="/" replace />) : null} />
                <Route path="/driver" element={activeWorkspace === "DRIVER" ? <DriverDeliveries /> : <Navigate to="/" replace />} />

                {/* ── Fallback ─────────────────────────────────────────────── */}
                <Route
                  path="*"
                  element={
                    <Navigate
                      to={activeWorkspace === "DISTRIBUTOR" ? "/distributor" : activeWorkspace === "DRIVER" ? "/driver" : "/"}
                      replace
                    />
                  }
                />
              </Routes>
            </Suspense>
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
        <Suspense fallback={<PortalLoader />}>
          <MainLayout />
        </Suspense>
      </ManufacturerProvider>
    </BrowserRouter>
  );
};

export default App;
