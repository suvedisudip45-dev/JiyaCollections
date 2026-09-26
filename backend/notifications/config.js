const parseBoolean = (name, value, defaultValue = false) => {
  if (value === undefined || value === "") return defaultValue;
  if (["true", "1", "yes"].includes(String(value).toLowerCase())) return true;
  if (["false", "0", "no"].includes(String(value).toLowerCase())) return false;
  throw new Error(`${name} must be a boolean value.`);
};

const parsePositiveInteger = (name, value, defaultValue, maximum = 3600) => {
  if (value === undefined || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
};

const requireValues = (values) => {
  const missing = values.filter(([, value]) => !String(value || "").trim()).map(([name]) => name);
  if (missing.length) throw new Error(`Missing notification configuration: ${missing.join(", " )}.`);
};

export const loadNotificationConfig = (env = process.env) => {
  const enabled = parseBoolean("NOTIFICATIONS_ENABLED", env.NOTIFICATIONS_ENABLED);
  const smsEnabled = enabled && parseBoolean("SMS_ENABLED", env.SMS_ENABLED);
  const emailEnabled = enabled && parseBoolean("EMAIL_ENABLED", env.EMAIL_ENABLED);
  const rabbitEnabled = enabled;

  const config = {
    enabled,
    rabbitEnabled,
    rabbit: {
      host: env.RABBITMQ_HOST || "",
      port: parsePositiveInteger("RABBITMQ_PORT", env.RABBITMQ_PORT, 5671, 65535),
      username: env.RABBITMQ_USERNAME || "",
      password: env.RABBITMQ_PASSWORD || "",
      virtualHost: env.RABBITMQ_VIRTUAL_HOST || "",
      tlsEnabled: parseBoolean("RABBITMQ_TLS_ENABLED", env.RABBITMQ_TLS_ENABLED, true),
      heartbeatSeconds: parsePositiveInteger("RABBITMQ_HEARTBEAT_SECONDS", env.RABBITMQ_HEARTBEAT_SECONDS, 30, 300),
      prefetch: parsePositiveInteger("NOTIFICATION_PREFETCH", env.NOTIFICATION_PREFETCH, 5, 1000),
    },
    sms: {
      enabled: smsEnabled,
      sender: env.SPARROW_SMS_SENDER || "",
      token: env.SPARROW_SMS_TOKEN || "",
      baseUrl: env.SPARROW_SMS_BASE_URL || "",
      timeoutMs: parsePositiveInteger("SMS_TIMEOUT_MS", env.SMS_TIMEOUT_MS, 10000, 120000),
    },
    email: {
      enabled: emailEnabled,
      host: env.SMTP_HOST || "",
      port: parsePositiveInteger("SMTP_PORT", env.SMTP_PORT, 587, 65535),
      username: env.SMTP_USERNAME || "",
      password: env.SMTP_PASSWORD || "",
      from: env.SMTP_FROM || "",
      auth: parseBoolean("SMTP_AUTH", env.SMTP_AUTH, true),
      startTls: parseBoolean("SMTP_STARTTLS", env.SMTP_STARTTLS, true),
      connectionTimeoutMs: parsePositiveInteger("SMTP_CONNECTION_TIMEOUT_MS", env.SMTP_CONNECTION_TIMEOUT_MS, 10000, 120000),
      greetingTimeoutMs: parsePositiveInteger("SMTP_GREETING_TIMEOUT_MS", env.SMTP_GREETING_TIMEOUT_MS, 10000, 120000),
      socketTimeoutMs: parsePositiveInteger("SMTP_SOCKET_TIMEOUT_MS", env.SMTP_SOCKET_TIMEOUT_MS, 20000, 300000),
    },
    retry: {
      maxAttempts: parsePositiveInteger("NOTIFICATION_MAX_ATTEMPTS", env.NOTIFICATION_MAX_ATTEMPTS, 5, 20),
      baseDelayMs: parsePositiveInteger("NOTIFICATION_RETRY_BASE_MS", env.NOTIFICATION_RETRY_BASE_MS, 30000, 86400000),
      maxDelayMs: parsePositiveInteger("NOTIFICATION_RETRY_MAX_MS", env.NOTIFICATION_RETRY_MAX_MS, 1800000, 604800000),
      schedulerIntervalMs: parsePositiveInteger("NOTIFICATION_SCHEDULER_INTERVAL_MS", env.NOTIFICATION_SCHEDULER_INTERVAL_MS, 15000, 3600000),
    },
    inboundSms: {
      enabled: parseBoolean("SPARROW_INBOUND_ENABLED", env.SPARROW_INBOUND_ENABLED),
      allowedIps: String(env.SPARROW_INBOUND_ALLOWED_IPS || "").split(",").map((ip) => ip.trim()).filter(Boolean),
      rateLimitEnforced: parseBoolean("SPARROW_INBOUND_RATE_LIMIT_ENFORCED", env.SPARROW_INBOUND_RATE_LIMIT_ENFORCED),
      maxTextLength: parsePositiveInteger("SPARROW_INBOUND_MAX_TEXT_LENGTH", env.SPARROW_INBOUND_MAX_TEXT_LENGTH, 160, 1600),
    },
  };

  if (!enabled) return config;

  requireValues([
    ["RABBITMQ_HOST", config.rabbit.host],
    ["RABBITMQ_USERNAME", config.rabbit.username],
    ["RABBITMQ_PASSWORD", config.rabbit.password],
    ["RABBITMQ_VIRTUAL_HOST", config.rabbit.virtualHost],
  ]);

  if (!config.rabbit.tlsEnabled && env.NODE_ENV === "production") {
    throw new Error("RABBITMQ_TLS_ENABLED must be true in production.");
  }

  if (smsEnabled) {
    requireValues([
      ["SPARROW_SMS_SENDER", config.sms.sender],
      ["SPARROW_SMS_TOKEN", config.sms.token],
      ["SPARROW_SMS_BASE_URL", config.sms.baseUrl],
    ]);
    let smsUrl;
    try {
      smsUrl = new URL(config.sms.baseUrl);
    } catch {
      throw new Error("SPARROW_SMS_BASE_URL must be a valid URL.");
    }
    if (smsUrl.protocol !== "https:") {
      throw new Error("SPARROW_SMS_BASE_URL must use HTTPS to protect the provider token.");
    }
  }

  if (emailEnabled) {
    requireValues([
      ["SMTP_HOST", config.email.host],
      ["SMTP_USERNAME", config.email.username],
      ["SMTP_PASSWORD", config.email.password],
      ["SMTP_FROM", config.email.from],
    ]);
    if (config.email.auth && !config.email.startTls && env.NODE_ENV === "production") {
      throw new Error("SMTP_STARTTLS must be true for authenticated production SMTP.");
    }
  }

  if (config.inboundSms.enabled && config.inboundSms.allowedIps.length === 0) {
    throw new Error("SPARROW_INBOUND_ALLOWED_IPS is required when incoming SMS is enabled.");
  }
  if (config.inboundSms.enabled && !config.inboundSms.rateLimitEnforced) {
    throw new Error("SPARROW_INBOUND_RATE_LIMIT_ENFORCED must be true when incoming SMS is enabled.");
  }

  return config;
};

export { parseBoolean, parsePositiveInteger };
