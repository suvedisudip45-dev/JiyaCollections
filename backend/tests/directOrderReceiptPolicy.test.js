import assert from "node:assert/strict";
import test from "node:test";
import {
  createDirectOrder,
  updateDirectOrderStatus,
} from "../controllers/manufacturerDirectOrderController.js";
import {
  createDistributorDirectOrder,
  updateDistributorDirectOrderStatus,
} from "../controllers/distributorDirectOrderController.js";
import { adminCreateOrder } from "../controllers/orderController.js";

const invoke = async (handler, req) => {
  const result = { statusCode: 200, body: null };
  const res = {
    status(statusCode) {
      result.statusCode = statusCode;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  await handler(req, res);
  return result;
};

const assertReceiptRequired = (result) => {
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, "DIRECT_ORDER_RECEIPT_REQUIRED");
};

test("manufacturer direct-order creation rejects a paid declaration before database access", async () => {
  assertReceiptRequired(await invoke(createDirectOrder, {
    body: { isPaid: true },
  }));
});

test("manufacturer direct-order status rejects payment mutation before database access", async () => {
  assertReceiptRequired(await invoke(updateDirectOrderStatus, {
    body: { orderId: "order-1", status: "Delivered", payment: true },
  }));
});

test("distributor direct-order creation rejects a paid declaration before database access", async () => {
  assertReceiptRequired(await invoke(createDistributorDirectOrder, {
    body: { isPaid: true },
  }));
});

test("distributor direct-order status rejects payment mutation before database access", async () => {
  assertReceiptRequired(await invoke(updateDistributorDirectOrderStatus, {
    body: { orderId: "order-1", status: "Delivered", payment: true },
  }));
});

test("Admin direct-order creation rejects a paid declaration before database access", async () => {
  assertReceiptRequired(await invoke(adminCreateOrder, {
    body: { payment: true },
  }));
});
