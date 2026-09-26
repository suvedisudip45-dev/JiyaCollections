import assert from "node:assert/strict";
import test from "node:test";
import { loadNotificationConfig } from "../notifications/config.js";
import { sanitizeForLog } from "../utils/logger.js";

const validEnv = {
  NOTIFICATIONS_ENABLED: "true",
  RABBITMQ_HOST: "mq.example.test",
  RABBITMQ_PORT: "5671",
  RABBITMQ_USERNAME: "test-user",
  RABBITMQ_PASSWORD: "test-password",
  RABBITMQ_VIRTUAL_HOST: "test-vhost",
  RABBITMQ_TLS_ENABLED: "true",
  NODE_ENV: "production",
};

test("notification config remains optional for existing API startup", () => {
  const config = loadNotificationConfig({ NOTIFICATIONS_ENABLED: "false" });
  assert.equal(config.enabled, false);
  assert.equal(config.rabbitEnabled, false);
  assert.equal(config.sms.enabled, false);
  assert.equal(config.email.enabled, false);
});

test("enabled notification config requires RabbitMQ credentials and TLS in production", () => {
  assert.throws(
    () => loadNotificationConfig({ NOTIFICATIONS_ENABLED: "true", NODE_ENV: "production" }),
    /RABBITMQ_HOST/,
  );
  assert.throws(
    () => loadNotificationConfig({ ...validEnv, RABBITMQ_TLS_ENABLED: "false" }),
    /RABBITMQ_TLS_ENABLED/,
  );
});

test("Sparrow sending requires HTTPS and incoming SMS requires a verified IP allowlist", () => {
  const base = {
    ...validEnv,
    SMS_ENABLED: "true",
    SPARROW_SMS_SENDER: "test",
    SPARROW_SMS_TOKEN: "test-token",
    SPARROW_SMS_BASE_URL: "http://sms.example.test/send",
  };
  assert.throws(() => loadNotificationConfig(base), /must use HTTPS/);

  assert.throws(
    () => loadNotificationConfig({ ...validEnv, SPARROW_INBOUND_ENABLED: "true" }),
    /SPARROW_INBOUND_ALLOWED_IPS/,
  );
});

test("notification log sanitizer masks provider and infrastructure credentials", () => {
  const safe = sanitizeForLog({
    SPARROW_SMS_TOKEN: "provider-secret",
    SMTP_PASSWORD: "mail-secret",
    RABBITMQ_PASSWORD: "broker-secret",
    notificationId: "notification-id",
  });
  assert.notEqual(safe.SPARROW_SMS_TOKEN, "provider-secret");
  assert.notEqual(safe.SMTP_PASSWORD, "mail-secret");
  assert.notEqual(safe.RABBITMQ_PASSWORD, "broker-secret");
  assert.equal(safe.notificationId, "notification-id");
});
