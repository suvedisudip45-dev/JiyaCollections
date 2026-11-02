import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveOutputVatRatePercent,
  resolveSellerTaxTreatment,
  updateSellerTaxProfile,
} from "../services/sellerTaxProfileService.js";

const createClient = (registrations = []) => ({
  taxRegistrationVersion: {
    findFirst: async ({ where }) => registrations
      .filter((version) =>
        version.status === where.status &&
        version.effectiveFrom <= where.effectiveFrom.lte &&
        (!version.effectiveUntil || version.effectiveUntil > where.effectiveFrom.lte)
      )
      .sort((left, right) => right.effectiveFrom - left.effectiveFrom)[0] || null,
  },
  sellerTaxProfile: {
    findUnique: async () => ({
      legalName: "Example Collections",
      panNumber: "123456789",
      address: "Kathmandu",
    }),
  },
  vatRateVersion: {
    findFirst: async ({ where }) => ({
      vatRate: where.effectiveFrom.lte >= new Date("2027-01-01T00:00:00.000Z") ? "15.00" : "13.00",
    }),
  },
  taxConfiguration: {
    findUnique: async () => ({ vatRate: 13 }),
  },
});

test("seller tax treatment defaults safely to PAN-only and does not apply the configured VAT rate", async () => {
  const client = createClient();
  const treatment = await resolveSellerTaxTreatment(new Date("2026-07-01T00:00:00.000Z"), { client });
  const outputRate = await resolveOutputVatRatePercent(new Date("2026-07-01T00:00:00.000Z"), { client });

  assert.equal(treatment.taxStatus, "PAN_ONLY");
  assert.equal(treatment.taxTreatment, "NON_VAT");
  assert.equal(treatment.vatRate, null);
  assert.equal(outputRate.toString(), "0");
});

test("output VAT is enabled only during the effective VAT-registration interval", async () => {
  const client = createClient([{
    id: "registration-vat",
    taxStatus: "VAT_REGISTERED",
    vatNumber: "VAT-123",
    effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
    effectiveUntil: new Date("2027-04-01T00:00:00.000Z"),
    status: "ACTIVE",
  }]);

  const before = await resolveSellerTaxTreatment(new Date("2026-09-30T23:59:59.999Z"), { client });
  const during = await resolveSellerTaxTreatment(new Date("2027-02-01T00:00:00.000Z"), { client });
  const after = await resolveSellerTaxTreatment(new Date("2027-04-01T00:00:00.000Z"), { client });

  assert.equal(before.taxStatus, "PAN_ONLY");
  assert.equal(before.vatRate, null);
  assert.equal(during.taxStatus, "VAT_REGISTERED");
  assert.equal(during.vatRate.toString(), "15");
  assert.equal(during.vatNumber, "VAT-123");
  assert.equal(after.taxStatus, "PAN_ONLY");
});

test("seller tax profile patch preserves omitted fields and cannot clear PAN during VAT registration", async () => {
  const profile = {
    id: "default",
    legalName: "Example Collections",
    panNumber: "123456789",
    address: "Kathmandu",
  };
  const client = {
    sellerTaxProfile: {
      findUnique: async () => ({ ...profile }),
      upsert: async ({ update }) => Object.assign(profile, update),
    },
    taxRegistrationVersion: {
      findFirst: async () => ({ taxStatus: "VAT_REGISTERED" }),
    },
    $transaction: async (callback) => callback(client),
  };

  const updated = await updateSellerTaxProfile({ legalName: "Example Collection Pvt Ltd", client });
  assert.equal(updated.panNumber, "123456789");
  assert.equal(updated.address, "Kathmandu");
  await assert.rejects(updateSellerTaxProfile({ panNumber: "", client }), (error) =>
    error.code === "SELLER_PAN_REQUIRED"
  );
});
