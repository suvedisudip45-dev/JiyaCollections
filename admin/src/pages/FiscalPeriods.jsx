/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";

const FiscalPeriods = ({ token }) => {
  const [fiscalYears, setFiscalYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFyForm, setNewFyForm] = useState({
    name: `FY ${new Date().getFullYear()}/${new Date().getFullYear() + 1}`,
    startDate: `${new Date().getFullYear()}-01-01`,
    endDate: `${new Date().getFullYear()}-12-31`,
  });

  const fetchFiscalYears = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/accounting/fiscal-years`, {
        headers: { token },
      });
      if (res.data.success) {
        setFiscalYears(res.data.fiscalYears || []);
      } else {
        toast.error(res.data.message || "Failed to load fiscal years");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || "Error fetching fiscal periods");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchFiscalYears();
  }, [token]);

  const handleCreateFiscalYear = async (e) => {
    e.preventDefault();
    if (!newFyForm.name || !newFyForm.startDate || !newFyForm.endDate) {
      toast.warn("Fiscal Year Name, Start Date, and End Date are required.");
      return;
    }

    try {
      const res = await axios.post(
        `${backendUrl}/api/accounting/create-fiscal-year`,
        newFyForm,
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(res.data.message || "Fiscal Year initialized successfully");
        setShowCreateModal(false);
        fetchFiscalYears();
      } else {
        toast.error(res.data.message || "Failed to create fiscal year");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || "Server error while creating fiscal year");
    }
  };

  const handleTogglePeriod = async (periodId, currentStatus) => {
    const nextStatus = currentStatus === "OPEN" ? "CLOSED" : "OPEN";
    try {
      const res = await axios.post(
        `${backendUrl}/api/accounting/toggle-period`,
        { periodId, status: nextStatus },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(res.data.message || `Period status changed to ${nextStatus}`);
        fetchFiscalYears();
      } else {
        toast.error(res.data.message || "Failed to update period status");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || "Error updating period status");
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Fiscal Years &amp; Period Control</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Audit Lock Governance
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Establish annual fiscal reporting calendars and control accounting period locks to prevent unauthorized backdated journal postings
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchFiscalYears}
            className="px-3.5 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-xl flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs flex items-center gap-2 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            New Fiscal Year
          </button>
        </div>
      </div>

      {/* Fiscal Years List */}
      <div className="space-y-6">
        {loading ? (
          <div className="bg-white p-12 text-center text-slate-400 rounded-2xl border border-slate-200">
            <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-2"></div>
            Loading fiscal periods...
          </div>
        ) : fiscalYears.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <p className="text-slate-500 text-sm font-medium">No fiscal years have been configured yet.</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs"
            >
              Initialize First Fiscal Year
            </button>
          </div>
        ) : (
          fiscalYears.map((fy) => {
            const periods = fy.periods || [];
            const openPeriodsCount = periods.filter((p) => p.status === "OPEN").length;
            const closedPeriodsCount = periods.filter((p) => p.status === "CLOSED").length;

            return (
              <div key={fy.id} className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                {/* Fiscal Year Top Header */}
                <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900">{fy.name}</h2>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        {fy.status || "ACTIVE"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Calendar Range: {new Date(fy.startDate).toLocaleDateString()} — {new Date(fy.endDate).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-medium">
                    <span className="flex items-center gap-1.5 text-emerald-700">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      {openPeriodsCount} Open Periods
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                      {closedPeriodsCount} Closed / Locked Periods
                    </span>
                  </div>
                </div>

                {/* 12 Monthly Accounting Periods Grid */}
                <div className="p-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {periods.map((period) => {
                      const isOpen = period.status === "OPEN";
                      return (
                        <div
                          key={period.id}
                          className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${
                            isOpen
                              ? "bg-white border-slate-200 hover:border-emerald-300 shadow-xs"
                              : "bg-slate-50 border-slate-200 text-slate-400"
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-xs text-slate-800">
                                {period.periodName}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  isOpen
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    : "bg-slate-200 text-slate-600"
                                }`}
                              >
                                {period.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1">
                              {period.startDate ? new Date(period.startDate).toLocaleDateString("en-NP", { month: "short", day: "numeric" }) : ""} — {period.endDate ? new Date(period.endDate).toLocaleDateString("en-NP", { month: "short", day: "numeric", year: "numeric" }) : ""}
                            </p>
                          </div>

                          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                            <span className="text-[10px] text-slate-400">
                              {isOpen ? "Accepts Postings" : "Postings Locked"}
                            </span>
                            <button
                              onClick={() => handleTogglePeriod(period.id, period.status)}
                              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors shadow-xs ${
                                isOpen
                                  ? "text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200"
                                  : "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200"
                              }`}
                            >
                              {isOpen ? "Lock / Close Period" : "Re-open Period"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* New Fiscal Year Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Initialize New Fiscal Year</h2>
                <p className="text-[11px] text-slate-400">Creates calendar year and 12 monthly accounting sub-periods</p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateFiscalYear} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Fiscal Year Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. FY 2026/2027"
                  value={newFyForm.name}
                  onChange={(e) => setNewFyForm({ ...newFyForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={newFyForm.startDate}
                    onChange={(e) => setNewFyForm({ ...newFyForm, startDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    End Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={newFyForm.endDate}
                    onChange={(e) => setNewFyForm({ ...newFyForm, endDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs"
                >
                  Create Calendar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FiscalPeriods;
