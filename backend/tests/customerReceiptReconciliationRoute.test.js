import assert from "node:assert/strict";
import test from "node:test";
import { getCustomerReceiptReconciliationReport } from "../controllers/customerReceiptReconciliationController.js";
import financialRouter from "../routes/financialRoute.js";

test("receipt reconciliation is mounted behind Treasury read authorization", () => {
  const route = financialRouter.stack.find((layer) => layer.route?.path === "/receipt-reconciliation");
  assert.ok(route);
  assert.equal(route.route.stack.at(-1).handle, getCustomerReceiptReconciliationReport);
  assert.equal(route.route.stack.length, 3);
});
