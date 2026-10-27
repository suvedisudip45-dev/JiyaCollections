import test from "node:test";
import assert from "node:assert/strict";
import {
  cancelFutureVatRateVersion,
  createVatRateVersion,
  resolveVatRatePercent,
} from "../services/vatRateService.js";
import { calculateCustomerReturnRefundPolicy } from "../services/customerReturnWorkflowService.js";

const makeClient = (versions = []) => {
  const state = { versions: structuredClone(versions) };
  const tx = {
    vatRateVersion: {
      findFirst: async ({ where, orderBy }) => {
        let rows = state.versions.filter((version) => version.status === where.status);
        if (where.effectiveFrom?.lt) rows = rows.filter((version) => version.effectiveFrom < where.effectiveFrom.lt);
        if (where.effectiveFrom?.lte) rows = rows.filter((version) => version.effectiveFrom <= where.effectiveFrom.lte);
        if (where.effectiveUntil?.gt) rows = rows.filter((version) => !version.effectiveUntil || version.effectiveUntil > where.effectiveUntil.gt);
        if (orderBy?.effectiveFrom === "desc") rows.sort((a, b) => b.effectiveFrom - a.effectiveFrom);
        return rows[0] || null;
      },
      findUnique: async ({ where }) => state.versions.find((version) => version.id === where.id) || null,
      updateMany: async ({ where, data }) => {
        const row = state.versions.find((version) =>
          version.id === where.id &&
          version.status === where.status &&
          (where.effectiveUntil === undefined || version.effectiveUntil === where.effectiveUntil) &&
          (!where.effectiveFrom?.gt || version.effectiveFrom > where.effectiveFrom.gt)
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      create: async ({ data }) => {
        const row = { ...data, updatedAt: new Date() };
        state.versions.push(row);
        return row;
      },
    },
    taxConfiguration: {
      findUnique: async () => ({ vatRate: 13 }),
    },
  };
  const client = {
    ...tx,
    $transaction: async (callback) => callback(tx),
  };
  return { client, state };
};

test("effective VAT resolver selects the rate effective for a transaction timestamp", async () => {
  const start = new Date("2027-01-01T00:00:00.000Z");
  const harness = makeClient([
    {
      id: "vat-20",
      vatRate: "20.00",
      effectiveFrom: start,
      effectiveUntil: null,
      status: "ACTIVE",
    },
  ]);
  const before = await resolveVatRatePercent(new Date("2026-12-31T23:59:59.999Z"), { client: harness.client });
  const active = await resolveVatRatePercent(start, { client: harness.client });

  assert.equal(before.toString(), "13");
  assert.equal(active.toString(), "20");
});

test("creating a future VAT version closes the current open interval atomically", async () => {
  const now = new Date("2026-10-01T00:00:00.000Z");
  const harness = makeClient([{
    id: "vat-current",
    vatRate: "13.00",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    status: "ACTIVE",
  }]);

  const created = await createVatRateVersion({
    vatRate: "15.5",
    effectiveFrom: "2027-01-01T00:00:00.000Z",
    createdBy: "admin-id",
    client: harness.client,
    now,
  });

  assert.equal(created.vatRate.toString(), "15.5");
  assert.equal(harness.state.versions[0].effectiveUntil.toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(harness.state.versions[1].createdBy, "admin-id");
});

test("VAT versions reject retroactive dates, invalid rates, and cancelling an effective rate", async () => {
  const now = new Date("2026-10-01T00:00:00.000Z");
  const harness = makeClient([{
    id: "vat-current",
    vatRate: "13.00",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    status: "ACTIVE",
  }]);

  await assert.rejects(
    createVatRateVersion({ vatRate: 13, effectiveFrom: "2026-09-01T00:00:00.000Z", client: harness.client, now }),
    { code: "INVALID_VAT_EFFECTIVE_DATE" },
  );
  await assert.rejects(
    createVatRateVersion({ vatRate: 101, effectiveFrom: "2027-01-01T00:00:00.000Z", client: harness.client, now }),
    { code: "INVALID_VAT_RATE" },
  );
  await assert.rejects(
    cancelFutureVatRateVersion({ id: "vat-current", client: harness.client, now }),
    { code: "VAT_RATE_VERSION_IMMUTABLE" },
  );
});

test("return charge and VAT reversal use the original transaction VAT rate", () => {
  const result = calculateCustomerReturnRefundPolicy({
    productValue: 1200,
    chargeRatePercent: 10,
    originalDeliveryFee: 100,
    vatRatePercent: 20,
  });

  assert.equal(result.approvedRefundAmount.toFixed(2), "1080.00");
  assert.equal(result.vatRefunded.toFixed(2), "180.00");
  assert.equal(result.snapshot.vatRatePercent, "20.00");
  assert.equal(result.snapshot.originalDeliveryFeeRefunded, "0.00");
});
