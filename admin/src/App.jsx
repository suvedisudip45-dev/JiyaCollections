/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { clearAuthTokens } from "./auth/tokenStorage";
import { PermissionsProvider, usePermissions } from "./auth/PermissionsContext";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import { Routes, Route, useNavigate } from "react-router-dom";
import Add from "./pages/Add";
import List from "./pages/List";
import Orders from "./pages/Orders";
import Categories from "./pages/Categories";
import ComboBundles from "./pages/ComboBundles";
import Collaborations from "./pages/Collaborations";
import Reviews from "./pages/Reviews";
import ShippingSettings from "./pages/ShippingSettings";
import Customers from "./pages/Customers";
import LoyaltyLevels from "./pages/LoyaltyLevels";
import GiftPromotions from "./pages/GiftPromotions";
import CreateOrder from "./pages/CreateOrder";
import SpecialOffers from "./pages/SpecialOffers";
import Inventory from "./pages/Inventory";
import CogsCalculator from "./pages/CogsCalculator";
import Login from "./components/Login";
import ChangePassword from "./pages/ChangePassword";
import FinanceDashboard from "./pages/FinanceDashboard";
import TreasuryCash from "./pages/TreasuryCash";
import AssetManagement from "./pages/AssetManagement";
import PartnershipEquity from "./pages/PartnershipEquity";
import TaxCompliance from "./pages/TaxCompliance";
import ReturnsManagement from "./pages/ReturnsManagement";
import ExpenseManagement from "./pages/ExpenseManagement";
import FinancialStatements from "./pages/FinancialStatements";
import PayablesReceivables from "./pages/PayablesReceivables";
import ChartOfAccounts from "./pages/ChartOfAccounts";
import JournalEntries from "./pages/JournalEntries";
import GeneralLedger from "./pages/GeneralLedger";
import TrialBalance from "./pages/TrialBalance";
import FiscalPeriods from "./pages/FiscalPeriods";
import AccountingHealth from "./pages/AccountingHealth";
import Manufacturers from "./pages/Manufacturers";
import LocationPricing from "./pages/LocationPricing";
import OrderAssignments from "./pages/OrderAssignments";
import DeliveryMonitor from "./pages/DeliveryMonitor";
import ManufacturerInventoryMonitor from "./pages/ManufacturerInventoryMonitor";
import StoryLetterLibrary from "./pages/StoryLetterLibrary";
import MarketingCards from "./pages/MarketingCards";
import AccessUsers from "./pages/AccessUsers";
import AccessRoles from "./pages/AccessRoles";
import AccessPermissions from "./pages/AccessPermissions";
import { ADMIN_ROUTE_PERMISSIONS } from "./auth/adminRoutePermissions";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { installAuthInterceptor } from "./api/authInterceptor";

installAuthInterceptor();

export const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
export const currency = "Rs ";

const AccessRoute = ({ requiredPermissions = [], children }) => {
  const { canAny } = usePermissions();
  if (!requiredPermissions.length || canAny(requiredPermissions)) return children;
  return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">You do not have permission to access this page.</div>;
};

const withPermission = (path, element) => (
  <AccessRoute requiredPermissions={ADMIN_ROUTE_PERMISSIONS[path]}>{element}</AccessRoute>
);

const App = () => {
  const navigate = useNavigate();
  // Retrieve the token from localStorage only on the initial render
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [authLoading, setAuthLoading] = useState(() => Boolean(localStorage.getItem("token")));
  const [sessionAccount, setSessionAccount] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const sessionValidated = useRef(false);

  // Store token in localStorage whenever it changes
  useEffect(() => {
    if (token) {
      localStorage.setItem("token", token);
    } else {
      localStorage.removeItem("token"); // Optionally, clear the token if it's removed
    }
  }, [token]);

  useEffect(() => {
    const updateToken = (event) => {
      if (event.detail?.accessToken) setToken(event.detail.accessToken);
    };
    const clearToken = () => setToken("");
    window.addEventListener("auth:tokens-updated", updateToken);
    window.addEventListener("auth:tokens-cleared", clearToken);
    return () => {
      window.removeEventListener("auth:tokens-updated", updateToken);
      window.removeEventListener("auth:tokens-cleared", clearToken);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!token) {
      sessionValidated.current = false;
      setSessionAccount(null);
      setPermissions([]);
      setPasswordChangeRequired(false);
      setAuthLoading(false);
      return () => {
        active = false;
      };
    }
    if (sessionValidated.current) {
      setAuthLoading(false);
      return () => {
        active = false;
      };
    }

    setAuthLoading(true);
    axios.get(`${backendUrl}/api/auth/me`).then((response) => {
      if (!response.data?.success || response.data?.account?.role?.toUpperCase() !== "ADMIN") {
        throw new Error("An active admin session is required.");
      }
      if (active) {
        sessionValidated.current = true;
        setSessionAccount(response.data.account);
        setPermissions(response.data.account.permissions || []);
        setPasswordChangeRequired(Boolean(response.data.account.mustChangePassword));
      }
    }).catch(() => {
      sessionValidated.current = false;
      clearAuthTokens();
      if (active) {
        setToken("");
        setSessionAccount(null);
        setPermissions([]);
        setPasswordChangeRequired(false);
      }
    }).finally(() => {
      if (active) setAuthLoading(false);
    });

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="admin-shell bg-[#f3f6f4] min-h-screen">
      <ToastContainer />
      {authLoading ? (
        <div className="min-h-[70vh] flex items-center justify-center text-sm text-slate-500">Checking session...</div>
      ) : token === "" ? (
        <Login setToken={setToken} />
      ) : (
        <PermissionsProvider account={sessionAccount} permissions={permissions}>
          <Navbar setToken={setToken} />
          {passwordChangeRequired ? (
            <main className="min-h-[calc(100vh-65px)] p-4 sm:p-6 lg:p-8">
              <div className="max-w-7xl mx-auto">
                <ChangePassword
                  token={token}
                  forced
                  onPasswordChanged={() => {
                    setPasswordChangeRequired(false);
                    navigate("/list", { replace: true });
                  }}
                />
              </div>
            </main>
          ) : (
            <div className="flex w-full min-h-[calc(100vh-65px)]">
              <Sidebar />
              <main className="flex-1 p-4 sm:p-6 lg:p-8 bg-[#f3f6f4] overflow-x-hidden min-w-0">
                <div className="max-w-7xl mx-auto">
                  <Routes>
                  <Route path="/finance" element={withPermission("/finance", <FinanceDashboard token={token} />)} />
                  <Route path="/treasury" element={withPermission("/treasury", <TreasuryCash token={token} />)} />
                  <Route path="/assets" element={withPermission("/assets", <AssetManagement token={token} />)} />
                  <Route path="/partners" element={withPermission("/partners", <PartnershipEquity token={token} />)} />
                  <Route path="/expenses" element={withPermission("/expenses", <ExpenseManagement token={token} />)} />
                  <Route path="/tax" element={withPermission("/tax", <TaxCompliance token={token} />)} />
                  <Route path="/returns" element={withPermission("/returns", <ReturnsManagement token={token} />)} />
                  <Route path="/payables" element={withPermission("/payables", <PayablesReceivables token={token} />)} />
                  <Route path="/statements" element={withPermission("/statements", <FinancialStatements token={token} />)} />
                  <Route path="/chart-of-accounts" element={withPermission("/chart-of-accounts", <ChartOfAccounts token={token} />)} />
                  <Route path="/journal-entries" element={withPermission("/journal-entries", <JournalEntries token={token} />)} />
                  <Route path="/general-ledger" element={withPermission("/general-ledger", <GeneralLedger token={token} />)} />
                  <Route path="/trial-balance" element={withPermission("/trial-balance", <TrialBalance token={token} />)} />
                  <Route path="/fiscal-periods" element={withPermission("/fiscal-periods", <FiscalPeriods token={token} />)} />
                  <Route path="/accounting-health" element={withPermission("/accounting-health", <AccountingHealth token={token} />)} />
                  <Route path="/add" element={withPermission("/add", <Add token={token} />)} />
                  <Route path="/list" element={withPermission("/list", <List token={token} />)} />
                  <Route path="/inventory" element={withPermission("/inventory", <Inventory token={token} />)} />
                  <Route path="/cogs" element={withPermission("/cogs", <CogsCalculator token={token} />)} />
                  <Route path="/special-offers" element={withPermission("/special-offers", <SpecialOffers token={token} />)} />
                  <Route path="/create-order" element={withPermission("/create-order", <CreateOrder token={token} />)} />
                  <Route path="/add-order" element={withPermission("/add-order", <CreateOrder token={token} />)} />
                  <Route path="/orders" element={withPermission("/orders", <Orders token={token} />)} />
                  <Route path="/order-assignments" element={withPermission("/order-assignments", <OrderAssignments token={token} />)} />
                  <Route path="/delivery-monitor" element={withPermission("/delivery-monitor", <DeliveryMonitor token={token} />)} />
                  <Route path="/manufacturers" element={withPermission("/manufacturers", <Manufacturers token={token} />)} />
                  <Route path="/location-pricing" element={withPermission("/location-pricing", <LocationPricing token={token} />)} />
                  <Route path="/manufacturer-inventory" element={withPermission("/manufacturer-inventory", <ManufacturerInventoryMonitor token={token} />)} />
                  <Route path="/marketing-cards" element={withPermission("/marketing-cards", <MarketingCards token={token} />)} />
                  <Route path="/customers" element={withPermission("/customers", <Customers token={token} />)} />
                  <Route path="/loyalty-levels" element={withPermission("/loyalty-levels", <LoyaltyLevels token={token} />)} />
                  <Route path="/gift-promotions" element={withPermission("/gift-promotions", <GiftPromotions token={token} />)} />
                  <Route path="/categories" element={withPermission("/categories", <Categories token={token} />)} />
                  <Route path="/combo-bundles" element={withPermission("/combo-bundles", <ComboBundles token={token} />)} />
                  <Route path="/collaborations" element={withPermission("/collaborations", <Collaborations token={token} />)} />
                  <Route path="/reviews" element={withPermission("/reviews", <Reviews token={token} />)} />
                  <Route path="/story-letter-library" element={withPermission("/story-letter-library", <StoryLetterLibrary token={token} />)} />
                  <Route path="/shipping" element={withPermission("/shipping", <ShippingSettings token={token} />)} />
                  <Route path="/change-password" element={<ChangePassword token={token} />} />
                  <Route path="/access-control/users" element={withPermission("/access-control/users", <AccessUsers token={token} />)} />
                  <Route path="/access-control/roles" element={withPermission("/access-control/roles", <AccessRoles token={token} />)} />
                  <Route path="/access-control/permissions" element={withPermission("/access-control/permissions", <AccessPermissions token={token} />)} />
                  </Routes>
                </div>
              </main>
            </div>
          )}
        </PermissionsProvider>
      )}
    </div>
  );
};


export default App;
