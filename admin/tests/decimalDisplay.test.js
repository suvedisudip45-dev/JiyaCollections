import assert from "node:assert/strict";
import test from "node:test";
import {
  formatNprAmount,
  roundedPercentFromDecimalStrings,
} from "../src/utils/decimalDisplay.js";

test("rounded percentage formatting uses exact decimal strings", () => {
  assert.equal(roundedPercentFromDecimalStrings("0.29", "1.00"), "29");
  assert.equal(roundedPercentFromDecimalStrings("0.005", "1"), "1");
  assert.equal(roundedPercentFromDecimalStrings("1", "3"), "33");
  assert.equal(roundedPercentFromDecimalStrings("1", "0"), "0");
});

test("settlement amount display preserves fractional and large decimal strings", () => {
  assert.equal(formatNprAmount("0.01"), "0.01");
  assert.equal(formatNprAmount("999999999999999999.99"), "999,999,999,999,999,999.99");
});
