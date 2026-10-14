/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Link, useNavigate, useParams } from "react-router-dom";
import { backendUrl } from "../App";
import { toast } from "react-toastify";
import { usePermissions } from "../auth/PermissionsContext";
import DistributorProfileSection from "../components/distributor-details/DistributorProfileSection";
import {
  DistributorExchangesSection,
  DistributorFinanceSection,
  DistributorFulfillmentSection,
  DistributorInventorySection,
  DistributorReturnsSection,
  DistributorSessionsSection,
  DistributorTransfersSection,
} from "../components/distributor-details/DistributorDetailSections";

const tabs = [
  ["profile", "Profile", "distributor:admin_detail"],
  ["finance", "Finance", "distributor:admin_finance_read"],
  ["inventory", "Inventory", "distributor:admin_inventory_read"],
  ["transfers", "Stock transfers", "distributor:admin_transfers_read"],
  ["fulfillment", "Orders & delivery", "distributor:admin_fulfillment_read"],
  ["returns", "Returns", "distributor:admin_returns_read"],
  ["exchanges", "Exchanges", "distributor:admin_exchanges_read"],
  ["sessions", "Login history", "distributor:admin_sessions_read"],
];

const DistributorDetail = ({ token }) => {
  const { distributorId } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [distributor, setDistributor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("profile");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/admin/distributors/${distributorId}/profile`, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load distributor profile.");
      setDistributor(response.data.distributor);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to load distributor profile.");
      setDistributor(null);
    } finally {
      setLoading(false);
    }
  }, [distributorId, token]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  if (loading) {
    return <main className="mx-auto max-w-7xl p-6"><p className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500">Loading distributor profile…</p></main>;
  }
  if (!distributor) {
    return <main className="mx-auto max-w-7xl space-y-4 p-6"><p className="rounded-xl border border-rose-200 bg-white px-5 py-12 text-center text-sm text-rose-700">Distributor profile could not be loaded.</p><button type="button" onClick={() => navigate("/distributors")} className="text-sm font-bold text-indigo-700">Back to directory</button></main>;
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/distributors" className="text-sm font-bold text-slate-600 hover:text-slate-900">← Distributor directory</Link>
        <button type="button" onClick={loadProfile} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Refresh details</button>
      </div>

      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Distributor profile</p>
            <h1 className="mt-1 text-2xl font-black text-slate-900">{distributor.name}</h1>
            <p className="mt-1 text-sm text-slate-500">{[distributor.city, distributor.district, distributor.province].filter(Boolean).join(", ") || "Location not set"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${distributor.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{distributor.status}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">{distributor.account?.status || "No linked account"}</span>
          </div>
        </div>
        <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <p><span className="text-xs text-slate-500">Contact</span><br /><b className="text-slate-800">{distributor.phone || "—"}</b></p>
          <p><span className="text-xs text-slate-500">Account email</span><br /><b className="break-all text-slate-800">{distributor.account?.email || "—"}</b></p>
          <p><span className="text-xs text-slate-500">Last login</span><br /><b className="text-slate-800">{distributor.account?.lastLoginAt ? new Date(distributor.account.lastLoginAt).toLocaleString() : "—"}</b></p>
          <p><span className="text-xs text-slate-500">Pickup branch</span><br /><b className="text-slate-800">{distributor.ncmPickupBranch || "—"}</b></p>
        </div>
      </header>

      <nav aria-label="Distributor details" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {tabs.filter(([, , permission]) => can(permission)).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setActiveTab(key)} className={`whitespace-nowrap rounded-lg px-3.5 py-2.5 text-xs font-bold transition ${activeTab === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "profile" && <DistributorProfileSection distributor={distributor} token={token} onUpdated={loadProfile} />}
      {activeTab === "finance" && <DistributorFinanceSection distributorId={distributorId} token={token} />}
      {activeTab === "inventory" && <DistributorInventorySection distributorId={distributorId} token={token} />}
      {activeTab === "transfers" && <DistributorTransfersSection distributorId={distributorId} token={token} />}
      {activeTab === "fulfillment" && <DistributorFulfillmentSection distributorId={distributorId} token={token} />}
      {activeTab === "returns" && <DistributorReturnsSection distributorId={distributorId} token={token} />}
      {activeTab === "exchanges" && <DistributorExchangesSection distributorId={distributorId} token={token} />}
      {activeTab === "sessions" && <DistributorSessionsSection distributorId={distributorId} token={token} />}
    </main>
  );
};

export default DistributorDetail;
