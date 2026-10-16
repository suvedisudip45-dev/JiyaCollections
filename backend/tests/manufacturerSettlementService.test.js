import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  getManufacturerSettlementSummary,
  normalizeSettlementRequest,
  reconcileManufacturerLogisticsShipmentPayments,
} from "../services/manufacturerSettlementService.js";

test("manufacturer settlement summary combines payable journals and all settlement totals", async () => {
  const client = {
    manufacturer: {
      findUnique: async () => ({ id: "mfg-1", name: "Textile Co" }),
    },
    manufacturerProductionRequest: {
      findMany: async () => [
        {
          approvedUnitCogs: new Prisma.Decimal("10"),
          approvedDeliveryCost: new Prisma.Decimal("2"),
          costTermsVersion: 2,
          lines: [{ actualQuantity: 10, damagedQuantity: 2, quantity: 10 }],
        },
        {
          approvedUnitCogs: new Prisma.Decimal("4"),
          approvedDeliveryCost: new Prisma.Decimal("50"),
          costTermsVersion: 1,
          lines: [{ actualQuantity: 5, damagedQuantity: 0, quantity: 5 }],
        },
      ],
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

  assert.equal(summary.totalManufacturedGoodsValue, 102);
  assert.equal(summary.pendingSettlementAmount, 25);
  assert.equal(summary.completedPayments, 12);
  assert.equal(summary.productionOutstanding, 90);
  assert.equal(summary.logisticsOutstanding, 3);
  assert.equal(summary.productionPayableAvailable, 70);
  assert.equal(summary.logisticsPayableAvailable, 0);
});

test("paid logistics settlements reconcile shipment freight oldest-first and expose partial balances", async () => {
  const updates = [];
  const client = {
    manufacturerSettlementRequest: {
      aggregate: async () => ({ _sum: { amount: new Prisma.Decimal("150.00") } }),
    },
    stockTransferShipment: {
      findMany: async (args) => {
        assert.deepEqual(args.orderBy, [{ dispatchedAt: "asc" }, { id: "asc" }]);
        return [
          { id: "shipment-1", freightCharge: new Prisma.Decimal("120.00"), freightPaidAmount: new Prisma.Decimal("0.00") },
          { id: "shipment-2", freightCharge: new Prisma.Decimal("100.00"), freightPaidAmount: new Prisma.Decimal("0.00") },
        ];
      },
      update: async ({ where, data }) => {
        updates.push({ id: where.id, data });
      },
    },
  };

  const result = await reconcileManufacturerLogisticsShipmentPayments({ manufacturerId: "mfg-1", client });

  assert.deepEqual(updates.map(({ id, data }) => ({
    id,
    paid: data.freightPaidAmount.toFixed(2),
    status: data.freightSettlementStatus,
  })), [
    { id: "shipment-1", paid: "120.00", status: "SETTLED" },
    { id: "shipment-2", paid: "30.00", status: "PARTIALLY_SETTLED" },
  ]);
  assert.equal(result.allocatedPaidAmount.toFixed(2), "150.00");
  assert.equal(result.unreconciledPaidAmount.toFixed(2), "0.00");
});

test("paid manufacturer logistics settlement clears recognized freight payable", async () => {
  const client = {
    manufacturer: {
      findUnique: async () => ({ id: "mfg-1", name: "Textile Co" }),
    },
    manufacturerProductionRequest: { findMany: async () => [] },
    manufacturerSettlementRequest: {
      findMany: async () => [{ status: "PAID", requestType: "LOGISTICS", amount: new Prisma.Decimal("1200.00") }],
      groupBy: async () => [{
        status: "PAID",
        requestType: "LOGISTICS",
        _sum: { amount: new Prisma.Decimal("1200.00") },
      }],
    },
    account: { findUnique: async () => ({ id: "payable-account" }) },
    journalLine: {
      findMany: async () => [
        {
          debit: new Prisma.Decimal("0"),
          credit: new Prisma.Decimal("1200"),
          supplierId: "mfg-1",
          supplierName: "Textile Co",
          accountingParty: null,
          journalEntry: { sourceType: "MANUFACTURER_LOGISTICS" },
        },
        {
          debit: new Prisma.Decimal("1200"),
          credit: new Prisma.Decimal("0"),
          supplierId: "mfg-1",
          supplierName: "Textile Co",
          accountingParty: null,
          journalEntry: { sourceType: "SUPPLIER_PAYMENT" },
        },
      ],
    },
  };

  const summary = await getManufacturerSettlementSummary("mfg-1", { client });
  assert.equal(summary.logisticsReimbursements, 1200);
  assert.equal(summary.logisticsOutstanding, 0);
  assert.equal(summary.outstandingPayable, 0);
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
