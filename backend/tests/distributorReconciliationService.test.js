import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  acknowledgeDistributorReconciliationFinding,
  getDistributorReconciliationDashboard,
  runDistributorReconciliation,
} from "../services/distributorReconciliationService.js";

const NOW = new Date("2026-01-03T00:00:00.000Z");
const DISTRIBUTOR_ID = "distributor-test";
const rowsMatch = (row, where = {}) => {
  if (where.distributorId && row.distributorId !== where.distributorId) return false;
  for (const key of ["category", "severity", "state"]) {
    if (typeof where[key] === "string" && row[key] !== where[key]) return false;
    if (where[key]?.in && !where[key].in.includes(row[key])) return false;
  }
  if (where.detectedAt?.gte && row.detectedAt < where.detectedAt.gte) return false;
  if (where.detectedAt?.lte && row.detectedAt > where.detectedAt.lte) return false;
  return true;
};

const createClient = ({
  discrepancies = [],
  missingProofStops = [],
  offlineDrafts = [],
  sourceErrors = {},
  distributorIds = [DISTRIBUTOR_ID],
  onLock = async () => {},
} = {}) => {
  const findings = [];
  const audits = [];
  const sourceWrites = [];
  const queries = {};
  const transactionOptions = [];
  const sourceDelegate = (name, rows) => new Proxy({
    findMany: async (args) => {
      queries[name] = args;
      if (sourceErrors[name]) throw new Error("Source unavailable.");
      const selected = rows.filter((row) => {
        if (row.distributorId && row.distributorId !== args.where?.distributorId) return false;
        if (name === "proof") return row.status === args.where.status;
        if (name === "discrepancies") return args.where.status.in.includes(row.status);
        if (name === "offline") {
          return args.where.OR.some((condition) =>
            row.status === condition.status &&
            (!condition.createdAt?.lte || row.createdAt <= condition.createdAt.lte)
          );
        }
        return true;
      });
      return selected.slice(0, args.take);
    },
  }, {
    get(target, key) {
      if (["create", "createMany", "update", "updateMany", "delete", "deleteMany"].includes(key)) {
        return async () => { sourceWrites.push(`${name}.${String(key)}`); };
      }
      return target[key];
    },
  });
  const findingDelegate = {
    findFirst: async ({ where, orderBy }) => {
      const matches = findings.filter((row) =>
        (!where.id || row.id === where.id) &&
        rowsMatch(row, where) &&
        (!where.findingKey || row.findingKey === where.findingKey)
      );
      if (orderBy?.occurrence) matches.sort((a, b) => b.occurrence - a.occurrence);
      return matches[0] || null;
    },
    findMany: async ({ where = {}, cursor, skip = 0, orderBy, take }) => {
      let matches = findings.filter((row) => rowsMatch(row, where));
      if (orderBy) {
        matches.sort((a, b) => b.detectedAt - a.detectedAt || b.id.localeCompare(a.id));
      }
      if (cursor) {
        const index = matches.findIndex((row) => row.id === cursor.id);
        if (index >= 0) matches = matches.slice(index + skip);
      }
      return matches.slice(0, take);
    },
    count: async ({ where = {} }) => findings.filter((row) => rowsMatch(row, where)).length,
    groupBy: async ({ by, where }) => {
      const counts = new Map();
      for (const row of findings.filter((item) => rowsMatch(item, where))) {
        const key = row[by[0]];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return [...counts].map(([state, total]) => ({ state, _count: { _all: total } }));
    },
    create: async ({ data }) => {
      const record = {
        ...data,
        detectedAt: data.detectedAt || NOW,
        lastSeenAt: data.lastSeenAt || NOW,
        acknowledgedAt: data.acknowledgedAt || null,
        resolvedAt: data.resolvedAt || null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      findings.push(record);
      return record;
    },
    update: async ({ where, data }) => {
      const record = findings.find((row) => row.id === where.id);
      if (!record) throw new Error("Finding not found.");
      Object.assign(record, data);
      return record;
    },
  };
  const tx = {
    $queryRaw: async (strings, distributorId) => {
      await onLock();
      return distributorIds.includes(distributorId) ? [{ id: distributorId }] : [];
    },
    stockTransfer: { findMany: async ({ where, take }) => {
      queries.transfers = { where, take };
      if (sourceErrors.transfers) throw new Error("Source unavailable.");
      return [];
    } },
    inventoryDiscrepancy: sourceDelegate("discrepancies", discrepancies),
    deliveryManifestStop: sourceDelegate("proof", missingProofStops),
    offlineDeliverySyncDraft: sourceDelegate("offline", offlineDrafts),
    distributorReconciliationFinding: findingDelegate,
    systemAuditOutbox: {
      findUnique: async ({ where }) => audits.find((item) => item.id === where.id) || null,
      create: async ({ data }) => {
        if (audits.some((item) => item.id === data.id)) {
          throw Object.assign(new Error("Duplicate audit event."), { code: "P2002" });
        }
        audits.push({ id: data.id, event: data.event, createdAt: NOW });
        return { id: data.id };
      },
    },
    systemAuditLog: {
      findMany: async ({ where, take }) => {
        const logs = audits.filter((item) =>
          item.event?.entityType === where.entityType &&
          item.event?.entityId === where.entityId
        );
        return logs.slice(0, take).map((item) => ({
          id: item.id,
          status: item.event.status,
          afterState: item.event.afterState,
          createdAt: item.createdAt,
        }));
      },
    },
  };
  const client = {
    ...tx,
    $transaction: async (operation, options) => {
      transactionOptions.push(options);
      return operation(tx);
    },
  };
  return { client, findings, audits, sourceWrites, queries, sourceErrors, transactionOptions };
};

const findingData = () => ({
  discrepancies: [{
    id: "discrepancy-1",
    distributorId: DISTRIBUTOR_ID,
    stockTransferId: null,
    shipmentId: null,
    receiptId: null,
    discrepancyType: "SHORT_RECEIPT",
    quantity: 3,
    status: "OPEN",
    createdAt: NOW,
    evidence: { photoPath: "private-evidence" },
  }],
  missingProofStops: [{
    id: "stop-1",
    manifestId: "manifest-1",
    orderId: "order-1",
    status: "DELIVERED",
    completedAt: NOW,
  }],
  offlineDrafts: [{
    id: "draft-1",
    manifestId: "manifest-1",
    stopId: "stop-2",
    status: "CONFLICT",
    createdAt: NOW,
    updatedAt: NOW,
    payloadSnapshot: { recipientName: "Private name", codAmount: 999 },
  }],
});

test("stable source identity retains one finding across repeated runs", async () => {
  const fixture = findingData();
  const { client, findings, audits, transactionOptions } = createClient(fixture);
  const first = await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });
  const second = await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });

  assert.equal(first.findings.length, 3);
  assert.equal(second.run.findingCounts.created, 0);
  assert.equal(second.run.findingCounts.retained, 3);
  assert.equal(findings.length, 3);
  assert.equal(new Set(findings.map((row) => row.findingKey)).size, 3);
  assert.equal(findings.every((row) => row.occurrence === 1), true);
  assert.equal(audits.filter((item) => item.event.action.endsWith("_OPEN")).length, 3);
  assert.equal(transactionOptions[0].isolationLevel, "Serializable");
});

test("findings omit private evidence and delivery payloads while retaining safe source references", async () => {
  const { client } = createClient(findingData());
  const report = await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });

  assert.equal(report.findings.every((finding) => finding.distributorId === DISTRIBUTOR_ID), true);
  assert.equal(report.findings.every((finding) => finding.automatedResolutionPermitted === false), true);
  assert.equal(JSON.stringify(report).includes("private-evidence"), false);
  assert.equal(JSON.stringify(report).includes("Private name"), false);
  assert.equal(JSON.stringify(report).includes("codAmount"), false);
  assert.equal(report.findings.find((finding) => finding.category === "DELIVERY_WITHOUT_POD").workflowPath, "/distributor/logistics");
});

test("source-closed inventory discrepancies are retained as resolved informational findings", async () => {
  const data = findingData();
  data.discrepancies[0].status = "RESOLVED";
  const { client, findings } = createClient(data);
  const report = await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });
  const finding = report.findings.find((item) => item.category === "INVENTORY_DISCREPANCY");
  await runDistributorReconciliation({
    distributorId: DISTRIBUTOR_ID,
    client,
    now: new Date(NOW.getTime() + 1000),
  });

  assert.equal(finding.state, "RESOLVED");
  assert.equal(finding.sourceStatus, "RESOLVED");
  assert.equal(finding.severity, "INFO");
  assert.equal(findings.find((item) => item.id === finding.id).resolvedAt.toISOString(), NOW.toISOString());
});

test("acknowledgement persists without resolving or changing source records", async () => {
  const { client, findings, audits, sourceWrites } = createClient(findingData());
  const report = await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });
  const finding = report.findings.find((item) => item.category === "INVENTORY_DISCREPANCY");

  const first = await acknowledgeDistributorReconciliationFinding({
    distributorId: DISTRIBUTOR_ID,
    findingId: finding.id,
    actorContext: { actorId: "operator-1", actorRole: "DISTRIBUTOR" },
    client,
    now: NOW,
  });
  const second = await acknowledgeDistributorReconciliationFinding({
    distributorId: DISTRIBUTOR_ID,
    findingId: finding.id,
    client,
    now: NOW,
  });

  assert.equal(first.state, "ACKNOWLEDGED");
  assert.equal(first.alreadyAcknowledged, false);
  assert.equal(second.alreadyAcknowledged, true);
  assert.equal(findings.find((row) => row.id === finding.id).state, "ACKNOWLEDGED");
  assert.equal(audits.filter((item) => item.event.action === "DISTRIBUTOR_RECONCILIATION_ACKNOWLEDGED").length, 1);
  assert.deepEqual(sourceWrites, []);

  await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });
  assert.equal(findings.find((row) => row.id === finding.id).state, "ACKNOWLEDGED");
});

test("successful complete reconciliation marks an absent source finding no longer present", async () => {
  const fixture = findingData();
  const { client, findings, audits } = createClient(fixture);
  const first = await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });
  const finding = first.findings.find((item) => item.category === "INVENTORY_DISCREPANCY");
  fixture.discrepancies.splice(0);
  const second = await runDistributorReconciliation({
    distributorId: DISTRIBUTOR_ID,
    client,
    now: new Date(NOW.getTime() + 1000),
  });

  assert.equal(second.run.status, "SUCCESS");
  assert.equal(second.run.findingCounts.resolved, 1);
  assert.equal(findings.find((row) => row.id === finding.id).state, "NO_LONGER_PRESENT");
  assert.ok(audits.some((item) => item.event.action === "DISTRIBUTOR_RECONCILIATION_NO_LONGER_PRESENT"));
});

test("a reappearing discrepancy gets a new occurrence while the resolved history stays retained", async () => {
  const fixture = findingData();
  const { client, findings } = createClient(fixture);
  const first = await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });
  const original = first.findings.find((item) => item.category === "INVENTORY_DISCREPANCY");
  fixture.discrepancies.splice(0);
  await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: new Date(NOW.getTime() + 1000) });
  fixture.discrepancies.push(findingData().discrepancies[0]);
  const reopened = await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: new Date(NOW.getTime() + 2000) });

  const current = reopened.findings.find((item) => item.category === "INVENTORY_DISCREPANCY");
  assert.notEqual(current.id, original.id);
  assert.equal(current.occurrence, 2);
  assert.equal(findings.find((row) => row.id === original.id).state, "NO_LONGER_PRESENT");
  assert.equal(findings.find((row) => row.id === current.id).state, "OPEN");
});

test("partial or failed runs do not resolve findings from incomplete or unavailable sources", async () => {
  const fixture = findingData();
  const { client, findings, sourceErrors } = createClient(fixture);
  const first = await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });
  const finding = first.findings.find((item) => item.category === "INVENTORY_DISCREPANCY");
  fixture.discrepancies.splice(0);
  sourceErrors.discrepancies = true;
  const partial = await runDistributorReconciliation({
    distributorId: DISTRIBUTOR_ID,
    client,
    now: new Date(NOW.getTime() + 1000),
  });
  assert.equal(partial.run.status, "PARTIAL");
  assert.equal(findings.find((row) => row.id === finding.id).state, "OPEN");
});

test("failed and partial delivery outcomes are excluded from missing-successful-POD checks", async () => {
  const data = findingData();
  data.missingProofStops = [
    { id: "partial-stop", manifestId: "manifest-1", orderId: "order-2", status: "PARTIAL", completedAt: NOW },
    { id: "failed-stop", manifestId: "manifest-1", orderId: "order-3", status: "FAILED", completedAt: NOW },
  ];
  const { client, queries } = createClient(data);
  const report = await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });
  assert.equal(report.findings.some((finding) => finding.category === "DELIVERY_WITHOUT_POD"), false);
  assert.equal(queries.proof.where.status, "DELIVERED");
});

test("offline sync checks use the 24-hour server timestamp threshold and omit synced drafts", async () => {
  const data = findingData();
  data.offlineDrafts = [
    { id: "old-pending", manifestId: "manifest-1", stopId: "stop-old", status: "PENDING", createdAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) },
    { id: "new-pending", manifestId: "manifest-1", stopId: "stop-new", status: "PENDING", createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) },
    { id: "synced", manifestId: "manifest-1", stopId: "stop-done", status: "SYNCED", createdAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000) },
  ];
  const { client, queries } = createClient(data);
  await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });

  assert.equal(queries.offline.where.manifest.distributorId, DISTRIBUTOR_ID);
  assert.equal(queries.offline.where.OR[1].status, "PENDING");
  assert.equal(queries.offline.where.OR[1].createdAt.lte.toISOString(), new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString());
});

test("dashboard filters, summary, cursor pagination, and histories stay distributor scoped", async () => {
  const { client, findings: records } = createClient({
    ...findingData(),
    distributorIds: [DISTRIBUTOR_ID, "another-distributor"],
  });
  await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });
  records.push({
    ...records[0],
    id: "foreign-finding",
    distributorId: "another-distributor",
    detectedAt: new Date(NOW.getTime() + 1000),
  });

  const first = await getDistributorReconciliationDashboard({
    distributorId: DISTRIBUTOR_ID,
    filters: { category: "INVENTORY_DISCREPANCY", state: "OPEN", limit: "1" },
    client,
    now: NOW,
  });
  assert.equal(first.findings.length, 1);
  assert.equal(first.findings[0].distributorId, DISTRIBUTOR_ID);
  assert.equal(first.pagination.hasMore, false);
  assert.equal(first.pagination.total, 1);
  assert.equal(first.findings[0].category, "INVENTORY_DISCREPANCY");
  assert.equal(first.summary.total, 3);
  assert.equal(first.summary.open, 3);
  const dateFiltered = await getDistributorReconciliationDashboard({
    distributorId: DISTRIBUTOR_ID,
    filters: { from: "2026-01-03", to: "2026-01-03" },
    client,
    now: NOW,
  });
  assert.equal(dateFiltered.pagination.total, 3);

  const pageOne = await getDistributorReconciliationDashboard({
    distributorId: DISTRIBUTOR_ID,
    filters: { limit: "1" },
    client,
    now: NOW,
  });
  assert.equal(pageOne.pagination.hasMore, true);
  const pageTwo = await getDistributorReconciliationDashboard({
    distributorId: DISTRIBUTOR_ID,
    filters: { limit: "1", cursor: pageOne.pagination.nextCursor },
    client,
    now: NOW,
  });
  assert.equal(pageTwo.findings.length, 1);
  assert.notEqual(pageTwo.findings[0].id, pageOne.findings[0].id);
  assert.equal(pageTwo.findings.every((item) => item.distributorId === DISTRIBUTOR_ID), true);
  await assert.rejects(
    getDistributorReconciliationDashboard({
      distributorId: DISTRIBUTOR_ID,
      filters: { cursor: "foreign-finding" },
      client,
      now: NOW,
    }),
    (error) => error.statusCode === 404,
  );
});

test("overlapping same-process reconciliation runs are rejected without changing source records", async () => {
  let enteredLock;
  let releaseLock;
  const lockEntered = new Promise((resolve) => { enteredLock = resolve; });
  const lockRelease = new Promise((resolve) => { releaseLock = resolve; });
  const { client } = createClient({
    ...findingData(),
    onLock: async () => {
      enteredLock();
      await lockRelease;
    },
  });
  const firstRun = runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });
  await lockEntered;
  await assert.rejects(
    runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW }),
    (error) => error.statusCode === 409,
  );
  releaseLock();
  await firstRun;
});

test("source queries are bounded, tenant-scoped, and reject cross-tenant acknowledgement", async () => {
  const { client, queries } = createClient({
    ...findingData(),
    distributorIds: [DISTRIBUTOR_ID],
  });
  const report = await runDistributorReconciliation({ distributorId: DISTRIBUTOR_ID, client, now: NOW });
  assert.ok(queries.transfers.take <= 26);
  assert.ok(queries.discrepancies.take <= 51);
  assert.ok(queries.proof.take <= 51);
  assert.ok(queries.offline.take <= 51);
  assert.equal(queries.proof.where.manifest.distributorId, DISTRIBUTOR_ID);
  assert.equal(queries.offline.where.manifest.distributorId, DISTRIBUTOR_ID);
  const findingId = report.findings[0].id;
  await assert.rejects(
    acknowledgeDistributorReconciliationFinding({
      distributorId: "other-distributor",
      findingId,
      client,
      now: NOW,
    }),
    (error) => error.statusCode === 404,
  );
});

test("reconciliation API routes expose protected, bounded lifecycle operations", async () => {
  const routeSource = await readFile(new URL("../routes/distributorRoute.js", import.meta.url), "utf8");
  const controllerSource = await readFile(new URL("../controllers/distributorReconciliationController.js", import.meta.url), "utf8");
  const seedSource = await readFile(new URL("../prisma/seed.js", import.meta.url), "utf8");
  assert.match(routeSource, /"\/operations\/reconciliation"[\s\S]*?authorize\("distributor:operations_read"\)[\s\S]*?setDistributorContext/);
  assert.match(routeSource, /"\/operations\/reconciliation\/runs"[\s\S]*?authorize\("distributor:operations_run"\)[\s\S]*?setDistributorContext/);
  assert.match(routeSource, /"\/operations\/reconciliation\/findings\/:findingId\/acknowledge"[\s\S]*?authorize\("distributor:operations_acknowledge"\)[\s\S]*?setDistributorContext/);
  assert.match(controllerSource, /filters:\s*\{\s*category:\s*req\.query\.category/);
  for (const permission of ["distributor:operations_read", "distributor:operations_run", "distributor:operations_acknowledge"]) {
    assert.ok(seedSource.includes(permission));
  }
});

test("reconciliation history migration prevents distributor deletion cascades", async () => {
  const schemaSource = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migrationSource = await readFile(
    new URL("../prisma/migrations/20261127184000_distributor_reconciliation_findings/migration.sql", import.meta.url),
    "utf8",
  );
  const findingModel = schemaSource.match(/model DistributorReconciliationFinding \{([\s\S]*?)\n\}/)?.[1];

  assert.match(findingModel || "", /onDelete:\s*Restrict/);
  assert.match(findingModel || "", /onUpdate:\s*Restrict/);
  assert.match(migrationSource, /ON DELETE RESTRICT ON UPDATE RESTRICT/);
  assert.match(migrationSource, /DistributorReconciliationFinding_distributorId_state_detecte_idx/);
  assert.match(migrationSource, /DistributorReconciliationFinding_distributorId_category_seve_idx/);
  assert.match(migrationSource, /DistributorReconciliationFinding_distributorId_lastSeenAt_idx/);
  assert.match(migrationSource, /DistributorReconciliationFinding_distributorId_findingKey_oc_key/);
  assert.doesNotMatch(migrationSource, /\bDROP\s+(?:TABLE|COLUMN)\b/i);
});
