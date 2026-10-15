import test from "node:test";
import assert from "node:assert/strict";
import {
  getLocationLookupData,
  validateNcmLocationSelection,
} from "../services/locationLookupService.js";

const makeClient = () => ({
  locationMapping: {
    findMany: async () => [
      { code: "BAGM", name: "Bagmati Province", type: "PROVINCE", province: null },
      { code: "0KTM", name: "Kathmandu", type: "DISTRICT", province: "Bagmati Province" },
      { code: "KASK", name: "Kaski", type: "DISTRICT", province: "Gandaki Province" },
    ],
  },
  ncmBranch: {
    findMany: async () => [
      { name: "Pokhara", provinceName: "GANDAKI", districtName: "KASKI", coveredAreas: ["Lakeside", "Bagar"] },
      { name: "Sankhu", provinceName: "BAGMATI PROVINCE", districtName: "KATHMANDU", coveredAreas: ["Sankhu"] },
    ],
  },
});

test("location lookups return database provinces, districts, branches, and branch areas", async () => {
  const result = await getLocationLookupData({}, makeClient());

  assert.deepEqual(result.provinces, ["Bagmati Province"]);
  assert.equal(result.districts.length, 2);
  assert.equal(result.branches.length, 2);
  assert.deepEqual(result.coveredAreas, []);
});

test("location lookups filter branches by province, district, and branch name", async () => {
  const result = await getLocationLookupData({
    province: "Gandaki Province",
    district: "Kaski",
    branch: "POKHARA",
  }, makeClient());

  assert.deepEqual(result.branches, [{
    name: "Pokhara",
    province: "Gandaki Province",
    district: "Kaski",
    coveredAreas: ["Lakeside", "Bagar"],
  }]);
  assert.deepEqual(result.coveredAreas, ["Lakeside", "Bagar"]);
});

test("location lookups accept abbreviated NCM province and district filters", async () => {
  const result = await getLocationLookupData({
    province: "GANDAKI",
    district: "KASKI",
  }, makeClient());

  assert.deepEqual(result.branches.map(({ name }) => name), ["Pokhara"]);
});

test("location lookups do not expose branches from a different district", async () => {
  const result = await getLocationLookupData({ district: "Kaski" }, makeClient());

  assert.deepEqual(result.branches.map(({ name }) => name), ["Pokhara"]);
});

test("NCM branch and covered area selections are validated case-insensitively", async () => {
  const result = await validateNcmLocationSelection({
    province: "gandaki province",
    district: "kaski",
    branch: "pokhara",
    coveredArea: "lakeside",
  }, makeClient());

  assert.equal(result.branch.name, "Pokhara");
  assert.equal(result.coveredArea, "Lakeside");
});

test("NCM location validation rejects an uncovered area", async () => {
  await assert.rejects(
    validateNcmLocationSelection({
      province: "Gandaki Province",
      district: "Kaski",
      branch: "Pokhara",
      coveredArea: "Kathmandu",
    }, makeClient()),
    { statusCode: 400 },
  );
});
