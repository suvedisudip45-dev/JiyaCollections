import assert from "node:assert/strict";
import test from "node:test";
import { createOrder, requestNcm, shippingRateTypeForNcm } from "../services/ncmClient.js";
import {
  STATUS_MAP,
  assignmentStatusFromNcmStatus,
  buildDeliveryInput,
  deliveryTypeForNcm,
  generateVendorReference,
  normalizeDeliveryStatus,
  parseBoolean,
  webhookIdentifiers,
  statusEventKey,
} from "../services/deliveryService.js";

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

test("NCM status mapping updates assignment state for manufacturer dashboards", () => {
  assert.equal(assignmentStatusFromNcmStatus("Pickup Complete"), "picked_up");
  assert.equal(assignmentStatusFromNcmStatus("Dispatched"), "in_transit");
  assert.equal(assignmentStatusFromNcmStatus("Delivered"), "delivered");
  assert.equal(assignmentStatusFromNcmStatus("Sent for Pickup"), "ready_for_pickup");
  assert.equal(assignmentStatusFromNcmStatus("Unknown Status"), null);
});

test("NCM webhook variations normalize and resolve all supported identifiers", () => {
  assert.equal(normalizeDeliveryStatus("order_arrived").assignmentStatus, "arrived_at_destination");
  assert.equal(normalizeDeliveryStatus("pickup_completed").assignmentStatus, "picked_up");
  assert.equal(normalizeDeliveryStatus("delivery_completed").assignmentStatus, "delivered");
  assert.deepEqual(
    webhookIdentifiers({ order_id: 4935, vref_id: "NCM9E9A907A74CF", orderId: "internal-order" }),
    ["4935", "internal-order", "NCM9E9A907A74CF"]
  );
});

test("delivery payload auto-fills packaging metadata and keeps it editable", () => {
  const order = {
    id: "ord_123",
    amount: 1500,
    address: JSON.stringify({
      city: "Kathmandu",
      phone: "9800000000",
      name: "Ram Shrestha",
      street: "Boudha",
      deliveryInstruction: "Leave at the gate",
    }),
    items: JSON.stringify([
      {
        name: "Cotton Shirt",
        productType: "Apparel",
        description: "Premium cotton shirt",
        quantity: 1,
      },
    ]),
  };

  const manufacturer = {
    id: "mfg_123",
    ncmPickupBranch: "KTM",
  };

  const input = buildDeliveryInput({
    order,
    assignment: { id: "assign_123" },
    manufacturer,
    packagingMeta: {
      productType: "Shirt",
      productDescription: "Premium cotton shirt",
      packageType: "Box",
      isFragile: false,
      deliveryInstruction: "Handle with care and leave at the gate",
    },
  });

  assert.equal(input.productType, "Shirt");
  assert.match(input.packageDescription, /Shirt/i);
  assert.match(input.packageDescription, /Premium cotton shirt/i);
  assert.match(input.packageDescription, /Box/i);
  assert.equal(input.instruction, "Handle with care and leave at the gate");
});

test("packaging fragile values preserve explicit false", () => {
  assert.equal(parseBoolean("false"), false);
  assert.equal(parseBoolean("true"), true);
  assert.equal(parseBoolean(false), false);
});

test("NCM shipping-rate types use documented values", () => {
  assert.equal(shippingRateTypeForNcm("Door2Door"), "Pickup/Collect");
  assert.equal(shippingRateTypeForNcm("Branch2Door"), "Send Branch2Door");
  assert.equal(shippingRateTypeForNcm("Door2Branch"), "D2B");
  assert.equal(shippingRateTypeForNcm("Branch2Branch"), "B2B");
});

test("shipping-rate client normalizes legacy delivery type values", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.NCM_API_TOKEN;
  const originalBaseUrl = process.env.NCM_API_BASE_URL;
  let requestedUrl = "";
  process.env.NCM_API_TOKEN = "test-server-token";
  process.env.NCM_API_BASE_URL = "https://ncm.test";
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ charge: "100" }), { status: 200 });
  };

  try {
    const { getShippingRate } = await import("../services/ncmClient.js");
    await getShippingRate({ creation: "KATHMANDU", destination: "POKHARA", type: "Door2Door" });
    assert.equal(new URL(requestedUrl).searchParams.get("type"), "Pickup/Collect");
  } finally {
    global.fetch = originalFetch;
    restoreEnv("NCM_API_TOKEN", originalToken);
    restoreEnv("NCM_API_BASE_URL", originalBaseUrl);
  }
});