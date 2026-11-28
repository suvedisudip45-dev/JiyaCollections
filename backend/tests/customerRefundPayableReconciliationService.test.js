import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerRefundPayableReconciliation } from "../services/customerRefundPayableReconciliationService.js";

test("customer refund reconciliation matches return and NCM exchange refund payables to 2110 journals", () => {
  const result = buildCustomerRefundPayableReconciliation({
    journalLines: [
      {
        debit: "0",
        credit: "120.00",
        journalEntry: { sourceType: "SALES_RETURN", sourceId: "return-1" },
      },
      {
        debit: "0",
        credit: "75.00",
        journalEntry: { sourceType: "ORDER_EXCHANGE", sourceId: "EXCHANGE-exchange-1" },
      },
    ],
    payables: [
      {
        referenceType: "CUSTOMER_REFUND",
        referenceId: "return-1",
        totalAmount: "120.00",
        paidAmount: "20.00",
        remainingBalance: "100.00",
      },
      {
        referenceType: "CUSTOMER_EXCHANGE_REFUND",
        referenceId: "exchange-1",
        totalAmount: "75.00",
        paidAmount: "0.00",
        remainingBalance: "75.00",
      },
    ],
  });

  assert.equal(result.coverageStatus, "SOURCE_SCOPED");
  assert.equal(result.isReconciled, true);
  assert.equal(result.sourceCount, 2);
  assert.equal(result.journalPayable, 195);
  assert.equal(result.payableOriginal, 195);
  assert.equal(result.payableOutstanding, 175);
  assert.equal(result.payablePaid, 20);
  assert.equal(result.unmatchedCount, 0);
  assert.deepEqual(result.sources.map((row) => row.journalSourceId), ["EXCHANGE-exchange-1", "return-1"]);
});

test("customer refund reconciliation flags missing journals, missing payables, and mismatched originals", () => {
  const result = buildCustomerRefundPayableReconciliation({
    journalLines: [
      {
        debit: "0",
        credit: "100",
        journalEntry: { sourceType: "SALES_RETURN", sourceId: "return-without-payable" },
      },
    ],
    payables: [
      {
        referenceType: "CUSTOMER_EXCHANGE_REFUND",
        referenceId: "exchange-without-journal",
        totalAmount: "50",
        remainingBalance: "50",
      },
      {
        referenceType: "CUSTOMER_REFUND",
        referenceId: "return-with-mismatch",
        totalAmount: "75",
        remainingBalance: "75",
      },
    ],
  });

  assert.equal(result.isReconciled, false);
  assert.equal(result.unmatchedCount, 3);
  assert.equal(result.variance, 25);
  assert.ok(result.sources.every((row) => row.status === "REVIEW"));
});

test("customer refund reconciliation excludes unrelated and non-customer-refund sources", () => {
  const result = buildCustomerRefundPayableReconciliation({
    journalLines: [
      { debit: "0", credit: "100", journalEntry: { sourceType: "EXPENSE_PAYMENT", sourceId: "other" } },
      { debit: "0", credit: "0", journalEntry: { sourceType: "SALES_RETURN", sourceId: "zero-refund-return" } },
    ],
    payables: [
      { referenceType: "VENDOR_BILL", referenceId: "bill-1", totalAmount: "100" },
    ],
  });

  assert.equal(result.sourceCount, 0);
  assert.equal(result.isReconciled, false);
  assert.equal(result.journalPayable, 0);
  assert.equal(result.payableOriginal, 0);
});

test("duplicate customer-refund payable references remain a review finding", () => {
  const result = buildCustomerRefundPayableReconciliation({
    journalLines: [
      { debit: "0", credit: "100", journalEntry: { sourceType: "SALES_RETURN", sourceId: "return-1" } },
    ],
    payables: [
      { referenceType: "CUSTOMER_REFUND", referenceId: "return-1", totalAmount: "50" },
      { referenceType: "CUSTOMER_REFUND", referenceId: "return-1", totalAmount: "50" },
    ],
  });

  assert.equal(result.unmatchedCount, 1);
  assert.equal(result.sources[0].status, "REVIEW");
});
