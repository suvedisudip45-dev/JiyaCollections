import assert from "node:assert/strict";
import test from "node:test";
import { collectReceivable } from "../controllers/treasuryAccountingController.js";
import financialRouter from "../routes/financialRoute.js";

test("the finance collect-receivable route mounts the Treasury receipt controller", () => {
  const route = financialRouter.stack.find((layer) => layer.route?.path === "/collect-receivable");
  assert.ok(route, "Expected /api/finance/collect-receivable to be mounted");
  assert.equal(route.route.stack.at(-1).handle, collectReceivable);
});

test("the mounted receipt controller rejects a missing authenticated actor", async () => {
  let responseStatus = 200;
  let responseBody;
  const response = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };
  await collectReceivable({
    body: {
      invoiceIds: ["invoice-1"],
      amount: "5.00",
      toAccountId: "treasury-1",
      idempotencyKey: "receipt-key-1",
    },
    headers: {},
    auth: {},
  }, response);
  assert.equal(responseStatus, 401);
  assert.equal(responseBody.code, "RECEIPT_ACTOR_REQUIRED");
});
