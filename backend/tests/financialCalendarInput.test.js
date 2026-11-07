import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAndExecuteProfitDistribution,
  recordInvestorFinancing,
} from "../controllers/financialController.js";

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
