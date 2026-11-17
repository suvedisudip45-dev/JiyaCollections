import assert from "node:assert/strict";
import test from "node:test";
import { buildExpenseLinkedPayableReport } from "../services/expensePayableReportingService.js";

const payable = (overrides = {}) => ({
  id: "payable-1",
  category: "OPERATING_EXPENSE",
  referenceType: "EXPENSE",
  referenceId: "expense-1",
  totalAmount: "12.35",
  paidAmount: "0.00",
  creditAppliedAmount: "0.00",
  remainingBalance: "12.35",
  status: "UNPAID",
  dueDate: "2026-03-19",
  settlementHistory: [],
  ...overrides,
});

const expense = (overrides = {}) => ({
  id: "expense-1",
  payableId: "payable-1",
  amount: "12.35",
  paidAmount: "0.00",
  payableAmount: "12.35",
  ...overrides,
});

test("expense payable report serializes unpaid, partial, settled, adjusted, and zero-value balances exactly", () => {
  const report = buildExpenseLinkedPayableReport({
    asOfDate: new Date("2026-03-20T18:14:59.999Z"),
    payables: [
      payable(),
      payable({
        id: "payable-2",
        referenceId: "expense-2",
        totalAmount: "1.00",
        paidAmount: "0.30",
        creditAppliedAmount: "0.10",
        remainingBalance: "0.60",
        status: "UNPAID",
        dueDate: "2026-03-20",
        settlementHistory: [{
          id: "payment-1",
          amount: 0.3,
          settlementAmount: "0.40",
          adjustmentAmount: "0.10",
        }],
      }),
      payable({
        id: "payable-3",
        referenceId: "expense-3",
        totalAmount: "0.03",
        paidAmount: "0.03",
        remainingBalance: "0.00",
        status: "PARTIALLY_PAID",
        dueDate: "2026-03-18",
      }),
      payable({
        id: "payable-4",
        referenceId: "expense-4",
        totalAmount: "1.00",
        paidAmount: "0.99",
        remainingBalance: "0.01",
        status: "SETTLED",
        dueDate: "2026-03-20",
      }),
      payable({
        id: "payable-5",
        referenceId: "expense-5",
        totalAmount: "0.00",
        paidAmount: "0.00",
        remainingBalance: "0.00",
        status: "UNPAID",
        dueDate: null,
      }),
      payable({ id: "non-expense", category: "TAX_DUE", referenceType: "TAX_FILING" }),
    ],
    expenses: [
      expense(),
      expense({ id: "expense-2", payableId: "payable-2", amount: "1.00", payableAmount: "1.00" }),
      expense({ id: "expense-3", payableId: "payable-3", amount: "0.03", payableAmount: "0.03" }),
      expense({ id: "expense-4", payableId: "payable-4", amount: "1.00", payableAmount: "1.00" }),
      expense({ id: "expense-5", payableId: "payable-5", amount: "0.00", payableAmount: "0.00" }),
    ],
  });

  assert.equal(report.payables.length, 5);
  assert.deepEqual(report.payables.map(({ status }) => status), [
    "UNPAID",
    "PARTIALLY_PAID",
    "SETTLED",
    "PARTIALLY_PAID",
    "UNPAID",
  ]);
  assert.equal(report.payables[0].isOverdue, true);
  assert.equal(report.payables[1].isOverdue, false);
  assert.equal(report.payables[2].isOverdue, false);
  assert.equal(report.payables[3].remainingBalance, "0.01");
  assert.equal(report.payables[3].status, "PARTIALLY_PAID");
  assert.equal(report.payables[1].settlementHistory[0].amount, "0.3");
  assert.equal(report.payables[1].settlementHistory[0].settlementAmount, "0.4");
  assert.equal(report.payables[0].sourceConsistencyStatus, "MATCH");
  assert.equal(report.summary.totalAmount, "14.38");
  assert.equal(report.summary.paidAmount, "1.32");
  assert.equal(report.summary.creditAppliedAmount, "0.10");
  assert.equal(report.summary.outstandingAmount, "12.96");
  assert.equal(report.summary.overdueAmount, "12.35");
  assert.equal(report.summary.outstandingCount, 3);
  assert.equal(report.summary.overdueCount, 1);
  assert.equal(report.summary.sourceExceptionCount, 0);
});

test("expense payable overdue cutoff changes at Kathmandu midnight", () => {
  const dueToday = payable({ dueDate: "2026-03-20" });
  const beforeMidnight = buildExpenseLinkedPayableReport({
    payables: [dueToday],
    expenses: [expense()],
    asOfDate: new Date("2026-03-20T18:14:59.999Z"),
  });
  const atMidnight = buildExpenseLinkedPayableReport({
    payables: [dueToday],
    expenses: [expense()],
    asOfDate: new Date("2026-03-20T18:15:00.000Z"),
  });

  assert.equal(beforeMidnight.payables[0].isOverdue, false);
  assert.equal(atMidnight.payables[0].isOverdue, true);
});

test("expense payable report preserves large Decimal values and flags source discrepancies", () => {
  const large = "999999999999999999.99";
  const report = buildExpenseLinkedPayableReport({
    payables: [
      payable({
        totalAmount: large,
        remainingBalance: large,
      }),
      payable({
        id: "payable-mismatch",
        referenceId: "expense-mismatch",
        totalAmount: "20.00",
        remainingBalance: "20.00",
      }),
      payable({
        id: "payable-missing",
        referenceId: "expense-missing",
        totalAmount: "1.00",
        remainingBalance: "1.00",
      }),
    ],
    expenses: [
      expense({ amount: large, payableAmount: large }),
      expense({ id: "expense-mismatch", payableId: "payable-mismatch", amount: "20.00", payableAmount: "19.99" }),
    ],
    asOfDate: new Date("2026-03-20T00:00:00.000Z"),
  });

  assert.equal(report.payables[0].totalAmount, large);
  assert.equal(report.summary.outstandingAmount, "1000000000000000020.99");
  assert.equal(report.payables[1].sourceConsistencyStatus, "AMOUNT_MISMATCH");
  assert.equal(report.payables[2].sourceConsistencyStatus, "SOURCE_MISSING");
  assert.equal(report.summary.sourceExceptionCount, 2);
});
