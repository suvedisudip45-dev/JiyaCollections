import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAndExecuteProfitDistribution,
  recordInvestorFinancing,
} from "../controllers/financialController.js";
import { prisma } from "../config/db.js";
import { buildProfitDistributionEstimate } from "../services/profitDistributionEstimateService.js";

const invoke = async (handler, body) => {
  let statusCode = 200;
  let responseBody;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await handler({ body }, response);
  } finally {
    console.error = originalError;
  }
  return { statusCode, responseBody };
};

test("profit distribution rejects unsupported calendar semantics with a client error", async () => {
  const result = await invoke(calculateAndExecuteProfitDistribution, {
    periodStart: "2083-01-01",
    periodEnd: "2083-01-30",
    calendar: "LUNAR",
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.responseBody.success, false);
  assert.equal(result.responseBody.code, "INVALID_CALENDAR");
});

test("profit-share preview is estimate-only and identifies operational fallbacks", () => {
  const estimate = buildProfitDistributionEstimate({
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-01-31T23:59:59.999Z"),
    fiscalYear: "2082/2083",
    retainedEarningsPercentage: 20,
    grossRevenue: 1000,
    cogs: 100,
    operatingExpenses: 50,
    calculationBasis: {
      revenue: "POSTED_GL",
      cogs: "OPERATIONAL_ESTIMATE",
      operatingExpenses: "POSTED_GL",
    },
    partners: [
      { id: "partner-1", partnerName: "Partner One", ownershipPercentage: 60 },
      { id: "partner-2", partnerName: "Partner Two", ownershipPercentage: 40 },
    ],
  });

  assert.equal(estimate.netProfit, 850);
  assert.equal(estimate.distributableAmount, 680);
  assert.deepEqual(estimate.calculationBasis, {
    revenue: "POSTED_GL",
    cogs: "OPERATIONAL_ESTIMATE",
    operatingExpenses: "POSTED_GL",
  });
  assert.deepEqual(estimate.partnerBreakdown.map((partner) => partner.amount), [408, 272]);
  assert.match(estimate.limitations.join(" "), /not a declaration/i);
});

test("legacy payout request only returns an estimate and performs no financial writes", async () => {
  const restorers = [];
  const replace = (delegate, methodName, implementation) => {
    const original = delegate[methodName];
    delegate[methodName] = implementation;
    restorers.push(() => { delegate[methodName] = original; });
  };
  let aggregateCall = 0;
  let writeCalls = 0;
  const write = async () => {
    writeCalls += 1;
    return {};
  };

  try {
    replace(prisma.order, "findMany", async () => []);
    replace(prisma.operatingExpense, "findMany", async () => []);
    replace(prisma.partnerEquity, "findMany", async () => [
      { id: "partner-1", partnerName: "Partner One", ownershipPercentage: 100 },
    ]);
    replace(prisma.journalLine, "aggregate", async () => {
      aggregateCall += 1;
      if (aggregateCall === 1) return { _sum: { debit: 100, credit: 0 } };
      if (aggregateCall === 2) return { _sum: { credit: 1000, debit: 0 } };
      return { _sum: { debit: 50, credit: 0 } };
    });

    [
      [prisma.profitDistribution, "create"],
      [prisma.accountPayable, "create"],
      [prisma.financialAccount, "update"],
      [prisma.partnerEquity, "update"],
      [prisma.cashTransaction, "create"],
      [prisma.journalEntry, "create"],
      [prisma.accountingEvent, "create"],
      [prisma.account, "update"],
      [prisma.journalSequence, "upsert"],
    ].forEach(([delegate, methodName]) => replace(delegate, methodName, write));

    const result = await invoke(calculateAndExecuteProfitDistribution, {
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      calendar: "AD",
      retainedEarningsPercentage: 20,
      executePayout: true,
      fromAccountId: "treasury-1",
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.responseBody.estimateOnly, true);
    assert.equal(result.responseBody.estimate.distributableAmount, 680);
    assert.equal(writeCalls, 0);
  } finally {
    restorers.reverse().forEach((restore) => restore());
  }
});

test("investor financing rejects unsupported calendar semantics with a client error", async () => {
  const result = await invoke(recordInvestorFinancing, {
    investorName: "Test lender",
    principalAmount: 1000,
    startDate: "2083-01-01",
    calendar: "LUNAR",
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.responseBody.success, false);
  assert.equal(result.responseBody.code, "INVALID_CALENDAR");
});
