import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { postDistributorCustomerRefundAccounting } from "./accountingPostingEngine.js";
import { recordSystemAudit } from "./auditService.js";

const fail = (message, statusCode = 400, code = "DISTRIBUTOR_RETURN_REFUND_ERROR") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const parseAmount = (value) => {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d{1,18}(?:\.\d{1,2})?$/.test(String(value).trim())) {
    throw fail("Refund amount must be positive with no more than two decimal places.", 400, "INVALID_REFUND_AMOUNT");
  }
  const amount = new Prisma.Decimal(String(value).trim());
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw fail("Refund amount must be greater than zero.", 400, "INVALID_REFUND_AMOUNT");
  }
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

const text = (value, label, maxLength, required = false) => {
  if (typeof value !== "string" && value !== null && value !== undefined) {
    throw fail(`${label} must be text.`, 400, "INVALID_REFUND_INPUT");
  }
  const result = String(value || "").trim();
  if (required && !result) throw fail(`${label} is required.`, 400, "INVALID_REFUND_INPUT");
  if (result.length > maxLength) throw fail(`${label} must be ${maxLength} characters or fewer.`, 400, "INVALID_REFUND_INPUT");
  return result || null;
};

const validatePaymentMethod = (value) => {
  const method = String(value || "").trim().toUpperCase();
  if (!["CASH", "BANK_TRANSFER", "MOBILE_WALLET", "CARD"].includes(method)) {
    throw fail("Select a valid customer refund payment method.", 400, "INVALID_REFUND_PAYMENT_METHOD");
  }
  return method;
};

const addReturnEvent = (tx, { returnId, eventType, fromStatus, toStatus, actorId, actorRole, reason, metadata, idempotencyKey }) =>
  tx.customerReturnEvent.create({
    data: {
      customerReturnId: returnId,
      eventType,
      fromStatus,
      toStatus,
      actorId: actorId || null,
      actorRole,
      reason: reason || null,
      metadata,
      idempotencyKey,
    },
  });

export const submitDistributorCustomerRefund = async ({
  distributorId,
  returnId,
  amount,
  paymentMethod,
  externalReference,
  evidenceUrl,
  idempotencyKey,
  recordedByAccountId = null,
  client = prisma,
  now = new Date(),
} = {}) => {
  if (!distributorId || !returnId) throw fail("Distributor and return IDs are required.");
  const decAmount = parseAmount(amount);
  const method = validatePaymentMethod(paymentMethod);
  const reference = text(externalReference, "Payment reference", 191);
  const evidence = text(evidenceUrl, "Payment evidence URL", 2000, true);
  if (!/^https:\/\//i.test(evidence)) {
    throw fail("Payment evidence must use a secure HTTPS URL.", 400, "INVALID_REFUND_EVIDENCE");
  }
  if (method !== "CASH" && !reference) {
    throw fail("A transaction reference is required for non-cash refunds.", 400, "REFUND_REFERENCE_REQUIRED");
  }
  const key = text(idempotencyKey, "Idempotency key", 150, true);

  try {
    return await client.$transaction(async (tx) => {
      const replay = await tx.distributorCashEvent.findUnique({ where: { idempotencyKey: key } });
      if (replay) {
        if (
          replay.distributorId !== distributorId ||
          replay.customerReturnId !== returnId ||
          !new Prisma.Decimal(String(replay.amount)).equals(decAmount) ||
          replay.paymentMethod !== method ||
          replay.externalReference !== reference ||
          replay.evidenceUrl !== evidence
        ) {
          throw fail("This idempotency key was already used for different refund details.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return { success: true, cashEvent: replay, isReplay: true };
      }

      const pendingEvent = await tx.distributorCashEvent.findFirst({
        where: {
          customerReturnId: returnId,
          eventType: "CUSTOMER_REFUND",
          status: { in: ["PENDING_VERIFICATION", "POSTED"] },
        },
        select: { id: true },
      });
      if (pendingEvent) throw fail("A customer refund is already awaiting Admin review or has been completed.", 409, "REFUND_ALREADY_SUBMITTED");

      const returnRecord = await tx.customerReturn.findFirst({
        where: {
          id: returnId,
          distributorId,
          deliveryRoute: "DISTRIBUTOR",
          lifecycleStatus: "REFUND_PENDING",
          refundStatus: "PENDING",
        },
      });
      if (!returnRecord) {
        throw fail("This distributor return is not approved and inspected for refund.", 409, "RETURN_REFUND_NOT_READY");
      }
      if (!returnRecord.inspectedAt || !returnRecord.approvedAt || !returnRecord.approvedRefundAmount || !returnRecord.refundPolicySnapshot) {
        throw fail("Admin approval, inspection, and a refund-policy snapshot are required.", 409, "RETURN_REFUND_NOT_READY");
      }
      const approvedAmount = new Prisma.Decimal(String(returnRecord.approvedRefundAmount)).toDecimalPlaces(2);
      if (!decAmount.equals(approvedAmount)) {
        throw fail(`Refund must equal the Admin-approved amount of NPR ${approvedAmount.toFixed(2)}.`, 409, "REFUND_AMOUNT_MISMATCH");
      }

      const claimed = await tx.customerReturn.updateMany({
        where: { id: returnId, distributorId, lifecycleStatus: "REFUND_PENDING", refundStatus: "PENDING" },
        data: { lifecycleStatus: "DISTRIBUTOR_REFUND_REVIEW", refundStatus: "PROCESSING" },
      });
      if (claimed.count !== 1) throw fail("Return refund status changed concurrently.", 409, "RETURN_REFUND_CONFLICT");

      const cashEvent = await tx.distributorCashEvent.create({
        data: {
          distributorId,
          customerReturnId: returnId,
          eventType: "CUSTOMER_REFUND",
          amount: decAmount,
          status: "PENDING_VERIFICATION",
          paymentMethod: method,
          externalReference: reference,
          evidenceUrl: evidence,
          idempotencyKey: key,
          occurredAt: now,
          recordedByAccountId,
          notes: "Distributor-submitted proof of customer return refund.",
        },
      });
      await addReturnEvent(tx, {
        returnId,
        eventType: "DISTRIBUTOR_REFUND_SUBMITTED",
        fromStatus: "REFUND_PENDING",
        toStatus: "DISTRIBUTOR_REFUND_REVIEW",
        actorId: recordedByAccountId,
        actorRole: "DISTRIBUTOR",
        reason: reference,
        metadata: { cashEventId: cashEvent.id, amount: decAmount.toFixed(2), paymentMethod: method },
        idempotencyKey: `RETURN:${returnId}:DISTRIBUTOR_REFUND:${key}`,
      });
      await recordSystemAudit({
        actorId: recordedByAccountId,
        actorRole: "DISTRIBUTOR",
        portalSource: "DISTRIBUTOR",
      }, {
        action: "DISTRIBUTOR_CUSTOMER_REFUND_SUBMITTED",
        entityType: "CustomerReturn",
        entityId: returnId,
        afterState: { cashEventId: cashEvent.id, amount: decAmount.toFixed(2), paymentMethod: method },
      }, { client: tx });
      return { success: true, cashEvent, isReplay: false };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2002") {
      const replay = await client.distributorCashEvent.findUnique({ where: { idempotencyKey: key } });
      if (replay) {
        if (
          replay.distributorId !== distributorId ||
          replay.customerReturnId !== returnId ||
          !new Prisma.Decimal(String(replay.amount)).equals(decAmount) ||
          replay.paymentMethod !== method ||
          replay.externalReference !== reference ||
          replay.evidenceUrl !== evidence
        ) {
          throw fail("This idempotency key was already used for different refund details.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return { success: true, cashEvent: replay, isReplay: true };
      }
    }
    if (error?.code === "P2034") {
      throw fail("Another refund update changed this return. Refresh and retry.", 409, "RETURN_REFUND_CONFLICT");
    }
    throw error;
  }
};

export const reviewDistributorCustomerRefund = async ({
  distributorId,
  returnId,
  decision,
  reviewNotes = null,
  reviewerAccountId = null,
  actorContext = {},
  client = prisma,
  now = new Date(),
} = {}) => {
  if (!distributorId || !returnId) throw fail("Distributor and return IDs are required.");
  const normalizedDecision = String(decision || "").trim().toUpperCase();
  if (!["VERIFY", "REJECT"].includes(normalizedDecision)) {
    throw fail("Decision must be VERIFY or REJECT.", 400, "INVALID_REFUND_REVIEW_DECISION");
  }
  const notes = text(reviewNotes, "Review notes", 2000);

  try {
    return await client.$transaction(async (tx) => {
      const returnRecord = await tx.customerReturn.findFirst({
        where: {
          id: returnId,
          distributorId,
          deliveryRoute: "DISTRIBUTOR",
        },
      });
      if (!returnRecord) throw fail("This distributor return was not found.", 404, "RETURN_NOT_FOUND");
      if (normalizedDecision === "VERIFY" && returnRecord.lifecycleStatus === "REFUNDED" && returnRecord.refundStatus === "COMPLETED") {
        const verifiedEvent = await tx.distributorCashEvent.findFirst({
          where: {
            customerReturnId: returnId,
            distributorId,
            eventType: "CUSTOMER_REFUND",
            status: "POSTED",
          },
        });
        if (verifiedEvent) {
          return {
            success: true,
            decision: "VERIFIED",
            accountingDocumentId: verifiedEvent.accountingDocumentId,
            journalEntryId: verifiedEvent.journalEntryId,
            isReplay: true,
          };
        }
      }
      if (returnRecord.lifecycleStatus !== "DISTRIBUTOR_REFUND_REVIEW" || returnRecord.refundStatus !== "PROCESSING") {
        throw fail("This return is not awaiting distributor refund review.", 409, "RETURN_REFUND_NOT_PENDING");
      }
      const event = await tx.distributorCashEvent.findFirst({
        where: {
          customerReturnId: returnId,
          distributorId,
          eventType: "CUSTOMER_REFUND",
          status: "PENDING_VERIFICATION",
        },
      });
      if (!event) throw fail("Refund payment evidence was not found.", 404, "REFUND_EVIDENCE_NOT_FOUND");
      const approvedAmount = new Prisma.Decimal(String(returnRecord.approvedRefundAmount || 0)).toDecimalPlaces(2);
      if (!new Prisma.Decimal(String(event.amount)).equals(approvedAmount)) {
        throw fail("Submitted refund amount does not match the Admin-approved refund.", 409, "REFUND_AMOUNT_MISMATCH");
      }

      if (normalizedDecision === "REJECT") {
        const eventClaim = await tx.distributorCashEvent.updateMany({
          where: { id: event.id, status: "PENDING_VERIFICATION" },
          data: {
            status: "REJECTED",
            verifiedByAccountId: reviewerAccountId,
            verifiedAt: now,
            notes,
          },
        });
        const returnClaim = await tx.customerReturn.updateMany({
          where: { id: returnId, lifecycleStatus: "DISTRIBUTOR_REFUND_REVIEW", refundStatus: "PROCESSING" },
          data: { lifecycleStatus: "REFUND_PENDING", refundStatus: "PENDING" },
        });
        if (eventClaim.count !== 1 || returnClaim.count !== 1) {
          throw fail("Refund review changed concurrently.", 409, "RETURN_REFUND_CONFLICT");
        }
        await addReturnEvent(tx, {
          returnId,
          eventType: "DISTRIBUTOR_REFUND_REJECTED",
          fromStatus: "DISTRIBUTOR_REFUND_REVIEW",
          toStatus: "REFUND_PENDING",
          actorId: reviewerAccountId,
          actorRole: "ADMIN",
          reason: notes,
          metadata: { cashEventId: event.id },
          idempotencyKey: `RETURN:${returnId}:DISTRIBUTOR_REFUND_REJECTED:${event.id}`,
        });
        await recordSystemAudit({
          ...actorContext,
          actorId: reviewerAccountId,
          actorRole: "ADMIN",
          portalSource: "ADMIN",
        }, {
          action: "DISTRIBUTOR_CUSTOMER_REFUND_REJECTED",
          entityType: "CustomerReturn",
          entityId: returnId,
          beforeState: { lifecycleStatus: returnRecord.lifecycleStatus, cashEventStatus: event.status },
          afterState: { lifecycleStatus: "REFUND_PENDING", cashEventStatus: "REJECTED", reviewNotes: notes },
        }, { client: tx });
        return { success: true, decision: "REJECTED", isReplay: false };
      }

      const journal = await postDistributorCustomerRefundAccounting({
        returnRecord: { ...returnRecord, completedAt: now },
        client: tx,
      });
      const document = await tx.accountingDocument.findUnique({
        where: { idempotencyKey: `DISTRIBUTOR_CUSTOMER_REFUND:${returnId}` },
        select: { id: true },
      });
      if (!journal || !document) throw fail("Distributor refund accounting did not create its payable record.", 500, "REFUND_ACCOUNTING_FAILED");

      const eventClaim = await tx.distributorCashEvent.updateMany({
        where: { id: event.id, status: "PENDING_VERIFICATION" },
        data: {
          status: "POSTED",
          verifiedByAccountId: reviewerAccountId,
          verifiedAt: now,
          journalEntryId: journal.id,
          accountingDocumentId: document.id,
          notes,
        },
      });
      const returnClaim = await tx.customerReturn.updateMany({
        where: { id: returnId, lifecycleStatus: "DISTRIBUTOR_REFUND_REVIEW", refundStatus: "PROCESSING" },
        data: { lifecycleStatus: "REFUNDED", refundStatus: "COMPLETED", completedAt: now },
      });
      if (eventClaim.count !== 1 || returnClaim.count !== 1) {
        throw fail("Refund review changed concurrently.", 409, "RETURN_REFUND_CONFLICT");
      }
      await addReturnEvent(tx, {
        returnId,
        eventType: "DISTRIBUTOR_REFUND_VERIFIED",
        fromStatus: "DISTRIBUTOR_REFUND_REVIEW",
        toStatus: "REFUNDED",
        actorId: reviewerAccountId,
        actorRole: "ADMIN",
        reason: notes,
        metadata: {
          cashEventId: event.id,
          accountingDocumentId: document.id,
          journalEntryId: journal.id,
          amount: approvedAmount.toFixed(2),
        },
        idempotencyKey: `RETURN:${returnId}:DISTRIBUTOR_REFUND_VERIFIED`,
      });
      await recordSystemAudit({
        ...actorContext,
        actorId: reviewerAccountId,
        actorRole: "ADMIN",
        portalSource: "ADMIN",
      }, {
        action: "DISTRIBUTOR_CUSTOMER_REFUND_VERIFIED",
        entityType: "CustomerReturn",
        entityId: returnId,
        beforeState: { lifecycleStatus: returnRecord.lifecycleStatus, cashEventStatus: event.status },
        afterState: {
          lifecycleStatus: "REFUNDED",
          refundStatus: "COMPLETED",
          accountingDocumentId: document.id,
          journalEntryId: journal.id,
        },
      }, { client: tx });
      return {
        success: true,
        decision: "VERIFIED",
        accountingDocumentId: document.id,
        journalEntryId: journal.id,
        isReplay: false,
      };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2034") {
      throw fail("Another refund review changed this return. Refresh and retry.", 409, "RETURN_REFUND_CONFLICT");
    }
    throw error;
  }
};
