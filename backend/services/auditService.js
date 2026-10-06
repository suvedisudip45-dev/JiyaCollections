import { randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { logger } from "../utils/logger.js";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(password|token|secret|authorization|credential|cvv|cardnumber|bankaccount)/i;
const MAX_AUDIT_DEPTH = 8;
const MAX_AUDIT_COLLECTION_SIZE = 100;
const MAX_AUDIT_STRING_LENGTH = 4000;
const AUDIT_BATCH_SIZE = 25;
const MAX_ATTEMPTS = 8;
const CLAIM_TIMEOUT_MS = 2 * 60 * 1000;

const safeValue = (value, key = "", depth = 0, seen = new WeakSet()) => {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.slice(0, MAX_AUDIT_STRING_LENGTH);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_AUDIT_DEPTH) return "[TRUNCATED]";
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.slice(0, MAX_AUDIT_COLLECTION_SIZE)
      .map((item) => safeValue(item, "", depth + 1, seen));
    if (value.length > MAX_AUDIT_COLLECTION_SIZE) result.push("[TRUNCATED]");
    seen.delete(value);
    return result;
  }
  const result = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, MAX_AUDIT_COLLECTION_SIZE)) {
    result[childKey] = safeValue(childValue, childKey, depth + 1, seen);
  }
  seen.delete(value);
  return result;
};

const isEqual = (left, right) => {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const buildDiff = (oldValue, newValue, key = "") => {
  if (SENSITIVE_KEY.test(key)) {
    return isEqual(oldValue, newValue)
      ? null
      : { before: oldValue === undefined ? undefined : REDACTED, after: newValue === undefined ? undefined : REDACTED };
  }
  if (isEqual(oldValue, newValue)) return null;

  const bothObjects = oldValue && newValue
    && typeof oldValue === "object" && typeof newValue === "object"
    && !Array.isArray(oldValue) && !Array.isArray(newValue)
    && !(oldValue instanceof Date) && !(newValue instanceof Date);
  if (!bothObjects) {
    return {
      before: oldValue === undefined ? undefined : safeValue(oldValue),
      after: newValue === undefined ? undefined : safeValue(newValue),
    };
  }

  const before = {};
  const after = {};
  for (const childKey of new Set([...Object.keys(oldValue), ...Object.keys(newValue)])) {
    const diff = buildDiff(oldValue[childKey], newValue[childKey], childKey);
    if (!diff) continue;
    if (diff.before !== undefined) before[childKey] = diff.before;
    if (diff.after !== undefined) after[childKey] = diff.after;
  }
  return { before, after };
};

export const diffStates = (oldObj, newObj) => {
  const diff = buildDiff(oldObj ?? {}, newObj ?? {});
  if (!diff) return { beforeState: {}, afterState: {} };
  if (Object.hasOwn(diff, "before") && Object.hasOwn(diff, "after")) {
    return { beforeState: diff.before ?? {}, afterState: diff.after ?? {} };
  }
  return { beforeState: {}, afterState: {} };
};

const normalizeAuditEvent = (actorContext = {}, payload = {}) => {
  const { beforeState, afterState } = diffStates(payload.beforeState, payload.afterState);
  const failureReason = payload.failureReason
    ? String(payload.failureReason).slice(0, 255)
    : null;
  return {
    actorId: actorContext.actorId || actorContext.accountId || null,
    actorRole: actorContext.actorRole || actorContext.role || null,
    action: String(payload.action || "").trim().slice(0, 120),
    entityType: String(payload.entityType || "").trim().slice(0, 80),
    entityId: payload.entityId === null || payload.entityId === undefined
      ? null
      : String(payload.entityId).slice(0, 191),
    beforeState,
    afterState,
    portalSource: actorContext.portalSource || actorContext.portal || null,
    ipAddress: actorContext.ipAddress || null,
    userAgent: actorContext.userAgent ? String(actorContext.userAgent).slice(0, 1000) : null,
    status: payload.status || "SUCCESS",
    failureReason,
    correlationId: actorContext.correlationId || null,
  };
};

export const recordSystemAudit = async (actorContext, payload, { client = prisma } = {}) => {
  const event = normalizeAuditEvent(actorContext, payload);
  if (!event.action || !event.entityType) {
    throw new Error("System audit events require an action and entity type.");
  }
  return client.systemAuditOutbox.create({
    data: { id: randomUUID(), event },
    select: { id: true },
  });
};

const processOutboxEntry = async (id) => {
  const now = new Date();
  const claimed = await prisma.systemAuditOutbox.updateMany({
    where: { id, status: "PENDING", availableAt: { lte: now } },
    data: { status: "PROCESSING", claimedAt: now, attemptCount: { increment: 1 } },
  });
  if (claimed.count !== 1) return;

  const entry = await prisma.systemAuditOutbox.findUnique({ where: { id } });
  if (!entry) return;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.systemAuditLog.upsert({
        where: { outboxId: id },
        create: { ...entry.event, outboxId: id },
        update: {},
      });
      await tx.systemAuditOutbox.update({
        where: { id },
        data: { status: "PROCESSED", processedAt: new Date(), claimedAt: null, lastError: null },
      });
    });
  } catch (error) {
    const exhausted = entry.attemptCount >= MAX_ATTEMPTS;
    const retryDelayMs = Math.min(60_000, 1000 * (2 ** Math.min(entry.attemptCount, 6)));
    await prisma.systemAuditOutbox.update({
      where: { id },
      data: {
        status: exhausted ? "FAILED" : "PENDING",
        availableAt: exhausted ? now : new Date(now.getTime() + retryDelayMs),
        claimedAt: null,
        lastError: String(error.message || error).slice(0, 1000),
      },
    });
    logger.error("System audit outbox event could not be processed.", {
      outboxId: id,
      attempts: entry.attemptCount,
      exhausted,
      error: error.message || error,
    });
  }
};

let workerTimer = null;
let workerRunning = false;

const runOutboxCycle = async () => {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);
    await prisma.systemAuditOutbox.updateMany({
      where: { status: "PROCESSING", claimedAt: { lt: staleBefore } },
      data: { status: "PENDING", claimedAt: null },
    });
    const pending = await prisma.systemAuditOutbox.findMany({
      where: { status: "PENDING", availableAt: { lte: new Date() } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: AUDIT_BATCH_SIZE,
      select: { id: true },
    });
    for (const entry of pending) await processOutboxEntry(entry.id);
  } catch (error) {
    logger.error("System audit outbox polling failed.", { error: error.message || error });
  } finally {
    workerRunning = false;
  }
};

export const startSystemAuditOutboxWorker = (intervalMs = 1000) => {
  if (workerTimer) return;
  workerTimer = setInterval(() => { void runOutboxCycle(); }, Math.max(250, intervalMs));
  workerTimer.unref?.();
  void runOutboxCycle();
};

export const stopSystemAuditOutboxWorker = () => {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
};
