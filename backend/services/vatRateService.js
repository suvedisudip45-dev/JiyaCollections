import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";

const fail = (message, statusCode = 400, code = "VAT_RATE_ERROR") =>
  Object.assign(new Error(message), { statusCode, code });
const inSerializableTransaction = (client, callback) =>
  typeof client.$transaction === "function"
    ? client.$transaction(callback, { isolationLevel: "Serializable" })
    : callback(client);

const parseRate = (value) => {
  const text = String(value ?? "").trim();
  if (!/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(text)) {
    throw fail("VAT rate must be a non-negative percentage with at most two decimal places.", 400, "INVALID_VAT_RATE");
  }
  const rate = new Prisma.Decimal(text);
  if (!rate.isFinite() || rate.isNegative() || rate.greaterThan(100)) {
    throw fail("VAT rate must be between 0 and 100 percent.", 400, "INVALID_VAT_RATE");
  }
  return rate;
};

const parseEffectiveFrom = (value, now) => {
  const effectiveFrom = new Date(value);
  if (!value || Number.isNaN(effectiveFrom.getTime()) || effectiveFrom <= now) {
    throw fail("A VAT rate can only be scheduled for a valid future effective date.", 400, "INVALID_VAT_EFFECTIVE_DATE");
  }
  return effectiveFrom;
};

export const listVatRateVersions = async ({ client = prisma } = {}) =>
  client.vatRateVersion.findMany({
    orderBy: { effectiveFrom: "desc" },
    take: 100,
  });

export const createVatRateVersion = async ({
  vatRate,
  effectiveFrom,
  createdBy = null,
  client = prisma,
  now = new Date(),
  afterCreate = null,
} = {}) => {
  const rate = parseRate(vatRate);
  const startsAt = parseEffectiveFrom(effectiveFrom, now);
  try {
    return await inSerializableTransaction(client, async (tx) => {
      const latest = await tx.vatRateVersion.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { effectiveFrom: "desc" },
      });
      if (latest && startsAt <= latest.effectiveFrom) {
        throw fail("New VAT versions must be scheduled after the latest active version.", 409, "VAT_RATE_VERSION_ORDER_CONFLICT");
      }

      if (latest && !latest.effectiveUntil) {
        const closed = await tx.vatRateVersion.updateMany({
          where: { id: latest.id, status: "ACTIVE", effectiveUntil: null },
          data: { effectiveUntil: startsAt },
        });
        if (closed.count !== 1) {
          throw fail("The active VAT rate changed concurrently. Refresh and retry.", 409, "VAT_RATE_CONCURRENCY_CONFLICT");
        }
      }

      const version = await tx.vatRateVersion.create({
        data: {
          id: randomUUID(),
          vatRate: rate,
          effectiveFrom: startsAt,
          createdBy: createdBy ? String(createdBy).slice(0, 191) : null,
          status: "ACTIVE",
        },
      });
      if (afterCreate) await afterCreate(version, tx);
      return version;
    });
  } catch (error) {
    if (error?.code === "P2002" || error?.code === "P2034") {
      throw fail("Another VAT rate version was created concurrently. Refresh and retry.", 409, "VAT_RATE_CONCURRENCY_CONFLICT");
    }
    throw error;
  }
};

export const cancelFutureVatRateVersion = async ({
  id,
  client = prisma,
  now = new Date(),
  afterCancel = null,
} = {}) => {
  if (typeof id !== "string" || !id.trim()) {
    throw fail("A VAT rate version ID is required.", 400, "VAT_RATE_VERSION_REQUIRED");
  }
  return inSerializableTransaction(client, async (tx) => {
    const version = await tx.vatRateVersion.findUnique({ where: { id: id.trim() } });
    if (!version || version.status !== "ACTIVE") {
      throw fail("Active VAT rate version not found.", 404, "VAT_RATE_VERSION_NOT_FOUND");
    }
    if (version.effectiveFrom <= now) {
      throw fail("An effective or historical VAT rate cannot be cancelled; schedule a future version instead.", 409, "VAT_RATE_VERSION_IMMUTABLE");
    }
    const latest = await tx.vatRateVersion.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { effectiveFrom: "desc" },
    });
    if (latest?.id !== version.id) {
      throw fail("Only the latest scheduled VAT rate can be cancelled.", 409, "VAT_RATE_VERSION_ORDER_CONFLICT");
    }
    const cancelled = await tx.vatRateVersion.updateMany({
      where: { id: version.id, status: "ACTIVE", effectiveFrom: { gt: now } },
      data: { status: "CANCELLED" },
    });
    if (cancelled.count !== 1) {
      throw fail("The VAT rate changed concurrently. Refresh and retry.", 409, "VAT_RATE_CONCURRENCY_CONFLICT");
    }
    const previous = await tx.vatRateVersion.findFirst({
      where: { status: "ACTIVE", effectiveFrom: { lt: version.effectiveFrom } },
      orderBy: { effectiveFrom: "desc" },
    });
    if (previous) {
      await tx.vatRateVersion.updateMany({
        where: { id: previous.id, status: "ACTIVE", effectiveUntil: version.effectiveFrom },
        data: { effectiveUntil: null },
      });
    }
    const result = { ...version, status: "CANCELLED" };
    if (afterCancel) await afterCancel(result, tx);
    return result;
  });
};

const normalizeTransactionDate = (value) => {
  if (typeof value === "bigint") return new Date(Number(value));
  if (typeof value === "number") return new Date(value);
  if (value instanceof Date) return value;
  if (value === null || value === undefined || value === "") return new Date();
  return new Date(value);
};

export const resolveVatRatePercent = async (transactionDate, { client = prisma } = {}) => {
  const effectiveAt = normalizeTransactionDate(transactionDate);
  if (Number.isNaN(effectiveAt.getTime())) {
    throw fail("Transaction date is invalid for VAT rate resolution.", 409, "INVALID_VAT_TRANSACTION_DATE");
  }
  const version = await client.vatRateVersion.findFirst({
    where: {
      status: "ACTIVE",
      effectiveFrom: { lte: effectiveAt },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: effectiveAt } }],
    },
    orderBy: { effectiveFrom: "desc" },
    select: { vatRate: true },
  });
  const configuredRate = version?.vatRate ?? (
    await client.taxConfiguration.findUnique({
      where: { id: "default" },
      select: { vatRate: true },
    })
  )?.vatRate ?? 13;
  return parseRate(configuredRate);
};
