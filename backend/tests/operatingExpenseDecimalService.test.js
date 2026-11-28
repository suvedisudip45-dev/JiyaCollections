import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  calculateOperatingExpenseVat,
  getOperatingExpenseTaxableAmount,
  normalizeExpenseAmount,
} from "../services/operatingExpenseDecimalService.js";

test("expense amount inputs remain decimal strings and quantize with HALF_EVEN", () => {
  assert.equal(normalizeExpenseAmount("12.345").toFixed(2), "12.34");
  assert.equal(normalizeExpenseAmount("12.355").toFixed(2), "12.36");
  assert.throws(() => normalizeExpenseAmount(12.35), { code: "INVALID_DECIMAL_INPUT" });
  assert.throws(() => normalizeExpenseAmount("-1.00"), { code: "INVALID_DECIMAL_INPUT" });
  assert.throws(() => normalizeExpenseAmount("9999999999999999999.995"), {
    code: "DECIMAL_OUT_OF_RANGE",
  });
});

test("calculates embedded invoice VAT exactly and separates taxable base", () => {
  const vat = calculateOperatingExpenseVat({
    amount: new Prisma.Decimal("113.00"),
    isVatBill: true,
    purchaseVatRate: "13",
  });
  assert.equal(vat.toFixed(2), "13.00");
  assert.equal(getOperatingExpenseTaxableAmount("113.00", vat).toFixed(2), "100.00");

  const enteredVat = calculateOperatingExpenseVat({
    amount: "100.00",
    isVatBill: true,
    vatAmount: "13.00",
    purchaseVatRate: "13",
  });
  assert.equal(enteredVat.toFixed(2), "13.00");
  assert.throws(() => calculateOperatingExpenseVat({
    amount: "100.00",
    isVatBill: true,
    vatAmount: "100.01",
    purchaseVatRate: "13",
  }), { code: "VAT_EXCEEDS_GROSS" });
});

test("does not compute a VAT amount when the expense is not marked as an invoice VAT bill", () => {
  assert.equal(calculateOperatingExpenseVat({
    amount: "100.00",
    isVatBill: false,
    purchaseVatRate: "13",
  }).toFixed(2), "0.00");
});
