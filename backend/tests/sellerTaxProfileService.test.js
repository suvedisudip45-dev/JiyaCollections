import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveOutputVatRatePercent,
  resolveSellerTaxTreatment,
  scheduleTaxRegistrationVersion,
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

test("seller tax treatment defaults explicitly to unregistered and does not apply the configured VAT rate", async () => {
  const client = createClient();
  const treatment = await resolveSellerTaxTreatment(new Date("2026-07-01T00:00:00.000Z"), { client });
  const outputRate = await resolveOutputVatRatePercent(new Date("2026-07-01T00:00:00.000Z"), { client });

  assert.equal(treatment.taxStatus, "UNREGISTERED");
  assert.equal(treatment.taxTreatment, "UNREGISTERED");
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

  assert.equal(before.taxStatus, "UNREGISTERED");
  assert.equal(before.vatRate, null);
  assert.equal(during.taxStatus, "VAT_REGISTERED");
  assert.equal(during.vatRate.toString(), "15");
  assert.equal(during.vatNumber, "VAT-123");
  assert.equal(after.taxStatus, "UNREGISTERED");
});

test("initial unregistered status can be recorded today but later statuses remain future-dated", async () => {
  const now = new Date("2026-11-15T00:47:00.000Z");
  let version = null;
  const client = {
    taxRegistrationVersion: {
      findFirst: async () => version,
      create: async ({ data }) => {
        version = data;
        return data;
      },
    },
    $transaction: async (callback) => callback(client),
  };

  const created = await scheduleTaxRegistrationVersion({
    taxStatus: "UNREGISTERED",
    effectiveFrom: "2026-11-14T18:15:00.000Z",
    client,
    now,
  });
  assert.equal(created.taxStatus, "UNREGISTERED");
  assert.equal(created.effectiveFrom.getTime(), now.getTime());
  await assert.rejects(
    scheduleTaxRegistrationVersion({
      taxStatus: "PAN_ONLY",
      effectiveFrom: "2026-11-14T18:15:00.000Z",
      client,
      now,
    }),
    { code: "INVALID_TAX_EFFECTIVE_DATE" },
  );
});

test("VAT registration cannot be scheduled without an explicit effective VAT rate", async () => {
  let created = false;
  const client = {
    sellerTaxProfile: {
      findUnique: async () => ({ panNumber: "123456789" }),
    },
    taxRegistrationVersion: {
      findFirst: async () => null,
      create: async () => {
        created = true;
      },
    },
    vatRateVersion: {
      findFirst: async () => null,
    },
    $transaction: async (callback) => callback(client),
  };
  await assert.rejects(
    scheduleTaxRegistrationVersion({
      taxStatus: "VAT_REGISTERED",
      vatNumber: "123456789",
      effectiveFrom: "2027-01-01T00:00:00.000Z",
      client,
      now: new Date("2026-11-15T00:00:00.000Z"),
    }),
    { code: "VAT_RATE_NOT_CONFIGURED" },
  );
  assert.equal(created, false);
});

test("invalid stored tax status fails visibly instead of resolving as unregistered", async () => {
  const client = createClient([{
    id: "registration-invalid",
    taxStatus: "UNKNOWN",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    status: "ACTIVE",
  }]);

  await assert.rejects(
    resolveSellerTaxTreatment(new Date("2026-07-01T00:00:00.000Z"), { client }),
    { code: "INVALID_STORED_TAX_REGISTRATION_STATUS" },
  );
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
