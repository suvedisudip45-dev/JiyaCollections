import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptNotificationText,
  encryptNotificationText,
  isEncryptedNotificationText,
} from "../utils/secureNotificationPayload.js";

test("notification text is authenticated and encrypted at rest", () => {
  const secret = "test-only-secret-with-more-than-32-characters";
  const encrypted = encryptNotificationText("Admin code: 000123", secret);
  assert.equal(isEncryptedNotificationText(encrypted), true);
  assert.equal(JSON.stringify(encrypted).includes("000123"), false);
  assert.equal(decryptNotificationText(encrypted, secret), "Admin code: 000123");
  assert.throws(() => decryptNotificationText(encrypted, `${secret}-wrong`));
});