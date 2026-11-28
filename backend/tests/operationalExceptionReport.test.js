import assert from "node:assert/strict";
import test from "node:test";
import { buildOperationalExceptionReport } from "../services/operationalExceptionReport.js";

const makeClient = ({
  deliveryReconciliationRequired = 0,
  ambiguousNcmAttempts = 0,
  openNcmSettlementVariances = 0,
  accountingStatuses = [],
  oldestAccountingEvent = null,
} = {}) => {
  const calls = {};
  const client = {
    deliveryOrder: {
      count: async (args) => {
        calls.deliveryOrder = args;
        return deliveryReconciliationRequired;
      },
    },
    returnExchangeNcmAttempt: {
      count: async (args) => {
        calls.returnExchangeNcmAttempt = args;
        return ambiguousNcmAttempts;
      },
    },
    ncmSettlementBatch: {
      count: async (args) => {
        calls.ncmSettlementBatch = args;
        return openNcmSettlementVariances;
      },
    },
    accountingEvent: {
      groupBy: async (args) => {
        calls.accountingGroupBy = args;
        return accountingStatuses;
      },
      findFirst: async (args) => {
        calls.oldestAccounting = args;
        return oldestAccountingEvent;
      },
    },
  };
  return { client, calls };
};

test("operational exception report aggregates local NCM and accounting exceptions only", async () => {
  const oldest = new Date("2026-11-08T08:00:00.000Z");
  const { client, calls } = makeClient({
    deliveryReconciliationRequired: 3,
    ambiguousNcmAttempts: 2,
    openNcmSettlementVariances: 1,
    accountingStatuses: [
      { status: "FAILED", _count: { _all: 4 } },
      { status: "BLOCKED", _count: { _all: 1 } },
      { status: "PENDING", _count: { _all: 2 } },
    ],
    oldestAccountingEvent: { createdAt: oldest },
  });

  const report = await buildOperationalExceptionReport({
    client,
    now: new Date("2026-11-08T09:00:00.000Z"),
  });

  assert.equal(report.hasExceptions, true);
  assert.deepEqual(report.locallyTracked, {
    deliveryReconciliationRequired: 3,
    ambiguousNcmAttempts: 2,
    openNcmSettlementVariances: 1,
    accountingByStatus: { FAILED: 4, BLOCKED: 1, PENDING: 2 },
    oldestUnresolvedAccountingEventAt: oldest.toISOString(),
    oldestUnresolvedAccountingAgeSeconds: 3600,
  });
  assert.deepEqual(calls.deliveryOrder.where, { ncmReconciliationRequired: true });
  assert.deepEqual(calls.returnExchangeNcmAttempt.where, { result: { in: ["STARTED", "UNKNOWN"] } });
  assert.deepEqual(calls.ncmSettlementBatch.where, {
    status: { in: ["VARIANCE_OPEN", "VARIANCE_PARTIALLY_RESOLVED"] },
  });
  assert.equal(report.limitations.length, 2);
});

test("normally retrying accounting events are reported without falsely escalating", async () => {
  const { client } = makeClient({
    accountingStatuses: [{ status: "PENDING", _count: { _all: 1 } }],
    oldestAccountingEvent: { createdAt: new Date("2026-11-08T08:59:00.000Z") },
  });

  const report = await buildOperationalExceptionReport({
    client,
    now: new Date("2026-11-08T09:00:00.000Z"),
  });

  assert.equal(report.hasExceptions, false);
  assert.equal(report.locallyTracked.accountingByStatus.PENDING, 1);
  assert.equal(report.locallyTracked.oldestUnresolvedAccountingAgeSeconds, 60);
});
