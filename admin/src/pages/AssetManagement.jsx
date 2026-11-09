/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";

const AssetManagement = ({ token }) => {
  const acquisitionRequest = useRef(null);
  const disposalRequest = useRef(null);
  const [assets, setAssets] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDamageModal, setShowDamageModal] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);

  // Forms
  const [newAsset, setNewAsset] = useState({
    assetName: "",
    category: "COMPUTERS_IT",
    vendorName: "",
    invoiceNumber: "",
    purchaseDate: new Date().toISOString().split("T")[0],
    purchaseCost: "",
    salvageValue: "0",
    depreciationRate: "25",
    depreciationMethod: "WRITTEN_DOWN_VALUE_SLAB",
    usefulLifeMonths: "60",
    settlementType: "FULL_CASH",
    paidAmount: "",
    paidFromAccountId: "",
  });

  const [damageForm, setDamageForm] = useState({
    status: "DAMAGED",
    damageNotes: "",
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const [astRes, accRes] = await Promise.all([
        axios.get(`${backendUrl}/api/finance/fixed-assets`, { headers: { token } }),
        axios.get(`${backendUrl}/api/finance/treasury-accounts`, { headers: { token } }),
      ]);
      if (astRes.data.success) setAssets(astRes.data.assets || []);
      if (accRes.data.success) setAccounts(accRes.data.accounts || []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load fixed assets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchData();
  }, [token]);

  const handleCategoryChange = (cat) => {
    let rate = "25";
    if (cat === "COMPUTERS_IT" || cat === "FURNITURE_FIXTURES") rate = "25"; // IRD Block B (25%)
    else if (cat === "VEHICLES") rate = "20"; // IRD Block C (20%)
    else if (cat === "MACHINERY_EQUIPMENT") rate = "15"; // IRD Block D (15%)
    else if (cat === "LEASEHOLD_IMPROVEMENTS") rate = "5"; // IRD Block A (5%)

    setNewAsset({ ...newAsset, category: cat, depreciationRate: rate });
  };

  const handleCreateAsset = async (e) => {
    e.preventDefault();
    if (!newAsset.assetName || !newAsset.purchaseCost) {
      return toast.warn("Asset Name and Purchase Cost are required");
    }

    try {
      const signature = JSON.stringify(newAsset);
      if (!acquisitionRequest.current || acquisitionRequest.current.signature !== signature) {
        acquisitionRequest.current = { signature, key: crypto.randomUUID() };
      }
      const res = await axios.post(`${backendUrl}/api/finance/create-asset`, newAsset, {
        headers: { token, "Idempotency-Key": acquisitionRequest.current.key },
      });
      if (res.data.success) {
        acquisitionRequest.current = null;
        toast.success("Fixed asset registered");
        setShowAddModal(false);
        setNewAsset({
          assetName: "",
          category: "COMPUTERS_IT",
          vendorName: "",
          invoiceNumber: "",
          purchaseDate: new Date().toISOString().split("T")[0],
          purchaseCost: "",
          salvageValue: "0",
          depreciationRate: "25",
          depreciationMethod: "WRITTEN_DOWN_VALUE_SLAB",
          usefulLifeMonths: "60",
          settlementType: "FULL_CASH",
          paidAmount: "",
          paidFromAccountId: "",
        });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const handleRunDepreciation = async () => {
    if (!window.confirm("Run depreciation for the current BS accounting month for all active assets? This can only be posted once per month.")) return;
    try {
      const res = await axios.post(
        `${backendUrl}/api/finance/run-depreciation`,
        { monthsCount: 1 },
        { headers: { token } }
      );
      if (res.data.success && res.data.alreadyProcessed) {
        toast.info(res.data.message);
      } else if (res.data.success) {
        toast.success(`Depreciation applied: ${currency}${res.data.totalDepreciated}`);
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const handleDamageOrDisposal = async (e) => {
    e.preventDefault();
    if (!selectedAsset) return;

    try {
      const requestBody = {
        assetId: selectedAsset.id,
        ...damageForm,
      };
      const signature = JSON.stringify(requestBody);
      if (!disposalRequest.current || disposalRequest.current.signature !== signature) {
        disposalRequest.current = { signature, key: crypto.randomUUID() };
      }
      const res = await axios.post(
        `${backendUrl}/api/finance/damage-asset`,
        requestBody,
        { headers: { token, "Idempotency-Key": disposalRequest.current.key } }
      );
      if (res.data.success) {
        disposalRequest.current = null;
        toast.success(res.data.message);
        setShowDamageModal(false);
        setSelectedAsset(null);
        setDamageForm({ status: "DAMAGED", damageNotes: "" });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const activeAssets = assets.filter((a) => a.status === "ACTIVE");
  const totalGrossCost = activeAssets.reduce((acc, a) => acc + Number(a.purchaseCost || 0), 0);
  const totalAccDep = activeAssets.reduce((acc, a) => acc + Number(a.accumulatedDepreciation || 0), 0);
  const totalCurrentBook = activeAssets.reduce((acc, a) => acc + Number(a.currentBookValue || 0), 0);

  return (
    <div className="space-y-8 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-200/60">
              Fixed Asset Register
            </span>
            <span className="text-xs font-medium text-slate-400">Nepal IRD Block Rates Compliant</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 mt-1">Asset Management &amp; Depreciation</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Asset acquisitions, diminishing balance tax depreciation, and damaged asset write-offs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleRunDepreciation}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-xs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            <span>Run Monthly Depreciation Batch</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-xs"
          >
            <span>+ Purchase / Add Asset</span>
          </button>
        </div>
      </div>

      {/* SUMMARY BANNER */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active Asset Historical Cost</p>
          <p className="text-2xl font-black text-slate-900 mt-1">
            {currency}{totalGrossCost.toLocaleString()}
          </p>
          <p className="text-xs text-slate-400 mt-1">Gross capitalization value</p>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active Accumulated Depreciation</p>
          <p className="text-2xl font-black text-amber-600 mt-1">
            {currency}{totalAccDep.toLocaleString()}
          </p>
          <p className="text-xs text-slate-400 mt-1">Total claimed tax shields</p>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Net Current Book Value</p>
          <p className="text-2xl font-black text-emerald-600 mt-1">
            {currency}{totalCurrentBook.toLocaleString()}
          </p>
          <p className="text-xs text-slate-400 mt-1">Active balance sheet asset base</p>
        </div>
      </div>

      {/* ASSET TABLE */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Fixed Asset Master Register</h2>
            <p className="text-xs text-slate-400">Individual equipment, vehicle, and furniture ledger</p>
          </div>
          <span className="text-xs text-slate-400 font-semibold">{assets.length} Assets Listed</span>
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-100">
                <th className="p-3">Asset Tag &amp; Name</th>
                <th className="p-3">Category / Tax Slab</th>
                <th className="p-3">Purchase Date</th>
                <th className="p-3 text-right">Cost Price</th>
                <th className="p-3 text-right">Rate</th>
                <th className="p-3 text-right">Acc. Dep</th>
                <th className="p-3 text-right">Current Book Value</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {assets.length === 0 ? (
                <tr>
                  <td colSpan="9" className="p-6 text-center text-slate-400 font-medium">
                    No fixed assets registered yet. Click &quot;+ Purchase / Add Asset&quot; to begin.
                  </td>
                </tr>
              ) : (
                assets.map((ast) => (
                  <tr key={ast.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-3">
                      <p className="font-bold text-slate-900">{ast.assetName}</p>
                      <p className="text-[10px] font-mono text-slate-400">{ast.assetTag}</p>
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                        {ast.category}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-slate-500">
                      {new Date(ast.purchaseDate).toLocaleDateString()}
                    </td>
                    <td className="p-3 text-right font-semibold text-slate-900">
                      {currency}{Number(ast.purchaseCost).toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-medium text-slate-600">
                      {ast.depreciationRate}%
                    </td>
                    <td className="p-3 text-right text-amber-700 font-semibold">
                      {currency}{Number(ast.accumulatedDepreciation).toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-black text-emerald-700">
                      {currency}{Number(ast.currentBookValue).toLocaleString()}
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          ast.status === "ACTIVE"
                            ? "bg-emerald-50 text-emerald-700"
                            : ast.status === "DAMAGED"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {ast.status}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      {ast.status === "ACTIVE" ? (
                        <button
                          onClick={() => {
                            setSelectedAsset(ast);
                            setShowDamageModal(true);
                          }}
                          className="px-2.5 py-1 bg-rose-50 text-rose-700 hover:bg-rose-100 font-semibold rounded-lg text-[11px] transition-colors"
                        >
                          Damage / Dispose
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">Disposed</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: ADD / PURCHASE ASSET */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Add / Purchase Fixed Asset</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            {(() => {
              const cost = Number(newAsset.purchaseCost || 0);
              const activeAcc = accounts.find((a) => a.id === newAsset.paidFromAccountId);
              const requiredUpfront = newAsset.settlementType === "FULL_CASH"
                ? cost
                : newAsset.settlementType === "PARTIAL"
                  ? Number(newAsset.paidAmount || 0)
                  : 0;
              const remainingPayable = Math.max(0, cost - requiredUpfront);
              const isInsufficient = (newAsset.settlementType === "FULL_CASH" || newAsset.settlementType === "PARTIAL") && activeAcc && Number(activeAcc.currentBalance || 0) < requiredUpfront;

              return (
                <form onSubmit={handleCreateAsset} className="space-y-4 mt-4 text-xs">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Asset Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. MacBook Pro M3 (Design Team)"
                      value={newAsset.assetName}
                      onChange={(e) => setNewAsset({ ...newAsset, assetName: e.target.value })}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-semibold"
                      required
                    />
                  </div>

                  {/* Vendor / Purchased From & Invoice */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        Vendor / Purchased From <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Oliz Store Pvt Ltd"
                        value={newAsset.vendorName}
                        onChange={(e) => setNewAsset({ ...newAsset, vendorName: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                        required
                      />
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Vendor Invoice / Ref #</label>
                      <input
                        type="text"
                        placeholder="e.g. OLZ-9921"
                        value={newAsset.invoiceNumber}
                        onChange={(e) => setNewAsset({ ...newAsset, invoiceNumber: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Category &amp; IRD Tax Slab</label>
                      <select
                        value={newAsset.category}
                        onChange={(e) => handleCategoryChange(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-medium"
                      >
                        <option value="COMPUTERS_IT">Computers &amp; IT (Block B - 25%)</option>
                        <option value="FURNITURE_FIXTURES">Furniture &amp; Store Racks (Block B - 25%)</option>
                        <option value="VEHICLES">Delivery Bikes / Vehicles (Block C - 20%)</option>
                        <option value="MACHINERY_EQUIPMENT">Packaging Machinery (Block D - 15%)</option>
                        <option value="LEASEHOLD_IMPROVEMENTS">Interior Fitout (Block A - 5%)</option>
                      </select>
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Purchase Date</label>
                      <input
                        type="date"
                        value={newAsset.purchaseDate}
                        onChange={(e) => setNewAsset({ ...newAsset, purchaseDate: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Purchase Cost ({currency}) *</label>
                      <input
                        type="number"
                        placeholder="120000"
                        value={newAsset.purchaseCost}
                        onChange={(e) => setNewAsset({ ...newAsset, purchaseCost: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                        required
                      />
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Annual Dep. Rate (%)</label>
                      <input
                        type="number"
                        value={newAsset.depreciationRate}
                        onChange={(e) => setNewAsset({ ...newAsset, depreciationRate: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                      />
                    </div>
                  </div>

                  {/* SETTLEMENT MODE */}
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                    <label className="font-bold text-slate-800 block text-[11px] uppercase tracking-wider">
                      Payment Settlement &amp; Solvency
                    </label>

                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setNewAsset({ ...newAsset, settlementType: "FULL_CASH" })}
                        className={`p-2 rounded-lg text-xs font-bold border text-center transition-all ${
                          newAsset.settlementType === "FULL_CASH"
                            ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        💵 100% Cash
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewAsset({ ...newAsset, settlementType: "PARTIAL" })}
                        className={`p-2 rounded-lg text-xs font-bold border text-center transition-all ${
                          newAsset.settlementType === "PARTIAL"
                            ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        ⚖️ Partial Split
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewAsset({ ...newAsset, settlementType: "CREDIT_PAYABLE" })}
                        className={`p-2 rounded-lg text-xs font-bold border text-center transition-all ${
                          newAsset.settlementType === "CREDIT_PAYABLE"
                            ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        📄 100% Credit
                      </button>
                    </div>

                    {newAsset.settlementType !== "CREDIT_PAYABLE" && (
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div>
                          <label className="font-semibold text-slate-700 block mb-1">Disbursement Account</label>
                          <select
                            value={newAsset.paidFromAccountId}
                            onChange={(e) => setNewAsset({ ...newAsset, paidFromAccountId: e.target.value })}
                            className="w-full p-2 bg-white border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                            required
                          >
                            <option value="">Select Treasury Account...</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.accountName} ({currency}{Number(a.currentBalance).toLocaleString()})
                              </option>
                            ))}
                          </select>
                        </div>

                        {newAsset.settlementType === "PARTIAL" ? (
                          <div>
                            <label className="font-semibold text-slate-700 block mb-1">
                              Paid Amount ({currency}) <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="number"
                              min="1"
                              max={cost || 999999999}
                              placeholder="50000"
                              value={newAsset.paidAmount}
                              onChange={(e) => setNewAsset({ ...newAsset, paidAmount: e.target.value })}
                              className="w-full p-2 bg-white border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-mono"
                              required
                            />
                          </div>
                        ) : (
                          <div className="flex items-end pb-1">
                            <span className="text-xs text-slate-500">
                              Full amount will be deducted from chosen account.
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {isInsufficient && (
                      <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-700 font-bold">
                        ⚠️ Insufficient liquid funds! Available: {currency}{Number(activeAcc?.currentBalance || 0).toLocaleString()}, required: {currency}{requiredUpfront.toLocaleString()}.
                      </div>
                    )}

                    <div className="p-2 bg-white border border-slate-200 rounded-lg text-[11px] space-y-0.5">
                      <div className="flex justify-between font-bold text-slate-800">
                        <span>Paid Now (Liquid Bank):</span>
                        <span className="text-emerald-700 font-mono">{currency}{requiredUpfront.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between font-bold text-slate-800">
                        <span>Accounts Payable to Vendor:</span>
                        <span className="text-amber-700 font-mono">{currency}{remainingPayable.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowAddModal(false)}
                      className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isInsufficient}
                      className="px-4 py-2 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 disabled:opacity-50"
                    >
                      Register Asset
                    </button>
                  </div>
                </form>
              );
            })()}
          </div>
        </div>
      )}

      {/* MODAL: DAMAGE / DISPOSAL */}
      {showDamageModal && selectedAsset && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Record Asset Damage / Disposal</h3>
              <button onClick={() => setShowDamageModal(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleDamageOrDisposal} className="space-y-4 mt-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <p className="font-bold text-slate-900">{selectedAsset.assetName}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Current Book Value: <span className="font-bold text-slate-800">{currency}{Number(selectedAsset.currentBookValue).toLocaleString()}</span>
                </p>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Disposal / Impairment Status</label>
                <select
                  value={damageForm.status}
                  onChange={(e) => setDamageForm({ ...damageForm, status: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                >
                  <option value="DAMAGED">🔴 Damaged Beyond Repair (Write-off)</option>
                  <option value="WRITTEN_OFF">⚪ Obsolete / Written-Off</option>
                </select>
              </div>
              <p className="text-[11px] text-amber-700">
                Asset sales and disposal proceeds are unavailable until tax and VAT treatment is approved.
              </p>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Damage / Disposal Notes</label>
                <textarea
                  rows="2"
                  placeholder="e.g. Broken display panel beyond economic repair"
                  value={damageForm.damageNotes}
                  onChange={(e) => setDamageForm({ ...damageForm, damageNotes: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowDamageModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700"
                >
                  Confirm Disposal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetManagement;
