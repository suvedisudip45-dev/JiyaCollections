import test from "node:test";
import assert from "node:assert/strict";
import { serializeRegistrationResponse } from "../dtos/registrationDto.js";

test("registration response contains only success and message", () => {
  const response = serializeRegistrationResponse(
    "Manufacturer registration submitted successfully. Admin review is required before your account becomes active.",
  );

  assert.deepEqual(Object.keys(response).sort(), ["message", "success"]);
  assert.equal(response.success, true);
  assert.equal(Object.hasOwn(response, "manufacturer"), false);
  assert.equal(Object.hasOwn(response, "partner"), false);
});
