import assert from "node:assert/strict";
import test from "node:test";
import {
  hasValidVatSupplierIdentity,
  normalizeManufacturerTaxIdentity,
} from "../services/manufacturerTaxIdentity.js";

test("manufacturer PAN/VAT identity requires a selected type and exactly nine digits", () => {
  assert.deepEqual(normalizeManufacturerTaxIdentity({ taxIdType: "pan", taxIdNumber: "123456789" }), {
    taxIdType: "PAN",
    taxIdNumber: "123456789",
  });
  assert.deepEqual(normalizeManufacturerTaxIdentity({ taxIdType: "VAT", taxIdNumber: "987654321" }), {
    taxIdType: "VAT",
    taxIdNumber: "987654321",
  });
  assert.throws(() => normalizeManufacturerTaxIdentity({ taxIdType: "PAN", taxIdNumber: "1234" }), {
    code: "INVALID_MANUFACTURER_TAX_ID",
  });
  assert.throws(() => normalizeManufacturerTaxIdentity({ taxIdType: "", taxIdNumber: "123456789" }), {
    code: "INVALID_MANUFACTURER_TAX_ID",
  });
});

test("only a valid VAT-registered manufacturer identity qualifies as a VAT supplier", () => {
  assert.equal(hasValidVatSupplierIdentity({ taxIdType: "VAT", taxIdNumber: "123456789" }), true);
  assert.equal(hasValidVatSupplierIdentity({ taxIdType: "PAN", taxIdNumber: "123456789" }), false);
  assert.equal(hasValidVatSupplierIdentity({ taxIdType: "VAT", taxIdNumber: "1234" }), false);
  assert.equal(hasValidVatSupplierIdentity({ taxIdType: null, taxIdNumber: null }), false);
});
