import test from "node:test";
import assert from "node:assert/strict";
import {
  cancelFutureCorporateTaxPolicyVersion,
  calculateCorporateIncomeTax,
  calculateCorporateIncomeTaxProjection,
  createCorporateTaxPolicyVersion,
} from "../services/corporateIncomeTaxService.js";

test("corporate income tax uses the configured flat rate rather than a code default", () => {
  const result = calculateCorporateIncomeTax({
    taxableIncome: 100000,
    policy: { baseRate: "28.00", brackets: [], rules: [] },
  });

  assert.equal(result.configured, true);
  assert.equal(result.taxRate, 28);
  assert.equal(result.estimatedTax, 28000);
});

test("corporate income tax calculates progressive brackets", () => {
  const result = calculateCorporateIncomeTax({
    taxableIncome: 3000,
    policy: {
      baseRate: 25,
      brackets: [
        { upToIncome: 1000, rate: 10 },
        { upToIncome: null, rate: 20 },
      ],
      rules: [],
    },
  });

  test("monthly projections annualize income for annual brackets and return a monthly estimate", () => {
    const result = calculateCorporateIncomeTaxProjection({
      periodTaxableIncome: 1000,
      policy: {
        baseRate: 25,
        brackets: [{ upToIncome: 12000, rate: 10 }, { upToIncome: null, rate: 20 }],
        rules: [],
      },
    });

    assert.equal(result.annualizedTaxableIncome, 12000);
    assert.equal(result.taxBeforeAdjustments, 100);
    assert.equal(result.estimatedTax, 100);
  });

  assert.equal(result.taxBeforeAdjustments, 500);
  assert.equal(result.taxRate, 16.67);
  assert.equal(result.estimatedTax, 500);
});

test("corporate income tax applies matching user/location rules and reports adjustments", () => {
  const result = calculateCorporateIncomeTax({
    taxableIncome: 10000,
    policy: {
      baseRate: 25,
      brackets: [],
      rules: [
        { when: { userId: "user-1" }, ratePercent: 10 },
        { when: { province: "Koshi" }, discountPercent: 10, penaltyPercent: 5, penaltyAmount: 5 },
        { when: { district: "Kathmandu" }, discountAmount: 200 },
      ],
    },
    context: { userId: "user-1", province: "koshi", district: "Kathmandu" },
  });

  assert.equal(result.taxBeforeAdjustments, 1000);
  assert.equal(result.discountAmount, 300);
  assert.equal(result.penaltyAmount, 55);
  assert.equal(result.estimatedTax, 755);
  assert.equal(result.appliedRules.length, 3);
});

test("corporate income tax stays explicitly unconfigured when no policy applies", () => {
  const result = calculateCorporateIncomeTax({ taxableIncome: 1000 });

  assert.equal(result.configured, false);
  assert.equal(result.estimatedTax, null);
});

test("corporate tax policy scheduling stores validated brackets and context rules", async () => {
  const state = { versions: [], updates: [] };
  const tx = {
    corporateTaxPolicyVersion: {
      findFirst: async () => state.versions.at(-1) || null,
      updateMany: async (args) => {
        state.updates.push(args);
        return { count: 1 };
      },
      create: async ({ data }) => {
        const row = { ...data, effectiveUntil: null };
        state.versions.push(row);
        return row;
      },
    },
  };
  const client = {
    ...tx,
    $transaction: async (callback) => callback(tx),
  };
  const effectiveFrom = new Date("2027-01-01T00:00:00.000Z");
  const version = await createCorporateTaxPolicyVersion({
    baseRate: "25.5",
    fiscalYear: "2083/2084",
    brackets: [{ upToIncome: null, rate: 25.5 }],
    rules: [{ when: { province: "Bagmati" }, discountPercent: 2 }],
    effectiveFrom,
    now: new Date("2026-12-01T00:00:00.000Z"),
    client,
  });

  assert.equal(version.fiscalYear, "2083/2084");
  assert.equal(version.baseRate.toString(), "25.5");
  assert.deepEqual(version.brackets, [{ upToIncome: null, rate: 25.5 }]);
  assert.deepEqual(version.rules, [{ when: { province: "Bagmati" }, discountPercent: 2 }]);
});

test("corporate tax policy rejects non-terminal unbounded brackets and invalid selectors", async () => {
  const client = { corporateTaxPolicyVersion: {} };
  await assert.rejects(
    createCorporateTaxPolicyVersion({
      baseRate: 25,
      fiscalYear: "2083/2084",
      brackets: [{ upToIncome: 1000, rate: 10 }],
      rules: [],
      effectiveFrom: "2027-01-01T00:00:00.000Z",
      now: new Date("2026-12-01T00:00:00.000Z"),
      client,
    }),
    { code: "INVALID_CORPORATE_TAX_BRACKETS" },
  );
  await assert.rejects(
    createCorporateTaxPolicyVersion({
      baseRate: 25,
      fiscalYear: "2083/2084",
      brackets: [],
      rules: [{ when: { unsupported: "x" } }],
      effectiveFrom: "2027-01-01T00:00:00.000Z",
      now: new Date("2026-12-01T00:00:00.000Z"),
      client,
    }),
    { code: "INVALID_CORPORATE_TAX_RULES" },
  );
});

test("cancelling the latest future policy reopens the prior effective version", async () => {
  const future = {
    id: "future-policy",
    fiscalYear: "2084/2085",
    baseRate: "25.00",
    effectiveFrom: new Date("2028-07-01T00:00:00.000Z"),
    effectiveUntil: null,
    status: "ACTIVE",
  };
  const previous = {
    id: "current-policy",
    fiscalYear: "2083/2084",
    effectiveFrom: new Date("2027-07-01T00:00:00.000Z"),
    effectiveUntil: future.effectiveFrom,
    status: "ACTIVE",
  };
  const updates = [];
  const tx = {
    corporateTaxPolicyVersion: {
      findUnique: async () => future,
      findFirst: async ({ where }) => (where.effectiveFrom?.lt ? previous : future),
      updateMany: async (args) => {
        updates.push(args);
        return { count: 1 };
      },
    },
  };
  const client = {
    ...tx,
    $transaction: async (callback) => callback(tx),
  };

  const cancelled = await cancelFutureCorporateTaxPolicyVersion({
    id: future.id,
    client,
    now: new Date("2026-11-04T00:00:00.000Z"),
  });

  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[1].data, { effectiveUntil: null });
});
