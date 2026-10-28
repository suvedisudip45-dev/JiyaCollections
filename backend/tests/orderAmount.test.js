import assert from "node:assert/strict";
import test from "node:test";
import { roundOrderTotal } from "../utils/orderAmount.js";

test("order totals round to the nearest 0 or 5 using the requested digit ranges", () => {
  assert.equal(roundOrderTotal(132), 130);
  assert.equal(roundOrderTotal(133), 130);
  assert.equal(roundOrderTotal(134), 135);
  assert.equal(roundOrderTotal(137), 135);
  assert.equal(roundOrderTotal(138), 140);
});
