import { randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { publishConfirmed } from "./queue/connection.js";

const LEASE_MS = 30000;
const MAX_PUBLISH_ATTEMPTS = 8;

export const publishPendingOutbox = async ({ client = prisma, channel, limit = 20, now = new Date() }) => {
  const rows = await client.notificationOutbox.findMany({
    where: {
      publishedAt: null,
      nextAttemptAt: { lte: now },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let published = 0;
  for (const row of rows) {
    const leaseToken = randomUUID();
    const claim = await client.notificationOutbox.updateMany({
      where: {
        id: row.id,
        publishedAt: null,
        nextAttemptAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: { leaseToken, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (claim.count !== 1) continue;

    try {
      await publishConfirmed(channel, row.routingKey, row.payload, { messageId: row.eventKey });
      const marked = await client.$transaction(async (tx) => {
        const outboxUpdate = await tx.notificationOutbox.updateMany({
          where: { id: row.id, leaseToken, publishedAt: null },
          data: { publishedAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastError: null },
        });
        if (outboxUpdate.count !== 1) return false;
        await tx.notification.updateMany({
          where: { id: row.notificationId, status: { in: ["PENDING", "RETRYING"] } },
          data: { status: "QUEUED", queuedAt: new Date() },
        });
        return true;
      });
      if (marked) published += 1;
    } catch {
      const attemptCount = row.attemptCount + 1;
      const delayMs = Math.min(300000, 1000 * (2 ** Math.min(attemptCount, 8)));
      await client.notificationOutbox.updateMany({
        where: { id: row.id, leaseToken, publishedAt: null },
        data: {
          attemptCount,
          nextAttemptAt: new Date(Date.now() + delayMs),
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: "Broker publish failed; retry scheduled.",
        },
      });
      if (attemptCount === MAX_PUBLISH_ATTEMPTS) {
        await client.notificationEvent.create({
          data: {
            notificationId: row.notificationId,
            eventType: "BROKER_PUBLISH_RETRIES_EXHAUSTED",
            eventTimestamp: new Date(),
          },
        });
      }
    }
  }
  return published;
};
