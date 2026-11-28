import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { backendUrl, useManufacturer } from "../context/ManufacturerContext";

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : "Not recorded";
};

const severityStyles = {
  HIGH: "border-rose-200 bg-rose-50 text-rose-800",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-900",
  LOW: "border-sky-200 bg-sky-50 text-sky-800",
  INFO: "border-slate-200 bg-slate-50 text-slate-700",
};

const runStatusStyles = {
  SUCCESS: "text-emerald-700",
  PARTIAL: "text-amber-800",
  FAILED: "text-rose-700",
};

const ReconciliationFinding = ({ finding, busy, onAcknowledge }) => {
  const references = Object.entries(finding.recordRefs || {})
    .filter(([, value]) => (Array.isArray(value) ? value.length : value))
    .map(([label, value]) => `${label}: ${Array.isArray(value) ? value.join(", ") : value}`);

  return (
    <article className="rounded-2xl border border-[#dedbd3] bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${severityStyles[finding.severity] || severityStyles.INFO}`}>
          {finding.severity}
        </span>
        <span className="text-xs font-semibold text-[#575757]">{finding.category.replaceAll("_", " ")}</span>
        <span className={`ml-auto rounded-full px-2.5 py-1 text-[10px] font-bold ${
          finding.state === "OPEN" ? "bg-slate-100 text-slate-700" :
            finding.state === "ACKNOWLEDGED" ? "bg-emerald-50 text-emerald-800" :
              "bg-sky-50 text-sky-800"
        }`}>
          {finding.state.replaceAll("_", " ")}
        </span>
      </div>
      <p className="mt-3 text-sm font-medium leading-6 text-[#171717]">{finding.explanation}</p>
      <p className="mt-2 text-xs leading-5 text-[#575757]">
        Recommended next step: {finding.nextAction}
      </p>
      {(finding.expected !== null || finding.observed !== null) && (
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-[#575757]">
          {finding.expected !== null && <span>Expected: <strong className="text-[#171717]">{finding.expected}</strong></span>}
          {finding.observed !== null && <span>Observed: <strong className="text-[#171717]">{finding.observed}</strong></span>}
        </div>
      )}
      {references.length > 0 && (
        <ul className="mt-3 space-y-1 break-all rounded-xl bg-[#f8f7f4] p-3 font-mono text-[10px] text-[#575757]">
          {references.map((reference) => <li key={reference}>{reference}</li>)}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11px] text-[#777]">
          Detected {formatDate(finding.detectedAt)} · age {Math.floor((finding.ageMs || 0) / 86400000)}d
          {finding.sourceStatus ? ` · source ${finding.sourceStatus}` : ""}
        </span>
        {finding.state === "OPEN" && (
          <button
            type="button"
            onClick={() => onAcknowledge(finding)}
            disabled={busy}
            className="rounded-lg border border-[#b8b4ab] px-3 py-2 text-xs font-semibold text-[#171717] transition hover:bg-[#f8f7f4] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Saving..." : "Acknowledge"}
          </button>
        )}
        {["RESOLVED", "NO_LONGER_PRESENT"].includes(finding.state) && (
          <span className="text-[11px] text-[#777]">Closed {formatDate(finding.resolvedAt)}</span>
        )}
      </div>
      <Link to={finding.workflowPath} className="mt-3 inline-flex text-xs font-semibold text-emerald-800 underline underline-offset-2">
        Open related workflow
      </Link>
    </article>
  );
};

const DistributorOperations = () => {
  const { token } = useManufacturer();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState(null);
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [lifecycleState, setLifecycleState] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [cursor, setCursor] = useState(null);
  const [cursorHistory, setCursorHistory] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const loadDashboard = async () => {
      setLoading(true);
      try {
        const response = await axios.get(`${backendUrl}/api/distributor/operations/reconciliation`, {
          headers: { token },
          params: {
            category: category || undefined,
            severity: severity || undefined,
            state: lifecycleState || undefined,
            from: fromDate || undefined,
            to: toDate || undefined,
            limit: 25,
            cursor: cursor || undefined,
          },
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setReport(response.data);
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(error.response?.data?.message || "Could not load distributor reconciliation.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    loadDashboard();
    return () => controller.abort();
  }, [token, category, severity, lifecycleState, fromDate, toDate, cursor, reloadKey]);

  const resetPagination = () => {
    setCursor(null);
    setCursorHistory([]);
  };

  const runReconciliation = async () => {
    setRunning(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/distributor/operations/reconciliation/runs`,
        {},
        { headers: { token } },
      );
      const status = response.data.run?.status;
      setReloadKey((value) => value + 1);
      if (status === "SUCCESS") toast.success("Reconciliation completed.");
      else if (status === "PARTIAL") toast.info("Reconciliation completed with incomplete sources.");
      else toast.error("Reconciliation could not read its required sources.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not run reconciliation.");
    } finally {
      setRunning(false);
    }
  };

  const acknowledgeFinding = async (finding) => {
    setAcknowledgingId(finding.id);
    try {
      const response = await axios.post(
        `${backendUrl}/api/distributor/operations/reconciliation/findings/${finding.id}/acknowledge`,
        {},
        { headers: { token } },
      );
      setReloadKey((value) => value + 1);
      toast.success(response.data.alreadyAcknowledged
        ? "This finding was already acknowledged."
        : "Finding acknowledged. Source records were not changed.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not acknowledge this finding.");
    } finally {
      setAcknowledgingId(null);
    }
  };

  const findings = useMemo(() => report?.findings || [], [report]);
  const runCounts = report?.run?.findingCounts || report?.latestRun?.findingCounts;

  const sourceStatus = report?.sourceStatus || report?.latestRun?.sourceStatus || {};
  const sourceLabels = {
    stockTransfers: "Stock-transfer receipt, custody, and ledger evidence",
    inventoryDiscrepancies: "Inventory discrepancy records",
    deliveryProof: "Delivered manifest stops and POD records",
    offlineSync: "Pending and conflicted offline drafts",
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-emerald-700">
            <ClipboardList className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-[0.16em]">Distributor operations</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#171717]">Reconciliation &amp; exceptions</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#575757]">
            Review record-backed stock, delivery-proof, and offline-sync findings. This report is read-only;
            acknowledging a finding records an audit event and does not change inventory, accounting, or delivery records.
          </p>
        </div>
        <button
          type="button"
          onClick={runReconciliation}
          disabled={running || loading}
          className="inline-flex items-center gap-2 rounded-xl bg-[#171717] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
          {running ? "Running..." : "Run reconciliation"}
        </button>
      </header>

      {(report?.run || report?.latestRun) && (
        <div className="rounded-xl border border-[#dedbd3] bg-white px-4 py-3 text-sm">
          <strong className={runStatusStyles[(report.run || report.latestRun).status] || "text-[#171717]"}>
            Latest run: {(report.run || report.latestRun).status}
          </strong>
          <span className="ml-2 text-[#575757]">{formatDate((report.run || report.latestRun).completedAt)}</span>
          {(report.run || report.latestRun).status !== "SUCCESS" && (
            <p className="mt-1 text-xs text-[#575757]">
              {(report.run || report.latestRun).status === "FAILED"
                ? "The run could not complete its source reads; it did not resolve findings."
                : "Some sources were unavailable or capped. Do not treat this partial result as complete."}
            </p>
          )}
        </div>
      )}
      {report?.latestFailedRun && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Latest failed run: {formatDate(report.latestFailedRun.completedAt)}. Its incomplete read did not resolve any findings.
        </div>
      )}
      {report?.recentRuns?.length > 0 && (
        <section className="rounded-2xl border border-[#dedbd3] bg-white p-4">
          <h2 className="text-sm font-bold text-[#171717]">Recent reconciliation runs</h2>
          <ul className="mt-3 divide-y divide-[#eeeae2]">
            {report.recentRuns.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <span>
                  <strong className={runStatusStyles[run.status] || "text-[#171717]"}>{run.status}</strong>
                  <span className="ml-2 text-[#575757]">{formatDate(run.completedAt)}</span>
                </span>
                <span className="text-[#777]">
                  {run.findingCounts
                    ? `${run.findingCounts.created} created · ${run.findingCounts.retained} retained · ${run.findingCounts.resolved} resolved`
                    : "Run details not yet available"}
                  {run.incompleteSources?.length ? ` · incomplete: ${run.incompleteSources.join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Reconciliation summary">
        {[
          ["Retained findings", report?.summary?.total ?? 0, ClipboardList],
          ["Open", report?.summary?.open ?? 0, AlertTriangle],
          ["Acknowledged", report?.summary?.acknowledged ?? 0, ShieldCheck],
          ["Resolved / no longer present", (report?.summary?.resolved ?? 0) + (report?.summary?.noLongerPresent ?? 0), CheckCircle2],
          ["Last successful run", formatDate(report?.lastSuccessfulRun), Clock3],
        ].map(([label, value, Icon]) => (
          <div key={label} className="rounded-2xl border border-[#dedbd3] bg-white p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-[#575757]">
              {label}<Icon className="h-4 w-4 text-emerald-700" />
            </div>
            <p className="mt-3 text-lg font-bold text-[#171717]">{value}</p>
          </div>
        ))}
      </section>
      {runCounts && (
        <p className="text-xs text-[#575757]">
          {runCounts.created} created · {runCounts.retained} retained · {runCounts.resolved} resolved · {runCounts.open} still open
        </p>
      )}

      <section className="rounded-2xl border border-[#dedbd3] bg-white p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-[#171717]">
          <ShieldCheck className="h-4 w-4 text-emerald-700" /> Source coverage
        </h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {Object.entries(sourceLabels).map(([key, label]) => {
            const status = sourceStatus[key] || "NOT_RUN";
            return (
              <div key={key} className="flex items-center justify-between gap-3 rounded-xl bg-[#f8f7f4] px-3 py-2 text-xs">
                <span className="text-[#575757]">{label}</span>
                <strong className={status === "COMPLETE" ? "text-emerald-700" : "text-amber-800"}>{status}</strong>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-[#777]">
          This phase does not infer inventory-vs-ledger totals, wholesale receivables, COD settlement, or general-ledger
          mismatches. Those require separate authoritative source-link checks. Each listed source is bounded; capped or
          unavailable sources are labeled incomplete instead of being treated as clean.
        </p>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[#171717]">Current findings</h2>
        </div>
        <div className="mb-4 grid gap-2 rounded-2xl border border-[#dedbd3] bg-white p-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-semibold text-[#575757]">
            Category
            <select
              value={category}
              onChange={(event) => { setCategory(event.target.value); resetPagination(); }}
              className="mt-1 w-full rounded-lg border border-[#dedbd3] bg-white px-3 py-2 text-xs text-[#171717]"
            >
              <option value="">All categories</option>
              <option value="STOCK_TRANSFER">Stock transfer</option>
              <option value="INVENTORY_DISCREPANCY">Inventory discrepancy</option>
              <option value="DELIVERY_WITHOUT_POD">Delivered without POD</option>
              <option value="OFFLINE_SYNC_DRAFT">Offline sync draft</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-[#575757]">
            Severity
            <select
              value={severity}
              onChange={(event) => { setSeverity(event.target.value); resetPagination(); }}
              className="mt-1 w-full rounded-lg border border-[#dedbd3] bg-white px-3 py-2 text-xs text-[#171717]"
            >
              <option value="">All severities</option>
              {["HIGH", "MEDIUM", "LOW", "INFO"].map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#575757]">
            Lifecycle
            <select
              value={lifecycleState}
              onChange={(event) => { setLifecycleState(event.target.value); resetPagination(); }}
              className="mt-1 w-full rounded-lg border border-[#dedbd3] bg-white px-3 py-2 text-xs text-[#171717]"
            >
              <option value="">All states</option>
              {["OPEN", "ACKNOWLEDGED", "RESOLVED", "NO_LONGER_PRESENT"].map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#575757]">
            Detected from
            <input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); resetPagination(); }} className="mt-1 w-full rounded-lg border border-[#dedbd3] px-3 py-2 text-xs text-[#171717]" />
          </label>
          <label className="text-xs font-semibold text-[#575757]">
            Detected to
            <input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); resetPagination(); }} className="mt-1 w-full rounded-lg border border-[#dedbd3] px-3 py-2 text-xs text-[#171717]" />
          </label>
        </div>
        {loading ? (
          <div className="rounded-2xl border border-[#dedbd3] bg-white p-8 text-center text-sm text-[#575757]" role="status">
            Loading current reconciliation evidence...
          </div>
        ) : findings.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {findings.map((finding) => (
              <ReconciliationFinding
                key={finding.id}
                finding={finding}
                busy={acknowledgingId === finding.id}
                onAcknowledge={acknowledgeFinding}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-[#dedbd3] bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-700" />
            <p className="mt-3 text-sm font-semibold text-[#171717]">No findings in this view</p>
            <p className="mt-1 text-xs text-[#575757]">This is limited to the currently supported, locally recorded checks.</p>
          </div>
        )}
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            disabled={!cursorHistory.length || loading}
            onClick={() => {
              const nextHistory = [...cursorHistory];
              const previous = nextHistory.pop() || null;
              setCursorHistory(nextHistory);
              setCursor(previous);
            }}
            className="rounded-lg border border-[#dedbd3] px-3 py-2 text-xs font-semibold disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-[#777]">
            Showing {findings.length} of {report?.pagination?.total ?? 0}
          </span>
          <button
            type="button"
            disabled={!report?.pagination?.hasMore || loading}
            onClick={() => {
              setCursorHistory((items) => [...items, cursor]);
              setCursor(report.pagination.nextCursor);
            }}
            className="rounded-lg border border-[#dedbd3] px-3 py-2 text-xs font-semibold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-[#dedbd3] bg-white p-4">
        <h2 className="text-sm font-bold text-[#171717]">Recent reconciliation runs</h2>
        {report?.runHistoryAvailable === false ? (
          <p className="mt-3 text-xs text-amber-800">Run history is currently unavailable.</p>
        ) : (report?.recentRuns || []).length ? (
          <ul className="mt-3 divide-y divide-[#eee]">
            {report.recentRuns.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <span className={`font-bold ${runStatusStyles[run.status] || "text-[#171717]"}`}>{run.status}</span>
                <span className="text-[#575757]">{run.findingCount ?? "—"} findings</span>
                <span className="text-[#777]">{formatDate(run.completedAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-[#777]">No recorded runs yet.</p>
        )}
      </section>
    </div>
  );
};

export default DistributorOperations;
