import { createHash } from "node:crypto";
import { logger } from "../utils/logger.js";
import { recordSystemAudit } from "../services/auditService.js";
import { loadStockTransferReconciliationSources } from "../services/stockTransferReconciliationDataService.js";
import { reconcileStockTransfers } from "../services/stockTransferReconciliationService.js";
import {
  formatStockTransferReconciliationReport,
  serializeStockTransferReconciliationReportCsv,
  serializeStockTransferReconciliationReportJson,
} from "../services/stockTransferReconciliationReportService.js";

const MAX_LIMIT = 50;
const MAX_DATE_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
const VALID_STATUSES = new Set([
  "PENDING_ADMIN_APPROVAL",
  "APPROVED",
  "REJECTED",
  "IN_TRANSIT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "DISCREPANCY",
  "CANCELLED",
]);
const VALID_SEVERITIES = new Set(["HIGH", "MEDIUM", "LOW", "INFO"]);
const BAD_REQUEST = 400;

const badRequest = (message) => Object.assign(new Error(message), { statusCode: BAD_REQUEST });

const queryText = (value, name) => {
  if (value === undefined) return null;
  if (typeof value !== "string") throw badRequest(`${name} must be a single string value.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 191 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw badRequest(`${name} is invalid.`);
  }
  return normalized;
};

const parseDate = (value, name) => {
  if (value === undefined) return null;
  const normalized = queryText(value, name);
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) throw badRequest(`${name} must be a valid ISO date or timestamp.`);
  return date.toISOString();
};

const parseLimit = (value) => {
  if (value === undefined) return 25;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw badRequest("limit must be a positive integer.");
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit > MAX_LIMIT) {
    throw badRequest(`limit must be between 1 and ${MAX_LIMIT}.`);
  }
  return limit;
};

const normalizedFilterKey = (filters) =>
  createHash("sha256").update(JSON.stringify(filters)).digest("hex");

export const parseStockTransferReconciliationQuery = (query = {}) => {
  const format = queryText(query.format, "format")?.toLowerCase() || "json";
  if (!["json", "csv"].includes(format)) throw badRequest("format must be json or csv.");

  const from = parseDate(query.from, "from");
  const to = parseDate(query.to, "to");
  if (Boolean(from) !== Boolean(to)) throw badRequest("from and to must be provided together.");
  if (from && (Date.parse(from) >= Date.parse(to) ||
      Date.parse(to) - Date.parse(from) > MAX_DATE_RANGE_MS)) {
    throw badRequest("The date range must be positive and no longer than 90 days.");
  }

  const status = queryText(query.status, "status")?.toUpperCase() || null;
  if (status && !VALID_STATUSES.has(status)) throw badRequest("status is not a supported stock-transfer status.");
  const exceptionCode = queryText(query.exceptionCode, "exceptionCode")?.toUpperCase() || null;
  if (exceptionCode && !/^[A-Z0-9_]{1,100}$/.test(exceptionCode)) {
    throw badRequest("exceptionCode contains unsupported characters.");
  }
  const severity = queryText(query.severity, "severity")?.toUpperCase() || null;
  if (severity && !VALID_SEVERITIES.has(severity)) {
    throw badRequest("severity must be HIGH, MEDIUM, LOW, or INFO.");
  }
  const sourceLocationId = queryText(query.sourceLocationId, "sourceLocationId");
  const destinationLocationId = queryText(query.destinationLocationId, "destinationLocationId");
  const distributorId = queryText(query.distributorId, "distributorId");
  const inventorySkuId = queryText(query.inventorySkuId, "inventorySkuId");
  const filters = {
    ...(from ? { from, to } : {}),
    ...(sourceLocationId ? { sourceLocationId } : {}),
    ...(destinationLocationId ? { destinationLocationId } : {}),
    ...(distributorId ? { distributorId } : {}),
    ...(inventorySkuId ? { inventorySkuId } : {}),
    ...(status ? { status } : {}),
    ...(exceptionCode ? { exceptionCode } : {}),
    ...(severity ? { severity } : {}),
  };
  const limit = parseLimit(query.limit);
  const cursor = queryText(query.cursor, "cursor");
  if (cursor && cursor.length > 4096) throw badRequest("cursor is too long.");
  return { filters, limit, cursor, format };
};

export const encodeStockTransferReconciliationCursor = (lastTransfer, filters) => {
  if (!lastTransfer?.transferId || !lastTransfer?.requestedAt) return null;
  const payload = {
    v: 1,
    filterHash: normalizedFilterKey(filters),
    transferId: String(lastTransfer.transferId),
    requestedAt: new Date(lastTransfer.requestedAt).toISOString(),
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
};

export const decodeStockTransferReconciliationCursor = (value, filters) => {
  if (!value) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
      throw new Error("invalid cursor encoding");
    }
    const payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Buffer.from(value, "base64url").toString("base64url") !== value) {
      throw new Error("invalid cursor encoding");
    }
    const requestedAt = new Date(payload.requestedAt);
    if (payload.v !== 1 ||
        payload.filterHash !== normalizedFilterKey(filters) ||
        typeof payload.transferId !== "string" ||
        !payload.transferId ||
        !Number.isFinite(requestedAt.getTime()) ||
        requestedAt.toISOString() !== payload.requestedAt) {
      throw new Error("invalid cursor");
    }
    return { transferId: payload.transferId, requestedAt: requestedAt.toISOString() };
  } catch {
    throw badRequest("cursor is invalid or does not match the requested filters.");
  }
};

const auditReportAccess = async (auditRecorder, req, { filters, format, outcome, status }) => {
  try {
    await auditRecorder({
      actorId: req.auth?.accountId || null,
      actorRole: req.auth?.role || null,
      portalSource: "ADMIN",
      ipAddress: req.ip || null,
      userAgent: req.get?.("user-agent") || req.headers?.["user-agent"] || null,
      correlationId: req.correlationId || null,
    }, {
      action: "ADMIN_STOCK_TRANSFER_RECONCILIATION_READ",
      entityType: "StockTransferReconciliationReport",
      entityId: req.correlationId || null,
      status,
      afterState: { filters, format, outcome },
    });
  } catch (error) {
    logger.error("Stock-transfer reconciliation access audit could not be recorded.", {
      correlationId: req.correlationId || null,
      errorName: error?.name || "Error",
    });
  }
};

export const createStockTransferReconciliationController = ({
  loadSources = loadStockTransferReconciliationSources,
  reconcile = reconcileStockTransfers,
  formatReport = formatStockTransferReconciliationReport,
  serializeJson = serializeStockTransferReconciliationReportJson,
  serializeCsv = serializeStockTransferReconciliationReportCsv,
  auditRecorder = recordSystemAudit,
  logger: controllerLogger = logger,
} = {}) => async (req, res) => {
  let parsed;
  let cursor;
  try {
    parsed = parseStockTransferReconciliationQuery(req.query || {});
    cursor = decodeStockTransferReconciliationCursor(parsed.cursor, parsed.filters);
  } catch (error) {
    return res.status(error.statusCode || BAD_REQUEST).json({
      success: false,
      message: error.statusCode ? error.message : "The reconciliation query is invalid.",
      code: "INVALID_STOCK_TRANSFER_RECONCILIATION_QUERY",
    });
  }

  try {
    const sources = await loadSources({ filters: parsed.filters, cursor, limit: parsed.limit });
    const result = reconcile({
      transfers: sources.transfers,
      shipments: sources.shipments,
      receipts: sources.receipts,
      discrepancies: sources.discrepancies,
      ledgerEntries: sources.ledgerEntries,
      balances: sources.balances,
      locations: sources.locations,
      costLayers: sources.costLayers,
      costEvidence: sources.costEvidence,
      coverage: sources.coverage,
      sourceErrors: sources.sourceErrors,
    });
    const report = formatReport(result);
    const filteredExceptions = report.exceptions.filter((exception) =>
      (!parsed.filters.exceptionCode || exception.code === parsed.filters.exceptionCode) &&
      (!parsed.filters.severity || exception.severity === parsed.filters.severity)
    );
    const nextCursor = sources.page?.hasMore
      ? encodeStockTransferReconciliationCursor(sources.page.lastTransfer, parsed.filters)
      : null;
    const coreSourceCoverageComplete = [
      "transfers",
      "shipments",
      "receipts",
      "discrepancies",
      "ledgerEntries",
      "balances",
      "locations",
    ].every((source) => sources.coverage[source] === true);
    const hasUnavailableSources = sources.sourceErrors?.length > 0;
    const reportStatus = report.reconciliationOutcome;
    const payload = {
      ...report,
      exceptions: filteredExceptions,
      reportRunId: req.correlationId || null,
      reportStatus,
      filters: parsed.filters,
      exceptionDetailsFilter: {
        exceptionCode: parsed.filters.exceptionCode || null,
        severity: parsed.filters.severity || null,
      },
      scope: {
        scopeType: "TRANSFER_PAGE",
        coreSourceCoverageComplete,
        snapshotConsistency: sources.snapshotConsistency || "UNAVAILABLE",
        hasMore: Boolean(sources.page?.hasMore),
      },
      pagination: {
        limit: parsed.limit,
        hasMore: Boolean(sources.page?.hasMore),
        nextCursor,
      },
      success: !hasUnavailableSources,
      message: hasUnavailableSources
        ? "One or more reconciliation sources are unavailable."
        : reportStatus === "RECONCILIATION_INCOMPLETE"
          ? "The report was generated with incomplete source evidence."
          : "The reconciliation report was generated.",
      ...(hasUnavailableSources
        ? { code: "STOCK_TRANSFER_RECONCILIATION_DATA_UNAVAILABLE" }
        : {}),
    };

    await auditReportAccess(auditRecorder, req, {
      filters: parsed.filters,
      format: parsed.format,
      outcome: reportStatus,
      status: hasUnavailableSources ? "FAILED" : "SUCCESS",
    });

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Report-Outcome", reportStatus);
    res.setHeader("X-Report-Has-More", String(Boolean(sources.page?.hasMore)));
    if (nextCursor) res.setHeader("X-Next-Cursor", nextCursor);

    if (parsed.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="stock-transfer-reconciliation.csv"');
      if (hasUnavailableSources) res.setHeader("X-Report-Error-Code", payload.code);
      return res.status(hasUnavailableSources ? 503 : 200).send(serializeCsv(payload));
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="stock-transfer-reconciliation.json"');
    return res.status(hasUnavailableSources ? 503 : 200).send(serializeJson(payload));
  } catch (error) {
    controllerLogger.error("Stock-transfer reconciliation report generation failed.", {
      correlationId: req.correlationId || null,
      errorName: error?.name || "Error",
    });
    return res.status(500).json({
      success: false,
      message: "Stock-transfer reconciliation data could not be loaded.",
      code: "STOCK_TRANSFER_RECONCILIATION_FAILED",
    });
  }
};

export const getStockTransferReconciliation = createStockTransferReconciliationController();
