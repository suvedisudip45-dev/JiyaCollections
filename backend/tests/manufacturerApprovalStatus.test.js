import test from "node:test";
import assert from "node:assert/strict";
import { getAuthAccountStatusForContractStatus } from "../controllers/manufacturerController.js";

test("manufacturer approval statuses map to account login statuses", () => {
  assert.equal(getAuthAccountStatusForContractStatus("ACTIVE"), "ACTIVE");
  assert.equal(getAuthAccountStatusForContractStatus("PENDING"), "PENDING_APPROVAL");
  assert.equal(getAuthAccountStatusForContractStatus("REJECTED"), "REJECTED");
  assert.equal(getAuthAccountStatusForContractStatus("SUSPENDED"), "SUSPENDED");
  assert.equal(getAuthAccountStatusForContractStatus("TERMINATED"), "INACTIVE");
  assert.equal(getAuthAccountStatusForContractStatus("unknown"), null);
});
