import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { serializeManufacturerSettlementHistory } from "../services/manufacturerSettlementReportingService.js";

test("serializes request, payout, adjustment, and cash amounts as exact decimal strings", () => {
  const [settlement] = serializeManufacturerSettlementHistory([{
    id: "request-1",
    amount: new Prisma.Decimal("500.01"),
    paidAmount: new Prisma.Decimal("500.00"),
    status: "PARTIALLY_PAID",
    payoutHistory: [{
      id: "payout-1",
      amount: new Prisma.Decimal("499.90"),
      settlementAmount: new Prisma.Decimal("500.00"),
      adjustmentType: "DISCOUNT",
      adjustmentAmount: new Prisma.Decimal("0.10"),
      status: "SETTLED",
      cashTransaction: { id: "cash-1", amount: new Prisma.Decimal("499.90") },
    }],
  }]);

  assert.equal(settlement.amount, "500.01");
  assert.equal(settlement.paidAmount, "500");
  assert.equal(settlement.remainingAmount, "0.01");
  assert.equal(settlement.status, "PARTIALLY_PAID");
  assert.equal(settlement.payoutHistory[0].amount, "499.9");
  assert.equal(settlement.payoutHistory[0].settlementAmount, "500");
  assert.equal(settlement.payoutHistory[0].adjustmentType, "DISCOUNT");
  assert.equal(settlement.payoutHistory[0].adjustmentAmount, "0.1");
  assert.equal(settlement.payoutHistory[0].cashTransaction.amount, "499.9");
});

test("keeps positive residuals open while exact zero and negative remainders clamp to zero", () => {
  const [partial, paid, overpaid, rejected, zero, negativeAmount, negativePaid] = serializeManufacturerSettlementHistory([
    { id: "partial", amount: "12.30", paidAmount: "12.29", status: "PARTIALLY_PAID" },
    { id: "paid", amount: "12.30", paidAmount: "12.30", status: "PAID" },
    { id: "overpaid", amount: "12.30", paidAmount: "12.31", status: "PAID" },
    { id: "rejected", amount: "12.30", paidAmount: "0", status: "REJECTED" },
    { id: "zero", amount: "0.00", paidAmount: null, status: "PENDING" },
    { id: "negative-amount", amount: "-1.00", paidAmount: "0", status: "REJECTED" },
    { id: "negative-paid", amount: "10.00", paidAmount: "-1.00", status: "PARTIALLY_PAID" },
  ]);

  assert.equal(partial.remainingAmount, "0.01");
  assert.equal(partial.status, "PARTIALLY_PAID");
  assert.equal(paid.remainingAmount, "0");
  assert.equal(overpaid.remainingAmount, "0");
  assert.equal(rejected.remainingAmount, "12.3");
  assert.equal(zero.amount, "0");
  assert.equal(zero.paidAmount, "0");
  assert.equal(zero.remainingAmount, "0");
  assert.equal(negativeAmount.amount, "-1");
  assert.equal(negativeAmount.remainingAmount, "0");
  assert.equal(negativePaid.remainingAmount, "11");
});

test("preserves large valid amounts and does not aggregate separate history records", () => {
  const settlements = serializeManufacturerSettlementHistory([
    { id: "request-1", amount: "999999999999999999.99", paidAmount: "0", status: "PENDING" },
    { id: "request-2", amount: "999999999999999999.99", paidAmount: "0", status: "PENDING" },
  ]);

  assert.equal(settlements.length, 2);
  assert.equal(settlements[0].amount, "999999999999999999.99");
  assert.equal(settlements[1].amount, "999999999999999999.99");
  assert.equal(settlements[0].remainingAmount, "999999999999999999.99");
  assert.equal(settlements[1].remainingAmount, "999999999999999999.99");
});

test("failed and reversed payout attempts do not change the stored paid balance", () => {
  const [settlement] = serializeManufacturerSettlementHistory([{
    id: "request-1",
    amount: "20.00",
    paidAmount: "5.00",
    status: "PARTIALLY_PAID",
    payoutHistory: [
      { id: "failed", amount: "7.00", settlementAmount: "7.00", status: "FAILED" },
      { id: "reversed", amount: "8.00", settlementAmount: "8.00", status: "REVERSED" },
    ],
  }]);

  assert.equal(settlement.remainingAmount, "15");
  assert.deepEqual(settlement.payoutHistory.map(({ status }) => status), ["FAILED", "REVERSED"]);
});

test("does not accept JavaScript numbers as monetary source values", () => {
  assert.throws(
    () => serializeManufacturerSettlementHistory([{ amount: 0.1 + 0.2, paidAmount: "0" }]),
    /decimal string or Prisma Decimal/,
  );
});
