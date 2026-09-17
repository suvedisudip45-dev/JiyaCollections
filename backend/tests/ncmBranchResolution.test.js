import test from "node:test";
import assert from "node:assert/strict";

const originalEnv = { ...process.env };

const loadBranching = async () => {
  const { resolveNcmBranches } = await import("../config/ncmBranching.js");
  return { resolveNcmBranches };
};

test("prefers the admin-assigned manufacturer pickup branch and keeps destination mapping", async () => {
  process.env.NCM_BRANCH_MAP_JSON = JSON.stringify({ kathmandu: "TINKUNE", pokhara: "POKHARA" });

  const { resolveNcmBranches } = await loadBranching();

  const branches = resolveNcmBranches({
    manufacturer: { city: "Kathmandu", ncmPickupBranch: "BIRATNAGAR" },
    address: { city: "Pokhara" },
  });

  assert.equal(branches.origin, "BIRATNAGAR");
  assert.equal(branches.destination, "POKHARA");

  Object.assign(process.env, originalEnv);
});

test("requires manufacturer pickup branch before a create-order request is allowed", async () => {
  process.env.NCM_BRANCH_MAP_JSON = JSON.stringify({ kathmandu: "TINKUNE", pokhara: "POKHARA" });

  const { resolveNcmBranches } = await loadBranching();

  const branches = resolveNcmBranches({
    manufacturer: { city: "Kathmandu" },
    address: { city: "Pokhara" },
  });

  assert.equal(branches.origin, "");
  assert.equal(branches.destination, "POKHARA");

  Object.assign(process.env, originalEnv);
});
