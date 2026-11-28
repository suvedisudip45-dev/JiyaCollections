import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeBodyText,
  canonicalizeRequestUrl,
  legacySignature,
  signaturesMatch,
} from "../utils/hmac.js";

test("canonicalizes request URLs and empty bodies using the compatibility rules", () => {
  assert.equal(canonicalizeRequestUrl("/api/orders?b=2&A=1&z=3"), "/api/orders?a=1&b=2&z=3");
  assert.equal(canonicalizeBodyText("   \n  \t   "), '""');
  assert.equal(canonicalizeBodyText({ hello: "world" }), '{"hello":"world"}');
});

test("computes the legacy Node-compatible signature from the guide", () => {
  const signature = legacySignature({
    method: "post",
    canonicalUrl: "/api/orders?b=2&A=1",
    body: { hello: "world" },
    secret: "super-secret",
  });

  assert.equal(signature, "M0Q4QTFCNjIxRjJBQjVDQzc1M0U3MUQ2N0MzRTk2ODZEQTA1MkFFNjY3MjY5MkU5QkEyNTIxNjlENTEwMDgyMA==");
});

test("compares signatures safely and rejects mismatches", () => {
  const expected = "M0Q4QTFCNjIxRjJBQjVDQzc1M0U3MUQ2N0MzRTk2ODZEQTA1MkFFNjY3MjY5MkU5QkEyNTIxNjlENTEwMDgyMA==";
  assert.equal(signaturesMatch(expected, expected), true);
  assert.equal(signaturesMatch(expected, "different"), false);
  assert.equal(signaturesMatch("abc", "abcd"), false);
});
