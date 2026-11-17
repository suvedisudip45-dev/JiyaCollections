import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createAccountingPeriodClosePack,
  getAccountingPeriodCloseChecklist,
  requestAccountingPeriodReopen,
  reviewAccountingPeriodClose,
  reviewAccountingPeriodReopen,
  submitAccountingPeriodClose,
} from "../services/accountingPeriodCloseService.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const createMockClient = () => {
  const state = {
    period: {
      id: "period-1",
      fiscalYearId: "fy-1",
      periodName: "2083-01",
      startDate: new Date("2026-07-17T00:00:00.000Z"),
      endDate: new Date("2026-08-16T23:59:59.999Z"),
      status: "OPEN",
      fiscalYear: { id: "fy-1", name: "2083/2084", status: "OPEN" },
    },
    events: [],
    audits: [],
    failAudit: false,
  };
  const tx = {
    accountingPeriod: {
      findUnique: async ({ where }) => (where.id === state.period.id ? clone(state.period) : null),
      updateMany: async ({ where, data }) => {
        if (where.id !== state.period.id || state.period.status !== where.status) return { count: 0 };
        state.period.status = data.status;
        return { count: 1 };
      },
    },
    accountingPeriodCloseEvent: {
      findUnique: async ({ where }) => clone(state.events.find((event) => event.requestKey === where.requestKey) || null),
      findFirst: async ({ where }) => clone(state.events
        .filter((event) => event.accountingPeriodId === where.accountingPeriodId)
        .sort((left, right) => right.sequence - left.sequence)[0] || null),
      findMany: async ({ where }) => clone(state.events
        .filter((event) => event.accountingPeriodId === where.accountingPeriodId)
        .sort((left, right) => left.sequence - right.sequence)),
      create: async ({ data }) => {
        if (state.events.some((event) => event.requestKey === data.requestKey)) {
          throw Object.assign(new Error("Unique request key"), { code: "P2002" });
        }
        const event = { id: `event-${data.sequence}`, createdAt: new Date(), ...clone(data) };
        state.events.push(event);
        return clone(event);
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        if (state.failAudit) throw new Error("Audit outbox unavailable");
        state.audits.push(clone(data));
        return { id: data.id };
      },
    },
  };
  const client = {
    ...tx,
    $transaction: async (operation) => {
      const before = clone(state);
      try {
        return await operation(tx);
      } catch (error) {
        state.period = before.period;
        state.events = before.events;
        state.audits = before.audits;
        throw error;
      }
    },
  };
  return { client, state };
};

const makeChecklist = () => getAccountingPeriodCloseChecklist().map((item) => ({
  key: item.key,
  status: "COMPLETE",
  evidenceReference: `evidence:${item.key}`,
  notes: "",
}));

const actor = (accountId) => ({ accountId, role: "ADMIN" });

test("period close requires complete evidenced checklist items and records a replay-safe snapshot", async () => {
  const { client, state } = createMockClient();
  const incomplete = makeChecklist();
  incomplete[0].evidenceReference = "";

  await assert.rejects(() => submitAccountingPeriodClose({
    periodId: "period-1",
    checklist: incomplete,
    idempotencyKey: "close-submit-0001",
    actor: actor("preparer"),
    client,
  }), { code: "INVALID_CLOSE_INPUT" });
  assert.equal(state.events.length, 0);

  const input = {
    periodId: "period-1",
    checklist: makeChecklist(),
    idempotencyKey: "close-submit-0001",
    actor: actor("preparer"),
    client,
  };
  const submitted = await submitAccountingPeriodClose(input);
  const replay = await submitAccountingPeriodClose(input);

  assert.equal(submitted.event.eventType, "CLOSE_SUBMITTED");
  assert.equal(submitted.event.checklistSnapshot.items.length, getAccountingPeriodCloseChecklist().length);
  assert.equal(replay.isReplay, true);
  await assert.rejects(() => submitAccountingPeriodClose({
    ...input,
    checklist: makeChecklist().map((item, index) => (
      index === 0 ? { ...item, evidenceReference: "changed-reference" } : item
    )),
  }), { code: "IDEMPOTENCY_KEY_REUSED" });
  assert.equal(state.events.length, 1);
  assert.equal(state.audits.length, 1);
});

test("period close approval requires a different actor and locks the period", async () => {
  const { client, state } = createMockClient();
  await submitAccountingPeriodClose({
    periodId: "period-1",
    checklist: makeChecklist(),
    idempotencyKey: "close-submit-0002",
    actor: actor("preparer"),
    client,
  });

  await assert.rejects(() => reviewAccountingPeriodClose({
    periodId: "period-1",
    decision: "APPROVE",
    idempotencyKey: "close-review-same",
    actor: actor("preparer"),
    client,
  }), { code: "CLOSE_SELF_REVIEW_FORBIDDEN" });
  assert.equal(state.period.status, "OPEN");
  assert.equal(state.events.length, 1);

  const approved = await reviewAccountingPeriodClose({
    periodId: "period-1",
    decision: "APPROVE",
    idempotencyKey: "close-review-0002",
    actor: actor("reviewer"),
    client,
  });
  assert.equal(approved.event.eventType, "CLOSE_APPROVED");
  assert.equal(state.period.status, "CLOSED");
  assert.equal(state.events[1].subjectSequence, state.events[0].sequence);
});

test("close pack requires an approved closed period and exports a reproducible evidence hash", async () => {
  const { client, state } = createMockClient();
  await assert.rejects(() => createAccountingPeriodClosePack({
    periodId: "period-1",
    actor: actor("exporter"),
    client,
  }), { code: "CLOSE_PACK_NOT_AVAILABLE" });

  await submitAccountingPeriodClose({
    periodId: "period-1",
    checklist: makeChecklist(),
    idempotencyKey: "close-pack-submit-0001",
    actor: actor("preparer"),
    client,
  });
  await reviewAccountingPeriodClose({
    periodId: "period-1",
    decision: "APPROVE",
    idempotencyKey: "close-pack-review-0001",
    actor: actor("reviewer"),
    client,
  });

  const first = await createAccountingPeriodClosePack({
    periodId: "period-1",
    actor: actor("exporter"),
    client,
  });
  const submittedSnapshot = state.events[0].checklistSnapshot;
  state.events[0].checklistSnapshot = {
    items: submittedSnapshot.items.map((item) => ({
      notes: item.notes,
      evidenceReference: item.evidenceReference,
      status: item.status,
      label: item.label,
      key: item.key,
    })),
    version: submittedSnapshot.version,
  };
  const second = await createAccountingPeriodClosePack({
    periodId: "period-1",
    actor: actor("exporter"),
    client,
  });

  assert.equal(first.integrity.algorithm, "SHA-256");
  assert.equal(
    first.integrity.contentHash,
    createHash("sha256").update(JSON.stringify(first.pack)).digest("hex"),
  );
  assert.equal(first.integrity.contentHash, second.integrity.contentHash);
  assert.equal(first.pack.closeCycle.preparerAccountId, "preparer");
  assert.equal(first.pack.closeCycle.reviewerAccountId, "reviewer");
  assert.equal(first.pack.evidenceRegister[0].evidenceStatus, "REFERENCE_ONLY_NOT_VALIDATED");
  assert.equal(first.pack.classification, "INTERNAL_WORKPAPER_NOT_AUDITED_OR_STATUTORY");
  assert.equal(state.audits.length, 4);
  assert.equal(
    state.audits[3].event.afterState.contentHash,
    first.integrity.contentHash,
  );
});

test("close pack export is blocked while reopening is pending", async () => {
  const { client } = createMockClient();
  await submitAccountingPeriodClose({
    periodId: "period-1",
    checklist: makeChecklist(),
    idempotencyKey: "close-pack-submit-0002",
    actor: actor("preparer"),
    client,
  });
  await reviewAccountingPeriodClose({
    periodId: "period-1",
    decision: "APPROVE",
    idempotencyKey: "close-pack-review-0002",
    actor: actor("reviewer"),
    client,
  });
  await requestAccountingPeriodReopen({
    periodId: "period-1",
    reason: "Reopen for a documented adjustment.",
    idempotencyKey: "close-pack-reopen-0002",
    actor: actor("requester"),
    client,
  });

  await assert.rejects(() => createAccountingPeriodClosePack({
    periodId: "period-1",
    actor: actor("exporter"),
    client,
  }), { code: "CLOSE_PACK_NOT_AVAILABLE" });
});

test("period reopen requires a reason, independent review, and preserves each action", async () => {
  const { client, state } = createMockClient();
  await submitAccountingPeriodClose({
    periodId: "period-1",
    checklist: makeChecklist(),
    idempotencyKey: "close-submit-0003",
    actor: actor("preparer"),
    client,
  });
  await reviewAccountingPeriodClose({
    periodId: "period-1",
    decision: "APPROVE",
    idempotencyKey: "close-review-0003",
    actor: actor("reviewer"),
    client,
  });

  await assert.rejects(() => requestAccountingPeriodReopen({
    periodId: "period-1",
    reason: "",
    idempotencyKey: "reopen-request-empty",
    actor: actor("preparer"),
    client,
  }), { code: "INVALID_CLOSE_INPUT" });

  await requestAccountingPeriodReopen({
    periodId: "period-1",
    reason: "Correct a documented posting error.",
    idempotencyKey: "reopen-request-0003",
    actor: actor("preparer"),
    client,
  });
  await assert.rejects(() => reviewAccountingPeriodReopen({
    periodId: "period-1",
    decision: "APPROVE",
    idempotencyKey: "reopen-review-same",
    actor: actor("preparer"),
    client,
  }), { code: "REOPEN_SELF_REVIEW_FORBIDDEN" });
  assert.equal(state.period.status, "CLOSED");

  const reopened = await reviewAccountingPeriodReopen({
    periodId: "period-1",
    decision: "APPROVE",
    idempotencyKey: "reopen-review-0003",
    actor: actor("second-reviewer"),
    client,
  });
  assert.equal(reopened.event.eventType, "REOPEN_APPROVED");
  assert.equal(state.period.status, "OPEN");
  assert.equal(state.events.length, 4);
});

test("rejected close can be resubmitted only as a new immutable cycle", async () => {
  const { client, state } = createMockClient();
  await submitAccountingPeriodClose({
    periodId: "period-1",
    checklist: makeChecklist(),
    idempotencyKey: "close-submit-cycle-1",
    actor: actor("preparer"),
    client,
  });
  await reviewAccountingPeriodClose({
    periodId: "period-1",
    decision: "REJECT",
    reason: "Provide the bank statement reference.",
    idempotencyKey: "close-reject-cycle-1",
    actor: actor("reviewer"),
    client,
  });
  const resubmitted = await submitAccountingPeriodClose({
    periodId: "period-1",
    checklist: makeChecklist(),
    idempotencyKey: "close-submit-cycle-2",
    actor: actor("preparer"),
    client,
  });

  assert.equal(resubmitted.event.cycle, 2);
  assert.deepEqual(state.events.map((event) => event.eventType), ["CLOSE_SUBMITTED", "CLOSE_REJECTED", "CLOSE_SUBMITTED"]);
});

test("close approval and audit evidence roll back together when audit persistence fails", async () => {
  const { client, state } = createMockClient();
  await submitAccountingPeriodClose({
    periodId: "period-1",
    checklist: makeChecklist(),
    idempotencyKey: "close-submit-audit-failure",
    actor: actor("preparer"),
    client,
  });
  state.failAudit = true;

  await assert.rejects(() => reviewAccountingPeriodClose({
    periodId: "period-1",
    decision: "APPROVE",
    idempotencyKey: "close-review-audit-failure",
    actor: actor("reviewer"),
    client,
  }), /Audit outbox unavailable/);

  assert.equal(state.period.status, "OPEN");
  assert.equal(state.events.length, 1);
  assert.equal(state.audits.length, 1);
});
