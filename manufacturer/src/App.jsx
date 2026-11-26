import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link, matchPath, useLocation } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { ManufacturerProvider, useManufacturer } from "./context/ManufacturerContext";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import Breadcrumbs from "./components/Breadcrumbs";
import { installAuthInterceptor } from "./api/authInterceptor";
import {
  getDistributorPath,
  getWorkspaceBasePath,
  isMixedPortalBuild,
} from "./utils/workspaceRoutes";

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
const NcmDeliveries = lazy(() => import("./pages/NcmDeliveries"));
const DistributorDemandReceipt = lazy(() => import("./pages/DistributorDemandReceipt"));
const DistributorFinanceDashboard = lazy(() => import("./pages/DistributorFinanceDashboard"));
const DistributorPaperBills = lazy(() => import("./pages/DistributorPaperBills"));

const mixedPortalBuild = isMixedPortalBuild(import.meta.env.BASE_URL);
const workspaceBasePath = getWorkspaceBasePath(import.meta.env.BASE_URL, window.location.pathname);
const requestedWorkspace = mixedPortalBuild
  ? workspaceBasePath === "/distributor" ? "DISTRIBUTOR" : "MANUFACTURER"
  : null;
const distributorPath = (path) => getDistributorPath(import.meta.env.BASE_URL, path);
const manufacturerPaths = [
  "/",
  "/production",
  "/bulk-transfers",
  "/bulk-transfers/:transferId",
  "/performance",
  "/finance",
];
const distributorPaths = [
  "/",
  "/orders",
  "/orders/:id",
  "/direct-orders",
  "/inventory",
  "/deliveries",
  "/ncm",
  "/demand",
  "/demand/:transferId",
  "/finance",
  "/paper-bills",
  "/customer-loyalty",
  "/gift-inventory",
  "/marketing-cards",
];
const knownPaths = mixedPortalBuild
  ? requestedWorkspace === "DISTRIBUTOR"
    ? [...distributorPaths, "/pickup-profile"]
    : [...manufacturerPaths, "/pickup-profile"]
  : [...manufacturerPaths, "/pickup-profile", "/distributor", ...distributorPaths.map((path) => distributorPath(path))];

const loginPath = `${workspaceBasePath === "/" ? "" : workspaceBasePath}/login`;
installAuthInterceptor(loginPath);

const PortalLoader = () => (
  <div className="flex min-h-[50vh] items-center justify-center text-[#171717]" role="status">
    <span className="sr-only">Loading workspace...</span>
    <div aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-3 border-[#171717] border-t-transparent" />
  </div>
);

const MainLayout = () => {
  const {
    token,
    loading,
    manufacturer,
    distributor,
    activeWorkspace,
    availableWorkspaces,
    platformFeatures,
    switchWorkspace,
  } = useManufacturer();
  const location = useLocation();
  const [workspaceError, setWorkspaceError] = useState("");
  const hasRequestedWorkspace = availableWorkspaces.some((workspace) =>
    (typeof workspace === "string" ? workspace : workspace.code) === requestedWorkspace
  );

  const knownRoute = location.pathname === "/login" || knownPaths.some((path) =>
    matchPath({ path, end: true }, location.pathname)
  );

  useEffect(() => {
    if (!mixedPortalBuild || !token || loading || (!manufacturer && !distributor)) return undefined;
    if (activeWorkspace === requestedWorkspace) {
      return undefined;
    }
    if (!hasRequestedWorkspace) return undefined;

    let active = true;
    switchWorkspace(requestedWorkspace).then((changed) => {
      if (active && !changed) {
        setWorkspaceError(`The ${requestedWorkspace.toLowerCase()} workspace could not be activated.`);
      }
    });
    return () => {
      active = false;
    };
  }, [
    activeWorkspace,
    availableWorkspaces,
    distributor,
    hasRequestedWorkspace,
    loading,
    manufacturer,
    switchWorkspace,
    token,
  ]);

  if (!knownRoute) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-2xl font-bold text-[#171717]">Page not found</h1>
        <p className="text-sm text-[#575757]">This address does not match a page in this workspace.</p>
        <Link className="text-sm font-semibold underline" to="/">Return to workspace home</Link>
      </main>
    );
  }

  if (loading) {
    return <PortalLoader />;
  }

  if (location.pathname === "/login" && token) {
    return <Navigate to="/" replace />;
  }

  if (!token) {
    return <Login />;
  }

  if (mixedPortalBuild && activeWorkspace !== requestedWorkspace) {
    if (!hasRequestedWorkspace) {
      return (
        <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
          <p role="alert" className="text-sm text-rose-700">This account is not authorized for the {requestedWorkspace.toLowerCase()} workspace.</p>
          <a className="text-sm font-semibold underline" href="/">Return to workspace selection</a>
        </main>
      );
    }
    if (workspaceError) {
      return (
        <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
          <p role="alert" className="text-sm text-rose-700">{workspaceError}</p>
          <a className="text-sm font-semibold underline" href="/">Return to workspace selection</a>
        </main>
      );
    }
    return <PortalLoader />;
  }

  // Wait until at least one profile is loaded
  if (!manufacturer && !distributor) {
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
                <Route
                  path="/"
                  element={
                    mixedPortalBuild
                      ? activeWorkspace === "DISTRIBUTOR" ? <DistributorHome /> : <Dashboard />
                      : activeWorkspace === "DISTRIBUTOR" ? <Navigate to="/distributor" replace /> : <Dashboard />
                  }
                />
                {(!mixedPortalBuild || requestedWorkspace === "MANUFACTURER") && (
                  <>
                    <Route path="/production" element={<Production />} />
                    <Route path="/bulk-transfers" element={<FactoryTransfers />} />
                    <Route path="/bulk-transfers/:transferId" element={<FactoryTransfers />} />
                    <Route path="/performance" element={<Performance />} />
                    <Route path="/finance" element={<Finance />} />
                  </>
                )}
                <Route path="/pickup-profile" element={<PickupProfile />} />
                {(!mixedPortalBuild || requestedWorkspace === "DISTRIBUTOR") && (
                  <>
                    {!mixedPortalBuild && <Route path="/distributor" element={<DistributorHome />} />}
                    <Route path={distributorPath("/orders")} element={<DistributorOnly><Orders /></DistributorOnly>} />
                    <Route path={distributorPath("/orders/:id")} element={<DistributorOnly><OrderDetail /></DistributorOnly>} />
                    <Route path={distributorPath("/direct-orders")} element={<DistributorOnly><DirectOrders /></DistributorOnly>} />
                    <Route path={distributorPath("/inventory")} element={<DistributorOnly><DistributorInventory /></DistributorOnly>} />
                    <Route path={distributorPath("/deliveries")} element={<DistributorOnly><DistributorSelfDelivery /></DistributorOnly>} />
                    <Route path={distributorPath("/ncm")} element={<DistributorOnly><NcmDeliveries /></DistributorOnly>} />
                    <Route path={distributorPath("/demand")} element={<DistributorOnly><DistributorDemandReceipt /></DistributorOnly>} />
                    <Route path={distributorPath("/demand/:transferId")} element={<DistributorOnly><DistributorDemandReceipt /></DistributorOnly>} />
                    <Route path={distributorPath("/finance")} element={<DistributorOnly><DistributorFinanceDashboard /></DistributorOnly>} />
                    <Route path={distributorPath("/paper-bills")} element={<DistributorOnly><DistributorPaperBills /></DistributorOnly>} />
                    <Route path={distributorPath("/customer-loyalty")} element={
                      <DistributorOnly>
                        {platformFeatures?.loyaltyEnabled ? <CustomerLoyalty /> : <Navigate to="/" replace />}
                      </DistributorOnly>
                    } />
                    <Route path={distributorPath("/gift-inventory")} element={<DistributorOnly><GiftInventory /></DistributorOnly>} />
                    <Route path={distributorPath("/marketing-cards")} element={
                      <DistributorOnly>
                        {platformFeatures?.marketingCardsEnabled ? <MarketingCards /> : <Navigate to="/" replace />}
                      </DistributorOnly>
                    } />
                  </>
                )}
                <Route path="*" element={<WorkspaceNotFound />} />
              </Routes>
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
};

const DistributorOnly = ({ children }) => {
  const { activeWorkspace } = useManufacturer();
  if (activeWorkspace === "DISTRIBUTOR") return children;
  return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Activate the Distributor workspace to access this page.</div>;
};

const WorkspaceNotFound = () => (
  <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
    <h2 className="text-lg font-bold text-[#171717]">Page not found</h2>
    <p className="mt-2 text-sm text-[#575757]">This address does not match a page in this workspace.</p>
    <Link className="mt-4 inline-block text-sm font-semibold underline" to="/">Return to workspace home</Link>
  </div>
);

const App = () => {
  return (
    <BrowserRouter basename={workspaceBasePath}>
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
