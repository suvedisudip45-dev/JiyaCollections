import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import { adminSimulateNcmWebhook } from "../controllers/deliveryController.js";

const originalEnv = {
  appEnv: process.env.APP_ENV,
  nodeEnv: process.env.NODE_ENV,
  enabled: process.env.NCM_WEBHOOK_SIMULATOR_ENABLED,
};

const restoreEnv = () => {
  if (originalEnv.appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = originalEnv.appEnv;
  if (originalEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.nodeEnv;
  if (originalEnv.enabled === undefined) delete process.env.NCM_WEBHOOK_SIMULATOR_ENABLED;
  else process.env.NCM_WEBHOOK_SIMULATOR_ENABLED = originalEnv.enabled;
};

const callSimulator = async (body) => {
  const result = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  await adminSimulateNcmWebhook({ body, auth: { accountId: "admin-test" } }, result);
  return result;
};

const stubOrderMatchQueries = (matchModel, t) => {
  for (const modelName of ["deliveryOrder", "stockTransferShipment", "customerReturn", "orderExchangeRequest"]) {
    const model = prisma[modelName];
    const original = model.findFirst;
    model.findFirst = async () => (modelName === matchModel ? { id: `${modelName}-matched` } : null);
    t.after(() => {
      model.findFirst = original;
    });
  }
};

test("NCM webhook simulator is disabled unless explicitly enabled", async () => {
  process.env.NCM_WEBHOOK_SIMULATOR_ENABLED = "false";
  process.env.NODE_ENV = "development";
  process.env.APP_ENV = "development";

  try {
    const response = await callSimulator({ type: "status", payload: { order_id: 123, status: "Delivered" } });
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.success, false);
  } finally {
    restoreEnv();
  }
});

test("NCM webhook simulator stays disabled in production", async () => {
  process.env.NCM_WEBHOOK_SIMULATOR_ENABLED = "true";
  process.env.NODE_ENV = "production";
  process.env.APP_ENV = "production";

  try {
    const response = await callSimulator({ type: "status", payload: { order_id: 123, status: "Delivered" } });
    assert.equal(response.statusCode, 404);
  } finally {
    restoreEnv();
  }
});

test("NCM webhook simulator can be explicitly enabled for a staging deployment", async () => {
  process.env.NCM_WEBHOOK_SIMULATOR_ENABLED = "true";
  process.env.NODE_ENV = "production";
  process.env.APP_ENV = "staging";

  try {
    const response = await callSimulator({ type: "unknown", payload: {} });
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /status or comment/);
  } finally {
    restoreEnv();
  }
});

test("NCM webhook simulator rejects invalid payloads before processing", async () => {
  process.env.NCM_WEBHOOK_SIMULATOR_ENABLED = "true";
  process.env.NODE_ENV = "development";
  process.env.APP_ENV = "development";

  try {
    const invalidStatus = await callSimulator({
      type: "status",
      payload: { order_ids: ["6142", "6143"], status: "Delivered" },
    });
    assert.equal(invalidStatus.statusCode, 400);
    assert.match(invalidStatus.body.message, /exactly one numeric/);

    const invalidComment = await callSimulator({
      type: "comment",
      payload: { orderid: "not-numeric", comment: "test" },
    });
    assert.equal(invalidComment.statusCode, 400);
  } finally {
    restoreEnv();
  }
});

test("NCM webhook simulator refuses IDs linked to real delivery workflows", async (t) => {
  process.env.NCM_WEBHOOK_SIMULATOR_ENABLED = "true";
  process.env.NODE_ENV = "development";
  process.env.APP_ENV = "development";
  t.after(restoreEnv);
  stubOrderMatchQueries("deliveryOrder", t);

  const response = await callSimulator({
    type: "status",
    payload: { order_id: 6142, status: "Delivered" },
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /unmatched test order IDs/);
});

for (const [modelName, recordLabel] of [
  ["stockTransferShipment", "stock transfer"],
  ["customerReturn", "customer return"],
  ["orderExchangeRequest", "exchange"],
]) {
  test(`NCM webhook simulator refuses IDs linked only to ${recordLabel === "exchange" ? "an" : "a"} ${recordLabel}`, async (t) => {
    process.env.NCM_WEBHOOK_SIMULATOR_ENABLED = "true";
    process.env.NODE_ENV = "development";
    process.env.APP_ENV = "development";
    t.after(restoreEnv);
    stubOrderMatchQueries(modelName, t);

    const response = await callSimulator({
      type: "status",
      payload: { order_id: 6143, status: "Delivered" },
    });

    assert.equal(response.statusCode, 409);
  });
}
