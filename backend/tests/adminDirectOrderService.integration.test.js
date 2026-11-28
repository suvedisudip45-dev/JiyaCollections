import "../utils/requireIntegrationDatabaseSafety.js";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../config/db.js";
import { createAdminDirectOrderWithStock } from "../services/adminDirectOrderService.js";

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
    throw new Error("Refusing Admin direct-order integration test outside the authorized local clothing sandbox.");
  }
  return true;
};

const skip = !isAuthorizedLocalSandbox();

const createProductFixture = (id, stockQuantity) => ({
  id,
  name: `Admin order integration ${id.slice(0, 8)}`,
  description: "Rollback-only Admin direct-order integration fixture.",
  price: 100,
  image: [],
  category: "Integration",
  subCategory: "Integration",
  sizes: [],
  variants: [],
  stockQuantity,
  date: BigInt(Date.now()),
});

const createOrderFixture = (id, productId) => ({
  id,
  orderReference: `I${id.replace(/-/g, "").slice(0, 14)}`,
  userId: `integration-admin-order-${id}`,
  items: [{ productId, quantity: 1 }],
  amount: 100,
  deliveryFee: 0,
  address: {},
  status: "Order Placed",
  paymentMethod: "COD",
  payment: false,
  date: BigInt(Date.now()),
  orderType: "ADMIN_DIRECT",
});

test("Admin direct-order stock and order changes roll back when stock audit persistence fails", { skip }, async () => {
  const productId = randomUUID();
  const orderId = randomUUID();
  const orderData = createOrderFixture(orderId, productId);
  const rollbackSignal = new Error("Rollback Admin direct-order audit fixture.");
  let injectedFailure = false;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.product.create({ data: createProductFixture(productId, 3) });
      const createStockLog = tx.stockLog.create.bind(tx.stockLog);
      tx.stockLog.create = async (args) => {
        await createStockLog(args);
        injectedFailure = true;
        throw new Error("Injected StockLog persistence failure.");
      };

      await createAdminDirectOrderWithStock({
        client: tx,
        orderData,
        items: orderData.items,
      });
      throw rollbackSignal;
    }),
    /Injected StockLog persistence failure/,
  );

  assert.equal(injectedFailure, true);
  assert.equal(await prisma.order.count({ where: { id: orderId } }), 0);
  assert.equal(await prisma.product.count({ where: { id: productId } }), 0);
  assert.equal(await prisma.stockLog.count({ where: { productId } }), 0);
});

test("Admin paid direct order, journal, stock deduction, and stock audit share one transaction", { skip }, async () => {
  const productId = randomUUID();
  const orderId = randomUUID();
  const orderData = {
    ...createOrderFixture(orderId, productId),
    payment: true,
  };
  const journalKey = `CUSTOMER_PAYMENT:ORDER:${orderId}`;
  const rollbackSignal = new Error("Rollback Admin direct-order success fixture.");

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.product.create({ data: createProductFixture(productId, 3) });
      const order = await createAdminDirectOrderWithStock({
        client: tx,
        orderData,
        items: orderData.items,
      });
      assert.equal(order.payment, true);

      const product = await tx.product.findUnique({ where: { id: productId } });
      assert.equal(product.stockQuantity, 2);
      const stockLog = await tx.stockLog.findFirst({ where: { productId, orderId } });
      assert.ok(stockLog);
      assert.equal(stockLog.changeQty, -1);

      const journal = await tx.journalEntry.findUnique({
        where: { idempotencyKey: journalKey },
        include: { lines: true },
      });
      assert.ok(journal);
      assert.equal(journal.status, "POSTED");
      assert.equal(journal.totalDebit.toFixed(2), "100.00");
      assert.equal(journal.totalCredit.toFixed(2), "100.00");

      throw rollbackSignal;
    }),
    (error) => error === rollbackSignal,
  );

  assert.equal(await prisma.order.count({ where: { id: orderId } }), 0);
  assert.equal(await prisma.product.count({ where: { id: productId } }), 0);
  assert.equal(await prisma.stockLog.count({ where: { productId, orderId } }), 0);
  assert.equal(await prisma.journalEntry.count({ where: { idempotencyKey: journalKey } }), 0);
});

test("concurrent Admin direct orders cannot oversell the last legacy product unit", { skip }, async () => {
  const productId = randomUUID();
  const orderIds = [randomUUID(), randomUUID()];
  await prisma.product.create({ data: createProductFixture(productId, 1) });

  try {
    const results = await Promise.allSettled(orderIds.map((orderId) => {
      const orderData = createOrderFixture(orderId, productId);
      return createAdminDirectOrderWithStock({
        orderData,
        items: orderData.items,
      });
    }));

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.code, "ORDER_STOCK_INVALID");

    const product = await prisma.product.findUnique({ where: { id: productId } });
    assert.equal(product.stockQuantity, 0);
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true },
    });
    assert.equal(orders.length, 1);
    const stockLogs = await prisma.stockLog.findMany({
      where: { productId },
      select: { orderId: true, changeQty: true },
    });
    assert.equal(stockLogs.length, 1);
    assert.equal(stockLogs[0].orderId, orders[0].id);
    assert.equal(stockLogs[0].changeQty, -1);
  } finally {
    await prisma.stockLog.deleteMany({ where: { productId } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
  }
});
