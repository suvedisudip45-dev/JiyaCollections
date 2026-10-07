import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Wallet,
  ArrowDownRight,
  ArrowUpRight,
  Percent,
  Receipt,
  FileCheck,
  Send,
  RotateCw,
  X,
  CreditCard,
  Building,
} from "lucide-react";
import { backendUrl, useManufacturer, currency } from "../context/ManufacturerContext";

const DistributorFinanceDashboard = () => {
  const { token, manufacturer: distributor } = useManufacturer();
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [withVat, setWithVat] = useState(true);

  // Settlement Request Modal
  const [showAskModal, setShowAskModal] = useState(false);
  const [askAmount, setAskAmount] = useState("");
  const [askNotes, setAskNotes] = useState("");
  const [submittingAsk, setSubmittingAsk] = useState(false);

  const loadStatement = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(
        `${backendUrl}/api/distributor/finance/statement`,
        {
          headers: { token },
          params: { withVat: withVat ? "true" : "false" },
        }
      );
      setStatement(response.data);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not load financial statement.");
    } finally {
      setLoading(false);
    }
  }, [token, withVat]);

  useEffect(() => {
    loadStatement();
  }, [loadStatement]);

  const handleAskSettlement = async (e) => {
    e.preventDefault();
    const num = Number(askAmount);
    if (!num || num <= 0) {
      toast.error("Please enter a valid positive payout amount.");
      return;
    }
    setSubmittingAsk(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/distributor/finance/ask-settlement`,
        {
          amount: num,
          notes: askNotes.trim() || undefined,
        },
        { headers: { token } }
      );
      toast.success(response.data.message || "Settlement request submitted to Admin.");
      setShowAskModal(false);
      setAskAmount("");
      setAskNotes("");
      await loadStatement();
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to submit settlement request.");
    } finally {
      setSubmittingAsk(false);
    }
  };

  const summary = statement?.summary || {};
  const transactions = statement?.transactions || [];

  return (
    <div className="space-y-6">
      {/* Header & VAT Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#dedbd3] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#171717]">Distributor Financial Dashboard</h1>
          <p className="text-xs text-[#575757] mt-1">
            Real-time delivery earnings, earned incentives, VAT breakdown, and settlement ledger.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* VAT Toggle Switch */}
          <div className="flex items-center gap-1.5 p-1 bg-[#ffffff] border border-[#dedbd3] rounded-xl text-xs">
            <button
              onClick={() => setWithVat(true)}
              className={`px-3 py-1 font-bold rounded-lg transition-all ${
                withVat ? "bg-[#171717] text-white shadow-xs" : "text-[#575757] hover:text-[#171717]"
              }`}
            >
              With VAT (13%)
            </button>
            <button
              onClick={() => setWithVat(false)}
              className={`px-3 py-1 font-bold rounded-lg transition-all ${
                !withVat ? "bg-[#171717] text-white shadow-xs" : "text-[#575757] hover:text-[#171717]"
              }`}
            >
              Without VAT
            </button>
          </div>

          <button
            onClick={() => setShowAskModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#171717] text-white text-xs font-bold rounded-xl hover:bg-[#262626] transition-colors shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            Ask for Settlement
          </button>

          <button
            onClick={loadStatement}
            className="p-2 text-[#575757] hover:text-[#171717] bg-[#ffffff] border border-[#dedbd3] rounded-xl"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Net Outstanding Balance */}
        <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-[#575757]">
            <span className="text-xs font-bold uppercase tracking-wider">Net Settlement Payable</span>
            <Wallet className="w-4 h-4 text-[#171717]" />
          </div>
          <p className="text-2xl font-bold text-[#171717]">
            {currency}
            {(summary.netPayableBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] text-[#575757]">
            Available for immediate settlement withdrawal
          </p>
        </div>

        {/* Gross Delivery Earnings */}
        <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-[#575757]">
            <span className="text-xs font-bold uppercase tracking-wider">Gross Delivery Earnings</span>
            <ArrowUpRight className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-[#171717]">
            {currency}
            {(summary.grossDeliveryEarnings || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] text-[#575757]">
            + {currency}{(summary.earnedIncentives || 0).toFixed(2)} bonuses &amp; incentives
          </p>
        </div>

        {/* VAT Component */}
        <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-[#575757]">
            <span className="text-xs font-bold uppercase tracking-wider">VAT (13%)</span>
            <Percent className="w-4 h-4 text-[#171717]" />
          </div>
          <p className="text-2xl font-bold text-[#171717]">
            {currency}
            {(summary.vatAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] text-[#575757]">
            Subtotal: {currency}{(summary.subtotalBeforeVat || 0).toFixed(2)}
          </p>
        </div>

        {/* Settled / Paid Out */}
        <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-[#575757]">
            <span className="text-xs font-bold uppercase tracking-wider">Total Disbursed</span>
            <FileCheck className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-2xl font-bold text-[#171717]">
            {currency}
            {(summary.totalSettledPaid || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] text-[#575757]">
            Pending in queue: {currency}{(summary.pendingSettlementAmount || 0).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Active Rate Card Terms */}
      {statement?.rateCard && (
        <div className="p-4 bg-[#ffffff] border border-[#dedbd3] rounded-2xl flex flex-wrap items-center justify-between gap-4 text-xs">
          <div>
            <span className="font-bold text-[#171717]">Active Negotiated Delivery Terms:</span>
            <span className="text-[#575757] ml-2">
              Fee per Delivery: <strong className="text-[#171717]">{currency}{statement.rateCard.deliveryCharge}</strong> •
              Return Fee: <strong className="text-[#171717]">{currency}{statement.rateCard.returnCharge}</strong> •
              Commission Deduction: <strong className="text-[#171717]">{statement.rateCard.commissionRate}%</strong> •
              Performance Bonus: <strong className="text-emerald-700">+{currency}{statement.rateCard.bonusRate}</strong>
            </span>
          </div>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Approved Rate Card
          </span>
        </div>
      )}

      {/* Itemized Transactions Table */}
      <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-[#dedbd3] flex items-center justify-between bg-[#f8f7f4]">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#171717]">Itemized Transaction Ledger</h2>
          <span className="text-[11px] text-[#575757]">{transactions.length} record(s)</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-[#575757]">Loading financial records...</div>
        ) : !transactions.length ? (
          <div className="p-8 text-center text-xs text-[#575757]">No transactions recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#f8f7f4] border-b border-[#dedbd3] text-[#575757] font-semibold">
                <tr>
                  <th className="p-3">Type</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Reference &amp; Description</th>
                  <th className="p-3 text-right">Gross (Rs)</th>
                  <th className="p-3 text-right">Incentive</th>
                  <th className="p-3 text-right">Commission/Deduction</th>
                  <th className="p-3 text-right">Net Credit (Rs)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#dedbd3]">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-[#f8f7f4]/60">
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                          tx.type === "DELIVERY"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : tx.type === "RETURN"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-blue-50 text-blue-700 border border-blue-200"
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="p-3 text-[#575757]">
                      {tx.date ? new Date(tx.date).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-3">
                      <p className="font-semibold text-[#171717]">{tx.description}</p>
                      <p className="text-[10px] text-[#575757]">Ref: #{tx.referenceId?.slice(0, 10)}</p>
                    </td>
                    <td className="p-3 text-right font-medium text-[#171717]">
                      {tx.grossAmount > 0 ? `+${tx.grossAmount.toFixed(2)}` : tx.grossAmount.toFixed(2)}
                    </td>
                    <td className="p-3 text-right text-emerald-700 font-semibold">
                      {tx.incentiveAmount > 0 ? `+${tx.incentiveAmount.toFixed(2)}` : "—"}
                    </td>
                    <td className="p-3 text-right text-rose-600 font-medium">
                      {tx.discountChargeAmount > 0 ? `-${tx.discountChargeAmount.toFixed(2)}` : "—"}
                    </td>
                    <td className="p-3 text-right font-bold text-[#171717]">
                      {tx.netAmount > 0 ? `+${tx.netAmount.toFixed(2)}` : tx.netAmount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ask Settlement Modal */}
      {showAskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#dedbd3] bg-[#f8f7f4]">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-[#171717]" />
                <h3 className="text-sm font-bold text-[#171717]">Request Payout Settlement</h3>
              </div>
              <button onClick={() => setShowAskModal(false)} className="text-[#575757] p-1">
                ✕
              </button>
            </div>

            <form onSubmit={handleAskSettlement} className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-[#f8f7f4] rounded-xl border border-[#dedbd3]">
                <span className="text-[11px] text-[#575757]">Available Net Settlement Balance:</span>
                <p className="text-lg font-bold text-[#171717]">
                  {currency}{(summary.netPayableBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>

              <div>
                <label className="block font-bold text-[#171717] mb-1">Requested Settlement Amount (Rs)</label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  max={summary.netPayableBalance || 0}
                  value={askAmount}
                  onChange={(e) => setAskAmount(e.target.value)}
                  placeholder="e.g., 5000"
                  className="w-full p-2.5 border border-[#dedbd3] rounded-xl text-sm font-bold focus:outline-none focus:border-[#171717]"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-[#171717] mb-1">Notes / Bank Details</label>
                <textarea
                  value={askNotes}
                  onChange={(e) => setAskNotes(e.target.value)}
                  placeholder="e.g., Nabil Bank A/C #0234017500000, Branch: Kathmandu"
                  className="w-full p-2.5 border border-[#dedbd3] rounded-xl text-xs focus:outline-none focus:border-[#171717] resize-none h-16"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#dedbd3]">
                <button
                  type="button"
                  onClick={() => setShowAskModal(false)}
                  className="px-4 py-2 border border-[#dedbd3] rounded-xl text-[#575757]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAsk}
                  className="px-5 py-2 bg-[#171717] text-white font-bold rounded-xl hover:bg-[#262626] transition-colors disabled:opacity-50"
                >
                  {submittingAsk ? "Submitting..." : "Submit Payout Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DistributorFinanceDashboard;
