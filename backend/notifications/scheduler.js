import { randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { QUEUE_NAMES } from "./constants.js";

const routeFor = { SMS: QUEUE_NAMES.SMS_ROUTE, EMAIL: QUEUE_NAMES.EMAIL_ROUTE };
const deadRouteFor = { SMS: QUEUE_NAMES.SMS_DEAD_ROUTE, EMAIL: QUEUE_NAMES.EMAIL_DEAD_ROUTE };

export const scheduleDueRetries = async ({ client = prisma, now = new Date(), limit = 50 }) => {
  const due = await client.notification.findMany({
    where: { status: "RETRYING", nextRetryAt: { lte: now } },
    orderBy: { nextRetryAt: "asc" },
    take: limit,
    select: { id: true, channel: true, attemptCount: true, maxAttempts: true },
  });
  let scheduled = 0;

  for (const notification of due) {
    if (notification.attemptCount >= notification.maxAttempts) {
      await client.$transaction(async (tx) => {
        const claim = await tx.notification.updateMany({
          where: { id: notification.id, status: "RETRYING", attemptCount: notification.attemptCount },
          data: {
            status: "DEAD_LETTERED",
            failedAt: now,
            nextRetryAt: null,
            failureCode: "MAX_ATTEMPTS_EXCEEDED",
            failureReason: "Notification retry limit reached.",
          },
        });
        if (!claim.count) return;
        await tx.notificationOutbox.create({
          data: {
            notificationId: notification.id,
            eventKey: `notification:${notification.id}:dead:${randomUUID()}`,
            routingKey: deadRouteFor[notification.channel],
            payload: { notificationId: notification.id, reason: "MAX_ATTEMPTS_EXCEEDED" },
          },
        });
        await tx.notificationEvent.create({
          data: { notificationId: notification.id, eventType: "MAX_ATTEMPTS_EXCEEDED", eventTimestamp: now },
        });
      });
      continue;
    }

    await client.$transaction(async (tx) => {
      const claim = await tx.notification.updateMany({
        where: {
          id: notification.id,
          status: "RETRYING",
          nextRetryAt: { lte: now },
          attemptCount: notification.attemptCount,
        },
        data: { status: "QUEUED", nextRetryAt: null, queuedAt: now },
      });
      if (claim.count !== 1) return;
      const retryNumber = notification.attemptCount + 1;
      await tx.notificationOutbox.create({
        data: {
          notificationId: notification.id,
          eventKey: `notification:${notification.id}:retry:${retryNumber}:${randomUUID()}`,
          routingKey: routeFor[notification.channel],
          payload: { notificationId: notification.id },
        },
      });
      await tx.notificationEvent.create({
        data: { notificationId: notification.id, eventType: "RETRY_QUEUED", eventTimestamp: now },
      });
      scheduled += 1;
    });
  }
  return scheduled;
};

export const markExpiredProcessingUnknown = async ({ client = prisma, now = new Date(), limit = 50 }) => {
  const expired = await client.notification.findMany({
    where: { status: "PROCESSING", claimExpiresAt: { lt: now } },
    orderBy: { claimExpiresAt: "asc" },
    take: limit,
    select: { id: true, claimToken: true, attemptCount: true },
  });
  let marked = 0;
  for (const notification of expired) {
    const result = await client.$transaction(async (tx) => {
      const updated = await tx.notification.updateMany({
        where: { id: notification.id, status: "PROCESSING", claimToken: notification.claimToken, claimExpiresAt: { lt: now } },
        data: {
          status: "UNKNOWN",
          failureCode: "PROCESSING_LEASE_EXPIRED",
          failureReason: "Provider acceptance could not be confirmed after worker interruption.",
          failedAt: now,
          claimToken: null,
          claimExpiresAt: null,
        },
      });
      if (updated.count !== 1) return 0;
      await tx.notificationAttempt.updateMany({
        where: { notificationId: notification.id, attemptNumber: notification.attemptCount, status: "PROCESSING" },
        data: {
          status: "UNKNOWN",
          requestFinishedAt: now,
          providerErrorCode: "PROCESSING_LEASE_EXPIRED",
          providerErrorMessage: "Provider acceptance could not be confirmed after worker interruption.",
          failureCategory: "TIMEOUT",
        },
      });
      await tx.notificationEvent.create({
        data: { notificationId: notification.id, eventType: "PROCESSING_LEASE_EXPIRED", eventTimestamp: now },
      });
      return 1;
    });
    if (!result) continue;
    marked += 1;
  }
  return marked;
};
