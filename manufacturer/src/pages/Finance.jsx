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
  const { token, backendUrl } = useManufacturer();
  const [range, setRange] = useState("month");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [settlementPage, setSettlementPage] = useState(1);
  const [settlementHistory, setSettlementHistory] = useState([]);
  const [settlementPagination, setSettlementPagination] = useState(null);
  const [settlementLoading, setSettlementLoading] = useState(true);
  const [settlementError, setSettlementError] = useState("");

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
        }
      } catch (error) {
        console.error("Failed to load manufacturer finance summary", error);
      } finally {
        setLoading(false);
      }
    };

    loadSummary();
  }, [backendUrl, range, token]);

  useEffect(() => {
    const loadSettlementHistory = async () => {
      if (!token) return;
      setSettlementLoading(true);
      setSettlementError("");
      try {
        const response = await axios.get(`${backendUrl}/api/manufacturer/finance/settlement-requests`, {
          headers: { token },
          params: { page: settlementPage, limit: 10 },
        });
        setSettlementHistory(response.data?.settlements || []);
        setSettlementPagination(response.data?.pagination || null);
      } catch (error) {
        setSettlementError(error.response?.data?.message || "Unable to load settlement history.");
      } finally {
        setSettlementLoading(false);
      }
    };

    loadSettlementHistory();
  }, [backendUrl, settlementPage, token]);

  const summary = data?.summary || {};
  const orders = data?.orders || [];
  const transactions = data?.transactions || [];
  const netOwed = Number(summary.remainingPayable ?? summary.payable ?? 0)
    - Number(summary.remainingReceivable ?? summary.receivable ?? 0);

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
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Approved COGS Earned</p>
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <p className="mt-3 text-2xl font-black text-slate-900">{money(summary.receivable || 0)}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                COGS earned · Remaining this period: {money(summary.remainingReceivable ?? summary.receivable ?? 0)}
              </p>
            </div>

            <div className="bg-white border border-red-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-red-500 font-bold">Direct Sales Due to Platform</p>
                <Wallet className="w-4 h-4 text-red-500" />
              </div>
              <p className="mt-3 text-2xl font-black text-red-700">{money(summary.payable || 0)}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Received this period: {money(summary.collectedAmount || 0)} · Remaining this period: {money(summary.remainingPayable ?? summary.payable ?? 0)}
              </p>
            </div>

            <div className="bg-white border border-blue-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-blue-500 font-bold">Net Settlement Position</p>
                <PackageCheck className="w-4 h-4 text-blue-500" />
              </div>
              <p className={`mt-3 text-2xl font-black ${netOwed >= 0 ? "text-amber-700" : "text-blue-700"}`}>
                {money(Math.abs(netOwed))}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {netOwed >= 0 ? "⚠️ Net payable owed to platform" : "✅ Net receivable owed to you"}
              </p>
            </div>

            <div className="bg-white border border-emerald-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-emerald-500 font-bold">Payouts Received This Period</p>
                <FileText className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="mt-3 text-2xl font-black text-emerald-700">{money(summary.paidAmount || 0)}</p>
              <p className="mt-1 text-[11px] text-slate-500">{transactions.length} settlement transaction(s)</p>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
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
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Order</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Qty</th>
                    <th className="px-4 py-3 font-semibold">Direct sales</th>
                    <th className="px-4 py-3 font-semibold">Payable to admin</th>
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
                        <td className="px-4 py-3 text-slate-700">{order.amount != null ? money(order.amount) : "—"}</td>
                        <td className="px-4 py-3 text-red-700 font-semibold">{money(order.payable)}</td>
                        <td className="px-4 py-3 text-emerald-700 font-semibold">{money(order.receivable)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Settlement & Payout Transactions Table (Summary view) */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <span className="text-base">💳</span>
                <h2 className="text-sm font-bold text-slate-900">Settlement &amp; Payout Transactions</h2>
              </div>
              <span className="text-[11px] font-semibold text-slate-500">
                {transactions.length} record{transactions.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Date &amp; Time</th>
                    <th className="px-4 py-3 font-semibold">Transaction ID</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Account / Channel</th>
                    <th className="px-4 py-3 font-semibold text-right">Net Amount Paid</th>
                    <th className="px-4 py-3 font-semibold text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="px-4 py-8 text-center text-slate-400">
                        No settlement or payout transactions recorded yet.
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50/80 transition">
                        <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                          {new Date(tx.date || tx.createdAt).toLocaleDateString("en-NP", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 text-[11px]">
                          {tx.id.slice(0, 10)}...
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              tx.type === "OUTFLOW"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-blue-100 text-blue-700"
                            }`}
                          >
                            {tx.type === "OUTFLOW" ? "Payout Received" : "Direct Margin Settled"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <span className="font-semibold text-slate-800">{tx.accountName || "Treasury Account"}</span>
                          {tx.description ? (
                            <p className="text-[10px] text-slate-400 truncate max-w-xs mt-0.5">{tx.description}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right font-black whitespace-nowrap">
                          <span className={tx.type === "OUTFLOW" ? "text-emerald-700" : "text-blue-700"}>
                            {tx.type === "OUTFLOW" ? "+" : "-"} {money(tx.amount)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                            SETTLED
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-800">Settlement request history</h2>
              <p className="mt-1 text-[11px] text-slate-500">Each request shows the amount requested, paid so far, and the remaining amount.</p>
            </div>
            {settlementLoading ? (
              <p className="p-6 text-center text-sm text-slate-500">Loading settlement history…</p>
            ) : settlementError ? (
              <p role="alert" className="p-6 text-center text-sm text-rose-700">{settlementError}</p>
            ) : settlementHistory.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-500">No settlement requests have been submitted.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Requested</th>
                        <th className="px-4 py-3 font-semibold">Type</th>
                        <th className="px-4 py-3 font-semibold text-right">Requested amount</th>
                        <th className="px-4 py-3 font-semibold text-right">Paid</th>
                        <th className="px-4 py-3 font-semibold text-right">Remaining</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Reference / notes</th>
                        <th className="px-4 py-3 font-semibold">Payout trail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {settlementHistory.map((settlement) => {
                        const remaining = Math.max(0, Number(settlement.amount || 0) - Number(settlement.paidAmount || 0));
                        const statusClass = settlement.status === "PAID"
                          ? "bg-emerald-50 text-emerald-700"
                          : settlement.status === "PARTIALLY_PAID"
                            ? "bg-blue-50 text-blue-700"
                            : settlement.status === "REJECTED"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-amber-50 text-amber-700";
                        return (
                          <tr key={settlement.id}>
                            <td className="px-4 py-3 whitespace-nowrap">{new Date(settlement.requestedAt).toLocaleDateString("en-NP")}</td>
                            <td className="px-4 py-3">{settlement.requestType}</td>
                            <td className="px-4 py-3 text-right">{money(settlement.amount)}</td>
                            <td className="px-4 py-3 text-right">{money(settlement.paidAmount)}</td>
                            <td className="px-4 py-3 text-right font-semibold">{money(remaining)}</td>
                            <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusClass}`}>{settlement.status.replaceAll("_", " ")}</span></td>
                            <td className="px-4 py-3 text-slate-600">{settlement.externalPaymentReference || settlement.notes || "—"}</td>
                            <td className="px-4 py-3">
                              {settlement.payoutHistory?.length ? (
                                <details className="min-w-52">
                                  <summary className="cursor-pointer font-semibold text-indigo-700">{settlement.payoutHistory.length} payout attempt(s)</summary>
                                  <div className="mt-2 space-y-2">
                                    {settlement.payoutHistory.map((payout) => (
                                      <div key={payout.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[10px]">
                                        <p className="font-bold">{payout.status.replaceAll("_", " ")} · {money(payout.amount)} · {new Date(payout.settledAt || payout.initiatedAt).toLocaleString("en-NP")}</p>
                                        <p>Account: {payout.financialAccount?.accountName || "—"}</p>
                                        <p>Transfer reference: {payout.externalPaymentReference || "—"} · Evidence reference: {payout.bankEvidenceReference || "—"}</p>
                                        <p>Cash transaction: {payout.cashTransaction?.id || "Not posted"} · Journal: {payout.journalEntry?.journalNumber || "Not posted"}</p>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              ) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
                  <span>{settlementPagination?.total || 0} request(s)</span>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={settlementPage <= 1 || settlementLoading} onClick={() => setSettlementPage((page) => page - 1)} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40">Previous</button>
                    <span>Page {settlementPagination?.page || settlementPage} of {Math.max(1, settlementPagination?.totalPages || 0)}</span>
                    <button type="button" disabled={!settlementPagination?.hasNextPage || settlementLoading} onClick={() => setSettlementPage((page) => page + 1)} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40">Next</button>
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default Finance;
