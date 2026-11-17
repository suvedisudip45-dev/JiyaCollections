import { createHash } from "node:crypto";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";

const CLOSE_CHECKLIST = [
  { key: "cash_bank", label: "Cash and bank reconciliation" },
  { key: "clearing", label: "Wallet and payment clearing reconciliation" },
  { key: "receivables", label: "Accounts receivable reconciliation" },
  { key: "payables", label: "Accounts payable reconciliation" },
  { key: "inventory_cogs", label: "Inventory and cost of goods sold reconciliation" },
  { key: "vat_tds", label: "VAT and TDS workpaper review" },
  { key: "assets_depreciation", label: "Fixed assets and depreciation review" },
  { key: "payroll", label: "Payroll review", mayBeNotApplicable: true },
  { key: "loans", label: "Loan reconciliation" },
  { key: "accruals_provisions", label: "Accruals and provisions review" },
  { key: "foreign_currency", label: "Foreign currency review", mayBeNotApplicable: true },
  { key: "related_parties", label: "Related-party and intercompany review" },
  { key: "suspense", label: "Suspense-account review" },
  { key: "subsequent_events", label: "Subsequent-events review" },
  { key: "management_review", label: "Management close review" },
];

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const canonicalJsonValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalJsonValue(value[key]);
    return result;
  }, {});
};
const normalizeText = (value, label, maxLength, required = false) => {
  const text = value === undefined || value === null ? "" : String(value).trim();
  if ((required && !text) || text.length > maxLength) {
    throw fail(`${label} is required and must be at most ${maxLength} characters.`, "INVALID_CLOSE_INPUT");
  }
  return text || null;
};

const normalizeRequestKey = (value) => {
  const key = String(value || "").trim();
  if (key.length < 8 || key.length > 191) {
    throw fail("A valid Idempotency-Key of 8 to 191 characters is required.", "IDEMPOTENCY_KEY_REQUIRED");
  }
  return key;
};

const normalizeActor = (actor = {}) => {
  const accountId = String(actor.accountId || "").trim();
  const role = String(actor.role || "").trim().toUpperCase();
  if (!accountId || role !== "ADMIN") {
    throw fail("An authenticated Admin account is required for period close actions.", "ADMIN_ACTOR_REQUIRED", 403);
  }
  return { ...actor, accountId, role };
};

const normalizeChecklist = (input) => {
  if (!Array.isArray(input) || input.length !== CLOSE_CHECKLIST.length) {
    throw fail("The close checklist must include every required checklist item.", "CLOSE_CHECKLIST_INCOMPLETE");
  }
  const submitted = new Map(input.map((item) => [item?.key, item]));
  if (submitted.size !== CLOSE_CHECKLIST.length || CLOSE_CHECKLIST.some(({ key }) => !submitted.has(key))) {
    throw fail("The close checklist contains missing or duplicate items.", "CLOSE_CHECKLIST_INVALID");
  }

  return CLOSE_CHECKLIST.map(({ key, label, mayBeNotApplicable }) => {
    const item = submitted.get(key);
    const status = String(item?.status || "").trim().toUpperCase();
    if (status !== "COMPLETE" && status !== "NOT_APPLICABLE") {
      throw fail(`Resolve the "${label}" checklist item before submitting.`, "CLOSE_CHECKLIST_INCOMPLETE");
    }
    if (status === "NOT_APPLICABLE" && !mayBeNotApplicable) {
      throw fail(`The "${label}" checklist item cannot be marked not applicable.`, "CLOSE_CHECKLIST_INVALID");
    }
    const evidenceReference = normalizeText(item?.evidenceReference, `${label} evidence reference`, 500, status === "COMPLETE");
    const notes = normalizeText(item?.notes, `${label} explanation`, 1000, status === "NOT_APPLICABLE");
    return { key, label, status, evidenceReference, notes };
  });
};

const requirePeriod = async (tx, periodId) => {
  const period = await tx.accountingPeriod.findUnique({
    where: { id: periodId },
    include: { fiscalYear: { select: { id: true, name: true, status: true } } },
  });
  if (!period) throw fail("Accounting period was not found.", "ACCOUNTING_PERIOD_NOT_FOUND", 404);
  return period;
};

const latestEvent = (tx, accountingPeriodId) => tx.accountingPeriodCloseEvent.findFirst({
  where: { accountingPeriodId },
  orderBy: { sequence: "desc" },
});

const requestReplay = async (client, requestKey, payloadHash) => {
  const event = await client.accountingPeriodCloseEvent.findUnique({ where: { requestKey } });
  if (!event) return null;
  if (event.payloadHash !== payloadHash) {
    throw fail("This Idempotency-Key was already used with different close details.", "IDEMPOTENCY_KEY_REUSED", 409);
  }
  return { success: true, isReplay: true, event };
};

const transactRequest = async ({ client, requestKey, payload, actor, action, periodId, operation }) => {
  const payloadHash = stableHash({ action, periodId, actorId: actor.accountId, payload });
  const replay = await requestReplay(client, requestKey, payloadHash);
  if (replay) return replay;

  try {
    return await client.$transaction(async (tx) => {
      const inTransactionReplay = await requestReplay(tx, requestKey, payloadHash);
      if (inTransactionReplay) return inTransactionReplay;
      return operation(tx, { payloadHash, actor, requestKey });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code === "P2002") {
      const concurrentReplay = await requestReplay(client, requestKey, payloadHash);
      if (concurrentReplay) return concurrentReplay;
      throw fail("Another close-control action changed this period. Refresh and retry.", "PERIOD_CLOSE_CONFLICT", 409);
    }
    if (error.code === "P2034") {
      throw fail("Another close-control action changed this period. Refresh and retry.", "PERIOD_CLOSE_CONFLICT", 409);
    }
    throw error;
  }
};

const appendEvent = async (tx, {
  period,
  cycle,
  eventType,
  requestKey,
  payloadHash,
  actor,
  subjectSequence = null,
  checklistSnapshot = null,
  reason = null,
}) => {
  const previous = await tx.accountingPeriodCloseEvent.findFirst({
    where: { accountingPeriodId: period.id },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const sequence = (previous?.sequence || 0) + 1;
  const event = await tx.accountingPeriodCloseEvent.create({
    data: {
      accountingPeriodId: period.id,
      sequence,
      cycle,
      eventType,
      requestKey,
      payloadHash,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      subjectSequence,
      ...(checklistSnapshot ? { checklistSnapshot } : {}),
      ...(reason ? { reason } : {}),
    },
  });
  await recordSystemAudit({
    actorId: actor.accountId,
    actorRole: actor.role,
    portalSource: "ADMIN",
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    correlationId: actor.correlationId,
  }, {
    action: `ACCOUNTING_PERIOD_${eventType}`,
    entityType: "AccountingPeriod",
    entityId: period.id,
    beforeState: { status: period.status, fiscalYearId: period.fiscalYearId },
    afterState: { eventId: event.id, cycle, sequence, eventType, reason, checklistSnapshot },
  }, { client: tx });
  return event;
};

export const getAccountingPeriodCloseChecklist = () => CLOSE_CHECKLIST.map(({ key, label, mayBeNotApplicable = false }) => ({
  key,
  label,
  mayBeNotApplicable,
}));

export const createAccountingPeriodClosePack = async ({
  periodId,
  actor: actorInput,
  client = prisma,
}) => {
  const actor = normalizeActor(actorInput);
  const normalizedPeriodId = String(periodId || "").trim();
  if (!normalizedPeriodId) throw fail("periodId is required.", "ACCOUNTING_PERIOD_REQUIRED");

  return client.$transaction(async (tx) => {
    const period = await requirePeriod(tx, normalizedPeriodId);
    const events = await tx.accountingPeriodCloseEvent.findMany({
      where: { accountingPeriodId: period.id },
      orderBy: { sequence: "asc" },
    });
    const latest = events[events.length - 1];
    const currentCycleEvents = latest
      ? events.filter((event) => event.cycle === latest.cycle)
      : [];
    const currentCycleLatest = currentCycleEvents[currentCycleEvents.length - 1];
    if (
      period.status !== "CLOSED" ||
      !currentCycleLatest ||
      !["CLOSE_APPROVED", "REOPEN_REJECTED"].includes(currentCycleLatest.eventType)
    ) {
      throw fail("A close pack is available only for an approved period that remains closed.", "CLOSE_PACK_NOT_AVAILABLE", 409);
    }

    const approval = [...currentCycleEvents].reverse()
      .find((event) => event.eventType === "CLOSE_APPROVED");
    const submission = approval && currentCycleEvents.find((event) => (
      event.sequence === approval.subjectSequence && event.eventType === "CLOSE_SUBMITTED"
    ));
    if (
      !submission ||
      submission.actorRole !== "ADMIN" ||
      approval.actorRole !== "ADMIN" ||
      submission.actorAccountId === approval.actorAccountId
    ) {
      throw fail("The approved close submission or independent reviewer record is missing.", "CLOSE_PACK_SOURCE_INVALID", 409);
    }

    let checklist;
    try {
      checklist = normalizeChecklist(submission.checklistSnapshot?.items);
    } catch (error) {
      throw fail(`The submitted close checklist cannot be exported: ${error.message}`, "CLOSE_PACK_SOURCE_INVALID", 409);
    }

    const toIso = (value, label) => {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) {
        throw fail(`The ${label} date is invalid; the close pack cannot be generated.`, "CLOSE_PACK_SOURCE_INVALID", 409);
      }
      return date.toISOString();
    };
    const eventHistory = events.map((event) => ({
      eventId: event.id,
      sequence: event.sequence,
      cycle: event.cycle,
      eventType: event.eventType,
      actorAccountId: event.actorAccountId,
      actorRole: event.actorRole,
      subjectSequence: event.subjectSequence ?? null,
      reason: event.reason ?? null,
      payloadHash: event.payloadHash,
      createdAt: toIso(event.createdAt, "close event"),
      checklistSnapshot: canonicalJsonValue(event.checklistSnapshot ?? null),
    }));
    const evidenceRegister = checklist.map((item) => ({
      ...item,
      evidenceStatus: item.status === "NOT_APPLICABLE"
        ? "NOT_APPLICABLE_EXPLANATION_ONLY"
        : "REFERENCE_ONLY_NOT_VALIDATED",
    }));
    const pack = {
      packType: "INTERNAL_MONTHLY_CLOSE_PACK",
      schemaVersion: 1,
      classification: "INTERNAL_WORKPAPER_NOT_AUDITED_OR_STATUTORY",
      period: {
        id: period.id,
        name: period.periodName,
        startDate: toIso(period.startDate, "period start"),
        endDate: toIso(period.endDate, "period end"),
        status: period.status,
        fiscalYear: {
          id: period.fiscalYear.id,
          name: period.fiscalYear.name,
          status: period.fiscalYear.status,
        },
      },
      closeCycle: {
        cycle: approval.cycle,
        submissionSequence: submission.sequence,
        approvalSequence: approval.sequence,
        reviewerAccountId: approval.actorAccountId,
        preparerAccountId: submission.actorAccountId,
      },
      evidenceRegister,
      eventHistory,
      limitations: [
        "Evidence references are not retrieved or independently validated.",
        "This pack does not contain attached evidence files or complete ledger and reconciliation schedules.",
        "This internal workpaper is not an audit report or statutory filing.",
      ],
    };
    const contentHash = stableHash(pack);
    const generatedAt = new Date().toISOString();
    await recordSystemAudit({
      ...actor,
      portalSource: "ADMIN",
    }, {
      action: "ACCOUNTING_PERIOD_CLOSE_PACK_EXPORTED",
      entityType: "AccountingPeriod",
      entityId: period.id,
      afterState: {
        packType: pack.packType,
        schemaVersion: pack.schemaVersion,
        contentHash,
        generatedAt,
        closeCycle: approval.cycle,
      },
    }, { client: tx });

    return {
      success: true,
      pack,
      integrity: { algorithm: "SHA-256", contentHash },
      generatedAt,
    };
  }, { isolationLevel: "Serializable" });
};

export const submitAccountingPeriodClose = async ({
  periodId,
  checklist,
  idempotencyKey,
  actor: actorInput,
  client = prisma,
}) => {
  const actor = normalizeActor(actorInput);
  const normalizedPeriodId = String(periodId || "").trim();
  if (!normalizedPeriodId) throw fail("periodId is required.", "ACCOUNTING_PERIOD_REQUIRED");
  const checklistSnapshot = normalizeChecklist(checklist);
  const requestKey = normalizeRequestKey(idempotencyKey);
  const payload = { checklistSnapshot };

  return transactRequest({
    client,
    requestKey,
    payload,
    actor,
    action: "CLOSE_SUBMITTED",
    periodId: normalizedPeriodId,
    operation: async (tx, context) => {
      const period = await requirePeriod(tx, normalizedPeriodId);
      const latest = await latestEvent(tx, period.id);
      if (period.status !== "OPEN" || period.fiscalYear.status === "CLOSED") {
        throw fail("Only an open accounting period in an open fiscal year can be submitted for close.", "PERIOD_NOT_OPEN", 409);
      }
      if (latest && !["CLOSE_REJECTED", "REOPEN_APPROVED"].includes(latest.eventType)) {
        throw fail("The latest close-control action does not allow another close submission.", "PERIOD_CLOSE_STATE_CONFLICT", 409);
      }
      const cycle = latest ? latest.cycle + 1 : 1;
      const event = await appendEvent(tx, {
        period,
        cycle,
        eventType: "CLOSE_SUBMITTED",
        requestKey,
        payloadHash: context.payloadHash,
        actor,
        checklistSnapshot: { version: 1, items: checklistSnapshot },
      });
      return { success: true, isReplay: false, event };
    },
  });
};

export const reviewAccountingPeriodClose = async ({
  periodId,
  decision,
  reason,
  idempotencyKey,
  actor: actorInput,
  client = prisma,
}) => {
  const actor = normalizeActor(actorInput);
  const normalizedPeriodId = String(periodId || "").trim();
  const normalizedDecision = String(decision || "").trim().toUpperCase();
  if (!normalizedPeriodId || !["APPROVE", "REJECT"].includes(normalizedDecision)) {
    throw fail("periodId and an APPROVE or REJECT decision are required.", "INVALID_CLOSE_REVIEW");
  }
  const reviewReason = normalizeText(reason, "Review reason", 1000, normalizedDecision === "REJECT");
  const requestKey = normalizeRequestKey(idempotencyKey);
  const payload = { decision: normalizedDecision, reason: reviewReason };

  return transactRequest({
    client,
    requestKey,
    payload,
    actor,
    action: `CLOSE_${normalizedDecision}`,
    periodId: normalizedPeriodId,
    operation: async (tx, context) => {
      const period = await requirePeriod(tx, normalizedPeriodId);
      const latest = await latestEvent(tx, period.id);
      if (!latest || latest.eventType !== "CLOSE_SUBMITTED") {
        throw fail("There is no submitted period close awaiting review.", "CLOSE_REVIEW_NOT_PENDING", 409);
      }
      if (actor.accountId === latest.actorAccountId) {
        throw fail("The preparer cannot review their own period close.", "CLOSE_SELF_REVIEW_FORBIDDEN", 403);
      }
      if (period.status !== "OPEN" || period.fiscalYear.status === "CLOSED") {
        throw fail("The period is no longer available for close review.", "PERIOD_CLOSE_STATE_CONFLICT", 409);
      }

      if (normalizedDecision === "APPROVE") {
        const updated = await tx.accountingPeriod.updateMany({
          where: { id: period.id, status: "OPEN" },
          data: { status: "CLOSED" },
        });
        if (updated.count !== 1) throw fail("The period status changed during close approval.", "PERIOD_CLOSE_CONFLICT", 409);
      }

      const event = await appendEvent(tx, {
        period: { ...period, status: normalizedDecision === "APPROVE" ? "CLOSED" : period.status },
        cycle: latest.cycle,
        eventType: normalizedDecision === "APPROVE" ? "CLOSE_APPROVED" : "CLOSE_REJECTED",
        requestKey,
        payloadHash: context.payloadHash,
        actor,
        subjectSequence: latest.sequence,
        reason: reviewReason,
      });
      return { success: true, isReplay: false, event, periodStatus: normalizedDecision === "APPROVE" ? "CLOSED" : "OPEN" };
    },
  });
};

export const requestAccountingPeriodReopen = async ({
  periodId,
  reason,
  idempotencyKey,
  actor: actorInput,
  client = prisma,
}) => {
  const actor = normalizeActor(actorInput);
  const normalizedPeriodId = String(periodId || "").trim();
  if (!normalizedPeriodId) throw fail("periodId is required.", "ACCOUNTING_PERIOD_REQUIRED");
  const reopenReason = normalizeText(reason, "Reopen reason", 1000, true);
  const requestKey = normalizeRequestKey(idempotencyKey);
  const payload = { reason: reopenReason };

  return transactRequest({
    client,
    requestKey,
    payload,
    actor,
    action: "REOPEN_REQUESTED",
    periodId: normalizedPeriodId,
    operation: async (tx, context) => {
      const period = await requirePeriod(tx, normalizedPeriodId);
      const latest = await latestEvent(tx, period.id);
      if (period.status !== "CLOSED" || !latest || !["CLOSE_APPROVED", "REOPEN_REJECTED"].includes(latest.eventType)) {
        throw fail("Only a period closed through the approved close workflow can be submitted for reopening.", "PERIOD_REOPEN_NOT_ALLOWED", 409);
      }
      const event = await appendEvent(tx, {
        period,
        cycle: latest.cycle,
        eventType: "REOPEN_REQUESTED",
        requestKey,
        payloadHash: context.payloadHash,
        actor,
        reason: reopenReason,
      });
      return { success: true, isReplay: false, event };
    },
  });
};

export const reviewAccountingPeriodReopen = async ({
  periodId,
  decision,
  reason,
  idempotencyKey,
  actor: actorInput,
  client = prisma,
}) => {
  const actor = normalizeActor(actorInput);
  const normalizedPeriodId = String(periodId || "").trim();
  const normalizedDecision = String(decision || "").trim().toUpperCase();
  if (!normalizedPeriodId || !["APPROVE", "REJECT"].includes(normalizedDecision)) {
    throw fail("periodId and an APPROVE or REJECT decision are required.", "INVALID_REOPEN_REVIEW");
  }
  const reviewReason = normalizeText(reason, "Review reason", 1000, normalizedDecision === "REJECT");
  const requestKey = normalizeRequestKey(idempotencyKey);
  const payload = { decision: normalizedDecision, reason: reviewReason };

  return transactRequest({
    client,
    requestKey,
    payload,
    actor,
    action: `REOPEN_${normalizedDecision}`,
    periodId: normalizedPeriodId,
    operation: async (tx, context) => {
      const period = await requirePeriod(tx, normalizedPeriodId);
      const latest = await latestEvent(tx, period.id);
      if (!latest || latest.eventType !== "REOPEN_REQUESTED" || period.status !== "CLOSED") {
        throw fail("There is no period reopen request awaiting review.", "REOPEN_REVIEW_NOT_PENDING", 409);
      }
      if (actor.accountId === latest.actorAccountId) {
        throw fail("The reopen requester cannot review their own request.", "REOPEN_SELF_REVIEW_FORBIDDEN", 403);
      }

      if (normalizedDecision === "APPROVE") {
        const updated = await tx.accountingPeriod.updateMany({
          where: { id: period.id, status: "CLOSED" },
          data: { status: "OPEN" },
        });
        if (updated.count !== 1) throw fail("The period status changed during reopen approval.", "PERIOD_CLOSE_CONFLICT", 409);
      }

      const event = await appendEvent(tx, {
        period: { ...period, status: normalizedDecision === "APPROVE" ? "OPEN" : period.status },
        cycle: latest.cycle,
        eventType: normalizedDecision === "APPROVE" ? "REOPEN_APPROVED" : "REOPEN_REJECTED",
        requestKey,
        payloadHash: context.payloadHash,
        actor,
        subjectSequence: latest.sequence,
        reason: reviewReason,
      });
      return { success: true, isReplay: false, event, periodStatus: normalizedDecision === "APPROVE" ? "OPEN" : "CLOSED" };
    },
  });
};
