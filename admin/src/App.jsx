import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { clearAuthTokens } from "./auth/tokenStorage";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import { Routes, Route } from "react-router-dom";
import Add from "./pages/Add";
import List from "./pages/List";
import Orders from "./pages/Orders";
import Categories from "./pages/Categories";
import Reviews from "./pages/Reviews";
import ShippingSettings from "./pages/ShippingSettings";
import Customers from "./pages/Customers";
import LoyaltyLevels from "./pages/LoyaltyLevels";
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
import Manufacturers from "./pages/Manufacturers";
import OrderAssignments from "./pages/OrderAssignments";
import DeliveryMonitor from "./pages/DeliveryMonitor";
import ManufacturerInventoryMonitor from "./pages/ManufacturerInventoryMonitor";
import StoryLetterLibrary from "./pages/StoryLetterLibrary";
import MarketingCards from "./pages/MarketingCards";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { installAuthInterceptor } from "./api/authInterceptor";

installAuthInterceptor();

export const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
export const currency = "Rs ";

const App = () => {
  // Retrieve the token from localStorage only on the initial render
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [authLoading, setAuthLoading] = useState(() => Boolean(localStorage.getItem("token")));
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
      if (active) sessionValidated.current = true;
    }).catch(() => {
      sessionValidated.current = false;
      clearAuthTokens();
      if (active) setToken("");
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
        <>
          <Navbar setToken={setToken} />
          <div className="flex w-full min-h-[calc(100vh-65px)]">
            <Sidebar />
            <main className="flex-1 p-4 sm:p-6 lg:p-8 bg-[#f3f6f4] overflow-x-hidden min-w-0">
              <div className="max-w-7xl mx-auto">
                <Routes>
                  <Route path="/finance" element={<FinanceDashboard token={token} />} />
                  <Route path="/treasury" element={<TreasuryCash token={token} />} />
                  <Route path="/assets" element={<AssetManagement token={token} />} />
                  <Route path="/partners" element={<PartnershipEquity token={token} />} />
                  <Route path="/expenses" element={<ExpenseManagement token={token} />} />
                  <Route path="/tax" element={<TaxCompliance token={token} />} />
                  <Route path="/returns" element={<ReturnsManagement token={token} />} />
                  <Route path="/payables" element={<PayablesReceivables token={token} />} />
                  <Route path="/statements" element={<FinancialStatements token={token} />} />
                  <Route path="/chart-of-accounts" element={<ChartOfAccounts token={token} />} />
                  <Route path="/journal-entries" element={<JournalEntries token={token} />} />
                  <Route path="/general-ledger" element={<GeneralLedger token={token} />} />
                  <Route path="/trial-balance" element={<TrialBalance token={token} />} />
                  <Route path="/add" element={<Add token={token} />} />
                  <Route path="/list" element={<List token={token} />} />
                  <Route path="/inventory" element={<Inventory token={token} />} />
                  <Route path="/cogs" element={<CogsCalculator token={token} />} />
                  <Route path="/special-offers" element={<SpecialOffers token={token} />} />
                  <Route path="/create-order" element={<CreateOrder token={token} />} />
                  <Route path="/add-order" element={<CreateOrder token={token} />} />
                  <Route path="/orders" element={<Orders token={token} />} />
                  <Route path="/order-assignments" element={<OrderAssignments token={token} />} />
                  <Route path="/delivery-monitor" element={<DeliveryMonitor token={token} />} />
                  <Route path="/manufacturers" element={<Manufacturers token={token} />} />
                  <Route path="/manufacturer-inventory" element={<ManufacturerInventoryMonitor token={token} />} />
                  <Route path="/marketing-cards" element={<MarketingCards token={token} />} />
                  <Route path="/customers" element={<Customers token={token} />} />
                  <Route path="/loyalty-levels" element={<LoyaltyLevels token={token} />} />
                  <Route path="/categories" element={<Categories token={token} />} />
                  <Route path="/reviews" element={<Reviews token={token} />} />
                  <Route path="/story-letter-library" element={<StoryLetterLibrary token={token} />} />
                  <Route path="/shipping" element={<ShippingSettings token={token} />} />
                  <Route path="/change-password" element={<ChangePassword token={token} />} />
                </Routes>
              </div>
            </main>
          </div>
        </>
      )}
    </div>
  );
};


export default App;
