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
  const [showRemittanceModal, setShowRemittanceModal] = useState(false);
  const [remittanceForm, setRemittanceForm] = useState({
    amount: "",
    reference: "",
    evidenceFile: null,
    idempotencyKey: "",
  });
  const [submittingRemittance, setSubmittingRemittance] = useState(false);

  const loadStatement = useCallback(async () => {
    setLoading(true);
    try {
      const [statementResponse, remittanceResponse] = await Promise.all([
        axios.get(`${backendUrl}/api/distributor/finance/statement`, {
          headers: { token },
          params: { withVat: withVat ? "true" : "false" },
        }),
        axios.get(`${backendUrl}/api/distributor/finance/remittances`, {
          headers: { token },
          params: { limit: 20 },
        }),
      ]);
      setStatement({
        ...statementResponse.data,
        cashPosition: remittanceResponse.data.position,
        remittances: remittanceResponse.data.remittances || [],
        settlementOffsets: remittanceResponse.data.offsets || [],
      });
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
    const availableBalance = Number(summary.netPayableBalance || 0);
    if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(askAmount.trim()) || !Number.isFinite(num) || num <= 0) {
      toast.error("Enter a positive amount with no more than two decimal places.");
      return;
    }
    if (num > availableBalance) {
      toast.error("The requested amount cannot exceed the available net settlement payable.");
      return;
    }
    setSubmittingAsk(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/distributor/finance/ask-settlement`,
        {
          amount: num,
          withVat,
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
  const settlementLineItems = transactions.filter((item) => ["DELIVERY", "RETURN", "EXCHANGE", "BONUS"].includes(item.type));
  const settlementDeliveryCount = settlementLineItems.filter((item) => item.type === "DELIVERY").length;
  const cashPosition = statement?.cashPosition || {};
  const remittances = statement?.remittances || [];

  const openRemittanceModal = () => {
    setRemittanceForm({
      amount: Number(cashPosition.availableToRemit || 0).toFixed(2),
      reference: "",
      evidenceFile: null,
      idempotencyKey: window.crypto.randomUUID(),
    });
    setShowRemittanceModal(true);
  };

  const handleSubmitRemittance = async (event) => {
    event.preventDefault();
    const amount = Number(remittanceForm.amount);
    if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(remittanceForm.amount.trim()) || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a positive remittance amount with no more than two decimal places.");
      return;
    }
    if (amount > Number(cashPosition.availableToRemit || 0)) {
      toast.error("The remittance cannot exceed your available COD receivable.");
      return;
    }
    setSubmittingRemittance(true);
    try {
      const formData = new FormData();
      formData.append("amount", remittanceForm.amount);
      formData.append("reference", remittanceForm.reference);
      formData.append("idempotencyKey", remittanceForm.idempotencyKey);
      formData.append("evidence", remittanceForm.evidenceFile);
      const response = await axios.post(
        `${backendUrl}/api/distributor/finance/remittances`,
        formData,
        { headers: { token } }
      );
      toast.success(response.data.message || "COD remittance submitted for Admin verification.");
      setShowRemittanceModal(false);
      await loadStatement();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not submit COD remittance.");
    } finally {
      setSubmittingRemittance(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & VAT Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#dedbd3] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#171717]">Distributor Financial Dashboard</h1>
          <p className="text-xs text-[#575757] mt-1">
            Admin-set service charges, monthly delivery target bonuses, VAT breakdown, and itemized settlement records.
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
            disabled={Number(summary.netPayableBalance || 0) <= 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#171717] text-white text-xs font-bold rounded-xl hover:bg-[#262626] transition-colors shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
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
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {/* Net Outstanding Balance */}
        <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-[#575757]">
            <span className="text-xs font-bold uppercase tracking-wider">Delivery Settlement Payable</span>
            <Wallet className="w-4 h-4 text-[#171717]" />
          </div>
          <p className="text-2xl font-bold text-[#171717]">
            {currency}
            {(summary.netPayableBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] text-[#575757]">
            Company delivery earnings owed to you; excludes COD and customer-return balances.
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
            + {currency}{(summary.earnedIncentives || 0).toFixed(2)} legacy per-delivery incentives
          </p>
        </div>

        <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-[#575757]">
            <span className="text-xs font-bold uppercase tracking-wider">Monthly target bonus</span>
            <ArrowUpRight className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-[#171717]">
            {currency}{Number(summary.earnedBonuses || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] text-[#575757]">Earned only after a complete monthly period meets admin-set delivery tiers.</p>
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

      {statement?.bonusProgram?.currentPeriod && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-emerald-950">Monthly delivery target progress</h2>
              <p className="mt-1 text-xs text-emerald-900">
                {statement.bonusProgram.currentPeriod.period} · {statement.bonusProgram.currentPeriod.eligibleDeliveryCount} completed deliveries · closes {new Date(statement.bonusProgram.currentPeriod.closesAt).toLocaleDateString()}
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold text-emerald-800">Current month is not yet payable</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {statement.bonusProgram.currentPeriod.tiers.map((tier) => (
              <span key={tier.targetCount} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                statement.bonusProgram.currentPeriod.eligibleDeliveryCount >= tier.targetCount
                  ? "border-emerald-300 bg-white text-emerald-900"
                  : "border-emerald-100 bg-emerald-100/70 text-emerald-800"
              }`}>
                {tier.targetCount} deliveries · +{currency}{Number(tier.bonusAmount).toFixed(2)}
                {statement.bonusProgram.currentPeriod.eligibleDeliveryCount >= tier.targetCount ? " · reached" : ""}
              </span>
            ))}
          </div>
          {statement.bonusProgram.periods.length > 0 && (
            <div className="mt-3 border-t border-emerald-200 pt-3 text-xs text-emerald-950">
              <b>Closed period bonus:</b>{" "}
              {statement.bonusProgram.periods.map((period) => `${period.period}: ${period.eligibleDeliveryCount} deliveries, ${currency}${Number(period.bonusAmount).toFixed(2)}${period.accrued ? " (posted)" : " (eligible)"}`).join(" · ")}
            </div>
          )}
        </section>
      )}

      <section className="space-y-4 rounded-2xl border border-[#dedbd3] bg-[#ffffff] p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-bold text-[#171717]">Customer COD, refunds &amp; settlement</h2>
          <p className="mt-1 max-w-4xl text-[11px] leading-5 text-[#575757]">
            You collect COD and owe it to the company. For an approved return, you pay the customer the Admin-approved refund after charges; the company records that amount as payable to you after verifying your proof. An Admin may explicitly offset eligible balances. Pending remittances are excluded from offset until reviewed.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["COD receivable owed to company", cashPosition.outstandingReceivable],
            ["Remittance awaiting Admin review", cashPosition.pendingRemittance],
            ["Verified refund payable to you", cashPosition.refundPayable],
            ["Eligible for Admin-approved offset", cashPosition.availableToOffset],
          ].map(([label, amount]) => (
            <div key={label} className="rounded-xl border border-[#dedbd3] bg-[#f8f7f4] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#575757]">{label}</p>
              <p className="mt-1 text-base font-black text-[#171717]">
                {currency}{Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          ))}
        </div>
        {Number(cashPosition.availableToRemit || 0) > 0 && (
          <button
            type="button"
            onClick={openRemittanceModal}
            className="flex items-center gap-2 rounded-xl bg-[#171717] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#262626]"
          >
            <Send className="h-3.5 w-3.5" />
            Submit COD remittance
          </button>
        )}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-[#171717]">COD remittance history</h3>
          <div className="divide-y divide-[#dedbd3] rounded-xl border border-[#dedbd3]">
            {remittances.length ? remittances.map((remittance) => (
              <div key={remittance.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                <div>
                  <p className="font-bold text-[#171717]">{currency}{Number(remittance.amount || 0).toFixed(2)} · {remittance.reference || "No reference"}</p>
                  <p className="mt-1 text-[10px] text-[#575757]">{new Date(remittance.receivedAt).toLocaleString()} · {remittance.status}</p>
                  {remittance.reviewNotes && <p className="mt-1 text-[10px] text-rose-700">Admin note: {remittance.reviewNotes}</p>}
                </div>
                {remittance.evidenceUrl && <a href={remittance.evidenceUrl} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-blue-700 underline">View submitted evidence</a>}
              </div>
            )) : <p className="p-4 text-center text-[11px] text-[#575757]">No COD remittances submitted yet.</p>}
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-[#171717]">Admin-approved offsets</h3>
          <div className="divide-y divide-[#dedbd3] rounded-xl border border-[#dedbd3]">
            {statement?.settlementOffsets?.length ? statement.settlementOffsets.map((offset) => (
              <div key={offset.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                <div>
                  <p className="font-bold text-[#171717]">COD receivable and refund payable offset</p>
                  <p className="mt-1 text-[10px] text-[#575757]">{new Date(offset.approvedAt).toLocaleString()} · Approved by Admin</p>
                  {offset.notes && <p className="mt-1 text-[10px] text-[#575757]">{offset.notes}</p>}
                </div>
                <p className="font-black text-[#171717]">{currency}{Number(offset.amount || 0).toFixed(2)}</p>
              </div>
            )) : <p className="p-4 text-center text-[11px] text-[#575757]">No Admin-approved offsets recorded.</p>}
          </div>
        </div>
      </section>

      {/* Active Rate Card Terms */}
      {statement?.rateCard && (
        <div className="p-4 bg-[#ffffff] border border-[#dedbd3] rounded-2xl flex flex-wrap items-center justify-between gap-4 text-xs">
          <div>
            <span className="font-bold text-[#171717]">Active Negotiated Delivery Terms:</span>
            <span className="text-[#575757] ml-2">
              Fee per Delivery: <strong className="text-[#171717]">{currency}{statement.rateCard.deliveryCharge}</strong> •
              Return Fee: <strong className="text-[#171717]">{currency}{statement.rateCard.returnCharge}</strong> •
              Commission Deduction: <strong className="text-[#171717]">{statement.rateCard.commissionRate}%</strong> •
              No per-delivery incentive; monthly bonuses use the completed-delivery target plan shown below.
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
                  <th className="p-3 text-right">Service charge (Rs)</th>
                  <th className="p-3 text-right">Legacy incentive</th>
                  <th className="p-3 text-right">Target bonus</th>
                  <th className="p-3 text-right">Deduction</th>
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
                            : ["RETURN", "EXCHANGE"].includes(tx.type)
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : tx.type === "BONUS"
                              ? "bg-purple-50 text-purple-700 border border-purple-200"
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
                      {tx.type === "DELIVERY" && <p className="text-[10px] text-[#575757]">1 completed delivery · rate {currency}{Number(tx.grossAmount || 0).toFixed(2)} · {tx.isRateSnapshotted ? "rate locked at delivery" : "legacy rate estimate"}</p>}
                      {tx.statementSnapshot?.lineItems?.length > 0 && (
                        <details className="mt-2 text-[10px]">
                          <summary className="cursor-pointer font-semibold text-indigo-700">Settlement breakdown · {tx.statementSnapshot.lineItems.filter((line) => line.type === "DELIVERY").length} deliveries</summary>
                          <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-[#dedbd3]">
                            <table className="w-full text-left">
                              <thead className="sticky top-0 bg-[#f8f7f4]"><tr><th className="p-2">Unit / period</th><th className="p-2 text-right">Delivery</th><th className="p-2 text-right">Incentive</th><th className="p-2 text-right">Bonus</th><th className="p-2 text-right">Deduction</th><th className="p-2 text-right">Net</th></tr></thead>
                              <tbody>{tx.statementSnapshot.lineItems.map((line, index) => (
                                <tr key={`${line.referenceId}-${index}`} className="border-t border-[#dedbd3]">
                                  <td className="p-2">{line.type === "BONUS" ? `${line.referenceId} · ${line.eligibleDeliveryCount} deliveries` : `${line.type} · ${line.referenceId}`}</td>
                                  <td className="p-2 text-right">{Number(line.deliveryCharge || line.returnCharge || line.exchangeCharge || 0).toFixed(2)}</td>
                                  <td className="p-2 text-right">{Number(line.incentiveAmount || 0).toFixed(2)}</td>
                                  <td className="p-2 text-right">{Number(line.bonusAmount || 0).toFixed(2)}</td>
                                  <td className="p-2 text-right">{Number(line.commissionDeduction || 0).toFixed(2)}</td>
                                  <td className="p-2 text-right font-semibold">{Number(line.netAmount || 0).toFixed(2)}</td>
                                </tr>
                              ))}</tbody>
                            </table>
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="p-3 text-right font-medium text-[#171717]">
                      {["DELIVERY", "RETURN", "EXCHANGE"].includes(tx.type) ? `+${Number(tx.grossAmount || 0).toFixed(2)}` : "—"}
                    </td>
                    <td className="p-3 text-right text-emerald-700 font-semibold">
                      {tx.incentiveAmount > 0 ? `+${tx.incentiveAmount.toFixed(2)}` : "—"}
                    </td>
                    <td className="p-3 text-right text-purple-700 font-semibold">
                      {Number(tx.bonusAmount || 0) > 0 ? `+${Number(tx.bonusAmount).toFixed(2)}` : "—"}
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
                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[#dedbd3] pt-2 text-[10px] text-[#575757] sm:grid-cols-4">
                  <span>{settlementDeliveryCount} completed deliveries</span>
                  <span>Delivery: {currency}{Number(summary.grossDeliveryEarnings || 0).toFixed(2)}</span>
                  <span>Incentive: {currency}{Number(summary.earnedIncentives || 0).toFixed(2)}</span>
                  <span>Target bonus: {currency}{Number(summary.earnedBonuses || 0).toFixed(2)}</span>
                </div>
                <details className="mt-2 text-[10px]">
                  <summary className="cursor-pointer font-semibold text-indigo-700">Review delivery-by-delivery statement</summary>
                  <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-[#dedbd3] bg-white">
                    {settlementLineItems.map((item) => (
                      <div key={item.id} className="flex justify-between gap-2 border-b border-[#dedbd3] px-2 py-1.5 last:border-0">
                        <span>{item.type} · {item.referenceId} {item.eligibleDeliveryCount ? `· ${item.eligibleDeliveryCount} deliveries` : ""}</span>
                        <b>{currency}{Number(item.netAmount || 0).toFixed(2)}</b>
                      </div>
                    ))}
                  </div>
                </details>
              </div>

              <div>
                <label className="block font-bold text-[#171717] mb-1">Requested Settlement Amount (Rs)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={summary.netPayableBalance || 0}
                  value={askAmount}
                  onChange={(e) => setAskAmount(e.target.value)}
                  placeholder="e.g., 5000"
                  className="w-full p-2.5 border border-[#dedbd3] rounded-xl text-sm font-bold focus:outline-none focus:border-[#171717]"
                  required
                />
                <p className="mt-1 text-[10px] text-[#575757]">
                  Requesting {withVat ? "with VAT" : "without VAT"}; pending requests reduce the available balance.
                </p>
              </div>

              <div>
                <label className="block font-bold text-[#171717] mb-1">Notes / Bank Details</label>
                <textarea
                  value={askNotes}
                  onChange={(e) => setAskNotes(e.target.value)}
                  maxLength={1000}
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
                  disabled={submittingAsk || Number(summary.netPayableBalance || 0) <= 0}
                  className="px-5 py-2 bg-[#171717] text-white font-bold rounded-xl hover:bg-[#262626] transition-colors disabled:opacity-50"
                >
                  {submittingAsk ? "Submitting..." : "Submit Payout Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRemittanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <form onSubmit={handleSubmitRemittance} className="w-full max-w-md space-y-4 overflow-hidden rounded-2xl border border-[#dedbd3] bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#dedbd3] bg-[#f8f7f4] px-5 py-4">
              <div>
                <h3 className="text-sm font-bold text-[#171717]">Submit COD remittance</h3>
                <p className="mt-1 text-[10px] text-[#575757]">Available to remit: {currency}{Number(cashPosition.availableToRemit || 0).toFixed(2)}</p>
              </div>
              <button type="button" onClick={() => setShowRemittanceModal(false)} className="rounded-lg p-1 text-[#575757]" aria-label="Close remittance form"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 px-5 pb-2 text-xs">
              <label className="block">
                <span className="mb-1 block font-bold text-[#171717]">Amount</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={cashPosition.availableToRemit || 0}
                  value={remittanceForm.amount}
                  onChange={(event) => setRemittanceForm((current) => ({ ...current, amount: event.target.value }))}
                  className="w-full rounded-lg border border-[#dedbd3] p-2.5"
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-bold text-[#171717]">Bank / wallet transfer reference</span>
                <input
                  value={remittanceForm.reference}
                  onChange={(event) => setRemittanceForm((current) => ({ ...current, reference: event.target.value }))}
                  maxLength={191}
                  required
                  className="w-full rounded-lg border border-[#dedbd3] p-2.5"
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-bold text-[#171717]">Transfer evidence image (JPG or PNG, max 8 MB)</span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                  onChange={(event) => setRemittanceForm((current) => ({ ...current, evidenceFile: event.target.files?.[0] || null }))}
                  required
                  className="w-full rounded-lg border border-[#dedbd3] p-2.5 file:mr-3 file:rounded-md file:border-0 file:bg-[#f1f0ec] file:px-3 file:py-1.5 file:text-[10px] file:font-semibold"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#dedbd3] px-5 py-4">
              <button type="button" onClick={() => setShowRemittanceModal(false)} className="rounded-lg border border-[#dedbd3] px-3 py-2 text-[#575757]">Cancel</button>
              <button type="submit" disabled={submittingRemittance} className="rounded-lg bg-[#171717] px-4 py-2 font-bold text-white disabled:opacity-50">{submittingRemittance ? "Submitting..." : "Submit for Admin review"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default DistributorFinanceDashboard;
