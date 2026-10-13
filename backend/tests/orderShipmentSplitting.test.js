import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateMoneyAcrossShipments,
  splitItemsIntoDistributorShipments,
} from "../controllers/orderController.js";

test("split checkout orders contain only the product quantities assigned to each hub", () => {
  const orders = splitItemsIntoDistributorShipments([
    {
      productId: "shirt",
      size: "Medium",
      color: "Navy",
      quantity: 3,
      purchasedUnitPrice: 100,
      lineTotal: 300,
    },
    {
      productId: "belt",
      size: "Standard",
      color: "Brown",
      quantity: 1,
      purchasedUnitPrice: 50,
      lineTotal: 50,
    },
  ], [{
    distributor: { id: "hub-a", name: "Hub A" },
    items: [
      { productId: "shirt", size: "Medium", color: "Navy", qty: 2 },
      { productId: "belt", size: "Standard", color: "Brown", qty: 1 },
    ],
  }, {
    distributor: { id: "hub-b", name: "Hub B" },
    items: [{ productId: "shirt", size: "Medium", color: "Navy", qty: 1 }],
  }]);

  assert.deepEqual(orders.map(({ distributor, items }) => ({
    distributorId: distributor.id,
    productId: items[0].productId,
    quantity: items.reduce((total, item) => total + item.quantity, 0),
    lineTotal: items.reduce((total, item) => total + item.lineTotal, 0),
  })), [
    { distributorId: "hub-a", productId: "shirt", quantity: 2, lineTotal: 200 },
    { distributorId: "hub-b", productId: "shirt", quantity: 1, lineTotal: 100 },
    { distributorId: "hub-a", productId: "belt", quantity: 1, lineTotal: 50 },
  ]);
});

test("split checkout applies aggregate discounts without losing cents", () => {
  const orders = [
    { items: [{ lineTotal: 200 }] },
    { items: [{ lineTotal: 100 }] },
    { items: [{ lineTotal: 50 }] },
  ];

  const shares = allocateMoneyAcrossShipments(10, orders);

  assert.deepEqual(shares, [5.71, 2.86, 1.43]);
  assert.equal(shares.reduce((total, amount) => total + amount, 0), 10);
});

test("split order creation rejects a stale or mismatched stock plan", () => {
  assert.throws(() => splitItemsIntoDistributorShipments([
    { productId: "shirt", size: "Medium", color: "Navy", quantity: 2 },
  ], [{
    distributor: { id: "hub-a", name: "Hub A" },
    items: [{ productId: "shirt", size: "Medium", color: "Navy", qty: 1 }],
  }]), (error) => error.code === "DISTRIBUTOR_STOCK_PLAN_MISMATCH" && error.status === 409);
});
