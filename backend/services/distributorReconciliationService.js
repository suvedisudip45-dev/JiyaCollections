import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { recordSystemAudit } from "./auditService.js";
import { loadStockTransferReconciliationSources } from "./stockTransferReconciliationDataService.js";
import { reconcileStockTransfers } from "./stockTransferReconciliationService.js";

const MAX_SOURCE_FINDINGS = 50;
const MAX_TOTAL_FINDINGS = 200;
const MAX_RECENT_RUNS = 20;
const STALE_PENDING_DRAFT_MS = 24 * 60 * 60 * 1000;
const MAX_PAGE_SIZE = 50;
const MAX_DATE_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const TRANSACTION_MAX_WAIT_MS = 5000;
const TRANSACTION_TIMEOUT_MS = 30000;
const ACTIVE_RUNS = new Set();
const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
const DATA_SOURCE_NAMES = ["stockTransfers", "inventoryDiscrepancies", "deliveryProof", "offlineSync"];

const fail = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code });
const stableHash = (value) => createHash("sha256").update(value).digest("hex");
const acknowledgementEventId = (distributorId, findingId) => `ack-${stableHash(`${distributorId}:${findingId}`).slice(0, 32)}`;
const sourceCategory = {
  STOCK_TRANSFER: "stockTransfers",
  INVENTORY_DISCREPANCY: "inventoryDiscrepancies",
  DELIVERY_WITHOUT_POD: "deliveryProof",
  OFFLINE_SYNC_DRAFT: "offlineSync",
};
const workflowFor = (category, refs) => {
  if (category === "STOCK_TRANSFER") return "/distributor/demand";
  if (category === "INVENTORY_DISCREPANCY") {
    return refs.stockTransferId || refs.shipmentId ? "/distributor/demand" : "/distributor/peer-transfers";
  }
  return "/distributor/logistics";
};

const buildFinding = ({
  distributorId,
  category,
  sourceId,
  severity,
  recordRefs,
  expected = null,
  observed = null,
  detectedAt,
  explanation,
  nextAction,
  sourceStatus = null,
  lifecycleState = "OPEN",
}) => {
  const identity = Object.entries(recordRefs)
    .filter(([, value]) => typeof value === "string" && value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
  const findingKey = stableHash(`${distributorId}:${category}:${sourceId || identity}`);
  return {
    findingKey,
    distributorId,
    category,
    severity,
    sourceStatus,
    lifecycleState,
    recordRefs,
    expected,
    observed,
    detectedAt: detectedAt.toISOString(),
    explanation,
    nextAction,
    workflowPath: workflowFor(category, recordRefs),
    automatedResolutionPermitted: false,
    acknowledged: lifecycleState === "ACKNOWLEDGED",
  };
};

const readBounded = async (sourceName, query, statuses) => {
  try {
    const result = await query();
    const rows = result.slice(0, MAX_SOURCE_FINDINGS);
    statuses[sourceName] = result.length > MAX_SOURCE_FINDINGS ? "TRUNCATED" : "COMPLETE";
    return rows;
  } catch {
    statuses[sourceName] = "UNAVAILABLE";
    return [];
  }
};

const withDistributorLock = (client, distributorId, operation) => client.$transaction(async (tx) => {
  const lockedRows = await tx.$queryRaw`
    SELECT id FROM Distributor WHERE id = ${distributorId} FOR UPDATE
  `;
  if (!Array.isArray(lockedRows) || lockedRows.length !== 1) {
    throw fail("The active distributor workspace could not be verified.", 404, "DISTRIBUTOR_NOT_FOUND");
  }
  return operation(tx);
}, {
  isolationLevel: "Serializable",
  maxWait: TRANSACTION_MAX_WAIT_MS,
  timeout: TRANSACTION_TIMEOUT_MS,
});

const collectFindings = async ({ client, distributorId, now }) => {
  const sourceStatus = {
    stockTransfers: "UNAVAILABLE",
    inventoryDiscrepancies: "UNAVAILABLE",
    deliveryProof: "UNAVAILABLE",
    offlineSync: "UNAVAILABLE",
  };
  const findings = [];
  let stockTransferSnapshot = null;
  try {
    stockTransferSnapshot = await loadStockTransferReconciliationSources({
      filters: { distributorId },
      limit: 25,
      client,
    });
    const report = reconcileStockTransfers(stockTransferSnapshot);
    sourceStatus.stockTransfers = report.reportStatus === "DATA_UNAVAILABLE"
      ? "UNAVAILABLE"
      : report.reportStatus === "RECONCILIATION_INCOMPLETE" ||
          stockTransferSnapshot.page?.hasMore
        ? "INCOMPLETE"
        : "COMPLETE";

    for (const exception of report.exceptions) {
      if (["INSUFFICIENT_EVIDENCE", "UNRESOLVED_IN_TRANSIT", "PARTIAL_RECEIPT"].includes(exception.code)) continue;
      const recordRefs = {
        stockTransferId: exception.transferId || null,
        shipmentId: exception.shipmentId || null,
        receiptId: exception.receiptId || null,
        discrepancyIds: exception.discrepancyIds || [],
        ledgerEntryIds: exception.ledgerEntryIds || [],
      };
      findings.push(buildFinding({
        distributorId,
        category: "STOCK_TRANSFER",
        sourceId: exception.exceptionKey,
        severity: exception.severity || "MEDIUM",
        recordRefs,
        expected: exception.expectedQuantity,
        observed: exception.actualQuantity,
        detectedAt: now,
        explanation: exception.explanation,
        nextAction: "Inspect the transfer receipt, custody evidence, and ledger through the existing stock-transfer review workflow.",
        sourceStatus: exception.code,
      }));
    }
  } catch {
    sourceStatus.stockTransfers = "UNAVAILABLE";
  }

  const inventoryDiscrepancies = await readBounded(
    "inventoryDiscrepancies",
    () => client.inventoryDiscrepancy.findMany({
      where: { distributorId, status: { in: ["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"] } },
      select: {
        id: true,
        stockTransferId: true,
        shipmentId: true,
        receiptId: true,
        discrepancyType: true,
        quantity: true,
        status: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MAX_SOURCE_FINDINGS + 1,
    }),
    sourceStatus,
  );
  const transferDiscrepancyIds = new Set(
    findings.flatMap((finding) => finding.recordRefs.discrepancyIds || []),
  );
  for (const discrepancy of inventoryDiscrepancies) {
    if (transferDiscrepancyIds.has(discrepancy.id)) continue;
    findings.push(buildFinding({
      distributorId,
      category: "INVENTORY_DISCREPANCY",
      sourceId: discrepancy.id,
      severity: ["RESOLVED", "REJECTED"].includes(discrepancy.status)
        ? "INFO"
        : discrepancy.status === "OPEN" ? "HIGH" : "MEDIUM",
      recordRefs: {
        discrepancyId: discrepancy.id,
        stockTransferId: discrepancy.stockTransferId,
        shipmentId: discrepancy.shipmentId,
        receiptId: discrepancy.receiptId,
      },
      observed: discrepancy.quantity,
      detectedAt: now,
      sourceStatus: discrepancy.status,
      lifecycleState: ["RESOLVED", "REJECTED"].includes(discrepancy.status) ? "RESOLVED" : "OPEN",
      explanation: `The inventory discrepancy record reports ${discrepancy.discrepancyType} with status ${discrepancy.status.toLowerCase()}.`,
      nextAction: "Review the existing inventory discrepancy and custody records; do not adjust stock from this report.",
    }));
  }

  const missingProofStops = await readBounded(
    "deliveryProof",
    () => client.deliveryManifestStop.findMany({
      where: {
        status: "DELIVERED",
        proof: { is: null },
        manifest: { distributorId },
      },
      select: { id: true, manifestId: true, orderId: true, completedAt: true },
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
      take: MAX_SOURCE_FINDINGS + 1,
    }),
    sourceStatus,
  );
  for (const stop of missingProofStops) {
    findings.push(buildFinding({
      distributorId,
      category: "DELIVERY_WITHOUT_POD",
      sourceId: stop.id,
      severity: "HIGH",
      recordRefs: { manifestId: stop.manifestId, stopId: stop.id, orderId: stop.orderId },
      detectedAt: now,
      sourceStatus: "DELIVERED_WITHOUT_POD",
      explanation: "The manifest stop is marked delivered, but its authoritative proof-of-delivery record is missing.",
      nextAction: "Verify the stop and inspect the existing manifest/POD reconciliation process.",
    }));
  }

  const staleBefore = new Date(now.getTime() - STALE_PENDING_DRAFT_MS);
  const offlineDrafts = await readBounded(
    "offlineSync",
    () => client.offlineDeliverySyncDraft.findMany({
      where: {
        manifest: { distributorId },
        OR: [
          { status: "CONFLICT" },
          { status: "PENDING", createdAt: { lte: staleBefore } },
        ],
      },
      select: { id: true, manifestId: true, stopId: true, status: true, createdAt: true, updatedAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MAX_SOURCE_FINDINGS + 1,
    }),
    sourceStatus,
  );
  for (const draft of offlineDrafts) {
    findings.push(buildFinding({
      distributorId,
      category: "OFFLINE_SYNC_DRAFT",
      sourceId: draft.id,
      severity: draft.status === "CONFLICT" ? "HIGH" : "MEDIUM",
      recordRefs: { manifestId: draft.manifestId, stopId: draft.stopId, draftId: draft.id },
      detectedAt: now,
      sourceStatus: draft.status,
      explanation: draft.status === "CONFLICT"
        ? "An offline delivery draft is in conflict and has not been reconciled."
        : "An offline delivery draft has remained pending for at least 24 hours.",
      nextAction: "Compare the server stop and proof state, then use the existing offline reconciliation workflow.",
    }));
  }

  findings.sort((left, right) =>
    (SEVERITY_ORDER[left.severity] ?? 9) - (SEVERITY_ORDER[right.severity] ?? 9) ||
    left.category.localeCompare(right.category) ||
    left.findingKey.localeCompare(right.findingKey)
  );
  if (findings.length > MAX_TOTAL_FINDINGS) {
    const omittedCategories = new Set(findings.slice(MAX_TOTAL_FINDINGS).map((finding) => finding.category));
    findings.length = MAX_TOTAL_FINDINGS;
    if (omittedCategories.has("STOCK_TRANSFER")) sourceStatus.stockTransfers = "TRUNCATED";
    if (omittedCategories.has("INVENTORY_DISCREPANCY")) sourceStatus.inventoryDiscrepancies = "TRUNCATED";
    if (omittedCategories.has("DELIVERY_WITHOUT_POD")) sourceStatus.deliveryProof = "TRUNCATED";
    if (omittedCategories.has("OFFLINE_SYNC_DRAFT")) sourceStatus.offlineSync = "TRUNCATED";
  }

  const severityCounts = findings.reduce((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] || 0) + 1;
    return counts;
  }, {});
  const categoryCounts = findings.reduce((counts, finding) => {
    counts[finding.category] = (counts[finding.category] || 0) + 1;
    return counts;
  }, {});
  const incompleteSources = Object.entries(sourceStatus)
    .filter(([, status]) => status !== "COMPLETE")
    .map(([name]) => name);

  return {
    findings,
    sourceStatus,
    incompleteSources,
    summary: {
      total: findings.length,
      unresolved: findings.filter((finding) => finding.lifecycleState === "OPEN").length,
      acknowledged: 0,
      bySeverity: severityCounts,
      byCategory: categoryCounts,
    },
    stockTransferSnapshot: stockTransferSnapshot
      ? { coverage: stockTransferSnapshot.coverage, hasMore: stockTransferSnapshot.page?.hasMore === true }
      : null,
  };
};

const listRecentRuns = async (client, distributorId) => {
  const records = await client.systemAuditLog.findMany({
    where: { entityType: "DistributorReconciliationRun", entityId: distributorId },
    select: { id: true, status: true, afterState: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_RECENT_RUNS,
  });
  return records.map((record) => ({
    id: record.id,
    status: record.afterState?.runStatus || record.status,
    findingCount: record.afterState?.findingCounts?.open ?? null,
    findingCounts: record.afterState?.findingCounts || null,
    sourceStatus: record.afterState?.sourceStatus || null,
    completedAt: record.afterState?.completedAt || record.createdAt.toISOString(),
    incompleteSources: Array.isArray(record.afterState?.incompleteSources)
      ? record.afterState.incompleteSources
      : [],
  }));
};

const recordRunEvent = (actorContext, distributorId, report, runStatus, client) => recordSystemAudit(
  actorContext,
  {
    action: "DISTRIBUTOR_RECONCILIATION_RUN",
    entityType: "DistributorReconciliationRun",
    entityId: distributorId,
    status: runStatus === "FAILED" ? "FAILED" : "SUCCESS",
    afterState: {
      runStatus,
      findingCounts: report?.run?.findingCounts || null,
      sourceStatus: report?.run?.sourceStatus || null,
      incompleteSources: report?.incompleteSources || [],
      completedAt: new Date().toISOString(),
    },
  },
  { client },
);

const normalizeFilters = ({ category, severity, state, from, to, limit, cursor } = {}, now = new Date()) => {
  const allowedCategories = new Set([
    "STOCK_TRANSFER",
    "INVENTORY_DISCREPANCY",
    "DELIVERY_WITHOUT_POD",
    "OFFLINE_SYNC_DRAFT",
  ]);
  const allowedSeverities = new Set(["HIGH", "MEDIUM", "LOW", "INFO"]);
  const allowedStates = new Set(["OPEN", "ACKNOWLEDGED", "RESOLVED", "NO_LONGER_PRESENT"]);
  const normalizedCategory = category ? String(category).trim().toUpperCase() : null;
  const normalizedSeverity = severity ? String(severity).trim().toUpperCase() : null;
  const normalizedState = state ? String(state).trim().toUpperCase() : null;
  if (normalizedCategory && !allowedCategories.has(normalizedCategory)) {
    throw fail("The reconciliation category filter is invalid.", 400, "INVALID_RECONCILIATION_FILTER");
  }
  if (normalizedSeverity && !allowedSeverities.has(normalizedSeverity)) {
    throw fail("The reconciliation severity filter is invalid.", 400, "INVALID_RECONCILIATION_FILTER");
  }
  if (normalizedState && !allowedStates.has(normalizedState)) {
    throw fail("The reconciliation lifecycle filter is invalid.", 400, "INVALID_RECONCILIATION_FILTER");
  }
  const parseDate = (value, label) => {
    if (value === undefined || value === null || value === "") return null;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      throw fail(`${label} must be a valid date.`, 400, "INVALID_RECONCILIATION_DATE");
    }
    if (label === "The end date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      parsed.setUTCHours(23, 59, 59, 999);
    }
    return parsed;
  };
  const fromDate = parseDate(from, "The start date");
  const toDate = parseDate(to, "The end date");
  if (fromDate && toDate && fromDate > toDate) {
    throw fail("The start date must be before the end date.", 400, "INVALID_RECONCILIATION_DATE_RANGE");
  }
  if (fromDate && toDate && toDate.getTime() - fromDate.getTime() > MAX_DATE_RANGE_MS) {
    throw fail("Reconciliation date filters cannot span more than one year.", 400, "RECONCILIATION_DATE_RANGE_TOO_LARGE");
  }
  if (fromDate && fromDate > now) {
    throw fail("The start date cannot be in the future.", 400, "INVALID_RECONCILIATION_DATE");
  }
  const requestedLimit = Number(limit);
  const pageSize = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_PAGE_SIZE)
    : 25;
  const pageCursor = cursor ? String(cursor) : null;
  if (pageCursor && (pageCursor.length > 191 || !/^[a-zA-Z0-9_-]+$/.test(pageCursor))) {
    throw fail("The reconciliation page cursor is invalid.", 400, "INVALID_RECONCILIATION_CURSOR");
  }
  return {
    category: normalizedCategory,
    severity: normalizedSeverity,
    state: normalizedState,
    fromDate,
    toDate,
    pageSize,
    pageCursor,
  };
};

const findingWhere = (distributorId, filters) => ({
  distributorId,
  ...(filters.category ? { category: filters.category } : {}),
  ...(filters.severity ? { severity: filters.severity } : {}),
  ...(filters.state ? { state: filters.state } : {}),
  ...(filters.fromDate || filters.toDate
    ? { detectedAt: {
        ...(filters.fromDate ? { gte: filters.fromDate } : {}),
        ...(filters.toDate ? { lte: filters.toDate } : {}),
      } }
    : {}),
});

const serializeFinding = (finding, now) => ({
  id: finding.id,
  distributorId: finding.distributorId,
  findingKey: finding.findingKey,
  occurrence: finding.occurrence,
  category: finding.category,
  severity: finding.severity,
  state: finding.state,
  sourceStatus: finding.sourceStatus,
  recordRefs: finding.recordRefs,
  expected: finding.expected,
  observed: finding.observed,
  explanation: finding.explanation,
  nextAction: finding.nextAction,
  workflowPath: finding.workflowPath,
  detectedAt: finding.detectedAt.toISOString(),
  lastSeenAt: finding.lastSeenAt.toISOString(),
  acknowledgedAt: finding.acknowledgedAt?.toISOString() || null,
  acknowledgedBy: finding.acknowledgedBy,
  resolvedAt: finding.resolvedAt?.toISOString() || null,
  ageMs: Math.max(0, now.getTime() - finding.detectedAt.getTime()),
  automatedResolutionPermitted: false,
});

const dashboardSummary = async (client, distributorId, now) => {
  const [stateCounts, unresolvedCount, totalCount, recentRuns] = await Promise.all([
    client.distributorReconciliationFinding.groupBy({
      by: ["state"],
      where: { distributorId },
      _count: { _all: true },
    }),
    client.distributorReconciliationFinding.count({
      where: { distributorId, state: { in: ["OPEN", "ACKNOWLEDGED"] } },
    }),
    client.distributorReconciliationFinding.count({ where: { distributorId } }),
    listRecentRuns(client, distributorId),
  ]);
  const byState = Object.fromEntries(stateCounts.map(({ state, _count }) => [state, _count._all]));
  return {
    summary: {
      total: totalCount,
      open: byState.OPEN || 0,
      acknowledged: byState.ACKNOWLEDGED || 0,
      resolved: byState.RESOLVED || 0,
      noLongerPresent: byState.NO_LONGER_PRESENT || 0,
      unresolved: unresolvedCount,
    },
    recentRuns,
    lastSuccessfulRun: recentRuns.find((run) => run.status === "SUCCESS")?.completedAt || null,
    latestFailedRun: recentRuns.find((run) => run.status === "FAILED") || null,
    latestRun: recentRuns[0] || null,
    serverTime: now.toISOString(),
  };
};

export const getDistributorReconciliationDashboard = async ({
  distributorId,
  filters = {},
  client = prisma,
  now = new Date(),
} = {}) => {
  if (typeof distributorId !== "string" || !distributorId.trim()) {
    throw fail("A valid distributor workspace is required.", 400, "INVALID_DISTRIBUTOR");
  }
  const normalized = normalizeFilters(filters, now);
  const where = findingWhere(distributorId, normalized);
  if (normalized.pageCursor) {
    const cursorRecord = await client.distributorReconciliationFinding.findFirst({
      where: { id: normalized.pageCursor, ...where },
      select: { id: true },
    });
    if (!cursorRecord) {
      throw fail("The reconciliation page cursor was not found in this distributor workspace.", 404, "RECONCILIATION_CURSOR_NOT_FOUND");
    }
  }
  const [records, total, summary] = await Promise.all([
    client.distributorReconciliationFinding.findMany({
      where,
      ...(normalized.pageCursor ? { cursor: { id: normalized.pageCursor }, skip: 1 } : {}),
      orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
      take: normalized.pageSize + 1,
    }),
    client.distributorReconciliationFinding.count({ where }),
    dashboardSummary(client, distributorId, now),
  ]);
  const hasMore = records.length > normalized.pageSize;
  const page = records.slice(0, normalized.pageSize);
  return {
    success: true,
    findings: page.map((finding) => serializeFinding(finding, now)),
    summary: summary.summary,
    recentRuns: summary.recentRuns,
    lastSuccessfulRun: summary.lastSuccessfulRun,
    latestFailedRun: summary.latestFailedRun,
    latestRun: summary.latestRun,
    pagination: {
      limit: normalized.pageSize,
      total,
      hasMore,
      nextCursor: hasMore ? page.at(-1)?.id || null : null,
    },
    filters: {
      category: normalized.category,
      severity: normalized.severity,
      state: normalized.state,
      from: normalized.fromDate?.toISOString() || null,
      to: normalized.toDate?.toISOString() || null,
    },
    serverTime: summary.serverTime,
  };
};

const auditFindingTransition = async ({
  client,
  actorContext,
  finding,
  beforeState,
  state,
  now,
}) => recordSystemAudit(actorContext, {
  action: `DISTRIBUTOR_RECONCILIATION_${state}`,
  entityType: "DistributorReconciliationFinding",
  entityId: finding.id,
  beforeState: { state: beforeState },
  afterState: {
    findingId: finding.id,
    findingKey: finding.findingKey,
    occurrence: finding.occurrence,
    category: finding.category,
    severity: finding.severity,
    state,
    sourceStatus: finding.sourceStatus,
    recordRefs: finding.recordRefs,
    explanation: finding.explanation,
    detectedAt: finding.detectedAt,
    acknowledgedAt: finding.acknowledgedAt,
    resolvedAt: finding.resolvedAt,
    changedAt: now,
  },
}, { client });

const upsertFindings = async ({
  client,
  distributorId,
  findings,
  sourceStatus,
  runStatus,
  actorContext,
  now,
}) => {
  const activeKeys = new Map();
  const counts = { created: 0, retained: 0, resolved: 0, open: 0 };
  for (const candidate of findings) {
    const source = sourceCategory[candidate.category];
    if (sourceStatus[source] === "UNAVAILABLE") continue;
    const latest = await client.distributorReconciliationFinding.findFirst({
      where: { distributorId, findingKey: candidate.findingKey },
      orderBy: { occurrence: "desc" },
    });
    const sourceResolved = candidate.lifecycleState === "RESOLVED";
    let finding;
    if (
      latest &&
      (["OPEN", "ACKNOWLEDGED"].includes(latest.state) ||
        (sourceResolved && latest.state === "RESOLVED"))
    ) {
      const state = sourceResolved ? "RESOLVED" : latest.state;
      finding = await client.distributorReconciliationFinding.update({
        where: { id: latest.id },
        data: {
          severity: candidate.severity,
          sourceStatus: candidate.sourceStatus,
          recordRefs: candidate.recordRefs,
          expected: candidate.expected,
          observed: candidate.observed,
          explanation: candidate.explanation,
          nextAction: candidate.nextAction,
          workflowPath: candidate.workflowPath,
          lastSeenAt: now,
          state,
          ...(state === "RESOLVED" && latest.state !== "RESOLVED" ? { resolvedAt: now } : {}),
        },
      });
      counts.retained += 1;
      if (state !== latest.state) {
        counts.resolved += 1;
        await auditFindingTransition({
          client,
          actorContext,
          finding,
          beforeState: latest.state,
          state,
          now,
        });
      }
    } else {
      const occurrence = (latest?.occurrence || 0) + 1;
      finding = await client.distributorReconciliationFinding.create({
        data: {
          id: randomUUID(),
          distributorId,
          findingKey: candidate.findingKey,
          occurrence,
          category: candidate.category,
          severity: candidate.severity,
          state: sourceResolved ? "RESOLVED" : "OPEN",
          sourceStatus: candidate.sourceStatus,
          recordRefs: candidate.recordRefs,
          expected: candidate.expected,
          observed: candidate.observed,
          explanation: candidate.explanation,
          nextAction: candidate.nextAction,
          workflowPath: candidate.workflowPath,
          detectedAt: new Date(candidate.detectedAt),
          lastSeenAt: now,
          ...(sourceResolved ? { resolvedAt: now } : {}),
        },
      });
      counts.created += 1;
      if (sourceResolved) counts.resolved += 1;
      await auditFindingTransition({
        client,
        actorContext,
        finding,
        beforeState: null,
        state: finding.state,
        now,
      });
    }
    if (!["RESOLVED", "NO_LONGER_PRESENT"].includes(finding.state)) {
      activeKeys.set(finding.findingKey, finding.id);
      if (finding.state === "OPEN") counts.open += 1;
    }
  }

  if (runStatus === "SUCCESS") {
    const completeCategories = Object.entries(sourceCategory)
      .filter(([, source]) => sourceStatus[source] === "COMPLETE")
      .map(([category]) => category);
    if (completeCategories.length) {
      const existing = await client.distributorReconciliationFinding.findMany({
        where: {
          distributorId,
          category: { in: completeCategories },
          state: { in: ["OPEN", "ACKNOWLEDGED"] },
        },
        orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
        take: MAX_TOTAL_FINDINGS + 1,
      });
      if (existing.length <= MAX_TOTAL_FINDINGS) {
        for (const finding of existing) {
          if (activeKeys.has(finding.findingKey)) continue;
          const resolved = await client.distributorReconciliationFinding.update({
            where: { id: finding.id },
            data: { state: "NO_LONGER_PRESENT", resolvedAt: now, lastSeenAt: now },
          });
          counts.resolved += 1;
          await auditFindingTransition({
            client,
            actorContext,
            finding: resolved,
            beforeState: finding.state,
            state: "NO_LONGER_PRESENT",
            now,
          });
        }
      }
    }
  }
  return counts;
};

const getRunReport = async ({ client, distributorId, run, now }) => {
  const filter = normalizeFilters({ limit: 50 }, now);
  const where = findingWhere(distributorId, filter);
  const [records, total, summary] = await Promise.all([
    client.distributorReconciliationFinding.findMany({
      where,
      orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
      take: filter.pageSize,
    }),
    client.distributorReconciliationFinding.count({ where }),
    dashboardSummary(client, distributorId, now),
  ]);
  return {
    success: true,
    run,
    findings: records.map((finding) => serializeFinding(finding, now)),
    sourceStatus: run.sourceStatus,
    summary: summary.summary,
    recentRuns: summary.recentRuns,
    lastSuccessfulRun: summary.lastSuccessfulRun,
    latestFailedRun: summary.latestFailedRun,
    latestRun: summary.latestRun,
    pagination: {
      limit: filter.pageSize,
      total,
      hasMore: total > records.length,
      nextCursor: total > records.length ? records.at(-1)?.id || null : null,
    },
    serverTime: summary.serverTime,
  };
};

export const runDistributorReconciliation = async ({
  distributorId,
  actorContext = {},
  client = prisma,
  now = new Date(),
} = {}) => {
  if (typeof distributorId !== "string" || !distributorId.trim()) {
    throw fail("A valid distributor workspace is required.", 400, "INVALID_DISTRIBUTOR");
  }
  if (ACTIVE_RUNS.has(distributorId)) {
    throw fail("A reconciliation run is already active for this distributor.", 409, "RECONCILIATION_RUN_IN_PROGRESS");
  }
  ACTIVE_RUNS.add(distributorId);
  try {
    return await withDistributorLock(client, distributorId, async (tx) => {
      const report = await collectFindings({ client: tx, distributorId, now });
      const runStatus = report.incompleteSources.length === 0
        ? "SUCCESS"
        : DATA_SOURCE_NAMES.every((source) => report.sourceStatus[source] === "UNAVAILABLE")
          ? "FAILED"
          : "PARTIAL";
      const findingCounts = runStatus === "FAILED"
        ? { created: 0, retained: 0, resolved: 0, open: 0 }
        : await upsertFindings({
            client: tx,
            distributorId,
            findings: report.findings,
            sourceStatus: report.sourceStatus,
            runStatus,
            actorContext,
            now,
          });
      const run = {
        status: runStatus,
        completedAt: now.toISOString(),
        findingCounts,
        incompleteSources: report.incompleteSources,
        sourceStatus: report.sourceStatus,
      };
      await recordRunEvent(actorContext, distributorId, { ...report, run }, runStatus, tx);
      return getRunReport({ client: tx, distributorId, run, now });
    });
  } catch (error) {
    try {
      await recordRunEvent(actorContext, distributorId, null, "FAILED", client);
    } catch (auditError) {
      logger.error("A failed distributor reconciliation run could not be recorded in the audit outbox.", {
        distributorId,
        runErrorCode: error?.code || error?.name || "RECONCILIATION_FAILED",
        auditErrorCode: auditError?.code || auditError?.name || "AUDIT_WRITE_FAILED",
      });
    }
    throw error;
  } finally {
    ACTIVE_RUNS.delete(distributorId);
  }
};

export const acknowledgeDistributorReconciliationFinding = async ({
  distributorId,
  findingId,
  actorContext = {},
  client = prisma,
  now = new Date(),
} = {}) => {
  if (typeof distributorId !== "string" || !distributorId.trim()) {
    throw fail("A valid distributor workspace is required.", 400, "INVALID_DISTRIBUTOR");
  }
  if (typeof findingId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/.test(findingId)) {
    throw fail("A valid reconciliation finding ID is required.", 400, "INVALID_FINDING_ID");
  }
  return withDistributorLock(client, distributorId, async (tx) => {
    const finding = await tx.distributorReconciliationFinding.findFirst({
      where: { id: findingId, distributorId },
    });
    if (!finding) throw fail("Reconciliation finding not found.", 404, "RECONCILIATION_FINDING_NOT_FOUND");
    if (finding.state === "ACKNOWLEDGED") {
      return { findingId, state: finding.state, acknowledged: true, alreadyAcknowledged: true, acknowledgedAt: finding.acknowledgedAt.toISOString() };
    }
    if (finding.state !== "OPEN") {
      throw fail("Only open findings can be acknowledged.", 409, "RECONCILIATION_FINDING_NOT_OPEN");
    }
    const updated = await tx.distributorReconciliationFinding.update({
      where: { id: finding.id },
      data: {
        state: "ACKNOWLEDGED",
        acknowledgedAt: now,
        acknowledgedBy: actorContext.actorId || actorContext.accountId || null,
      },
    });
    await recordSystemAudit(
      actorContext,
      {
        action: "DISTRIBUTOR_RECONCILIATION_ACKNOWLEDGED",
        entityType: "DistributorReconciliationFinding",
        entityId: finding.id,
        beforeState: { state: finding.state },
        afterState: {
          findingId: finding.id,
          findingKey: finding.findingKey,
          occurrence: finding.occurrence,
          state: updated.state,
          acknowledgedAt: now.toISOString(),
        },
      },
      { client: tx, id: acknowledgementEventId(distributorId, finding.id) },
    );
    return {
      findingId,
      state: updated.state,
      acknowledged: true,
      alreadyAcknowledged: false,
      acknowledgedAt: now.toISOString(),
    };
  });
};
