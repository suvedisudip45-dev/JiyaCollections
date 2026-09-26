import { randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { QUEUE_NAMES } from "./constants.js";
import { NotificationProviderError } from "./providerError.js";
import { nextRetryAt } from "./retry.js";

const queueForChannel = { SMS: QUEUE_NAMES.SMS, EMAIL: QUEUE_NAMES.EMAIL };
const deadRouteForChannel = { SMS: QUEUE_NAMES.SMS_DEAD_ROUTE, EMAIL: QUEUE_NAMES.EMAIL_DEAD_ROUTE };

const addDeadLetterOutbox = async (tx, notification) => {
  await tx.notificationOutbox.create({
    data: {
      notificationId: notification.id,
      eventKey: `notification:${notification.id}:dead:${randomUUID()}`,
      routingKey: deadRouteForChannel[notification.channel],
      payload: { notificationId: notification.id, reason: notification.failureCode },
    },
  });
};

const recordFailure = async ({ notification, attemptNumber, claimToken, error, client, retryConfig }) => {
  const now = new Date();
  const category = error instanceof NotificationProviderError ? error.category : "UNKNOWN";
  const code = error instanceof NotificationProviderError ? error.code : "PROVIDER_UNEXPECTED_ERROR";
  const message = error instanceof NotificationProviderError ? error.message : "Provider failed unexpectedly.";
  const retryable = error instanceof NotificationProviderError && error.retryable;
  const ambiguous = category === "TIMEOUT";
  const exhausted = attemptNumber >= notification.maxAttempts;
  const status = ambiguous
    ? "UNKNOWN"
    : retryable && !exhausted
      ? "RETRYING"
      : category === "INSUFFICIENT_CREDIT"
        ? "FAILED"
        : "DEAD_LETTERED";
  const retryAt = status === "RETRYING"
    ? nextRetryAt({ attemptNumber, ...retryConfig })
    : null;

  await client.$transaction(async (tx) => {
    const ownership = await tx.notification.updateMany({
      where: { id: notification.id, status: "PROCESSING", claimToken },
      data: {
        status,
        attemptCount: attemptNumber,
        lastAttemptAt: now,
        nextRetryAt: retryAt,
        failedAt: status === "FAILED" || status === "DEAD_LETTERED" ? now : null,
        failureCode: code,
        failureReason: message,
        claimToken: null,
        claimExpiresAt: null,
      },
    });
    await tx.notificationAttempt.update({
      where: { notificationId_attemptNumber: { notificationId: notification.id, attemptNumber } },
      data: {
        status: ownership.count === 1 ? status : "UNKNOWN",
        requestFinishedAt: now,
        providerErrorCode: code,
        providerErrorMessage: message,
        failureCategory: category,
      },
    });
    await tx.notificationEvent.create({
      data: {
        notificationId: notification.id,
        eventType: ownership.count === 1 ? status : "STALE_WORKER_FAILURE",
        eventTimestamp: now,
      },
    });
    if (ownership.count === 1 && status === "DEAD_LETTERED") {
      await addDeadLetterOutbox(tx, { ...notification, failureCode: code });
    }
  });
};

export const processNotificationMessage = async ({ message, channel, providers, client = prisma, retryConfig }) => {
  let body;
  try {
    body = JSON.parse(message.content.toString("utf8"));
  } catch {
    channel.nack(message, false, false);
    return;
  }

  if (!body?.notificationId) {
    channel.nack(message, false, false);
    return;
  }

  const now = new Date();
  const claimToken = randomUUID();
  const claim = await client.notification.updateMany({
    where: {
      id: body.notificationId,
      status: "QUEUED",
      OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lt: now } }],
    },
    data: { status: "PROCESSING", claimToken, claimExpiresAt: new Date(now.getTime() + 900000) },
  });
  if (claim.count !== 1) {
    channel.ack(message);
    return;
  }

  const notification = await client.notification.findUnique({ where: { id: body.notificationId } });
  if (!notification) {
    channel.ack(message);
    return;
  }

  const attemptNumber = notification.attemptCount + 1;
  const started = await client.$transaction(async (tx) => {
    const updated = await tx.notification.updateMany({
      where: { id: notification.id, status: "PROCESSING", claimToken },
      data: { attemptCount: attemptNumber, lastAttemptAt: now },
    });
    if (updated.count !== 1) return false;
    await tx.notificationAttempt.create({
      data: {
        notificationId: notification.id,
        attemptNumber,
        status: "PROCESSING",
        provider: notification.channel === "SMS" ? "SPARROW" : "SMTP",
        requestStartedAt: now,
      },
    });
    return true;
  });
  if (!started) {
    channel.ack(message);
    return;
  }

  const provider = notification.channel === "SMS" ? providers.sms : providers.email;
  let result;
  try {
    result = notification.channel === "SMS"
      ? await provider.send({ to: notification.recipientAddress, text: notification.payload?.text })
      : await provider.send({
          to: notification.recipientAddress,
          subject: notification.subject,
          text: notification.payload?.text,
          html: notification.payload?.html,
        });
  } catch (error) {
    await recordFailure({ notification, attemptNumber, claimToken, error, client, retryConfig });
    channel.ack(message);
    return;
  }

  const completedAt = new Date();
  await client.$transaction(async (tx) => {
    const ownership = await tx.notification.updateMany({
      where: { id: notification.id, status: "PROCESSING", claimToken },
      data: {
        status: "ACCEPTED",
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        acceptedAt: completedAt,
        failureCode: null,
        failureReason: null,
        claimToken: null,
        claimExpiresAt: null,
      },
    });
    await tx.notificationAttempt.update({
      where: { notificationId_attemptNumber: { notificationId: notification.id, attemptNumber } },
      data: {
        status: ownership.count === 1 ? "ACCEPTED" : "UNKNOWN",
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        providerStatus: result.providerStatus,
        requestFinishedAt: completedAt,
      },
    });
    await tx.notificationEvent.create({
      data: {
        notificationId: notification.id,
        eventType: ownership.count === 1 ? "PROVIDER_ACCEPTED" : "LATE_PROVIDER_ACCEPTANCE",
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        eventTimestamp: completedAt,
      },
    });
  });
  channel.ack(message);
};

export const startNotificationConsumers = async ({ channel, providers, config, client = prisma }) => {
  const consume = (queue) => channel.consume(queue, (message) => {
    if (!message) return;
    processNotificationMessage({ message, channel, providers, client, retryConfig: config.retry })
      .catch(() => channel.nack(message, false, false));
  }, { noAck: false });

  const consumers = [];
  if (config.sms.enabled) consumers.push(await consume(queueForChannel.SMS));
  if (config.email.enabled) consumers.push(await consume(queueForChannel.EMAIL));
  return consumers;
};
