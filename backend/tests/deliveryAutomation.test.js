import assert from "node:assert/strict";
import test from "node:test";
import { createExchangeOrder, createOrder, extractNcmCharge, getNcmErrorMessage, getNcmResponseRejection, requestNcm, requestOrderReturnOnce, shippingRateTypeForNcm } from "../services/ncmClient.js";
import {
  STATUS_MAP,
  assignmentStatusFromNcmStatus,
  buildDeliveryInput,
  deliveryTypeForNcm,
  generateVendorReference,
  getCarrierBookingAssignmentStatus,
  isDeliveryOrderOwner,
  normalizePackageWeight,
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

test("delivery ownership uses distributor assignment for auto-allocated orders", () => {
  const distributorId = "distributor-1";
  const order = { distributorId: null, manufacturerId: null };
  const assignment = { distributorId, manufacturerId: null };

  assert.equal(isDeliveryOrderOwner({ order, assignment, distributorId }), true);
  assert.equal(isDeliveryOrderOwner({
    order: { ...order, distributorId: "distributor-2" },
    assignment,
    distributorId,
  }), false);
  assert.equal(isDeliveryOrderOwner({
    order,
    assignment: { distributorId: "distributor-2", manufacturerId: null },
    distributorId,
  }), false);
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

test("NCM package description includes dimensions and quality packaging notes", () => {
  const input = buildDeliveryInput({
    order: {
      id: "ord_dimensions",
      amount: 1500,
      address: JSON.stringify({ city: "Kathmandu", phone: "9800000000", name: "Ram Shrestha", street: "Boudha" }),
      items: JSON.stringify([{ name: "Cotton Shirt" }]),
    },
    assignment: { id: "assign_dimensions" },
    manufacturer: { id: "hub_1", ncmPickupBranch: "KTM" },
    packagingMeta: {
      packageDimensions: "30 x 20 x 5 cm",
      packagingNotes: "Ironed and wrapped in waterproof polybag",
    },
  });

  assert.match(input.packageDescription, /Dimensions: 30 x 20 x 5 cm/);
  assert.match(input.packageDescription, /Ironed and wrapped in waterproof polybag/);
  assert.equal(normalizePackageWeight("0.8 kg"), 0.8);
  assert.equal(normalizePackageWeight("invalid"), null);
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

test("carrier booking failures do not advance assignment to ready_for_pickup", () => {
  assert.equal(getCarrierBookingAssignmentStatus({ success: true, currentStatus: "package_details_complete" }), "ready_for_pickup");
  assert.equal(getCarrierBookingAssignmentStatus({ success: false, currentStatus: "package_details_complete" }), "package_details_complete");
  assert.equal(getCarrierBookingAssignmentStatus({ success: false, currentStatus: "ready_for_pickup" }), "ready_for_pickup");
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

test("NCM exchange client uses the documented vendor exchange endpoint and original order ID", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.NCM_API_TOKEN;
  const originalBaseUrl = process.env.NCM_API_BASE_URL;
  let request;

  process.env.NCM_API_TOKEN = "test-server-token";
  process.env.NCM_API_BASE_URL = "https://ncm.test";
  global.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ message: "Exchange orders created", cust_order: 4567, ven_order: 4568 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await createExchangeOrder({ pk: 747 });
    assert.equal(result.data.cust_order, 4567);
    assert.equal(result.data.ven_order, 4568);
    assert.equal(request.url, "https://ncm.test/api/v2/vendor/order/exchange-create");
    assert.equal(request.options.headers.Authorization, "Token test-server-token");
    assert.deepEqual(JSON.parse(request.options.body), { pk: 747 });
  } finally {
    global.fetch = originalFetch;
    restoreEnv("NCM_API_TOKEN", originalToken);
    restoreEnv("NCM_API_BASE_URL", originalBaseUrl);
  }
});

test("NCM return client uses the documented vendor return endpoint and payload without retrying", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.NCM_API_TOKEN;
  const originalBaseUrl = process.env.NCM_API_BASE_URL;
  let request;
  process.env.NCM_API_TOKEN = "test-server-token";
  process.env.NCM_API_BASE_URL = "https://ncm.test";
  global.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ order: 747, vendor_return: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await requestOrderReturnOnce({ pk: 747, comment: "Return requested" });
    assert.equal(result.data.vendor_return, true);
    assert.equal(request.url, "https://ncm.test/api/v2/vendor/order/return");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers.Authorization, "Token test-server-token");
    assert.deepEqual(JSON.parse(request.options.body), { pk: 747, comment: "Return requested" });
  } finally {
    global.fetch = originalFetch;
    restoreEnv("NCM_API_TOKEN", originalToken);
    restoreEnv("NCM_API_BASE_URL", originalBaseUrl);
  }
});

test("NCM errors preserve partner response detail and carrier charges normalize", () => {
  assert.equal(
    getNcmErrorMessage({ message: "NCM request failed with HTTP 400", response: { detail: "Invalid vendor order" } }),
    "NCM request failed with HTTP 400: Invalid vendor order",
  );
  assert.equal(extractNcmCharge({ data: { delivery_charge: "145.50" } }), 145.5);
  assert.equal(extractNcmCharge({ data: { delivery_charge: "unknown" } }), null);
  assert.equal(getNcmResponseRejection({ success: false, detail: "Order is not eligible for return" }), "Order is not eligible for return");
  assert.equal(getNcmResponseRejection({ order: 4041, vendor_return: false, message: "Return was not marked" }), "Return was not marked");
  assert.equal(getNcmResponseRejection({ Message: "Exchange orders created" }), null);
});

test("NCM client retries bounded 5xx responses and returns attempt history", async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.NCM_API_TOKEN;
  const originalBaseUrl = process.env.NCM_API_BASE_URL;
  const originalRetryDelay = process.env.NCM_HTTP_RETRY_DELAY_MS;
  let calls = 0;
  process.env.NCM_API_TOKEN = "test-server-token";
  process.env.NCM_API_BASE_URL = "https://ncm.test";
  process.env.NCM_HTTP_RETRY_DELAY_MS = "0";
  global.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ detail: "temporary outage" }), { status: 503 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const result = await requestNcm("/retry-test");
    assert.equal(calls, 2);
    assert.equal(result.data.ok, true);
    assert.deepEqual(result.attemptHistory.map((attempt) => attempt.result), ["SERVER_ERROR", "SUCCESS"]);
  } finally {
    global.fetch = originalFetch;
    restoreEnv("NCM_API_TOKEN", originalToken);
    restoreEnv("NCM_API_BASE_URL", originalBaseUrl);
    restoreEnv("NCM_HTTP_RETRY_DELAY_MS", originalRetryDelay);
  }
});