import assert from "node:assert/strict";
import test from "node:test";
import { classifySparrowError, createSparrowSmsProvider } from "../notifications/providers/sparrowSmsProvider.js";
import { createSmtpEmailProvider } from "../notifications/providers/smtpEmailProvider.js";

const smsConfig = {
  enabled: true,
  sender: "TEST",
  token: "test-token",
  baseUrl: "https://sms.example.test/v2/sms/",
  timeoutMs: 1000,
};

test("Sparrow adapter sends multipart fields and records provider acceptance", async () => {
  let request;
  const provider = createSparrowSmsProvider({
    config: smsConfig,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return new Response(JSON.stringify({ count: 1, response_code: 200, response: "queued" }), { status: 200 });
    },
  });

  const result = await provider.send({ to: "9800000000", text: "Test message" });
  assert.equal(request.url, smsConfig.baseUrl);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body.get("token"), "test-token");
  assert.equal(request.options.body.get("from"), "TEST");
  assert.equal(request.options.body.get("to"), "9800000000");
  assert.equal(request.options.body.get("text"), "Test message");
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.provider, "SPARROW");
});

test("Sparrow adapter refuses HTTP before making a provider request", async () => {
  let called = false;
  const provider = createSparrowSmsProvider({
    config: { ...smsConfig, baseUrl: "http://sms.example.test/v2/sms/" },
    fetchImpl: async () => { called = true; },
  });
  await assert.rejects(() => provider.send({ to: "9800000000", text: "Test" }), /requires HTTPS/);
  assert.equal(called, false);
});

test("Sparrow provider errors classify permanent recipient and credit failures", () => {
  assert.deepEqual(classifySparrowError(1007), {
    code: "1007",
    category: "PERMANENT",
    message: "Sparrow rejected the recipient number.",
    retryable: false,
  });
  assert.equal(classifySparrowError(1013).category, "INSUFFICIENT_CREDIT");
  assert.equal(classifySparrowError(1013).retryable, false);
  assert.equal(classifySparrowError(null, 503).retryable, true);
});

test("SMTP adapter records acceptance, not delivery, and configures STARTTLS", async () => {
  let transportOptions;
  let message;
  const provider = createSmtpEmailProvider({
    config: {
      enabled: true,
      host: "smtp.example.test",
      port: 587,
      username: "user",
      password: "pass",
      from: "verified@example.test",
      auth: true,
      startTls: true,
      connectionTimeoutMs: 1000,
      greetingTimeoutMs: 1000,
      socketTimeoutMs: 1000,
    },
    createTransport: (options) => {
      transportOptions = options;
      return {
        sendMail: async (input) => { message = input; return { messageId: "provider-id" }; },
        close: () => {},
      };
    },
  });

  const result = await provider.send({ to: "recipient@example.test", subject: "Test", text: "Hello" });
  assert.equal(transportOptions.requireTLS, true);
  assert.equal(transportOptions.auth.pass, "pass");
  assert.equal(message.to, "recipient@example.test");
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.providerMessageId, "provider-id");
  assert.notEqual(result.status, "DELIVERED");
});
