/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";

const TreasuryCash = ({ token }) => {
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionPagination, setTransactionPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showDirectEntry, setShowDirectEntry] = useState(false);

  // Form states
  const [newAccount, setNewAccount] = useState({
    accountName: "",
    accountType: "BANK",
    accountNumber: "",
    bankName: "",
    initialBalance: "",
  });

  const [transferData, setTransferData] = useState({
    fromAccountId: "",
    toAccountId: "",
    amount: "",
    description: "",
  });

  const [directEntry, setDirectEntry] = useState({
    type: "INFLOW", // INFLOW or OUTFLOW
    accountId: "",
    amount: "",
    partyName: "",
    invoiceNumber: "",
    category: "CAPITAL_INJECTION",
    description: "",
  });

  const fetchData = async (page = 1) => {
    try {
      setLoading(true);
      const [accRes, txRes] = await Promise.all([
        axios.get(`${backendUrl}/api/finance/treasury-accounts`, { headers: { token } }),
        axios.get(`${backendUrl}/api/finance/cash-transactions`, {
          headers: { token },
          params: { page, limit: 12 },
        }),
      ]);

      if (accRes.data.success) setAccounts(accRes.data.accounts || []);
      if (txRes.data.success) {
        setTransactions(txRes.data.transactions || []);
        setTransactionPagination(txRes.data.pagination || { page, total: 0, totalPages: 0 });
        setTransactionPage(page);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load treasury data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchData();
  }, [token]);

  const handleCreateAccount = async (e) => {
    e.preventDefault();
    if (!newAccount.accountName) return toast.warn("Account name is required");
    try {
      const res = await axios.post(`${backendUrl}/api/finance/create-account`, newAccount, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success("Account created successfully");
        setShowAddAccount(false);
        setNewAccount({ accountName: "", accountType: "BANK", accountNumber: "", bankName: "", initialBalance: "" });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const handleTransfer = async (e) => {
    e.preventDefault();
    if (!transferData.fromAccountId || !transferData.toAccountId) {
      return toast.warn("Please select both source and destination accounts");
    }
    if (!transferData.amount || Number(transferData.amount) <= 0) {
      return toast.warn("Please enter a valid transfer amount");
    }
    try {
      const res = await axios.post(
        `${backendUrl}/api/finance/cash-transfer`,
        { ...transferData, type: "TRANSFER" },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Fund transfer completed");
        setShowTransfer(false);
        setTransferData({ fromAccountId: "", toAccountId: "", amount: "", description: "" });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const handleDirectEntry = async (e) => {
    e.preventDefault();
    if (!directEntry.accountId || !directEntry.amount) {
      return toast.warn("Account and amount are required");
    }
    try {
      const payload = {
        type: directEntry.type,
        amount: directEntry.amount,
        partyName: directEntry.partyName,
        invoiceNumber: directEntry.invoiceNumber,
        category: directEntry.category,
        description: directEntry.description,
        fromAccountId: directEntry.type === "OUTFLOW" ? directEntry.accountId : null,
        toAccountId: directEntry.type === "INFLOW" ? directEntry.accountId : null,
      };
      const res = await axios.post(`${backendUrl}/api/finance/cash-transfer`, payload, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success(`${directEntry.type} recorded successfully`);
        setShowDirectEntry(false);
        setDirectEntry({
          type: "INFLOW",
          accountId: "",
          amount: "",
          partyName: "",
          invoiceNumber: "",
          category: "CAPITAL_INJECTION",
          description: "",
        });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const totalLiquid = accounts.reduce((acc, a) => acc + Number(a.currentBalance || 0), 0);

  return (
    <div className="space-y-8 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200/60">
              Liquid Cash &amp; Treasury
            </span>
            <span className="text-xs font-medium text-slate-400">Multi-Account Vault</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 mt-1">Treasury &amp; Cash Accounts</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time liquid cash management, inter-account bank transfers, and audit logs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowTransfer(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-xs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span>Transfer Funds</span>
          </button>

          <button
            onClick={() => setShowDirectEntry(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 transition-colors shadow-xs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            <span>Direct Entry (Inflow/Outflow)</span>
          </button>

          <button
            onClick={() => setShowAddAccount(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200 transition-colors"
          >
            <span>+ Add Account</span>
          </button>
        </div>
      </div>

      {/* TOTAL LIQUIDITY SUMMARY BANNER */}
      <div className="p-6 bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-900 text-white rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
            Total Live Liquid Liquidity
          </p>
          <p className="text-3xl font-black mt-1">
            {currency}{totalLiquid.toLocaleString()}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Across {accounts.length} active cash in hand, bank accounts, digital wallets &amp; escrow accounts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="text-xs font-medium text-emerald-300">Live Solvency Synchronized</span>
        </div>
      </div>

      {/* ACCOUNTS GRID */}
      {accounts.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200/80 shadow-xs text-center">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-sm font-bold text-slate-900">No Treasury Accounts Configured</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            You have not registered any cash in hand, bank accounts, or digital wallets yet.
          </p>
          <button
            onClick={() => setShowAddAccount(true)}
            className="mt-4 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-xs"
          >
            + Add First Account
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-all"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      acc.accountType === "CASH"
                        ? "bg-amber-50 text-amber-700"
                        : acc.accountType === "BANK"
                        ? "bg-blue-50 text-blue-700"
                        : acc.accountType === "WALLET"
                        ? "bg-purple-50 text-purple-700"
                        : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {acc.accountType}
                  </span>
                  {acc.isDefault && (
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Default</span>
                  )}
                </div>

                <h3 className="text-sm font-bold text-slate-900 mt-3">{acc.accountName}</h3>
                {acc.bankName && <p className="text-xs text-slate-400">{acc.bankName}</p>}
                {acc.accountNumber && (
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5">{acc.accountNumber}</p>
                )}
              </div>

              <div className="mt-6 pt-3 border-t border-slate-100 flex items-baseline justify-between">
                <span className="text-[11px] text-slate-400 font-medium">Balance</span>
                <span className="text-lg font-black text-slate-900">
                  {currency}{(Number(acc.currentBalance) || 0).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* RECENT TRANSACTIONS LOG */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Treasury Transaction Log</h2>
            <p className="text-xs text-slate-400">Chronological history of inflows, outflows, and transfers</p>
          </div>
          <span className="text-xs text-slate-400 font-semibold">{transactionPagination.total} Records</span>
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-100">
                <th className="p-3">Date</th>
                <th className="p-3">Type</th>
                <th className="p-3">Category</th>
                <th className="p-3">From / To Account</th>
                <th className="p-3">Description</th>
                <th className="p-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-6 text-center text-slate-400 font-medium">
                    No transactions recorded yet.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-3 font-mono text-slate-500">
                      {new Date(tx.date).toLocaleDateString()}
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          tx.type === "INFLOW"
                            ? "bg-emerald-50 text-emerald-700"
                            : tx.type === "OUTFLOW"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="p-3 font-medium text-slate-800">{tx.category}</td>
                    <td className="p-3 text-slate-600">
                      {tx.type === "TRANSFER"
                        ? `${tx.fromAccount?.accountName || "Account"} ➔ ${tx.toAccount?.accountName || "Account"}`
                        : tx.type === "INFLOW"
                        ? tx.toAccount?.accountName || "—"
                        : tx.fromAccount?.accountName || "—"}
                    </td>
                    <td className="p-3 text-slate-500 max-w-xs truncate">{tx.description || "—"}</td>
                    <td
                      className={`p-3 text-right font-bold ${
                        tx.type === "INFLOW"
                          ? "text-emerald-600"
                          : tx.type === "OUTFLOW"
                          ? "text-rose-600"
                          : "text-blue-600"
                      }`}
                    >
                      {tx.type === "OUTFLOW" ? "-" : "+"}
                      {currency}{Number(tx.amount).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-4 text-xs text-slate-500">
          <span>Page {transactionPage} of {Math.max(transactionPagination.totalPages, 1)}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fetchData(transactionPage - 1)}
              disabled={transactionPage <= 1}
              className="px-3 py-1.5 border border-slate-200 rounded disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => fetchData(transactionPage + 1)}
              disabled={!transactionPagination.hasNextPage}
              className="px-3 py-1.5 border border-slate-200 rounded disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* MODAL: ADD ACCOUNT */}
      {showAddAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Add Treasury Account</h3>
              <button onClick={() => setShowAddAccount(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAccount} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Account Name *</label>
                <input
                  type="text"
                  placeholder="e.g. NIC Asia Business Current A/C"
                  value={newAccount.accountName}
                  onChange={(e) => setNewAccount({ ...newAccount, accountName: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Account Type</label>
                  <select
                    value={newAccount.accountType}
                    onChange={(e) => setNewAccount({ ...newAccount, accountType: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  >
                    <option value="BANK">Bank Account</option>
                    <option value="CASH">Cash in Hand</option>
                    <option value="WALLET">Digital Wallet (eSewa/Khalti)</option>
                    <option value="ESCROW">Courier COD Escrow</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Opening Balance ({currency})</label>
                  <input
                    type="number"
                    placeholder="0"
                    value={newAccount.initialBalance}
                    onChange={(e) => setNewAccount({ ...newAccount, initialBalance: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Bank Name (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Nabil Bank Ltd"
                  value={newAccount.bankName}
                  onChange={(e) => setNewAccount({ ...newAccount, bankName: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Account / Wallet Number (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. 0192839201923"
                  value={newAccount.accountNumber}
                  onChange={(e) => setNewAccount({ ...newAccount, accountNumber: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddAccount(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800"
                >
                  Save Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: TRANSFER FUNDS */}
      {showTransfer && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Transfer Funds Between Accounts</h3>
              <button onClick={() => setShowTransfer(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleTransfer} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Source Account (From) *</label>
                <select
                  value={transferData.fromAccountId}
                  onChange={(e) => setTransferData({ ...transferData, fromAccountId: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  required
                >
                  <option value="">Select source account...</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountName} ({currency}{Number(a.currentBalance).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Destination Account (To) *</label>
                <select
                  value={transferData.toAccountId}
                  onChange={(e) => setTransferData({ ...transferData, toAccountId: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  required
                >
                  <option value="">Select destination account...</option>
                  {accounts
                    .filter((a) => a.id !== transferData.fromAccountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountName} ({currency}{Number(a.currentBalance).toLocaleString()})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Transfer Amount ({currency}) *</label>
                <input
                  type="number"
                  placeholder="50000"
                  value={transferData.amount}
                  onChange={(e) => setTransferData({ ...transferData, amount: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Note / Description</label>
                <input
                  type="text"
                  placeholder="e.g. Cash register deposit to bank"
                  value={transferData.description}
                  onChange={(e) => setTransferData({ ...transferData, description: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowTransfer(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800"
                >
                  Execute Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DIRECT ENTRY */}
      {showDirectEntry && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Direct Inflow / Outflow Entry</h3>
              <button onClick={() => setShowDirectEntry(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            {(() => {
              const selectedAcc = accounts.find((a) => a.id === directEntry.accountId);
              const isOverdraft = directEntry.type === "OUTFLOW" && selectedAcc && Number(selectedAcc.currentBalance || 0) < Number(directEntry.amount || 0);

              return (
                <form onSubmit={handleDirectEntry} className="space-y-4 mt-4 text-xs">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Entry Type</label>
                      <select
                        value={directEntry.type}
                        onChange={(e) => setDirectEntry({ ...directEntry, type: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                      >
                        <option value="INFLOW">🟢 Cash Inflow (+)</option>
                        <option value="OUTFLOW">🔴 Cash Outflow (-)</option>
                      </select>
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Target Account *</label>
                      <select
                        value={directEntry.accountId}
                        onChange={(e) => setDirectEntry({ ...directEntry, accountId: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                        required
                      >
                        <option value="">Select account...</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.accountName} ({currency}{Number(a.currentBalance || 0).toLocaleString()})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Category</label>
                      <select
                        value={directEntry.category}
                        onChange={(e) => setDirectEntry({ ...directEntry, category: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                      >
                        {directEntry.type === "INFLOW" ? (
                          <>
                            <option value="CAPITAL_INJECTION">Owner Capital Injection</option>
                            <option value="SALES">Direct Sales Income</option>
                            <option value="LOAN_DISBURSEMENT">Loan Received</option>
                            <option value="MISC_INFLOW">Other Income</option>
                          </>
                        ) : (
                          <>
                            <option value="EXPENSE">Direct Operating Expense</option>
                            <option value="DRAWINGS">Owner / Partner Drawings</option>
                            <option value="LOAN_REPAYMENT">Loan Principal Repayment</option>
                            <option value="SUPPLIER_PAYMENT">Vendor Direct Settlement</option>
                          </>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Amount ({currency}) *</label>
                      <input
                        type="number"
                        placeholder="10000"
                        value={directEntry.amount}
                        onChange={(e) => setDirectEntry({ ...directEntry, amount: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-mono font-bold"
                        required
                      />
                    </div>
                  </div>

                  {/* Party Name & Invoice Number */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">
                        {directEntry.type === "OUTFLOW" ? "Payee / Paid To *" : "Payer / Received From *"}
                      </label>
                      <input
                        type="text"
                        placeholder={directEntry.type === "OUTFLOW" ? "e.g. WorldLink ISP / Landlord" : "e.g. Angel Investor / Client"}
                        value={directEntry.partyName}
                        onChange={(e) => setDirectEntry({ ...directEntry, partyName: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                        required
                      />
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Invoice / Receipt Ref #</label>
                      <input
                        type="text"
                        placeholder="e.g. REC-2026-004"
                        value={directEntry.invoiceNumber}
                        onChange={(e) => setDirectEntry({ ...directEntry, invoiceNumber: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-mono"
                      />
                    </div>
                  </div>

                  {/* Solvency feedback */}
                  {isOverdraft && (
                    <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-bold">
                      ⚠️ Insufficient liquid funds! Account has {currency}{Number(selectedAcc?.currentBalance || 0).toLocaleString()} available, but {currency}{Number(directEntry.amount || 0).toLocaleString()} requested. Outflow cannot proceed without available capital.
                    </div>
                  )}

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Description / Memo</label>
                    <input
                      type="text"
                      placeholder="e.g. Monthly internet bandwidth bill"
                      value={directEntry.description}
                      onChange={(e) => setDirectEntry({ ...directEntry, description: e.target.value })}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowDirectEntry(false)}
                      className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isOverdraft}
                      className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Record Entry
                    </button>
                  </div>
                </form>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default TreasuryCash;
