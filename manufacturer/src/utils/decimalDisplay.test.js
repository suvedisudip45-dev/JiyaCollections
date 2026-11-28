import assert from "node:assert/strict";
import test from "node:test";
import {
  absoluteDecimalString,
  compareDecimalStrings,
  formatNprAmount,
  subtractDecimalStrings,
} from "./decimalDisplay.js";

test("formats fractional and large decimal amounts without floating-point conversion", () => {
  assert.equal(formatNprAmount("12345678901234567890.125"), "12,345,678,901,234,567,890.125");
  assert.equal(formatNprAmount("0.30"), "0.30");
  assert.equal(formatNprAmount("-0.005"), "-0.005");
});

test("net positions and exact comparisons retain positive fractional balances", () => {
  const net = subtractDecimalStrings("100.01", "100.00");
  assert.equal(net, "0.01");
  assert.equal(compareDecimalStrings(net, "0"), 1);
  assert.equal(absoluteDecimalString(subtractDecimalStrings("12.50", "14.75")), "2.25");
});

test("zero and invalid monetary strings are handled explicitly", () => {
  assert.equal(formatNprAmount("0"), "0.00");
  assert.equal(formatNprAmount(subtractDecimalStrings("0.00", "0")), "0.00");
  assert.throws(() => compareDecimalStrings("1e3", "1000"), TypeError);
});
