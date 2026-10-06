import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeForLog } from "../utils/logger.js";

test("logger redacts password, token, API key, and payment-card metadata", () => {
  assert.deepEqual(sanitizeForLog({
    passwordHash: "password-value",
    accessToken: "header.payload.signature",
    apiKey: "api-key-value",
    creditCardNumber: "4111111111111111",
    cardCvc: "123",
  }), {
    passwordHash: "[REDACTED]",
    accessToken: "[REDACTED]",
    apiKey: "[REDACTED]",
    creditCardNumber: "[REDACTED]",
    cardCvc: "[REDACTED]",
  });
});
