import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  getManufacturerSettlementSummary,
  normalizeSettlementRequest,
} from "../services/manufacturerSettlementService.js";

test("manufacturer settlement summary combines payable journals and all settlement totals", async () => {
  const client = {
    manufacturer: {
      findUnique: async () => ({ id: "mfg-1", name: "Textile Co" }),
    },
    manufacturerProductionRequest: {
      findMany: async () => [{
        approvedUnitCogs: new Prisma.Decimal("10"),
        lines: [{ actualQuantity: 10, damagedQuantity: 2, quantity: 10 }],
      }],
    },
    manufacturerSettlementRequest: {
      findMany: async () => [
        { status: "PENDING", requestType: "PRODUCTION", amount: new Prisma.Decimal("20") },
        { status: "PAID", requestType: "LOGISTICS", amount: new Prisma.Decimal("2") },
      ],
      groupBy: async () => [
        { status: "PENDING", requestType: "PRODUCTION", _sum: { amount: new Prisma.Decimal("20") } },
        { status: "PENDING", requestType: "LOGISTICS", _sum: { amount: new Prisma.Decimal("5") } },
        { status: "PAID", requestType: "PRODUCTION", _sum: { amount: new Prisma.Decimal("10") } },
        { status: "PAID", requestType: "LOGISTICS", _sum: { amount: new Prisma.Decimal("2") } },
      ],
    },
    account: {
      findUnique: async () => ({ id: "payable-account" }),
    },
    journalLine: {
      findMany: async () => [
        {
          debit: 0,
          credit: 100,
          supplierId: "mfg-1",
          supplierName: "Textile Co",
          accountingParty: null,
          journalEntry: { sourceType: "MANUFACTURER_PRODUCTION" },
        },
        {
          debit: 0,
          credit: 5,
          supplierId: "mfg-1",
          supplierName: "Textile Co",
          accountingParty: null,
          journalEntry: { sourceType: "MANUFACTURER_LOGISTICS" },
        },
        {
          debit: 12,
          credit: 0,
          supplierId: null,
          supplierName: "Textile Co",
          accountingParty: null,
          journalEntry: { sourceType: "SUPPLIER_PAYMENT" },
        },
      ],
    },
  };

  const summary = await getManufacturerSettlementSummary("mfg-1", { client });

  assert.equal(summary.totalManufacturedGoodsValue, 80);
  assert.equal(summary.pendingSettlementAmount, 25);
  assert.equal(summary.completedPayments, 12);
  assert.equal(summary.productionOutstanding, 90);
  assert.equal(summary.logisticsOutstanding, 3);
  assert.equal(summary.productionPayableAvailable, 70);
  assert.equal(summary.logisticsPayableAvailable, 0);
});

test("manufacturer settlement requests accept only positive typed amounts", () => {
  const normalized = normalizeSettlementRequest({
    requestType: "logistics",
    amount: "125.456",
    notes: " Local delivery ",
  });
  assert.equal(normalized.requestType, "LOGISTICS");
  assert.equal(normalized.amount.toFixed(2), "125.46");
  assert.equal(normalized.notes, "Local delivery");
  assert.throws(() => normalizeSettlementRequest({ requestType: "OTHER", amount: 1 }), /PRODUCTION or LOGISTICS/);
  assert.throws(() => normalizeSettlementRequest({ requestType: "PRODUCTION", amount: 0 }), /positive valid amount/);
});
