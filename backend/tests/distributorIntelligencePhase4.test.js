import assert from "node:assert/strict";
import test from "node:test";
import { calculateNetVelocity } from "../services/distributorIntelligenceService.js";

test("14-day net velocity excludes returns and is calculated per elapsed day", () => {
  const velocity = calculateNetVelocity(70, 14, 14);
  assert.equal(velocity.toString(), "4");
});

test("net velocity cannot become negative after returns", () => {
  const velocity = calculateNetVelocity(10, 25, 30);
  assert.equal(velocity.toString(), "0");
});

test("invalid velocity inputs fail closed", () => {
  assert.throws(() => calculateNetVelocity(10.5, 0, 14), /whole number/);
  assert.throws(() => calculateNetVelocity(10, 0, 0), /Elapsed days/);
});
