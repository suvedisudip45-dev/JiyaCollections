import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";

const fail = (message, statusCode = 400, code = "DISTRIBUTOR_EXCHANGE_PAYMENT_ERROR") => {
  const error = new Error(message);
  error.status = statusCode;
  error.code = code;
  return error;
};

const parseAmount = (value) => {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d{1,18}(?:\.\d{1,2})?$/.test(String(value).trim())) {
    throw fail("Payment amount must be positive with no more than two decimal places.", 400, "INVALID_EXCHANGE_PAYMENT_AMOUNT");
  }
  const amount = new Prisma.Decimal(String(value).trim());
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw fail("Payment amount must be greater than zero.", 400, "INVALID_EXCHANGE_PAYMENT_AMOUNT");
  }
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

const validatePayment = ({ paymentMethod, externalReference, evidenceUrl, idempotencyKey }) => {
  const method = String(paymentMethod || "").trim().toUpperCase();
  if (!["CASH", "BANK_TRANSFER", "MOBILE_WALLET", "CARD"].includes(method)) {
    throw fail("Select a valid exchange payment method.", 400, "INVALID_EXCHANGE_PAYMENT_METHOD");
  }
  const reference = String(externalReference || "").trim();
  if (reference.length > 191) throw fail("Payment reference must be 191 characters or fewer.", 400, "INVALID_EXCHANGE_PAYMENT_REFERENCE");
  if (method !== "CASH" && !reference) throw fail("A transaction reference is required for non-cash payments.", 400, "EXCHANGE_PAYMENT_REFERENCE_REQUIRED");
  const evidence = String(evidenceUrl || "").trim();
  if (!/^https:\/\//i.test(evidence) || evidence.length > 2000) {
    throw fail("Payment evidence must be a secure HTTPS image URL.", 400, "INVALID_EXCHANGE_PAYMENT_EVIDENCE");
  }
  const key = String(idempotencyKey || "").trim();
  if (!key || key.length > 150) throw fail("A valid payment evidence idempotency key is required.", 400, "INVALID_EXCHANGE_PAYMENT_KEY");
  return { method, reference: reference || null, evidence, key };
};

const eventTypeFor = (difference) => difference.isPositive()
  ? "EXCHANGE_UPGRADE_COLLECTION"
  : "EXCHANGE_DOWNGRADE_REFUND";

const accountingDocumentKey = (requestId, eventType) => (
  eventType === "EXCHANGE_UPGRADE_COLLECTION"
    ? `DISTRIBUTOR_COD_SALE:EXCHANGE-${requestId}`
    : `DISTRIBUTOR_CUSTOMER_REFUND:EXCHANGE-${requestId}`
);

export const submitDistributorExchangePaymentEvidence = async ({
  distributorId,
  requestId,
  amount,
  paymentMethod,
  externalReference,
  evidenceUrl,
  idempotencyKey,
  recordedByAccountId = null,
  client = prisma,
  now = new Date(),
} = {}) => {
  if (!distributorId || !requestId) throw fail("Distributor and exchange IDs are required.");
  const decAmount = parseAmount(amount);
  const payment = validatePayment({ paymentMethod, externalReference, evidenceUrl, idempotencyKey });

  return client.$transaction(async (tx) => {
    const request = await tx.orderExchangeRequest.findFirst({
      where: {
        id: requestId,
        deliveryRoute: "NCM",
        settlementDistributorId: distributorId,
        status: { in: ["APPROVED", "NCM_CREATED", "IN_PROGRESS", "RETURN_PICKUP_COMPLETE", "RETURN_RECEIVED", "INSPECTED", "COMPLETED"] },
      },
    });
    if (!request) throw fail("This NCM exchange is not assigned to the distributor for price settlement.", 404, "EXCHANGE_PAYMENT_NOT_FOUND");
    const difference = new Prisma.Decimal(String(request.priceDifference || 0)).toDecimalPlaces(2);
    if (difference.isZero()) throw fail("This exchange has no price difference to settle.", 409, "EXCHANGE_PAYMENT_NOT_REQUIRED");
    const eventType = eventTypeFor(difference);
    const expectedAmount = difference.abs();
    if (!decAmount.equals(expectedAmount)) {
      throw fail(`Payment must equal the recorded exchange difference of NPR ${expectedAmount.toFixed(2)}.`, 409, "EXCHANGE_PAYMENT_AMOUNT_MISMATCH");
    }

    const replay = await tx.distributorCashEvent.findUnique({ where: { idempotencyKey: payment.key } });
    if (replay) {
      if (
        replay.distributorId !== distributorId ||
        replay.orderExchangeRequestId !== requestId ||
        replay.eventType !== eventType ||
        !new Prisma.Decimal(String(replay.amount)).equals(decAmount) ||
        replay.paymentMethod !== payment.method ||
        replay.externalReference !== payment.reference ||
        replay.evidenceUrl !== payment.evidence
      ) {
        throw fail("This idempotency key was already used for different exchange payment evidence.", 409, "IDEMPOTENCY_KEY_REUSED");
      }
      return { success: true, cashEvent: replay, isReplay: true };
    }

    const existing = await tx.distributorCashEvent.findFirst({
      where: {
        orderExchangeRequestId: requestId,
        eventType,
        status: { in: ["PENDING_VERIFICATION", "VERIFIED", "POSTED"] },
      },
      select: { id: true },
    });
    if (existing) throw fail("Payment evidence is already pending review or has been verified for this exchange.", 409, "EXCHANGE_PAYMENT_ALREADY_SUBMITTED");

    const cashEvent = await tx.distributorCashEvent.create({
      data: {
        distributorId,
        orderExchangeRequestId: requestId,
        eventType,
        amount: decAmount,
        status: "PENDING_VERIFICATION",
        paymentMethod: payment.method,
        externalReference: payment.reference,
        evidenceUrl: payment.evidence,
        idempotencyKey: payment.key,
        occurredAt: now,
        recordedByAccountId,
        notes: eventType === "EXCHANGE_UPGRADE_COLLECTION"
          ? "Distributor-submitted evidence that the customer paid the NCM exchange upgrade difference."
          : "Distributor-submitted evidence that the customer received the NCM exchange downgrade refund.",
      },
    });
    await tx.orderExchangeEvent.create({
      data: {
        exchangeRequestId: requestId,
        eventType: "DISTRIBUTOR_PAYMENT_EVIDENCE_SUBMITTED",
        fromStatus: request.status,
        toStatus: request.status,
        actorId: recordedByAccountId,
        actorRole: "DISTRIBUTOR",
        reason: payment.reference,
        metadata: { cashEventId: cashEvent.id, eventType, amount: decAmount.toFixed(2), paymentMethod: payment.method },
        idempotencyKey: `EXCHANGE:${requestId}:PAYMENT_EVIDENCE:${payment.key}`,
      },
    });
    await recordSystemAudit({
      actorId: recordedByAccountId,
      actorRole: "DISTRIBUTOR",
      portalSource: "DISTRIBUTOR",
    }, {
      action: "DISTRIBUTOR_EXCHANGE_PAYMENT_EVIDENCE_SUBMITTED",
      entityType: "OrderExchangeRequest",
      entityId: requestId,
      afterState: { cashEventId: cashEvent.id, eventType, amount: decAmount.toFixed(2), paymentMethod: payment.method },
    }, { client: tx });
    return { success: true, cashEvent, isReplay: false };
  }, { isolationLevel: "Serializable" });
};

export const reviewDistributorExchangePaymentEvidence = async ({
  requestId,
  cashEventId,
  decision,
  reviewNotes = null,
  reviewerAccountId = null,
  actorContext = {},
  client = prisma,
  now = new Date(),
} = {}) => {
  const normalizedDecision = String(decision || "").trim().toUpperCase();
  if (!requestId || !cashEventId || !["VERIFY", "REJECT"].includes(normalizedDecision)) {
    throw fail("Exchange, payment evidence, and a VERIFY or REJECT decision are required.", 400, "INVALID_EXCHANGE_PAYMENT_REVIEW");
  }
  const notes = String(reviewNotes || "").trim();
  if (notes.length > 2000) throw fail("Review notes must be 2000 characters or fewer.");

  return client.$transaction(async (tx) => {
    const request = await tx.orderExchangeRequest.findFirst({
      where: { id: requestId, deliveryRoute: "NCM" },
    });
    if (!request) throw fail("NCM exchange not found.", 404, "EXCHANGE_NOT_FOUND");
    const event = await tx.distributorCashEvent.findFirst({
      where: {
        id: cashEventId,
        orderExchangeRequestId: requestId,
        distributorId: request.settlementDistributorId,
        eventType: { in: ["EXCHANGE_UPGRADE_COLLECTION", "EXCHANGE_DOWNGRADE_REFUND"] },
      },
    });
    if (!event) throw fail("Exchange payment evidence not found.", 404, "EXCHANGE_PAYMENT_EVIDENCE_NOT_FOUND");
    if (event.status === "VERIFIED" && normalizedDecision === "VERIFY") {
      return { success: true, decision: "VERIFIED", cashEvent: event, isReplay: true };
    }
    if (event.status !== "PENDING_VERIFICATION") {
      throw fail("This exchange payment evidence is no longer awaiting review.", 409, "EXCHANGE_PAYMENT_NOT_PENDING");
    }

    const updated = await tx.distributorCashEvent.updateMany({
      where: { id: event.id, status: "PENDING_VERIFICATION" },
      data: {
        status: normalizedDecision === "VERIFY" ? "VERIFIED" : "REJECTED",
        verifiedByAccountId: reviewerAccountId,
        verifiedAt: now,
        notes,
        ...(normalizedDecision === "VERIFY" ? {
          accountingDocumentId: await (async () => {
            const document = await tx.accountingDocument.findUnique({
              where: { idempotencyKey: accountingDocumentKey(requestId, event.eventType) },
              select: { id: true },
            });
            return document?.id || null;
          })(),
          journalEntryId: request.exchangeJournalEntryId || null,
        } : {}),
      },
    });
    if (updated.count !== 1) throw fail("Exchange payment review changed concurrently.", 409, "EXCHANGE_PAYMENT_REVIEW_CONFLICT");
    await tx.orderExchangeEvent.create({
      data: {
        exchangeRequestId: requestId,
        eventType: normalizedDecision === "VERIFY" ? "DISTRIBUTOR_PAYMENT_EVIDENCE_VERIFIED" : "DISTRIBUTOR_PAYMENT_EVIDENCE_REJECTED",
        fromStatus: request.status,
        toStatus: request.status,
        actorId: reviewerAccountId,
        actorRole: "ADMIN",
        reason: notes,
        metadata: { cashEventId: event.id, paymentEventType: event.eventType, amount: String(event.amount) },
        idempotencyKey: `EXCHANGE:${requestId}:PAYMENT_EVIDENCE:${normalizedDecision}:${event.id}`,
      },
    });
    await recordSystemAudit({
      ...actorContext,
      actorId: reviewerAccountId,
      actorRole: "ADMIN",
      portalSource: "ADMIN",
    }, {
      action: normalizedDecision === "VERIFY"
        ? "DISTRIBUTOR_EXCHANGE_PAYMENT_EVIDENCE_VERIFIED"
        : "DISTRIBUTOR_EXCHANGE_PAYMENT_EVIDENCE_REJECTED",
      entityType: "OrderExchangeRequest",
      entityId: requestId,
      beforeState: { cashEventId: event.id, cashEventStatus: event.status },
      afterState: { cashEventId: event.id, cashEventStatus: normalizedDecision === "VERIFY" ? "VERIFIED" : "REJECTED" },
    }, { client: tx });
    return {
      success: true,
      decision: normalizedDecision === "VERIFY" ? "VERIFIED" : "REJECTED",
      cashEvent: { ...event, status: normalizedDecision === "VERIFY" ? "VERIFIED" : "REJECTED", verifiedAt: now },
      isReplay: false,
    };
  }, { isolationLevel: "Serializable" });
};
