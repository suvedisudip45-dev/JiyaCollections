import assert from "node:assert/strict";
import test from "node:test";
import { deterministicRouteSequence } from "../services/distributorLogisticsService.js";

test("deterministic route sequencing prioritizes urgent stops and time windows", () => {
  const sequenced = deterministicRouteSequence([
    { priority: "normal", addressSnapshot: { district: "Kathmandu", city: "Kathmandu" } },
    { priority: "urgent", timeWindowStart: "2026-11-26T09:00:00Z", addressSnapshot: { district: "Kathmandu", city: "Baneshwor" } },
    { priority: "high", timeWindowStart: "2026-11-26T08:00:00Z", addressSnapshot: { district: "Lalitpur", city: "Patan" } },
  ]);
  assert.equal(sequenced[0].priority, "urgent");
  assert.equal(sequenced[1].priority, "high");
  assert.equal(sequenced[2].priority, "normal");
});

test("route fallback is deterministic by priority, window, district, and city", () => {
  const first = deterministicRouteSequence([
    { priority: "normal", address: { district: "Lalitpur", city: "Patan" } },
    { priority: "normal", address: { district: "Kathmandu", city: "Baneshwor" } },
  ]);
  assert.equal(first[0].address.district, "Kathmandu");
  assert.equal(first[1].address.district, "Lalitpur");
});
