import test from "node:test";
import assert from "node:assert/strict";
import { getNcmBranchName, getNcmBranchRows, getNcmCoveredAreas } from "../services/ncmClient.js";
import { buildDeliveryInput } from "../services/deliveryService.js";

test("normalizes documented NCM branch response shapes", () => {
  const rows = getNcmBranchRows({
    data: [
      { name: "Pokhara", district: "Kaski", covered_areas: ["Lakeside"] },
      { branch_name: "BHAKTAPUR" },
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(getNcmBranchName(rows[0]), "POKHARA");
  assert.equal(getNcmBranchName(rows[1]), "BHAKTAPUR");
  assert.deepEqual(getNcmCoveredAreas(rows[0]), ["LAKESIDE"]);
  assert.deepEqual(getNcmCoveredAreas({ areas_covered: "BAGAR, Lakeside, BAGAR" }), ["BAGAR", "LAKESIDE"]);
  assert.deepEqual(getNcmBranchRows(["TINKUNE"]), ["TINKUNE"]);
});

test("uses the selected NCM branch instead of a city mapping", () => {
  process.env.NCM_BRANCH_MAP_JSON = JSON.stringify({ pokhara: ["POKHARA", "BHAKTAPUR"] });

  const input = buildDeliveryInput({
    order: {
      id: "order-1",
      amount: 1000,
      address: JSON.stringify({
        name: "Customer",
        phone: "9800000000",
        street: "Lakeside",
        city: "POKHARA",
        ncmBranch: "POKHARA",
      }),
      items: "[]",
    },
    assignment: { id: "assignment-1" },
    manufacturer: { ncmPickupBranch: "TINKUNE" },
  });

  assert.equal(input.destination, "POKHARA");
  assert.deepEqual(input.destinationCandidates, ["POKHARA"]);
});
