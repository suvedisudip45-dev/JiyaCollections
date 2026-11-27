import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  calculateWholesaleLinePricing,
  getDealerAvailableCredit,
  normalizeWholesaleLines,
} from "../services/distributorWholesaleService.js";

test("wholesale line normalization requires unique positive SKU quantities", () => {
  assert.deepEqual(normalizeWholesaleLines([
    { inventorySkuId: "sku-m", quantity: "5" },
  ]), [
    { inventorySkuId: "sku-m", quantity: 5 },
  ]);
  assert.throws(() => normalizeWholesaleLines([
    { inventorySkuId: "sku-m", quantity: 2 },
    { inventorySkuId: "sku-m", quantity: 3 },
  ]), /unique/);
  assert.throws(() => normalizeWholesaleLines([
    { inventorySkuId: "sku-m", quantity: 0 },
  ]), /positive/);
});

test("server-side wholesale pricing uses contract price and the highest eligible discount", () => {
  const result = calculateWholesaleLinePricing({
    catalogPrice: "2000.00",
    quantity: 10,
    contractPrice: "1800.00",
    tier: { discountPercent: "5" },
    quantityDiscount: { discountPercent: "8" },
  });
  assert.equal(result.unitPrice.toString(), "1800");
  assert.equal(result.discountAmount.toString(), "1440");
  assert.equal(result.lineTotal.toString(), "16560");
});

test("catalog fallback pricing rejects frontend-submitted prices", () => {
  const result = calculateWholesaleLinePricing({
    catalogPrice: "1000.00",
    quantity: 3,
  });
  assert.equal(result.unitPrice.toString(), "1000");
  assert.equal(result.lineTotal.toString(), "3000");
  assert.equal(result.discountAmount.toString(), "0");
});

test("available dealer credit uses accounting receivable source of truth", async () => {
  const client = {
    accountingDocument: {
      findMany: async () => [
        { remainingAmount: new Prisma.Decimal("400.00") },
        { remainingAmount: new Prisma.Decimal("600.00") },
      ],
    },
  };
  const result = await getDealerAvailableCredit({
    tx: client,
    dealer: { openingBalance: new Prisma.Decimal("100.00"), creditLimit: new Prisma.Decimal("2000.00") },
    partyId: "party-dealer-1",
  });
  assert.equal(result.creditLimit.toString(), "2000");
  assert.equal(result.outstanding.toString(), "1000");
  assert.equal(result.availableCredit.toString(), "1000");
});

test("credit-limit check clamps available credit at zero", async () => {
  const client = {
    accountingDocument: {
      findMany: async () => [{ remainingAmount: new Prisma.Decimal("2500.00") }],
    },
  };
  const result = await getDealerAvailableCredit({
    tx: client,
    dealer: { openingBalance: new Prisma.Decimal("0"), creditLimit: new Prisma.Decimal("2000.00") },
    partyId: "party-dealer-1",
  });
  assert.equal(result.availableCredit.toString(), "0");
});
