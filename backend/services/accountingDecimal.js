import { Prisma } from "@prisma/client";

const INTERNAL_PRECISION = 80;
const MAX_DATABASE_PRECISION = 65;
const MAX_DATABASE_SCALE = 30;
const AccountingDecimal = Prisma.Decimal.clone({ precision: INTERNAL_PRECISION });
const MaximumProductDecimal = Prisma.Decimal.clone({ precision: INTERNAL_PRECISION * 2 + 1 });
const ROUNDING_MODES = new Set([
  AccountingDecimal.ROUND_UP,
  AccountingDecimal.ROUND_DOWN,
  AccountingDecimal.ROUND_CEIL,
  AccountingDecimal.ROUND_FLOOR,
  AccountingDecimal.ROUND_HALF_UP,
  AccountingDecimal.ROUND_HALF_DOWN,
  AccountingDecimal.ROUND_HALF_EVEN,
  AccountingDecimal.ROUND_HALF_CEIL,
  AccountingDecimal.ROUND_HALF_FLOOR,
]);

export const CURRENCY_PRECISION = Object.freeze({
  NPR: Object.freeze({
    fractionDigits: 2,
    roundingMode: AccountingDecimal.ROUND_HALF_EVEN,
    status: "INTERNAL_APPROVED",
  }),
});

const decimalError = (code, message) => Object.assign(new TypeError(message), { code });

const assertIntegerInRange = (value, min, max, fieldName) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw decimalError("INVALID_DECIMAL_PRECISION", `${fieldName} must be an integer from ${min} to ${max}.`);
  }
};

const assertRoundingMode = (roundingMode) => {
  if (!ROUNDING_MODES.has(roundingMode)) {
    throw decimalError("ROUNDING_MODE_REQUIRED", "An explicit supported Decimal rounding mode is required.");
  }
};

const significantDigitsOf = (amount) => {
  const coefficient = amount.toString().toLowerCase().split("e")[0].replace(/[^0-9]/g, "");
  return coefficient.replace(/^0+/, "").length || 1;
};

const assertSupportedCalculationResult = (amount) => {
  if (
    !amount.isFinite() ||
    significantDigitsOf(amount) > INTERNAL_PRECISION
  ) {
    throw decimalError(
      "UNSUPPORTED_DECIMAL_PRECISION",
      `The result exceeds the supported ${INTERNAL_PRECISION}-digit calculation precision.`,
    );
  }
  return new AccountingDecimal(amount.toString());
};

export const accountingDecimal = (value, fieldName = "Amount") => {
  let text;
  if (typeof value === "string") {
    text = value.trim();
  } else if (Prisma.Decimal.isDecimal(value) || value instanceof AccountingDecimal) {
    text = value.toString();
  } else {
    throw decimalError("INVALID_DECIMAL_INPUT", `${fieldName} must be a decimal string or Prisma Decimal.`);
  }

  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
    throw decimalError("INVALID_DECIMAL_INPUT", `${fieldName} must be a valid finite decimal.`);
  }
  let amount;
  try {
    amount = new AccountingDecimal(text);
  } catch {
    throw decimalError("INVALID_DECIMAL_INPUT", `${fieldName} must be a valid finite decimal.`);
  }
  if (significantDigitsOf(amount) > INTERNAL_PRECISION) {
    throw decimalError(
      "UNSUPPORTED_DECIMAL_PRECISION",
      `${fieldName} exceeds the supported ${INTERNAL_PRECISION}-digit calculation precision.`,
    );
  }

  if (!amount.isFinite()) {
    throw decimalError("INVALID_DECIMAL_INPUT", `${fieldName} must be a valid finite decimal.`);
  }
  return amount;
};

export const addDecimals = (...values) => {
  if (values.length === 0) return new AccountingDecimal(0);
  const amounts = values.map((value) => accountingDecimal(value));
  const nonZeroAmounts = amounts.filter((amount) => !amount.isZero());
  if (nonZeroAmounts.length === 0) return new AccountingDecimal(0);
  if (nonZeroAmounts.length === 1) return nonZeroAmounts[0];
  const maxExponent = Math.max(...nonZeroAmounts.map((amount) => amount.e));
  const maxDecimalPlaces = Math.max(...nonZeroAmounts.map((amount) => amount.decimalPlaces()));
  const requiredPrecision = maxExponent + maxDecimalPlaces + 1 + Math.ceil(Math.log10(nonZeroAmounts.length));
  if (requiredPrecision > INTERNAL_PRECISION + 1) {
    throw decimalError(
      "UNSUPPORTED_DECIMAL_PRECISION",
      `The addition exceeds the supported ${INTERNAL_PRECISION}-digit calculation precision.`,
    );
  }
  const CalculationDecimal = Prisma.Decimal.clone({
    precision: Math.max(INTERNAL_PRECISION + 1, requiredPrecision),
  });
  const total = amounts.reduce(
    (sum, amount) => sum.plus(amount.toString()),
    new CalculationDecimal(0),
  );
  return assertSupportedCalculationResult(total);
};

export const subtractDecimals = (left, right) => addDecimals(left, multiplyDecimals(right, "-1"));

export const multiplyDecimals = (left, right) => {
  const product = new MaximumProductDecimal(
    accountingDecimal(left).toString(),
  ).times(accountingDecimal(right).toString());
  return assertSupportedCalculationResult(product);
};

export const divideDecimals = (left, right, { significantDigits, roundingMode } = {}) => {
  assertIntegerInRange(significantDigits, 1, INTERNAL_PRECISION, "significantDigits");
  assertRoundingMode(roundingMode);
  const numerator = accountingDecimal(left);
  const denominator = accountingDecimal(right);
  if (denominator.isZero()) {
    throw decimalError("DECIMAL_DIVISION_BY_ZERO", "Decimal division by zero is not allowed.");
  }
  const DivisionDecimal = Prisma.Decimal.clone({
    precision: significantDigits,
    rounding: roundingMode,
  });
  return assertSupportedCalculationResult(
    new DivisionDecimal(numerator.toString()).dividedBy(denominator.toString()),
  );
};

export const compareDecimals = (left, right) =>
  accountingDecimal(left).comparedTo(accountingDecimal(right));

export const quantizeDecimal = (value, scale, roundingMode) => {
  assertIntegerInRange(scale, 0, INTERNAL_PRECISION, "scale");
  assertRoundingMode(roundingMode);
  return assertSupportedCalculationResult(accountingDecimal(value).toDecimalPlaces(scale, roundingMode));
};

export const quantizeCurrencyAmount = (value, currency, { roundingMode } = {}) => {
  const code = String(currency || "").trim().toUpperCase();
  const policy = CURRENCY_PRECISION[code];
  if (!policy) {
    throw decimalError("UNSUPPORTED_CURRENCY", `Currency precision is not configured for ${code || "the supplied currency"}.`);
  }
  if (policy.status === "PENDING_APPROVAL") {
    throw decimalError(
      "CURRENCY_ROUNDING_POLICY_PENDING",
      `${code} rounding policy requires authorized approval before currency quantization.`,
    );
  }
  return quantizeDecimal(value, policy.fractionDigits, roundingMode ?? policy.roundingMode);
};

export const assertFitsDatabaseDecimal = (value, { precision, scale } = {}) => {
  assertIntegerInRange(precision, 1, MAX_DATABASE_PRECISION, "precision");
  assertIntegerInRange(scale, 0, Math.min(precision, MAX_DATABASE_SCALE), "scale");
  const amount = accountingDecimal(value);
  const integerDigits = amount.isZero() ? 1 : Math.max(1, amount.abs().e + 1);
  if (amount.decimalPlaces() > scale || integerDigits > precision - scale) {
    throw decimalError(
      "DECIMAL_OUT_OF_RANGE",
      `Amount does not fit Decimal(${precision}, ${scale}) without rounding or overflow.`,
    );
  }
  return amount;
};

export const quantizeNprAmount = (value) => assertFitsDatabaseDecimal(
  quantizeCurrencyAmount(value, "NPR"),
  { precision: 20, scale: 2 },
);

export const parseNprAmountString = (
  value,
  fieldName = "Amount",
  { allowNegative = false, allowZero = true } = {},
) => {
  if (
    typeof value !== "string" ||
    !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())
  ) {
    throw decimalError("INVALID_DECIMAL_INPUT", `${fieldName} must be provided as a decimal string.`);
  }
  const amount = quantizeNprAmount(accountingDecimal(value.trim(), fieldName));
  if (!allowNegative && amount.isNegative()) {
    throw decimalError("INVALID_DECIMAL_INPUT", `${fieldName} cannot be negative.`);
  }
  if (!allowZero && amount.isZero()) {
    throw decimalError("INVALID_DECIMAL_INPUT", `${fieldName} must be greater than zero.`);
  }
  return amount;
};

export const allocateDecimal = (total, weights, {
  scale,
  roundingMode,
  residualTargetIndex,
  divisionSignificantDigits,
} = {}) => {
  assertIntegerInRange(scale, 0, INTERNAL_PRECISION, "scale");
  assertRoundingMode(roundingMode);
  assertIntegerInRange(divisionSignificantDigits, 1, INTERNAL_PRECISION, "divisionSignificantDigits");
  if (!Array.isArray(weights) || weights.length === 0) {
    throw decimalError("INVALID_ALLOCATION_WEIGHTS", "At least one allocation weight is required.");
  }
  assertIntegerInRange(residualTargetIndex, 0, weights.length - 1, "residualTargetIndex");

  const amount = accountingDecimal(total, "Allocation total");
  if (amount.decimalPlaces() > scale) {
    throw decimalError("ALLOCATION_TOTAL_SCALE_EXCEEDED", "Allocation total exceeds the requested scale.");
  }
  const normalizedWeights = weights.map((weight) => accountingDecimal(weight, "Allocation weight"));
  if (normalizedWeights.some((weight) => weight.isNegative())) {
    throw decimalError("INVALID_ALLOCATION_WEIGHTS", "Allocation weights cannot be negative.");
  }
  const weightTotal = addDecimals(...normalizedWeights);
  if (weightTotal.isZero()) {
    throw decimalError("INVALID_ALLOCATION_WEIGHTS", "Allocation weights must have a positive total.");
  }

  const allocations = normalizedWeights.map((weight) => {
    const proportionalAmount = divideDecimals(
      multiplyDecimals(amount, weight),
      weightTotal,
      { significantDigits: divisionSignificantDigits, roundingMode },
    );
    return quantizeDecimal(proportionalAmount, scale, roundingMode);
  });
  const residualApplied = subtractDecimals(amount, addDecimals(...allocations));
  allocations[residualTargetIndex] = addDecimals(allocations[residualTargetIndex], residualApplied);
  if (!addDecimals(...allocations).equals(amount)) {
    throw new Error("Decimal allocation failed to preserve the source total.");
  }
  return { allocations, total: amount, residualApplied };
};

export const serializeAccountingDecimal = (value) => accountingDecimal(value).toString();

export const serializeAccountingValue = (value) => {
  if (Prisma.Decimal.isDecimal(value) || value instanceof AccountingDecimal) return value.toString();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(serializeAccountingValue);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, serializeAccountingValue(child)]),
    );
  }
  return value;
};
