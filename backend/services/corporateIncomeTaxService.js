import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";

const CONTEXT_FIELDS = new Set([
  "userId",
  "taxpayerId",
  "taxpayerType",
  "province",
  "district",
  "locationId",
]);

const fail = (message, statusCode = 400, code = "CORPORATE_TAX_POLICY_ERROR") =>
  Object.assign(new Error(message), { statusCode, code });

const inSerializableTransaction = (client, callback) =>
  typeof client.$transaction === "function"
    ? client.$transaction(callback, { isolationLevel: "Serializable" })
    : callback(client);

const parseRate = (value, label = "Tax rate") => {
  const text = String(value ?? "").trim();
  if (!/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(text)) {
    throw fail(`${label} must be a percentage with at most two decimal places.`, 400, "INVALID_CORPORATE_TAX_RATE");
  }
  const rate = Number(text);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw fail(`${label} must be between 0 and 100 percent.`, 400, "INVALID_CORPORATE_TAX_RATE");
  }
  return rate;
};

const parseAmount = (value, label) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw fail(`${label} must be a non-negative amount.`, 400, "INVALID_CORPORATE_TAX_POLICY");
  }
  return amount;
};

const normalizeBrackets = (brackets) => {
  if (!Array.isArray(brackets)) {
    throw fail("Tax brackets must be an array.", 400, "INVALID_CORPORATE_TAX_BRACKETS");
  }
  let previousLimit = 0;
  const normalized = brackets.map((bracket, index) => {
    if (!bracket || typeof bracket !== "object" || Array.isArray(bracket)) {
      throw fail(`Tax bracket ${index + 1} must be an object.`, 400, "INVALID_CORPORATE_TAX_BRACKETS");
    }
    if (Object.keys(bracket).some((key) => !["upToIncome", "rate"].includes(key))) {
      throw fail(`Tax bracket ${index + 1} has an unsupported field.`, 400, "INVALID_CORPORATE_TAX_BRACKETS");
    }
    const upToIncome = bracket.upToIncome === null ? null : parseAmount(bracket.upToIncome, "Bracket income limit");
    if (upToIncome !== null && upToIncome <= previousLimit) {
      throw fail("Tax bracket income limits must be strictly increasing.", 400, "INVALID_CORPORATE_TAX_BRACKETS");
    }
    if (upToIncome !== null) previousLimit = upToIncome;
    return { upToIncome, rate: parseRate(bracket.rate, `Tax bracket ${index + 1} rate`) };
  });
  if (normalized.length && normalized[normalized.length - 1].upToIncome !== null) {
    throw fail("The final tax bracket must use a null upToIncome to cover remaining income.", 400, "INVALID_CORPORATE_TAX_BRACKETS");
  }
  return normalized;
};

const normalizeRules = (rules) => {
  if (!Array.isArray(rules)) {
    throw fail("Tax rules must be an array.", 400, "INVALID_CORPORATE_TAX_RULES");
  }
  return rules.map((rule, index) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw fail(`Tax rule ${index + 1} must be an object.`, 400, "INVALID_CORPORATE_TAX_RULES");
    }
    const supportedFields = new Set(["when", "ratePercent", "discountPercent", "penaltyPercent", "discountAmount", "penaltyAmount"]);
    if (Object.keys(rule).some((key) => !supportedFields.has(key))) {
      throw fail(`Tax rule ${index + 1} has an unsupported field.`, 400, "INVALID_CORPORATE_TAX_RULES");
    }
    const when = rule.when ?? {};
    if (!when || typeof when !== "object" || Array.isArray(when)) {
      throw fail(`Tax rule ${index + 1} when selector must be an object.`, 400, "INVALID_CORPORATE_TAX_RULES");
    }
    const selectors = Object.entries(when).reduce((result, [key, value]) => {
      if (!CONTEXT_FIELDS.has(key) || typeof value !== "string" || !value.trim()) {
        throw fail(`Tax rule ${index + 1} has an invalid ${key} selector.`, 400, "INVALID_CORPORATE_TAX_RULES");
      }
      result[key] = value.trim();
      return result;
    }, {});
    if (!Object.keys(selectors).length) {
      throw fail(`Tax rule ${index + 1} must specify at least one context selector.`, 400, "INVALID_CORPORATE_TAX_RULES");
    }
    const normalized = { when: selectors };
    if (rule.ratePercent !== undefined && rule.ratePercent !== null) {
      normalized.ratePercent = parseRate(rule.ratePercent, `Tax rule ${index + 1} rate`);
    }
    for (const field of ["discountPercent", "penaltyPercent"]) {
      if (rule[field] !== undefined && rule[field] !== null) {
        normalized[field] = parseRate(rule[field], `Tax rule ${index + 1} ${field}`);
      }
    }
    for (const field of ["discountAmount", "penaltyAmount"]) {
      if (rule[field] !== undefined && rule[field] !== null) {
        normalized[field] = parseAmount(rule[field], `Tax rule ${index + 1} ${field}`);
      }
    }
    if (!["ratePercent", "discountPercent", "penaltyPercent", "discountAmount", "penaltyAmount"]
      .some((field) => normalized[field] !== undefined)) {
      throw fail(`Tax rule ${index + 1} must define a rate, discount, or penalty.`, 400, "INVALID_CORPORATE_TAX_RULES");
    }
    return normalized;
  });
};

const parseEffectiveFrom = (value, now) => {
  const effectiveFrom = new Date(value);
  if (!value || Number.isNaN(effectiveFrom.getTime()) || effectiveFrom <= now) {
    throw fail("A corporate tax policy can only be scheduled for a valid future effective date.", 400, "INVALID_CORPORATE_TAX_EFFECTIVE_DATE");
  }
  return effectiveFrom;
};

export const listCorporateTaxPolicyVersions = ({ client = prisma } = {}) =>
  client.corporateTaxPolicyVersion.findMany({
    orderBy: { effectiveFrom: "desc" },
    take: 100,
  });

export const createCorporateTaxPolicyVersion = async ({
  baseRate,
  fiscalYear,
  brackets = [],
  rules = [],
  effectiveFrom,
  createdBy = null,
  client = prisma,
  now = new Date(),
  afterCreate = null,
} = {}) => {
  const rate = parseRate(baseRate);
  const year = String(fiscalYear ?? "").trim();
  if (!year || year.length > 32) {
    throw fail("A fiscal year label of at most 32 characters is required.", 400, "INVALID_CORPORATE_TAX_FISCAL_YEAR");
  }
  const normalizedBrackets = normalizeBrackets(brackets);
  const normalizedRules = normalizeRules(rules);
  const startsAt = parseEffectiveFrom(effectiveFrom, now);

  try {
    return await inSerializableTransaction(client, async (tx) => {
      const latest = await tx.corporateTaxPolicyVersion.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { effectiveFrom: "desc" },
      });
      if (latest && startsAt <= latest.effectiveFrom) {
        throw fail("New corporate tax policies must be scheduled after the latest active policy.", 409, "CORPORATE_TAX_POLICY_VERSION_ORDER_CONFLICT");
      }
      if (latest && !latest.effectiveUntil) {
        const closed = await tx.corporateTaxPolicyVersion.updateMany({
          where: { id: latest.id, status: "ACTIVE", effectiveUntil: null },
          data: { effectiveUntil: startsAt },
        });
        if (closed.count !== 1) {
          throw fail("The active corporate tax policy changed concurrently. Refresh and retry.", 409, "CORPORATE_TAX_POLICY_CONCURRENCY_CONFLICT");
        }
      }

      const version = await tx.corporateTaxPolicyVersion.create({
        data: {
          id: randomUUID(),
          baseRate: new Prisma.Decimal(rate.toFixed(2)),
          fiscalYear: year,
          brackets: normalizedBrackets,
          rules: normalizedRules,
          effectiveFrom: startsAt,
          createdBy: createdBy ? String(createdBy).slice(0, 191) : null,
          status: "ACTIVE",
        },
      });
      if (afterCreate) await afterCreate(version, tx);
      return version;
    });
  } catch (error) {
    if (error?.code === "P2002" || error?.code === "P2034") {
      throw fail("Another corporate tax policy was created concurrently. Refresh and retry.", 409, "CORPORATE_TAX_POLICY_CONCURRENCY_CONFLICT");
    }
    throw error;
  }
};

export const cancelFutureCorporateTaxPolicyVersion = async ({
  id,
  client = prisma,
  now = new Date(),
  afterCancel = null,
} = {}) => {
  if (typeof id !== "string" || !id.trim()) {
    throw fail("A corporate tax policy version ID is required.", 400, "CORPORATE_TAX_POLICY_VERSION_REQUIRED");
  }
  return inSerializableTransaction(client, async (tx) => {
    const version = await tx.corporateTaxPolicyVersion.findUnique({ where: { id: id.trim() } });
    if (!version || version.status !== "ACTIVE") {
      throw fail("Active corporate tax policy version not found.", 404, "CORPORATE_TAX_POLICY_VERSION_NOT_FOUND");
    }
    if (version.effectiveFrom <= now) {
      throw fail("An effective or historical corporate tax policy cannot be cancelled; schedule a future version instead.", 409, "CORPORATE_TAX_POLICY_VERSION_IMMUTABLE");
    }
    const latest = await tx.corporateTaxPolicyVersion.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { effectiveFrom: "desc" },
    });
    if (latest?.id !== version.id) {
      throw fail("Only the latest scheduled corporate tax policy can be cancelled.", 409, "CORPORATE_TAX_POLICY_VERSION_ORDER_CONFLICT");
    }
    const cancelled = await tx.corporateTaxPolicyVersion.updateMany({
      where: { id: version.id, status: "ACTIVE", effectiveFrom: { gt: now } },
      data: { status: "CANCELLED" },
    });
    if (cancelled.count !== 1) {
      throw fail("The corporate tax policy changed concurrently. Refresh and retry.", 409, "CORPORATE_TAX_POLICY_CONCURRENCY_CONFLICT");
    }
    const previous = await tx.corporateTaxPolicyVersion.findFirst({
      where: { status: "ACTIVE", effectiveFrom: { lt: version.effectiveFrom } },
      orderBy: { effectiveFrom: "desc" },
    });
    if (previous) {
      await tx.corporateTaxPolicyVersion.updateMany({
        where: { id: previous.id, status: "ACTIVE", effectiveUntil: version.effectiveFrom },
        data: { effectiveUntil: null },
      });
    }
    const result = { ...version, status: "CANCELLED" };
    if (afterCancel) await afterCancel(result, tx);
    return result;
  });
};

export const getCorporateTaxPolicyForDate = (effectiveAt, { client = prisma } = {}) => {
  const date = effectiveAt instanceof Date ? effectiveAt : new Date(effectiveAt);
  if (Number.isNaN(date.getTime())) {
    throw fail("Tax policy effective date is invalid.", 400, "INVALID_CORPORATE_TAX_EFFECTIVE_DATE");
  }
  return client.corporateTaxPolicyVersion.findFirst({
    where: {
      status: "ACTIVE",
      effectiveFrom: { lte: date },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: date } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
};

const normalizeContextValue = (value) => String(value ?? "").trim().toLowerCase();

const matchesRule = (rule, context) =>
  Object.entries(rule.when || {}).every(([key, value]) =>
    normalizeContextValue(context[key]) === normalizeContextValue(value));

const calculateBracketTax = (income, brackets) => {
  let lowerLimit = 0;
  let totalTax = 0;
  for (const bracket of brackets) {
    const upperLimit = bracket.upToIncome === null ? income : Math.min(income, Number(bracket.upToIncome));
    const taxableBand = Math.max(0, upperLimit - lowerLimit);
    totalTax += taxableBand * Number(bracket.rate) / 100;
    if (bracket.upToIncome === null || income <= Number(bracket.upToIncome)) break;
    lowerLimit = Number(bracket.upToIncome);
  }
  return totalTax;
};

export const calculateCorporateIncomeTax = ({ taxableIncome, policy, context = {} } = {}) => {
  const parsedIncome = taxableIncome === undefined || taxableIncome === null || taxableIncome === ""
    ? 0
    : Number(taxableIncome);
  if (!Number.isFinite(parsedIncome)) {
    throw fail("Taxable income must be a finite amount.", 400, "INVALID_CORPORATE_TAXABLE_INCOME");
  }
  const income = Math.max(0, parsedIncome);
  if (!policy) {
    return {
      configured: false,
      taxableIncome: Number(income.toFixed(2)),
      estimatedTax: null,
      taxBeforeAdjustments: null,
      discountAmount: null,
      penaltyAmount: null,
      taxRate: null,
      appliedRules: [],
    };
  }

  const rules = Array.isArray(policy.rules) ? policy.rules : [];
  const matchingRules = rules.filter((rule) => matchesRule(rule, context));
  const mostSpecificRateRule = matchingRules
    .filter((rule) => Number.isFinite(Number(rule.ratePercent)))
    .sort((left, right) => Object.keys(right.when || {}).length - Object.keys(left.when || {}).length)[0];
  const taxRateOverride = mostSpecificRateRule?.ratePercent;
  const brackets = Array.isArray(policy.brackets) ? policy.brackets : [];
  const taxBeforeAdjustments = Number((
    taxRateOverride !== undefined
      ? income * Number(taxRateOverride) / 100
      : brackets.length
        ? calculateBracketTax(income, brackets)
        : income * Number(policy.baseRate) / 100
  ).toFixed(2));
  const discountPercent = Math.min(100, matchingRules.reduce((total, rule) => total + Number(rule.discountPercent || 0), 0));
  const penaltyPercent = matchingRules.reduce((total, rule) => total + Number(rule.penaltyPercent || 0), 0);
  const configuredDiscountAmount = matchingRules.reduce((total, rule) => total + Number(rule.discountAmount || 0), 0);
  const discountAmount = Number(Math.min(
    taxBeforeAdjustments,
    taxBeforeAdjustments * discountPercent / 100 + configuredDiscountAmount,
  ).toFixed(2));
  const penaltyAmount = Number((
    taxBeforeAdjustments * penaltyPercent / 100 +
    matchingRules.reduce((total, rule) => total + Number(rule.penaltyAmount || 0), 0)
  ).toFixed(2));
  const estimatedTax = Number(Math.max(0, taxBeforeAdjustments - discountAmount + penaltyAmount).toFixed(2));

  return {
    configured: true,
    taxableIncome: Number(income.toFixed(2)),
    estimatedTax,
    taxBeforeAdjustments,
    discountAmount,
    penaltyAmount,
    taxRate: income > 0 ? Number((taxBeforeAdjustments / income * 100).toFixed(2)) : Number(taxRateOverride ?? policy.baseRate),
    appliedRules: matchingRules.map((rule) => rule.when),
  };
};

export const calculateCorporateIncomeTaxProjection = ({ periodTaxableIncome, policy, context = {} } = {}) => {
  const parsedPeriodIncome = periodTaxableIncome === undefined || periodTaxableIncome === null || periodTaxableIncome === ""
    ? 0
    : Number(periodTaxableIncome);
  if (!Number.isFinite(parsedPeriodIncome)) {
    throw fail("Taxable income must be a finite amount.", 400, "INVALID_CORPORATE_TAXABLE_INCOME");
  }
  const periodIncome = Math.max(0, parsedPeriodIncome);
  const annualCalculation = calculateCorporateIncomeTax({
    taxableIncome: periodIncome * 12,
    policy,
    context,
  });
  const monthlyAmount = (amount) => amount === null ? null : Number((amount / 12).toFixed(2));
  return {
    ...annualCalculation,
    taxableIncome: Number(periodIncome.toFixed(2)),
    annualizedTaxableIncome: annualCalculation.taxableIncome,
    estimatedTax: monthlyAmount(annualCalculation.estimatedTax),
    taxBeforeAdjustments: monthlyAmount(annualCalculation.taxBeforeAdjustments),
    discountAmount: monthlyAmount(annualCalculation.discountAmount),
    penaltyAmount: monthlyAmount(annualCalculation.penaltyAmount),
  };
};
