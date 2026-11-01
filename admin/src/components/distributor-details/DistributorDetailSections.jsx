/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { backendUrl, currency } from "../../App";
import { toast } from "react-toastify";
import Pagination from "../Pagination";

const pageLimit = 10;
const emptyQuery = {};
const amountText = (value) => `${currency}${Number(value || 0).toLocaleString()}`;
const dateText = (value) => (value ? new Date(value).toLocaleString() : "—");
const returnDispositionOptions = [
  ["RESTOCK_REVIEW", "Restock review"],
  ["REPAIR_REVIEW", "Repair review"],
  ["SALE_REVIEW", "Sale review"],
  ["DONATION_REVIEW", "Donation review"],
  ["DISPOSAL_REVIEW", "Disposal review"],
  ["UNRESOLVED", "Unresolved"],
];
const collectedForReturnLine = (stockReturn, returnLineId) => (stockReturn.collections || [])
  .flatMap((collection) => collection.lines || [])
  .filter((line) => line.stockReturnLineId === returnLineId)
  .reduce((total, line) => total + Number(line.collectedQuantity || 0), 0);
const remainingApprovedReturnQuantity = (stockReturn, line) =>
  Math.max(0, Number(line.approvedQuantity || 0) - collectedForReturnLine(stockReturn, line.id));
const receiptQuantity = (line, field) => (line.shipmentLines || [])
  .flatMap((shipmentLine) => shipmentLine.receiptLines || [])
  .reduce((total, receiptLine) => total + Number(receiptLine[field] || 0), 0);
const listText = (value) => (Array.isArray(value) ? value.map((item) => {
  const name = item.product?.name || item.name || item.productName || item.productId || "Item";
  const variant = [item.size, item.color].filter(Boolean).join(" / ");
  const quantity = item.quantity || item.qty;
  return `${name}${variant ? ` · ${variant}` : ""}${quantity ? ` × ${quantity}` : ""}`;
}).join(", ") : "—");

const stockReturnAuditCsv = ({ stockReturn, carryingExpenses = [] }) => {
  const headers = [
    "Record type",
    "Stock return ID",
    "Record ID",
    "Timestamp",
    "Actor account ID",
    "Status or action",
    "Product",
    "Size",
    "Color",
    "Quantity",
    "Secondary quantity",
    "Amount NPR",
    "Details",
    "Evidence",
  ];
  const rows = [];
  const addRow = (values) => rows.push(headers.map((_, index) => values[index] ?? ""));
  const productDetails = (line) => ({
    product: line.productNameSnapshot || "",
    size: line.sizeSnapshot || "",
    color: line.colorSnapshot || "",
  });
  const jsonCell = (value) => value == null ? "" : JSON.stringify(value);

  addRow([
    "RETURN",
    stockReturn.id,
    stockReturn.id,
    stockReturn.createdAt,
    stockReturn.createdByAccountId,
    stockReturn.status,
    "",
    "",
    "",
    "",
    "",
    "",
    stockReturn.reason,
    "",
  ]);
  for (const line of stockReturn.lines || []) {
    const product = productDetails(line);
    addRow([
      "RETURN_LINE",
      stockReturn.id,
      line.id,
      line.createdAt,
      "",
      "",
      product.product,
      product.size,
      product.color,
      line.requestedQuantity,
      line.approvedQuantity,
      line.layerCogsAmount,
      `held=${line.heldQuantity}; costed=${line.costedQuantity}; uncosted=${line.uncostedQuantity}`,
      "",
    ]);
  }
  for (const collection of stockReturn.collections || []) {
    addRow([
      "COLLECTION",
      stockReturn.id,
      collection.id,
      collection.collectedAt,
      collection.collectedByAccountId,
      collection.status,
      "",
      "",
      "",
      "",
      "",
      "",
      `carrier=${collection.carrier || ""}; tracking=${collection.trackingReference || ""}; collection notes=${collection.collectionNotes || ""}; receipt notes=${collection.receiptNotes || ""}`,
      jsonCell(collection.handoverEvidence),
    ]);
    if (collection.receivedAt || collection.receivedByAccountId) {
      addRow([
        "WAREHOUSE_RECEIPT",
        stockReturn.id,
        collection.id,
        collection.receivedAt,
        collection.receivedByAccountId,
        collection.status,
        "",
        "",
        "",
        "",
        "",
        "",
        collection.receiptNotes,
        "",
      ]);
    }
    for (const line of collection.lines || []) {
      const product = productDetails(line.stockReturnLine || {});
      addRow([
        "COLLECTION_LINE",
        stockReturn.id,
        line.id,
        line.createdAt,
        "",
        "",
        product.product,
        product.size,
        product.color,
        line.collectedQuantity,
        Number(line.receivedGoodQuantity || 0) + Number(line.receivedDamagedQuantity || 0),
        "",
        `good=${line.receivedGoodQuantity}; damaged=${line.receivedDamagedQuantity}; missing=${line.missingQuantity}; damage type=${line.damageType || ""}; notes=${line.receiptNotes || ""}`,
        jsonCell(line.evidence),
      ]);
      for (const discrepancy of line.discrepancies || []) {
        addRow([
          "DISCREPANCY",
          stockReturn.id,
          discrepancy.id,
          discrepancy.createdAt,
          discrepancy.reportedBy,
          discrepancy.status,
          product.product,
          product.size,
          product.color,
          discrepancy.quantity,
          discrepancy.discrepancyType,
          discrepancy.platformLossAmount,
          `custody=${discrepancy.custodyStage || ""}; responsible=${discrepancy.financialResponsibleParty}; details=${discrepancy.details || ""}; resolution=${discrepancy.resolution || ""}`,
          jsonCell(discrepancy.evidence),
        ]);
        for (const review of discrepancy.investigationReviews || []) {
          addRow([
            "DISCREPANCY_INVESTIGATION",
            stockReturn.id,
            review.id,
            review.createdAt,
            review.reviewedBy,
            "INVESTIGATION_NOTE",
            product.product,
            product.size,
            product.color,
            discrepancy.quantity,
            discrepancy.discrepancyType,
            "",
            review.notes,
            jsonCell(review.evidence),
          ]);
        }
      }
    }
    if (collection.inspection) {
      const inspection = collection.inspection;
      addRow([
        "INSPECTION",
        stockReturn.id,
        inspection.id,
        inspection.inspectedAt,
        inspection.inspectedByAccountId,
        "RECORDED",
        "",
        "",
        "",
        "",
        "",
        "",
        inspection.notes,
        "",
      ]);
      for (const line of inspection.lines || []) {
        const collectionLine = collection.lines.find(({ id }) => id === line.collectionLineId);
        const product = productDetails(collectionLine?.stockReturnLine || {});
        addRow([
          "INSPECTION_LINE",
          stockReturn.id,
          line.id,
          line.createdAt,
          inspection.inspectedByAccountId,
          line.recommendedDisposition,
          product.product,
          product.size,
          product.color,
          line.quantity,
          "",
          "",
          line.conditionNotes,
          jsonCell(line.evidence),
        ]);
      }
    }
  }
  for (const event of stockReturn.events || []) {
    addRow([
      "EVENT",
      stockReturn.id,
      event.id,
      event.createdAt,
      event.actorAccountId,
      `${event.action}: ${event.fromStatus || ""} -> ${event.toStatus || ""}`,
      "",
      "",
      "",
      "",
      "",
      "",
      `${event.notes || ""}${event.metadata ? `; metadata=${jsonCell(event.metadata)}` : ""}`,
      "",
    ]);
  }
  for (const expense of carryingExpenses) {
    addRow([
      "CARRYING_EXPENSE",
      stockReturn.id,
      expense.id,
      expense.date,
      "",
      "OUTFLOW / EXPENSE",
      "",
      "",
      "",
      "",
      "",
      expense.amount,
      `${expense.partyName || ""}; invoice=${expense.invoiceNumber || ""}; ${expense.description || ""}`,
      "",
    ]);
  }
  const csvCell = (value) => {
    let text = String(value ?? "");
    if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll("\"", "\"\"")}"`;
  };
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
};

const RecordList = ({ endpoint, responseKey, token, queryParams = emptyQuery, renderRecord, emptyMessage }) => {
  const [records, setRecords] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const queryString = JSON.stringify(queryParams);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setErrorMessage("");
      try {
        const response = await axios.get(endpoint, {
          params: { ...JSON.parse(queryString), page, limit: pageLimit },
          headers: { token },
        });
        if (!response.data?.success) throw new Error(response.data?.message || "Unable to load this history.");
        if (!active) return;
        setRecords(response.data[responseKey] || []);
        setPagination(response.data.pagination || null);
      } catch (error) {
        if (!active) return;
        console.error(error);
        const message = error.response?.data?.message || error.message || "Unable to load this history.";
        setErrorMessage(message);
        setRecords([]);
        setPagination(null);
        toast.error(message);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [endpoint, page, queryString, responseKey, token]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="font-bold text-slate-900">History</h2>
        <p className="mt-0.5 text-xs text-slate-500">Records are loaded on demand and paginated.</p>
      </div>
      {loading ? (
        <p className="px-5 py-12 text-center text-sm text-slate-500">Loading…</p>
      ) : errorMessage ? (
        <p className="px-5 py-12 text-center text-sm text-rose-600">{errorMessage}</p>
      ) : records.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {records.map((record) => (
            <article key={record.id} className="px-5 py-4">{renderRecord(record)}</article>
          ))}
        </div>
      )}
      {pagination && pagination.total > 0 && (
        <div className="border-t border-slate-100 px-5">
          <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} limit={pagination.limit} onPageChange={setPage} loading={loading} />
        </div>
      )}
    </section>
  );
};

export const DistributorInventorySection = ({ distributorId, token, canManageStockReturns = false }) => {
  const [inventory, setInventory] = useState([]);
  const [totals, setTotals] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [stockReturns, setStockReturns] = useState([]);
  const [stockReturnsLoading, setStockReturnsLoading] = useState(true);
  const [returnReason, setReturnReason] = useState("");
  const [returnQuantities, setReturnQuantities] = useState({});
  const [approvalQuantities, setApprovalQuantities] = useState({});
  const [reviewNotes, setReviewNotes] = useState({});
  const [collectionDrafts, setCollectionDrafts] = useState({});
  const [receiptDrafts, setReceiptDrafts] = useState({});
  const [inspectionDrafts, setInspectionDrafts] = useState({});
  const [discrepancyReviewDrafts, setDiscrepancyReviewDrafts] = useState({});
  const [savingReturn, setSavingReturn] = useState(false);
  const [savingReviewId, setSavingReviewId] = useState("");
  const [savingCollectionId, setSavingCollectionId] = useState("");
  const [savingReceiptId, setSavingReceiptId] = useState("");
  const [savingInspectionId, setSavingInspectionId] = useState("");
  const [savingDiscrepancyReviewId, setSavingDiscrepancyReviewId] = useState("");
  const [exportingAuditReportId, setExportingAuditReportId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const endpoint = `${backendUrl}/api/admin/distributors/${distributorId}/inventory`;
  const returnsEndpoint = `${backendUrl}/api/admin/distributors/${distributorId}/stock-returns`;

  const exportStockReturnAuditReport = async (stockReturnId) => {
    setExportingAuditReportId(stockReturnId);
    try {
      const response = await axios.get(`${returnsEndpoint}/${stockReturnId}/audit-report`, {
        headers: { token },
      });
      if (!response.data?.success) {
        throw new Error(response.data?.message || "Unable to load the stock-return audit report.");
      }
      const csv = `\uFEFF${stockReturnAuditCsv(response.data)}`;
      const blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `stock-return-${stockReturnId.replace(/[^A-Za-z0-9._-]/g, "")}-audit.csv`;
      link.click();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to export the stock-return audit report.");
    } finally {
      setExportingAuditReportId("");
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const response = await axios.get(endpoint, { params: { page, limit: pageLimit }, headers: { token } });
        if (!response.data?.success) throw new Error(response.data?.message || "Unable to load distributor inventory.");
        if (!active) return;
        setInventory(response.data.inventory || []);
        setTotals(response.data.totals || null);
        setPagination(response.data.pagination || null);
      } catch (error) {
        if (!active) return;
        console.error(error);
        toast.error(error.response?.data?.message || error.message || "Unable to load distributor inventory.");
        setInventory([]);
        setTotals(null);
        setPagination(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [endpoint, page, token, refreshKey]);

  useEffect(() => {
    let active = true;
    const loadReturns = async () => {
      setStockReturnsLoading(true);
      try {
        const response = await axios.get(returnsEndpoint, {
          params: { limit: 10 },
          headers: { token },
        });
        if (!response.data?.success) throw new Error(response.data?.message || "Unable to load stock return history.");
        if (active) setStockReturns(response.data.stockReturns || []);
      } catch (error) {
        if (!active) return;
        console.error(error);
        toast.error(error.response?.data?.message || error.message || "Unable to load stock return history.");
        setStockReturns([]);
      } finally {
        if (active) setStockReturnsLoading(false);
      }
    };
    loadReturns();
    return () => { active = false; };
  }, [returnsEndpoint, token, refreshKey]);

  const createReturn = async (event) => {
    event.preventDefault();
    const lines = inventory
      .filter((item) => Number(returnQuantities[item.inventorySkuId] || 0) > 0)
      .map((item) => ({
        inventorySkuId: item.inventorySkuId,
        requestedQuantity: Number(returnQuantities[item.inventorySkuId]),
      }));
    if (!lines.length) {
      toast.error("Enter a return quantity for at least one SKU.");
      return;
    }
    setSavingReturn(true);
    try {
      const response = await axios.post(
        returnsEndpoint,
        { reason: returnReason, lines },
        { headers: { token, "Idempotency-Key": globalThis.crypto.randomUUID() } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to create the return request.");
      toast.success("Stock return request submitted for approval.");
      setReturnReason("");
      setReturnQuantities({});
      setRefreshKey((current) => current + 1);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to create the return request.");
    } finally {
      setSavingReturn(false);
    }
  };

  const reviewReturn = async (stockReturn, decision) => {
    setSavingReviewId(stockReturn.id);
    try {
      const response = await axios.patch(
        `${returnsEndpoint}/${stockReturn.id}/review`,
        {
          decision,
          notes: reviewNotes[stockReturn.id] || "",
          ...(decision === "APPROVE" ? {
            lines: stockReturn.lines.map((line) => ({
              lineId: line.id,
              approvedQuantity: Number(approvalQuantities[`${stockReturn.id}:${line.id}`] ?? line.requestedQuantity),
            })),
          } : {}),
        },
        { headers: { token } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to review the return request.");
      toast.success(decision === "APPROVE" ? "Approved stock moved to distributor return hold." : "Stock return request rejected.");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to review the return request.");
    } finally {
      setSavingReviewId("");
    }
  };

  const createCollection = async (stockReturn) => {
    const draft = collectionDrafts[stockReturn.id] || {};
    const lines = stockReturn.lines.map((line) => {
      const alreadyCollected = (stockReturn.collections || []).flatMap((collection) => collection.lines || [])
        .filter((collectionLine) => collectionLine.stockReturnLineId === line.id)
        .reduce((sum, collectionLine) => sum + Number(collectionLine.collectedQuantity), 0);
      const remaining = Math.max(0, Number(line.approvedQuantity || 0) - alreadyCollected);
      return {
        stockReturnLineId: line.id,
        collectedQuantity: Number(draft.quantities?.[line.id] ?? remaining),
      };
    }).filter((line) => line.collectedQuantity > 0);
    if (!lines.length) {
      toast.error("Enter a collection quantity for at least one approved SKU.");
      return;
    }
    setSavingCollectionId(stockReturn.id);
    try {
      const response = await axios.post(
        `${returnsEndpoint}/${stockReturn.id}/collections`,
        {
          carrier: draft.carrier || "",
          trackingReference: draft.trackingReference || "",
          handoverEvidence: String(draft.handoverEvidence || "").split(",").map((url) => url.trim()).filter(Boolean),
          notes: draft.notes || "",
          lines,
        },
        { headers: { token, "Idempotency-Key": globalThis.crypto.randomUUID() } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to record stock collection.");
      toast.success("Collection recorded and stock moved to transit.");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to record stock collection.");
    } finally {
      setSavingCollectionId("");
    }
  };

  const recordCollectionReceipt = async (stockReturn, collection) => {
    const draft = receiptDrafts[collection.id] || {};
    const lines = collection.lines.map((line) => {
      const lineDraft = draft.lines?.[line.id] || {};
      return {
        collectionLineId: line.id,
        receivedGoodQuantity: Number(lineDraft.receivedGoodQuantity ?? line.collectedQuantity),
        receivedDamagedQuantity: Number(lineDraft.receivedDamagedQuantity || 0),
        missingQuantity: Number(lineDraft.missingQuantity || 0),
        damageType: lineDraft.damageType || null,
        evidence: String(lineDraft.evidence || "").split(",").map((url) => url.trim()).filter(Boolean),
        receiptNotes: lineDraft.receiptNotes || "",
      };
    });
    setSavingReceiptId(collection.id);
    try {
      const response = await axios.post(
        `${returnsEndpoint}/${stockReturn.id}/collections/${collection.id}/receipt`,
        { notes: draft.notes || "", lines },
        { headers: { token, "Idempotency-Key": globalThis.crypto.randomUUID() } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to record warehouse receipt.");
      toast.success("Receipt recorded; stock remains in return quarantine.");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to record warehouse receipt.");
    } finally {
      setSavingReceiptId("");
    }
  };

  const recordCollectionInspection = async (stockReturn, collection) => {
    const draft = inspectionDrafts[collection.id] || {};
    const lines = collection.lines.flatMap((line) => {
      const receivedQuantity = Number(line.receivedGoodQuantity || 0) + Number(line.receivedDamagedQuantity || 0);
      if (!receivedQuantity) return [];
      const lineDraft = draft.lines?.[line.id] || {};
      return returnDispositionOptions.flatMap(([recommendedDisposition]) => {
        const quantity = Number(lineDraft.quantities?.[recommendedDisposition] || 0);
        return quantity > 0 ? [{
          collectionLineId: line.id,
          recommendedDisposition,
          quantity,
          conditionNotes: lineDraft.conditionNotes || "",
          evidence: String(lineDraft.evidence || "").split(",").map((url) => url.trim()).filter(Boolean),
        }] : [];
      });
    });
    if (!lines.length) {
      toast.error("Enter inspected quantities and a proposed review route.");
      return;
    }
    setSavingInspectionId(collection.id);
    try {
      const response = await axios.post(
        `${returnsEndpoint}/${stockReturn.id}/collections/${collection.id}/inspection`,
        { notes: draft.notes || "", lines },
        { headers: { token, "Idempotency-Key": globalThis.crypto.randomUUID() } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to record warehouse inspection.");
      toast.success("Inspection recommendation recorded; stock remains quarantined.");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to record warehouse inspection.");
    } finally {
      setSavingInspectionId("");
    }
  };

  const recordDiscrepancyInvestigation = async (stockReturn, discrepancy) => {
    const draft = discrepancyReviewDrafts[discrepancy.id] || {};
    const evidence = String(draft.evidence || "").split(",").map((url) => url.trim()).filter(Boolean);
    setSavingDiscrepancyReviewId(discrepancy.id);
    try {
      const response = await axios.post(
        `${returnsEndpoint}/${stockReturn.id}/discrepancies/${discrepancy.id}/reviews`,
        { notes: draft.notes || "", evidence },
        { headers: { token, "Idempotency-Key": globalThis.crypto.randomUUID() } },
      );
      if (!response.data?.success) {
        throw new Error(response.data?.message || "Unable to record the discrepancy investigation.");
      }
      toast.success("Investigation note recorded; discrepancy remains open.");
      setDiscrepancyReviewDrafts((current) => ({ ...current, [discrepancy.id]: { notes: "", evidence: "" } }));
      setRefreshKey((current) => current + 1);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to record the discrepancy investigation.");
    } finally {
      setSavingDiscrepancyReviewId("");
    }
  };

  const updateCollectionDraft = (returnId, patch) => setCollectionDrafts((current) => ({
    ...current,
    [returnId]: { ...current[returnId], ...patch },
  }));
  const updateCollectionQuantity = (returnId, lineId, value) => setCollectionDrafts((current) => ({
    ...current,
    [returnId]: {
      ...current[returnId],
      quantities: { ...current[returnId]?.quantities, [lineId]: value },
    },
  }));
  const updateReceiptDraft = (collectionId, patch) => setReceiptDrafts((current) => ({
    ...current,
    [collectionId]: { ...current[collectionId], ...patch },
  }));
  const updateReceiptLine = (collectionId, lineId, patch) => setReceiptDrafts((current) => ({
    ...current,
    [collectionId]: {
      ...current[collectionId],
      lines: {
        ...current[collectionId]?.lines,
        [lineId]: { ...current[collectionId]?.lines?.[lineId], ...patch },
      },
    },
  }));
  const updateInspectionDraft = (collectionId, patch) => setInspectionDrafts((current) => ({
    ...current,
    [collectionId]: { ...current[collectionId], ...patch },
  }));
  const updateInspectionLine = (collectionId, lineId, patch) => setInspectionDrafts((current) => ({
    ...current,
    [collectionId]: {
      ...current[collectionId],
      lines: {
        ...current[collectionId]?.lines,
        [lineId]: { ...current[collectionId]?.lines?.[lineId], ...patch },
      },
    },
  }));
  const updateInspectionQuantity = (collectionId, lineId, disposition, value, receivedQuantity) => setInspectionDrafts((current) => {
    const existingQuantities = current[collectionId]?.lines?.[lineId]?.quantities || {};
    const quantities = Object.fromEntries(returnDispositionOptions.map(([key]) => [key, Number(existingQuantities[key] || 0)]));
    if (existingQuantities[disposition] === undefined && !Object.values(existingQuantities).some((quantity) => Number(quantity) > 0)) {
      quantities.UNRESOLVED = receivedQuantity;
    }
    quantities[disposition] = value;
    return {
      ...current,
      [collectionId]: {
        ...current[collectionId],
        lines: {
          ...current[collectionId]?.lines,
          [lineId]: { ...current[collectionId]?.lines?.[lineId], quantities },
        },
      },
    };
  });

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-bold">Operational return control only</p>
        <p className="mt-1 text-xs leading-5">
          Approval removes units from sellable distributor stock and holds them at the distributor. This phase records cost-layer traces for review only; it does not post an impairment, donation, disposal, or general-ledger entry.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Units on hand", totals?.unitsOnHand ?? "—"],
          ["Available units", totals?.availableUnits ?? "—"],
          ["Retail value estimate", totals ? amountText(totals.estimatedRetailValue) : "—"],
          ["Cost value estimate", totals ? amountText(totals.estimatedCostValue) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-lg font-black text-slate-900">{value}</p>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-bold text-slate-900">Current inventory</h2>
          <p className="mt-0.5 text-xs text-slate-500">Value estimates use current product retail and cost prices, not historical cost layers.</p>
        </div>
        {canManageStockReturns && <form onSubmit={createReturn} className="grid gap-3 border-b border-slate-100 bg-slate-50 p-5 md:grid-cols-[minmax(0,1fr)_minmax(260px,1fr)_auto] md:items-end">
          <label className="text-xs font-semibold text-slate-600">
            Return reason
            <textarea rows={2} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} maxLength={2000} required minLength={5} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Reason for collecting this stock" />
          </label>
          <p className="text-xs leading-5 text-slate-600">Choose quantities in the table below. Requests are checked again at approval because distributor stock may change before review.</p>
          <button type="submit" disabled={savingReturn || loading || !inventory.length} className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">
            {savingReturn ? "Submitting…" : "Request stock return"}
          </button>
        </form>}
        {loading ? <p className="px-5 py-12 text-center text-sm text-slate-500">Loading inventory…</p> : inventory.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">No active distributor stock is recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-3">Product / SKU</th><th className="px-5 py-3">On hand</th><th className="px-5 py-3">Reserved</th><th className="px-5 py-3">Available</th><th className="px-5 py-3">Retail estimate</th><th className="px-5 py-3">Cost estimate</th>{canManageStockReturns && <th className="px-5 py-3">Return request</th>}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inventory.map((item) => (
                  <tr key={item.inventorySkuId}>
                    <td className="px-5 py-3"><p className="font-semibold text-slate-900">{item.productName}</p><p className="text-xs text-slate-500">{item.size} · {item.color}</p></td>
                    <td className="px-5 py-3">{item.quantity}</td><td className="px-5 py-3">{item.reservedQty}</td><td className="px-5 py-3 font-bold">{item.availableQty}</td>
                    <td className="px-5 py-3">{amountText(item.estimatedRetailValue)}</td><td className="px-5 py-3">{amountText(item.estimatedCostValue)}</td>
                    {canManageStockReturns && <td className="px-5 py-3"><input type="number" min="0" max={item.availableQty} step="1" value={returnQuantities[item.inventorySkuId] || ""} onChange={(event) => setReturnQuantities((current) => ({ ...current, [item.inventorySkuId]: event.target.value }))} className="w-24 rounded-md border border-slate-300 px-2 py-1.5" aria-label={`Return quantity for ${item.productName} ${item.size} ${item.color}`} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pagination && pagination.total > 0 && <div className="border-t border-slate-100 px-5"><Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} limit={pagination.limit} onPageChange={setPage} loading={loading} /></div>}
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-bold text-slate-900">Distributor stock return authorizations</h2>
          <p className="mt-1 text-xs text-slate-500">Inventory remains platform-owned; approval, collection, and receipt track custody only. Received units stay quarantined, and no new inventory value or accounting disposition is posted here.</p>
        </div>
        {stockReturnsLoading ? <p className="px-5 py-8 text-center text-sm text-slate-500">Loading return requests…</p> : stockReturns.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">No distributor stock return requests recorded.</p>
        ) : <div className="divide-y divide-slate-100">{stockReturns.map((stockReturn) => (
          <article key={stockReturn.id} className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-semibold text-slate-900">Request {stockReturn.id.slice(0, 8)} · {stockReturn.status.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-500">{dateText(stockReturn.createdAt)} · {stockReturn.reason}</p></div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={exportingAuditReportId === stockReturn.id}
                  onClick={() => exportStockReturnAuditReport(stockReturn.id)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                >
                  {exportingAuditReportId === stockReturn.id ? "Preparing audit report…" : "Export audit CSV"}
                </button>
                {canManageStockReturns && stockReturn.status === "PENDING_APPROVAL" && <>
                  <button type="button" disabled={savingReviewId === stockReturn.id} onClick={() => reviewReturn(stockReturn, "APPROVE")} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Approve selected quantities</button>
                  <button type="button" disabled={savingReviewId === stockReturn.id} onClick={() => reviewReturn(stockReturn, "REJECT")} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">Reject</button>
                </>}
              </div>
            </div>
            <p className="break-all font-mono text-[10px] text-slate-500">Stock return ID: {stockReturn.id}</p>
            {(stockReturn.carryingExpenses || []).length > 0 && (
              <div className="space-y-2 rounded-lg border border-amber-100 bg-amber-50 p-3">
                <div className="flex flex-wrap justify-between gap-2 text-xs">
                  <p className="font-bold text-amber-950">Linked carrying expenses</p>
                  <p className="font-bold text-amber-950">
                    Total {amountText(stockReturn.carryingExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0))}
                  </p>
                </div>
                {stockReturn.carryingExpenses.map((expense) => (
                  <div key={expense.id} className="flex flex-wrap justify-between gap-2 border-t border-amber-200 pt-2 text-[11px] text-amber-950">
                    <span>{dateText(expense.date)} · {expense.partyName || "Payee"}{expense.invoiceNumber ? ` · Ref ${expense.invoiceNumber}` : ""}</span>
                    <span className="font-semibold">{amountText(expense.amount)} · {expense.description || "Direct operating expense"}</span>
                  </div>
                ))}
                <p className="text-[10px] text-amber-800">Operating expenses only; these amounts are not added to inventory carrying value.</p>
              </div>
            )}
            <div className="space-y-2">{stockReturn.lines.map((line) => (
              <div key={line.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className="font-semibold text-slate-800">{line.productNameSnapshot} · {line.sizeSnapshot} / {line.colorSnapshot}</span>
                <span className="text-slate-600">Requested {line.requestedQuantity}{line.approvedQuantity !== null ? ` · Approved ${line.approvedQuantity} · Held ${line.heldQuantity}` : ""}</span>
                {canManageStockReturns && stockReturn.status === "PENDING_APPROVAL" && <label className="text-slate-600">Approve <input type="number" min="0" max={line.requestedQuantity} step="1" value={approvalQuantities[`${stockReturn.id}:${line.id}`] ?? line.requestedQuantity} onChange={(event) => setApprovalQuantities((current) => ({ ...current, [`${stockReturn.id}:${line.id}`]: event.target.value }))} className="ml-1 w-20 rounded border border-slate-300 px-2 py-1" /></label>}
                {line.approvedQuantity !== null && <span className="w-full text-slate-500">Layer COGS snapshot NPR {Number(line.layerCogsAmount).toFixed(2)} · cost traced {line.costedQuantity}/{line.heldQuantity} · non-posting</span>}
              </div>
            ))}</div>
            {canManageStockReturns && stockReturn.status === "PENDING_APPROVAL" && <label className="block text-xs font-semibold text-slate-600">Review notes
              <input value={reviewNotes[stockReturn.id] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [stockReturn.id]: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Required when rejecting" maxLength={2000} />
            </label>}
            {canManageStockReturns && ["AUTHORIZED_FOR_COLLECTION", "PARTIALLY_COLLECTED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(stockReturn.status)
              && stockReturn.lines.some((line) => remainingApprovedReturnQuantity(stockReturn, line) > 0) && (
                <form onSubmit={(event) => { event.preventDefault(); createCollection(stockReturn); }} className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <div>
                    <p className="text-xs font-bold text-blue-950">Record physical collection</p>
                    <p className="mt-1 text-[11px] text-blue-800">Only enter quantities handed to the carrier. Each collection creates a traceable transit location and ledger movement.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-[11px] font-semibold text-slate-600">Carrier
                      <input value={collectionDrafts[stockReturn.id]?.carrier || ""} onChange={(event) => updateCollectionDraft(stockReturn.id, { carrier: event.target.value })} maxLength={191} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">Tracking / handover reference
                      <input value={collectionDrafts[stockReturn.id]?.trackingReference || ""} onChange={(event) => updateCollectionDraft(stockReturn.id, { trackingReference: event.target.value })} maxLength={191} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">Collection notes
                      <input value={collectionDrafts[stockReturn.id]?.notes || ""} onChange={(event) => updateCollectionDraft(stockReturn.id, { notes: event.target.value })} maxLength={2000} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">Handover evidence URLs (comma-separated)
                      <input value={collectionDrafts[stockReturn.id]?.handoverEvidence || ""} onChange={(event) => updateCollectionDraft(stockReturn.id, { handoverEvidence: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="https://…" />
                    </label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {stockReturn.lines.map((line) => {
                      const remaining = remainingApprovedReturnQuantity(stockReturn, line);
                      return <label key={line.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs">
                        <span className="font-semibold text-slate-700">{line.productNameSnapshot} · {line.sizeSnapshot}/{line.colorSnapshot} <span className="font-normal text-slate-500">({remaining} remaining)</span></span>
                        <input type="number" min="0" max={remaining} step="1" disabled={remaining === 0} value={collectionDrafts[stockReturn.id]?.quantities?.[line.id] ?? remaining} onChange={(event) => updateCollectionQuantity(stockReturn.id, line.id, event.target.value)} className="w-24 rounded border border-slate-300 px-2 py-1" aria-label={`Collection quantity for ${line.productNameSnapshot}`} />
                      </label>;
                    })}
                  </div>
                  <button type="submit" disabled={savingCollectionId === stockReturn.id} className="rounded-lg bg-blue-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                    {savingCollectionId === stockReturn.id ? "Recording collection…" : "Record collection and dispatch"}
                  </button>
                </form>
              )}
            {(stockReturn.collections || []).length > 0 && <div className="space-y-3 border-t border-slate-100 pt-3">
              <p className="text-xs font-bold text-slate-700">Collection and warehouse receipt history</p>
              {stockReturn.collections.map((collection) => (
                <div key={collection.id} className="space-y-3 rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap justify-between gap-2 text-xs">
                    <div><p className="font-semibold text-slate-800">Collection {collection.id.slice(0, 8)} · {collection.status.replaceAll("_", " ")}</p><p className="mt-1 text-slate-500">{dateText(collection.collectedAt)} · {collection.carrier || "Carrier not specified"} · {collection.trackingReference || "No reference"}</p></div>
                    {collection.receivedAt && <p className="text-slate-500">Received {dateText(collection.receivedAt)}</p>}
                  </div>
                  {Array.isArray(collection.handoverEvidence) && collection.handoverEvidence.length > 0 && <div className="flex flex-wrap gap-2 text-[11px]">
                    {collection.handoverEvidence.map((url, index) => <a key={`${collection.id}:evidence:${index}`} href={url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">Handover evidence {index + 1}</a>)}
                  </div>}
                  <div className="space-y-2">
                    {collection.lines.map((line) => (
                      <div key={line.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        <p className="font-semibold">{line.stockReturnLine.productNameSnapshot} · {line.stockReturnLine.sizeSnapshot}/{line.stockReturnLine.colorSnapshot} · collected {line.collectedQuantity}</p>
                        {collection.status === "RECEIVED" && <>
                          <p className="mt-1 text-slate-500">Good {line.receivedGoodQuantity} · damaged {line.receivedDamagedQuantity} · missing {line.missingQuantity}{line.damageType ? ` · ${line.damageType.replaceAll("_", " ")}` : ""}</p>
                          {line.receiptNotes && <p className="mt-1 text-slate-500">Inspection notes: {line.receiptNotes}</p>}
                          {Array.isArray(line.evidence) && line.evidence.length > 0 && <div className="mt-1 flex flex-wrap gap-2">
                            {line.evidence.map((url, index) => <a key={`${line.id}:evidence:${index}`} href={url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">Receipt evidence {index + 1}</a>)}
                          </div>}
                          {(line.receivedDamagedQuantity > 0 || line.missingQuantity > 0) && <p className="mt-1 font-semibold text-amber-700">Inventory discrepancy recorded; no loss or impairment journal was posted.</p>}
                          {(line.discrepancies || []).map((discrepancy) => (
                            <div key={discrepancy.id} className="mt-2 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                              <div className="flex flex-wrap justify-between gap-2 text-[11px]">
                                <span className="font-bold text-amber-950">
                                  {discrepancy.discrepancyType.replaceAll("_", " ")} · {discrepancy.quantity} · {discrepancy.status.replaceAll("_", " ")}
                                </span>
                                <span className="text-amber-800">Financial responsibility: {discrepancy.financialResponsibleParty}</span>
                              </div>
                              {discrepancy.details && <p className="text-[11px] text-amber-900">{discrepancy.details}</p>}
                              {(discrepancy.investigationReviews || []).map((review) => (
                                <div key={review.id} className="border-t border-amber-200 pt-2 text-[11px]">
                                  <p className="whitespace-pre-wrap text-amber-950">{review.notes}</p>
                                  <p className="mt-1 text-[10px] text-amber-700">{dateText(review.createdAt)} · Admin {review.reviewedBy}</p>
                                  {Array.isArray(review.evidence) && review.evidence.length > 0 && <div className="mt-1 flex flex-wrap gap-2">
                                    {review.evidence.map((url, index) => <a key={`${review.id}:evidence:${index}`} href={url} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">Investigation evidence {index + 1}</a>)}
                                  </div>}
                                </div>
                              ))}
                              {canManageStockReturns && ["OPEN", "UNDER_REVIEW"].includes(discrepancy.status) && (
                                <form
                                  onSubmit={(event) => { event.preventDefault(); recordDiscrepancyInvestigation(stockReturn, discrepancy); }}
                                  className="space-y-2 border-t border-amber-200 pt-2"
                                >
                                  <label className="block text-[10px] font-semibold text-amber-900">Investigation note
                                    <textarea
                                      value={discrepancyReviewDrafts[discrepancy.id]?.notes || ""}
                                      onChange={(event) => setDiscrepancyReviewDrafts((current) => ({
                                        ...current,
                                        [discrepancy.id]: { ...current[discrepancy.id], notes: event.target.value },
                                      }))}
                                      required
                                      minLength={5}
                                      maxLength={4000}
                                      rows={2}
                                      className="mt-1 w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-xs"
                                      placeholder="Record carrier contact, recount, or other investigation findings"
                                    />
                                  </label>
                                  <label className="block text-[10px] font-semibold text-amber-900">Evidence URLs (comma-separated)
                                    <input
                                      value={discrepancyReviewDrafts[discrepancy.id]?.evidence || ""}
                                      onChange={(event) => setDiscrepancyReviewDrafts((current) => ({
                                        ...current,
                                        [discrepancy.id]: { ...current[discrepancy.id], evidence: event.target.value },
                                      }))}
                                      className="mt-1 w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-xs"
                                      placeholder="https://…"
                                    />
                                  </label>
                                  <button
                                    type="submit"
                                    disabled={savingDiscrepancyReviewId === discrepancy.id}
                                    className="rounded bg-amber-800 px-3 py-1.5 text-[10px] font-bold text-white disabled:opacity-50"
                                  >
                                    {savingDiscrepancyReviewId === discrepancy.id ? "Saving…" : "Record investigation note"}
                                  </button>
                                  <p className="text-[10px] text-amber-800">This keeps the discrepancy under review; it does not assign responsibility, change stock, or post a write-off.</p>
                                </form>
                              )}
                            </div>
                          ))}
                        </>}
                      </div>
                    ))}
                  </div>
                  {canManageStockReturns && collection.status === "IN_TRANSIT" && (
                    <form onSubmit={(event) => { event.preventDefault(); recordCollectionReceipt(stockReturn, collection); }} className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                      <div>
                        <p className="text-xs font-bold text-emerald-950">Record warehouse inspection and receipt</p>
                        <p className="mt-1 text-[11px] text-emerald-800">Good plus damaged plus missing must equal the collected quantity. Damaged and missing counts open inventory discrepancies. All physically received stock stays quarantined.</p>
                      </div>
                      <label className="block text-[11px] font-semibold text-slate-600">Receipt notes
                        <input value={receiptDrafts[collection.id]?.notes || ""} onChange={(event) => updateReceiptDraft(collection.id, { notes: event.target.value })} maxLength={2000} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                      </label>
                      {collection.lines.map((line) => {
                        const lineDraft = receiptDrafts[collection.id]?.lines?.[line.id] || {};
                        const damaged = Number(lineDraft.receivedDamagedQuantity || 0) > 0;
                        const missing = Number(lineDraft.missingQuantity || 0) > 0;
                        return <div key={line.id} className="space-y-2 rounded-lg bg-white p-3">
                          <p className="text-xs font-semibold text-slate-800">{line.stockReturnLine.productNameSnapshot} · {line.stockReturnLine.sizeSnapshot}/{line.stockReturnLine.colorSnapshot} · collected {line.collectedQuantity}</p>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <label className="text-[10px] font-semibold text-slate-600">Good received
                              <input type="number" min="0" max={line.collectedQuantity} step="1" value={lineDraft.receivedGoodQuantity ?? line.collectedQuantity} onChange={(event) => updateReceiptLine(collection.id, line.id, { receivedGoodQuantity: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
                            </label>
                            <label className="text-[10px] font-semibold text-slate-600">Damaged received
                              <input type="number" min="0" max={line.collectedQuantity} step="1" value={lineDraft.receivedDamagedQuantity ?? 0} onChange={(event) => updateReceiptLine(collection.id, line.id, { receivedDamagedQuantity: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
                            </label>
                            <label className="text-[10px] font-semibold text-slate-600">Missing
                              <input type="number" min="0" max={line.collectedQuantity} step="1" value={lineDraft.missingQuantity ?? 0} onChange={(event) => updateReceiptLine(collection.id, line.id, { missingQuantity: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
                            </label>
                          </div>
                          {damaged && <label className="block text-[10px] font-semibold text-slate-600">Damage type
                            <select value={lineDraft.damageType || ""} onChange={(event) => updateReceiptLine(collection.id, line.id, { damageType: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" required>
                              <option value="">Select damage type</option><option value="STITCH_DAMAGE">Stitch damage</option><option value="DELIVERY_DAMAGE">Delivery damage</option><option value="OTHER_DAMAGE">Other damage</option>
                            </select>
                          </label>}
                          {(damaged || missing) && <>
                            <label className="block text-[10px] font-semibold text-slate-600">Reason / inspection notes (required)
                              <textarea value={lineDraft.receiptNotes || ""} onChange={(event) => updateReceiptLine(collection.id, line.id, { receiptNotes: event.target.value })} minLength={5} maxLength={4000} required rows={2} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
                            </label>
                            <label className="block text-[10px] font-semibold text-slate-600">Evidence URLs (comma-separated)
                              <input value={lineDraft.evidence || ""} onChange={(event) => updateReceiptLine(collection.id, line.id, { evidence: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" placeholder="https://…" />
                            </label>
                          </>}
                        </div>;
                      })}
                      <button type="submit" disabled={savingReceiptId === collection.id} className="rounded-lg bg-emerald-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                        {savingReceiptId === collection.id ? "Saving receipt…" : "Record complete receipt"}
                      </button>
                    </form>
                  )}
                  {collection.status === "RECEIVED" && collection.inspection && <div className="space-y-2 rounded-lg border border-violet-100 bg-violet-50 p-3">
                    <div className="flex flex-wrap justify-between gap-2 text-xs">
                      <p className="font-bold text-violet-950">Warehouse inspection recorded · recommendation only</p>
                      <p className="text-violet-700">{dateText(collection.inspection.inspectedAt)}</p>
                    </div>
                    {collection.inspection.notes && <p className="text-xs text-violet-800">{collection.inspection.notes}</p>}
                    <div className="space-y-1">
                      {collection.inspection.lines.map((line) => {
                        const returnLine = collection.lines.find(({ id }) => id === line.collectionLineId);
                        return <p key={line.id} className="text-xs text-violet-900">
                          {returnLine?.stockReturnLine?.productNameSnapshot || "SKU"} · {returnLine?.stockReturnLine?.sizeSnapshot || "—"}/{returnLine?.stockReturnLine?.colorSnapshot || "—"} · {line.quantity} · {line.recommendedDisposition.replaceAll("_", " ")} · {line.conditionNotes}
                        </p>;
                      })}
                    </div>
                    <p className="text-[11px] font-semibold text-violet-800">Inspection did not move stock, release quarantine, set value, or post accounting. A separate approved disposition workflow is required.</p>
                  </div>}
                  {canManageStockReturns && collection.status === "RECEIVED" && !collection.inspection
                    && collection.lines.some((line) => Number(line.receivedGoodQuantity || 0) + Number(line.receivedDamagedQuantity || 0) > 0) && (
                      <form onSubmit={(event) => { event.preventDefault(); recordCollectionInspection(stockReturn, collection); }} className="space-y-3 rounded-lg border border-violet-100 bg-violet-50 p-3">
                        <div>
                          <p className="text-xs font-bold text-violet-950">Record warehouse inspection and recommendation</p>
                          <p className="mt-1 text-[11px] text-violet-800">Allocate every physically received unit to a proposed review route. This is not authorization to sell, donate, scrap, repair, release, or book a financial value; all quantities remain quarantined.</p>
                        </div>
                        <label className="block text-[11px] font-semibold text-slate-600">Overall inspection notes
                          <textarea value={inspectionDrafts[collection.id]?.notes || ""} onChange={(event) => updateInspectionDraft(collection.id, { notes: event.target.value })} maxLength={2000} rows={2} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                        </label>
                        {collection.lines.filter((line) => Number(line.receivedGoodQuantity || 0) + Number(line.receivedDamagedQuantity || 0) > 0).map((line) => {
                          const receivedQuantity = Number(line.receivedGoodQuantity || 0) + Number(line.receivedDamagedQuantity || 0);
                          const lineDraft = inspectionDrafts[collection.id]?.lines?.[line.id] || {};
                          const quantities = lineDraft.quantities || { UNRESOLVED: receivedQuantity };
                          const allocated = returnDispositionOptions.reduce((sum, [key]) => sum + Number(quantities[key] || 0), 0);
                          return <div key={line.id} className="space-y-2 rounded-lg bg-white p-3">
                            <div className="flex flex-wrap justify-between gap-2 text-xs">
                              <p className="font-semibold text-slate-800">{line.stockReturnLine.productNameSnapshot} · {line.stockReturnLine.sizeSnapshot}/{line.stockReturnLine.colorSnapshot}</p>
                              <p className={allocated === receivedQuantity ? "font-bold text-emerald-700" : "font-bold text-rose-700"}>Physically received {receivedQuantity} · allocated {allocated}</p>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {returnDispositionOptions.map(([key, label]) => <label key={key} className="text-[10px] font-semibold text-slate-600">{label}
                                <input type="number" min="0" max={receivedQuantity} step="1" value={quantities[key] ?? 0} onChange={(event) => updateInspectionQuantity(collection.id, line.id, key, event.target.value, receivedQuantity)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
                              </label>)}
                            </div>
                            <label className="block text-[10px] font-semibold text-slate-600">Observed condition / justification (required for each nonzero route)
                              <textarea value={lineDraft.conditionNotes || ""} onChange={(event) => updateInspectionLine(collection.id, line.id, { conditionNotes: event.target.value })} minLength={5} maxLength={4000} required rows={2} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
                            </label>
                            <label className="block text-[10px] font-semibold text-slate-600">Inspection evidence URLs (comma-separated)
                              <input value={lineDraft.evidence || ""} onChange={(event) => updateInspectionLine(collection.id, line.id, { evidence: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" placeholder="https://…" />
                            </label>
                          </div>;
                        })}
                        <button type="submit" disabled={savingInspectionId === collection.id} className="rounded-lg bg-violet-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                          {savingInspectionId === collection.id ? "Saving inspection…" : "Record inspection recommendation"}
                        </button>
                      </form>
                    )}
                </div>
              ))}
            </div>}
          </article>
        ))}</div>}
      </section>
    </section>
  );
};

export const DistributorSessionsSection = ({ distributorId, token }) => (
  <RecordList
    endpoint={`${backendUrl}/api/admin/distributors/${distributorId}/login-history`}
    responseKey="logins"
    token={token}
    renderRecord={(session) => (
      <div className="flex flex-wrap justify-between gap-3">
        <div><p className="font-semibold text-slate-900">{String(session.action || "LOGIN").replaceAll("_", " ")} · {session.status}</p><p className="mt-1 text-xs text-slate-500">{session.userAgent || "Client information unavailable"}</p><p className="mt-1 text-xs text-slate-500">IP: {session.ipAddress || "—"} · Portal: {session.portal || "—"} · Role: {session.role || "—"}</p>{session.failureReason && <p className="mt-1 text-xs text-rose-600">Failure: {session.failureReason}</p>}</div>
        <div className="text-right text-xs text-slate-500"><p>{dateText(session.createdAt)}</p></div>
      </div>
    )}
    emptyMessage="No login sessions are recorded."
  />
);

export const DistributorTransfersSection = ({ distributorId, token }) => (
  <RecordList
    endpoint={`${backendUrl}/api/stock-transfers/admin`}
    responseKey="transfers"
    token={token}
    queryParams={{ distributorId }}
    renderRecord={(transfer) => (
      <div className="flex flex-wrap justify-between gap-3">
        <div className="min-w-0 flex-1"><p className="font-semibold text-slate-900">Transfer {transfer.id}</p><p className="mt-1 text-xs text-slate-500">{transfer.manufacturer?.name || "Manufacturer"} → {transfer.distributor?.name || "Distributor"}</p><p className="mt-1 text-xs text-slate-500">{transfer.lines?.length || 0} SKU lines · {transfer.shipments?.length || 0} shipments · {transfer.discrepancies?.length || 0} discrepancies</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-700">{(transfer.lines || []).slice(0, 5).map((line) => <li key={line.id}>{line.inventorySku?.product?.name || "Product"} · {line.inventorySku?.size || "—"} / {line.inventorySku?.color || "—"} · requested {line.requestedQuantity} · dispatched {line.dispatchedQuantity} · received good {receiptQuantity(line, "goodQuantity")} · damaged {receiptQuantity(line, "damagedQuantity")} · missing {receiptQuantity(line, "missingQuantity")}</li>)}</ul>
          {(transfer.shipments || []).slice(0, 3).map((shipment) => <p key={shipment.id} className="mt-2 text-xs text-slate-500">Shipment {shipment.status} · {shipment.bookingMode} · {shipment.trackingNumber || shipment.externalReference || "No tracking"} · freight {amountText(shipment.freightCharge)}</p>)}
        </div>
        <div className="text-right"><p className="text-xs font-bold uppercase text-slate-700">{transfer.status}</p><p className="mt-1 text-xs text-slate-500">Requested {dateText(transfer.requestedAt)}</p><p className="mt-1 text-xs text-slate-500">Updated {dateText(transfer.updatedAt)}</p></div>
      </div>
    )}
    emptyMessage="No stock transfers are recorded for this distributor."
  />
);

export const DistributorFulfillmentSection = ({ distributorId, token }) => (
  <RecordList
    endpoint={`${backendUrl}/api/order-assignment/admin/all`}
    responseKey="assignments"
    token={token}
    queryParams={{ distributorId }}
    renderRecord={(assignment) => (
      <div className="space-y-2">
        <div className="flex flex-wrap justify-between gap-3">
          <div><p className="font-semibold text-slate-900">Order {assignment.orderId}</p><p className="mt-1 text-xs text-slate-500">Assigned {dateText(assignment.assignedAt)} · Delivered {dateText(assignment.deliveredAt)}</p></div>
          <div className="text-right"><p className="text-xs font-bold uppercase text-slate-700">{assignment.status} · {assignment.deliveryType || "—"}</p><p className="mt-1 text-xs text-slate-500">COD {amountText(assignment.delivery?.codAmount)} · delivery fee {amountText(assignment.order?.deliveryFee)}</p></div>
        </div>
        <p className="text-xs text-slate-600">Items: {listText(assignment.order?.items)}</p>
        {assignment.delivery?.events?.length > 0 && <p className="text-xs text-slate-500">Latest delivery event: {assignment.delivery.events[0].eventType} · {dateText(assignment.delivery.events[0].occurredAt)}</p>}
      </div>
    )}
    emptyMessage="No order assignments are recorded for this distributor."
  />
);

export const DistributorReturnsSection = ({ distributorId, token }) => (
  <RecordList
    endpoint={`${backendUrl}/api/admin/distributors/${distributorId}/returns`}
    responseKey="returns"
    token={token}
    renderRecord={(record) => (
      <div className="flex flex-wrap justify-between gap-3">
        <div><p className="font-semibold text-slate-900">Return {record.id}</p><p className="mt-1 text-xs text-slate-500">Order {record.orderId || "—"} · {record.customerName} · {record.customerPhone || "No phone"}</p><p className="mt-1 text-xs text-slate-600">Reason: {record.reason || "—"}</p><p className="mt-1 text-xs text-slate-500">{listText(record.items)}</p>{record.events?.[0] && <p className="mt-2 text-xs text-slate-500">Latest: {record.events[0].eventType} · {record.events[0].toStatus || "—"} · {dateText(record.events[0].occurredAt)}</p>}</div>
        <div className="text-right"><p className="text-xs font-bold uppercase text-slate-700">{record.lifecycleStatus || record.refundStatus}</p><p className="mt-1 text-xs text-slate-500">Refund {amountText(record.totalRefundAmount)}</p><p className="mt-1 text-xs text-slate-500">Created {dateText(record.createdAt || record.returnDate)}</p></div>
      </div>
    )}
    emptyMessage="No return activity is recorded for this distributor."
  />
);

export const DistributorExchangesSection = ({ distributorId, token }) => (
  <RecordList
    endpoint={`${backendUrl}/api/admin/distributors/${distributorId}/exchanges`}
    responseKey="exchanges"
    token={token}
    renderRecord={(record) => (
      <div className="flex flex-wrap justify-between gap-3">
        <div><p className="font-semibold text-slate-900">Exchange {record.id}</p><p className="mt-1 text-xs text-slate-500">Order {record.orderId} · {record.customer?.name || record.customerName} · {record.customer?.phone || record.customerPhone || "No phone"}</p><p className="mt-1 text-xs text-slate-600">Reason: {record.reasonCode} {record.reasonDetails ? `· ${record.reasonDetails}` : ""}</p><p className="mt-1 text-xs text-slate-500">Items: {listText(record.items)} · Replacement: {listText(record.replacementItems)}</p>{record.events?.[0] && <p className="mt-2 text-xs text-slate-500">Latest: {record.events[0].eventType} · {record.events[0].toStatus || "—"} · {dateText(record.events[0].occurredAt)}</p>}</div>
        <div className="text-right"><p className="text-xs font-bold uppercase text-slate-700">{record.status}</p><p className="mt-1 text-xs text-slate-500">Price difference {amountText(record.priceDifference)}</p><p className="mt-1 text-xs text-slate-500">Created {dateText(record.createdAt)}</p></div>
      </div>
    )}
    emptyMessage="No exchange activity is recorded for this distributor."
  />
);

const DistributorCodRemittances = ({ distributorId, token }) => {
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountByBatch, setAccountByBatch] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyBatchId, setBusyBatchId] = useState(null);
  const [postingSettlement, setPostingSettlement] = useState(false);
  const [settlementFormOpen, setSettlementFormOpen] = useState(false);
  const [settlementForm, setSettlementForm] = useState({
    requestedAmount: "",
    setoffAgreementReference: "",
    setoffConfirmed: false,
    notes: "",
  });
  const [payoutFormByRequest, setPayoutFormByRequest] = useState({});
  const endpoint = `${backendUrl}/api/admin/distributors/${distributorId}/finance/remittances`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [remittanceResponse, accountResponse] = await Promise.all([
        axios.get(endpoint, { headers: { token }, params: { limit: 50 } }),
        axios.get(`${backendUrl}/api/finance/treasury-accounts`, { headers: { token } }),
      ]);
      setData(remittanceResponse.data);
      setAccounts(accountResponse.data?.accounts || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not load distributor COD remittances.");
      setData(null);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [endpoint, token]);

  useEffect(() => { load(); }, [load]);

  const review = async (batch, decision) => {
    const reviewNotes = decision === "REJECT"
      ? window.prompt("Why is this remittance being rejected?")?.trim()
      : "";
    if (decision === "REJECT" && !reviewNotes) return;
    const financialAccountId = accountByBatch[batch.id] || accounts.find((account) =>
      account.status === "ACTIVE" &&
      account.currency === "NPR" &&
      ["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
    )?.id;
    if (decision === "VERIFY" && !financialAccountId) {
      toast.error("Select an active NPR treasury account before verifying.");
      return;
    }
    setBusyBatchId(batch.id);
    try {
      await axios.post(
        `${backendUrl}/api/admin/distributors/${distributorId}/finance/remittances/${batch.id}/review`,
        { decision, financialAccountId, reviewNotes },
        { headers: { token } }
      );
      toast.success(decision === "VERIFY" ? "COD remittance verified and posted." : "COD remittance rejected.");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not review COD remittance.");
    } finally {
      setBusyBatchId(null);
    }
  };

  const postUnifiedSettlement = async () => {
    const position = data?.settlementPosition;
    const maximum = Math.abs(Number(position?.netBalance || 0));
    const requestedAmount = settlementForm.requestedAmount.trim();
    const amount = Number(requestedAmount);
    const offsetAmount = Math.min(
      Number(position?.outstandingReceivable || 0),
      Number(position?.outstandingPayable || 0),
    );
    if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(requestedAmount) || !Number.isFinite(amount) || amount <= 0 || amount > maximum) {
      toast.error(`Enter a positive request amount up to the net balance of NPR ${maximum.toFixed(2)}.`);
      return;
    }
    if (offsetAmount > 0 && (
      !settlementForm.setoffAgreementReference.trim() ||
      !settlementForm.setoffConfirmed
    )) {
      toast.error("Enter the agreement reference and confirm it authorizes this set-off.");
      return;
    }
    if (!settlementForm.notes.trim()) {
      toast.error("Add a note for the settlement request.");
      return;
    }

    setPostingSettlement(true);
    try {
      await axios.post(
        `${backendUrl}/api/admin/distributors/${distributorId}/finance/settlements`,
        {
          requestedAmount,
          setoffAgreementReference: settlementForm.setoffAgreementReference.trim(),
          setoffConfirmed: settlementForm.setoffConfirmed,
          notes: settlementForm.notes.trim(),
          idempotencyKey: window.crypto.randomUUID(),
        },
        { headers: { token } },
      );
      toast.success("Settlement request was issued to the distributor.");
      setSettlementFormOpen(false);
      setSettlementForm({
        requestedAmount: "",
        setoffAgreementReference: "",
        setoffConfirmed: false,
        notes: "",
      });
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not post distributor balance settlement.");
    } finally {
      setPostingSettlement(false);
    }
  };

  const reviewSettlementRequest = async (request, decision) => {
    const reviewNotes = decision === "REJECT"
      ? window.prompt("Why is this transfer evidence being rejected?")?.trim()
      : "";
    if (decision === "REJECT" && !reviewNotes) return;
    const financialAccountId = accountByBatch[request.id] || accounts.find((account) =>
      account.status === "ACTIVE" &&
      account.currency === "NPR" &&
      ["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
    )?.id;
    if (decision === "VERIFY" && !financialAccountId) {
      toast.error("Select the active NPR treasury account that received the transfer.");
      return;
    }
    setBusyBatchId(request.id);
    try {
      await axios.post(
        `${backendUrl}/api/admin/distributors/${distributorId}/finance/settlement-requests/${request.id}/review`,
        { decision, financialAccountId, reviewNotes },
        { headers: { token } },
      );
      toast.success(decision === "VERIFY" ? "Distributor transfer evidence acknowledged and posted." : "Transfer evidence rejected.");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not review settlement evidence.");
    } finally {
      setBusyBatchId(null);
    }
  };

  const recordPayoutTransfer = async (request) => {
    const form = payoutFormByRequest[request.id] || {};
    if (!form.transferReference?.trim() || !form.financialAccountId || !form.evidenceFile) {
      toast.error("Enter the transfer reference, select the treasury account, and attach transfer evidence.");
      return;
    }
    const formData = new FormData();
    formData.append("transferReference", form.transferReference.trim());
    formData.append("financialAccountId", form.financialAccountId);
    formData.append("evidence", form.evidenceFile);
    setBusyBatchId(request.id);
    try {
      await axios.post(
        `${backendUrl}/api/admin/distributors/${distributorId}/finance/settlement-requests/${request.id}/payout`,
        formData,
        { headers: { token } },
      );
      toast.success("Company payout recorded. The distributor can acknowledge receipt.");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not record the company payout.");
    } finally {
      setBusyBatchId(null);
    }
  };

  const settlementPosition = data?.settlementPosition || {};
  const openReceivable = Number(settlementPosition.outstandingReceivable || 0);
  const openPayable = Number(settlementPosition.outstandingPayable || 0);
  const offsetPreview = Math.min(openReceivable, openPayable);
  const maximumNetCash = Math.abs(Number(settlementPosition.netBalance || 0));
  const activeSettlementRequest = (data?.settlementRequests || []).find((request) =>
    ["REQUESTED", "EVIDENCE_SUBMITTED", "PAYMENT_SENT"].includes(request.status)
  );
  const settlementBlocked = Number(settlementPosition.pendingRemittance || 0) > 0 ||
    Number(settlementPosition.pendingSettlementRequests || 0) > 0 ||
    (data?.settlementRequests || []).some((request) => ["REQUESTED", "EVIDENCE_SUBMITTED", "PAYMENT_SENT"].includes(request.status)) ||
    settlementPosition.unifiedSettlementBlocked === true;
  const hasOpenBalance = openReceivable > 0 || openPayable > 0;
  const toggleSettlementForm = () => {
    if (settlementFormOpen) {
      setSettlementFormOpen(false);
      return;
    }
    setSettlementForm({
      requestedAmount: maximumNetCash.toFixed(2),
      setoffAgreementReference: "",
      setoffConfirmed: false,
      notes: "",
    });
    setSettlementFormOpen(true);
  };

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-slate-900">Distributor balance &amp; settlement</h2>
          <p className="mt-1 text-xs text-slate-500">COD, delivery earnings, incentives, refunds, and other posted distributor documents roll into one gross-to-net position.</p>
        </div>
        <button type="button" onClick={load} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Refresh</button>
      </div>
      {loading ? <p className="py-5 text-center text-xs text-slate-500">Loading COD ledger…</p> : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Company receivable", settlementPosition.outstandingReceivable],
              ["Company payable", settlementPosition.outstandingPayable],
              [
                Number(settlementPosition.netBalance || 0) > 0 ? "Net due to company" : "Net due to distributor",
                Math.abs(Number(settlementPosition.netBalance || 0)),
              ],
              ["Pending remittance review", data.position?.pendingRemittance],
            ].map(([label, amount]) => (
              <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-base font-black text-slate-900">{amountText(amount)}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
            <p className="max-w-3xl text-xs leading-5 text-indigo-950">
              Admin issues one request for the distributor's current net amount. The distributor submits evidence for money owed to the company; company payouts are recorded by Admin and acknowledged by the distributor.
            </p>
            <button
              type="button"
              disabled={!hasOpenBalance || maximumNetCash <= 0 || settlementBlocked || postingSettlement}
              onClick={toggleSettlementForm}
              className="rounded-lg bg-indigo-800 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"
            >
              {settlementFormOpen ? "Close request form" : "Issue net settlement request"}
            </button>
          </div>
          {activeSettlementRequest && (
            <p className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
              Request {activeSettlementRequest.id} is in progress ({activeSettlementRequest.status.replaceAll("_", " ")}). Complete or reject it before issuing another request.
            </p>
          )}
          {(Number(settlementPosition.pendingRemittance || 0) > 0 || Number(settlementPosition.pendingSettlementRequests || 0) > 0) && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Clear {Number(settlementPosition.pendingRemittance || 0) > 0 ? "the pending COD remittance review" : ""}
              {Number(settlementPosition.pendingRemittance || 0) > 0 && Number(settlementPosition.pendingSettlementRequests || 0) > 0 ? " and " : ""}
              {Number(settlementPosition.pendingSettlementRequests || 0) > 0 ? "existing distributor settlement request(s)" : ""}
              {" "}before issuing a settlement request.
            </p>
          )}
          {settlementPosition.unifiedSettlementBlocked && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
              <p>
                The net includes {amountText(settlementPosition.excludedLegacyLogisticsPayableTotal)} in legacy return/exchange logistics payables,
                but they are not yet in the accounting subledger. Settle them through Accounts Payable before issuing a settlement request.
              </p>
              <ul className="mt-2 space-y-1">
                {(settlementPosition.excludedLegacyLogisticsPayables || []).map((payable) => (
                  <li key={payable.id}>{payable.title} · {payable.referenceType} · {amountText(payable.remainingBalance)}</li>
                ))}
              </ul>
            </div>
          )}
          {settlementFormOpen && hasOpenBalance && !settlementBlocked && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                postUnifiedSettlement();
              }}
              className="grid gap-3 rounded-xl border border-indigo-200 bg-white p-4 sm:grid-cols-2"
            >
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 sm:col-span-2">
                <p><b>Net balance:</b> {amountText(maximumNetCash)} {Number(settlementPosition.netBalance || 0) >= 0 ? "owed to the company" : "owed to the distributor"}.</p>
                {offsetPreview > 0 && <p className="mt-1"><b>Offset preview:</b> {amountText(offsetPreview)} applied to both gross sides when the request is completed.</p>}
                <p className="mt-1 text-[10px] text-slate-500">The requested amount may be partial, but cannot exceed the current net balance. Transfer evidence is added by the party making the payment.</p>
              </div>
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                Net request amount (maximum {amountText(maximumNetCash)})
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={settlementForm.requestedAmount}
                  onChange={(event) => setSettlementForm((current) => ({ ...current, requestedAmount: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                Set-off agreement/reference {offsetPreview > 0 ? "(required)" : "(optional)"}
                <input
                  type="text"
                  maxLength={191}
                  value={settlementForm.setoffAgreementReference}
                  onChange={(event) => setSettlementForm((current) => ({ ...current, setoffAgreementReference: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required={offsetPreview > 0}
                />
              </label>
              {offsetPreview > 0 && (
                <label className="flex items-start gap-2 text-xs text-slate-700 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={settlementForm.setoffConfirmed}
                    onChange={(event) => setSettlementForm((current) => ({ ...current, setoffConfirmed: event.target.checked }))}
                    required
                    className="mt-0.5"
                  />
                  I confirm the referenced agreement permits offsetting these distributor balances.
                </label>
              )}
              <label className="space-y-1 text-xs font-semibold text-slate-700 sm:col-span-2">
                Request note
                <input
                  type="text"
                  maxLength={2000}
                  value={settlementForm.notes}
                  onChange={(event) => setSettlementForm((current) => ({ ...current, notes: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
                <p className="text-[10px] text-slate-500">No accounting entry is posted until the transfer is verified or acknowledged.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSettlementFormOpen(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-[10px] font-bold text-slate-700">Cancel</button>
                  <button type="submit" disabled={postingSettlement} className="rounded-lg bg-indigo-800 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">
                    {postingSettlement ? "Issuing request…" : "Issue request"}
                  </button>
                </div>
              </div>
            </form>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {[["Open receivable documents", settlementPosition.receivableDocuments], ["Open payable documents", settlementPosition.payableDocuments]].map(([label, documents]) => (
              <details key={label} className="rounded-xl border border-slate-100 bg-white p-3">
                <summary className="cursor-pointer text-xs font-bold text-slate-800">{label} ({documents?.length || 0})</summary>
                <div className="mt-2 max-h-64 space-y-2 overflow-auto">
                  {(documents || []).map((document) => (
                    <div key={document.id} className="flex justify-between gap-3 border-t border-slate-100 pt-2 text-[10px]">
                      <div><p className="font-semibold text-slate-800">{document.documentNumber} · {document.sourceType}</p><p className="text-slate-500">{document.sourceId} · {dateText(document.issueDate)}</p></div>
                      <p className="font-bold text-slate-900">{amountText(document.remainingAmount)}</p>
                    </div>
                  ))}
                  {!documents?.length && <p className="pt-2 text-[10px] text-slate-500">No open documents.</p>}
                </div>
              </details>
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-800">Admin-issued settlement requests</h3>
            {(data.settlementRequests || []).length ? data.settlementRequests.map((request) => (
              <article key={request.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      {request.direction === "COMPANY_COLLECTS" ? "Distributor pays company" : "Company pays distributor"} · {amountText(request.requestedAmount)}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Request {request.id} · {dateText(request.createdAt)} · {request.status.replaceAll("_", " ")}
                    </p>
                    {request.requestNotes && <p className="mt-1 text-[10px] text-slate-600">{request.requestNotes}</p>}
                    {request.setoffAgreementReference && <p className="mt-1 text-[10px] text-slate-500">Set-off authority: {request.setoffAgreementReference}</p>}
                  </div>
                  {request.status === "REQUESTED" && request.direction === "COMPANY_COLLECTS" && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">Waiting for distributor transfer</span>
                  )}
                  {request.status === "PAYMENT_SENT" && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">Waiting for distributor acknowledgment</span>
                  )}
                  {request.status === "ACKNOWLEDGED" && (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800">Receipt acknowledged</span>
                  )}
                </div>

                {request.status === "EVIDENCE_SUBMITTED" && (
                  <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <p className="text-sky-950">Distributor transfer reference: <b>{request.transferReference || "—"}</b></p>
                      {request.evidenceUrl && <a href={request.evidenceUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">View evidence</a>}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="min-w-52 flex-1 text-[10px] font-semibold text-slate-700">
                        Treasury account receiving funds
                        <select
                          value={accountByBatch[request.id] || ""}
                          onChange={(event) => setAccountByBatch((current) => ({ ...current, [request.id]: event.target.value }))}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
                        >
                          <option value="">Select an active NPR account</option>
                          {accounts.filter((account) =>
                            account.status === "ACTIVE" &&
                            account.currency === "NPR" &&
                            ["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
                          ).map((account) => <option key={account.id} value={account.id}>{account.accountName}</option>)}
                        </select>
                      </label>
                      <button type="button" disabled={busyBatchId === request.id} onClick={() => reviewSettlementRequest(request, "VERIFY")} className="rounded-lg bg-emerald-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Acknowledge &amp; verify</button>
                      <button type="button" disabled={busyBatchId === request.id} onClick={() => reviewSettlementRequest(request, "REJECT")} className="rounded-lg bg-rose-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Reject evidence</button>
                    </div>
                  </div>
                )}

                {request.status === "REQUESTED" && request.direction === "COMPANY_PAYS" && (
                  <div className="grid gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 sm:grid-cols-2">
                    <label className="text-[10px] font-semibold text-slate-700">
                      Completed transfer reference
                      <input
                        value={payoutFormByRequest[request.id]?.transferReference || ""}
                        onChange={(event) => setPayoutFormByRequest((current) => ({
                          ...current,
                          [request.id]: { ...current[request.id], transferReference: event.target.value },
                        }))}
                        maxLength={191}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
                      />
                    </label>
                    <label className="text-[10px] font-semibold text-slate-700">
                      Treasury account paid from
                      <select
                        value={payoutFormByRequest[request.id]?.financialAccountId || ""}
                        onChange={(event) => setPayoutFormByRequest((current) => ({
                          ...current,
                          [request.id]: { ...current[request.id], financialAccountId: event.target.value },
                        }))}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
                      >
                        <option value="">Select an active NPR account</option>
                        {accounts.filter((account) =>
                          account.status === "ACTIVE" &&
                          account.currency === "NPR" &&
                          ["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
                        ).map((account) => <option key={account.id} value={account.id}>{account.accountName}</option>)}
                      </select>
                    </label>
                    <label className="text-[10px] font-semibold text-slate-700 sm:col-span-2">
                      Transfer evidence (JPG/PNG)
                      <input
                        type="file"
                        accept="image/jpeg,image/png"
                        onChange={(event) => setPayoutFormByRequest((current) => ({
                          ...current,
                          [request.id]: { ...current[request.id], evidenceFile: event.target.files?.[0] || null },
                        }))}
                        className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-2 text-xs"
                      />
                    </label>
                    <button type="button" disabled={busyBatchId === request.id} onClick={() => recordPayoutTransfer(request)} className="justify-self-start rounded-lg bg-violet-800 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50 sm:col-span-2">
                      {busyBatchId === request.id ? "Recording transfer…" : "Record completed payout"}
                    </button>
                  </div>
                )}

                {request.transferReference && request.direction === "COMPANY_PAYS" && request.status !== "REQUESTED" && (
                  <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-2 text-[10px] text-slate-600">
                    <span>Company transfer: {request.transferReference} · {request.financialAccount?.accountName || "Treasury"}</span>
                    {request.evidenceUrl && <a href={request.evidenceUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">View payout evidence</a>}
                  </div>
                )}
              </article>
            )) : <p className="text-xs text-slate-500">No Admin-issued settlement requests.</p>}
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-800">Unified settlement history</h3>
            {(data.settlements || []).length ? data.settlements.map((settlement) => (
              <details key={settlement.id} className="rounded-xl border border-slate-100 p-3">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 text-xs">
                  <span className="font-bold text-slate-900">{settlement.direction.replaceAll("_", " ")} · {dateText(settlement.postedAt)}</span>
                  <span className="font-black text-slate-900">Cash {amountText(settlement.cashAmount)} · Offset {amountText(settlement.offsetAmount)}</span>
                </summary>
                <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-600">
                  <p>Ref {settlement.reference || "—"} · Set-off authority {settlement.setoffAgreementReference || "—"}</p>
                  <p>Journal {settlement.journalEntryId || "—"} · Cash transaction {settlement.cashTransactionId || "—"} · {settlement.financialAccount?.accountName || "No cash account"}</p>
                  {settlement.notes && <p>{settlement.notes}</p>}
                  {(settlement.allocations || []).map((allocation) => (
                    <p key={allocation.id}>
                      {allocation.allocationType || "PAYMENT"} {allocation.document?.side} · {allocation.document?.documentNumber} · {allocation.document?.sourceType} · {amountText(allocation.amount)}
                    </p>
                  ))}
                </div>
              </details>
            )) : <p className="text-xs text-slate-500">No unified settlements have been posted.</p>}
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-800">Legacy refund offsets</h3>
            {(data.offsets || []).length ? data.offsets.map((offset) => (
              <div key={offset.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3">
                <div>
                  <p className="text-xs font-bold text-slate-900">Admin approved · {dateText(offset.approvedAt)}</p>
                  {offset.notes && <p className="mt-1 text-[10px] text-slate-500">{offset.notes}</p>}
                  <p className="mt-1 text-[10px] text-slate-500">Journal {offset.journalEntryId}</p>
                </div>
                <p className="text-xs font-black text-slate-900">{amountText(offset.amount)}</p>
              </div>
            )) : <p className="text-xs text-slate-500">No approved offsets.</p>}
          </div>
          <div className="space-y-2">
            {(data.remittances || []).map((batch) => (
              <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3">
                <div>
                  <p className="text-xs font-bold text-slate-900">{amountText(batch.amount)} · {batch.reference || "No reference"}</p>
                  <p className="mt-1 text-[10px] text-slate-500">{dateText(batch.receivedAt)} · {batch.status}</p>
                  {batch.evidenceUrl && <a className="mt-1 inline-block text-[10px] font-semibold text-blue-700 underline" href={batch.evidenceUrl} target="_blank" rel="noreferrer">View transfer evidence</a>}
                  {batch.reviewNotes && <p className="mt-1 text-[10px] text-rose-700">Admin note: {batch.reviewNotes}</p>}
                </div>
                {batch.status === "PENDING_REVIEW" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={accountByBatch[batch.id] || ""}
                      onChange={(event) => setAccountByBatch((current) => ({ ...current, [batch.id]: event.target.value }))}
                      className="max-w-48 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px]"
                    >
                      <option value="">Select treasury account</option>
                      {accounts.filter((account) =>
                        account.status === "ACTIVE" &&
                        account.currency === "NPR" &&
                        ["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
                      ).map((account) => <option key={account.id} value={account.id}>{account.accountName}</option>)}
                    </select>
                    <button type="button" disabled={busyBatchId === batch.id} onClick={() => review(batch, "VERIFY")} className="rounded-lg bg-emerald-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Verify</button>
                    <button type="button" disabled={busyBatchId === batch.id} onClick={() => review(batch, "REJECT")} className="rounded-lg bg-rose-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Reject</button>
                  </div>
                )}
              </div>
            ))}
            {!data.remittances?.length && <p className="py-4 text-center text-xs text-slate-500">No COD remittances submitted.</p>}
          </div>
        </>
      ) : <p className="py-5 text-center text-xs text-rose-600">COD remittance data is unavailable.</p>}
    </section>
  );
};

export const DistributorFinanceSection = ({ distributorId, token }) => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [historyType, setHistoryType] = useState("transactions");
  const [refreshKey, setRefreshKey] = useState(0);
  const [reloadSummary, setReloadSummary] = useState(0);
  const endpoint = `${backendUrl}/api/admin/distributors/${distributorId}/finance`;

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(endpoint, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load financial summary.");
      setSummary(response.data);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to load financial summary.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [endpoint, token]);

  useEffect(() => { loadSummary(); }, [loadSummary, reloadSummary]);

  const historyUrl = historyType === "transactions"
    ? `${backendUrl}/api/admin/distributors/${distributorId}/finance/transactions`
    : `${backendUrl}/api/admin/distributors/${distributorId}/finance/settlements`;

  return (
    <div className="space-y-4">
      {loading ? <p className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">Loading financial summary…</p> : summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Company receivable", summary.settlementPosition?.outstandingReceivable],
              ["Company payable", summary.settlementPosition?.outstandingPayable],
              [
                Number(summary.settlementPosition?.netBalance || 0) > 0 ? "Net due to company" : "Net due to distributor",
                Math.abs(Number(summary.settlementPosition?.netBalance || 0)),
              ],
              ["Pending COD remittance", summary.settlementPosition?.pendingRemittance],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-black text-slate-900">{amountText(value)}</p></div>)}
          </div>
          <p className="text-xs text-slate-500">These balances include all open NPR accounting documents. The detailed FIFO settlement documents and settlement history appear below.</p>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold text-slate-900">Earnings overview</h2><p className="mt-1 text-xs text-slate-500">Based on the distributor financial statement and current rate card.</p></div><button type="button" onClick={() => setReloadSummary((value) => value + 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Refresh</button></div>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <p><span className="text-slate-500">Delivery earnings</span><br /><b>{amountText(summary.summary?.grossDeliveryEarnings)}</b></p>
              <p><span className="text-slate-500">Return fees</span><br /><b>{amountText(summary.summary?.returnFeesEarned)}</b></p>
              <p><span className="text-slate-500">Incentives</span><br /><b>{amountText(summary.summary?.earnedIncentives)}</b></p>
              <p><span className="text-slate-500">Commission / discounts</span><br /><b>{amountText(summary.summary?.adminDiscountsApplied)}</b></p>
            </div>
          </div>
        </>
      ) : <p className="rounded-xl border border-rose-200 bg-white px-5 py-10 text-center text-sm text-rose-600">Financial summary is unavailable.</p>}

      <DistributorCodRemittances distributorId={distributorId} token={token} />

      <div className="flex gap-2">
        {[["transactions", "Financial transactions"], ["settlements", "Settlement requests"]].map(([value, label]) => (
          <button key={value} type="button" onClick={() => { setHistoryType(value); setRefreshKey((current) => current + 1); }} className={`rounded-lg px-4 py-2 text-xs font-bold ${historyType === value ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`}>{label}</button>
        ))}
      </div>
      <RecordList
        key={`${historyType}-${refreshKey}`}
        endpoint={historyUrl}
        responseKey={historyType}
        token={token}
        renderRecord={historyType === "transactions"
          ? (record) => <div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold text-slate-900">{record.description || record.type}</p><p className="mt-1 text-xs text-slate-500">{record.type} · Ref {record.referenceId || "—"} · {dateText(record.date)}</p><p className="mt-1 text-xs text-slate-500">{record.paymentMethod || record.status || ""}</p></div><p className={`font-bold ${Number(record.netAmount) < 0 ? "text-rose-700" : "text-slate-900"}`}>{amountText(record.netAmount)}</p></div>
          : (record) => <div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold text-slate-900">Settlement request {record.id}</p><p className="mt-1 text-xs text-slate-500">Requested {dateText(record.requestedAt)}{record.settledAt ? ` · Settled ${dateText(record.settledAt)}` : ""}</p><p className="mt-1 text-xs text-slate-500">{record.notes || record.adminNotes || "No notes"}</p>{record.externalPaymentReference && <p className="mt-1 text-xs text-slate-500">Transfer ref: {record.externalPaymentReference}</p>}</div><div className="text-right"><p className="font-bold text-slate-900">{amountText(record.amount)}</p><p className="text-xs font-bold uppercase text-slate-500">{record.status}</p></div></div>}
        emptyMessage={historyType === "transactions" ? "No financial transactions are recorded." : "No settlement requests are recorded."}
      />
    </div>
  );
};
