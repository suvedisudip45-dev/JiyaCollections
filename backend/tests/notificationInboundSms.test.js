import assert from "node:assert/strict";
import test from "node:test";
import { createIncomingSmsHandler, normalizeIncomingSms } from "../notifications/inboundSmsController.js";

const createResponse = () => ({
  statusCode: 200,
  contentType: "",
  body: "",
  status(code) { this.statusCode = code; return this; },
  type(value) { this.contentType = value; return this; },
  send(value) { this.body = value; return this; },
});

const activeConfig = {
  enabled: true,
  inboundSms: { enabled: true, allowedIps: ["203.0.113.10"], maxTextLength: 160, rateLimitEnforced: true },
};

test("incoming SMS parser validates bounded fields and hashes payload without storing a raw copy", () => {
  const incoming = normalizeIncomingSms({ from: "9800000000", to: "AAMA", keyword: "ORDER", text: "Status?" });
  assert.equal(incoming.fromNumber, "9800000000");
  assert.equal(incoming.text, "Status?");
  assert.equal(incoming.payloadHash.length, 64);
  assert.equal(normalizeIncomingSms({ from: ["9800000000"], to: "AAMA", text: "x" }), null);
  assert.equal(normalizeIncomingSms({ from: "9800000000", to: "AAMA", text: "x".repeat(161) }), null);
});

test("incoming SMS route is disabled by default and does not access persistence", async () => {
  let reads = 0;
  const handler = createIncomingSmsHandler({
    client: { incomingSms: { findFirst: async () => { reads += 1; } } },
    getConfig: () => ({ enabled: false, inboundSms: { enabled: false } }),
  });
  const response = createResponse();
  await handler({ socket: { remoteAddress: "203.0.113.10" }, query: {} }, response);
  assert.equal(response.statusCode, 404);
  assert.equal(response.body, "Unavailable");
  assert.equal(reads, 0);
});

test("incoming SMS requires exact source IP and deduplicates persisted messages", async () => {
  let stored;
  let existing = null;
  const client = {
    incomingSms: {
      findFirst: async () => existing,
      create: async ({ data }) => { stored = data; return data; },
    },
  };
  const handler = createIncomingSmsHandler({ client, getConfig: () => activeConfig });
  const query = { from: "9800000000", to: "AAMA", text: "help" };

  const blockedResponse = createResponse();
  await handler({ socket: { remoteAddress: "198.51.100.1" }, query }, blockedResponse);
  assert.equal(blockedResponse.statusCode, 403);
  assert.equal(stored, undefined);

  const acceptedResponse = createResponse();
  await handler({ socket: { remoteAddress: "::ffff:203.0.113.10" }, query }, acceptedResponse);
  assert.equal(acceptedResponse.statusCode, 202);
  assert.equal(acceptedResponse.body, "Received");
  assert.equal(stored.processingStatus, "RECEIVED");
  assert.equal(stored.text, "help");

  existing = { id: "received-1" };
  const duplicateResponse = createResponse();
  await handler({ socket: { remoteAddress: "203.0.113.10" }, query }, duplicateResponse);
  assert.equal(duplicateResponse.statusCode, 200);
  assert.equal(duplicateResponse.body, "Duplicate");
});
