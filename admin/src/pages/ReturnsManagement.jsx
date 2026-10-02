/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";
import ExchangeRequestsPanel from "../components/ExchangeRequestsPanel";
import CustomerReturnRequestsPanel from "../components/CustomerReturnRequestsPanel";

const ReturnsManagement = ({ token }) => {
  const [activeTab, setActiveTab] = useState("CUSTOMER"); // CUSTOMER or SUPPLIER
  const [customerReturns, setCustomerReturns] = useState([]);
  const [supplierReturns, setSupplierReturns] = useState([]);
  const [products, setProducts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);

  // Forms
  const [customerForm, setCustomerForm] = useState({
    orderId: "",
    customerName: "",
    customerPhone: "",
    refundMethod: "CASH",
    refundFromAccountId: "",
    inventoryAction: "RESTOCKED", // RESTOCKED, WRITTEN_OFF_DAMAGED
    reason: "Size mismatch",
    notes: "",
    items: [{ productId: "", name: "", size: "M", color: "Black", quantity: 1, unitPrice: "", refundAmount: "", condition: "RESTOCKABLE" }],
  });

  const [supplierForm, setSupplierForm] = useState({
    shipmentBatchId: "",
    supplierName: "",
    settlementType: "CREDIT_NOTE_OFFSET_PAYABLE",
    depositAccountId: "",
    reason: "Defective fabric batch",
    notes: "",
    items: [{ productId: "", name: "", quantity: 1, unitCostPrice: "" }],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const [custRes, suppRes, prodRes, accRes] = await Promise.all([
        axios.get(`${backendUrl}/api/returns/customer/list`, { headers: { token } }),
        axios.get(`${backendUrl}/api/returns/supplier/list`, { headers: { token } }),
        axios.get(`${backendUrl}/api/product/list`),
        axios.get(`${backendUrl}/api/finance/treasury-accounts`, { headers: { token } }),
      ]);

      if (custRes.data.success) setCustomerReturns(custRes.data.returns || []);
      if (suppRes.data.success) setSupplierReturns(suppRes.data.returns || []);
      if (prodRes.data.success) setProducts(prodRes.data.products || []);
      if (accRes.data.success) setAccounts(accRes.data.accounts || []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load returns data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchData();
  }, [token]);

  // Customer Return Items Handler
  const handleProductSelectCustomer = (idx, pId) => {
    const prod = products.find((p) => p.id === pId || p._id === pId);
    if (!prod) return;
    const updated = [...customerForm.items];
    updated[idx] = {
      ...updated[idx],
      productId: prod.id || prod._id,
      name: prod.name,
      unitPrice: prod.price,
      refundAmount: prod.price * updated[idx].quantity,
    };
    setCustomerForm({ ...customerForm, items: updated });
  };

  const handleQtyChangeCustomer = (idx, qty) => {
    const updated = [...customerForm.items];
    const q = Math.max(1, Number(qty || 1));
    updated[idx].quantity = q;
    updated[idx].refundAmount = Number(updated[idx].unitPrice || 0) * q;
    setCustomerForm({ ...customerForm, items: updated });
  };

  const handleAddCustomerItem = () => {
    setCustomerForm({
      ...customerForm,
      items: [...customerForm.items, { productId: "", name: "", size: "M", color: "Black", quantity: 1, unitPrice: "", refundAmount: "", condition: "RESTOCKABLE" }],
    });
  };

  const handleRemoveCustomerItem = (idx) => {
    if (customerForm.items.length === 1) return;
    setCustomerForm({ ...customerForm, items: customerForm.items.filter((_, i) => i !== idx) });
  };

  const handleSubmitCustomerReturn = async (e) => {
    e.preventDefault();
    if (!customerForm.orderId) return toast.warn("Order ID is required to create a return request");
    if (!customerForm.items[0].productId) return toast.warn("Please select at least one product");

    try {
      const res = await axios.post(`${backendUrl}/api/returns/customer/create`, customerForm, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success("Return request created. Review and approve it to submit to NCM.");
        setShowCustomerModal(false);
        setCustomerForm({
          orderId: "",
          customerName: "",
          customerPhone: "",
          refundMethod: "CASH",
          refundFromAccountId: "",
          inventoryAction: "RESTOCKED",
          reason: "Size mismatch",
          notes: "",
          items: [{ productId: "", name: "", size: "M", color: "Black", quantity: 1, unitPrice: "", refundAmount: "", condition: "RESTOCKABLE" }],
        });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  // Supplier Return Handler
  const handleProductSelectSupplier = (idx, pId) => {
    const prod = products.find((p) => p.id === pId || p._id === pId);
    if (!prod) return;
    const updated = [...supplierForm.items];
    updated[idx] = {
      ...updated[idx],
      productId: prod.id || prod._id,
      name: prod.name,
      unitCostPrice: prod.costPrice || 0,
    };
    setSupplierForm({ ...supplierForm, items: updated });
  };

  const handleQtyChangeSupplier = (idx, qty) => {
    const updated = [...supplierForm.items];
    updated[idx].quantity = Math.max(1, Number(qty || 1));
    setSupplierForm({ ...supplierForm, items: updated });
  };

  const handleAddSupplierItem = () => {
    setSupplierForm({
      ...supplierForm,
      items: [...supplierForm.items, { productId: "", name: "", quantity: 1, unitCostPrice: "" }],
    });
  };

  const handleRemoveSupplierItem = (idx) => {
    if (supplierForm.items.length === 1) return;
    setSupplierForm({ ...supplierForm, items: supplierForm.items.filter((_, i) => i !== idx) });
  };

  const handleSubmitSupplierReturn = async (e) => {
    e.preventDefault();
    if (!supplierForm.supplierName) return toast.warn("Supplier name is required");
    if (!supplierForm.items[0].productId) return toast.warn("Please select at least one product");

    try {
      const res = await axios.post(`${backendUrl}/api/returns/supplier/create`, supplierForm, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success(res.data.message);
        setShowSupplierModal(false);
        setSupplierForm({
          shipmentBatchId: "",
          supplierName: "",
          settlementType: "CREDIT_NOTE_OFFSET_PAYABLE",
          depositAccountId: "",
          reason: "Defective fabric batch",
          notes: "",
          items: [{ productId: "", name: "", quantity: 1, unitCostPrice: "" }],
        });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const totalCustomerRefunds = customerReturns
    .filter((record) => record.refundStatus === "COMPLETED")
    .reduce((acc, record) => acc + Number(record.totalRefundAmount || 0), 0);
  const totalSupplierDebits = supplierReturns.reduce((acc, r) => acc + Number(r.totalDebitAmount || 0), 0);

  return (
    <div className="space-y-8 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 rounded-lg border border-rose-200/60">
              RMA &amp; Debit Notes Suite
            </span>
            <span className="text-xs font-medium text-slate-400">Stock &amp; Ledger Synchronized</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 mt-1">Returns &amp; Debit Notes Management</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Handle customer returns (restock vs damage scrap loss) and supplier return claims (debit notes).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowCustomerModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-rose-600 text-white text-xs font-bold rounded-xl hover:bg-rose-700 transition-colors shadow-xs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" />
            </svg>
            <span>+ Customer Return (RMA)</span>
          </button>

          <button
            onClick={() => setShowSupplierModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-xs"
          >
            <span>+ Supplier Return (Debit Note)</span>
          </button>
        </div>
      </div>

      {/* SUMMARY BANNER */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Customer Refunds (RMA)</p>
            <p className="text-2xl font-black text-rose-600 mt-1">
              {currency}{totalCustomerRefunds.toLocaleString()}
            </p>
            <p className="text-xs text-slate-400 mt-1">{customerReturns.length} customer return records</p>
          </div>
          <span className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </span>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Supplier Debit Claims</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">
              {currency}{totalSupplierDebits.toLocaleString()}
            </p>
            <p className="text-xs text-slate-400 mt-1">{supplierReturns.length} supplier debit notes</p>
          </div>
          <span className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
        </div>
      </div>

      {/* TABS */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <button
            onClick={() => setActiveTab("CUSTOMER")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeTab === "CUSTOMER"
                ? "bg-rose-600 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Customer Returns &amp; RMA ({customerReturns.length})
          </button>
          <button
            onClick={() => setActiveTab("SUPPLIER")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeTab === "SUPPLIER"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Supplier Returns &amp; Debit Notes ({supplierReturns.length})
          </button>
          <button
            onClick={() => setActiveTab("EXCHANGE")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeTab === "EXCHANGE"
                ? "bg-blue-700 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Customer Exchanges
          </button>
        </div>

        {activeTab === "CUSTOMER" && <CustomerReturnRequestsPanel token={token} />}

        {activeTab === "EXCHANGE" ? (
          <ExchangeRequestsPanel token={token} />
        ) : activeTab === "CUSTOMER" ? (
          /* CUSTOMER RETURNS TABLE */
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-100">
                  <th className="p-3">RMA ID &amp; Date</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Items Returned</th>
                  <th className="p-3">Inventory Action</th>
                  <th className="p-3">Reason</th>
                  <th className="p-3 text-right">Refund Amount</th>
                  <th className="p-3 text-right">13% VAT Reversed</th>
                  <th className="p-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {customerReturns.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="p-6 text-center text-slate-400 font-medium">
                      No customer returns processed yet.
                    </td>
                  </tr>
                ) : (
                  customerReturns.map((ret) => {
                    let items = [];
                    try {
                      items = typeof ret.items === "string" ? JSON.parse(ret.items) : (ret.items || []);
                    } catch {
                      items = [];
                    }
                    return (
                      <tr key={ret.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-3">
                          <p className="font-mono font-bold text-slate-900">RMA-{ret.id.slice(0, 8)}</p>
                          <p className="text-[10px] text-slate-400">{new Date(ret.returnDate).toLocaleDateString()}</p>
                        </td>
                        <td className="p-3">
                          <p className="font-bold text-slate-900">{ret.customerName}</p>
                          <p className="text-[10px] text-slate-400">{ret.customerPhone}</p>
                        </td>
                        <td className="p-3">
                          {items.map((it, i) => (
                            <p key={i} className="text-slate-700">
                              {it.name} <span className="text-slate-400">({it.quantity}x {it.size || ""})</span>
                            </p>
                          ))}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              ret.inventoryAction === "RESTOCKED"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {ret.inventoryAction === "RESTOCKED" ? "📦 Restocked to Inventory" : "🔥 Damaged Scrap Loss"}
                          </span>
                        </td>
                        <td className="p-3 text-slate-600">{ret.reason}</td>
                        <td className="p-3 text-right font-black text-rose-600">
                          {currency}{Number(ret.totalRefundAmount).toLocaleString()}
                        </td>
                        <td className="p-3 text-right text-slate-500 font-mono">
                          {currency}{Number(ret.vatRefunded).toLocaleString()}
                        </td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                            {ret.refundStatus}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* SUPPLIER RETURNS TABLE */
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-100">
                  <th className="p-3">Debit Note ID &amp; Date</th>
                  <th className="p-3">Supplier Name</th>
                  <th className="p-3">Returned Items</th>
                  <th className="p-3">Settlement Type</th>
                  <th className="p-3">Reason</th>
                  <th className="p-3 text-right">Debit Amount</th>
                  <th className="p-3 text-right">Input VAT Reversal</th>
                  <th className="p-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {supplierReturns.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="p-6 text-center text-slate-400 font-medium">
                      No supplier debit notes recorded yet.
                    </td>
                  </tr>
                ) : (
                  supplierReturns.map((ret) => {
                    let items = [];
                    try {
                      items = typeof ret.items === "string" ? JSON.parse(ret.items) : (ret.items || []);
                    } catch {
                      items = [];
                    }
                    return (
                      <tr key={ret.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-3">
                          <p className="font-mono font-bold text-slate-900">DN-{ret.id.slice(0, 8)}</p>
                          <p className="text-[10px] text-slate-400">{new Date(ret.returnDate).toLocaleDateString()}</p>
                        </td>
                        <td className="p-3 font-bold text-slate-900">{ret.supplierName}</td>
                        <td className="p-3">
                          {items.map((it, i) => (
                            <p key={i} className="text-slate-700">
                              {it.name} <span className="text-slate-400">({it.quantity}x @ {currency}{it.unitCostPrice})</span>
                            </p>
                          ))}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                            {ret.settlementType}
                          </span>
                        </td>
                        <td className="p-3 text-slate-600">{ret.reason}</td>
                        <td className="p-3 text-right font-black text-emerald-600">
                          {currency}{Number(ret.totalDebitAmount).toLocaleString()}
                        </td>
                        <td className="p-3 text-right text-slate-500 font-mono">
                          {currency}{Number(ret.vatReversal).toLocaleString()}
                        </td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                            {ret.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: CREATE CUSTOMER RETURN */}
      {showCustomerModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Create Customer Return Request</h3>
              <button onClick={() => setShowCustomerModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleSubmitCustomerReturn} className="space-y-4 mt-4 text-xs">
              <label className="block font-semibold text-slate-700">Delivered order ID *
                <input type="text" required value={customerForm.orderId} onChange={(event) => setCustomerForm({ ...customerForm, orderId: event.target.value })} className="mt-1 w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900" placeholder="Paste the customer's delivered order ID" />
              </label>
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">Creating this RMA does not refund the customer or change inventory. Admin approval, NCM return handoff, parcel receipt, and inspection are required first.</p>

              {/* Items Section */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">Returned Products</span>
                  <button
                    type="button"
                    onClick={handleAddCustomerItem}
                    className="text-xs text-rose-600 font-bold hover:underline"
                  >
                    + Add Another Product
                  </button>
                </div>

                {customerForm.items.map((item, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 space-y-2">
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-6">
                        <label className="text-[10px] text-slate-500 block mb-0.5">Select Product</label>
                        <select
                          value={item.productId}
                          onChange={(e) => handleProductSelectCustomer(idx, e.target.value)}
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-hidden text-xs"
                          required
                        >
                          <option value="">Choose product...</option>
                          {products.map((p) => (
                            <option key={p.id || p._id} value={p.id || p._id}>
                              {p.name} ({currency}{p.price})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="col-span-3">
                        <label className="text-[10px] text-slate-500 block mb-0.5">Qty</label>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleQtyChangeCustomer(idx, e.target.value)}
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-hidden text-xs"
                        />
                      </div>

                      <div className="col-span-3 flex items-end justify-between">
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-0.5">Refund ({currency})</label>
                          <p className="p-2 font-bold text-rose-600">{currency}{Number(item.refundAmount || 0).toLocaleString()}</p>
                        </div>
                        {customerForm.items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomerItem(idx)}
                            className="text-slate-400 hover:text-rose-600 p-2"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Pay Refund Out of Treasury Account (Optional)</label>
                <select
                  value={customerForm.refundFromAccountId}
                  onChange={(e) => setCustomerForm({ ...customerForm, refundFromAccountId: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                >
                  <option value="">Do not deduct treasury cash automatically</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountName} ({currency}{Number(a.currentBalance).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Reason for Return</label>
                <input
                  type="text"
                  placeholder="e.g. Size was too small, requested exchange/refund"
                  value={customerForm.reason}
                  onChange={(e) => setCustomerForm({ ...customerForm, reason: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCustomerModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700"
                >
                  Process RMA &amp; Refund
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE SUPPLIER RETURN (DEBIT NOTE) */}
      {showSupplierModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Create Supplier Debit Note</h3>
              <button onClick={() => setShowSupplierModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleSubmitSupplierReturn} className="space-y-4 mt-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Supplier / Factory Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Nepal Garments Ltd"
                    value={supplierForm.supplierName}
                    onChange={(e) => setSupplierForm({ ...supplierForm, supplierName: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                    required
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Settlement Type</label>
                  <select
                    value={supplierForm.settlementType}
                    onChange={(e) => setSupplierForm({ ...supplierForm, settlementType: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  >
                    <option value="CREDIT_NOTE_OFFSET_PAYABLE">Offset Against Accounts Payable</option>
                    <option value="CASH_REFUND">Cash / Bank Refund from Supplier</option>
                  </select>
                </div>
              </div>

              {/* Items Section */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">Returned Inventory Products</span>
                  <button
                    type="button"
                    onClick={handleAddSupplierItem}
                    className="text-xs text-indigo-600 font-bold hover:underline"
                  >
                    + Add Another Product
                  </button>
                </div>

                {supplierForm.items.map((item, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 space-y-2">
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-6">
                        <label className="text-[10px] text-slate-500 block mb-0.5">Select Product</label>
                        <select
                          value={item.productId}
                          onChange={(e) => handleProductSelectSupplier(idx, e.target.value)}
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-hidden text-xs"
                          required
                        >
                          <option value="">Choose product...</option>
                          {products.map((p) => (
                            <option key={p.id || p._id} value={p.id || p._id}>
                              {p.name} (Cost: {currency}{p.costPrice || 0})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="col-span-3">
                        <label className="text-[10px] text-slate-500 block mb-0.5">Returned Qty</label>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleQtyChangeSupplier(idx, e.target.value)}
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-hidden text-xs"
                        />
                      </div>

                      <div className="col-span-3 flex items-end justify-between">
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-0.5">Debit Total</label>
                          <p className="p-2 font-bold text-emerald-600">
                            {currency}{Number((item.unitCostPrice || 0) * item.quantity).toLocaleString()}
                          </p>
                        </div>
                        {supplierForm.items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSupplierItem(idx)}
                            className="text-slate-400 hover:text-rose-600 p-2"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {supplierForm.settlementType === "CASH_REFUND" && (
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Deposit Refund Into Treasury Account</label>
                  <select
                    value={supplierForm.depositAccountId}
                    onChange={(e) => setSupplierForm({ ...supplierForm, depositAccountId: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  >
                    <option value="">Do not credit treasury balance</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Reason for Debit Note</label>
                <input
                  type="text"
                  placeholder="e.g. Color bleeding / stitching defects"
                  value={supplierForm.reason}
                  onChange={(e) => setSupplierForm({ ...supplierForm, reason: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800"
                >
                  Generate Debit Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReturnsManagement;
