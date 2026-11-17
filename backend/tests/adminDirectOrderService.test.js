import assert from "node:assert/strict";
import test from "node:test";
import { createAdminDirectOrderWithStock } from "../services/adminDirectOrderService.js";

const clone = (value) => structuredClone(value);

const createHarness = ({ failStockLog = false } = {}) => {
  const state = {
    products: [{
      id: "product-1",
      name: "Test Shirt",
      stockQuantity: 4,
      variants: [],
    }],
    orders: [],
    stockLogs: [],
  };
  let transactionCount = 0;
  const client = {
    $transaction: async (callback, options) => {
      transactionCount += 1;
      assert.equal(options.isolationLevel, "Serializable");
      const transactionState = clone(state);
      const tx = {
        product: {
          findMany: async ({ where }) => transactionState.products.filter(
            (product) => where.id.in.includes(product.id),
          ),
          update: async ({ where, data }) => {
            const product = transactionState.products.find((item) => item.id === where.id);
            Object.assign(product, data);
            return product;
          },
        },
        order: {
          create: async ({ data }) => {
            const order = { id: "order-1", ...data };
            transactionState.orders.push(order);
            return order;
          },
        },
        stockLog: {
          create: async ({ data }) => {
            if (failStockLog) throw new Error("Stock audit write failed.");
            transactionState.stockLogs.push(data);
            return data;
          },
        },
      };
      const result = await callback(tx);
      Object.assign(state, transactionState);
      return result;
    },
  };
  return { client, state, getTransactionCount: () => transactionCount };
};

test("Admin direct order commits order, stock deduction, and stock audit together", async () => {
  const { client, state } = createHarness();

  const order = await createAdminDirectOrderWithStock({
    client,
    orderData: { payment: false },
    items: [{ productId: "product-1", quantity: 2 }],
    source: "Facebook",
  });

  assert.equal(order.id, "order-1");
  assert.equal(state.orders.length, 1);
  assert.equal(state.products[0].stockQuantity, 2);
  assert.equal(state.stockLogs.length, 1);
  assert.equal(state.stockLogs[0].orderId, "order-1");
  assert.equal(state.stockLogs[0].changeQty, -2);
});

test("Admin direct order rolls back order and stock when stock audit creation fails", async () => {
  const { client, state } = createHarness({ failStockLog: true });

  await assert.rejects(
    createAdminDirectOrderWithStock({
      client,
      orderData: { payment: false },
      items: [{ productId: "product-1", quantity: 2 }],
    }),
    /Stock audit write failed/,
  );

  assert.deepEqual(state.orders, []);
  assert.equal(state.products[0].stockQuantity, 4);
  assert.deepEqual(state.stockLogs, []);
});

test("Admin direct order rejects payment declarations before order or stock mutation", async () => {
  const { client, state, getTransactionCount } = createHarness();

  await assert.rejects(
    createAdminDirectOrderWithStock({
      client,
      orderData: { payment: true },
      items: [{ productId: "product-1", quantity: 2 }],
    }),
    (error) => error.code === "DIRECT_ORDER_RECEIPT_REQUIRED",
  );

  assert.deepEqual(state.orders, []);
  assert.equal(state.products[0].stockQuantity, 4);
  assert.deepEqual(state.stockLogs, []);
  assert.equal(getTransactionCount(), 0);
});

test("Admin direct order retries a bounded serializable conflict without duplicate stock effects", async () => {
  const { client, state, getTransactionCount } = createHarness();
  const transaction = client.$transaction;
  let conflictCount = 0;
  client.$transaction = async (callback, options) => {
    if (conflictCount === 0) {
      conflictCount += 1;
      throw Object.assign(new Error("Serializable conflict"), { code: "P2034" });
    }
    return transaction(callback, options);
  };

  await createAdminDirectOrderWithStock({
    client,
    orderData: { payment: false },
    items: [{ productId: "product-1", quantity: 2 }],
  });

  assert.equal(conflictCount, 1);
  assert.equal(getTransactionCount(), 1);
  assert.equal(state.orders.length, 1);
  assert.equal(state.products[0].stockQuantity, 2);
  assert.equal(state.stockLogs.length, 1);
});

test("Admin direct-order stock deductions keep variant totals synchronized", async () => {
  const { client, state } = createHarness();
  state.products[0].variants = [
    { size: "M", color: "Black", quantity: 1 },
    { size: "L", color: "Blue", quantity: 3 },
  ];
  state.products[0].stockQuantity = 4;

  await createAdminDirectOrderWithStock({
    client,
    orderData: { payment: false },
    items: [{ productId: "product-1", size: "M", quantity: 1 }],
  });

  assert.deepEqual(state.products[0].variants, [
    { size: "M", color: "Black", quantity: 0 },
    { size: "L", color: "Blue", quantity: 3 },
  ]);
  assert.equal(state.products[0].stockQuantity, 3);
});
