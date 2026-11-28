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
      orderReference: "A1B2C3D4E5F6071",
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

test("uses the distributor pickup branch as origin and customer's selected branch as destination", () => {
  const input = buildDeliveryInput({
    order: {
      id: "order-distributor",
      orderReference: "A1B2C3D4E5F6072",
      amount: 1000,
      address: JSON.stringify({
        name: "Customer",
        phone: "9800000000",
        street: "Sankhu",
        city: "Kathmandu",
        ncmBranch: "SANKHU",
      }),
      items: "[]",
    },
    assignment: { id: "assignment-distributor", distributorId: "distributor-1" },
    manufacturer: { ncmPickupBranch: "POKHARA" },
  });

  assert.equal(input.origin, "POKHARA");
  assert.equal(input.destination, "SANKHU");
  assert.deepEqual(input.originCandidates, ["POKHARA"]);
  assert.deepEqual(input.destinationCandidates, ["SANKHU"]);
});

test("uses customer city as the destination when no specific NCM branch is selected", () => {
  const input = buildDeliveryInput({
    order: {
      id: "order-distributor-city",
      orderReference: "A1B2C3D4E5F6073",
      amount: 1000,
      address: JSON.stringify({
        name: "Customer",
        phone: "9800000000",
        street: "Lakeside",
        city: "Kathmandu",
      }),
      items: "[]",
    },
    assignment: { id: "assignment-distributor-city", distributorId: "distributor-1" },
    manufacturer: { ncmPickupBranch: "POKHARA" },
  });

  assert.equal(input.origin, "POKHARA");
  assert.equal(input.destination, "KATHMANDU");
  assert.deepEqual(input.originCandidates, ["POKHARA"]);
  assert.deepEqual(input.destinationCandidates, ["KATHMANDU"]);
});

test("rejects distributor delivery when its NCM pickup branch is not configured", () => {
  assert.throws(
    () => buildDeliveryInput({
      order: {
        id: "order-distributor-no-origin",
        amount: 1000,
        address: JSON.stringify({
          name: "Customer",
          phone: "9800000000",
          street: "Sankhu",
          city: "Kathmandu",
          ncmBranch: "SANKHU",
        }),
        items: "[]",
      },
      assignment: { id: "assignment-distributor-no-origin", distributorId: "distributor-1" },
      manufacturer: { ncmPickupBranch: "" },
    }),
    { code: "NCM_PICKUP_BRANCH_REQUIRED" },
  );
});
