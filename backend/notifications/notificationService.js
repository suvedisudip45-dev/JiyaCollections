import { randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { loadNotificationConfig } from "./config.js";
import { NOTIFICATION_CHANNEL } from "./constants.js";

const routingKeyFor = (channel) => channel === NOTIFICATION_CHANNEL.SMS
  ? "notification.sms"
  : "notification.email";

const validateInput = (input, config) => {
  const channel = String(input?.channel || "").toUpperCase();
  if (!Object.values(NOTIFICATION_CHANNEL).includes(channel)) {
    throw new Error("Notification channel must be SMS or EMAIL.");
  }
  if (channel === "SMS" && !config.sms.enabled) throw new Error("SMS notifications are disabled.");
  if (channel === "EMAIL" && !config.email.enabled) throw new Error("Email notifications are disabled.");

  const recipientAddress = String(input?.recipientAddress || "").trim();
  if (!recipientAddress || recipientAddress.length > 255) {
    throw new Error("A valid notification recipient is required.");
  }
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    throw new Error("Notification payload must be an object.");
  }
  if (channel === "SMS" && (typeof input.payload.text !== "string" || !input.payload.text.trim() || input.payload.text.length > 1600)) {
    throw new Error("SMS text must be a non-empty string of at most 1600 characters.");
  }
  if (channel === "EMAIL" && (!input.payload.subject || (!input.payload.text && !input.payload.html))) {
    throw new Error("Email subject and body are required.");
  }

  return { channel, recipientAddress };
};

export const enqueueNotification = async (input, { client = prisma, config = loadNotificationConfig() } = {}) => {
  if (!config.enabled) throw new Error("Notifications are disabled.");
  const { channel, recipientAddress } = validateInput(input, config);
  const idempotencyKey = input.idempotencyKey ? String(input.idempotencyKey).trim() : null;
  if (idempotencyKey && idempotencyKey.length > 191) throw new Error("idempotencyKey cannot exceed 191 characters.");

  if (idempotencyKey) {
    const existing = await client.notification.findUnique({ where: { idempotencyKey }, select: { id: true, status: true } });
    if (existing) return { ...existing, duplicate: true };
  }

  const notificationId = randomUUID();
  const now = new Date();
  try {
    const notification = await client.$transaction(async (tx) => {
      const created = await tx.notification.create({
        data: {
          id: notificationId,
          idempotencyKey,
          notificationType: String(input.notificationType || "GENERAL").slice(0, 64),
          channel,
          status: "PENDING",
          recipientName: input.recipientName ? String(input.recipientName).slice(0, 160) : null,
          recipientAddress,
          subject: input.payload.subject ? String(input.payload.subject).slice(0, 255) : null,
          template: input.template ? String(input.template).slice(0, 120) : null,
          payload: input.payload,
          maxAttempts: config.retry.maxAttempts,
          createdAt: now,
        },
        select: { id: true, status: true },
      });

      await tx.notificationEvent.create({
        data: { notificationId: created.id, eventType: "CREATED", eventTimestamp: now },
      });
      await tx.notificationOutbox.create({
        data: {
          notificationId: created.id,
          eventKey: `notification:${created.id}:initial`,
          routingKey: routingKeyFor(channel),
          payload: { notificationId: created.id },
        },
      });
      return created;
    });
    return { ...notification, duplicate: false };
  } catch (error) {
    if (error?.code === "P2002" && idempotencyKey) {
      const existing = await client.notification.findUnique({ where: { idempotencyKey }, select: { id: true, status: true } });
      if (existing) return { ...existing, duplicate: true };
    }
    throw error;
  }
};
