/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";
import ExchangeRequestsPanel from "../components/ExchangeRequestsPanel";
import CustomerReturnRequestsPanel from "../components/CustomerReturnRequestsPanel";
import { usePermissions } from "../auth/PermissionsContext";
import {
  addDecimalStrings,
  compareDecimalStrings,
  formatNprAmount,
  multiplyDecimalStringByInteger,
} from "../utils/decimalDisplay";

const formatNpr = (value) => `${currency}${formatNprAmount(String(value ?? "0"))}`;
const supplierReturnLineTotal = (item) => {
  try {
    return formatNprAmount(multiplyDecimalStringByInteger(String(item.unitCostPrice), item.quantity));
  } catch {
    return "—";
  }
};

const createSupplierForm = () => ({
  requestKey: crypto.randomUUID(),
  shipmentBatchId: "",
  supplierPartyId: "",
  supplierName: "",
  supplierReference: "",
  supplierInvoiceNumber: "",
  vatReversal: "0",
  settlementType: "CREDIT_NOTE_OFFSET_PAYABLE",
  depositAccountId: "",
  reason: "Defective fabric batch",
  notes: "",
  items: [{ productId: "", name: "", quantity: 1, unitCostPrice: "" }],
});

const ReturnsManagement = ({ token }) => {
  const { can } = usePermissions();
  const canReadSupplierReconciliation = can("finance:payables_read");
  const canApplySupplierCredit = can("finance:payable_settle");
  const [activeTab, setActiveTab] = useState("CUSTOMER"); // CUSTOMER or SUPPLIER
  const [customerReturns, setCustomerReturns] = useState([]);
  const [supplierReturns, setSupplierReturns] = useState([]);
  const [supplierVendors, setSupplierVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refundActionId, setRefundActionId] = useState(null);
  const [refundPayoutAccounts, setRefundPayoutAccounts] = useState({});
  const refundPayoutRequestKeys = useRef({});
  const [supplierReconciliation, setSupplierReconciliation] = useState(null);
  const [supplierReconciliationError, setSupplierReconciliationError] = useState("");
  const [supplierCreditReturn, setSupplierCreditReturn] = useState(null);
  const [supplierCreditBills, setSupplierCreditBills] = useState([]);
  const [supplierCredit, setSupplierCredit] = useState(null);
  const [supplierCreditLoading, setSupplierCreditLoading] = useState(false);
  const [supplierCreditSaving, setSupplierCreditSaving] = useState(false);
  const [supplierCreditForm, setSupplierCreditForm] = useState({
    billDocumentId: "",
    amount: "",
    notes: "",
    idempotencyKey: "",
  });

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

  const [supplierForm, setSupplierForm] = useState(createSupplierForm);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [custRes, suppRes, vendorRes, prodRes, accRes, reconRes] = await Promise.all([
        axios.get(`${backendUrl}/api/returns/customer/list`, { headers: { token } }),
        axios.get(`${backendUrl}/api/returns/supplier/list`, { headers: { token } }),
        axios.get(`${backendUrl}/api/expense/vendors`, { headers: { token } }),
        axios.get(`${backendUrl}/api/product/list`, { params: { limit: 50 } }),
        axios.get(`${backendUrl}/api/finance/treasury-accounts`, { headers: { token } }),
        canReadSupplierReconciliation
          ? axios.get(`${backendUrl}/api/returns/supplier/reconciliation`, { headers: { token } })
            .catch((error) => ({ data: { success: false, message: error.response?.data?.message || error.message }, status: error.response?.status }))
          : Promise.resolve({ data: { success: false, message: "Finance payables-read permission is required." }, status: 403 }),
      ]);

      if (custRes.data.success) setCustomerReturns(custRes.data.returns || []);
      if (suppRes.data.success) setSupplierReturns(suppRes.data.returns || []);
      if (vendorRes.data.success) setSupplierVendors(vendorRes.data.vendors || []);
      if (prodRes.data.success) setProducts(prodRes.data.products || []);
      if (accRes.data.success) setAccounts(accRes.data.accounts || []);
      if (reconRes.data.success) {
        setSupplierReconciliation(reconRes.data);
        setSupplierReconciliationError("");
      } else {
        setSupplierReconciliation(null);
        setSupplierReconciliationError(reconRes.status === 403
          ? "Your account does not have permission to view supplier accounting reconciliation."
          : reconRes.data.message || "Supplier accounting reconciliation could not be loaded.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load returns data");
    } finally {
      setLoading(false);
    }
  }, [token, canReadSupplierReconciliation]);

  useEffect(() => {
    if (token) fetchData();
  }, [fetchData, token]);

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
      unitCostPrice: "",
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
    const selectedVendor = supplierVendors.find((vendor) => vendor.id === supplierForm.supplierPartyId);
    if (!selectedVendor) return toast.warn("Select a registered supplier before submitting a debit note.");
    if (!supplierForm.items[0].productId) return toast.warn("Please select at least one product");
    if (supplierForm.reason.trim().length < 3) return toast.warn("Provide a return reason of at least 3 characters");
    try {
      if (compareDecimalStrings(supplierForm.vatReversal || "0", "0") > 0 && !supplierForm.supplierInvoiceNumber.trim()) {
        return toast.warn("An original supplier invoice reference is required for VAT reversal");
      }
      for (const item of supplierForm.items) {
        if (compareDecimalStrings(String(item.unitCostPrice || "0"), "0") <= 0) {
          return toast.warn("Enter the supplier-invoice unit cost for every returned product.");
        }
      }
    } catch {
      return toast.warn("Enter valid decimal strings for supplier-return unit costs and VAT reversal.");
    }
    if (supplierForm.settlementType === "CASH_REFUND" && !supplierForm.depositAccountId) {
      return toast.warn("Select the Treasury account receiving the supplier refund");
    }

    const payload = {
      ...supplierForm,
      supplierPartyId: selectedVendor.id,
      supplierName: selectedVendor.displayName,
      supplierReference: selectedVendor.sourceEntityId,
    };

    try {
      const res = await axios.post(`${backendUrl}/api/returns/supplier/create`, payload, {
        headers: { token },
      });
      if (res.data.success) {
        if (res.data.approvalRequest?.status === "APPROVED") {
          toast.success(res.data.message);
        } else if (res.data.approvalRequest?.status === "REJECTED") {
          toast.warn(res.data.message);
        } else {
          toast.info(res.data.message);
        }
        setShowSupplierModal(false);
        setSupplierForm(createSupplierForm());
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const openSupplierCreditApplication = async (record) => {
    setSupplierCreditLoading(true);
    setSupplierCreditReturn(record);
    setSupplierCreditBills([]);
    setSupplierCredit(null);
    try {
      const response = await axios.get(
        `${backendUrl}/api/returns/supplier/${record.id}/applicable-bills`,
        { headers: { token } },
      );
      setSupplierCredit(response.data.credit);
      setSupplierCreditBills(response.data.bills || []);
      setSupplierCreditForm({
        billDocumentId: response.data.bills?.[0]?.id || "",
        amount: "",
        notes: "",
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not load open supplier bills.");
      setSupplierCreditReturn(null);
    } finally {
      setSupplierCreditLoading(false);
    }
  };

  const handleApplySupplierCredit = async (event) => {
    event.preventDefault();
    if (!supplierCreditReturn || !supplierCreditForm.billDocumentId || !supplierCreditForm.idempotencyKey) return;
    const bill = supplierCreditBills.find((entry) => entry.id === supplierCreditForm.billDocumentId);
    try {
      const amount = String(supplierCreditForm.amount || "");
      const creditBalance = String(supplierCredit?.remainingAmount || "0");
      const billBalance = String(bill?.remainingAmount || "0");
      const limit = compareDecimalStrings(creditBalance, billBalance) <= 0 ? creditBalance : billBalance;
      if (compareDecimalStrings(amount, "0") <= 0 || compareDecimalStrings(amount, limit) > 0) {
        return toast.warn("Enter a positive amount no greater than the available credit or bill balance.");
      }
    } catch {
      return toast.warn("Enter a valid decimal string for the supplier credit amount.");
    }
    setSupplierCreditSaving(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/returns/supplier/${supplierCreditReturn.id}/apply-credit`,
        {
          billDocumentId: supplierCreditForm.billDocumentId,
          amount: supplierCreditForm.amount,
          notes: supplierCreditForm.notes,
        },
        {
          headers: { token, "Idempotency-Key": supplierCreditForm.idempotencyKey },
        },
      );
      toast.info(response.data.message || "Supplier credit application submitted for independent Admin approval.");
      setSupplierCreditReturn(null);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not apply supplier credit.");
    } finally {
      setSupplierCreditSaving(false);
    }
  };

  const totalCustomerRefunds = customerReturns
    .filter((record) => record.refundStatus === "COMPLETED")
    .reduce((acc, record) => acc + Number(record.approvedRefundAmount ?? record.totalRefundAmount ?? 0), 0);
  const totalSupplierDebits = supplierReturns.reduce(
    (total, record) => addDecimalStrings(total, String(record.totalDebitAmount || "0")),
    "0",
  );
  const supplierReconciliationStatusByReturnId = new Map(
    (supplierReconciliation?.records || []).map((record) => [record.id, record.status]),
  );
  const supplierReconciliationReviewCount = (supplierReconciliation?.records || []).filter(
    (record) => record.status !== "CANCELLED" &&
      (!record.status.startsWith("RECONCILED_") || record.issues?.length > 0),
  ).length;

  const reviewDistributorRefund = async (record, decision) => {
    const refundEvent = record.distributorCashEvents?.[0];
    if (!refundEvent || refundEvent.status !== "PENDING_VERIFICATION") return;
    const reviewNotes = decision === "REJECT"
      ? window.prompt("Why is this refund evidence being rejected?")?.trim()
      : "";
    if (decision === "REJECT" && !reviewNotes) return;

    setRefundActionId(record.id);
    try {
      await axios.post(
        `${backendUrl}/api/returns/customer/admin/${record.id}/distributor-refund-review`,
        { distributorId: record.distributorId, decision, reviewNotes },
        { headers: { token } }
      );
      toast.success(decision === "VERIFY" ? "Distributor refund verified and recorded." : "Refund evidence rejected; distributor may resubmit.");
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not review distributor refund.");
    } finally {
      setRefundActionId(null);
    }
  };

  const payDistributorRefund = async (record) => {
    const refundEvent = record.distributorCashEvents?.[0];
    const document = refundEvent?.accountingDocument;
    const amount = Number(document?.remainingAmount || 0);
    const financialAccountId = refundPayoutAccounts[record.id] || accounts.find((account) =>
      account.status === "ACTIVE" && account.currency === "NPR" && ["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
    )?.id;
    if (!document?.id || refundEvent?.status !== "POSTED" || amount <= 0 || !financialAccountId) {
      toast.error("An open verified distributor payable and active NPR treasury account are required.");
      return;
    }
    const reason = window.prompt("Why should this verified customer refund payable be reimbursed?")?.trim();
    if (!reason || reason.length < 3) return;
    const requestPayload = {
      distributorId: record.distributorId,
      financialAccountId,
      amount: amount.toFixed(2),
      reason,
    };
    const fingerprint = JSON.stringify(requestPayload);
    if (refundPayoutRequestKeys.current[document.id]?.fingerprint !== fingerprint) {
      refundPayoutRequestKeys.current[document.id] = {
        fingerprint,
        key: window.crypto.randomUUID(),
      };
    }
    setRefundActionId(record.id);
    try {
      const response = await axios.post(
        `${backendUrl}/api/returns/customer/admin/distributor-refunds/${document.id}/settle`,
        {
          ...requestPayload,
          idempotencyKey: refundPayoutRequestKeys.current[document.id].key,
        },
        { headers: { token } }
      );
      toast.info(response.data?.message || "Distributor refund payout request submitted for independent Admin approval.");
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not settle distributor refund payable.");
    } finally {
      setRefundActionId(null);
    }
  };

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
              {formatNpr(totalSupplierDebits)}
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
                  <th className="p-3 text-center">Distributor refund controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {customerReturns.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="p-6 text-center text-slate-400 font-medium">
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
                    const restockedCost = items.reduce((total, item) => {
                      const lineCost = Number(item.unitCostPrice || 0) * Number(item.quantity || 0);
                      return total + (Number.isFinite(lineCost) && String(item.condition || "").toUpperCase() === "RESTOCKABLE" ? lineCost : 0);
                    }, 0);
                    const damagedCost = items.reduce((total, item) => {
                      const lineCost = Number(item.unitCostPrice || 0) * Number(item.quantity || 0);
                      return total + (Number.isFinite(lineCost) && String(item.condition || "").toUpperCase() === "DAMAGED" ? lineCost : 0);
                    }, 0);
                    const hasRestockableItems = items.some((item) => String(item.condition || "").toUpperCase() === "RESTOCKABLE");
                    const hasDamagedItems = items.some((item) => String(item.condition || "").toUpperCase() === "DAMAGED");
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
                              {it.condition && (
                                <span className="ml-1 text-[10px] font-semibold text-slate-500">
                                  · {String(it.condition).toLowerCase()}
                                </span>
                              )}
                            </p>
                          ))}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              hasRestockableItems && !hasDamagedItems
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {hasRestockableItems && hasDamagedItems
                              ? "Mixed: Restocked & Damaged"
                              : hasDamagedItems
                                ? "Damaged Scrap Loss"
                                : hasRestockableItems
                                  ? "Restocked to Inventory"
                                  : ret.inventoryAction || "Not inspected"}
                          </span>
                          {(restockedCost > 0 || damagedCost > 0) && (
                            <p className="mt-1 text-[10px] text-slate-500">
                              Restocked {currency}{restockedCost.toLocaleString()} · write-off {currency}{damagedCost.toLocaleString()}
                            </p>
                          )}
                          {ret.inventoryAccountingJournalEntryId ? (
                            <p className="mt-1 text-[10px] text-emerald-700">
                              Cost journal posted · {ret.inventoryAccountingJournalEntryId.slice(0, 12)}
                            </p>
                          ) : ret.deliveryRoute === "DISTRIBUTOR" && ret.inspectedAt && (restockedCost > 0 || damagedCost > 0) ? (
                            <p className="mt-1 text-[10px] font-semibold text-amber-700">Cost journal not recorded</p>
                          ) : null}
                          {ret.accountingJournalEntryId && (
                            <p className="mt-1 text-[10px] text-slate-500">
                              {ret.deliveryRoute === "DISTRIBUTOR" ? "Refund journal" : "Return journal"} · {ret.accountingJournalEntryId.slice(0, 12)}
                            </p>
                          )}
                        </td>
                        <td className="p-3 text-slate-600">{ret.reason}</td>
                        <td className="p-3 text-right font-black text-rose-600">
                          {currency}{Number(ret.approvedRefundAmount ?? ret.totalRefundAmount).toLocaleString()}
                          {ret.deliveryRoute === "DISTRIBUTOR" && Number(ret.approvedRefundAmount ?? ret.totalRefundAmount) < Number(ret.totalRefundAmount) && (
                            <p className="mt-1 text-[9px] font-medium text-slate-500">
                              Product value {currency}{Number(ret.totalRefundAmount).toLocaleString()} · charge {currency}{(Number(ret.totalRefundAmount) - Number(ret.approvedRefundAmount)).toLocaleString()}
                            </p>
                          )}
                        </td>
                        <td className="p-3 text-right text-slate-500 font-mono">
                          {currency}{Number(ret.vatRefunded).toLocaleString()}
                        </td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                            {ret.refundStatus}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          {ret.deliveryRoute === "DISTRIBUTOR" && (
                            <div className="flex min-w-52 flex-col items-center gap-2">
                              <div className="w-full rounded-md border border-violet-100 bg-violet-50 px-2.5 py-2 text-left">
                                <p className="text-[9px] font-bold uppercase tracking-wide text-violet-700">Assigned distributor</p>
                                {ret.assignedDistributor?.distributor ? (
                                  <>
                                    <p className="mt-1 text-[11px] font-bold text-slate-900">{ret.assignedDistributor.distributor.name}</p>
                                    <p className="text-[10px] text-slate-600">
                                      {[ret.assignedDistributor.distributor.district, ret.assignedDistributor.distributor.province]
                                        .filter(Boolean)
                                        .join(", ") || ret.assignedDistributor.distributor.city || "Location unavailable"}
                                    </p>
                                    {ret.assignedDistributor.distributor.phone && (
                                      <p className="text-[10px] text-slate-600">Phone: {ret.assignedDistributor.distributor.phone}</p>
                                    )}
                                    <p className="mt-1 text-[9px] font-semibold text-violet-800">
                                      {[ret.assignedDistributor.deliveryType, ret.assignedDistributor.status]
                                        .filter(Boolean)
                                        .map((value) => String(value).replace(/_/g, " "))
                                        .join(" · ")}
                                    </p>
                                    {ret.assignedDistributor.returnedAt && (
                                      <p className="text-[9px] text-slate-500">Return received: {new Date(ret.assignedDistributor.returnedAt).toLocaleDateString()}</p>
                                    )}
                                  </>
                                ) : (
                                  <p className="mt-1 text-[10px] text-slate-500">Distributor assignment details unavailable.</p>
                                )}
                              </div>
                              {ret.inspectionEvidenceUrl && (
                                <a
                                  href={ret.inspectionEvidenceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[10px] font-semibold text-indigo-700 underline"
                                >
                                  View returned goods photo
                                </a>
                              )}
                              {ret.distributorCashEvents?.[0] && (
                                <>
                                  <span className="text-[10px] text-slate-500">
                                    Distributor evidence: {ret.distributorCashEvents[0].status} · Refund paid {currency}{Number(ret.distributorCashEvents[0].amount || 0).toFixed(2)}
                                  </span>
                                  {Number(ret.distributorCashEvents[0].amount || 0) !== Number(
                                    ret.refundPolicySnapshot?.approvedRefundAmount ?? ret.approvedRefundAmount ?? 0
                                  ) && (
                                    <span className="text-[10px] font-semibold text-amber-800">
                                      Changed from approved {currency}{Number(
                                        ret.refundPolicySnapshot?.approvedRefundAmount ?? ret.approvedRefundAmount ?? 0
                                      ).toFixed(2)}
                                      {ret.distributorCashEvents[0].notes && ` · Reason: ${ret.distributorCashEvents[0].notes}`}
                                    </span>
                                  )}
                                  {ret.distributorCashEvents[0].evidenceUrl && (
                                    <a
                                      href={ret.distributorCashEvents[0].evidenceUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[10px] font-semibold text-blue-700 underline"
                                    >
                                      View payment evidence
                                    </a>
                                  )}
                                </>
                              )}
                              {ret.distributorCashEvents?.[0]?.status === "PENDING_VERIFICATION" && (
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => reviewDistributorRefund(ret, "VERIFY")}
                                    disabled={refundActionId === ret.id}
                                    className="rounded-md bg-emerald-700 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50"
                                  >
                                    Verify
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => reviewDistributorRefund(ret, "REJECT")}
                                    disabled={refundActionId === ret.id}
                                    className="rounded-md bg-rose-700 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50"
                                  >
                                    Reject
                                  </button>
                                </div>
                              )}
                              {ret.distributorCashEvents?.[0]?.status === "POSTED" &&
                                Number(ret.distributorCashEvents[0].accountingDocument?.remainingAmount || 0) > 0 && (
                                  <>
                                    <select
                                      value={refundPayoutAccounts[ret.id] || ""}
                                      onChange={(event) => setRefundPayoutAccounts((current) => ({ ...current, [ret.id]: event.target.value }))}
                                      className="max-w-52 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px]"
                                      aria-label="Company treasury account to pay the distributor refund"
                                    >
                                      <option value="">Select company payout account</option>
                                      {accounts.filter((account) =>
                                        account.status === "ACTIVE" &&
                                        account.currency === "NPR" &&
                                        ["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
                                      ).map((account) => (
                                        <option key={account.id} value={account.id}>{account.accountName}</option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => payDistributorRefund(ret)}
                                      disabled={refundActionId === ret.id}
                                      className="rounded-md bg-slate-900 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50"
                                    >
                                      Pay remaining {currency}{Number(ret.distributorCashEvents[0].accountingDocument.remainingAmount).toFixed(2)}
                                    </button>
                                  </>
                                )}
                            </div>
                          )}
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
          <>
          {supplierReconciliationError ? (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Supplier return reconciliation unavailable: {supplierReconciliationError}
            </p>
          ) : supplierReconciliation ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-bold">Historical supplier-return reconciliation (read-only)</p>
              <p className="mt-1">
                {supplierReconciliation.total} returns reviewed.                 Items requiring review: {supplierReconciliationReviewCount}.
                No historical balances or journals are changed by this report.
              </p>
            </div>
          ) : null}
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
                  <th className="p-3">Accounting References</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-center">Supplier credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {supplierReturns.length === 0 ? (
                  <tr>
                    <td colSpan="10" className="p-6 text-center text-slate-400 font-medium">
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
                          {formatNpr(ret.totalDebitAmount)}
                        </td>
                        <td className="p-3 text-right text-slate-500 font-mono">
                          {formatNpr(ret.vatReversal)}
                        </td>
                        <td className="p-3 font-mono text-[10px] text-slate-500">
                          <p>Journal: {ret.accountingJournalEntryId || "—"}</p>
                          {ret.accountingDocumentId && <p>Credit note: {ret.accountingDocumentId}</p>}
                          {ret.cashTransactionId && <p>Cash: {ret.cashTransactionId}</p>}
                        </td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                            {ret.status}
                          </span>
                          {supplierReconciliationStatusByReturnId.get(ret.id) && (
                            <p className="mt-1 text-[10px] text-slate-500">
                              {supplierReconciliationStatusByReturnId.get(ret.id).replaceAll("_", " ")}
                            </p>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {canApplySupplierCredit &&
                            ret.settlementType === "CREDIT_NOTE_OFFSET_PAYABLE" &&
                            ret.accountingDocumentId && (
                              <button
                                type="button"
                                disabled={supplierCreditLoading}
                                onClick={() => openSupplierCreditApplication(ret)}
                                className="rounded-lg bg-indigo-50 px-3 py-1.5 font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                              >
                                Apply to bill
                              </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          </>
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
                      <div className="col-span-5">
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

                      <div className="col-span-2">
                        <label className="text-[10px] text-slate-500 block mb-0.5">Qty</label>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleQtyChangeCustomer(idx, e.target.value)}
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-hidden text-xs"
                        />
                      </div>

                      <div className="col-span-3">
                        <label className="text-[10px] text-slate-500 block mb-0.5">Supplier Invoice Unit Cost (Rs)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          required
                          value={item.unitCostPrice}
                          onChange={(e) => {
                            const items = [...supplierForm.items];
                            items[idx] = { ...items[idx], unitCostPrice: e.target.value };
                            setSupplierForm({ ...supplierForm, items });
                          }}
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-hidden text-xs"
                        />
                      </div>

                      <div className="col-span-2 flex items-end justify-between">
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
                  <label className="font-semibold text-slate-700 block mb-1">Registered Supplier *</label>
                  <select
                    value={supplierForm.supplierPartyId}
                    onChange={(e) => {
                      const vendor = supplierVendors.find((option) => option.id === e.target.value);
                      setSupplierForm({
                        ...supplierForm,
                        supplierPartyId: e.target.value,
                        supplierName: vendor?.displayName || "",
                        supplierReference: vendor?.sourceEntityId || "",
                      });
                    }}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                    required
                  >
                    <option value="">Select registered supplier</option>
                    {supplierVendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.displayName}{vendor.legalName ? ` · ${vendor.legalName}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Supplier Reference</label>
                  <input
                    type="text"
                    value={supplierForm.supplierReference}
                    readOnly
                    className="w-full p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600"
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Original Supplier Invoice Reference</label>
                  <input
                    type="text"
                    placeholder="Invoice number / evidence reference"
                    value={supplierForm.supplierInvoiceNumber}
                    onChange={(e) => setSupplierForm({ ...supplierForm, supplierInvoiceNumber: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Invoice-supported VAT Reversal</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={supplierForm.vatReversal}
                    onChange={(e) => setSupplierForm({ ...supplierForm, vatReversal: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  />
                  <p className="mt-1 text-[10px] text-slate-500">Enter only the input VAT supported by the original supplier invoice. No rate is assumed.</p>
                </div>
              </div>

              {/* Items Section */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">Returned Inventory Products (unit cost is gross return value)</span>
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
                              {p.name}
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
                          <p className="p-2 font-bold text-emerald-600">{formatNpr(supplierReturnLineTotal(item))}</p>
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
                    <option value="">Select an active mapped account</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Reason for Debit Note *</label>
                <input
                  type="text"
                  placeholder="e.g. Color bleeding / stitching defects"
                  required
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
      {supplierCreditReturn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="my-8 w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Apply supplier credit to bill</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {supplierCreditReturn.supplierName} · {supplierCredit?.documentNumber || "Credit note"}
                </p>
              </div>
              <button type="button" onClick={() => setSupplierCreditReturn(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            {supplierCreditLoading ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading eligible bills...</p>
            ) : (
              <form onSubmit={handleApplySupplierCredit} className="mt-4 space-y-4 text-xs">
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  Open credit: {formatNpr(supplierCredit?.remainingAmount)}. Only open bills for this same supplier are eligible. Applying the credit references the existing return journal; it does not post another journal.
                </p>
                <label className="block font-semibold text-slate-700">
                  Supplier bill *
                  <select
                    required
                    value={supplierCreditForm.billDocumentId}
                    onChange={(event) => setSupplierCreditForm({ ...supplierCreditForm, billDocumentId: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5"
                    disabled={!supplierCreditBills.length}
                  >
                    <option value="">Select an open bill...</option>
                    {supplierCreditBills.map((bill) => (
                      <option key={bill.id} value={bill.id}>
                        {bill.documentNumber} · balance {formatNpr(bill.remainingAmount)} · {new Date(bill.issueDate).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block font-semibold text-slate-700">
                  Amount ({currency}) *
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={supplierCreditForm.amount}
                    onChange={(event) => setSupplierCreditForm({ ...supplierCreditForm, amount: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5"
                    disabled={!supplierCreditBills.length}
                  />
                </label>
                <label className="block font-semibold text-slate-700">
                  Application notes *
                  <textarea
                    required
                    maxLength={1000}
                    value={supplierCreditForm.notes}
                    onChange={(event) => setSupplierCreditForm({ ...supplierCreditForm, notes: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5"
                    rows={3}
                    disabled={!supplierCreditBills.length}
                  />
                </label>
                {!supplierCreditBills.length && (
                  <p className="text-amber-700">No open bill for this supplier and currency is available.</p>
                )}
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                  <button type="button" onClick={() => setSupplierCreditReturn(null)} className="rounded-xl bg-slate-100 px-4 py-2 font-semibold text-slate-600">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={supplierCreditSaving || !supplierCreditBills.length}
                    className="rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white disabled:opacity-50"
                  >
                    {supplierCreditSaving ? "Applying..." : "Apply credit"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

ReturnsManagement.propTypes = {
  token: PropTypes.string.isRequired,
};

export default ReturnsManagement;
