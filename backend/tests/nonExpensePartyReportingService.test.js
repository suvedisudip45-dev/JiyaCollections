import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNonExpensePartyReport,
  calculateManufacturerDirectReceivableTotal,
  summarizePayablesAndReceivables,
} from "../services/nonExpensePartyReportingService.js";

const manufacturer = (overrides = {}) => ({
  id: "mfg-1",
  name: "Manufacturer One",
  ...overrides,
});

test("direct manufacturer collection source total shares the report's Decimal margin calculation", () => {
  const total = calculateManufacturerDirectReceivableTotal({
    manufacturerId: "mfg-1",
    products: [{ id: "product-1", costPrice: "4.00" }],
    manufacturerInventories: [{
      manufacturerId: "mfg-1",
      productId: "product-1",
      agreedCostPrice: "4.00",
      proposedCostPrice: null,
    }],
    orders: [
      {
        id: "direct-1",
        manufacturerId: "mfg-1",
        orderType: "DIRECT_MANUFACTURER",
        directOrderType: "PHONE_ORDER",
        amount: "10.02",
        items: [{ productId: "product-1", quantity: 1 }],
      },
      {
        id: "direct-2",
        manufacturerId: "mfg-1",
        orderType: "DIRECT_MANUFACTURER",
        directOrderType: "HUB_VISIT",
        amount: "20.03",
        items: [{ productId: "product-1", quantity: 2 }],
      },
    ],
  });

  assert.equal(total.toFixed(2), "18.05");
});

test("manufacturer payable and receivable synthesis uses Decimal totals and reuses stored sources", () => {
  const report = buildNonExpensePartyReport({
    asOfDate: new Date("2026-03-20T18:14:59.999Z"),
    manufacturers: [manufacturer()],
    products: [
      { id: "product-1", costPrice: "12.35" },
      { id: "product-2", costPrice: "4.10" },
    ],
    manufacturerInventories: [
      { manufacturerId: "mfg-1", productId: "product-1", agreedCostPrice: "12.35", proposedCostPrice: "99.99" },
    ],
    orders: [
      {
        id: "direct-order",
        manufacturerId: "mfg-1",
        orderType: "DIRECT_MANUFACTURER",
        directOrderType: "PHONE_ORDER",
        amount: 80,
        items: [{ productId: "product-1", quantity: 2 }],
      },
      {
        id: "storefront-order",
        manufacturerId: "mfg-1",
        orderType: "CUSTOMER",
        amount: 100,
        items: [{ productId: "product-2", quantity: 2 }],
      },
    ],
    supplierCashOutflows: [
      { referenceId: "mfg-1", amount: "5.25", partyName: "Manufacturer One" },
      { amount: "0.10", partyName: "Manufacturer One" },
    ],
    payables: [
      {
        id: "stored-mfg-ap",
        category: "SUPPLIER_INVOICE",
        referenceType: "MANUFACTURER_COGS",
        referenceId: "mfg-1",
        totalAmount: "32.90",
        paidAmount: "7.00",
        remainingBalance: "25.90",
        status: "PARTIALLY_PAID",
        dueDate: "2026-03-20",
      },
      {
        id: "expense-ap",
        referenceType: "EXPENSE",
        category: "OPERATING_EXPENSE",
        totalAmount: "1.25",
        paidAmount: "0.25",
        creditAppliedAmount: "0.00",
        remainingBalance: "1.00",
        status: "PARTIALLY_PAID",
        isExpenseLinked: true,
        isOverdue: false,
        sourceConsistencyStatus: "MATCH",
      },
    ],
    receivables: [{
      id: "stored-mfg-ar",
      referenceType: "MANUFACTURER_DIRECT",
      referenceId: "mfg-1",
      totalAmount: "55.30",
      receivedAmount: "5.30",
      remainingBalance: "50.00",
      status: "PARTIALLY_RECEIVED",
      dueDate: "2026-03-20",
    }],
  });

  assert.equal(report.payables.length, 2);
  assert.equal(report.payables[0].id, "stored-mfg-ap");
  assert.equal(report.payables[0].totalAmount, "32.90");
  assert.equal(report.payables[0].paidAmount, "7.00");
  assert.equal(report.payables[0].remainingBalance, "25.90");
  assert.equal(report.payables[0].status, "PARTIALLY_PAID");
  assert.equal(report.payables[0].isPartyBalance, true);
  assert.equal(report.payables[0].isOverdue, false);
  assert.equal(report.payables[1].isExpenseLinked, true);
  assert.equal(report.payables[1].sourceConsistencyStatus, "MATCH");
  assert.equal(report.payables[1].isOverdue, false);
  assert.equal(report.payables[1].remainingBalance, "1.00");
  assert.equal(report.receivables.length, 1);
  assert.equal(report.receivables[0].totalAmount, "55.30");
  assert.equal(report.receivables[0].receivedAmount, "5.30");
  assert.equal(report.receivables[0].remainingBalance, "50.00");
  assert.equal(report.receivables[0].status, "PARTIALLY_RECEIVED");
  assert.equal(report.receivables[0].isOverdue, false);

  const metrics = summarizePayablesAndReceivables({
    payables: report.payables,
    receivables: report.receivables,
    accounts: [{ currentBalance: "20.00" }],
  });
  assert.equal(metrics.totalPayablesOutstanding, "26.90");
  assert.equal(metrics.totalPayablesSettled, "7.25");
  assert.equal(metrics.totalReceivablesOutstanding, "50.00");
  assert.equal(metrics.totalReceivablesCollected, "5.30");
  assert.equal(metrics.totalLiquidCash, "20.00");
  assert.equal(metrics.netPayablePressure, "6.90");
  assert.equal(metrics.canCoverAllPayablesNow, false);
});

test("distributor settlement payable is capped by its linked earning documents without duplicate rows", () => {
  const report = buildNonExpensePartyReport({
    asOfDate: new Date("2026-03-20T18:15:00.000Z"),
    distributorSettlementRequests: [
      {
        id: "request-1",
        distributorId: "dist-1",
        amount: "10.00",
        paidAmount: "3.00",
        requestedAt: new Date("2026-03-01T00:00:00.000Z"),
        metadata: {
          settlementBasis: "ACCOUNTING_SUBLEDGER",
          earningDocumentIds: ["earning-1", "earning-2"],
          statementSnapshot: { vatMode: "WITHOUT_VAT" },
        },
        distributor: { name: "Distributor One" },
      },
      {
        id: "request-duplicate",
        distributorId: "dist-1",
        amount: "5.00",
        paidAmount: "0.00",
        metadata: { settlementBasis: "ACCOUNTING_SUBLEDGER", earningDocumentIds: ["earning-1"] },
      },
      {
        id: "request-legacy",
        distributorId: "dist-1",
        amount: "99.00",
        paidAmount: "0.00",
        metadata: { settlementBasis: "LEGACY", earningDocumentIds: ["earning-1"] },
      },
    ],
    distributorEarningDocuments: [
      { id: "earning-1", remainingAmount: "5.25", party: { sourceEntityId: "dist-1" } },
      { id: "earning-2", remainingAmount: "3.75", party: { sourceEntityId: "dist-1" } },
      { id: "earning-other", remainingAmount: "50.00", party: { sourceEntityId: "dist-2" } },
    ],
    payables: [{
      id: "request-duplicate",
      referenceType: "DISTRIBUTOR_SETTLEMENT",
      referenceId: "request-duplicate",
      totalAmount: "5.00",
      paidAmount: "1.00",
      remainingBalance: "4.00",
      status: "PARTIALLY_PAID",
    }],
  });

  const request = report.payables.find(({ id }) => id === "request-1");
  assert.equal(request.totalAmount, "10.00");
  assert.equal(request.paidAmount, "3.00");
  assert.equal(request.remainingBalance, "7.00");
  assert.equal(request.status, "PARTIALLY_PAID");
  assert.equal(request.settlementVatMode, "WITHOUT_VAT");
  assert.equal(request.isPartyBalance, true);
  assert.equal(report.payables.filter(({ id }) => id === "request-duplicate").length, 1);
  assert.equal(report.payables.some(({ id }) => id === "request-legacy"), false);
});

test("party report preserves positive residuals, negative credits, and Kathmandu due-date boundaries", () => {
  const base = {
    manufacturers: [],
    orders: [],
    payables: [
      {
        id: "one-cent",
        referenceType: "DISTRIBUTOR_SETTLEMENT",
        totalAmount: "1.00",
        paidAmount: "0.99",
        creditAppliedAmount: "0.00",
        remainingBalance: "0.01",
        status: "SETTLED",
        dueDate: "2026-03-20",
      },
      {
        id: "credit",
        referenceType: "DISTRIBUTOR_SETTLEMENT",
        totalAmount: "1.00",
        paidAmount: "1.10",
        creditAppliedAmount: "0.00",
        remainingBalance: "-0.10",
        status: "UNPAID",
        dueDate: "2026-03-19",
      },
    ],
    receivables: [],
  };
  const beforeMidnight = buildNonExpensePartyReport({
    ...base,
    asOfDate: new Date("2026-03-20T18:14:59.999Z"),
  });
  const atMidnight = buildNonExpensePartyReport({
    ...base,
    asOfDate: new Date("2026-03-20T18:15:00.000Z"),
  });

  assert.equal(beforeMidnight.payables[0].status, "PARTIALLY_PAID");
  assert.equal(beforeMidnight.payables[0].isOverdue, false);
  assert.equal(atMidnight.payables[0].remainingBalance, "0.01");
  assert.equal(atMidnight.payables[0].isOverdue, true);
  assert.equal(atMidnight.payables[1].remainingBalance, "-0.10");
  assert.equal(atMidnight.payables[1].status, "UNPAID");
  assert.equal(atMidnight.payables[1].isOverdue, false);
});

test("explicit due timestamps retain their instant boundary", () => {
  const args = {
    manufacturers: [],
    orders: [],
    payables: [{
      id: "timestamp-due",
      referenceType: "MANUFACTURER_COGS",
      totalAmount: "4.00",
      paidAmount: "0.00",
      remainingBalance: "4.00",
      status: "UNPAID",
      dueDate: new Date("2026-03-20T18:15:00.000Z"),
    }],
    receivables: [],
  };

  assert.equal(buildNonExpensePartyReport({
    ...args,
    asOfDate: new Date("2026-03-20T18:14:59.999Z"),
  }).payables[0].isOverdue, false);
  assert.equal(buildNonExpensePartyReport({
    ...args,
    asOfDate: new Date("2026-03-20T18:15:00.000Z"),
  }).payables[0].isOverdue, false);
  assert.equal(buildNonExpensePartyReport({
    ...args,
    asOfDate: new Date("2026-03-20T18:15:00.001Z"),
  }).payables[0].isOverdue, true);
});

test("stored party balances classify exact settlement and preserve zero-value statuses", () => {
  const report = buildNonExpensePartyReport({
    manufacturers: [],
    orders: [],
    payables: [
      {
        id: "fully-settled",
        referenceType: "MANUFACTURER_COGS",
        totalAmount: "9.99",
        paidAmount: "9.99",
        remainingBalance: "0.00",
        status: "UNPAID",
      },
      {
        id: "zero-value",
        referenceType: "DISTRIBUTOR_SETTLEMENT",
        totalAmount: "0.00",
        paidAmount: "0.00",
        remainingBalance: "0.00",
        status: "UNPAID",
      },
    ],
    receivables: [{
      id: "fully-received",
      referenceType: "MANUFACTURER_DIRECT",
      totalAmount: "3.25",
      receivedAmount: "3.25",
      remainingBalance: "0.00",
      status: "UNPAID",
    }],
  });

  assert.equal(report.payables[0].status, "SETTLED");
  assert.equal(report.payables[1].status, "UNPAID");
  assert.equal(report.payables[1].remainingBalance, "0.00");
  assert.equal(report.receivables[0].status, "SETTLED");
});

test("large manufacturer balances serialize as exact decimal strings", () => {
  const amount = "999999999999999999.99";
  const report = buildNonExpensePartyReport({
    manufacturers: [manufacturer()],
    products: [{ id: "expensive-product", costPrice: amount }],
    orders: [{
      id: "large-order",
      manufacturerId: "mfg-1",
      items: [{ productId: "expensive-product", quantity: 1 }],
    }],
    payables: [],
    receivables: [],
  });

  assert.equal(report.payables[0].totalAmount, amount);
  assert.equal(report.payables[0].remainingBalance, amount);
  assert.equal(typeof report.payables[0].remainingBalance, "string");
});

test("manufacturer settlement inputs are quantized before calculating the remainder", () => {
  const report = buildNonExpensePartyReport({
    manufacturers: [manufacturer()],
    products: [{ id: "product-1", costPrice: "1.00" }],
    orders: [{
      id: "order-1",
      manufacturerId: "mfg-1",
      items: [{ productId: "product-1", quantity: 1 }],
    }],
    supplierCashOutflows: [{ referenceId: "mfg-1", amount: "0.994" }],
    payables: [],
    receivables: [],
  });

  assert.equal(report.payables[0].paidAmount, "0.99");
  assert.equal(report.payables[0].remainingBalance, "0.01");
  assert.equal(report.payables[0].status, "PARTIALLY_PAID");
});

test("summary settled and collected totals retain their existing paid-field meaning", () => {
  const metrics = summarizePayablesAndReceivables({
    payables: [{
      status: "PARTIALLY_PAID",
      totalAmount: "100.00",
      paidAmount: "20.00",
      creditAppliedAmount: "30.00",
      remainingBalance: "50.00",
    }],
    receivables: [{
      status: "PARTIALLY_RECEIVED",
      totalAmount: "100.00",
      receivedAmount: "20.00",
      remainingBalance: "50.00",
    }],
  });
  assert.equal(metrics.totalPayablesSettled, "20.00");
  assert.equal(metrics.totalReceivablesCollected, "20.00");
});
