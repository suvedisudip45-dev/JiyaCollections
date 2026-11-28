import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";
import { formatCollectionAmount } from "./distributorDeliveryOtpService.js";
import { getDistributorCashPosition } from "./distributorCashSettlementService.js";

const fail = (message, code = "DELIVERY_CASH_HANDOVER_ERROR", statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

const clean = (value, limit = 191) => {
  const text = String(value ?? "").trim();
  if (text.length > limit) throw fail(`Value cannot exceed ${limit} characters.`);
  return text;
};

const amount = (value, label, { allowZero = false } = {}) => {
  let parsed;
  try {
    parsed = new Prisma.Decimal(String(value)).toDecimalPlaces(2);
  } catch {
    throw fail(`${label} must be a valid amount.`, "INVALID_DELIVERY_CASH_AMOUNT");
  }
  if (!parsed.isFinite() || (allowZero ? parsed.isNegative() : !parsed.gt(0))) {
    throw fail(`${label} must be ${allowZero ? "non-negative" : "greater than zero"}.`, "INVALID_DELIVERY_CASH_AMOUNT");
  }
  return parsed;
};

const sum = (values) => values.reduce(
  (total, value) => total.plus(new Prisma.Decimal(String(value || 0))),
  new Prisma.Decimal(0),
);

const serializable = async (client, operation) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
};

const toHandover = (handover) => ({
  ...handover,
  expectedAmount: String(handover.expectedAmount),
  submittedAmount: String(handover.submittedAmount),
  confirmedAmount: handover.confirmedAmount == null ? null : String(handover.confirmedAmount),
  discrepancyAmount: handover.discrepancyAmount == null ? null : String(handover.discrepancyAmount),
  allocations: (handover.allocations || []).map((allocation) => ({
    ...allocation,
    expectedAmount: String(allocation.expectedAmount),
    confirmedAmount: allocation.confirmedAmount == null ? null : String(allocation.confirmedAmount),
  })),
});

export const listDriverCashCollections = async ({
  distributorId,
  driverId,
  client = prisma,
} = {}) => {
  if (!distributorId || !driverId) throw fail("Driver and distributor context are required.", "DRIVER_CONTEXT_REQUIRED", 403);
  const events = await client.distributorCashEvent.findMany({
    where: {
      distributorId,
      deliveryDriverId: driverId,
      eventType: "CUSTOMER_COLLECTION",
      status: { in: ["PENDING_VERIFICATION", "VERIFIED", "POSTED"] },
    },
    include: {
      order: { select: { orderReference: true, paymentMethod: true, payment: true } },
      deliveryManifestStop: { select: { id: true, stopSequence: true, manifestId: true } },
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
  });
  if (!events.length) return [];

  const allocations = await client.deliveryCashHandoverAllocation.findMany({
    where: {
      collectionEventId: { in: events.map((event) => event.id) },
      handover: { status: "VERIFIED" },
    },
    select: { collectionEventId: true, confirmedAmount: true },
  });
  const confirmedByEvent = new Map();
  for (const allocation of allocations) {
    const previous = confirmedByEvent.get(allocation.collectionEventId) || new Prisma.Decimal(0);
    confirmedByEvent.set(
      allocation.collectionEventId,
      previous.plus(new Prisma.Decimal(String(allocation.confirmedAmount || 0))),
    );
  }

  return events.map((event) => {
    const collected = new Prisma.Decimal(String(event.amount));
    const handedOver = confirmedByEvent.get(event.id) || new Prisma.Decimal(0);
    return {
      id: event.id,
      orderId: event.orderId,
      orderReference: event.order?.orderReference || null,
      deliveryManifestStopId: event.deliveryManifestStopId,
      deliveryManifestId: event.deliveryManifestStop?.manifestId || null,
      stopSequence: event.deliveryManifestStop?.stopSequence || null,
      expectedAmount: String(event.expectedAmount ?? event.amount),
      actualCollectedAmount: collected.toFixed(2),
      handedOverAmount: handedOver.toFixed(2),
      outstandingAmount: Prisma.Decimal.max(collected.minus(handedOver), 0).toFixed(2),
      collectionStatus: event.status,
      verificationStatus: ["VERIFIED", "POSTED"].includes(event.status) ? "VERIFIED" : "PENDING_VERIFICATION",
      paymentMethod: event.paymentMethod,
      collectorId: event.deliveryDriverId,
      collectedAt: event.occurredAt,
      evidence: {
        stopId: event.deliveryManifestStopId,
        verifiedAt: event.verifiedAt,
        reference: event.externalReference,
      },
    };
  });
};

export const submitDriverCashHandover = async ({
  distributorId,
  driverId,
  actorAccountId,
  collectionEventIds,
  submittedAmount,
  idempotencyKey,
  evidenceReference,
  client = prisma,
} = {}) => {
  if (!distributorId || !driverId || !actorAccountId) {
    throw fail("Authenticated driver and distributor context is required.", "DRIVER_CONTEXT_REQUIRED", 403);
  }
  const key = clean(idempotencyKey, 191);
  const evidence = clean(evidenceReference, 1000);
  const submitted = amount(submittedAmount, "Submitted cash");
  const eventIds = [...new Set(
    Array.isArray(collectionEventIds)
      ? collectionEventIds.map((id) => clean(id, 191)).filter(Boolean)
      : [],
  )];
  if (!key || !evidence || !eventIds.length || eventIds.length > 100) {
    throw fail("Handover idempotency, evidence reference, and one to 100 collection IDs are required.");
  }

  try {
    return await serializable(client, async (tx) => {
      const replay = await tx.deliveryCashHandover.findUnique({
        where: { idempotencyKey: key },
        include: { allocations: true },
      });
      if (replay) {
        const replayIds = replay.allocations.map((item) => item.collectionEventId).sort();
        if (
          replay.driverId !== driverId ||
          replay.distributorId !== distributorId ||
          replay.submittedAmount.toString() !== submitted.toString() ||
          replayIds.join("|") !== [...eventIds].sort().join("|")
        ) {
          throw fail("Handover idempotency key was reused with conflicting details.", "HANDOVER_IDEMPOTENCY_CONFLICT", 409);
        }
        return { ...toHandover(replay), _replayed: true };
      }

      const events = await tx.distributorCashEvent.findMany({
        where: {
          id: { in: eventIds },
          distributorId,
          deliveryDriverId: driverId,
          eventType: "CUSTOMER_COLLECTION",
          status: { in: ["PENDING_VERIFICATION", "VERIFIED", "POSTED"] },
        },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      });
      if (events.length !== eventIds.length) {
        throw fail("One or more collections do not belong to this driver and distributor.", "COLLECTION_SCOPE_MISMATCH", 403);
      }

      const allocated = await tx.deliveryCashHandoverAllocation.findMany({
        where: {
          collectionEventId: { in: eventIds },
          handover: { status: { in: ["PENDING_VERIFICATION", "VERIFIED"] } },
        },
        include: { handover: { select: { status: true } } },
      });
      const reservedByEvent = new Map();
      for (const allocation of allocated) {
        const value = allocation.handover.status === "VERIFIED"
          ? allocation.confirmedAmount || 0
          : allocation.expectedAmount;
        const previous = reservedByEvent.get(allocation.collectionEventId) || new Prisma.Decimal(0);
        reservedByEvent.set(
          allocation.collectionEventId,
          previous.plus(new Prisma.Decimal(String(value))),
        );
      }
      const lines = events.map((event) => {
        const remaining = new Prisma.Decimal(String(event.amount))
          .minus(reservedByEvent.get(event.id) || new Prisma.Decimal(0));
        if (!remaining.gt(0)) {
          throw fail("A selected collection has no cash remaining to hand over.", "COLLECTION_ALREADY_HANDED_OVER", 409);
        }
        return { collectionEventId: event.id, expectedAmount: remaining };
      });
      const expected = sum(lines.map((line) => line.expectedAmount));
      const handover = await tx.deliveryCashHandover.create({
        data: {
          distributorId,
          driverId,
          expectedAmount: expected,
          submittedAmount: submitted,
          idempotencyKey: key,
          evidenceReference: evidence,
          submittedByAccountId: actorAccountId,
          allocations: { create: lines },
        },
        include: { allocations: true },
      });
      await recordSystemAudit(
        { actorId: actorAccountId, actorRole: "DRIVER", portalSource: "DRIVER" },
        {
          action: "DRIVER_COD_CASH_HANDOVER_SUBMITTED",
          entityType: "DeliveryCashHandover",
          entityId: handover.id,
          afterState: {
            expectedAmount: expected.toFixed(2),
            submittedAmount: submitted.toFixed(2),
            collectionEventIds: eventIds,
          },
        },
        { client: tx },
      );
      return toHandover(handover);
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw fail("This cash handover is already being processed. Refresh before retrying.", "HANDOVER_IDEMPOTENCY_CONFLICT", 409);
    }
    throw error;
  }
};

export const createDriverCashHandoverCorrection = async ({
  distributorId,
  handoverId,
  actorAccountId,
  direction,
  correctionAmount,
  idempotencyKey,
  evidenceReference,
  reason,
  client = prisma,
} = {}) => {
  if (!distributorId || !actorAccountId) throw fail("Distributor operator context is required.", "DISTRIBUTOR_CONTEXT_REQUIRED", 403);
  const normalizedDirection = clean(direction, 16).toUpperCase();
  if (!["INCREASE", "DECREASE"].includes(normalizedDirection)) {
    throw fail("Correction direction must be INCREASE or DECREASE.");
  }
  const amountValue = amount(correctionAmount, "Correction amount");
  const key = clean(idempotencyKey, 191);
  const evidence = clean(evidenceReference, 1000);
  const correctionReason = clean(reason, 2000);
  if (!key || !evidence || !correctionReason) {
    throw fail("Correction idempotency, evidence reference, and reason are required.");
  }
  return serializable(client, async (tx) => {
    const original = await tx.deliveryCashHandover.findFirst({
      where: { id: handoverId, distributorId, status: "VERIFIED", correctionOfId: null },
      select: { id: true, driverId: true },
    });
    if (!original) throw fail("Verified cash handover not found in this distributor.", "HANDOVER_NOT_FOUND", 404);
    const replay = await tx.deliveryCashHandover.findUnique({ where: { idempotencyKey: key } });
    if (replay) {
      if (
        replay.correctionOfId !== original.id ||
        replay.correctionDirection !== normalizedDirection ||
        replay.submittedAmount.toString() !== amountValue.toString() ||
        replay.reason !== correctionReason
      ) {
        throw fail("Correction idempotency key was reused with conflicting details.", "HANDOVER_IDEMPOTENCY_CONFLICT", 409);
      }
      return { ...toHandover(replay), _replayed: true };
    }
    const correction = await tx.deliveryCashHandover.create({
      data: {
        distributorId,
        driverId: original.driverId,
        correctionOfId: original.id,
        correctionDirection: normalizedDirection,
        expectedAmount: 0,
        submittedAmount: amountValue,
        status: "PENDING_VERIFICATION",
        idempotencyKey: key,
        evidenceReference: evidence,
        reason: correctionReason,
        submittedByAccountId: actorAccountId,
      },
    });
    await recordSystemAudit(
      { actorId: actorAccountId, actorRole: "DISTRIBUTOR", portalSource: "DISTRIBUTOR" },
      {
        action: "DRIVER_COD_HANDOVER_CORRECTION_SUBMITTED",
        entityType: "DeliveryCashHandover",
        entityId: correction.id,
        afterState: {
          correctionOfId: original.id,
          direction: normalizedDirection,
          amount: amountValue.toFixed(2),
          reason: correctionReason,
        },
      },
      { client: tx },
    );
    return toHandover(correction);
  });
};

export const verifyDriverCashHandover = async ({
  distributorId,
  handoverId,
  actorAccountId,
  confirmedAmount,
  reviewNotes,
  client = prisma,
} = {}) => {
  if (!distributorId || !actorAccountId) throw fail("Distributor operator context is required.", "DISTRIBUTOR_CONTEXT_REQUIRED", 403);
  const confirmed = amount(confirmedAmount, "Confirmed cash", { allowZero: true });
  const notes = clean(reviewNotes, 2000) || null;
  return serializable(client, async (tx) => {
    const handover = await tx.deliveryCashHandover.findFirst({
      where: { id: handoverId, distributorId },
      include: { allocations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!handover) throw fail("Cash handover not found in this distributor.", "HANDOVER_NOT_FOUND", 404);
    if (handover.status === "VERIFIED") {
      if (handover.confirmedAmount?.toString() === confirmed.toString()) {
        return { ...toHandover(handover), _replayed: true };
      }
      throw fail("A verified handover is immutable; record a separate correction.", "HANDOVER_IMMUTABLE", 409);
    }
    if (handover.status !== "PENDING_VERIFICATION") {
      throw fail("Only a pending handover can be verified.", "HANDOVER_STATE_CONFLICT", 409);
    }
    if (handover.correctionOfId && handover.allocations.length) {
      throw fail("A handover correction cannot allocate collection events.", "HANDOVER_CORRECTION_INVALID", 409);
    }

    const claimed = await tx.deliveryCashHandover.updateMany({
      where: { id: handover.id, distributorId, status: "PENDING_VERIFICATION" },
      data: {
        status: "VERIFIED",
        confirmedAmount: confirmed,
        discrepancyAmount: confirmed.minus(new Prisma.Decimal(String(handover.expectedAmount))),
        verifiedByAccountId: actorAccountId,
        verifiedAt: new Date(),
        ...(notes ? { reason: notes } : {}),
      },
    });
    if (claimed.count !== 1) {
      throw fail("Cash handover changed concurrently. Refresh and retry.", "HANDOVER_STATE_CONFLICT", 409);
    }

    if (!handover.correctionOfId) {
      let remainingConfirmation = confirmed;
      for (const allocation of handover.allocations) {
        const confirmedLine = Prisma.Decimal.min(
          new Prisma.Decimal(String(allocation.expectedAmount)),
          remainingConfirmation,
        );
        await tx.deliveryCashHandoverAllocation.update({
          where: { id: allocation.id },
          data: { confirmedAmount: confirmedLine },
        });
        remainingConfirmation = remainingConfirmation.minus(confirmedLine);
      }

      const orderIds = new Set();
      for (const allocation of handover.allocations) {
        const collection = await tx.distributorCashEvent.findFirst({
          where: { id: allocation.collectionEventId, distributorId, deliveryDriverId: handover.driverId },
          select: { id: true, orderId: true, amount: true, status: true },
        });
        if (!collection) {
          throw fail("A collection linked to this handover is no longer in scope.", "COLLECTION_SCOPE_MISMATCH", 403);
        }
        if (collection.orderId) orderIds.add(collection.orderId);
        const confirmedForCollection = await tx.deliveryCashHandoverAllocation.aggregate({
          where: {
            collectionEventId: collection.id,
            handover: { status: "VERIFIED" },
          },
          _sum: { confirmedAmount: true },
        });
        if (
          collection.status === "PENDING_VERIFICATION" &&
          new Prisma.Decimal(String(confirmedForCollection._sum.confirmedAmount || 0))
            .gte(new Prisma.Decimal(String(collection.amount)))
        ) {
          await tx.distributorCashEvent.updateMany({
            where: { id: collection.id, status: "PENDING_VERIFICATION" },
            data: {
              status: "VERIFIED",
              verifiedByAccountId: actorAccountId,
              verifiedAt: new Date(),
              notes: `Collection verified against distributor-confirmed driver handover ${handover.id}.`,
            },
          });
        }
      }
      for (const orderId of orderIds) {
        const order = await tx.order.findFirst({
          where: { id: orderId },
          select: { id: true, status: true, payment: true, paymentMethod: true, amount: true, deliveryFee: true, locationPricingSnapshot: true },
        });
        if (!order || order.status !== "Delivered" || order.payment ||
            String(order.paymentMethod || "COD").toUpperCase() !== "COD") continue;
        const verifiedCollections = await tx.distributorCashEvent.aggregate({
          where: { orderId, eventType: "CUSTOMER_COLLECTION", status: { in: ["VERIFIED", "POSTED"] } },
          _sum: { amount: true },
        });
        if (
          new Prisma.Decimal(String(verifiedCollections._sum.amount || 0))
            .gte(formatCollectionAmount(order))
        ) {
          await tx.order.updateMany({
            where: { id: orderId, status: "Delivered", payment: false },
            data: { payment: true },
          });
        }
      }
    }

    await recordSystemAudit(
      { actorId: actorAccountId, actorRole: "DISTRIBUTOR", portalSource: "DISTRIBUTOR" },
      {
        action: handover.correctionOfId
          ? "DRIVER_COD_HANDOVER_CORRECTION_VERIFIED"
          : "DRIVER_COD_CASH_HANDOVER_VERIFIED",
        entityType: "DeliveryCashHandover",
        entityId: handover.id,
        beforeState: { status: handover.status },
        afterState: {
          status: "VERIFIED",
          expectedAmount: String(handover.expectedAmount),
          submittedAmount: String(handover.submittedAmount),
          confirmedAmount: confirmed.toFixed(2),
          discrepancyAmount: confirmed.minus(new Prisma.Decimal(String(handover.expectedAmount))).toFixed(2),
        },
      },
      { client: tx },
    );
    const updated = await tx.deliveryCashHandover.findUnique({
      where: { id: handover.id },
      include: { allocations: true },
    });
    return toHandover(updated);
  });
};

export const getDistributorCashReconciliation = async ({
  distributorId,
  client = prisma,
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.");
  const [events, handovers, cashPosition] = await Promise.all([
    client.distributorCashEvent.findMany({
      where: { distributorId, eventType: "CUSTOMER_COLLECTION", status: { not: "REJECTED" } },
      include: {
        order: { select: { orderReference: true, amount: true, deliveryFee: true, locationPricingSnapshot: true } },
        deliveryManifestStop: { select: { id: true, stopSequence: true, manifestId: true } },
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
    client.deliveryCashHandover.findMany({
      where: { distributorId },
      include: { allocations: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    getDistributorCashPosition({ distributorId, client }),
  ]);
  const eventIds = events.map((event) => event.id);
  const confirmedAllocations = eventIds.length
    ? await client.deliveryCashHandoverAllocation.findMany({
      where: { collectionEventId: { in: eventIds }, handover: { status: "VERIFIED" } },
      include: { handover: { select: { id: true, confirmedAmount: true, driverId: true } } },
    })
    : [];
  const confirmedByEvent = new Map();
  for (const allocation of confirmedAllocations) {
    const previous = confirmedByEvent.get(allocation.collectionEventId) || new Prisma.Decimal(0);
    confirmedByEvent.set(
      allocation.collectionEventId,
      previous.plus(new Prisma.Decimal(String(allocation.confirmedAmount || 0))),
    );
  }

  const lines = events.map((event) => {
    const expected = new Prisma.Decimal(String(event.expectedAmount ?? event.amount));
    const actual = new Prisma.Decimal(String(event.amount));
    const confirmedHandover = confirmedByEvent.get(event.id) || new Prisma.Decimal(0);
    return {
      orderId: event.orderId,
      orderReference: event.order?.orderReference || null,
      deliveryId: event.deliveryManifestStopId,
      manifestId: event.deliveryManifestStop?.manifestId || null,
      stopSequence: event.deliveryManifestStop?.stopSequence || null,
      expectedAmount: expected.toFixed(2),
      actualCollectedAmount: actual.toFixed(2),
      collectionStatus: event.status,
      driverId: event.deliveryDriverId,
      driverOutstandingAmount: event.deliveryDriverId
        ? Prisma.Decimal.max(actual.minus(confirmedHandover), 0).toFixed(2)
        : "0.00",
      handedOverAmount: confirmedHandover.toFixed(2),
      collectedAt: event.occurredAt,
    };
  });
  const standardHandovers = handovers.filter((item) => !item.correctionOfId);
  const verifiedHandovers = standardHandovers.filter((item) => item.status === "VERIFIED");
  const submittedAmount = sum(standardHandovers.map((item) => item.submittedAmount));
  const confirmedAmount = sum(verifiedHandovers.map((item) => item.confirmedAmount));
  const correctionAmount = sum(handovers
    .filter((item) => item.correctionOfId && item.status === "VERIFIED")
    .map((item) => item.correctionDirection === "INCREASE"
      ? item.confirmedAmount
      : new Prisma.Decimal(String(item.confirmedAmount || 0)).negated()));
  const expectedByOrder = new Map();
  for (const event of events) {
    if (!event.orderId || expectedByOrder.has(event.orderId)) continue;
    expectedByOrder.set(
      event.orderId,
      new Prisma.Decimal(String(event.expectedAmount ?? event.amount)),
    );
  }
  const expectedTotal = sum([...expectedByOrder.values()]);
  const actualCollected = sum(events.map((event) => event.amount));
  const verifiedCollected = sum(events
    .filter((event) => ["VERIFIED", "POSTED"].includes(event.status))
    .map((event) => event.amount));
  const driverOutstanding = sum(lines.map((line) => line.driverOutstandingAmount));
  return {
    success: true,
    summary: {
      expectedAmount: expectedTotal.toFixed(2),
      actualCollectedAmount: actualCollected.toFixed(2),
      verifiedCollectedAmount: verifiedCollected.toFixed(2),
      outstandingCodAmount: Prisma.Decimal.max(expectedTotal.minus(actualCollected), 0).toFixed(2),
      driverOutstandingAmount: driverOutstanding.toFixed(2),
      handedOverAmount: submittedAmount.toFixed(2),
      distributorConfirmedAmount: confirmedAmount.toFixed(2),
      settledAmount: cashPosition.companyReceiptRecorded,
      remainingDiscrepancyAmount: submittedAmount.minus(confirmedAmount).minus(correctionAmount).toFixed(2),
      distributorCashPosition: cashPosition,
    },
    lines,
    handovers: handovers.map(toHandover),
  };
};
