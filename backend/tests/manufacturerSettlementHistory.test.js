import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import {
  getManufacturerSettlementRequests,
  listAdminManufacturerSettlements,
} from "../controllers/manufacturerFinanceController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const createResponse = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const withSettlementHistoryStubs = (t) => {
  const request = {
    id: "request-1",
    manufacturerId: "manufacturer-1",
    amount: "500.00",
    paidAmount: "250.00",
    status: "PARTIALLY_PAID",
  };
  stubMethod(t, prisma.manufacturerSettlementRequest, "findMany", async () => [request]);
  stubMethod(t, prisma.manufacturerSettlementRequest, "count", async () => 1);
  stubMethod(t, prisma.financialPayout, "findMany", async () => [{
    id: "payout-1",
    targetId: "request-1",
    idempotencyKey: "mfg-payout-1",
    amount: "250.00",
    settlementAmount: "250.00",
    status: "SETTLED",
    externalPaymentReference: "BANK-TRANSFER-1",
    bankEvidenceReference: "BANK-SLIP-1",
    initiatedAt: new Date("2026-07-01T10:00:00.000Z"),
    financialAccount: { id: "account-1", accountName: "Main Bank", accountType: "BANK" },
  }]);
  stubMethod(t, prisma.cashTransaction, "findMany", async () => [{
    id: "cash-1",
    idempotencyKey: "mfg-payout-1",
    type: "OUTFLOW",
    amount: "250.00",
  }]);
  stubMethod(t, prisma.journalEntry, "findMany", async () => [{
    id: "journal-1",
    idempotencyKey: "SUPPLIER_PAYMENT:mfg-payout-1",
    journalNumber: "JE-2026-0001",
  }]);
  stubMethod(t, prisma, "$transaction", async (operations) => Promise.all(operations));
};

for (const [label, handler, request] of [
  [
    "manufacturer-scoped",
    getManufacturerSettlementRequests,
    { manufacturerId: "manufacturer-1", query: { page: "1", limit: "10" } },
  ],
  [
    "admin",
    listAdminManufacturerSettlements,
    { query: { page: "1", limit: "10", manufacturerId: "manufacturer-1" } },
  ],
]) {
  test(`${label} settlement history includes linked payout, cash, and journal records`, async (t) => {
    withSettlementHistoryStubs(t);
    const response = createResponse();
    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.settlements[0].payoutHistory.length, 1);
    assert.equal(response.body.settlements[0].payoutHistory[0].financialAccount.accountName, "Main Bank");
    assert.equal(response.body.settlements[0].payoutHistory[0].cashTransaction.id, "cash-1");
    assert.equal(response.body.settlements[0].payoutHistory[0].journalEntry.journalNumber, "JE-2026-0001");
  });
}
