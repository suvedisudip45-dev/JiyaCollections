import assert from "node:assert/strict";
import test from "node:test";

import {
  canAdminReassignAssignment,
  canManufacturerRejectAssignment,
} from "../controllers/orderAssignmentController.js";

test("admin reassigning is blocked once manufacturer has accepted production", () => {
  assert.equal(canAdminReassignAssignment({ status: "accepted" }), false);
  assert.equal(canAdminReassignAssignment({ status: "preparing" }), false);
  assert.equal(canAdminReassignAssignment({ status: "packed" }), false);
});

test("admin reassigning stays allowed before acceptance and before delivery handoff", () => {
  assert.equal(canAdminReassignAssignment({ status: "assigned" }), true);
  assert.equal(canAdminReassignAssignment({ status: "rejected" }), true);
  assert.equal(canAdminReassignAssignment({ status: "assigned", hasDeliveryOrder: false }), true);
});

test("manufacturer rejection is blocked after acceptance or after delivery is assigned", () => {
  assert.equal(canManufacturerRejectAssignment({ status: "assigned", hasDeliveryOrder: false }), true);
  assert.equal(canManufacturerRejectAssignment({ status: "accepted", hasDeliveryOrder: false }), false);
  assert.equal(canManufacturerRejectAssignment({ status: "assigned", hasDeliveryOrder: true }), false);
  assert.equal(canManufacturerRejectAssignment({ status: "ready_for_pickup", hasDeliveryOrder: true }), false);
});
