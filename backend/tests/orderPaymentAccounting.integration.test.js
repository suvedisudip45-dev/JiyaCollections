import "../utils/requireIntegrationDatabaseSafety.js";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../config/db.js";
import { recordDeliveredOrderCashReceipt } from "../services/orderPaymentAccountingService.js";

const isAuthorizedLocalSandbox = () => {
  if (process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1") return false;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must identify the authorized local accounting sandbox.");

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid MySQL URL for the authorized local accounting sandbox.");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || databaseName !== "clothing") {
    throw new Error("Refusing order-payment integration test outside the authorized local clothing sandbox.");
  }
  return true;
};

const skip = !isAuthorizedLocalSandbox();

test("delivered order cash receipt and customer-payment journal commit or roll back together", { skip }, async () => {
  const orderId = randomUUID();
  const orderReference = `P${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const rollbackSignal = new Error("Rollback customer-payment integration fixture.");

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.order.create({
        data: {
          id: orderId,
          orderReference,
          userId: `integration-customer-${orderId}`,
          items: [],
          amount: 125.75,
          deliveryFee: 0,
          address: {},
          status: "Delivered",
          paymentMethod: "CASH",
          payment: false,
          date: BigInt(Date.now()),
        },
      });

      const updatedOrder = await recordDeliveredOrderCashReceipt(orderId, { client: tx });
      assert.equal(updatedOrder.payment, true);
      await recordDeliveredOrderCashReceipt(orderId, { client: tx });

      const journal = await tx.journalEntry.findUnique({
        where: { idempotencyKey: `CUSTOMER_PAYMENT:ORDER:${orderId}` },
        include: { lines: { include: { account: true } } },
      });
      assert.ok(journal);
      assert.equal(journal.sourceType, "CUSTOMER_PAYMENT");
      assert.equal(journal.sourceId, orderId);
      assert.equal(journal.status, "POSTED");
      assert.equal(journal.totalDebit.toFixed(2), "125.75");
      assert.equal(journal.totalCredit.toFixed(2), "125.75");
      assert.deepEqual(
        journal.lines.map(({ account, debit, credit }) => ({
          accountCode: account.accountCode,
          debit: debit.toFixed(2),
          credit: credit.toFixed(2),
        })).sort((left, right) => left.accountCode.localeCompare(right.accountCode)),
        [
          { accountCode: "1120", debit: "125.75", credit: "0.00" },
          { accountCode: "1130", debit: "0.00", credit: "125.75" },
        ],
      );

      throw rollbackSignal;
    }),
    (error) => error === rollbackSignal,
  );

  assert.equal(await prisma.order.count({ where: { id: orderId } }), 0);
  assert.equal(await prisma.journalEntry.count({
    where: { idempotencyKey: `CUSTOMER_PAYMENT:ORDER:${orderId}` },
  }), 0);
});

test("failed customer-payment posting leaves no paid order or accounting event in the sandbox", { skip }, async () => {
  const orderId = randomUUID();
  const orderReference = `P${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const eventKey = `TEST-CUSTOMER-PAYMENT-FAILURE:${orderId}`;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.order.create({
        data: {
          id: orderId,
          orderReference,
          userId: `integration-customer-${orderId}`,
          items: [],
          amount: 125.75,
          deliveryFee: 0,
          address: {},
          status: "Delivered",
          paymentMethod: "CASH",
          payment: false,
          date: BigInt(Date.now()),
        },
      });

      await recordDeliveredOrderCashReceipt(orderId, {
        client: tx,
        postAccounting: async ({ client }) => {
          await client.accountingEvent.create({
            data: {
              idempotencyKey: eventKey,
              sourceType: "TEST_CUSTOMER_PAYMENT",
              sourceId: orderId,
              sourceVersion: 1,
              eventType: "TEST_CUSTOMER_PAYMENT",
              effectiveAt: new Date(),
              status: "PROCESSING",
              payload: { test: true },
              payloadHash: "0".repeat(64),
            },
          });
          throw new Error("Injected customer-payment posting failure.");
        },
      });
    }),
    /Injected customer-payment posting failure/,
  );

  assert.equal(await prisma.order.count({ where: { id: orderId } }), 0);
  assert.equal(await prisma.accountingEvent.count({ where: { idempotencyKey: eventKey } }), 0);
  assert.equal(await prisma.journalEntry.count({
    where: { idempotencyKey: `CUSTOMER_PAYMENT:ORDER:${orderId}` },
  }), 0);
});
