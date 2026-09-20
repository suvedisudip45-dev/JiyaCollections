import React, { useEffect, useState } from "react";
import axios from "axios";
import { useManufacturer } from "../context/ManufacturerContext";
import { TrendingUp, Wallet, PackageCheck, RotateCcw, FileText } from "lucide-react";

const rangeOptions = [
  { value: "day", label: "Today" },
  { value: "week", label: "7 Days" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "3 Months" },
  { value: "year", label: "Year" },
];

const money = (value) => `Rs ${Number(value || 0).toLocaleString("en-NP", { maximumFractionDigits: 0 })}`;

const Finance = () => {
  const { token, backendUrl, currency } = useManufacturer();
  const [range, setRange] = useState("month");
  const [loading, setLoading] = useState(true);
  const [savingCommission, setSavingCommission] = useState(false);
  const [commissionProposal, setCommissionProposal] = useState(12);
  const [data, setData] = useState(null);

  useEffect(() => {
    const loadSummary = async () => {
      if (!token) return;
      setLoading(true);
      try {
        const res = await axios.get(`${backendUrl}/api/finance/manufacturer-summary`, {
          headers: { token },
          params: { range },
        });

        if (res.data.success) {
          setData(res.data.data);
          const current = res.data.data?.manufacturer?.proposedCommissionRate ?? res.data.data?.manufacturer?.agreedCommissionRate ?? 12;
          setCommissionProposal(Number(current || 12));
        }
      } catch (error) {
        console.error("Failed to load manufacturer finance summary", error);
      } finally {
        setLoading(false);
      }
    };

    loadSummary();
  }, [backendUrl, range, token]);

  const summary = data?.summary || {};
  const orders = data?.orders || [];
  const isPendingCommission = (data?.manufacturer?.commissionStatus || "PENDING") === "PENDING";
  const commissionLastProposedBy = (data?.manufacturer?.commissionLastProposedBy || "ADMIN").toUpperCase();
  const commissionLockUntil = data?.manufacturer?.commissionLockUntil ? new Date(data.manufacturer.commissionLockUntil) : null;
  const isCommissionLocked = data?.manufacturer?.commissionStatus === "APPROVED" && commissionLockUntil && commissionLockUntil > new Date();
  const currentCommission = isPendingCommission
    ? (data?.manufacturer?.proposedCommissionRate ?? data?.manufacturer?.agreedCommissionRate ?? 12)
    : (data?.manufacturer?.agreedCommissionRate ?? data?.manufacturer?.proposedCommissionRate ?? 12);
  const pendingDecisionForManufacturer = isPendingCommission && commissionLastProposedBy !== "MANUFACTURER";
  const lockMessage = isCommissionLocked
    ? `This commission has been finalized and is locked until ${commissionLockUntil.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}.`
    : "";

  const submitCommissionProposal = async () => {
    try {
      setSavingCommission(true);
      const res = await axios.put(`${backendUrl}/api/manufacturer/commission`, {
        proposedCommissionRate: Number(commissionProposal),
      }, { headers: { token } });
      if (res.data.success) {
        await loadSummary();
      }
    } catch (error) {
      console.error("Failed to propose commission", error);
    } finally {
      setSavingCommission(false);
    }
  };

  const submitCommissionDecision = async (nextStatus) => {
    try {
      setSavingCommission(true);
      const payload =
        nextStatus === "APPROVED"
          ? {
              agreedCommissionRate: Number(currentCommission || 0),
              commissionStatus: "APPROVED",
            }
          : {
              commissionStatus: "REJECTED",
              commissionNote: "Manufacturer rejected the proposed commission rate.",
            };

      const res = await axios.put(`${backendUrl}/api/manufacturer/commission`, payload, { headers: { token } });
      if (res.data.success) {
        await loadSummary();
      }
    } catch (error) {
      console.error("Failed to update commission decision", error);
    } finally {
      setSavingCommission(false);
    }
  };

  const loadSummary = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${backendUrl}/api/finance/manufacturer-summary`, {
        headers: { token },
        params: { range },
      });
      if (res.data.success) {
        setData(res.data.data);
        const nextRate = res.data.data?.manufacturer?.proposedCommissionRate ?? res.data.data?.manufacturer?.agreedCommissionRate ?? 12;
        setCommissionProposal(Number(nextRate || 12));
      }
    } catch (error) {
      console.error("Failed to load manufacturer finance summary", error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Manufacturer finance</p>
          <h1 className="text-2xl font-black text-slate-900">Payables, receivables & net summary</h1>
        </div>

        <div className="flex flex-wrap gap-2">
          {rangeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setRange(option.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                range === option.value
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Loading account summary...
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Sales value</p>
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <p className="mt-3 text-2xl font-black text-slate-900">{money(summary.totalSales || 0)}</p>
              <p className="mt-1 text-[11px] text-slate-500">{summary.totalOrders || 0} orders in range</p>
            </div>

            <div className="bg-white border border-red-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-red-500">Account payable</p>
                <Wallet className="w-4 h-4 text-red-500" />
              </div>
              <p className="mt-3 text-2xl font-black text-red-700">{money(summary.payable || 0)}</p>
              <p className="mt-1 text-[11px] text-slate-500">Manufacturing / supply cost due</p>
            </div>

            <div className="bg-white border border-emerald-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-emerald-500">Account receivable</p>
                <FileText className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="mt-3 text-2xl font-black text-emerald-700">{money(summary.receivable || 0)}</p>
              <p className="mt-1 text-[11px] text-slate-500">Completed deliveries credited to hub</p>
            </div>

            <div className="bg-white border border-blue-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-blue-500">Net receivable</p>
                <PackageCheck className="w-4 h-4 text-blue-500" />
              </div>
              <p className="mt-3 text-2xl font-black text-blue-700">{money(summary.netReceivable || 0)}</p>
              <p className="mt-1 text-[11px] text-slate-500">Receivable minus payable</p>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">Commission agreement</span>
                <FileText className="w-4 h-4 text-slate-500" />
              </div>
              <p className="mt-3 text-2xl font-black text-slate-900">{Number(currentCommission || 0).toFixed(2)}%</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {isPendingCommission ? "Pending approval" : "Finalized rate"}: {Number(data?.manufacturer?.agreedCommissionRate ?? (currentCommission || 0)).toFixed(2)}% · Status: {data?.manufacturer?.commissionStatus || "PENDING"}
              </p>

              {isCommissionLocked && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 font-medium">
                  {lockMessage}
                </div>
              )}

              <div className="mt-3 flex gap-2 flex-wrap">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={commissionProposal}
                  onChange={(e) => setCommissionProposal(parseFloat(e.target.value) || 0)}
                  disabled={isCommissionLocked || savingCommission}
                  className="w-24 px-2 py-1.5 border border-slate-300 rounded-lg text-sm disabled:bg-slate-100 disabled:text-slate-400"
                />
                <button
                  onClick={submitCommissionProposal}
                  disabled={isCommissionLocked || savingCommission}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingCommission ? "Saving..." : pendingDecisionForManufacturer ? "Counter-offer" : "Propose"}
                </button>
                {pendingDecisionForManufacturer && !isCommissionLocked && (
                  <>
                    <button
                      onClick={() => submitCommissionDecision("APPROVED")}
                      disabled={savingCommission}
                      className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold border border-emerald-200 disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => submitCommissionDecision("REJECTED")}
                      disabled={savingCommission}
                      className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-semibold border border-rose-200 disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="bg-slate-900 text-white rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-slate-300">Items sold</span>
                <PackageCheck className="w-4 h-4 text-teal-300" />
              </div>
              <p className="mt-3 text-2xl font-black">{summary.itemsSold || 0}</p>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-emerald-600">Delivered</span>
                <PackageCheck className="w-4 h-4 text-emerald-600" />
              </div>
              <p className="mt-3 text-2xl font-black text-emerald-700">{summary.itemsDelivered || 0}</p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-amber-600">Returned</span>
                <RotateCcw className="w-4 h-4 text-amber-600" />
              </div>
              <p className="mt-3 text-2xl font-black text-amber-700">{summary.itemsReturned || 0}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800">Order breakdown</h2>
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Commission rate: {summary.agreedCommissionRate || 12}%</span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Order</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Qty</th>
                    <th className="px-4 py-3 font-semibold">Sales</th>
                    <th className="px-4 py-3 font-semibold">Payable</th>
                    <th className="px-4 py-3 font-semibold">Receivable</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="px-4 py-8 text-center text-slate-400">
                        No orders in this time range.
                      </td>
                    </tr>
                  ) : (
                    orders.map((order) => (
                      <tr key={order.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-700">{order.id.slice(0, 8)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-1 rounded-full text-[10px] font-bold ${
                            order.status?.toLowerCase().includes("deliver")
                              ? "bg-emerald-100 text-emerald-700"
                              : order.status?.toLowerCase().includes("return") || order.status?.toLowerCase().includes("cancel")
                                ? "bg-amber-100 text-amber-700"
                                : "bg-slate-100 text-slate-700"
                          }`}>
                            {order.status || "Pending"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{order.quantity}</td>
                        <td className="px-4 py-3 text-slate-700">{money(order.amount)}</td>
                        <td className="px-4 py-3 text-red-700 font-semibold">{money(order.payable)}</td>
                        <td className="px-4 py-3 text-emerald-700 font-semibold">{money(order.receivable)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Finance;
