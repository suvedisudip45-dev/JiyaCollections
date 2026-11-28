/* eslint-disable react/prop-types */
import { useState } from "react";
import { Link } from "react-router-dom";
import NcmOrderTools from "../components/ncm/NcmOrderTools";
import NcmReferenceTools from "../components/ncm/NcmReferenceTools";
import NcmSupportTools from "../components/ncm/NcmSupportTools";

const TABS = [
  ["orders", "Orders"],
  ["reference", "Branches & customers"],
  ["support", "Support"],
];

const NcmTools = ({ token }) => {
  const [activeTab, setActiveTab] = useState("orders");
  return (
    <section className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">NCM integration</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">NCM tools</h1>
          <p className="mt-1 text-sm text-slate-500">Manual, authenticated access to documented NCM operations.</p>
        </div>
        <Link to="/ncm-deliveries" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Delivery records</Link>
      </header>
      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-3" aria-label="NCM tool categories">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setActiveTab(key)} className={`rounded-lg px-3 py-2 text-sm font-medium ${activeTab === key ? "bg-indigo-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
            {label}
          </button>
        ))}
      </nav>
      {activeTab === "orders" && <NcmOrderTools token={token} />}
      {activeTab === "reference" && <NcmReferenceTools token={token} />}
      {activeTab === "support" && <NcmSupportTools token={token} />}
    </section>
  );
};

export default NcmTools;
