import assert from "node:assert/strict";
import test from "node:test";
import { createOrder, requestNcm } from "../services/ncmClient.js";
import { STATUS_MAP, deliveryTypeForNcm, generateVendorReference, statusEventKey } from "../services/deliveryService.js";

const restoreEnv = (name, value) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

test("NCM client sends server-side token and JSON payload", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.NCM_API_TOKEN;
  const originalBaseUrl = process.env.NCM_API_BASE_URL;
  let request;

  process.env.NCM_API_TOKEN = "test-server-token";
  process.env.NCM_API_BASE_URL = "https://ncm.test";
  global.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ Message: "Order Successfully Created", orderid: 77 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await createOrder({ name: "Test Customer", phone: "9800000000" });
    assert.equal(result.data.orderid, 77);
    assert.equal(request.options.headers.Authorization, "Token test-server-token");
    assert.equal(request.options.method, "POST");
    assert.deepEqual(JSON.parse(request.options.body), { name: "Test Customer", phone: "9800000000" });
  } finally {
    global.fetch = originalFetch;
    restoreEnv("NCM_API_TOKEN", originalToken);
    restoreEnv("NCM_API_BASE_URL", originalBaseUrl);
  }
});

test("NCM client classifies non-2xx responses without leaking response secrets", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.NCM_API_TOKEN;
  process.env.NCM_API_TOKEN = "test-server-token";
  global.fetch = async () => new Response(JSON.stringify({ detail: "invalid token" }), { status: 401 });

  try {
    await assert.rejects(() => requestNcm("/api/v1/order", { query: { id: 10 } }), (error) => {
      assert.equal(error.code, "NCM_HTTP_401");
      assert.equal(error.httpStatus, 401);
      return true;
    });
  } finally {
    global.fetch = originalFetch;
    restoreEnv("NCM_API_TOKEN", originalToken);
  }
});

test("delivery mapping and event keys are deterministic", () => {
  assert.equal(deliveryTypeForNcm("Door2Door"), "Door2Door");
  assert.equal(deliveryTypeForNcm("invalid"), "Door2Door");
  assert.equal(STATUS_MAP.Delivered, "DELIVERED");
  assert.equal(statusEventKey({ orderId: "77", status: "Delivered", timestamp: "2026-09-16T00:00:00Z", event: "delivery_completed" }), statusEventKey({ orderId: "77", status: "Delivered", timestamp: "2026-09-16T00:00:00Z", event: "delivery_completed" }));
});

test("NCM vendor reference stays short and deterministic", () => {
  const orderId = "4db7dcc1-dbf3-46eb-8c6c-73fec88611fc";
  const assignmentId = "50cfd6db-49c5-4781-8acb-8411b4cb3e12";
  const reference = generateVendorReference({ order: { id: orderId }, assignment: { id: assignmentId } });

  assert.equal(reference.startsWith("NCM"), true);
  assert.ok(reference.length <= 15, `Vendor reference is too long: ${reference.length} chars`);
  assert.equal(generateVendorReference({ order: { id: orderId }, assignment: { id: assignmentId } }), reference);
  assert.notEqual(reference, `ORDER-${orderId}-V${assignmentId}`);
});