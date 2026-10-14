/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Link, useNavigate, useParams } from "react-router-dom";
import { backendUrl } from "../App";
import { toast } from "react-toastify";
import { usePermissions } from "../auth/PermissionsContext";
import ManufacturerProfileSection from "../components/manufacturer-details/ManufacturerProfileSection";
import {
  ManufacturerFinanceSection,
  ManufacturerInventorySection,
  ManufacturerProductionSection,
  ManufacturerSettlementsSection,
  ManufacturerTransactionsSection,
  ManufacturerTransfersSection,
} from "../components/manufacturer-details/ManufacturerDetailSections";

const tabs = [
  ["profile", "Profile", "manufacturer:admin_detail"],
  ["inventory", "Factory inventory", "manufacturer:admin_inventory_read"],
  ["production", "Production", "manufacturer:admin_production_read"],
  ["transfers", "Distributor transfers", "manufacturer:admin_transfers_read"],
  ["finance", "Finance", "manufacturer:admin_finance_read"],
  ["transactions", "Transactions", "manufacturer:admin_finance_read"],
  ["settlements", "Payable requests", "manufacturer:admin_settlements_read"],
];

const ManufacturerDetail = ({ token }) => {
  const { manufacturerId } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [manufacturer, setManufacturer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("profile");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/manufacturer/admin/list`, {
        params: { manufacturerId, page: 1, limit: 1 },
        headers: { token },
      });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load manufacturer profile.");
      setManufacturer(response.data.manufacturers?.[0] || null);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to load manufacturer profile.");
      setManufacturer(null);
    } finally {
      setLoading(false);
    }
  }, [manufacturerId, token]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  if (loading) {
    return <main className="mx-auto max-w-7xl p-6"><p className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500">Loading manufacturer profile…</p></main>;
  }
  if (!manufacturer) {
    return <main className="mx-auto max-w-7xl space-y-4 p-6"><p className="rounded-xl border border-rose-200 bg-white px-5 py-12 text-center text-sm text-rose-700">Manufacturer profile could not be loaded.</p><button type="button" onClick={() => navigate("/manufacturers")} className="text-sm font-bold text-indigo-700">Back to directory</button></main>;
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/manufacturers" className="text-sm font-bold text-slate-600 hover:text-slate-900">← Manufacturer directory</Link>
        <button type="button" onClick={loadProfile} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Refresh details</button>
      </div>

      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Manufacturer profile</p>
            <h1 className="mt-1 text-2xl font-black text-slate-900">{manufacturer.name}</h1>
            <p className="mt-1 text-sm text-slate-500">{[manufacturer.city, manufacturer.address].filter(Boolean).join(" · ") || "Location not set"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${manufacturer.contractStatus === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{manufacturer.contractStatus || "ACTIVE"}</span>
            <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${manufacturer.isAvailable ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>{manufacturer.isAvailable ? "Available" : "Paused"}</span>
          </div>
        </div>
        <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <p><span className="text-xs text-slate-500">Business email</span><br /><b className="break-all text-slate-800">{manufacturer.email || "—"}</b></p>
          <p><span className="text-xs text-slate-500">Contact</span><br /><b className="text-slate-800">{manufacturer.phone || "—"}</b></p>
          <p><span className="text-xs text-slate-500">Account</span><br /><b className="text-slate-800">{manufacturer.account?.status || "No linked login"}</b></p>
          <p><span className="text-xs text-slate-500">Last login</span><br /><b className="text-slate-800">{manufacturer.account?.lastLoginAt ? new Date(manufacturer.account.lastLoginAt).toLocaleString() : "—"}</b></p>
        </div>
      </header>

      <nav aria-label="Manufacturer details" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {tabs.filter(([, , permission]) => can(permission)).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setActiveTab(key)} className={`whitespace-nowrap rounded-lg px-3.5 py-2.5 text-xs font-bold transition ${activeTab === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "profile" && <ManufacturerProfileSection manufacturer={manufacturer} token={token} onUpdated={loadProfile} />}
      {activeTab === "inventory" && <ManufacturerInventorySection manufacturerId={manufacturerId} token={token} />}
      {activeTab === "production" && <ManufacturerProductionSection manufacturerId={manufacturerId} token={token} />}
      {activeTab === "transfers" && <ManufacturerTransfersSection manufacturerId={manufacturerId} token={token} />}
      {activeTab === "finance" && <ManufacturerFinanceSection manufacturerId={manufacturerId} token={token} />}
      {activeTab === "transactions" && <ManufacturerTransactionsSection manufacturerId={manufacturerId} token={token} />}
      {activeTab === "settlements" && <ManufacturerSettlementsSection manufacturerId={manufacturerId} token={token} />}
    </main>
  );
};

export default ManufacturerDetail;
