export const NOTIFICATION_STATUS = Object.freeze({
  PENDING: "PENDING",
  QUEUED: "QUEUED",
  PROCESSING: "PROCESSING",
  RETRYING: "RETRYING",
  ACCEPTED: "ACCEPTED",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  DEAD_LETTERED: "DEAD_LETTERED",
  UNKNOWN: "UNKNOWN",
});

export const NOTIFICATION_CHANNEL = Object.freeze({
  SMS: "SMS",
  EMAIL: "EMAIL",
});

export const QUEUE_NAMES = Object.freeze({
  EXCHANGE: "notifications.exchange",
  DEAD_LETTER_EXCHANGE: "notifications.dlx",
  SMS: "notifications.sms.queue",
  EMAIL: "notifications.email.queue",
  SMS_DEAD: "notifications.sms.dlq",
  EMAIL_DEAD: "notifications.email.dlq",
  SMS_ROUTE: "notification.sms",
  EMAIL_ROUTE: "notification.email",
  SMS_DEAD_ROUTE: "notification.sms.dead",
  EMAIL_DEAD_ROUTE: "notification.email.dead",
});
