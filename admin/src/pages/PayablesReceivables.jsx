/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";
import { usePermissions } from "../auth/PermissionsContext";
import {
  addDecimalStrings,
  compareDecimalStrings,
  formatNprAmount,
  maxZeroDecimalString,
  minDecimalStrings,
  roundedPercentFromDecimalStrings,
  subtractDecimalStrings,
} from "../utils/decimalDisplay";

const fmt = (value) => `${currency}${formatNprAmount(value || "0")}`;
const fmtBalance = fmt;
const settlementAmountAfterAdjustment = (amount, type, adjustment) => {
  const cash = String(amount || "0");
  const adjustmentValue = String(adjustment || "0");
  if (type === "DISCOUNT") return addDecimalStrings(cash, adjustmentValue);
  if (type === "FINE") return subtractDecimalStrings(cash, adjustmentValue);
  return cash;
};
const adjustedCashDue = (balance, type, amount) => {
  try {
    const value = String(balance || "0");
    const adjustment = String(amount || "0");
    if (type === "FINE") return addDecimalStrings(value, adjustment);
    if (type === "DISCOUNT") return subtractDecimalStrings(value, adjustment);
    return value;
  } catch {
    return null;
  }
};
const isPositiveDecimal = (value) => {
  try {
    return compareDecimalStrings(String(value || "0"), "0") > 0;
  } catch {
    return false;
  }
};
const settlementPreview = (amount, type, adjustment) => {
  try {
    return fmt(settlementAmountAfterAdjustment(amount, type, adjustment));
  } catch {
    return `${currency}—`;
  }
};
const formatDate = (d) => { if (!d) return "—"; return new Date(d).toLocaleDateString("en-NP", { year: "numeric", month: "short", day: "numeric" }); };
const isOverdue = (dueDate) => { if (!dueDate) return false; return new Date(dueDate) < new Date(); };
const getStableIdempotencyKey = (ref, prefix, request) => {
  const signature = JSON.stringify(request);
  if (ref.current?.signature !== signature) {
    ref.current = { signature, key: `${prefix}-${crypto.randomUUID()}` };
  }
  return ref.current.key;
};

const PAYABLE_CATS = [
  { value: "MANUFACTURER_COGS", label: "Manufacturer COGS Obligation" },
  { value: "ASSET_PURCHASE", label: "Asset Purchase" },
  { value: "PARTNER_DISTRIBUTION", label: "Partner Distribution / Payout" },
  { value: "DISTRIBUTOR_SETTLEMENT", label: "Distributor Settlement" },
  { value: "TAX_DUE", label: "Tax / VAT Due" },
  { value: "LOAN_NOTE", label: "Loan Repayment Note" },
  { value: "OTHER", label: "Other Liability" },
];
const RECEIVABLE_CATS = [
  { value: "CUSTOMER_RECEIVABLE", label: "Customer Due / Direct Sale Margin" },
  { value: "CARRIER_COD_RECEIVABLE", label: "Courier COD Remittance (Nepal Can Move)" },
  { value: "DIRECT_SALES_COMMISSION", label: "Manufacturer Direct Sale Margin" },
  { value: "SUPPLIER_DEBIT_REFUND", label: "Supplier Credit / Refund" },
  { value: "TAX_REFUND_CREDIT", label: "Tax Refund / Credit Note" },
  { value: "LOAN_RECEIVABLE", label: "Loan Given Out" },
  { value: "ADVANCE_PAYMENT", label: "Advance Given to Employee" },
  { value: "OTHER", label: "Other Receivable" },
];
const LABEL_MAP = {
  SUPPLIER_INVOICE:"Supplier / Manufacturer COGS",MANUFACTURER_COGS:"Manufacturer COGS",
  OPERATING_EXPENSE:"Operating Expense",SALARY_PAYABLE:"Salary Payable",
  SALARIES:"Salaries",ASSET_PURCHASE:"Asset Purchase",PARTNER_DISTRIBUTION:"Partner Payout",
  MARKETING_CPA:"Marketing CPA Payable",
  DISTRIBUTOR_SETTLEMENT:"Distributor Settlement",
  TAX_DUE:"Tax Due",LOAN_NOTE:"Loan Note",RENT:"Rent Payable",UTILITIES:"Utilities",OTHER:"Other",
  CUSTOMER_RECEIVABLE:"Customer Due",CARRIER_COD_RECEIVABLE:"NCM Courier COD",
  DIRECT_SALES_COMMISSION:"Direct Sale Margin",SUPPLIER_DEBIT_REFUND:"Supplier Credit",
  TAX_REFUND_CREDIT:"Tax Credit",LOAN_RECEIVABLE:"Loan Given",ADVANCE_PAYMENT:"Advance Given",
};
const ICON_MAP = {
  SALARY_PAYABLE:"👷",SALARIES:"👷",SUPPLIER_INVOICE:"🏭",MANUFACTURER_COGS:"🏭",
  OPERATING_EXPENSE:"⚙️",ASSET_PURCHASE:"🏢",PARTNER_DISTRIBUTION:"🤝",
  MARKETING_CPA:"📣",
  DISTRIBUTOR_SETTLEMENT:"🚚",
  TAX_DUE:"🏛️",LOAN_NOTE:"🏦",RENT:"🏠",UTILITIES:"⚡",OTHER:"📋",
  CUSTOMER_RECEIVABLE:"🛍️",CARRIER_COD_RECEIVABLE:"🚚",DIRECT_SALES_COMMISSION:"🏭",
  SUPPLIER_DEBIT_REFUND:"↩️",TAX_REFUND_CREDIT:"💰",LOAN_RECEIVABLE:"💳",ADVANCE_PAYMENT:"👤",
};

const StatusBadge = ({ status }) => {
  const m = { UNPAID:"bg-red-100 text-red-700",PARTIALLY_PAID:"bg-amber-100 text-amber-700",PARTIALLY_RECEIVED:"bg-amber-100 text-amber-700",SETTLED:"bg-emerald-100 text-emerald-700",CANCELLED:"bg-slate-100 text-slate-500" };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border border-transparent ${m[status]||"bg-slate-100 text-slate-500"}`}>{status?.replace(/_/g," ")}</span>;
};
StatusBadge.propTypes = { status: PropTypes.string.isRequired };

const PriorityBadge = ({ priority }) => {
  if (!priority) return null;
  const m = { LOW:"bg-slate-100 text-slate-500",MEDIUM:"bg-blue-100 text-blue-700",HIGH:"bg-orange-100 text-orange-700",URGENT:"bg-red-100 text-red-700 animate-pulse" };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${m[priority]||"bg-slate-100 text-slate-500"}`}>{priority}</span>;
};
PriorityBadge.propTypes = { priority: PropTypes.string };

const SettlementHistory = ({
  history,
  label="History",
  canCorrectReceipt,
  onCorrectReceipt,
  settlementReversions=[],
}) => {
  const rows = Array.isArray(history)?history:(()=>{try{return JSON.parse(history||"[]");}catch{return [];}})();
  if (!rows.length) return null;
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      {rows.map(h=>{
        const reversal = h.receiptId
          ? settlementReversions.find((entry) => entry.reversionType === "CUSTOMER_RECEIPT" && entry.originalRecordId === h.receiptId)
          : null;
        const canReverse = h.category === "RECEIVABLE_COLLECTION" && canCorrectReceipt?.(h) && !reversal;
        return (
          <div key={`${h.id}-${h.invoiceId||""}`} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-2.5 py-1.5 text-[11px] mb-0.5">
            <span className="min-w-0 text-slate-600"><b>{h.accountName}</b><span className="text-slate-400 ml-1">{formatDate(h.date)}</span>{h.tenderMethod?<span className="text-slate-500 ml-1">• {h.tenderMethod.replaceAll("_"," ")}</span>:null}{isPositiveDecimal(h.adjustmentAmount)?<span className="text-slate-500 ml-1">• {h.adjustmentType?.toLowerCase()} {fmt(h.adjustmentAmount)}</span>:null}{h.externalPaymentReference?<span className="text-slate-500 ml-1">• Evidence: {h.externalPaymentReference}</span>:null}{h.notes?<span className="text-slate-400 ml-1">• {h.notes}</span>:null}{reversal&&<span className="block text-[10px] text-amber-700">↩ Reversed {formatDate(reversal.revertedAt)} — {reversal.revertReason}</span>}</span>
            <span className="shrink-0 text-right font-bold text-slate-900">{fmt(h.amount)}{h.cashReceivedAmount&&h.cashReceivedAmount!==h.amount&&<span className="block text-[9px] font-medium text-slate-500">receipt {fmt(h.cashReceivedAmount)}</span>}</span>
            {canReverse&&<button type="button" onClick={()=>onCorrectReceipt?.(h)} className="shrink-0 px-2 py-1 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-lg hover:bg-amber-200 border border-amber-300 whitespace-nowrap">↩ Correct receipt</button>}
          </div>
        );
      })}
    </div>
  );
};
SettlementHistory.propTypes = {
  history: PropTypes.oneOfType([PropTypes.array, PropTypes.string]),
  label: PropTypes.string,
  canCorrectReceipt: PropTypes.func,
  onCorrectReceipt: PropTypes.func,
  settlementReversions: PropTypes.arrayOf(PropTypes.object),
};

const AccountSelector = ({ accounts, value, onChange, label, helpText, forPayment }) => {
  const isCash = a => a.accountType==="CASH"||a.accountName?.toLowerCase().includes("cash");
  const isBank = a => !isCash(a)&&(a.accountType==="BANK"||["bank","esewa","khalti","fonepay"].some(k=>a.accountName?.toLowerCase().includes(k)));
  const cash  = accounts.filter(isCash);
  const banks = accounts.filter(isBank);
  const other = accounts.filter(a=>!isCash(a)&&!isBank(a));
  const grp = (items, gl) => items.length>0&&(
    <div className="mb-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{gl}</p>
      <div className="space-y-1.5">
        {items.map(a=>{
          const active=value===a.id;
          const low=forPayment&&a.currentBalance<=0;
          return(
            <label key={a.id} className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all ${active?"border-slate-900 bg-slate-900":"border-slate-200 bg-slate-50 hover:border-slate-400"}`}>
              <div className="flex items-center gap-2">
                <input type="radio" name="acctSel" value={a.id} checked={active} onChange={()=>onChange(a.id)}/>
                <div>
                  <p className={`text-xs font-semibold ${active?"text-white":"text-slate-800"}`}>{a.accountName}</p>
                  <p className={`text-[10px] ${active?"text-slate-300":"text-slate-400"}`}>{a.accountType||"Account"}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-xs font-bold ${active?"text-white":low?"text-red-600":"text-emerald-700"}`}>{fmt(a.currentBalance)}</p>
                <p className={`text-[10px] ${active?"text-slate-300":"text-slate-400"}`}>available</p>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      {helpText&&<p className="text-[10px] text-slate-400 mb-2">{helpText}</p>}
      {grp(cash,"💵 Cash in Hand")}
      {grp(banks,"🏦 Bank / Digital Wallet")}
      {grp(other,"📂 Other Accounts")}
      {accounts.length===0&&<div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">⚠️ No treasury accounts found. Create a Cash or Bank account in Treasury first.</div>}
    </div>
  );
};
AccountSelector.propTypes = {
  accounts: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    accountName: PropTypes.string,
    accountType: PropTypes.string,
    currentBalance: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  })).isRequired,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string.isRequired,
  helpText: PropTypes.string,
  forPayment: PropTypes.bool,
};

const PayablesReceivables = ({ token }) => {
  const { can } = usePermissions();
  const canCreatePayable = can("finance:payable_create");
  const canSettlePayable = can("finance:payable_settle");
  const canCreateReceivable = can("finance:receivable_create");
  const canCollectReceivable = can("finance:receivable_collect");
  const [data, setData]     = useState(null);
  const [initiatedPayouts, setInitiatedPayouts] = useState([]);
  const [payoutEvidence, setPayoutEvidence] = useState({});
  const [payoutFailureReasons, setPayoutFailureReasons] = useState({});
  const [mfgSummary, setMfgSummary] = useState(null);
  const [distributorPositions, setDistributorPositions] = useState([]);
  const [distributorPositionTotals, setDistributorPositionTotals] = useState(null);
  const [distributorPositionPagination, setDistributorPositionPagination] = useState(null);
  const [distributorPositionSearch, setDistributorPositionSearch] = useState("");
  const [distributorPositionAppliedSearch, setDistributorPositionAppliedSearch] = useState("");
  const [distributorPositionLoading, setDistributorPositionLoading] = useState(false);
  const [range, setRange]   = useState("month");
  const [selectedMfgId, setSelectedMfgId] = useState("ALL");
  const [mfgSubTab, setMfgSubTab] = useState("manufacturers"); // "manufacturers" | "orders"
  const [loading, setLoading] = useState(true);
  const [tab, setTab]       = useState("payables");
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") || "");
  const [catFilter, setCatFilter] = useState("ALL");
  const [showAddP, setShowAddP]   = useState(false);
  const [showAddR, setShowAddR]   = useState(false);
  const [showSettle, setShowSettle]   = useState(null);
  const [showCollect, setShowCollect] = useState(null);
  const [showPayMfg, setShowPayMfg]   = useState(false);

  const emptyP = { title:"",payeeName:"",category:"OTHER",totalAmount:"",dueDate:"",invoiceNumber:"",priority:"MEDIUM",notes:"" };
  const emptyR = { title:"",payerName:"",category:"CUSTOMER_RECEIVABLE",totalAmount:"",dueDate:"",invoiceNumber:"",notes:"" };
  const [pForm, setPForm] = useState(emptyP);
  const [rForm, setRForm] = useState(emptyR);
  const [sForm, setSForm] = useState({ amount:"",fromAccountId:"",notes:"",externalPaymentReference:"",bankEvidenceReference:"",failureReason:"",payoutId:"",partial:false,adjustmentType:"NONE",adjustmentAmount:"" });
  const [cForm, setCForm] = useState({ amount:"",toAccountId:"",notes:"",partial:false,adjustmentType:"NONE",adjustmentAmount:"",tenderMethod:"CASH",evidenceReference:"" });
  const [mfgPayForm, setMfgPayForm] = useState({ manufacturerId:"",amount:"",fromAccountId:"",notes:"",externalPaymentReference:"",bankEvidenceReference:"",failureReason:"",payoutId:"",partial:false });
  const payableRequestRef = useRef(null);
  const receivableRequestRef = useRef(null);
  const manufacturerPaymentRequestRef = useRef(null);
  const settlementCorrectionRequestRef = useRef(null);
  const [showRevert, setShowRevert] = useState(null); // { type, recordId, title, amount }
  const [revertReason, setRevertReason] = useState("");
  const [correctionMode, setCorrectionMode] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [revertLoading, setRevertLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [res, payoutResponse] = await Promise.all([
        axios.get(`${backendUrl}/api/finance/payables-receivables`,{headers:{token}}),
        axios.get(`${backendUrl}/api/finance/payouts?status=INITIATED&limit=100`,{headers:{token}}),
      ]);
      if (res.data.success) setData(res.data.data); else toast.error(res.data.message);
      setInitiatedPayouts(payoutResponse.data?.payouts || []);
    } catch { toast.error("Failed to load payables & receivables"); }
    finally { setLoading(false); }
  },[token]);

  const fetchDistributorPositions = useCallback(async (page = 1, query = "") => {
    try {
      setDistributorPositionLoading(true);
      const response = await axios.get(`${backendUrl}/api/admin/distributors/settlement-positions`, {
        headers: { token },
        params: { page, limit: 10, q: query.trim() || undefined },
      });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load distributor balances.");
      setDistributorPositions(response.data.distributors || []);
      setDistributorPositionTotals(response.data.totals || null);
      setDistributorPositionPagination(response.data.pagination || null);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to load distributor balances.");
      setDistributorPositions([]);
      setDistributorPositionTotals(null);
      setDistributorPositionPagination(null);
    } finally {
      setDistributorPositionLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchDistributorPositions();
  }, [token, fetchDistributorPositions]);

  const processInitiatedPayout = async (payout, action) => {
    const bankEvidenceReference = String(payoutEvidence[payout.id] || "").trim();
    const failureReason = String(payoutFailureReasons[payout.id] || "").trim();
    if (action === "CONFIRM" && !bankEvidenceReference) return toast.warn("Payment evidence reference is required.");
    if (action === "FAIL" && !failureReason) return toast.warn("A reason is required to mark the payout failed.");
    try {
      const response = await axios.post(`${backendUrl}/api/finance/settle-payable`, {
        action,
        payoutId: payout.id,
        bankEvidenceReference: action === "CONFIRM" ? bankEvidenceReference : undefined,
        failureReason: action === "FAIL" ? failureReason : undefined,
      }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Payout update failed.");
      toast.success(action === "CONFIRM" ? "Payout settled with bank evidence recorded." : "Payout marked failed and reservation released.");
      setPayoutEvidence((current) => ({ ...current, [payout.id]: "" }));
      setPayoutFailureReasons((current) => ({ ...current, [payout.id]: "" }));
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to update payout.");
    }
  };

  const fetchMfg = useCallback(async (r, mfgId = selectedMfgId) => {
    try {
      const params = { range: r };
      if (mfgId && mfgId !== "ALL") params.manufacturerId = mfgId;
      const res = await axios.get(`${backendUrl}/api/finance/manufacturer-summary`,{headers:{token},params});
      if (res.data.success) setMfgSummary(res.data.data);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to load manufacturer settlement summary.");
    }
  },[token, selectedMfgId]);

  useEffect(()=>{ if(token){fetchData();fetchMfg(range, selectedMfgId);} },[token, range, selectedMfgId, fetchData, fetchMfg]);

  const [sLoading, setSLoading] = useState(false);
  const [cLoading, setCLoading] = useState(false);
  const [mfgLoading, setMfgLoading] = useState(false);

  const createPayable = async (e) => {
    e.preventDefault();
    if (!pForm.title||!pForm.payeeName||!pForm.totalAmount) return toast.warn("Title, Payee and Amount required");
    try {
      const res = await axios.post(`${backendUrl}/api/finance/create-payable`,pForm,{headers:{token}});
      if (res.data.success){toast.success("Payable recorded");setShowAddP(false);setPForm(emptyP);fetchData();}
      else toast.error(res.data.message);
    } catch(e){toast.error(e.response?.data?.message||e.message);}
  };
  const createReceivable = async (e) => {
    e.preventDefault();
    if (!rForm.title||!rForm.payerName||!rForm.totalAmount) return toast.warn("Title, Payer and Amount required");
    try {
      const res = await axios.post(`${backendUrl}/api/finance/create-receivable`,rForm,{headers:{token}});
      if (res.data.success){toast.success("Receivable recorded");setShowAddR(false);setRForm(emptyR);fetchData();}
      else toast.error(res.data.message);
    } catch(e){toast.error(e.response?.data?.message||e.message);}
  };
  const settlePayable = async (e) => {
    e.preventDefault();
    if (sLoading) return;
    const amt = String(sForm.amount || "");
    const adjustmentAmount = String(sForm.adjustmentAmount || "0");
    if (!sForm.fromAccountId || !isPositiveDecimal(amt)) return toast.warn("Enter a valid positive amount and source account.");
    if (requiresExternalPaymentReference && !sForm.externalPaymentReference.trim()) return toast.warn("A payment instruction or voucher reference is required for this payout");
    const isEvidenceBackedPayout = ["DISTRIBUTOR_SETTLEMENT", "MARKETING_CPA_PAYABLE"].includes(showSettle.referenceType);
    if (showSettle.referenceType === "MARKETING_CPA_PAYABLE" && (sForm.adjustmentType !== "NONE" || isPositiveDecimal(adjustmentAmount))) {
      return toast.warn("Marketing CPA payments record the verified cash amount only; adjustments are not supported.");
    }
    let netSettlement;
    try {
      netSettlement = settlementAmountAfterAdjustment(amt, sForm.adjustmentType, adjustmentAmount);
      if (compareDecimalStrings(netSettlement, "0") <= 0 || compareDecimalStrings(netSettlement, String(showSettle.remainingBalance)) > 0) {
        return toast.warn("Cash amount and adjustment must settle a positive amount without exceeding the remaining balance.");
      }
    } catch {
      return toast.warn("Enter valid decimal amounts for the payment and adjustment.");
    }
    const acc=accounts.find(a=>a.id===sForm.fromAccountId);
    if (acc && compareDecimalStrings(String(acc.currentBalance || "0"), amt) < 0) return toast.warn(`Insufficient balance in ${acc.accountName} (Available: ${fmt(acc.currentBalance)})`);
    
    setSLoading(true);
    if (isEvidenceBackedPayout && sForm.payoutId && !sForm.bankEvidenceReference.trim()) {
      setSLoading(false);
      return toast.warn("Enter payment evidence before confirming settlement.");
    }
    const idempotencyKey = getStableIdempotencyKey(payableRequestRef, "PAY", {
      payableId: showSettle.id,
      amount: amt,
      adjustmentType: sForm.adjustmentType,
      adjustmentAmount,
      fromAccountId: sForm.fromAccountId,
      externalPaymentReference: sForm.externalPaymentReference.trim(),
    });
    try {
      const res = await axios.post(`${backendUrl}/api/finance/settle-payable`,{
        action: isEvidenceBackedPayout ? (sForm.payoutId ? "CONFIRM" : "INITIATE") : "INITIATE",
        payableId: showSettle.id,
        amount: amt,
        adjustmentType: sForm.adjustmentType,
        adjustmentAmount,
        fromAccountId: sForm.fromAccountId,
        notes: sForm.notes,
        externalPaymentReference: sForm.externalPaymentReference.trim() || undefined,
        payoutId: sForm.payoutId || undefined,
        bankEvidenceReference: sForm.bankEvidenceReference.trim() || undefined,
        idempotencyKey,
      },{headers:{token}});
      if (res.data.success){
        if (isEvidenceBackedPayout && !sForm.payoutId) {
          setSForm((current) => ({ ...current, payoutId: res.data.payout?.id || "" }));
          payableRequestRef.current = null;
          toast.info("Payout initiated and funds reserved. Confirm only after verifying the bank transfer evidence.");
          fetchData();
          return;
        }
        payableRequestRef.current = null;
        toast.success(res.data.message);
        setShowSettle(null);
        setSForm({amount:"",fromAccountId:"",notes:"",externalPaymentReference:"",bankEvidenceReference:"",failureReason:"",payoutId:"",partial:false,adjustmentType:"NONE",adjustmentAmount:""});
        fetchData();
        fetchMfg(range,selectedMfgId);
      } else {
        toast.error(res.data.message);
      }
    } catch(e){
      toast.error(e.response?.data?.message||e.message);
    } finally {
      setSLoading(false);
    }
  };
  const setFullPayableSettlement = () => {
    const amount = adjustedCashDue(showSettle.remainingBalance, sForm.adjustmentType, sForm.adjustmentAmount);
    if (amount === null) return toast.warn("Enter a valid adjustment amount before selecting full settlement.");
    setSForm({ ...sForm, partial: false, amount });
  };
  const setPayableAdjustmentType = (adjustmentType) => {
    const amount = adjustedCashDue(showSettle.remainingBalance, adjustmentType, sForm.adjustmentAmount);
    setSForm({
      ...sForm,
      adjustmentType,
      amount: sForm.partial || amount === null ? sForm.amount : amount,
    });
  };
  const setPayableAdjustmentAmount = (adjustmentAmount) => {
    const amount = adjustedCashDue(showSettle.remainingBalance, sForm.adjustmentType, adjustmentAmount);
    setSForm({
      ...sForm,
      adjustmentAmount,
      amount: sForm.partial || amount === null ? sForm.amount : amount,
    });
  };
  const setFullReceivableSettlement = () => {
    const amount = adjustedCashDue(showCollect.remainingBalance, cForm.adjustmentType, cForm.adjustmentAmount);
    if (amount === null) return toast.warn("Enter a valid adjustment amount before selecting full settlement.");
    setCForm({ ...cForm, partial: false, amount });
  };
  const setReceivableAdjustmentType = (adjustmentType) => {
    const amount = adjustedCashDue(showCollect.remainingBalance, adjustmentType, cForm.adjustmentAmount);
    setCForm({
      ...cForm,
      adjustmentType,
      amount: cForm.partial || amount === null ? cForm.amount : amount,
    });
  };
  const setReceivableAdjustmentAmount = (adjustmentAmount) => {
    const amount = adjustedCashDue(showCollect.remainingBalance, cForm.adjustmentType, adjustmentAmount);
    setCForm({
      ...cForm,
      adjustmentAmount,
      amount: cForm.partial || amount === null ? cForm.amount : amount,
    });
  };

  const failInitiatedPayout = async () => {
    if (!sForm.payoutId || !sForm.failureReason.trim() || sLoading) {
      return toast.warn("Enter why the initiated payout failed.");
    }
    setSLoading(true);
    try {
      const response = await axios.post(`${backendUrl}/api/finance/settle-payable`, {
        action: "FAIL",
        payoutId: sForm.payoutId,
        failureReason: sForm.failureReason.trim(),
      }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to mark payout failed.");
      toast.success("Payout marked failed; its reserved balance was released.");
      setShowSettle(null);
      setSForm({ amount:"",fromAccountId:"",notes:"",externalPaymentReference:"",bankEvidenceReference:"",failureReason:"",payoutId:"",partial:false,adjustmentType:"NONE",adjustmentAmount:"" });
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to mark payout failed.");
    } finally {
      setSLoading(false);
    }
  };
  const collectReceivable = async (e) => {
    e.preventDefault();
    if (cLoading) return;
    const amt = String(cForm.amount || "").trim();
    const adjustmentAmount = String(cForm.adjustmentAmount || "0").trim();
    if (!cForm.toAccountId || !isPositiveDecimal(amt)) return toast.warn("Amount and account required");
    if (showCollect.isAccountingDocument &&
      (!cForm.tenderMethod || !String(cForm.evidenceReference || "").trim())) {
      return toast.warn("Tender method and receipt evidence reference are required.");
    }
    let netSettlement;
    try {
      netSettlement = settlementAmountAfterAdjustment(amt, cForm.adjustmentType, adjustmentAmount);
      if (compareDecimalStrings(netSettlement, "0") <= 0 ||
        compareDecimalStrings(netSettlement, String(showCollect.remainingBalance)) > 0) {
        return toast.warn("Cash amount and adjustment must settle a positive amount without exceeding the remaining balance");
      }
    } catch {
      return toast.warn("Enter valid decimal amounts for the collection and adjustment.");
    }
    
    setCLoading(true);
    const idempotencyKey = getStableIdempotencyKey(receivableRequestRef, "COLL", {
      receivableId: showCollect.id,
      amount: amt,
      adjustmentType: cForm.adjustmentType,
      adjustmentAmount,
      toAccountId: cForm.toAccountId,
      tenderMethod: cForm.tenderMethod,
      evidenceReference: cForm.evidenceReference,
    });
    try {
      const res = await axios.post(`${backendUrl}/api/finance/collect-receivable`,{
        ...(showCollect.isAccountingDocument
          ? { invoiceIds: [showCollect.id] }
          : { receivableId: showCollect.id }),
        amount: amt,
        adjustmentType: cForm.adjustmentType,
        adjustmentAmount,
        toAccountId: cForm.toAccountId,
        ...(showCollect.isAccountingDocument
          ? { tenderMethod: cForm.tenderMethod, evidenceReference: String(cForm.evidenceReference).trim() }
          : {}),
        notes: cForm.notes,
        idempotencyKey,
      },{headers:{token}});
      if (res.data.success){
        receivableRequestRef.current = null;
        toast.success(res.data.message);
        setShowCollect(null);
        setCForm({amount:"",toAccountId:"",notes:"",partial:false,adjustmentType:"NONE",adjustmentAmount:"",tenderMethod:"CASH",evidenceReference:""});
        fetchData();
        fetchMfg(range,selectedMfgId);
      } else {
        toast.error(res.data.message);
      }
    } catch(err){
      toast.error(err.response?.data?.message||err.message);
    } finally {
      setCLoading(false);
    }
  };
  const payManufacturerSubmit = async (e) => {
    e.preventDefault();
    if (mfgLoading) return;
    const amt=String(mfgPayForm.amount ?? "").trim();
    const externalPaymentReference = String(mfgPayForm.externalPaymentReference ?? "").trim();
    const bankEvidenceReference = String(mfgPayForm.bankEvidenceReference ?? "").trim();
    if (!mfgPayForm.manufacturerId||!mfgPayForm.fromAccountId||!isPositiveDecimal(amt)||!externalPaymentReference) return toast.warn("Manufacturer, amount, payment account, and transfer reference are required");
    if (mfgPayForm.payoutId && !bankEvidenceReference) return toast.warn("Bank transfer evidence reference is required before confirming settlement.");
    const acc=accounts.find(a=>a.id===mfgPayForm.fromAccountId);
    if (acc&&compareDecimalStrings(String(acc.currentBalance || "0"), amt)<0) return toast.warn(`Insufficient liquid cash in ${acc.accountName} (Available: ${fmt(acc.currentBalance)})`);
    
    setMfgLoading(true);
    const idempotencyKey = getStableIdempotencyKey(manufacturerPaymentRequestRef, "MFGPAY", {
      manufacturerId: mfgPayForm.manufacturerId,
      amount: amt,
      fromAccountId: mfgPayForm.fromAccountId,
      externalPaymentReference,
    });
    try {
      const res = await axios.post(`${backendUrl}/api/finance/pay-manufacturer`,{
        action: mfgPayForm.payoutId ? "CONFIRM" : "INITIATE",
        manufacturerId: mfgPayForm.manufacturerId,
        amount: amt,
        fromAccountId: mfgPayForm.fromAccountId,
        notes: mfgPayForm.notes,
        externalPaymentReference,
        payoutId: mfgPayForm.payoutId || undefined,
        bankEvidenceReference: bankEvidenceReference || undefined,
        idempotencyKey,
      },{headers:{token}});
      if (res.data.success){
        if (!mfgPayForm.payoutId) {
          setMfgPayForm((current) => ({ ...current, payoutId: res.data.payout?.id || "" }));
          manufacturerPaymentRequestRef.current = null;
          toast.info("Manufacturer payout initiated and funds reserved. Confirm settlement only after verifying bank evidence.");
          fetchData();
          return;
        }
        manufacturerPaymentRequestRef.current = null;
        toast.success(res.data.message);
        setShowPayMfg(false);
        setMfgPayForm({manufacturerId:"",amount:"",fromAccountId:"",notes:"",externalPaymentReference:"",bankEvidenceReference:"",failureReason:"",payoutId:"",partial:false});
        fetchData();
        fetchMfg(range, selectedMfgId);
      } else {
        toast.error(res.data.message);
      }
    } catch(err){
      toast.error(err.response?.data?.message||err.message);
    } finally {
      setMfgLoading(false);
    }
  };

  const failManufacturerPayout = async () => {
    const failureReason = String(mfgPayForm.failureReason ?? "").trim();
    if (!mfgPayForm.payoutId || !failureReason || mfgLoading) {
      return toast.warn("Enter why the initiated payout failed.");
    }
    setMfgLoading(true);
    try {
      const response = await axios.post(`${backendUrl}/api/finance/pay-manufacturer`, {
        action: "FAIL",
        payoutId: mfgPayForm.payoutId,
        failureReason,
      }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to mark payout failed.");
      toast.success("Payout marked failed; its reserved balance was released.");
      setShowPayMfg(false);
      setMfgPayForm({manufacturerId:"",amount:"",fromAccountId:"",notes:"",externalPaymentReference:"",bankEvidenceReference:"",failureReason:"",payoutId:"",partial:false});
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to mark payout failed.");
    } finally {
      setMfgLoading(false);
    }
  };

  const revertSettlement = async () => {
    if (!showRevert) return;
    if (!revertReason.trim()) return toast.warn("Please provide a reason for reverting this settlement.");
    if (!correctionMode) return toast.warn("Choose whether the original cash movement was void or returned.");
    if (!evidenceReference.trim()) return toast.warn("Provide a reference for the supporting bank or payment evidence.");
    setRevertLoading(true);
    try {
      const requestPayload = {
        type: showRevert.type,
        recordId: showRevert.recordId,
        payoutId: showRevert.payoutId,
        cashTransactionId: showRevert.cashTransactionId || null,
        correctionMode,
        revertReason: revertReason.trim(),
        evidenceReference: evidenceReference.trim(),
      };

      const idempotencyKey = getStableIdempotencyKey(settlementCorrectionRequestRef, "CORRECTION", requestPayload);
      const res = await axios.post(`${backendUrl}/api/finance/revert-settlement`, {
        ...requestPayload,
        idempotencyKey,
      }, { headers: { token } });
      if (res.data.success) {
        toast.info(res.data.message || "Settlement correction submitted for approval.");
        setShowRevert(null);
        setRevertReason("");
        setCorrectionMode("");
        setEvidenceReference("");
        settlementCorrectionRequestRef.current = null;
        fetchData();
        fetchMfg(range, selectedMfgId);
      } else {
        toast.error(res.data.message || "Revert failed");
      }
    } catch(err) {
      toast.error(err.response?.data?.message || err.message || "Failed to revert settlement");
    } finally {
      setRevertLoading(false);
    }
  };

  const beginReceiptCorrection = (receivable, receipt) => {
    const receiptId = receipt.receiptId;
    if (!receiptId) return;
    setShowRevert({
      type: "RECEIVABLE",
      recordId: receiptId,
      cashTransactionId: receiptId,
      title: `Customer receipt ${receiptId.slice(-8)}`,
      amount: receipt.cashReceivedAmount || receipt.amount,
      partyName: receivable.payerName,
    });
    setRevertReason("");
    setCorrectionMode("");
    setEvidenceReference("");
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin"/>
      <p className="text-sm text-slate-400">Loading payables & receivables...</p>
    </div>
  );

  const metrics   = data?.metrics   || {};
  const accounts  = data?.accounts  || [];
  const allP      = data?.payables  || [];
  const allR      = data?.receivables || [];
  const recentTransactions = data?.recentTransactions || [];
  const settlementReversions = data?.settlementReversions || [];
  const mfgData   = mfgSummary?.summary || {};
  const mfgList   = mfgSummary?.manufacturers || [];
  const mfgOrders = mfgSummary?.orders  || [];

  const filt = (arr,nk) => arr.filter(x=>{
    const ms=!search||x.title?.toLowerCase().includes(search.toLowerCase())||x[nk]?.toLowerCase().includes(search.toLowerCase());
    const mc=catFilter==="ALL"||x.category===catFilter;
    return ms&&mc;
  });
  const fp=filt(allP,"payeeName"), fr=filt(allR,"payerName");
  const openP=fp.filter(p=>p.status!=="SETTLED"&&p.status!=="CANCELLED");
  const settledP=fp.filter(p=>p.status==="SETTLED");
  const openR=fr.filter(r=>r.status!=="SETTLED"&&r.status!=="CANCELLED");
  const settledR=fr.filter(r=>r.status==="SETTLED");
  const receiptAnchorInvoiceIds = new Map();
  for (const receivable of [...openR, ...settledR.slice(0, 15)]) {
    if (!receivable.isAccountingDocument) continue;
    for (const receipt of receivable.collectionHistory || []) {
      if (receipt.category !== "RECEIVABLE_COLLECTION" || !receipt.receiptId) continue;
      const currentAnchor = receiptAnchorInvoiceIds.get(receipt.receiptId);
      if (!currentAnchor || receivable.id < currentAnchor) {
        receiptAnchorInvoiceIds.set(receipt.receiptId, receivable.id);
      }
    }
  }
  const allOpenP=allP.filter(p=>p.status!=="SETTLED"&&p.status!=="CANCELLED");
  const allOpenR=allR.filter(r=>r.status!=="SETTLED"&&r.status!=="CANCELLED");
  const selAcc=accounts.find(a=>a.id===sForm.fromAccountId);
  const insuff=selAcc&&isPositiveDecimal(sForm.amount)&&compareDecimalStrings(String(selAcc.currentBalance||"0"),String(sForm.amount))<0;
  const selMfgAcc=accounts.find(a=>a.id===mfgPayForm.fromAccountId);
  const mfgInsuff=selMfgAcc&&isPositiveDecimal(mfgPayForm.amount)&&compareDecimalStrings(String(selMfgAcc.currentBalance||"0"),String(mfgPayForm.amount))<0;

  const activeMfgObj = mfgList.find(m => m.id === mfgPayForm.manufacturerId) || mfgList[0] || {};
  const activeMfgCogs = String(activeMfgObj.remainingPayable ?? activeMfgObj.payable ?? "0");
  const activeMfgDirectReceivable = String(activeMfgObj.receivable ?? "0");
  const activeMfgNetPayable = maxZeroDecimalString(subtractDecimalStrings(activeMfgCogs, activeMfgDirectReceivable));
  const activeMfgOffset = minDecimalStrings(activeMfgCogs, activeMfgDirectReceivable);
  const netPayablePressure = String(metrics.netPayablePressure || "0");
  const hasPayableShortfall = compareDecimalStrings(netPayablePressure, "0") > 0;
  const displayedNetPressure = hasPayableShortfall
    ? `-${fmt(netPayablePressure)}`
    : fmt(subtractDecimalStrings("0", netPayablePressure));
  const requiresExternalPaymentReference = Boolean(showSettle && (
    ["MANUFACTURER_COGS", "DISTRIBUTOR_SETTLEMENT", "MARKETING_CPA_PAYABLE"].includes(showSettle.referenceType) ||
    String(showSettle.id || "").startsWith("AP-MFG-") ||
    showSettle.category === "DISTRIBUTOR_SETTLEMENT"
  ));

  return (
    <div className="space-y-6">

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Accounts Payable &amp; Receivable</h1>
          <p className="text-xs text-slate-500 mt-0.5">Internal subledger and Treasury records. Supplier balances are not reconciled to a complete receipt register or independent supplier and bank statements.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSettlePayable&&<button onClick={()=>{
            const defaultMfg = mfgList.find(m => isPositiveDecimal(m.remainingPayable ?? m.payable ?? "0")) || mfgList[0];
            const defCogs = String(defaultMfg?.remainingPayable ?? defaultMfg?.payable ?? "0");
            const defDirect = String(defaultMfg?.receivable ?? "0");
            const defNet = maxZeroDecimalString(subtractDecimalStrings(defCogs, defDirect));
            setShowPayMfg(true);
            setMfgPayForm({
              manufacturerId: defaultMfg?.id || "",
              amount: compareDecimalStrings(defNet, "0") > 0 ? defNet : defCogs,
              fromAccountId: accounts[0]?.id || "",
              notes: "",
              externalPaymentReference: "",
              bankEvidenceReference: "",
              failureReason: "",
              payoutId: "",
              partial: false,
            });
          }} className="px-3 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-800 flex items-center gap-1.5 shadow-sm cursor-pointer">
            <span>💳</span>
            Pay Manufacturer (Net)
          </button>}
          {canCreatePayable&&<button onClick={()=>setShowAddP(true)} className="px-3 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 flex items-center gap-1.5 shadow-sm cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
            Record Payable
          </button>}
          {canCreateReceivable&&<button onClick={()=>setShowAddR(true)} className="px-3 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 flex items-center gap-1.5 shadow-sm cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
            Record Receivable
          </button>}
        </div>
      </div>

      {initiatedPayouts.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="mb-3">
            <h2 className="text-sm font-bold text-amber-950">Initiated payouts awaiting payment evidence</h2>
            <p className="mt-1 text-[11px] text-amber-800">These amounts are reserved. Confirm only after matching the payment to a bank statement, cash voucher, or equivalent evidence. Mark failed only when the transfer is confirmed not to have settled.</p>
          </div>
          <div className="space-y-3">
            {initiatedPayouts.map((payout) => (
              <article key={payout.id} className="grid gap-3 rounded-lg border border-amber-200 bg-white p-3 lg:grid-cols-[1fr_1.2fr_auto] lg:items-end">
                <div className="text-xs">
                  <p className="font-bold text-slate-900">{payout.targetType.replaceAll("_", " ")} · {payout.targetId}</p>
                  <p className="mt-1 text-slate-600">Transfer: {payout.externalPaymentReference || "No reference"} · Account: {payout.financialAccount?.accountName || payout.financialAccountId}</p>
                  <p className="mt-1 font-semibold text-slate-800">Cash {fmt(payout.amount)} · Payable reduction {fmt(payout.settlementAmount)}</p>
                  <p className="mt-1 text-slate-500">Initiated {formatDate(payout.initiatedAt)}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-[11px] font-semibold text-slate-700">Payment evidence reference
                    <input maxLength={191} value={payoutEvidence[payout.id] || ""} onChange={(event) => setPayoutEvidence((current) => ({ ...current, [payout.id]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2" placeholder="Statement line / evidence ID"/>
                  </label>
                  <label className="text-[11px] font-semibold text-slate-700">Failure reason
                    <input maxLength={2000} value={payoutFailureReasons[payout.id] || ""} onChange={(event) => setPayoutFailureReasons((current) => ({ ...current, [payout.id]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2" placeholder="Only if transfer failed"/>
                  </label>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => processInitiatedPayout(payout, "FAIL")} disabled={!String(payoutFailureReasons[payout.id] || "").trim()} className="rounded-lg border border-rose-300 px-3 py-2 text-[11px] font-bold text-rose-700 disabled:opacity-40">Mark failed</button>
                  <button type="button" onClick={() => processInitiatedPayout(payout, "CONFIRM")} disabled={!String(payoutEvidence[payout.id] || "").trim()} className="rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-40">Confirm settled</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-red-200 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">Payables Due</p>
          <p className="text-lg font-black text-red-700 mt-1">{fmt(metrics.totalPayablesOutstanding)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{allOpenP.length} unpaid bill(s)</p>
          <p className="text-[10px] text-slate-500 mt-1">
            Expense-linked outstanding: {fmt(metrics.expenseLinkedPayables?.outstandingAmount)}
            {" · "}
            Overdue: {fmt(metrics.expenseLinkedPayables?.overdueAmount)}
          </p>
          {metrics.expenseLinkedPayables?.sourceExceptionCount > 0 && (
            <p className="text-[10px] text-amber-700 mt-1">
              {metrics.expenseLinkedPayables.sourceExceptionCount} expense source link(s) need review.
            </p>
          )}
        </div>
        <div className="bg-white border border-emerald-200 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Receivables Due</p>
          <p className="text-lg font-black text-emerald-700 mt-1">{fmt(metrics.totalReceivablesOutstanding)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{allOpenR.length} pending item(s)</p>
        </div>
        <div className="bg-white border border-blue-200 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider">Liquid Cash</p>
          <p className="text-lg font-black text-blue-700 mt-1">{fmt(metrics.totalLiquidCash)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{accounts.length} account{accounts.length!==1?"s":""}</p>
        </div>
        <div className={`bg-white border rounded-xl p-4 ${metrics.canCoverAllPayablesNow?"border-emerald-200":"border-red-200"}`}>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Net Pressure</p>
          <p className={`text-lg font-black mt-1 ${hasPayableShortfall?"text-red-700":"text-emerald-700"}`}>
            {displayedNetPressure}
          </p>
          <p className="text-[10px] mt-0.5">
            {metrics.canCoverAllPayablesNow?<span className="text-emerald-600 font-medium">✅ Can settle all</span>:<span className="text-red-600 font-medium">⚠️ Shortfall</span>}
          </p>
        </div>
      </div>

      {accounts.length>0&&(
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Available Treasury Accounts</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {accounts.map(a=>{
              const cash=a.accountType==="CASH"||a.accountName?.toLowerCase().includes("cash");
              const bank=!cash&&(a.accountType==="BANK"||["bank","esewa","khalti"].some(k=>a.accountName?.toLowerCase().includes(k)));
              return(<div key={a.id} className="flex items-center gap-2.5 p-2.5 bg-slate-50 rounded-lg border border-slate-100"><span className="text-base">{cash?"💵":bank?"🏦":"📂"}</span><div className="flex-1 min-w-0"><p className="text-xs font-semibold text-slate-800 truncate">{a.accountName}</p><p className="text-[10px] text-slate-400">{cash?"Cash":bank?"Bank / Wallet":a.accountType}</p></div><p className="text-xs font-bold text-emerald-700 shrink-0">{fmt(a.currentBalance)}</p></div>);
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. MANUFACTURER OBLIGATIONS & DIRECT SALES LEDGER */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider">
              <span>🏭</span> Manufacturer Ledger Hub
            </div>
            <h2 className="text-base font-black text-slate-900 mt-1">Manufacturer Payables &amp; Direct Sales</h2>
            <p className="text-xs text-slate-500">
              Direct phone and hub-visit sales only. Manufacturer payables are approved COGS; direct-sale value less COGS is due to the platform.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedMfgId}
              onChange={(e) => setSelectedMfgId(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 outline-none focus:border-slate-900"
            >
              <option value="ALL">All Manufacturers ({mfgList.length})</option>
              {mfgList.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.city || "Hub"})</option>
              ))}
            </select>

            <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
              {[{v:"day",l:"Today"},{v:"week",l:"7 Days"},{v:"month",l:"Month"},{v:"quarter",l:"3 Months"},{v:"year",l:"Year"}].map(o=>(
                <button
                  key={o.v}
                  onClick={()=>setRange(o.v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    range===o.v ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 4 KPI Cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="bg-red-50/70 border border-red-200 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-red-600">Payable to Manufacturers</p>
              <span className="text-xs">📦</span>
            </div>
            <p className="mt-2 text-2xl font-black text-red-700">{fmt(mfgData.payable||0)}</p>
              <p className="mt-1 text-[10px] text-red-600">Approved COGS and prior posted balances</p>
          </div>

          <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Direct-Sale Margin Receivable</p>
              <span className="text-xs">💰</span>
            </div>
            <p className="mt-2 text-2xl font-black text-emerald-700">{fmt(mfgData.receivable||0)}</p>
              <p className="mt-1 text-[10px] text-emerald-600">Direct sales less approved COGS</p>
          </div>

          <div className={`rounded-2xl p-4 border ${compareDecimalStrings(String(mfgData.netPayable || "0"), "0") > 0 ? "bg-amber-50/70 border-amber-200" : "bg-blue-50/70 border-blue-200"}`}>
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Net Settlement Position</p>
              <span className="text-xs">⚖️</span>
            </div>
            <p className={`mt-2 text-2xl font-black ${compareDecimalStrings(String(mfgData.netPayable || "0"), "0") > 0 ? "text-amber-800" : "text-blue-800"}`}>
              {fmt(compareDecimalStrings(String(mfgData.netPayable || "0"), "0") > 0 ? mfgData.netPayable : (mfgData.netReceivable || "0"))}
            </p>
            <p className="mt-1 text-[10px] font-semibold text-slate-600">
              {compareDecimalStrings(String(mfgData.netPayable || "0"), "0") > 0 ? "⚠️ Net liability owed to manufacturers" : "✅ Net asset owed by manufacturers"}
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Order Activity &amp; Units</p>
              <span className="text-xs">📊</span>
            </div>
            <p className="mt-2 text-2xl font-black text-slate-900">
              {mfgData.itemsSold||0} <span className="text-xs font-normal text-slate-500">sold ({mfgData.itemsDelivered||0} delivered)</span>
            </p>
            <p className="mt-1 text-[10px] text-slate-500">
              Direct Sales: {fmt(mfgData.totalSales||0)}
            </p>
          </div>
        </div>

        {/* Multi-Tab Switcher between Manufacturers Ledger vs Orders Breakdown */}
        <div className="flex items-center justify-between border-b border-slate-100 pt-2 pb-1">
          <div className="flex gap-2">
            <button
              onClick={() => setMfgSubTab("manufacturers")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                mfgSubTab === "manufacturers" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              🏢 All Manufacturers ({mfgList.length})
            </button>
            <button
              onClick={() => setMfgSubTab("orders")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                mfgSubTab === "orders" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              📦 Order Channel Ledger ({mfgOrders.length})
            </button>
          </div>
        </div>

        {/* TAB 1: ALL MANUFACTURERS DIRECTORY */}
        {mfgSubTab === "manufacturers" && (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider">
                <tr>
                  <th className="px-3 py-2.5">Manufacturer</th>
                  <th className="px-3 py-2.5">Location / Phone</th>
                  <th className="px-3 py-2.5 text-center">Orders</th>
                  <th className="px-3 py-2.5">Direct Sales</th>
                  <th className="px-3 py-2.5">Total COGS</th>
                  <th className="px-3 py-2.5">Posted Payable</th>
                  <th className="px-3 py-2.5">Receivable (Direct Margin)</th>
                  <th className="px-3 py-2.5">Net Position</th>
                  <th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mfgList.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="px-3 py-8 text-center text-slate-400">
                      No manufacturers registered in the database.
                    </td>
                  </tr>
                ) : (
                  mfgList.map((m) => {
                    const isNetPayable = compareDecimalStrings(String(m.netPayable || "0"), "0") > 0;
                    return (
                      <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-3 py-2.5 font-bold text-slate-900">
                          {m.name}
                          {m.email && <div className="text-[10px] text-slate-400 font-normal">{m.email}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          <div>{m.city || "Nepal"}</div>
                          <div className="text-[10px] text-slate-400">{m.phone || "—"}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-800">
                          {m.totalOrders}
                        </td>
                        <td className="px-3 py-2.5 text-slate-800 font-medium">
                          {fmt(m.totalSales)}
                        </td>
                        <td className="px-3 py-2.5 text-slate-800 font-medium">
                          {fmt(m.totalCogs)}
                        </td>
                        <td className="px-3 py-2.5 font-bold text-red-600 bg-red-50/40">
                          {fmt(m.payable)}
                        </td>
                        <td className="px-3 py-2.5 font-bold text-emerald-600 bg-emerald-50/40">
                          {fmt(m.receivable)}
                        </td>
                        <td className="px-3 py-2.5 font-black">
                          {isNetPayable ? (
                            <span className="text-red-700 bg-red-100 px-2 py-0.5 rounded-full text-[10px]">
                              Owe {fmt(m.netPayable)}
                            </span>
                          ) : compareDecimalStrings(String(m.netReceivable || "0"), "0") > 0 ? (
                            <span className="text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full text-[10px]">
                              Due {fmt(m.netReceivable)}
                            </span>
                          ) : (
                            <span className="text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full text-[10px]">
                              Settled
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {(isPositiveDecimal(m.payable) || isPositiveDecimal(m.remainingPayable)) && (
                              <button
                                onClick={() => {
                                  setShowPayMfg(true);
                                  setMfgPayForm({
                                    manufacturerId: m.id,
                                    amount: String(m.remainingPayable !== undefined ? m.remainingPayable : m.payable),
                                    fromAccountId: accounts[0]?.id || "",
                                    notes: `Approved COGS settlement for ${m.name}`,
                                    externalPaymentReference: "",
                                    bankEvidenceReference: "",
                                    failureReason: "",
                                    payoutId: "",
                                    partial: false,
                                  });
                                }}
                                className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[10px] font-bold cursor-pointer transition shadow-xs"
                              >
                                💳 Pay Manufacturer
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSelectedMfgId(m.id);
                                setMfgSubTab("orders");
                              }}
                              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[10px] font-bold cursor-pointer transition"
                            >
                              View Orders
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: ORDER CHANNEL BREAKDOWN LEDGER */}
        {mfgSubTab === "orders" && (
          <div className="space-y-2">
            {selectedMfgId !== "ALL" && (
              <div className="flex items-center justify-between bg-sky-50 border border-sky-100 px-3 py-2 rounded-xl text-xs text-sky-800">
                <span>Showing filtered orders for <b>{mfgList.find(m => m.id === selectedMfgId)?.name || selectedMfgId}</b></span>
                <button
                  onClick={() => setSelectedMfgId("ALL")}
                  className="font-bold underline hover:text-sky-950 cursor-pointer"
                >
                  Show All Manufacturers
                </button>
              </div>
            )}
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider">
                  <tr>
                    <th className="px-3 py-2.5">Order</th>
                    <th className="px-3 py-2.5">Manufacturer</th>
                    <th className="px-3 py-2.5">Channel Type</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-center">Qty</th>
                    <th className="px-3 py-2.5">Direct Sale Value</th>
                    <th className="px-3 py-2.5">Approved COGS</th>
                    <th className="px-3 py-2.5">Payable to Manufacturer</th>
                    <th className="px-3 py-2.5">Receivable from Manufacturer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mfgOrders.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="px-3 py-8 text-center text-slate-400">
                        No order activity found in this period for the selected manufacturer(s).
                      </td>
                    </tr>
                  ) : (
                    mfgOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-3 py-2 font-mono font-bold text-slate-800">
                          #{String(o.id).slice(-8).toUpperCase()}
                          {o.date && <div className="text-[10px] text-slate-400 font-normal">{formatDate(o.date)}</div>}
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-800">
                          {o.manufacturerName || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {o.isDirect ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              🏭 Direct Sale
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                              🛒 Platform Order
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            String(o.status||"").toLowerCase().includes("deliver")
                              ? "bg-emerald-100 text-emerald-700"
                              : String(o.status||"").toLowerCase().includes("return")
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-700"
                          }`}>
                            {o.status || "Pending"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center font-bold text-slate-800">{o.quantity}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">{o.amount != null ? fmt(o.amount) : "—"}</td>
                        <td className="px-3 py-2 text-slate-700">{fmt(o.cogs)}</td>
                        <td className="px-3 py-2 text-red-700 font-bold bg-red-50/30">
                          {compareDecimalStrings(String(o.payable || "0"), "0") > 0 ? fmt(o.payable) : "—"}
                        </td>
                        <td className="px-3 py-2 text-emerald-700 font-bold bg-emerald-50/30">
                          {compareDecimalStrings(String(o.receivable || "0"), "0") > 0 ? fmt(o.receivable) : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1"><svg className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by title or party name..." className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-900 outline-none"/></div>
        <select value={catFilter} onChange={e=>setCatFilter(e.target.value)} className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-900 outline-none">
          <option value="ALL">All Categories</option>
          {[...PAYABLE_CATS,...RECEIVABLE_CATS.filter(c=>!PAYABLE_CATS.find(p=>p.value===c.value))].map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        <button onClick={fetchData} className="px-3 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>Refresh</button>
      </div>

      <section className="space-y-4 rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900">Distributor settlement positions</h2>
            <p className="mt-1 text-xs text-slate-500">
              Current open receivables and payables by distributor. Net due is calculated separately for each distributor; these balances are separate from the legacy payables and receivables list below.
            </p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const query = distributorPositionSearch.trim();
              setDistributorPositionAppliedSearch(query);
              fetchDistributorPositions(1, query);
            }}
          >
            <input
              value={distributorPositionSearch}
              onChange={(event) => setDistributorPositionSearch(event.target.value)}
              placeholder="Find distributor by name or location"
              className="min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-xs sm:w-64"
            />
            <button type="submit" disabled={distributorPositionLoading} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              Search
            </button>
            <button type="button" onClick={() => fetchDistributorPositions(distributorPositionPagination?.page || 1, distributorPositionAppliedSearch)} disabled={distributorPositionLoading} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">
              Refresh
            </button>
          </form>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Distributor receivable", distributorPositionTotals?.outstandingReceivable, "text-emerald-700"],
            ["Distributor payable", distributorPositionTotals?.outstandingPayable, "text-rose-700"],
            ["Net receivable by distributor", distributorPositionTotals?.companyCollects, "text-indigo-800"],
            ["Net payable by distributor", distributorPositionTotals?.companyPays, "text-violet-800"],
            ["Pending COD remittances", distributorPositionTotals?.pendingRemittance, "text-amber-700"],
          ].map(([label, amount, color]) => (
            <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
              <p className={`mt-1 text-lg font-black ${color}`}>{fmtBalance(amount)}</p>
            </div>
          ))}
        </div>
        {isPositiveDecimal(distributorPositionTotals?.legacyLogisticsPayable) && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Includes {fmtBalance(distributorPositionTotals.legacyLogisticsPayable)} of legacy return/exchange logistics payables; these are itemized per distributor and must be cleared through Accounts Payable before unified settlement.
          </p>
        )}

        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Distributor</th>
                <th className="px-3 py-2.5">Location</th>
                <th className="px-3 py-2.5 text-right">Receivable</th>
                <th className="px-3 py-2.5 text-right">Payable</th>
                <th className="px-3 py-2.5 text-right">Net due</th>
                <th className="px-3 py-2.5 text-right">Pending COD</th>
                <th className="px-3 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {distributorPositionLoading ? (
                <tr><td colSpan="7" className="px-3 py-8 text-center text-slate-500">Loading distributor balances…</td></tr>
              ) : distributorPositions.length ? distributorPositions.map((distributor) => (
                <tr key={distributor.id} className="hover:bg-slate-50/80">
                  <td className="px-3 py-3">
                    <p className="font-bold text-slate-900">{distributor.name}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">{distributor.phone || distributor.status}</p>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{[distributor.city, distributor.district, distributor.province].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-3 py-3 text-right font-bold text-emerald-700">{fmtBalance(distributor.outstandingReceivable)}</td>
                  <td className="px-3 py-3 text-right font-bold text-rose-700">
                    {fmtBalance(distributor.outstandingPayable)}
                    {isPositiveDecimal(distributor.legacyLogisticsPayable) && <p className="text-[9px] font-medium text-amber-700">includes legacy logistics {fmtBalance(distributor.legacyLogisticsPayable)}</p>}
                  </td>
                  <td className={`px-3 py-3 text-right font-black ${compareDecimalStrings(distributor.netBalance || "0", "0") >= 0 ? "text-emerald-800" : "text-rose-800"}`}>
                    {compareDecimalStrings(distributor.netBalance || "0", "0") > 0 ? "Company collects " : compareDecimalStrings(distributor.netBalance || "0", "0") < 0 ? "Company pays " : "Settled "}
                    {fmtBalance(compareDecimalStrings(distributor.netBalance || "0", "0") < 0
                      ? subtractDecimalStrings("0", distributor.netBalance)
                      : distributor.netBalance)}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-amber-700">{fmtBalance(distributor.pendingRemittance)}</td>
                  <td className="px-3 py-3">
                    <Link to={`/distributors/${distributor.id}?tab=finance`} className="whitespace-nowrap rounded-lg bg-indigo-700 px-3 py-2 text-[10px] font-bold text-white hover:bg-indigo-800">
                      View settlement
                    </Link>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan="7" className="px-3 py-8 text-center text-slate-500">No distributor balances found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span>
            {distributorPositionPagination?.total || 0} distributors · net receivable and payable totals are calculated per distributor and are not cross-offset.
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={!distributorPositionPagination?.hasPreviousPage || distributorPositionLoading} onClick={() => fetchDistributorPositions(distributorPositionPagination.page - 1, distributorPositionAppliedSearch)} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40">Previous</button>
            <span className="px-2 py-1.5">Page {distributorPositionPagination?.page || 1} of {distributorPositionPagination?.totalPages || 1}</span>
            <button type="button" disabled={!distributorPositionPagination?.hasNextPage || distributorPositionLoading} onClick={() => fetchDistributorPositions(distributorPositionPagination.page + 1, distributorPositionAppliedSearch)} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40">Next</button>
          </div>
        </div>
      </section>

      <div className="border-b border-slate-200">
        <div className="flex flex-wrap">
          <button onClick={()=>setTab("payables")} className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition-all ${tab==="payables"?"border-red-600 text-red-700 bg-red-50/50":"border-transparent text-slate-500 hover:text-slate-700"}`}>Payables (You Owe){allOpenP.length>0&&<span className="ml-1.5 bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full text-[10px]">{allOpenP.length}</span>}</button>
          <button onClick={()=>setTab("receivables")} className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition-all ${tab==="receivables"?"border-emerald-600 text-emerald-700 bg-emerald-50/50":"border-transparent text-slate-500 hover:text-slate-700"}`}>Receivables (Owed to You){allOpenR.length>0&&<span className="ml-1.5 bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full text-[10px]">{allOpenR.length}</span>}</button>
          <button onClick={()=>setTab("transactions")} className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition-all ${tab==="transactions"?"border-slate-900 text-slate-900 bg-slate-100/70":"border-transparent text-slate-500 hover:text-slate-700"}`}>
            💳 Settlement Audit ({recentTransactions.length})
          </button>
          <button onClick={()=>setTab("reversions")} className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition-all ${tab==="reversions"?"border-amber-600 text-amber-700 bg-amber-50/50":"border-transparent text-slate-500 hover:text-slate-700"}`}>
            ↩ Reversions {settlementReversions.length>0&&<span className="ml-1.5 bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full text-[10px]">{settlementReversions.length}</span>}
          </button>
        </div>
      </div>


      {tab==="payables"&&(
        <div className="space-y-4">
          {openP.length===0&&settledP.length===0?(
            <div className="text-center py-16 bg-white border border-dashed border-slate-300 rounded-xl">
              <p className="text-2xl mb-2">📋</p>
              <p className="text-slate-500 text-sm font-medium">No payables found</p>
              <p className="text-[11px] text-slate-400 mt-1">Distributor settlement requests and other liabilities appear here for payment.</p>
              {canCreatePayable&&<button onClick={()=>setShowAddP(true)} className="mt-3 px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700">+ Record Payable</button>}
            </div>
          ):(
            <>
              {openP.length>0&&(
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">Outstanding Payables ({openP.length})</h3>
                  <div className="space-y-2.5">
                    {openP.map(p=>{
                      const over=typeof p.isOverdue==="boolean" ? p.isOverdue : isOverdue(p.dueDate);
                      const hasPaidAmount=p.isExpenseLinked||p.isPartyBalance
                        ? compareDecimalStrings(p.paidAmount || "0", "0") > 0
                        : p.paidAmount > 0;
                      const totalDiffersFromRemaining=p.isExpenseLinked||p.isPartyBalance
                        ? compareDecimalStrings(p.totalAmount || "0", p.remainingBalance || "0") !== 0
                        : p.totalAmount !== p.remainingBalance;
                      const pct=p.isExpenseLinked
                        ? null
                        : p.isPartyBalance
                          ? roundedPercentFromDecimalStrings(p.paidAmount || "0", p.totalAmount || "0")
                        : p.totalAmount>0?(p.paidAmount/p.totalAmount)*100:0;
                      return(
                        <div key={p.id} className={`bg-white border rounded-xl p-4 ${over?"border-red-300 bg-red-50/20":"border-slate-200"}`}>
                          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-base">{ICON_MAP[p.category]||"📋"}</span>
                                <p className="text-sm font-bold text-slate-900 truncate">{p.title}</p>
                                <StatusBadge status={p.status}/><PriorityBadge priority={p.priority}/>
                                {over&&<span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full animate-pulse">OVERDUE</span>}
                                {p.isExpenseLinked&&p.sourceConsistencyStatus!=="MATCH"&&<span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">SOURCE LINK NEEDS REVIEW</span>}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-500">
                                <span>To: <b className="text-slate-700">{p.payeeName}</b></span>
                                <span>•</span><span>{LABEL_MAP[p.category]||p.category}</span>
                                {p.dueDate&&<><span>•</span><span className={over?"text-red-600 font-semibold":""}>Due: {formatDate(p.dueDate)}</span></>}
                                {p.invoiceNumber&&<><span>•</span><span>Inv: {p.invoiceNumber}</span></>}
                              </div>
                              {p.notes&&<p className="text-[10px] text-slate-400 mt-1 truncate">{p.notes}</p>}
                              {hasPaidAmount&&(
                                <div className="mt-2">
                                  {p.isExpenseLinked
                                    ? <p className="text-[10px] text-slate-400">Paid: {fmt(p.paidAmount)}</p>
                                    : p.isPartyBalance
                                      ? <>
                                        <div className="flex justify-between text-[10px] text-slate-400 mb-0.5"><span>Paid: {fmt(p.paidAmount)}</span><span>{pct}%</span></div>
                                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{width:`${pct}%`}}/></div>
                                      </>
                                    : <>
                                      <div className="flex justify-between text-[10px] text-slate-400 mb-0.5"><span>Paid: {fmt(p.paidAmount)}</span><span>{pct.toFixed(0)}%</span></div>
                                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{width:`${pct}%`}}/></div>
                                    </>}
                                </div>
                              )}
                              <SettlementHistory history={p.settlementHistory} label="Payment History"/>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 sm:flex-col sm:items-end">
                              <div className="text-right"><p className="text-base font-black text-red-700">{fmt(p.remainingBalance)}</p>{totalDiffersFromRemaining&&<p className="text-[10px] text-slate-400">of {fmt(p.totalAmount)}</p>}</div>
                              {canSettlePayable&&<div className="flex flex-col gap-1.5">
                                {p.isAccountingDocument&&p.latestPayoutStatus==="SETTLED"&&p.latestPayoutId&&<button onClick={()=>{setShowRevert({type:"MARKETING_CPA_PAYABLE",recordId:p.id,payoutId:p.latestPayoutId,title:p.title,amount:p.latestPayoutAmount,partyName:p.payeeName});setRevertReason("");setCorrectionMode("RETURNED_FUNDS");setEvidenceReference("");}} className="px-3 py-1.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-lg hover:bg-amber-200 whitespace-nowrap">↩ Return Latest Payment</button>}
                                <button onClick={()=>{setShowSettle(p);setSForm({amount:String(p.remainingBalance),fromAccountId:accounts[0]?.id||"",notes:"",externalPaymentReference:"",bankEvidenceReference:"",failureReason:"",payoutId:"",partial:false,adjustmentType:"NONE",adjustmentAmount:""});}} className="px-3.5 py-2 bg-slate-900 text-white text-[11px] font-bold rounded-xl hover:bg-slate-700 whitespace-nowrap shadow-sm">💳 Pay Now</button>
                              </div>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {settledP.length>0&&(
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Settled History ({settledP.length})</h3>
                  <div className="space-y-1.5">
                    {settledP.slice(0,15).map(p=>{
                      const rev = p.isAccountingDocument ? null : settlementReversions.find(r => r.originalRecordId === p.id);
                      return (
                        <div key={p.id} className={`bg-white border rounded-lg p-3 flex items-center gap-3 ${rev ? "border-amber-200 bg-amber-50/30" : "border-slate-100 opacity-60"}`}>
                          <span className="text-sm">{ICON_MAP[p.category]||"📋"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-700 truncate">{p.title}</p>
                            <p className="text-[10px] text-slate-400">{p.payeeName} • {LABEL_MAP[p.category]||p.category} • {formatDate(p.updatedAt)}</p>
                            {rev&&<p className="text-[10px] text-amber-600 mt-0.5">↩ Corrected {formatDate(rev.revertedAt)} by {rev.revertedByEmail} — {rev.revertReason}</p>}
                            {!rev&&<SettlementHistory history={p.settlementHistory} label="Settlement details"/>}
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                            {rev ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">CORRECTED</span> : <StatusBadge status="SETTLED"/>}
                            <p className="text-xs font-semibold text-slate-600">{fmt(p.paidAmount||p.totalAmount)}</p>
                            {p.isAccountingDocument&&canSettlePayable&&p.latestPayoutStatus==="SETTLED"&&p.latestPayoutId&&<button onClick={()=>{setShowRevert({type:"MARKETING_CPA_PAYABLE",recordId:p.id,payoutId:p.latestPayoutId,title:p.title,amount:p.latestPayoutAmount,partyName:p.payeeName});setRevertReason("");setCorrectionMode("RETURNED_FUNDS");setEvidenceReference("");}} className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-lg hover:bg-amber-200 border border-amber-300 whitespace-nowrap">↩ Return Latest Payment</button>}
                            {!rev&&canSettlePayable&&!p.isAccountingDocument&&<button onClick={()=>{setShowRevert({type:"PAYABLE",recordId:p.id,title:p.title,amount:p.paidAmount||p.totalAmount,partyName:p.payeeName});setRevertReason("");setCorrectionMode("");setEvidenceReference("");}} className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-lg hover:bg-amber-200 border border-amber-300 whitespace-nowrap">↩ Correct</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab==="receivables"&&(
        <div className="space-y-4">
          {openR.length===0&&settledR.length===0?(
            <div className="text-center py-16 bg-white border border-dashed border-slate-300 rounded-xl">
              <p className="text-2xl mb-2">💰</p>
              <p className="text-slate-400 text-sm">No receivables recorded yet</p>
              <p className="text-[11px] text-slate-400 mt-1">Track customer dues, supplier credits, or any money owed to you</p>
              {canCreateReceivable&&<button onClick={()=>setShowAddR(true)} className="mt-3 px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700">+ Record Receivable</button>}
            </div>
          ):(
            <>
              {openR.length>0&&(
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">Outstanding Receivables ({openR.length})</h3>
                  <div className="space-y-2.5">
                    {openR.map(r=>{
                      const over=typeof r.isOverdue==="boolean" ? r.isOverdue : isOverdue(r.dueDate);
                      const pct=r.isPartyBalance
                        ? roundedPercentFromDecimalStrings(r.receivedAmount || "0", r.totalAmount || "0")
                        : r.totalAmount>0?(r.receivedAmount/r.totalAmount)*100:0;
                      const hasReceivedAmount=r.isPartyBalance
                        ? compareDecimalStrings(r.receivedAmount || "0", "0") > 0
                        : r.receivedAmount>0;
                      const totalDiffersFromRemaining=r.isPartyBalance
                        ? compareDecimalStrings(r.totalAmount || "0", r.remainingBalance || "0") !== 0
                        : r.totalAmount!==r.remainingBalance;
                      return(
                        <div key={r.id} className={`bg-white border rounded-xl p-4 ${over?"border-amber-300 bg-amber-50/20":"border-slate-200"}`}>
                          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-base">{ICON_MAP[r.category]||"💰"}</span>
                                <p className="text-sm font-bold text-slate-900 truncate">{r.title}</p>
                                <StatusBadge status={r.status}/>
                                {over&&<span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">OVERDUE</span>}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-500">
                                <span>From: <b className="text-slate-700">{r.payerName}</b></span>
                                <span>•</span><span>{LABEL_MAP[r.category]||r.category}</span>
                                {r.dueDate&&<><span>•</span><span className={over?"text-amber-600 font-semibold":""}>Due: {formatDate(r.dueDate)}</span></>}
                              </div>
                              {r.notes&&<p className="text-[10px] text-slate-400 mt-1 truncate">{r.notes}</p>}
                              {hasReceivedAmount&&(
                                <div className="mt-2">
                                  <div className="flex justify-between text-[10px] text-slate-400 mb-0.5"><span>Received: {fmt(r.receivedAmount)}</span><span>{r.isPartyBalance?`${pct}%`:`${pct.toFixed(0)}%`}</span></div>
                                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{width:`${pct}%`}}/></div>
                                </div>
                              )}
                              <SettlementHistory
                                history={r.collectionHistory}
                                label="Collection History"
                                settlementReversions={settlementReversions}
                                canCorrectReceipt={canSettlePayable ? (receipt) => receiptAnchorInvoiceIds.get(receipt.receiptId) === r.id : undefined}
                                onCorrectReceipt={(receipt) => beginReceiptCorrection(r, receipt)}
                              />
                            </div>
                            <div className="flex items-center gap-3 shrink-0 sm:flex-col sm:items-end">
                              <div className="text-right"><p className="text-base font-black text-emerald-700">{fmt(r.remainingBalance)}</p>{totalDiffersFromRemaining&&<p className="text-[10px] text-slate-400">of {fmt(r.totalAmount)}</p>}</div>
                              {canCollectReceivable&&(r.isAccountingDocument||r.referenceType==="DELIVERY_SETTLEMENT")&&<button onClick={()=>{setShowCollect(r);setCForm({amount:String(r.remainingBalance),toAccountId:accounts[0]?.id||"",notes:"",partial:false,adjustmentType:"NONE",adjustmentAmount:"",tenderMethod:"CASH",evidenceReference:""});}} className="px-3.5 py-2 bg-emerald-700 text-white text-[11px] font-bold rounded-xl hover:bg-emerald-600 whitespace-nowrap shadow-sm">✅ Collect</button>}
                              {canCollectReceivable&&!r.isAccountingDocument&&r.referenceType!=="DELIVERY_SETTLEMENT"&&<span className="max-w-40 text-right text-[10px] text-amber-700">Receipt blocked: source invoice required</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {settledR.length>0&&(
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Collection History ({settledR.length})</h3>
                  <div className="space-y-1.5">
                    {settledR.slice(0,15).map(r => {
                      const rev = settlementReversions.find(rv => rv.reversionType !== "CUSTOMER_RECEIPT" && rv.originalRecordId === r.id);
                      return (
                        <div key={r.id} className={`bg-white border rounded-lg p-3 flex items-center gap-3 ${rev ? "border-amber-200 bg-amber-50/30" : "border-slate-100 opacity-60"}`}>
                          <span className="text-sm">{ICON_MAP[r.category]||"💰"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-700 truncate">{r.title}</p>
                            <p className="text-[10px] text-slate-400">{r.payerName} • {LABEL_MAP[r.category]||r.category} • {formatDate(r.updatedAt)}</p>
                            {rev&&<p className="text-[10px] text-amber-600 mt-0.5">↩ Corrected {formatDate(rev.revertedAt)} by {rev.revertedByEmail} — {rev.revertReason}</p>}
                            {!rev&&<SettlementHistory
                              history={r.collectionHistory}
                              label="Settlement details"
                              settlementReversions={settlementReversions}
                              canCorrectReceipt={canSettlePayable ? (receipt) => receiptAnchorInvoiceIds.get(receipt.receiptId) === r.id : undefined}
                              onCorrectReceipt={(receipt) => beginReceiptCorrection(r, receipt)}
                            />}
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                            {rev ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">CORRECTED</span> : <StatusBadge status="SETTLED"/>}
                            <p className="text-xs font-semibold text-slate-600">{fmt(r.receivedAmount||r.totalAmount)}</p>
                            {!rev&&canSettlePayable&&!r.isAccountingDocument&&<button onClick={()=>{setShowRevert({type:"RECEIVABLE",recordId:r.id,title:r.title,amount:r.receivedAmount,partyName:r.payerName});setRevertReason("");setCorrectionMode("");setEvidenceReference("");}} className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-lg hover:bg-amber-200 border border-amber-300 whitespace-nowrap">↩ Correct</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab==="transactions"&&(
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Settlement &amp; Cashflow Audit Trail</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Real-time ledger of delivery courier remittances (NCM COD), manufacturer net payouts, and direct sales collections</p>
            </div>
            <span className="text-xs font-semibold text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-lg">
              {recentTransactions.length} Record{recentTransactions.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date &amp; Time</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Party / Carrier</th>
                  <th className="px-4 py-3 font-semibold">Treasury Account</th>
                  <th className="px-4 py-3 font-semibold text-right">Settled Amount</th>
                  <th className="px-4 py-3 font-semibold">Description / Offset Memo</th>
                  <th className="px-4 py-3 font-semibold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentTransactions.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-4 py-12 text-center text-slate-400">
                      No settlement transactions recorded yet.
                    </td>
                  </tr>
                ) : (
                  recentTransactions.map((tx) => {
                    const isInflow = tx.type === "INFLOW";
                    return (
                      <tr key={tx.id} className="hover:bg-slate-50/80 transition">
                        <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                          {formatDate(tx.date)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            tx.category === "COD_REMITTANCE"
                              ? "bg-purple-100 text-purple-700 border border-purple-200"
                              : tx.category === "MARKETING_CPA_PAYOUT"
                              ? "bg-violet-100 text-violet-700 border border-violet-200"
                              : tx.category === "REFUND"
                              ? "bg-rose-100 text-rose-700 border border-rose-200"
                              : tx.category === "SUPPLIER_PAYMENT"
                              ? "bg-red-100 text-red-700 border border-red-200"
                              : "bg-emerald-100 text-emerald-700 border border-emerald-200"
                          }`}>
                            {tx.category === "COD_REMITTANCE" ? "🚚 Courier COD" : tx.category === "MARKETING_CPA_PAYOUT" ? "📣 Marketing CPA" : tx.category === "SUPPLIER_PAYMENT" ? "🏭 Mfg Net Payout" : tx.category === "REFUND" ? "↩ Refund / Correction" : "💰 Sales Margin"}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-800">
                          {tx.partyName || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <span className="font-semibold text-slate-800">{tx.accountName || "Treasury Account"}</span>
                          <span className="text-[10px] text-slate-400 block">{tx.accountType || "Account"}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-black whitespace-nowrap">
                          <span className={isInflow ? "text-emerald-700" : "text-red-700"}>
                            {isInflow ? "+ " : "- "} {fmt(tx.amount)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-sm">
                          <p className="text-xs text-slate-700 truncate">{tx.description || "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                            SETTLED
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab==="reversions"&&(
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-amber-50/40">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Settlement Reversions &amp; Reversals Audit Log</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Admin-authorized cancellations of settled payouts, collections, and remittance transactions</p>
            </div>
            <span className="text-xs font-semibold text-amber-700 bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-lg">
              {settlementReversions.length} Reversion{settlementReversions.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3 font-semibold">Corrected At</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Party / Payee</th>
                  <th className="px-4 py-3 font-semibold">Treasury Account</th>
                  <th className="px-4 py-3 font-semibold text-right">Corrected Amount</th>
                  <th className="px-4 py-3 font-semibold">Reason</th>
                  <th className="px-4 py-3 font-semibold">Authorized By</th>
                  <th className="px-4 py-3 font-semibold text-center">Restored Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settlementReversions.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-4 py-12 text-center text-slate-400">
                      No settlements have been reverted yet. All settlement operations remain intact.
                    </td>
                  </tr>
                ) : (
                  settlementReversions.map((rev) => (
                    <tr key={rev.id} className="hover:bg-amber-50/30 transition">
                      <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                        {formatDate(rev.revertedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                          {rev.reversionType}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-800">
                        {rev.partyName || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="font-semibold text-slate-800">{rev.accountName || "Treasury"}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-black whitespace-nowrap text-amber-800">
                        {fmt(rev.originalAmount)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs">
                        <p className="text-xs text-slate-700 truncate" title={rev.revertReason}>{rev.revertReason || "—"}</p>
                        <p className="text-[10px] text-slate-500">{rev.correctionMode === "VOID_NOT_EXECUTED" ? "Voided — no cash movement" : rev.correctionMode === "RETURNED_FUNDS" ? "Returned funds" : "Historical correction"}</p>
                        {rev.evidenceReference&&<p className="text-[10px] text-slate-500 truncate" title={rev.evidenceReference}>Evidence: {rev.evidenceReference}</p>}
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                        {rev.revertedByEmail || "Admin"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-blue-50 text-blue-700 border border-blue-200">
                          {rev.restoredStatus || "UNPAID"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}


      {showAddP&&(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5"><div><h2 className="text-base font-bold text-slate-900">Record New Payable</h2><p className="text-[11px] text-slate-400 mt-0.5">Record non-expense liabilities; enter supplier bills and operating expenses through their dedicated workflows.</p></div><button onClick={()=>setShowAddP(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button></div>
            <form onSubmit={createPayable} className="space-y-3.5">
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label><input required value={pForm.title} onChange={e=>setPForm({...pForm,title:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="e.g. Staff Salary September, Supplier Bill #001"/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Payee Name *</label><input required value={pForm.payeeName} onChange={e=>setPForm({...pForm,payeeName:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="Who you owe"/></div>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Category</label><select value={pForm.category} onChange={e=>setPForm({...pForm,category:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none">{PAYABLE_CATS.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Amount (Rs) *</label><input required type="text" inputMode="decimal" value={pForm.totalAmount} onChange={e=>setPForm({...pForm,totalAmount:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="0.00"/></div>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Due Date</label><input type="date" value={pForm.dueDate} onChange={e=>setPForm({...pForm,dueDate:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none"/></div>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Priority</label><select value={pForm.priority} onChange={e=>setPForm({...pForm,priority:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none">{["LOW","MEDIUM","HIGH","URGENT"].map(v=><option key={v} value={v}>{v.charAt(0)+v.slice(1).toLowerCase()}</option>)}</select></div>
              </div>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Invoice / Ref No.</label><input value={pForm.invoiceNumber} onChange={e=>setPForm({...pForm,invoiceNumber:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="Optional"/></div>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label><textarea value={pForm.notes} onChange={e=>setPForm({...pForm,notes:e.target.value})} rows={2} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="Additional details..."/></div>
              <div className="flex gap-2 pt-1"><button type="button" onClick={()=>setShowAddP(false)} className="flex-1 py-2.5 border border-slate-300 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50">Cancel</button><button type="submit" className="flex-1 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700">Record Payable</button></div>
            </form>
          </div>
        </div>
      )}

      {showAddR&&(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5"><div><h2 className="text-base font-bold text-slate-900">Record New Receivable</h2><p className="text-[11px] text-slate-400 mt-0.5">Track any money owed to you</p></div><button onClick={()=>setShowAddR(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button></div>
            <form onSubmit={createReceivable} className="space-y-3.5">
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label><input required value={rForm.title} onChange={e=>setRForm({...rForm,title:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="e.g. Customer COD Payment, Supplier Refund"/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Payer Name *</label><input required value={rForm.payerName} onChange={e=>setRForm({...rForm,payerName:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="Who owes you"/></div>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Category</label><select value={rForm.category} onChange={e=>setRForm({...rForm,category:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none">{RECEIVABLE_CATS.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Amount (Rs) *</label><input required type="number" min="1" value={rForm.totalAmount} onChange={e=>setRForm({...rForm,totalAmount:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="0"/></div>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Due Date</label><input type="date" value={rForm.dueDate} onChange={e=>setRForm({...rForm,dueDate:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none"/></div>
              </div>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label><textarea value={rForm.notes} onChange={e=>setRForm({...rForm,notes:e.target.value})} rows={2} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="Additional details..."/></div>
              <div className="flex gap-2 pt-1"><button type="button" onClick={()=>setShowAddR(false)} className="flex-1 py-2.5 border border-slate-300 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50">Cancel</button><button type="submit" className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700">Record Receivable</button></div>
            </form>
          </div>
        </div>
      )}

      {showSettle&&(
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4"><h2 className="text-base font-bold text-slate-900">Pay Payable</h2><button onClick={()=>setShowSettle(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button></div>
            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
              <div className="flex items-center gap-2 mb-1"><span>{ICON_MAP[showSettle.category]||"📋"}</span><p className="text-sm font-bold text-red-900">{showSettle.title}</p></div>
              <p className="text-[11px] text-red-700">To: <b>{showSettle.payeeName}</b> • {LABEL_MAP[showSettle.category]||showSettle.category}</p>
              <div className="flex justify-between mt-2 pt-2 border-t border-red-200"><span className="text-[11px] text-red-600">Remaining Balance:</span><span className="text-base font-black text-red-700">{fmt(showSettle.remainingBalance)}</span></div>
              {isPositiveDecimal(showSettle.paidAmount)&&<p className="text-[10px] text-red-500 mt-0.5">Previously paid: {fmt(showSettle.paidAmount)} of {fmt(showSettle.totalAmount)}</p>}
            </div>
            <form onSubmit={settlePayable} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Payment Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={setFullPayableSettlement} className={`py-2 rounded-xl text-xs font-semibold border transition-all ${!sForm.partial?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-600 border-slate-300 hover:border-slate-500"}`}>💳 Full Settlement</button>
                  <button type="button" onClick={()=>setSForm({...sForm,partial:true,amount:""})} className={`py-2 rounded-xl text-xs font-semibold border transition-all ${sForm.partial?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-600 border-slate-300 hover:border-slate-500"}`}>📝 Partial Payment</button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Cash Paid (Rs) *</label>
                <input type="text" inputMode="decimal" value={sForm.amount} onChange={e=>setSForm({...sForm,amount:e.target.value})} className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none font-semibold"/>
                <p className="text-[10px] text-slate-500 mt-1">Net settled: {settlementPreview(sForm.amount, sForm.adjustmentType, sForm.adjustmentAmount)} of {fmt(showSettle.remainingBalance)}</p>
              </div>
              {showSettle.referenceType==="MARKETING_CPA_PAYABLE" ? (
                <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  This internal-use flow records only cash paid against the CPA bill. It does not calculate or clear withholding tax. If withholding applies, do not treat a net cash payment as full bill settlement; the unpaid balance remains open pending CA-reviewed treatment.
                </p>
              ) : showSettle.referenceType==="DISTRIBUTOR_SETTLEMENT" ? (
                <p className="text-[10px] text-slate-500">Distributor settlement payouts are recorded at the approved amount; discounts and fines are not available in this payment flow.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-semibold text-slate-700 mb-1">Adjustment</label><select value={sForm.adjustmentType} onChange={e=>setPayableAdjustmentType(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl"><option value="NONE">No adjustment</option><option value="DISCOUNT">Discount received</option><option value="FINE">Fine paid</option></select></div>
                  {sForm.adjustmentType!=="NONE"&&<div><label className="block text-xs font-semibold text-slate-700 mb-1">Adjustment Amount (Rs)</label><input type="text" inputMode="decimal" value={sForm.adjustmentAmount} onChange={e=>setPayableAdjustmentAmount(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl"/></div>}
                </div>
              )}
              <AccountSelector accounts={accounts} value={sForm.fromAccountId} onChange={id=>setSForm({...sForm,fromAccountId:id})} label="Pay From Account *" helpText="Select the cash drawer or bank account to pay from" forPayment={true}/>
              <div><label className="block text-xs font-semibold text-slate-700 mb-1">{showSettle.referenceType==="MARKETING_CPA_PAYABLE" ? "Payment instruction / voucher reference" : "Transfer instruction reference"} {requiresExternalPaymentReference ? "*" : "(optional)"}</label><input maxLength={191} required={requiresExternalPaymentReference} value={sForm.externalPaymentReference} onChange={e=>setSForm({...sForm,externalPaymentReference:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="Reference used when initiating the payment"/></div>
              {["DISTRIBUTOR_SETTLEMENT", "MARKETING_CPA_PAYABLE"].includes(showSettle.referenceType) && sForm.payoutId && (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-900">Payout initiated; funds are reserved. Confirm only after checking the payment evidence.</p>
                  <label className="block text-xs font-semibold text-slate-700">Payment evidence reference *
                    <input maxLength={191} value={sForm.bankEvidenceReference} onChange={e=>setSForm({...sForm,bankEvidenceReference:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Statement line ID or evidence record reference"/>
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">Failure reason (only if transfer failed)
                    <input maxLength={2000} value={sForm.failureReason} onChange={e=>setSForm({...sForm,failureReason:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Required only when marking transfer failed"/>
                  </label>
                </div>
              )}
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Reference / Notes</label><input value={sForm.notes} onChange={e=>setSForm({...sForm,notes:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="e.g. Bank transfer, Cheque #1234"/></div>
              {insuff&&<div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">⚠️ Insufficient balance in <b>{selAcc?.accountName}</b>. Available: {fmt(selAcc?.currentBalance)}, required: {fmt(sForm.amount)}.</div>}
              <div className="flex gap-2 pt-1">
                <button type="button" disabled={sLoading} onClick={()=>setShowSettle(null)} className="flex-1 py-2.5 border border-slate-300 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                {["DISTRIBUTOR_SETTLEMENT", "MARKETING_CPA_PAYABLE"].includes(showSettle.referenceType) && sForm.payoutId && <button type="button" disabled={sLoading || !sForm.failureReason.trim()} onClick={failInitiatedPayout} className="flex-1 py-2.5 border border-rose-300 text-rose-700 text-sm font-semibold rounded-xl hover:bg-rose-50 disabled:opacity-50">Mark Failed</button>}
                <button type="submit" disabled={sLoading} className="flex-1 py-2.5 bg-slate-900 disabled:bg-slate-400 text-white text-sm font-bold rounded-xl hover:bg-slate-700 cursor-pointer disabled:cursor-not-allowed shadow-sm transition">
                  {sLoading ? "Processing..." : ["DISTRIBUTOR_SETTLEMENT", "MARKETING_CPA_PAYABLE"].includes(showSettle.referenceType) ? (sForm.payoutId ? "Confirm Settled" : "Initiate Payout") : "Confirm Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCollect&&(
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4"><h2 className="text-base font-bold text-slate-900">{showCollect.isAccountingDocument?"Record Customer Receipt":"Collect Receivable"}</h2><button onClick={()=>setShowCollect(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button></div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 mb-5">
              <div className="flex items-center gap-2 mb-1"><span>{ICON_MAP[showCollect.category]||"💰"}</span><p className="text-sm font-bold text-emerald-900">{showCollect.title}</p></div>
              <p className="text-[11px] text-emerald-700">From: <b>{showCollect.payerName}</b> • {LABEL_MAP[showCollect.category]||showCollect.category}</p>
              <div className="flex justify-between mt-2 pt-2 border-t border-emerald-200"><span className="text-[11px] text-emerald-700">Remaining Balance:</span><span className="text-base font-black text-emerald-700">{fmt(showCollect.remainingBalance)}</span></div>
              {showCollect.isAccountingDocument&&<p className="mt-1 text-[10px] text-emerald-700">Invoice: {showCollect.invoiceNumber} · Receipt is recorded only for the actual amount received.</p>}
              {showCollect.receivedAmount>0&&<p className="text-[10px] text-emerald-600 mt-0.5">Previously collected: {fmt(showCollect.receivedAmount)} of {fmt(showCollect.totalAmount)}</p>}
            </div>
            <form onSubmit={collectReceivable} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Collection Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={setFullReceivableSettlement} className={`py-2 rounded-xl text-xs font-semibold border transition-all ${!cForm.partial?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-600 border-slate-300 hover:border-slate-500"}`}>✅ Full Settlement</button>
                  <button type="button" onClick={()=>setCForm({...cForm,partial:true,amount:""})} className={`py-2 rounded-xl text-xs font-semibold border transition-all ${cForm.partial?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-600 border-slate-300 hover:border-slate-500"}`}>📝 Partial Collection</button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Cash Received (Rs) *</label>
                <input type="text" inputMode="decimal" value={cForm.amount} onChange={e=>setCForm({...cForm,amount:e.target.value})} className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none font-semibold"/>
                <p className="text-[10px] text-slate-500 mt-1">Net settled: {settlementPreview(cForm.amount, cForm.adjustmentType, cForm.adjustmentAmount)} of {fmt(showCollect.remainingBalance)}</p>
              </div>
              {["DELIVERY_SETTLEMENT","MANUFACTURER_DIRECT"].includes(showCollect.referenceType) ? (
                <p className="text-[10px] text-slate-500">This receivable uses a dedicated settlement flow; additional adjustments are not available here.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-semibold text-slate-700 mb-1">Adjustment</label><select value={cForm.adjustmentType} onChange={e=>setReceivableAdjustmentType(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl"><option value="NONE">No adjustment</option><option value="DISCOUNT">Discount given</option><option value="FINE">Fine received</option></select></div>
                  {cForm.adjustmentType!=="NONE"&&<div><label className="block text-xs font-semibold text-slate-700 mb-1">Adjustment Amount (Rs)</label><input type="text" inputMode="decimal" value={cForm.adjustmentAmount} onChange={e=>setReceivableAdjustmentAmount(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl"/></div>}
                </div>
              )}
              {showCollect.isAccountingDocument&&(
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-semibold text-slate-700 mb-1">Tender Method *</label><select value={cForm.tenderMethod} onChange={e=>setCForm({...cForm,tenderMethod:e.target.value})} className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl"><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="WALLET">Digital wallet</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></div>
                  <div><label className="block text-xs font-semibold text-slate-700 mb-1">Receipt Evidence / Reference *</label><input value={cForm.evidenceReference} onChange={e=>setCForm({...cForm,evidenceReference:e.target.value})} className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl" maxLength={191} required placeholder="Receipt number or transfer reference"/></div>
                </div>
              )}
              <AccountSelector accounts={accounts} value={cForm.toAccountId} onChange={id=>setCForm({...cForm,toAccountId:id})} label="Deposit Into Account *" helpText="Select where to receive the collected amount" forPayment={false}/>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Collection Notes</label><input value={cForm.notes} onChange={e=>setCForm({...cForm,notes:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="e.g. Cash received, eSewa transfer ref #"/></div>
              <div className="flex gap-2 pt-1">
                <button type="button" disabled={cLoading} onClick={()=>setShowCollect(null)} className="flex-1 py-2.5 border border-slate-300 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={cLoading} className="flex-1 py-2.5 bg-emerald-700 disabled:bg-slate-400 text-white text-sm font-bold rounded-xl hover:bg-emerald-600 cursor-pointer disabled:cursor-not-allowed shadow-sm transition">
                  {cLoading ? "Processing Collection..." : "Confirm Collection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPayMfg&&(
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Pay Manufacturer (Net Settlement)</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Disburse net production balance (COGS less direct sales margin)</p>
              </div>
              <button onClick={()=>setShowPayMfg(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
            </div>

            <div className="bg-slate-900 text-white rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-100">🏭 {activeMfgObj.name || "Select Manufacturer"}</span>
                <span className="text-[10px] font-bold text-slate-300 bg-slate-800 px-2 py-0.5 rounded-full uppercase">
                  {activeMfgObj.city || "Hub"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block">Approved COGS</span>
                  <span className="font-bold text-slate-200">{fmt(activeMfgCogs)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Direct Margin</span>
                  <span className="font-bold text-red-300">- {fmt(activeMfgDirectReceivable)}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-emerald-300 block font-bold">Net Payout Due</span>
                  <span className="font-black text-emerald-400 text-sm">{fmt(activeMfgNetPayable)}</span>
                </div>
              </div>
              {compareDecimalStrings(activeMfgOffset, "0") > 0 && (
                <p className="text-[10px] text-slate-300 mt-2.5 bg-slate-800/80 p-2 rounded-lg border border-slate-700">
                  ⚖️ <b>Bilateral Netting:</b> {fmt(activeMfgOffset)} direct margin owed to admin is automatically deducted from COGS payout.
                </p>
              )}
            </div>

            <form onSubmit={payManufacturerSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Manufacturer *</label>
                <select
                  value={mfgPayForm.manufacturerId}
                  onChange={(e) => {
                    const mId = e.target.value;
                    const selectedMfg = mfgList.find(m => m.id === mId) || {};
                    const cogs = String(selectedMfg.remainingPayable ?? selectedMfg.payable ?? "0");
                    const direct = String(selectedMfg.receivable ?? "0");
                    const net = maxZeroDecimalString(subtractDecimalStrings(cogs, direct));
                    setMfgPayForm({
                      ...mfgPayForm,
                      manufacturerId: mId,
                      amount: compareDecimalStrings(net, "0") > 0 ? net : cogs,
                    });
                  }}
                  className="w-full px-3 py-2.5 text-xs font-semibold border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none"
                >
                  {mfgList.map((m) => {
                    const c = String(m.remainingPayable ?? m.payable ?? "0");
                    const d = String(m.receivable ?? "0");
                    const n = maxZeroDecimalString(subtractDecimalStrings(c, d));
                    return (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.city || "Hub"}) — Net Due: {fmt(n)} (COGS: {fmt(c)}, Direct: {fmt(d)})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Payment Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMfgPayForm({ ...mfgPayForm, partial: false, amount: compareDecimalStrings(activeMfgNetPayable, "0") > 0 ? activeMfgNetPayable : activeMfgCogs })}
                    className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                      !mfgPayForm.partial ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
                    }`}
                  >
                    💳 Full Net Settlement
                  </button>
                  <button
                    type="button"
                    onClick={() => setMfgPayForm({ ...mfgPayForm, partial: true, amount: "" })}
                    className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                      mfgPayForm.partial ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
                    }`}
                  >
                    📝 Custom / Partial
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Disbursement Amount (Rs) *</label>
                <input
                  type="number"
                  min="1"
                  max={compareDecimalStrings(activeMfgNetPayable, "0") > 0 ? activeMfgNetPayable : activeMfgCogs}
                  value={mfgPayForm.amount}
                  onChange={(e) => setMfgPayForm({ ...mfgPayForm, amount: e.target.value })}
                  readOnly={!mfgPayForm.partial}
                  className={`w-full px-3 py-2.5 text-sm border rounded-xl focus:ring-2 focus:ring-slate-900 outline-none font-semibold ${
                    mfgPayForm.partial ? "border-slate-300" : "border-slate-200 bg-slate-50"
                  }`}
                  placeholder="0"
                />
                {mfgPayForm.partial && (
                  <p className="text-[10px] text-slate-400 mt-0.5">Maximum net outstanding: {fmt(compareDecimalStrings(activeMfgNetPayable, "0") > 0 ? activeMfgNetPayable : activeMfgCogs)}</p>
                )}
              </div>

              <AccountSelector
                accounts={accounts}
                value={mfgPayForm.fromAccountId}
                onChange={(id) => setMfgPayForm({ ...mfgPayForm, fromAccountId: id })}
                label="Pay From Treasury Account *"
                helpText="Liquid cash or bank account to debit funds from"
                forPayment={true}
              />

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Transfer instruction reference *</label>
                <input
                  required
                  maxLength={191}
                  value={mfgPayForm.externalPaymentReference || ""}
                  onChange={(e) => setMfgPayForm({ ...mfgPayForm, externalPaymentReference: e.target.value })}
                  readOnly={Boolean(mfgPayForm.payoutId)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none"
                  placeholder="Reference used for the transfer instruction"
                />
              </div>

              {mfgPayForm.payoutId && (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-900">Payout initiated; funds are reserved. Confirm settlement only after verifying the bank transaction.</p>
                  <label className="block text-xs font-semibold text-slate-700">Bank statement / transfer evidence reference *
                    <input maxLength={191} value={mfgPayForm.bankEvidenceReference} onChange={(e) => setMfgPayForm({ ...mfgPayForm, bankEvidenceReference: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Statement line ID or evidence record reference"/>
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">Failure reason (only if transfer failed)
                    <input maxLength={2000} value={mfgPayForm.failureReason} onChange={(e) => setMfgPayForm({ ...mfgPayForm, failureReason: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Required only when marking transfer failed"/>
                  </label>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Reference / Payout Notes</label>
                <input
                  value={mfgPayForm.notes}
                  onChange={(e) => setMfgPayForm({ ...mfgPayForm, notes: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none"
                  placeholder="e.g. Bank Transfer, Cheque, Batch Net Settlement"
                />
              </div>

              {mfgInsuff && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  ⚠️ Insufficient balance in <b>{selMfgAcc?.accountName}</b>. Available: {fmt(selMfgAcc?.currentBalance)}, required: {fmt(mfgPayForm.amount)}.
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={mfgLoading}
                  onClick={() => setShowPayMfg(false)}
                  className="flex-1 py-2.5 border border-slate-300 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                {mfgPayForm.payoutId && <button type="button" disabled={mfgLoading || !mfgPayForm.failureReason.trim()} onClick={failManufacturerPayout} className="flex-1 rounded-xl border border-rose-300 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Mark Failed</button>}
                <button
                  type="submit"
                  disabled={mfgLoading || mfgInsuff || !isPositiveDecimal(mfgPayForm.amount)}
                  className="flex-1 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white text-sm font-bold rounded-xl hover:bg-slate-800 cursor-pointer disabled:cursor-not-allowed shadow-sm transition"
                >
                  {mfgLoading ? "Processing..." : mfgPayForm.payoutId ? "Confirm Settled" : "Initiate Payout"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRevert&&(
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 border border-amber-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="p-2 bg-amber-100 text-amber-800 rounded-xl text-lg">↩</span>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Correct Settlement</h2>
                  <p className="text-[11px] text-amber-700 font-medium">Admin Authorization Required</p>
                </div>
              </div>
              <button onClick={() => setShowRevert(null)} className="text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
            </div>

            <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 mb-4 text-xs text-slate-700 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Record:</span>
                <span className="font-bold text-slate-900">{showRevert.title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Party:</span>
                <span className="font-semibold text-slate-800">{showRevert.partyName || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{showRevert.type==="MARKETING_CPA_PAYABLE" ? "Cash Allocated:" : "Settled Amount:"}</span>
                <span className="font-black text-amber-800">{fmt(showRevert.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Correction Type:</span>
                <span className="font-bold text-slate-700">{showRevert.type}</span>
              </div>
              <p className="text-[10px] text-amber-800 font-medium pt-1 border-t border-amber-200">
                Correcting requires evidence and atomically restores the source balance, treasury register, and linked accounting journal. A confirmed payout cannot be voided as unexecuted.
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Correction type *</label>
              <select
                required
                value={correctionMode}
                onChange={(event) => setCorrectionMode(event.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
              >
                {showRevert.type!=="MARKETING_CPA_PAYABLE"&&<option value="">Select a correction type</option>}
                {showRevert.type!=="MARKETING_CPA_PAYABLE"&&<option value="VOID_NOT_EXECUTED">Void an erroneous record — cash never moved</option>}
                <option value="RETURNED_FUNDS">Record returned funds — money moved back</option>
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {correctionMode === "VOID_NOT_EXECUTED" ? "Evidence reference confirming no transfer *" : "Bank/payment evidence reference *"}
              </label>
              <input
                required
                value={evidenceReference}
                onChange={(event) => setEvidenceReference(event.target.value)}
                maxLength={191}
                placeholder="Bank statement, reversal notice, or reconciliation reference"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reason for Correction *
              </label>
              <textarea
                rows={3}
                required
                value={revertReason}
                onChange={(e) => setRevertReason(e.target.value)}
                placeholder="Explain why the recorded settlement needs correction..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none resize-none"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={revertLoading}
                onClick={() => setShowRevert(null)}
                className="flex-1 py-2.5 border border-slate-300 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={revertLoading || !revertReason.trim() || !correctionMode || !evidenceReference.trim()}
                onClick={revertSettlement}
                className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl transition cursor-pointer disabled:cursor-not-allowed shadow-sm"
              >
                {revertLoading ? "Correcting..." : "Confirm Correction"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
PayablesReceivables.propTypes = { token: PropTypes.string.isRequired };

export default PayablesReceivables;
