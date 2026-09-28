/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";

const fmt = (n) => `${currency}${Number(n || 0).toLocaleString("en-NP", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const formatDate = (d) => { if (!d) return "—"; return new Date(d).toLocaleDateString("en-NP", { year: "numeric", month: "short", day: "numeric" }); };
const isOverdue = (dueDate) => { if (!dueDate) return false; return new Date(dueDate) < new Date(); };

const PAYABLE_CATS = [
  { value: "SUPPLIER_INVOICE", label: "Supplier Invoice" },
  { value: "OPERATING_EXPENSE", label: "Operating Expense" },
  { value: "SALARY_PAYABLE", label: "Salary / Wages Payable" },
  { value: "SALARIES", label: "Salaries (Staff)" },
  { value: "ASSET_PURCHASE", label: "Asset Purchase" },
  { value: "PARTNER_DISTRIBUTION", label: "Partner Distribution / Payout" },
  { value: "TAX_DUE", label: "Tax / VAT Due" },
  { value: "LOAN_NOTE", label: "Loan Repayment Note" },
  { value: "RENT", label: "Rent / Lease Payable" },
  { value: "UTILITIES", label: "Utilities Payable" },
  { value: "OTHER", label: "Other Liability" },
];
const RECEIVABLE_CATS = [
  { value: "CUSTOMER_RECEIVABLE", label: "Customer Due / Pending COD" },
  { value: "SUPPLIER_DEBIT_REFUND", label: "Supplier Credit / Refund" },
  { value: "TAX_REFUND_CREDIT", label: "Tax Refund / Credit Note" },
  { value: "LOAN_RECEIVABLE", label: "Loan Given Out" },
  { value: "ADVANCE_PAYMENT", label: "Advance Given to Employee" },
  { value: "OTHER", label: "Other Receivable" },
];
const LABEL_MAP = {
  SUPPLIER_INVOICE:"Supplier Invoice",OPERATING_EXPENSE:"Operating Expense",SALARY_PAYABLE:"Salary Payable",
  SALARIES:"Salaries",ASSET_PURCHASE:"Asset Purchase",PARTNER_DISTRIBUTION:"Partner Payout",
  TAX_DUE:"Tax Due",LOAN_NOTE:"Loan Note",RENT:"Rent Payable",UTILITIES:"Utilities",OTHER:"Other",
  CUSTOMER_RECEIVABLE:"Customer Due",SUPPLIER_DEBIT_REFUND:"Supplier Credit",
  TAX_REFUND_CREDIT:"Tax Credit",LOAN_RECEIVABLE:"Loan Given",ADVANCE_PAYMENT:"Advance Given",
};
const ICON_MAP = {
  SALARY_PAYABLE:"👷",SALARIES:"👷",SUPPLIER_INVOICE:"📦",OPERATING_EXPENSE:"⚙️",
  ASSET_PURCHASE:"🏢",PARTNER_DISTRIBUTION:"🤝",TAX_DUE:"🏛️",LOAN_NOTE:"🏦",
  RENT:"🏠",UTILITIES:"⚡",OTHER:"📋",
  CUSTOMER_RECEIVABLE:"🛍️",SUPPLIER_DEBIT_REFUND:"↩️",TAX_REFUND_CREDIT:"💰",
  LOAN_RECEIVABLE:"💳",ADVANCE_PAYMENT:"👤",
};

const StatusBadge = ({ status }) => {
  const m = { UNPAID:"bg-red-100 text-red-700",PARTIALLY_PAID:"bg-amber-100 text-amber-700",PARTIALLY_RECEIVED:"bg-amber-100 text-amber-700",SETTLED:"bg-emerald-100 text-emerald-700",CANCELLED:"bg-slate-100 text-slate-500" };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border border-transparent ${m[status]||"bg-slate-100 text-slate-500"}`}>{status?.replace(/_/g," ")}</span>;
};
const PriorityBadge = ({ priority }) => {
  if (!priority) return null;
  const m = { LOW:"bg-slate-100 text-slate-500",MEDIUM:"bg-blue-100 text-blue-700",HIGH:"bg-orange-100 text-orange-700",URGENT:"bg-red-100 text-red-700 animate-pulse" };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${m[priority]||"bg-slate-100 text-slate-500"}`}>{priority}</span>;
};
const SettlementHistory = ({ history, label="History" }) => {
  const rows = Array.isArray(history)?history:(()=>{try{return JSON.parse(history||"[]");}catch{return [];}})();
  if (!rows.length) return null;
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      {rows.map(h=>(
        <div key={h.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-2.5 py-1.5 text-[11px] mb-0.5">
          <span className="text-slate-600"><b>{h.accountName}</b><span className="text-slate-400 ml-1">{formatDate(h.date)}</span>{h.notes?<span className="text-slate-400 ml-1">• {h.notes}</span>:null}</span>
          <span className="font-bold text-slate-900">{fmt(h.amount)}</span>
        </div>
      ))}
    </div>
  );
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

const PayablesReceivables = ({ token }) => {
  const [data, setData]     = useState(null);
  const [mfgSummary, setMfgSummary] = useState(null);
  const [range, setRange]   = useState("month");
  const [loading, setLoading] = useState(true);
  const [tab, setTab]       = useState("payables");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("ALL");
  const [showAddP, setShowAddP]   = useState(false);
  const [showAddR, setShowAddR]   = useState(false);
  const [showSettle, setShowSettle]   = useState(null);
  const [showCollect, setShowCollect] = useState(null);

  const emptyP = { title:"",payeeName:"",category:"OPERATING_EXPENSE",totalAmount:"",dueDate:"",invoiceNumber:"",priority:"MEDIUM",notes:"" };
  const emptyR = { title:"",payerName:"",category:"CUSTOMER_RECEIVABLE",totalAmount:"",dueDate:"",invoiceNumber:"",notes:"" };
  const [pForm, setPForm] = useState(emptyP);
  const [rForm, setRForm] = useState(emptyR);
  const [sForm, setSForm] = useState({ amount:"",fromAccountId:"",notes:"",partial:false });
  const [cForm, setCForm] = useState({ amount:"",toAccountId:"",notes:"",partial:false });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/finance/payables-receivables`,{headers:{token}});
      if (res.data.success) setData(res.data.data); else toast.error(res.data.message);
    } catch { toast.error("Failed to load payables & receivables"); }
    finally { setLoading(false); }
  },[token]);

  const fetchMfg = useCallback(async (r) => {
    try {
      const res = await axios.get(`${backendUrl}/api/finance/manufacturer-summary`,{headers:{token},params:{range:r}});
      if (res.data.success) setMfgSummary(res.data.data);
    } catch {}
  },[token]);

  useEffect(()=>{ if(token){fetchData();fetchMfg(range);} },[token]);
  useEffect(()=>{ if(token) fetchMfg(range); },[range,token]);

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
    const amt=Number(sForm.amount);
    if (!sForm.fromAccountId||!amt) return toast.warn("Amount and account required");
    if (amt>showSettle.remainingBalance) return toast.warn("Exceeds remaining balance");
    const acc=accounts.find(a=>a.id===sForm.fromAccountId);
    if (acc&&acc.currentBalance<amt) return toast.warn(`Insufficient balance in ${acc.accountName} (Available: ${fmt(acc.currentBalance)})`);
    try {
      const res = await axios.post(`${backendUrl}/api/finance/settle-payable`,{payableId:showSettle.id,amount:amt,fromAccountId:sForm.fromAccountId,notes:sForm.notes},{headers:{token}});
      if (res.data.success){toast.success(res.data.message);setShowSettle(null);setSForm({amount:"",fromAccountId:"",notes:"",partial:false});fetchData();}
      else toast.error(res.data.message);
    } catch(e){toast.error(e.response?.data?.message||e.message);}
  };
  const collectReceivable = async (e) => {
    e.preventDefault();
    const amt=Number(cForm.amount);
    if (!cForm.toAccountId||!amt) return toast.warn("Amount and account required");
    if (amt>showCollect.remainingBalance) return toast.warn("Exceeds remaining balance");
    try {
      const res = await axios.post(`${backendUrl}/api/finance/collect-receivable`,{receivableId:showCollect.id,amount:amt,toAccountId:cForm.toAccountId,notes:cForm.notes},{headers:{token}});
      if (res.data.success){toast.success(res.data.message);setShowCollect(null);setCForm({amount:"",toAccountId:"",notes:"",partial:false});fetchData();}
      else toast.error(res.data.message);
    } catch(err){toast.error(err.response?.data?.message||err.message);}
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
  const mfgData   = mfgSummary?.summary || {};
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
  const allOpenP=allP.filter(p=>p.status!=="SETTLED"&&p.status!=="CANCELLED");
  const allOpenR=allR.filter(r=>r.status!=="SETTLED"&&r.status!=="CANCELLED");
  const selAcc=accounts.find(a=>a.id===sForm.fromAccountId);
  const insuff=selAcc&&Number(sForm.amount)>0&&selAcc.currentBalance<Number(sForm.amount);

  return (
    <div className="space-y-6">

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Accounts Payable &amp; Receivable</h1>
          <p className="text-xs text-slate-500 mt-0.5">Track salary, supplier bills, and all liabilities or assets owed to / by you.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>setShowAddP(true)} className="px-3 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 flex items-center gap-1.5 shadow-sm">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
            Record Payable
          </button>
          <button onClick={()=>setShowAddR(true)} className="px-3 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 flex items-center gap-1.5 shadow-sm">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
            Record Receivable
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-red-200 rounded-xl p-4"><p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">Payables Due</p><p className="text-lg font-black text-red-700 mt-1">{fmt(metrics.totalPayablesOutstanding)}</p><p className="text-[10px] text-slate-400 mt-0.5">{allOpenP.length} unpaid items</p></div>
        <div className="bg-white border border-emerald-200 rounded-xl p-4"><p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Receivables Due</p><p className="text-lg font-black text-emerald-700 mt-1">{fmt(metrics.totalReceivablesOutstanding)}</p><p className="text-[10px] text-slate-400 mt-0.5">{allOpenR.length} pending items</p></div>
        <div className="bg-white border border-blue-200 rounded-xl p-4"><p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider">Liquid Cash</p><p className="text-lg font-black text-blue-700 mt-1">{fmt(metrics.totalLiquidCash)}</p><p className="text-[10px] text-slate-400 mt-0.5">{accounts.length} account{accounts.length!==1?"s":""}</p></div>
        <div className={`bg-white border rounded-xl p-4 ${metrics.canCoverAllPayablesNow?"border-emerald-200":"border-red-200"}`}><p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Net Pressure</p><p className={`text-lg font-black mt-1 ${(metrics.netPayablePressure||0)>0?"text-red-700":"text-emerald-700"}`}>{(metrics.netPayablePressure||0)>0?`-${fmt(metrics.netPayablePressure)}`:fmt(Math.abs(metrics.netPayablePressure||0))}</p><p className="text-[10px] mt-0.5">{metrics.canCoverAllPayablesNow?<span className="text-emerald-600 font-medium">✅ Can settle all</span>:<span className="text-red-600 font-medium">⚠️ Shortfall</span>}</p></div>
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

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Manufacturer Summary</p><h2 className="text-base font-bold text-slate-900">Payables &amp; receivables by manufacturer</h2></div>
          <div className="flex flex-wrap gap-2">
            {[{v:"day",l:"Today"},{v:"week",l:"7 Days"},{v:"month",l:"Month"},{v:"quarter",l:"3 Months"},{v:"year",l:"Year"}].map(o=>(
              <button key={o.v} onClick={()=>setRange(o.v)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${range===o.v?"bg-slate-900 text-white":"bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{o.l}</button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="bg-red-50 border border-red-200 rounded-xl p-3"><p className="text-[10px] uppercase tracking-wider text-red-600">Payable</p><p className="mt-1 text-xl font-black text-red-700">{fmt(mfgData.payable||0)}</p></div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3"><p className="text-[10px] uppercase tracking-wider text-emerald-600">Receivable</p><p className="mt-1 text-xl font-black text-emerald-700">{fmt(mfgData.receivable||0)}</p></div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3"><p className="text-[10px] uppercase tracking-wider text-blue-600">Net Receivable</p><p className="mt-1 text-xl font-black text-blue-700">{fmt(mfgData.netReceivable||0)}</p></div>
          <div className="bg-slate-100 border border-slate-200 rounded-xl p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Sold/Delivered/Returned</p><p className="mt-1 text-lg font-black text-slate-800">{mfgData.itemsSold||0}/{mfgData.itemsDelivered||0}/{mfgData.itemsReturned||0}</p></div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600"><tr>{["Order","Status","Qty","Sales","Payable","Receivable"].map(h=><th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {mfgOrders.length===0?<tr><td colSpan="6" className="px-3 py-6 text-center text-slate-400">No manufacturer order activity in this period.</td></tr>:mfgOrders.map(o=>(
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-700">{o.id.slice(0,8)}</td>
                  <td className="px-3 py-2"><span className={`inline-flex px-2 py-1 rounded-full text-[10px] font-bold ${String(o.status||"").toLowerCase().includes("deliver")?"bg-emerald-100 text-emerald-700":String(o.status||"").toLowerCase().includes("return")?"bg-amber-100 text-amber-700":"bg-slate-100 text-slate-700"}`}>{o.status||"Pending"}</span></td>
                  <td className="px-3 py-2 text-slate-700">{o.quantity}</td>
                  <td className="px-3 py-2 text-slate-700">{fmt(o.amount)}</td>
                  <td className="px-3 py-2 text-red-700 font-semibold">{fmt(o.payable)}</td>
                  <td className="px-3 py-2 text-emerald-700 font-semibold">{fmt(o.receivable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1"><svg className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by title or party name..." className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-900 outline-none"/></div>
        <select value={catFilter} onChange={e=>setCatFilter(e.target.value)} className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-900 outline-none">
          <option value="ALL">All Categories</option>
          {[...PAYABLE_CATS,...RECEIVABLE_CATS.filter(c=>!PAYABLE_CATS.find(p=>p.value===c.value))].map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button onClick={fetchData} className="px-3 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>Refresh</button>
      </div>

      <div className="border-b border-slate-200">
        <div className="flex">
          <button onClick={()=>setTab("payables")} className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition-all ${tab==="payables"?"border-red-600 text-red-700 bg-red-50/50":"border-transparent text-slate-500 hover:text-slate-700"}`}>Payables (You Owe){allOpenP.length>0&&<span className="ml-1.5 bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full text-[10px]">{allOpenP.length}</span>}</button>
          <button onClick={()=>setTab("receivables")} className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition-all ${tab==="receivables"?"border-emerald-600 text-emerald-700 bg-emerald-50/50":"border-transparent text-slate-500 hover:text-slate-700"}`}>Receivables (Owed to You){allOpenR.length>0&&<span className="ml-1.5 bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full text-[10px]">{allOpenR.length}</span>}</button>
        </div>
      </div>


      {tab==="payables"&&(
        <div className="space-y-4">
          {openP.length===0&&settledP.length===0?(
            <div className="text-center py-16 bg-white border border-dashed border-slate-300 rounded-xl">
              <p className="text-2xl mb-2">📋</p>
              <p className="text-slate-500 text-sm font-medium">No payables found</p>
              <p className="text-[11px] text-slate-400 mt-1">Record salary, supplier invoices, rent, or any liability you owe</p>
              <button onClick={()=>setShowAddP(true)} className="mt-3 px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700">+ Record Payable</button>
            </div>
          ):(
            <>
              {openP.length>0&&(
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">Outstanding Payables ({openP.length})</h3>
                  <div className="space-y-2.5">
                    {openP.map(p=>{
                      const over=isOverdue(p.dueDate);
                      const pct=p.totalAmount>0?(p.paidAmount/p.totalAmount)*100:0;
                      return(
                        <div key={p.id} className={`bg-white border rounded-xl p-4 ${over?"border-red-300 bg-red-50/20":"border-slate-200"}`}>
                          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-base">{ICON_MAP[p.category]||"📋"}</span>
                                <p className="text-sm font-bold text-slate-900 truncate">{p.title}</p>
                                <StatusBadge status={p.status}/><PriorityBadge priority={p.priority}/>
                                {over&&<span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full animate-pulse">OVERDUE</span>}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-500">
                                <span>To: <b className="text-slate-700">{p.payeeName}</b></span>
                                <span>•</span><span>{LABEL_MAP[p.category]||p.category}</span>
                                {p.dueDate&&<><span>•</span><span className={over?"text-red-600 font-semibold":""}>Due: {formatDate(p.dueDate)}</span></>}
                                {p.invoiceNumber&&<><span>•</span><span>Inv: {p.invoiceNumber}</span></>}
                              </div>
                              {p.notes&&<p className="text-[10px] text-slate-400 mt-1 truncate">{p.notes}</p>}
                              {p.paidAmount>0&&(
                                <div className="mt-2">
                                  <div className="flex justify-between text-[10px] text-slate-400 mb-0.5"><span>Paid: {fmt(p.paidAmount)}</span><span>{pct.toFixed(0)}%</span></div>
                                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{width:`${pct}%`}}/></div>
                                </div>
                              )}
                              <SettlementHistory history={p.settlementHistory} label="Payment History"/>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 sm:flex-col sm:items-end">
                              <div className="text-right"><p className="text-base font-black text-red-700">{fmt(p.remainingBalance)}</p>{p.totalAmount!==p.remainingBalance&&<p className="text-[10px] text-slate-400">of {fmt(p.totalAmount)}</p>}</div>
                              <button onClick={()=>{setShowSettle(p);setSForm({amount:String(p.remainingBalance),fromAccountId:accounts[0]?.id||"",notes:"",partial:false});}} className="px-3.5 py-2 bg-slate-900 text-white text-[11px] font-bold rounded-xl hover:bg-slate-700 whitespace-nowrap shadow-sm">💳 Pay Now</button>
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
                    {settledP.slice(0,15).map(p=>(
                      <div key={p.id} className="bg-white border border-slate-100 rounded-lg p-3 flex items-center gap-3 opacity-60">
                        <span className="text-sm">{ICON_MAP[p.category]||"📋"}</span>
                        <div className="flex-1 min-w-0"><p className="text-xs font-medium text-slate-700 truncate">{p.title}</p><p className="text-[10px] text-slate-400">{p.payeeName} • {LABEL_MAP[p.category]||p.category} • {formatDate(p.updatedAt)}</p></div>
                        <div className="text-right shrink-0"><StatusBadge status="SETTLED"/><p className="text-xs font-semibold text-slate-600 mt-0.5">{fmt(p.totalAmount)}</p></div>
                      </div>
                    ))}
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
              <button onClick={()=>setShowAddR(true)} className="mt-3 px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700">+ Record Receivable</button>
            </div>
          ):(
            <>
              {openR.length>0&&(
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">Outstanding Receivables ({openR.length})</h3>
                  <div className="space-y-2.5">
                    {openR.map(r=>{
                      const over=isOverdue(r.dueDate);
                      const pct=r.totalAmount>0?(r.receivedAmount/r.totalAmount)*100:0;
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
                              {r.receivedAmount>0&&(
                                <div className="mt-2">
                                  <div className="flex justify-between text-[10px] text-slate-400 mb-0.5"><span>Received: {fmt(r.receivedAmount)}</span><span>{pct.toFixed(0)}%</span></div>
                                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{width:`${pct}%`}}/></div>
                                </div>
                              )}
                              <SettlementHistory history={r.collectionHistory} label="Collection History"/>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 sm:flex-col sm:items-end">
                              <div className="text-right"><p className="text-base font-black text-emerald-700">{fmt(r.remainingBalance)}</p>{r.totalAmount!==r.remainingBalance&&<p className="text-[10px] text-slate-400">of {fmt(r.totalAmount)}</p>}</div>
                              <button onClick={()=>{setShowCollect(r);setCForm({amount:String(r.remainingBalance),toAccountId:accounts[0]?.id||"",notes:"",partial:false});}} className="px-3.5 py-2 bg-emerald-700 text-white text-[11px] font-bold rounded-xl hover:bg-emerald-600 whitespace-nowrap shadow-sm">✅ Collect</button>
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
                    {settledR.slice(0,15).map(r=>(
                      <div key={r.id} className="bg-white border border-slate-100 rounded-lg p-3 flex items-center gap-3 opacity-60">
                        <span className="text-sm">{ICON_MAP[r.category]||"💰"}</span>
                        <div className="flex-1 min-w-0"><p className="text-xs font-medium text-slate-700 truncate">{r.title}</p><p className="text-[10px] text-slate-400">{r.payerName} • {LABEL_MAP[r.category]||r.category} • {formatDate(r.updatedAt)}</p></div>
                        <div className="text-right shrink-0"><StatusBadge status="SETTLED"/><p className="text-xs font-semibold text-slate-600 mt-0.5">{fmt(r.totalAmount)}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}


      {showAddP&&(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5"><div><h2 className="text-base font-bold text-slate-900">Record New Payable</h2><p className="text-[11px] text-slate-400 mt-0.5">Record salary, bills, rent, or any liability</p></div><button onClick={()=>setShowAddP(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button></div>
            <form onSubmit={createPayable} className="space-y-3.5">
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label><input required value={pForm.title} onChange={e=>setPForm({...pForm,title:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="e.g. Staff Salary September, Supplier Bill #001"/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Payee Name *</label><input required value={pForm.payeeName} onChange={e=>setPForm({...pForm,payeeName:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="Who you owe"/></div>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Category</label><select value={pForm.category} onChange={e=>setPForm({...pForm,category:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none">{PAYABLE_CATS.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Amount (Rs) *</label><input required type="number" min="1" value={pForm.totalAmount} onChange={e=>setPForm({...pForm,totalAmount:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="0"/></div>
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
              {showSettle.paidAmount>0&&<p className="text-[10px] text-red-500 mt-0.5">Previously paid: {fmt(showSettle.paidAmount)} of {fmt(showSettle.totalAmount)}</p>}
            </div>
            <form onSubmit={settlePayable} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Payment Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={()=>setSForm({...sForm,partial:false,amount:String(showSettle.remainingBalance)})} className={`py-2 rounded-xl text-xs font-semibold border transition-all ${!sForm.partial?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-600 border-slate-300 hover:border-slate-500"}`}>💳 Full Payment</button>
                  <button type="button" onClick={()=>setSForm({...sForm,partial:true,amount:""})} className={`py-2 rounded-xl text-xs font-semibold border transition-all ${sForm.partial?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-600 border-slate-300 hover:border-slate-500"}`}>📝 Partial Payment</button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Amount (Rs) *</label>
                <input type="number" min="1" max={showSettle.remainingBalance} value={sForm.amount} onChange={e=>setSForm({...sForm,amount:e.target.value})} readOnly={!sForm.partial} className={`w-full px-3 py-2.5 text-sm border rounded-xl focus:ring-2 focus:ring-slate-900 outline-none font-semibold ${sForm.partial?"border-slate-300":"border-slate-200 bg-slate-50"}`}/>
                {sForm.partial&&<p className="text-[10px] text-slate-400 mt-0.5">Max: {fmt(showSettle.remainingBalance)}</p>}
              </div>
              <AccountSelector accounts={accounts} value={sForm.fromAccountId} onChange={id=>setSForm({...sForm,fromAccountId:id})} label="Pay From Account *" helpText="Select the cash drawer or bank account to pay from" forPayment={true}/>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Reference / Notes</label><input value={sForm.notes} onChange={e=>setSForm({...sForm,notes:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="e.g. Bank transfer, Cheque #1234"/></div>
              {insuff&&<div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">⚠️ Insufficient balance in <b>{selAcc?.accountName}</b>. Available: {fmt(selAcc?.currentBalance)}, required: {fmt(sForm.amount)}.</div>}
              <div className="flex gap-2 pt-1"><button type="button" onClick={()=>setShowSettle(null)} className="flex-1 py-2.5 border border-slate-300 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50">Cancel</button><button type="submit" className="flex-1 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-700">Confirm Payment</button></div>
            </form>
          </div>
        </div>
      )}

      {showCollect&&(
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4"><h2 className="text-base font-bold text-slate-900">Collect Receivable</h2><button onClick={()=>setShowCollect(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button></div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 mb-5">
              <div className="flex items-center gap-2 mb-1"><span>{ICON_MAP[showCollect.category]||"💰"}</span><p className="text-sm font-bold text-emerald-900">{showCollect.title}</p></div>
              <p className="text-[11px] text-emerald-700">From: <b>{showCollect.payerName}</b> • {LABEL_MAP[showCollect.category]||showCollect.category}</p>
              <div className="flex justify-between mt-2 pt-2 border-t border-emerald-200"><span className="text-[11px] text-emerald-700">Remaining Balance:</span><span className="text-base font-black text-emerald-700">{fmt(showCollect.remainingBalance)}</span></div>
              {showCollect.receivedAmount>0&&<p className="text-[10px] text-emerald-600 mt-0.5">Previously collected: {fmt(showCollect.receivedAmount)} of {fmt(showCollect.totalAmount)}</p>}
            </div>
            <form onSubmit={collectReceivable} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Collection Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={()=>setCForm({...cForm,partial:false,amount:String(showCollect.remainingBalance)})} className={`py-2 rounded-xl text-xs font-semibold border transition-all ${!cForm.partial?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-600 border-slate-300 hover:border-slate-500"}`}>✅ Full Collection</button>
                  <button type="button" onClick={()=>setCForm({...cForm,partial:true,amount:""})} className={`py-2 rounded-xl text-xs font-semibold border transition-all ${cForm.partial?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-600 border-slate-300 hover:border-slate-500"}`}>📝 Partial Collection</button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Collection Amount (Rs) *</label>
                <input type="number" min="1" max={showCollect.remainingBalance} value={cForm.amount} onChange={e=>setCForm({...cForm,amount:e.target.value})} readOnly={!cForm.partial} className={`w-full px-3 py-2.5 text-sm border rounded-xl focus:ring-2 focus:ring-slate-900 outline-none font-semibold ${cForm.partial?"border-slate-300":"border-slate-200 bg-slate-50"}`}/>
                {cForm.partial&&<p className="text-[10px] text-slate-400 mt-0.5">Max: {fmt(showCollect.remainingBalance)}</p>}
              </div>
              <AccountSelector accounts={accounts} value={cForm.toAccountId} onChange={id=>setCForm({...cForm,toAccountId:id})} label="Deposit Into Account *" helpText="Select where to receive the collected amount" forPayment={false}/>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Collection Notes</label><input value={cForm.notes} onChange={e=>setCForm({...cForm,notes:e.target.value})} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none" placeholder="e.g. Cash received, eSewa transfer ref #"/></div>
              <div className="flex gap-2 pt-1"><button type="button" onClick={()=>setShowCollect(null)} className="flex-1 py-2.5 border border-slate-300 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50">Cancel</button><button type="submit" className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-bold rounded-xl hover:bg-emerald-600">Confirm Collection</button></div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default PayablesReceivables;
