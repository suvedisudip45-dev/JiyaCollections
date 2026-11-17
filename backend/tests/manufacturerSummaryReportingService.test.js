import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAllManufacturersSummary,
  buildSingleManufacturerSummary,
  serializeManufacturerSummaryTransactions,
  summarizePostedManufacturerPayable,
} from "../services/manufacturerSummaryReportingService.js";

test("single manufacturer report preserves role meanings and exact decimal strings", () => {
  const report = buildSingleManufacturerSummary({
    manufacturerId: "mfg-1",
    manufacturer: { id: "mfg-1", name: "Maker One" },
    isAdminView: true,
    inventoryRows: [
      { manufacturerId: "mfg-1", productId: "p-1", agreedCostPrice: 20.25 },
      { manufacturerId: "mfg-2", productId: "p-1", agreedCostPrice: 999 },
    ],
    products: [
      { id: "p-1", costPrice: 99 },
      { id: "p-2", costPrice: 10 },
    ],
    orders: [
      {
        id: "direct-1",
        manufacturerId: "mfg-1",
        amount: 100.125,
        orderType: "DIRECT_MANUFACTURER",
        directOrderType: "PHONE_ORDER",
        status: "Order Placed",
        items: [{ productId: "p-1", quantity: 2 }],
      },
      {
        id: "platform-1",
        manufacturerId: "mfg-1",
        amount: null,
        status: "Delivered",
        fulfillmentStatus: "DELIVERED",
        items: [{ productId: "p-2", quantity: 1 }],
      },
      {
        id: "foreign-order",
        manufacturerId: "mfg-2",
        amount: 9007199254740992,
        orderType: "DIRECT_MANUFACTURER",
        directOrderType: "PHONE_ORDER",
        items: [{ productId: "p-1", quantity: 1 }],
      },
    ],
    transactions: [
      {
        id: "cash-in",
        referenceId: "mfg-1",
        amount: "4.25",
        type: "INFLOW",
        date: new Date("2026-03-01T00:00:00.000Z"),
      },
      {
        id: "foreign-cash",
        referenceId: "mfg-2",
        amount: "999999999.99",
        type: "INFLOW",
      },
    ],
    postedPayableLines: [
      {
        credit: "100.00",
        debit: "0.00",
        supplierId: "mfg-1",
        journalEntry: { sourceType: "MANUFACTURER_PRODUCTION", sourceId: "production-1" },
      },
      {
        credit: "0.00",
        debit: "30.00",
        supplierId: null,
        supplierName: null,
        journalEntry: { sourceType: "SUPPLIER_PAYMENT", sourceId: "MFG-COGS-mfg-1" },
      },
    ],
  });

  assert.equal(report.summary.totalOrders, 2);
  assert.equal(report.summary.totalSales, "100.12");
  assert.equal(report.summary.totalCogs, "50.50");
  assert.equal(report.summary.payable, "100.00");
  assert.equal(report.summary.paidAmount, "30.00");
  assert.equal(report.summary.remainingPayable, "70.00");
  assert.equal(report.summary.receivable, "59.62");
  assert.equal(report.summary.collectedAmount, "4.25");
  assert.equal(report.summary.remainingReceivable, "55.37");
  assert.equal(report.summary.netPayable, "14.63");
  assert.equal(report.summary.netSettlementDue, "14.63");
  assert.equal(report.summary.itemsSold, 3);
  assert.equal(report.summary.itemsDelivered, 1);
  assert.deepEqual(report.orders.map(({ id }) => id), ["direct-1", "platform-1"]);
  assert.equal(report.orders[0].amount, "100.125");
  assert.equal(report.orders[0].cogs, "40.50");
  assert.equal(report.orders[0].payable, "40.50");
  assert.equal(report.orders[0].receivable, "59.62");
  assert.equal(report.orders[0].netPosition, "19.12");
  assert.equal(typeof report.orders[0].payable, "string");
  assert.equal(report.transactions.length, 1);
  assert.equal(report.transactions[0].amount, "4.25");
  assert.equal(report.manufacturers[0].remainingPayable, "70.00");
});

test("all-manufacturer report aggregates Decimal sources and preserves large transaction strings", () => {
  const report = buildAllManufacturersSummary({
    manufacturers: [
      { id: "mfg-1", name: "Maker One" },
      { id: "mfg-2", name: "Maker Two" },
    ],
    products: [
      { id: "p-1", costPrice: 12.35 },
      { id: "p-2", costPrice: 0 },
    ],
    inventoryRows: [
      { manufacturerId: "mfg-1", productId: "p-1", agreedCostPrice: 10.25 },
      { manufacturerId: "mfg-2", productId: "p-2", proposedCostPrice: 5 },
    ],
    orders: [
      {
        id: "mfg-1-direct",
        manufacturerId: "mfg-1",
        amount: 100,
        orderType: "DIRECT_MANUFACTURER",
        directOrderType: "HUB_VISIT",
        items: [{ productId: "p-1", quantity: 2 }],
      },
      {
        id: "mfg-2-platform",
        manufacturerId: "mfg-2",
        amount: 500,
        orderType: "CUSTOMER",
        items: [{ productId: "p-2", quantity: 2 }],
      },
      {
        id: "unassigned",
        manufacturerId: "mfg-3",
        amount: 200,
        items: [{ productId: "p-1", quantity: 1 }],
      },
    ],
    supplierPayments: [
      { referenceId: "mfg-2", amount: "0.25", partyName: "Maker Two", type: "OUTFLOW" },
      { referenceId: null, amount: "9007199254740993.01", partyName: "External", type: "OUTFLOW" },
    ],
    apRecords: [{ referenceId: "mfg-2", paidAmount: "0.50" }],
    postedPayableLines: [
      {
        credit: "30.00",
        debit: "0.00",
        supplierId: "mfg-1",
        supplierName: "Maker One",
        journalEntry: { sourceType: "MANUFACTURER_PRODUCTION", sourceId: "production-1" },
      },
      {
        credit: "0.00",
        debit: "5.00",
        supplierId: "mfg-1",
        supplierName: "Maker One",
        journalEntry: { sourceType: "SUPPLIER_PAYMENT", sourceId: "payment-1" },
      },
    ],
  });

  assert.equal(report.summary.totalOrders, 2);
  assert.equal(report.summary.totalSales, "100.00");
  assert.equal(report.summary.totalCogs, "30.50");
  assert.equal(report.summary.payable, "40.00");
  assert.equal(report.summary.paidAmount, "5.50");
  assert.equal(report.summary.remainingPayable, "34.50");
  assert.equal(report.summary.receivable, "79.50");
  assert.equal(report.summary.netReceivable, "45.00");
  assert.deepEqual(report.orders.map(({ id }) => id), ["mfg-1-direct", "mfg-2-platform"]);

  const [makerOne, makerTwo] = report.manufacturers;
  assert.equal(makerOne.payable, "30.00");
  assert.equal(makerOne.paidAmount, "5.00");
  assert.equal(makerOne.remainingPayable, "25.00");
  assert.equal(makerOne.receivable, "79.50");
  assert.equal(makerOne.netReceivable, "54.50");
  assert.equal(makerTwo.payable, "10.00");
  assert.equal(makerTwo.paidAmount, "0.50");
  assert.equal(makerTwo.remainingPayable, "9.50");
  const transactions = serializeManufacturerSummaryTransactions([
    { id: "large", amount: "9007199254740993.01" },
  ]);
  assert.equal(typeof transactions[0].amount, "string");
  assert.equal(transactions[0].amount, "9007199254740993.01");
});

test("empty, null, and negative posted amounts remain explicit Decimal results", () => {
  const empty = buildAllManufacturersSummary({ manufacturers: [{ id: "mfg-1", name: "Maker One" }] });
  assert.equal(empty.summary.totalSales, "0.00");
  assert.equal(empty.summary.remainingPayable, "0.00");
  assert.equal(empty.manufacturers[0].payable, "0.00");

  const negative = summarizePostedManufacturerPayable([{
    debit: "7.25",
    credit: "0",
    supplierId: "mfg-1",
    supplierName: "Maker One",
    journalEntry: { sourceType: "MANUFACTURER_PRODUCTION", sourceId: "correction-1" },
  }], "mfg-1", "Maker One");
  assert.equal(negative.recognized, "-7.25");
  assert.equal(negative.paid, "0.00");
  assert.equal(negative.outstanding, "0.00");
});

test("Float-backed source values are stringified only after the database-number boundary", () => {
  const sourceValue = 0.1 + 0.2;
  const report = buildSingleManufacturerSummary({
    manufacturerId: "mfg-1",
    orders: [{
      id: "direct",
      manufacturerId: "mfg-1",
      amount: sourceValue,
      orderType: "DIRECT_MANUFACTURER",
      directOrderType: "PHONE_ORDER",
      items: [],
    }],
  });

  assert.equal(report.orders[0].amount, String(sourceValue));
  assert.equal(report.orders[0].amount, "0.30000000000000004");
});
