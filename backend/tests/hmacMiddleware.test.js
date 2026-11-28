import test from "node:test";
import assert from "node:assert/strict";

import { legacySignature } from "../utils/hmac.js";
import { verifyRequestSignature } from "../middleware/verifyRequestSignature.js";

const originalHmacSecret = process.env.HMAC_SECRET;

const createRequest = ({
  method = "POST",
  path = "/api/orders",
  body,
  signature,
  contentType = "application/json",
  contentLength,
  rawBody,
} = {}) => {
  const headers = {};
  if (signature) headers["request-signature"] = signature;
  if (contentType) headers["content-type"] = contentType;
  const resolvedContentLength = contentLength === null
    ? undefined
    : contentLength ?? (body === undefined ? undefined : Buffer.byteLength(JSON.stringify(body), "utf8"));
  if (resolvedContentLength !== undefined) headers["content-length"] = String(resolvedContentLength);

  return {
    method,
    path,
    originalUrl: path,
    body,
    rawBody,
    headers,
    get(name) {
      return headers[name.toLowerCase()];
    },
    is(type) {
      return contentType?.startsWith(type) ? type : false;
    },
  };
};

const createResponse = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
});

test("rejects requests without a signature before calling next", () => {
  process.env.HMAC_SECRET = "test-secret";
  const req = createRequest({ body: { orderId: "order-1" } });
  const res = createResponse();
  let nextCalled = false;

  verifyRequestSignature(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.code, "HMAC_SIGNATURE_REQUIRED");
});

test("rejects a signature produced with a different secret", () => {
  process.env.HMAC_SECRET = "backend-secret";
  const body = { orderId: "order-1" };
  const signature = legacySignature({
    method: "POST",
    canonicalUrl: "/api/orders",
    body,
    secret: "different-secret",
  });
  const req = createRequest({ body, signature });
  const res = createResponse();
  let nextCalled = false;

  verifyRequestSignature(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.code, "HMAC_SIGNATURE_INVALID");
});

test("allows a correctly signed request", () => {
  process.env.HMAC_SECRET = "matching-secret";
  const body = { orderId: "order-1" };
  const signature = legacySignature({
    method: "POST",
    canonicalUrl: "/api/orders",
    body,
    secret: "matching-secret",
  });
  const req = createRequest({ body, signature });
  const res = createResponse();
  let nextCalled = false;

  verifyRequestSignature(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("verifies the exact JSON text sent by the portal", () => {
  process.env.HMAC_SECRET = "matching-secret";
  const rawBody = '{ "orderId": "order-1" }';
  const parsedBody = { orderId: "order-1" };
  const signature = legacySignature({
    method: "POST",
    canonicalUrl: "/api/orders",
    body: rawBody,
    secret: "matching-secret",
  });
  const req = createRequest({
    body: parsedBody,
    rawBody,
    contentLength: Buffer.byteLength(rawBody, "utf8"),
    signature,
  });
  const res = createResponse();
  let nextCalled = false;

  verifyRequestSignature(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("accepts the captured admin GET signature when the backend secret matches", () => {
  process.env.HMAC_SECRET = "replace_with_a_shared_hmac_secret";
  const req = createRequest({
    method: "GET",
    path: "/api/auth/me",
    body: {},
    signature: "MzFEMjBGMjRBMkQwRTM5QkNCRjE0MEFBQUE4MkJDOEI0M0FCRjA3QzYyMkE5NkI2OTA0MTgzOTcwMkYwQzdFQg==",
    contentType: undefined,
    contentLength: null,
  });
  const res = createResponse();
  let nextCalled = false;

  verifyRequestSignature(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("does not apply request signatures to NCM webhook routes", () => {
  delete process.env.HMAC_SECRET;
  const req = createRequest({ path: "/api/delivery/ncm-webhook", body: { status: "delivered" } });
  const res = createResponse();
  let nextCalled = false;

  verifyRequestSignature(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("fails closed when the backend signing secret is missing", () => {
  delete process.env.HMAC_SECRET;
  const req = createRequest({ path: "/api/products" });
  const res = createResponse();
  let nextCalled = false;

  verifyRequestSignature(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.code, "HMAC_NOT_CONFIGURED");
});

test.after(() => {
  if (originalHmacSecret === undefined) delete process.env.HMAC_SECRET;
  else process.env.HMAC_SECRET = originalHmacSecret;
});
