import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAllocatedProductionOverhead,
  calculateFinancialDashboardProductCosts,
  calculateProductFixedOverheadPerSoldUnit,
  countPurchaseTransactions,
} from "../services/financialDashboardCosting.js";

test("dashboard counts accepted batch production cost as COGS and per-unit other charges as overhead", () => {
  const result = calculateFinancialDashboardProductCosts({
    orders: [{
      items: [{
        productId: "product-1",
        quantity: 3,
        productionCostAllocations: [{
          quantity: 2,
          unitCogs: "125.00",
          unitDeliveryCost: "12.50",
        }],
        legacyCostQuantity: 1,
        legacyUnitCogsVatInclusiveAtAcceptance: "100.00",
        unitDeliveryCost: "10.00",
      }],
    }],
  });

  assert.deepEqual(result, {
    directCOGS: 350,
    deliveryAndOtherOverheads: 35,
    unitsSold: 3,
  });
});

test("dashboard uses weighted accepted production costs for distributor-fulfilled orders", () => {
  const result = calculateFinancialDashboardProductCosts({
    orders: [{
      items: [{ productId: "product-1", quantity: 4, costPrice: 5 }],
    }],
    costLayers: [
      { productId: "product-1", producedQuantity: 2, unitCogs: "100", unitDeliveryCost: "10" },
      { productId: "product-1", producedQuantity: 6, unitCogs: "150", unitDeliveryCost: "20" },
    ],
    manufacturerInventories: [
      { productId: "product-1", quantity: 10, agreedCostPrice: 50, priceStatus: "APPROVED" },
    ],
    products: [{ id: "product-1", costPrice: 5 }],
  });

  assert.deepEqual(result, {
    directCOGS: 550,
    deliveryAndOtherOverheads: 70,
    unitsSold: 4,
  });
});

test("dashboard prefers accepted per-order COGS snapshots and retains legacy product-cost fallback", () => {
  const result = calculateFinancialDashboardProductCosts({
    orders: [{
      items: [
        { productId: "product-1", quantity: 2, agreedUnitCogsVatInclusiveAtAcceptance: "80" },
        { productId: "product-2", quantity: 1 },
      ],
    }],
    products: [
      { id: "product-1", costPrice: 20 },
      { id: "product-2", costPrice: 30 },
    ],
  });

  assert.deepEqual(result, {
    directCOGS: 190,
    deliveryAndOtherOverheads: 0,
    unitsSold: 3,
  });
});

test("sales analytics allocates sold-item overhead over each product's all-time sold units", () => {
  const orders = [
    {
      items: [
        {
          productId: "product-1",
          quantity: 2,
          productionCostAllocations: [{ quantity: 2, unitDeliveryCost: "10" }],
        },
        { productId: "product-2", quantity: 1, unitDeliveryCost: "20" },
      ],
    },
    { items: [{ productId: "product-1", quantity: 4, unitDeliveryCost: "10" }] },
  ];
  const overheadPerProduct = calculateProductFixedOverheadPerSoldUnit({
    orders,
    costLayers: [
      { productId: "product-1", producedQuantity: 1000, unitDeliveryCost: "999" },
      { productId: "product-2", producedQuantity: 500, unitDeliveryCost: "777" },
    ],
  });

  assert.deepEqual(overheadPerProduct.get("product-1"), {
    totalOverhead: 60,
    soldQuantity: 6,
    unitOverhead: 10,
  });
  assert.deepEqual(overheadPerProduct.get("product-2"), {
    totalOverhead: 20,
    soldQuantity: 1,
    unitOverhead: 20,
  });
  assert.equal(calculateAllocatedProductionOverhead({
    orders: [orders[0]],
    overheadPerProduct,
  }), 40);
  assert.equal(calculateAllocatedProductionOverhead({
    orders: [orders[1]],
    overheadPerProduct,
  }), 40);
  assert.equal(calculateAllocatedProductionOverhead({ orders, overheadPerProduct }), 80);
});

test("sales analytics counts split shipment rows as one purchase transaction", () => {
  assert.equal(countPurchaseTransactions([
    { id: "shipment-order-1", checkoutGroupId: "checkout-1" },
    { id: "shipment-order-2", checkoutGroupId: "checkout-1" },
    { id: "single-order-1", checkoutGroupId: null },
  ]), 2);
});
