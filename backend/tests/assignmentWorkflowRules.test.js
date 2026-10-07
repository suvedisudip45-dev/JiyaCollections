import assert from "node:assert/strict";
import test from "node:test";

import {
  canAdminReassignAssignment,
  canManufacturerRejectAssignment,
  manualAssign,
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

test("manual assignment cannot direct customer orders to manufacturers", async () => {
  let response;
  const res = {
    status: (status) => ({
      json: (body) => {
        response = { status, body };
        return response;
      },
    }),
  };

  await manualAssign({}, res);

  assert.equal(response.status, 409);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /distributor allocation/i);
});
