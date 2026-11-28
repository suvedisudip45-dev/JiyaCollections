import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import AppShell from "./components/layout/AppShell";
import { backendUrl } from "./api/client";

// Pages
import LoginPage from "./pages/auth/LoginPage";
import SignupPage from "./pages/auth/SignupPage";
import DashboardPage from "./pages/dashboard/DashboardPage";
import CampaignListPage from "./pages/campaigns/CampaignListPage";
import CampaignDetailPage from "./pages/campaigns/CampaignDetailPage";
import CardListPage from "./pages/cards/CardListPage";
import CardDetailPage from "./pages/cards/CardDetailPage";
import QrValidatorPage from "./pages/qr-validator/QrValidatorPage";
import RedemptionsPage from "./pages/redemptions/RedemptionsPage";
import ReportsPage from "./pages/reports/ReportsPage";
import ProfilePage from "./pages/account/ProfilePage";
import SettingsPage from "./pages/account/SettingsPage";
import UnauthorizedPage from "./pages/error/UnauthorizedPage";
import NotFoundPage from "./pages/error/NotFoundPage";

const MarketingFeatureGate = ({ children }) => {
  const [enabled, setEnabled] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    axios.get(`${backendUrl}/api/features`)
      .then((response) => {
        if (!response.data?.success) throw new Error("Feature status is unavailable.");
        if (mounted) setEnabled(Boolean(response.data.features?.marketingCardsEnabled));
      })
      .catch((requestError) => {
        console.error("Unable to verify marketing card feature status:", requestError);
        if (mounted) setError(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (error) return <div className="p-8 text-center text-sm text-rose-700">Marketing features could not be verified. Refresh the page or contact an administrator.</div>;
  if (enabled === null) return <div className="p-8 text-center text-sm text-slate-500">Checking portal availability...</div>;
  if (!enabled) return <div className="p-8 text-center text-sm text-slate-600">Marketing cards are currently disabled by an administrator.</div>;
  return children;
};

const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <MarketingFeatureGate>
        <Routes>
          {/* Public Auth Route */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* Protected Marketing Partner Portal Routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="campaigns" element={<CampaignListPage />} />
            <Route path="campaigns/:id" element={<CampaignDetailPage />} />
            <Route path="cards" element={<CardListPage />} />
            <Route path="cards/:id" element={<CardDetailPage />} />
            <Route path="redemptions" element={<RedemptionsPage />} />
            <Route path="qr-validator" element={<QrValidatorPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="unauthorized" element={<UnauthorizedPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
        </MarketingFeatureGate>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
