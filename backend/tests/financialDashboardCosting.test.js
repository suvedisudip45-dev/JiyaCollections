import assert from "node:assert/strict";
import test from "node:test";
import { calculateFinancialDashboardProductCosts } from "../services/financialDashboardCosting.js";

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
