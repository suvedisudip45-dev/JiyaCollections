import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  CURRENCY_PRECISION,
  accountingDecimal,
  addDecimals,
  allocateDecimal,
  assertFitsDatabaseDecimal,
  compareDecimals,
  divideDecimals,
  multiplyDecimals,
  parseNprAmountString,
  quantizeCurrencyAmount,
  quantizeDecimal,
  quantizeNprAmount,
  serializeAccountingDecimal,
  serializeAccountingValue,
  subtractDecimals,
} from "../services/accountingDecimal.js";

const roundingMode = Prisma.Decimal.ROUND_HALF_EVEN;

test("constructs exact values from decimal strings and Prisma Decimal values", () => {
  const source = new Prisma.Decimal("12345678901234567890.123456789");
  assert.equal(accountingDecimal(source).toString(), "12345678901234567890.123456789");
  assert.equal(serializeAccountingDecimal(accountingDecimal("0.1000000000000000001")), "0.1000000000000000001");
  assert.equal(compareDecimals("0.1", "0.10"), 0);

  let converted = "0.1000000000000000001";
  for (let index = 0; index < 100; index += 1) {
    converted = accountingDecimal(new Prisma.Decimal(converted)).toString();
  }
  assert.equal(converted, "0.1000000000000000001");
});

test("supports exact arithmetic, negative corrections, large values, and explicit division precision", () => {
  assert.equal(addDecimals("0.1", "0.2").toString(), "0.3");
  assert.equal(addDecimals("0", "1e80").toString(), "1e+80");
  assert.equal(subtractDecimals("1", "2").toString(), "-1");
  assert.equal(multiplyDecimals("12345678901234567890.1234", "3").toString(), "37037036703703703670.3702");
  assert.equal(
    divideDecimals("1", "8", { significantDigits: 40, roundingMode }).toString(),
    "0.125",
  );
  assert.equal(
    divideDecimals("1", "3", { significantDigits: 12, roundingMode }).toString(),
    "0.333333333333",
  );
  assert.equal(
    divideDecimals("1", "3000", { significantDigits: 80, roundingMode }).isFinite(),
    true,
  );
  assert.equal(quantizeDecimal("-1.005", 2, roundingMode).toString(), "-1");
  assert.equal(quantizeDecimal("1.015", 2, roundingMode).toString(), "1.02");
});

test("allocates a total exactly and assigns rounding residual to the requested destination", () => {
  const result = allocateDecimal("10.00", ["1", "1", "1"], {
    scale: 2,
    roundingMode,
    residualTargetIndex: 2,
    divisionSignificantDigits: 40,
  });

  assert.deepEqual(result.allocations.map((amount) => amount.toString()), ["3.33", "3.33", "3.34"]);
  assert.equal(result.residualApplied.toString(), "0.01");
  assert.equal(addDecimals(...result.allocations).toString(), result.total.toString());

  const negative = allocateDecimal("-1.00", ["1", "1"], {
    scale: 2,
    roundingMode,
    residualTargetIndex: 1,
    divisionSignificantDigits: 40,
  });
  assert.equal(addDecimals(...negative.allocations).toString(), "-1");
});

test("validates malformed inputs, precision, scale, overflow, and division by zero", () => {
  for (const value of [1, null, "", " ", "NaN", "Infinity", "1.2.3"]) {
    assert.throws(() => accountingDecimal(value), { code: "INVALID_DECIMAL_INPUT" });
  }
  assert.throws(() => accountingDecimal("1".padEnd(82, "2")), {
    code: "UNSUPPORTED_DECIMAL_PRECISION",
  });
  assert.equal(accountingDecimal(`0.${"0".repeat(80)}1`).toString(), "1e-81");
  assert.throws(() => addDecimals("1e1000", "1e-80"), {
    code: "UNSUPPORTED_DECIMAL_PRECISION",
  });
  assert.throws(() => multiplyDecimals("9".repeat(80), "9".repeat(80)), {
    code: "UNSUPPORTED_DECIMAL_PRECISION",
  });
  assert.throws(() => divideDecimals("1", "0", { significantDigits: 20, roundingMode }), {
    code: "DECIMAL_DIVISION_BY_ZERO",
  });
  assert.throws(() => divideDecimals("1", "3", { significantDigits: 0, roundingMode }), {
    code: "INVALID_DECIMAL_PRECISION",
  });
  assert.throws(() => quantizeDecimal("1.2", 2), { code: "ROUNDING_MODE_REQUIRED" });
  assert.throws(() => assertFitsDatabaseDecimal("1.234", { precision: 5, scale: 2 }), {
    code: "DECIMAL_OUT_OF_RANGE",
  });
  assert.throws(() => assertFitsDatabaseDecimal("1234", { precision: 5, scale: 2 }), {
    code: "DECIMAL_OUT_OF_RANGE",
  });
  assert.throws(() => assertFitsDatabaseDecimal("1", { precision: 10, scale: 31 }), {
    code: "INVALID_DECIMAL_PRECISION",
  });
});

test("NPR quantization uses the internally approved two-place HALF_EVEN policy", () => {
  assert.equal(CURRENCY_PRECISION.NPR.status, "INTERNAL_APPROVED");
  assert.equal(quantizeCurrencyAmount("1.005", "NPR").toString(), "1");
  assert.equal(quantizeCurrencyAmount("1.015", "NPR").toString(), "1.02");
  assert.equal(quantizeCurrencyAmount("-1.005", "NPR").toString(), "-1");
  assert.throws(() => quantizeCurrencyAmount("1", "XYZ", { roundingMode }), {
    code: "UNSUPPORTED_CURRENCY",
  });
  assert.throws(() => quantizeNprAmount("9999999999999999999.995"), {
    code: "DECIMAL_OUT_OF_RANGE",
  });
  assert.throws(() => parseNprAmountString(1.2), {
    code: "INVALID_DECIMAL_INPUT",
  });
});

test("serializes Decimal values as strings without converting ordinary values", () => {
  const serialized = serializeAccountingValue({
    amount: accountingDecimal("0.1000000000000000001"),
    nested: [new Prisma.Decimal("12345678901234567890.12"), new Date("2026-04-15T00:00:00.000Z")],
  });

  assert.equal(serialized.amount, "0.1000000000000000001");
  assert.equal(serialized.nested[0], "12345678901234567890.12");
  assert.equal(serialized.nested[1].toISOString(), "2026-04-15T00:00:00.000Z");
  assert.equal(JSON.stringify(serialized).includes("0.1000000000000000001"), true);
});
