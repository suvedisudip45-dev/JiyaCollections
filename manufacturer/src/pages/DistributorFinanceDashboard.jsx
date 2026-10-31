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
  RotateCw,
} from "lucide-react";
import { backendUrl, useManufacturer, currency } from "../context/ManufacturerContext";

const DistributorFinanceDashboard = () => {
  const { token, manufacturer: distributor } = useManufacturer();
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [withVat, setWithVat] = useState(true);

  const [requestEvidence, setRequestEvidence] = useState({});
  const [busyRequestId, setBusyRequestId] = useState(null);

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
        settlementPosition: remittanceResponse.data.settlementPosition,
        remittances: remittanceResponse.data.remittances || [],
        settlementOffsets: remittanceResponse.data.offsets || [],
        balanceSettlements: remittanceResponse.data.settlements || [],
        settlementRequests: remittanceResponse.data.settlementRequests || [],
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

  const summary = statement?.summary || {};
  const transactions = statement?.transactions || [];
  const cashPosition = statement?.cashPosition || {};
  const settlementPosition = statement?.settlementPosition || {};
  const remittances = statement?.remittances || [];
  const settlementRequests = statement?.settlementRequests || [];

  const submitRequestEvidence = async (event, request) => {
    event.preventDefault();
    const form = requestEvidence[request.id] || {};
    if (!form.transferReference?.trim() || !form.evidenceFile) {
      toast.error("Enter the bank transfer reference and attach the transfer evidence.");
      return;
    }
    const formData = new FormData();
    formData.append("transferReference", form.transferReference.trim());
    formData.append("evidence", form.evidenceFile);
    setBusyRequestId(request.id);
    try {
      const response = await axios.post(
        `${backendUrl}/api/distributor/finance/settlement-requests/${request.id}/evidence`,
        formData,
        { headers: { token } }
      );
      toast.success(response.data.message || "Transfer evidence submitted to Admin.");
      setRequestEvidence((current) => ({ ...current, [request.id]: {} }));
      await loadStatement();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not submit transfer evidence.");
    } finally {
      setBusyRequestId(null);
    }
  };

  const acknowledgePayout = async (request) => {
    setBusyRequestId(request.id);
    try {
      const response = await axios.post(
        `${backendUrl}/api/distributor/finance/settlement-requests/${request.id}/acknowledge`,
        {},
        { headers: { token } }
      );
      toast.success(response.data.message || "Company payout receipt acknowledged.");
      await loadStatement();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not acknowledge payout receipt.");
    } finally {
      setBusyRequestId(null);
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
          <h2 className="text-sm font-bold text-[#171717]">Company balance &amp; settlement</h2>
          <p className="mt-1 max-w-4xl text-[11px] leading-5 text-[#575757]">
            Posted COD and approved earnings, incentives, and refunds are shown as separate gross balances. The net position is the amount due after posted settlements; remittances awaiting Admin review are not treated as paid.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Company payable to you", settlementPosition.outstandingPayable],
            ["Receivable owed to company", settlementPosition.outstandingReceivable],
            [
              Number(settlementPosition.netBalance || 0) > 0 ? "Net you owe company" : "Net company owes you",
              Math.abs(Number(settlementPosition.netBalance || 0)),
            ],
            ["Remittance awaiting Admin review", cashPosition.pendingRemittance],
          ].map(([label, amount]) => (
            <div key={label} className="rounded-xl border border-[#dedbd3] bg-[#f8f7f4] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#575757]">{label}</p>
              <p className="mt-1 text-base font-black text-[#171717]">
                {currency}{Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          ))}
        </div>
        {settlementPosition.unifiedSettlementBlocked && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            <p>
              The net includes {currency}{Number(settlementPosition.excludedLegacyLogisticsPayableTotal || 0).toFixed(2)} in older return/exchange logistics payables,
              but Admin must process these through Accounts Payable before posting a unified settlement.
            </p>
            <ul className="mt-2 space-y-1">
              {(settlementPosition.excludedLegacyLogisticsPayables || []).map((payable) => (
                <li key={payable.id}>{payable.title} · {currency}{Number(payable.remainingBalance || 0).toFixed(2)}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[10px] text-[#575757]">
          Verified customer refunds are included in company payables. Open service earnings, delivery charges, incentives, bonuses, and refund documents are itemized in the statement.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          {[
            ["Open receivable documents", settlementPosition.receivableDocuments],
            ["Open payable documents", settlementPosition.payableDocuments],
          ].map(([label, documents]) => (
            <details key={label} className="rounded-xl border border-[#dedbd3] p-3">
              <summary className="cursor-pointer text-xs font-bold text-[#171717]">{label} ({documents?.length || 0})</summary>
              <div className="mt-2 max-h-56 space-y-2 overflow-auto">
                {(documents || []).map((document) => (
                  <div key={document.id} className="flex justify-between gap-3 border-t border-[#dedbd3] pt-2 text-[10px]">
                    <div>
                      <p className="font-semibold text-[#171717]">{document.documentNumber} · {document.sourceType}</p>
                      <p className="text-[#575757]">{document.sourceId} · {new Date(document.issueDate).toLocaleDateString()}</p>
                    </div>
                    <p className="font-bold text-[#171717]">{currency}{Number(document.remainingAmount || 0).toFixed(2)}</p>
                  </div>
                ))}
                {!documents?.length && <p className="pt-2 text-[10px] text-[#575757]">No open documents.</p>}
              </div>
            </details>
          ))}
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-[#171717]">Settlement requests from Admin</h3>
          <p className="text-[10px] text-[#575757]">
            Transfer only against an Admin-issued request. For collection requests, submit transfer proof for the requested amount. For payouts, review Admin's proof and acknowledge receipt.
          </p>
          {settlementRequests.length ? settlementRequests.map((request) => (
            <article key={request.id} className="space-y-3 rounded-xl border border-[#dedbd3] bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-[#171717]">
                    {request.direction === "COMPANY_COLLECTS" ? "Pay company" : "Receive from company"} · {currency}{Number(request.requestedAmount || 0).toFixed(2)}
                  </p>
                  <p className="mt-1 text-[10px] text-[#575757]">
                    {new Date(request.createdAt).toLocaleString()} · {request.status.replaceAll("_", " ")}
                  </p>
                  {request.requestNotes && <p className="mt-1 text-[10px] text-[#575757]">{request.requestNotes}</p>}
                </div>
                {request.status === "REQUESTED" && request.direction === "COMPANY_COLLECTS" && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">Transfer due</span>
                )}
                {request.status === "EVIDENCE_SUBMITTED" && (
                  <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-800">Awaiting Admin verification</span>
                )}
                {request.status === "REQUESTED" && request.direction === "COMPANY_PAYS" && (
                  <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-800">Awaiting company payout</span>
                )}
                {request.status === "POSTED" && (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800">Transfer verified and posted</span>
                )}
                {request.status === "ACKNOWLEDGED" && (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800">Payout receipt acknowledged</span>
                )}
                {request.status === "REJECTED" && (
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-800">Evidence rejected</span>
                )}
              </div>

              {request.status === "REQUESTED" && request.direction === "COMPANY_COLLECTS" && (
                <form onSubmit={(event) => submitRequestEvidence(event, request)} className="grid gap-2 rounded-lg border border-amber-100 bg-amber-50 p-3 sm:grid-cols-2">
                  <label className="text-[10px] font-semibold text-[#171717]">
                    Bank / wallet transfer reference
                    <input
                      value={requestEvidence[request.id]?.transferReference || ""}
                      onChange={(event) => setRequestEvidence((current) => ({
                        ...current,
                        [request.id]: { ...current[request.id], transferReference: event.target.value },
                      }))}
                      maxLength={191}
                      required
                      className="mt-1 w-full rounded-lg border border-[#dedbd3] bg-white p-2 text-xs"
                    />
                  </label>
                  <label className="text-[10px] font-semibold text-[#171717]">
                    Transfer evidence (JPG/PNG, max 8 MB)
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                      onChange={(event) => setRequestEvidence((current) => ({
                        ...current,
                        [request.id]: { ...current[request.id], evidenceFile: event.target.files?.[0] || null },
                      }))}
                      required
                      className="mt-1 w-full rounded-lg border border-[#dedbd3] bg-white p-2 text-xs"
                    />
                  </label>
                  <button type="submit" disabled={busyRequestId === request.id} className="justify-self-start rounded-lg bg-[#171717] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50 sm:col-span-2">
                    {busyRequestId === request.id ? "Submitting evidence…" : "Submit transfer evidence"}
                  </button>
                </form>
              )}

              {request.direction === "COMPANY_COLLECTS" && request.transferReference && (
                <div className="flex flex-wrap justify-between gap-2 border-t border-[#dedbd3] pt-2 text-[10px] text-[#575757]">
                  <span>Transfer reference: {request.transferReference}</span>
                  {request.evidenceUrl && <a href={request.evidenceUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">View submitted evidence</a>}
                </div>
              )}

              {request.status === "PAYMENT_SENT" && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-100 bg-violet-50 p-3">
                  <div className="text-[10px] text-violet-950">
                    <p>Company transfer reference: <b>{request.transferReference || "—"}</b> · {request.financialAccount?.accountName || "Treasury"}</p>
                    {request.evidenceUrl && <a href={request.evidenceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold text-blue-700 underline">View payout evidence</a>}
                  </div>
                  <button
                    type="button"
                    disabled={busyRequestId === request.id}
                    onClick={() => acknowledgePayout(request)}
                    className="rounded-lg bg-violet-800 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"
                  >
                    {busyRequestId === request.id ? "Acknowledging…" : "Acknowledge receipt"}
                  </button>
                </div>
              )}
              {request.reviewNotes && <p className="text-[10px] text-rose-700">Admin note: {request.reviewNotes}</p>}
            </article>
          )) : <p className="rounded-lg border border-dashed border-[#dedbd3] p-3 text-center text-[11px] text-[#575757]">No open or recent settlement requests.</p>}
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-[#171717]">Historical COD remittance records</h3>
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
          <h3 className="text-xs font-bold text-[#171717]">Unified settlement history</h3>
          <div className="divide-y divide-[#dedbd3] rounded-xl border border-[#dedbd3]">
            {statement?.balanceSettlements?.length ? statement.balanceSettlements.map((settlement) => (
              <div key={settlement.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                <div>
                  <p className="font-bold text-[#171717]">{settlement.direction.replaceAll("_", " ")} · {new Date(settlement.postedAt).toLocaleString()}</p>
                  <p className="mt-1 text-[10px] text-[#575757]">Cash {currency}{Number(settlement.cashAmount || 0).toFixed(2)} · Offset {currency}{Number(settlement.offsetAmount || 0).toFixed(2)} · Ref {settlement.reference || "—"} · Set-off {settlement.setoffAgreementReference || "—"}</p>
                  <p className="mt-1 text-[10px] text-[#575757]">Journal {settlement.journalEntryId || "—"} · {settlement.notes || "No notes"}</p>
                </div>
              </div>
            )) : <p className="p-4 text-center text-[11px] text-[#575757]">No unified settlements are recorded yet.</p>}
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

    </div>
  );
};

export default DistributorFinanceDashboard;
