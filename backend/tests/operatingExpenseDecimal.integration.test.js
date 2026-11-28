import "../utils/requireIntegrationDatabaseSafety.js";
import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { recordOperatingExpense } from "../controllers/financialController.js";
import { serializeAccountingValue } from "../services/accountingDecimal.js";

const databaseName = process.env.DATABASE_URL
  ? decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\/+/, ""))
  : "";
const integrationEnabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "1";

if (integrationEnabled && databaseName !== "clothing_test") {
  throw new Error("Expense Decimal integration tests may run only against the verified clothing_test database.");
}

test("OperatingExpense and AccountPayable preserve Decimal values in the isolated MySQL database", {
  skip: !integrationEnabled,
}, async () => {
  const expenseId = `P42-ROUNDTRIP-${randomUUID()}`;
  const payableId = `P42-AP-ROUNDTRIP-${randomUUID()}`;
  const rollbackId = `P42-ROLLBACK-${randomUUID()}`;
  const controllerRequestKey = `P42-CONTROLLER-${randomUUID()}`;

  try {
    const partyId = randomUUID();
    const treasuryAccountId = randomUUID();
    const bankGlAccount = await prisma.account.findUnique({ where: { accountCode: "1110" } });
    assert.ok(bankGlAccount, "Mapped cash GL account 1110 must exist for the source integration test.");
    const party = await prisma.accountingParty.create({
      data: {
        partyType: "VENDOR",
        sourceEntityId: `P42-TEST-${partyId}`,
        displayName: `P4.2 synthetic vendor ${partyId}`,
      },
    });
    const treasuryAccount = await prisma.financialAccount.create({
      data: {
        id: treasuryAccountId,
        accountName: `P4.2 synthetic cash ${partyId}`,
        accountType: "CASH",
        currentBalance: "500.00",
        accountingAccountId: bankGlAccount.id,
      },
    });
    const requestBody = {
      idempotencyKey: controllerRequestKey,
      title: "P4.2 partial expense source integration test",
      category: "UTILITIES",
      amount: "100.15",
      paymentMethod: "PARTIAL",
      upfrontPaidAmount: "40.05",
      paidFromAccountId: treasuryAccount.id,
      payeeName: party.displayName,
      accountingPartyId: party.id,
      invoiceNumber: `P42-${partyId}`,
    };
    const invokeRecordExpense = async (body) => {
      let statusCode = 200;
      let responseBody;
      const response = {
        status(code) {
          statusCode = code;
          return response;
        },
        json(value) {
          responseBody = value;
          return response;
        },
      };
      await recordOperatingExpense({
        body,
        auth: {},
        ip: "127.0.0.1",
        get: (name) => name.toLowerCase() === "idempotency-key" ? body.idempotencyKey : null,
      }, response);
      return { statusCode, body: responseBody };
    };
    const createdResponse = await invokeRecordExpense(requestBody);
    assert.equal(createdResponse.statusCode, 200);
    assert.equal(createdResponse.body.success, true);
    assert.equal(createdResponse.body.expense.amount, "100.15");
    assert.equal(createdResponse.body.expense.paidAmount, "40.05");
    assert.equal(createdResponse.body.expense.payableAmount, "60.10");

    const controllerExpenseId = createdResponse.body.expense.id;
    const replayResponse = await invokeRecordExpense(requestBody);
    assert.equal(replayResponse.statusCode, 200);
    assert.equal(replayResponse.body.alreadyProcessed, true);
    assert.equal(replayResponse.body.expense.id, controllerExpenseId);

    const conflictResponse = await invokeRecordExpense({ ...requestBody, amount: "101.00" });
    assert.equal(conflictResponse.statusCode, 409);
    assert.equal(conflictResponse.body.code, "IDEMPOTENCY_KEY_REUSED");

    const requestHash = createHash("sha256").update(controllerRequestKey).digest("hex");
    const [controllerExpense, controllerPayables, controllerCash, controllerJournals, controllerBill] = await Promise.all([
      prisma.operatingExpense.findUnique({ where: { id: controllerExpenseId } }),
      prisma.accountPayable.findMany({ where: { referenceType: "EXPENSE", referenceId: controllerExpenseId } }),
      prisma.cashTransaction.findMany({ where: { idempotencyKey: `EXPENSE_CASH:${requestHash}` } }),
      prisma.journalEntry.findMany({ where: { sourceType: "EXPENSE_PAYMENT", sourceId: controllerExpenseId } }),
      prisma.accountingDocument.findUnique({ where: { idempotencyKey: `OPERATING_EXPENSE_BILL:${controllerExpenseId}` } }),
    ]);
    assert.equal(controllerExpense.amount.toFixed(2), "100.15");
    assert.equal(controllerPayables.length, 1);
    assert.equal(controllerPayables[0].totalAmount.toFixed(2), "60.10");
    assert.equal(controllerPayables[0].remainingBalance.toFixed(2), "60.10");
    assert.equal(controllerCash.length, 1);
    assert.equal(controllerCash[0].amount.toFixed(2), "40.05");
    assert.equal(controllerJournals.length, 1);
    assert.equal(controllerJournals[0].totalDebit.toFixed(2), "100.15");
    assert.equal(controllerJournals[0].totalCredit.toFixed(2), "100.15");
    assert.equal(controllerBill.originalAmount.toFixed(2), "100.15");
    assert.equal(controllerBill.allocatedAmount.toFixed(2), "40.05");
    assert.equal(controllerBill.remainingAmount.toFixed(2), "60.10");

    const expense = await prisma.operatingExpense.create({
      data: {
        id: expenseId,
        title: "P4.2 Decimal round-trip integration test",
        category: "UTILITIES",
        amount: "90071992547409.91",
        vatAmount: "0.01",
        paidAmount: "90071992547409.90",
        payableAmount: "0.01",
        paymentMethod: "CREDIT",
        paymentStatus: "PARTIALLY_PAID",
        createdBy: "P4.2_TEST",
      },
    });
    assert.equal(expense.amount.toFixed(2), "90071992547409.91");
    assert.equal(expense.paidAmount.toFixed(2), "90071992547409.90");
    assert.equal(expense.payableAmount.toFixed(2), "0.01");
    assert.equal(serializeAccountingValue(expense).amount, "90071992547409.91");

    const updatedExpense = await prisma.operatingExpense.update({
      where: { id: expenseId },
      data: {
        amount: "90071992547409.92",
        payableAmount: "0.02",
      },
    });
    assert.equal(updatedExpense.amount.toFixed(2), "90071992547409.92");
    assert.equal(updatedExpense.paidAmount.plus(updatedExpense.payableAmount).toFixed(2), updatedExpense.amount.toFixed(2));

    const expenseAggregate = await prisma.operatingExpense.aggregate({
      where: { id: expenseId },
      _sum: { amount: true, paidAmount: true, payableAmount: true },
    });
    assert.equal(expenseAggregate._sum.amount.toFixed(2), "90071992547409.92");

    const payable = await prisma.accountPayable.create({
      data: {
        id: payableId,
        title: "P4.2 Decimal payable round-trip integration test",
        payeeName: "Synthetic supplier",
        category: "OPERATING_EXPENSE",
        referenceType: "EXPENSE",
        referenceId: expenseId,
        totalAmount: "12.34",
        paidAmount: "1.23",
        creditAppliedAmount: "0.11",
        remainingBalance: "11.00",
        status: "PARTIALLY_PAID",
        settlementHistory: [{
          id: "p42-roundtrip-settlement",
          amount: "1.23",
          settlementAmount: "1.23",
          adjustmentAmount: "0.00",
        }],
      },
    });
    assert.equal(payable.totalAmount.toFixed(2), "12.34");
    assert.equal(payable.creditAppliedAmount.toFixed(2), "0.11");
    assert.equal(payable.settlementHistory[0].amount, "1.23");

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.operatingExpense.create({
          data: {
            id: rollbackId,
            title: "P4.2 transaction rollback integration test",
            category: "UTILITIES",
            amount: "1.01",
            paidAmount: "1.01",
            payableAmount: "0.00",
            paymentMethod: "CASH",
            paymentStatus: "PAID",
            createdBy: "P4.2_TEST",
          },
        });
        throw new Error("P4.2 intentional rollback");
      }),
      /P4\.2 intentional rollback/,
    );
    assert.equal(await prisma.operatingExpense.findUnique({ where: { id: rollbackId } }), null);

    const amountEvidence = await prisma.accountingDecimalConversionEvidence.findUnique({
      where: {
        migrationKey_tableName_recordId_fieldName: {
          migrationKey: "P4.2-2026-11-15-v1",
          tableName: "OperatingExpense",
          recordId: "P42-EXP-PAID-SYNTH",
          fieldName: "amount",
        },
      },
    });
    assert.equal(amountEvidence.convertedValue.toFixed(2), "10.12");
    assert.equal(amountEvidence.drift.toFixed(3), "-0.005");
  } finally {
    await prisma.accountPayable.deleteMany({ where: { id: payableId } });
    await prisma.operatingExpense.deleteMany({ where: { id: { in: [expenseId, rollbackId] } } });
    await prisma.$disconnect();
  }
});
