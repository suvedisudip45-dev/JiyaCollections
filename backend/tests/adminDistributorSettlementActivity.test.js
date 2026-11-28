import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import { getAdminDistributorSettlementActivity } from "../controllers/adminDistributorDetailController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

test("Admin distributor settlement activity merges request types and keeps source-linked amounts", async (t) => {
  let rawQueryCount = 0;
  const occurredAt = new Date("2026-07-01T10:00:00.000Z");
  stubMethod(t, prisma.distributor, "findUnique", async () => ({ id: "distributor-1" }));
  stubMethod(t, prisma, "$queryRaw", async () => {
    rawQueryCount += 1;
    return rawQueryCount === 1
      ? [{ total: 3 }]
      : [
          { activityType: "NET_BALANCE_REQUEST", sourceId: "net-1", occurredAt },
          { activityType: "EARNINGS_REQUEST", sourceId: "earn-1", occurredAt: new Date(occurredAt.getTime() - 1000) },
          { activityType: "NET_BALANCE_SETTLEMENT", sourceId: "posted-1", occurredAt: new Date(occurredAt.getTime() - 2000) },
        ];
  });
  stubMethod(t, prisma.distributorSettlementRequest, "findMany", async () => [{
    id: "earn-1",
    amount: "200.00",
    paidAmount: "75.00",
    status: "PARTIALLY_PAID",
    requestedAt: occurredAt,
  }]);
  stubMethod(t, prisma.distributorSettlementRequestToken, "findMany", async () => [{
    id: "net-1",
    status: "REQUESTED",
    requestedAmount: "300.00",
    settlement: null,
    transferReference: "BANK-001",
    evidenceUrl: "https://evidence.example/transfer.png",
  }]);
  stubMethod(t, prisma.distributorBalanceSettlement, "findMany", async () => [{
    id: "posted-1",
    direction: "COMPANY_COLLECTS",
    status: "POSTED",
    cashAmount: "125.00",
    offsetAmount: "25.00",
    journalEntryId: "journal-1",
    cashTransactionId: "cash-1",
    journalEntry: { id: "journal-1", journalNumber: "JE-1" },
    cashTransaction: { id: "cash-1", amount: "125.00" },
  }]);
  stubMethod(t, prisma.financialPayout, "findMany", async () => []);
  stubMethod(t, prisma.cashTransaction, "findMany", async () => []);
  stubMethod(t, prisma.journalEntry, "findMany", async () => []);

  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await getAdminDistributorSettlementActivity({
    params: { id: "distributor-1" },
    query: { page: "1", limit: "10" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.activities.length, 3);
  assert.equal(response.body.activities[0].id, "NET_BALANCE_REQUEST:net-1");
  assert.equal(response.body.activities[0].remainingAmount, 300);
  assert.equal(response.body.activities[1].remainingAmount, 125);
  assert.equal(response.body.activities[2].journalEntryId, "journal-1");
  assert.equal(response.body.pagination.total, 3);
});
