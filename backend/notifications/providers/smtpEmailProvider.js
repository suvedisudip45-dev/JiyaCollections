import nodemailer from "nodemailer";
import { NotificationProviderError } from "../providerError.js";

const classifySmtpError = (error) => {
  const code = String(error?.code || "");
  const responseCode = Number(error?.responseCode || 0);
  const timedOut = ["ETIMEDOUT", "ESOCKET", "ECONNECTION"].includes(code);
  if (timedOut) return { category: "TIMEOUT", retryable: false, code: code || "SMTP_TIMEOUT" };
  if (responseCode === 421 || responseCode === 450 || responseCode === 451 || responseCode === 452) {
    return { category: "TRANSIENT", retryable: true, code: `SMTP_${responseCode}` };
  }
  if (responseCode >= 500) return { category: "PERMANENT", retryable: false, code: `SMTP_${responseCode}` };
  if (responseCode >= 400) return { category: "TRANSIENT", retryable: true, code: `SMTP_${responseCode}` };
  return { category: "UNKNOWN", retryable: false, code: code || "SMTP_UNKNOWN" };
};

export const createSmtpEmailProvider = ({ config, createTransport = nodemailer.createTransport }) => {
  if (!config.enabled) {
    return {
      send: async () => {
        throw new NotificationProviderError("Email sending is disabled.", { code: "EMAIL_DISABLED", category: "CONFIGURATION" });
      },
      close: () => {},
    };
  }

  const transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.startTls,
    auth: config.auth ? { user: config.username, pass: config.password } : undefined,
    connectionTimeout: config.connectionTimeoutMs,
    greetingTimeout: config.greetingTimeoutMs,
    socketTimeout: config.socketTimeoutMs,
    tls: { minVersion: "TLSv1.2" },
  });

  const send = async ({ to, subject, text, html }) => {
    if (!String(to || "").trim() || !String(subject || "").trim() || (!text && !html)) {
      throw new NotificationProviderError("Email recipient, subject, and body are required.", { code: "EMAIL_INPUT_INVALID", category: "PERMANENT" });
    }
    try {
      const result = await transporter.sendMail({
        from: config.from,
        to: String(to).trim(),
        subject: String(subject),
        ...(text ? { text: String(text) } : {}),
        ...(html ? { html: String(html) } : {}),
      });
      return {
        provider: "SMTP",
        status: "ACCEPTED",
        providerMessageId: result.messageId || null,
        providerStatus: "SMTP_ACCEPTED",
      };
    } catch (error) {
      const failure = classifySmtpError(error);
      throw new NotificationProviderError("SMTP provider did not accept the message.", {
        code: failure.code,
        category: failure.category,
        retryable: failure.retryable,
        httpStatus: failure.category === "PERMANENT" ? 550 : null,
      });
    }
  };

  return { send, close: () => transporter.close() };
};
