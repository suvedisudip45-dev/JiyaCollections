import assert from "node:assert/strict";
import test from "node:test";
import {
  createStockTransferReconciliationController,
  decodeStockTransferReconciliationCursor,
  encodeStockTransferReconciliationCursor,
  parseStockTransferReconciliationQuery,
} from "../controllers/stockTransferReconciliationController.js";
import {
  createAdminStockTransferReconciliationRouter,
  STOCK_TRANSFER_RECONCILIATION_PERMISSION,
} from "../routes/adminStockTransferReconciliationRoute.js";
import { createAuthorize } from "../middleware/authorize.js";
import { requireRole } from "../middleware/unifiedAuth.js";

const coreSources = [
  "transfers",
  "shipments",
  "receipts",
  "discrepancies",
  "ledgerEntries",
  "balances",
  "locations",
];
const completeSources = () => Object.fromEntries(coreSources.map((source) => [source, true]));

const makeResponse = () => ({
  headers: {},
  statusCode: null,
  body: null,
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  },
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  send(body) {
    this.body = body;
    return this;
  },
});

const makeReport = (outcome = "EXCEPTIONS_DETECTED") => ({
  schemaVersion: "1.0",
  reconciliationOutcome: outcome,
  sourceCoverage: { status: "COMPLETE" },
  summary: { exceptions: { total: 3 } },
  exceptions: [
    { code: "QUANTITY_MISMATCH", severity: "HIGH", transferId: "transfer-1" },
    { code: "QUANTITY_MISMATCH", severity: "LOW", transferId: "transfer-2" },
    { code: "INSUFFICIENT_EVIDENCE", severity: "HIGH", transferId: "transfer-3" },
  ],
});

const makeSources = (overrides = {}) => ({
  transfers: [],
  shipments: [],
  receipts: [],
  discrepancies: [],
  ledgerEntries: [],
  balances: [],
  locations: [],
  costLayers: [],
  costEvidence: [],
  coverage: { ...completeSources(), costLayers: true, costEvidence: false },
  sourceErrors: [],
  snapshotConsistency: "REPEATABLE_READ",
  page: { hasMore: false, lastTransfer: null },
  ...overrides,
});

test("parses bounded filters and rejects malformed query values", () => {
  const parsed = parseStockTransferReconciliationQuery({
    from: "2026-01-01",
    to: "2026-02-01",
    sourceLocationId: " source-1 ",
    status: "in_transit",
    exceptionCode: "quantity_mismatch",
    severity: "high",
    limit: "10",
  });

  assert.equal(parsed.filters.sourceLocationId, "source-1");
  assert.equal(parsed.filters.status, "IN_TRANSIT");
  assert.equal(parsed.filters.exceptionCode, "QUANTITY_MISMATCH");
  assert.equal(parsed.filters.severity, "HIGH");
  assert.equal(parsed.limit, 10);
  assert.throws(() => parseStockTransferReconciliationQuery({ limit: "51" }), /between 1 and 50/);
  assert.throws(() => parseStockTransferReconciliationQuery({ status: ["RECEIVED"] }), /single string/);
  assert.throws(() => parseStockTransferReconciliationQuery({ from: "", to: "2026-02-01" }), /invalid/);
  assert.throws(() => parseStockTransferReconciliationQuery({ from: "2026-01-01" }), /provided together/);
});

test("binds opaque cursors to normalized filters and rejects tampering", () => {
  const filters = { status: "IN_TRANSIT" };
  const cursor = encodeStockTransferReconciliationCursor({
    transferId: "transfer-1",
    requestedAt: "2026-01-01T00:00:00.000Z",
  }, filters);

  assert.deepEqual(decodeStockTransferReconciliationCursor(cursor, filters), {
    transferId: "transfer-1",
    requestedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.throws(() => decodeStockTransferReconciliationCursor(cursor, { status: "RECEIVED" }), /invalid/);
  assert.throws(() => decodeStockTransferReconciliationCursor("%%%", filters), /invalid/);
});

test("applies identical exception filters to JSON exports and preserves full summary counts", async () => {
  let loaded;
  let audited;
  let serialized;
  const report = makeReport();
  const controller = createStockTransferReconciliationController({
    loadSources: async (input) => {
      loaded = input;
      return makeSources({
        coverage: { ...completeSources(), transfers: false, costLayers: true, costEvidence: false },
        page: {
          hasMore: true,
          lastTransfer: { transferId: "transfer-page-end", requestedAt: "2026-01-01T00:00:00.000Z" },
        },
      });
    },
    reconcile: (input) => input,
    formatReport: () => report,
    serializeJson: (payload) => {
      serialized = payload;
      return JSON.stringify(payload);
    },
    auditRecorder: async (_actor, event) => { audited = event; },
  });
  const req = {
    query: { format: "json", exceptionCode: "quantity_mismatch", severity: "high", limit: "10" },
    auth: { accountId: "admin-1", role: "ADMIN" },
    correlationId: "correlation-1",
    ip: "127.0.0.1",
    headers: {},
    get: () => "synthetic-agent",
  };
  const res = makeResponse();

  await controller(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(serialized.exceptions.length, 1);
  assert.equal(serialized.exceptions[0].transferId, "transfer-1");
  assert.equal(serialized.summary.exceptions.total, 3);
  assert.equal(serialized.scope.coreSourceCoverageComplete, false);
  assert.equal(serialized.pagination.hasMore, true);
  assert.ok(serialized.pagination.nextCursor);
  assert.equal(loaded.filters.exceptionCode, "QUANTITY_MISMATCH");
  assert.equal(loaded.limit, 10);
  assert.equal(audited.action, "ADMIN_STOCK_TRANSFER_RECONCILIATION_READ");
  assert.equal(audited.status, "SUCCESS");
});

test("uses the same exception filter for CSV and reports unavailable sources as 503", async () => {
  let csvPayload;
  const csvController = createStockTransferReconciliationController({
    loadSources: async () => makeSources(),
    reconcile: () => ({}),
    formatReport: () => makeReport(),
    serializeCsv: (payload) => {
      csvPayload = payload;
      return "report,csv";
    },
    auditRecorder: async () => {},
  });
  const csvResponse = makeResponse();
  await csvController({
    query: { format: "csv", exceptionCode: "INSUFFICIENT_EVIDENCE" },
    auth: { accountId: "admin-1", role: "ADMIN" },
    headers: {},
  }, csvResponse);

  assert.equal(csvResponse.statusCode, 200);
  assert.equal(csvResponse.headers["content-type"], "text/csv; charset=utf-8");
  assert.equal(csvPayload.exceptions.length, 1);
  assert.equal(csvPayload.exceptions[0].code, "INSUFFICIENT_EVIDENCE");

  let unavailablePayload;
  const unavailableController = createStockTransferReconciliationController({
    loadSources: async () => makeSources({
      coverage: Object.fromEntries(coreSources.map((source) => [source, false])),
      sourceErrors: ["transfers"],
    }),
    reconcile: () => ({}),
    formatReport: () => makeReport("DATA_UNAVAILABLE"),
    serializeJson: (payload) => {
      unavailablePayload = payload;
      return JSON.stringify(payload);
    },
    auditRecorder: async () => {},
  });
  const unavailableResponse = makeResponse();
  await unavailableController({
    query: {},
    auth: { accountId: "admin-1", role: "ADMIN" },
    headers: {},
  }, unavailableResponse);

  assert.equal(unavailableResponse.statusCode, 503);
  assert.equal(unavailablePayload.success, false);
  assert.equal(unavailablePayload.code, "STOCK_TRANSFER_RECONCILIATION_DATA_UNAVAILABLE");
  assert.equal(unavailableResponse.headers["x-report-outcome"], "DATA_UNAVAILABLE");
});

test("rejects invalid requests before attempting source reads", async () => {
  let called = false;
  const controller = createStockTransferReconciliationController({
    loadSources: async () => {
      called = true;
      return makeSources();
    },
  });
  const res = makeResponse();

  await controller({ query: { limit: "999" }, headers: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "INVALID_STOCK_TRANSFER_RECONCILIATION_QUERY");
  assert.equal(called, false);
});

test("runs the actual calculator and formatter through JSON and CSV response serialization", async () => {
  const createController = () => createStockTransferReconciliationController({
    loadSources: async () => makeSources(),
    auditRecorder: async () => {},
  });
  const jsonResponse = makeResponse();
  await createController()({
    query: { format: "json" },
    auth: { accountId: "admin-1", role: "ADMIN" },
    headers: {},
  }, jsonResponse);

  assert.equal(jsonResponse.statusCode, 200);
  const jsonReport = JSON.parse(jsonResponse.body);
  assert.equal(jsonReport.schemaVersion, "1.0");
  assert.equal(jsonReport.reconciliationOutcome, "NO_EXCEPTION_DETECTED");
  assert.equal(jsonReport.scope.coreSourceCoverageComplete, true);

  const csvResponse = makeResponse();
  await createController()({
    query: { format: "csv" },
    auth: { accountId: "admin-1", role: "ADMIN" },
    headers: {},
  }, csvResponse);

  assert.equal(csvResponse.statusCode, 200);
  assert.ok(csvResponse.body.startsWith('"Report outcome","Transfer identifier"'));
});

test("mounts the report behind authentication, Admin role, and ledger-read permission", () => {
  const authenticate = () => {};
  const requireAdmin = () => {};
  const permissionMiddleware = () => {};
  const controller = () => {};
  let requestedPermission;
  const router = createAdminStockTransferReconciliationRouter({
    authenticateMiddleware: authenticate,
    requireAdminRole: requireAdmin,
    authorizeMiddleware: (permission) => {
      requestedPermission = permission;
      return permissionMiddleware;
    },
    controller,
  });
  const route = router.stack.find((layer) =>
    layer.route?.path === "/stock-transfer-reconciliation"
  );

  assert.ok(route);
  assert.equal(requestedPermission, STOCK_TRANSFER_RECONCILIATION_PERMISSION);
  assert.deepEqual(route.route.stack.map((layer) => layer.handle), [
    authenticate,
    requireAdmin,
    permissionMiddleware,
    controller,
  ]);
});

test("enforces authentication, Admin role, and ledger-read permission before the controller", async () => {
  let controllerCalled = false;
  let permissionGranted = false;
  const authenticate = (req, res, next) => {
    if (!req.auth) return res.status(401).json({ success: false });
    return next();
  };
  const router = createAdminStockTransferReconciliationRouter({
    authenticateMiddleware: authenticate,
    requireAdminRole: requireRole("ADMIN"),
    authorizeMiddleware: createAuthorize(
      async (_accountId, { principalRole }) => principalRole === "ADMIN" && permissionGranted
        ? new Set(["inventory:ledger_read"])
        : new Set(),
      async () => {},
    ),
    controller: (_req, res) => {
      controllerCalled = true;
      res.status(200).send("ok");
    },
  });
  const stack = router.stack.find((layer) =>
    layer.route?.path === "/stock-transfer-reconciliation"
  ).route.stack.map((layer) => layer.handle);
  const invoke = (req) => new Promise((resolve, reject) => {
    const res = makeResponse();
    const dispatch = (index) => {
      if (index >= stack.length) {
        resolve(res);
        return;
      }
      try {
        const result = stack[index](req, res, () => dispatch(index + 1));
        if (result && typeof result.then === "function") {
          result.then(() => {
            if (res.statusCode !== null) resolve(res);
          }, reject);
        } else if (res.statusCode !== null) {
          resolve(res);
        }
      } catch (error) {
        reject(error);
      }
    };
    dispatch(0);
  });

  const unauthenticated = await invoke({});
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(controllerCalled, false);

  const wrongRole = await invoke({ auth: { accountId: "partner-1", role: "DISTRIBUTOR" } });
  assert.equal(wrongRole.statusCode, 403);
  assert.equal(controllerCalled, false);

  const missingPermission = await invoke({ auth: { accountId: "admin-1", role: "ADMIN" } });
  assert.equal(missingPermission.statusCode, 403);
  assert.equal(controllerCalled, false);

  permissionGranted = true;
  const authorized = await invoke({ auth: { accountId: "admin-1", role: "ADMIN" } });
  assert.equal(authorized.statusCode, 200);
  assert.equal(controllerCalled, true);
});
