import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAllocatedProductionOverhead,
  calculateFinancialDashboardProductCosts,
  calculateInventoryValuationAtCost,
  calculateManufacturerLogisticsExpenseDetails,
  calculateProductFixedOverheadPerSoldUnit,
  countPurchaseTransactions,
} from "../services/financialDashboardCosting.js";

test("product-cost calculation captures accepted unit COGS and per-unit other charges", () => {
  const result = calculateFinancialDashboardProductCosts({
    orders: [{
      id: "order-1",
      date: 1781571600000n,
      items: [{
        productId: "product-1",
        name: "T-shirt",
        quantity: 3,
        productionCostAllocations: [{
          costLayerId: "layer-1",
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

  assert.equal(result.directCOGS, 350);
  assert.equal(result.deliveryAndOtherOverheads, 35);
  assert.equal(result.unitsSold, 3);
  assert.deepEqual(result.details.deliveryAndOtherOverheads.map((entry) => ({
    orderId: entry.orderId,
    date: entry.date,
    productName: entry.productName,
    quantity: entry.quantity,
    unitAmount: entry.unitAmount,
    totalAmount: entry.totalAmount,
    source: entry.source,
    referenceId: entry.referenceId,
  })), [
    {
      orderId: "order-1",
      date: 1781571600000,
      productName: "T-shirt",
      quantity: 2,
      unitAmount: 12.5,
      totalAmount: 25,
      source: "Accepted production cost allocation",
      referenceId: "layer-1",
    },
    {
      orderId: "order-1",
      date: 1781571600000,
      productName: "T-shirt",
      quantity: 1,
      unitAmount: 10,
      totalAmount: 10,
      source: "Accepted legacy delivery/other cost snapshot",
      referenceId: null,
    },
  ]);
  assert.equal(
    result.details.deliveryAndOtherOverheads.reduce((sum, entry) => sum + entry.totalAmount, 0),
    result.deliveryAndOtherOverheads,
  );
});

test("product-cost calculation uses weighted accepted production costs for distributor inventory", () => {
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

  assert.equal(result.directCOGS, 550);
  assert.equal(result.deliveryAndOtherOverheads, 70);
  assert.equal(result.unitsSold, 4);
  assert.equal(
    result.details.deliveryAndOtherOverheads.reduce((sum, entry) => sum + entry.totalAmount, 0),
    result.deliveryAndOtherOverheads,
  );
  assert.ok(result.details.deliveryAndOtherOverheads.every((entry) =>
    entry.source === "Weighted production cost-layer rate (legacy fallback)"
  ));
});

test("batch production cost metadata resolves per-unit rates for product-cost fallback", () => {
  const batch = {
    approvedUnitCogs: "500",
    approvedDeliveryCost: "1200",
  };
  const layers = [
    {
      id: "layer-small",
      productionRequestId: "batch-1",
      productId: "product-1",
      producedQuantity: 4,
      unitCogs: "620",
      unitDeliveryCost: "0",
      productionRequest: batch,
    },
    {
      id: "layer-large",
      productionRequestId: "batch-1",
      productId: "product-1",
      producedQuantity: 6,
      unitCogs: "620",
      unitDeliveryCost: "0",
      productionRequest: batch,
    },
  ];
  const orders = [
    {
      id: "order-1",
      items: [{
        productId: "product-1",
        name: "T-shirt",
        quantity: 1,
        productionCostAllocations: [{
          costLayerId: "layer-small",
          quantity: 1,
          unitCogs: "620",
          unitDeliveryCost: "0",
        }],
      }],
    },
    {
      id: "order-2",
      items: [{
        productId: "product-1",
        name: "T-shirt",
        quantity: 1,
        productionCostAllocations: [{
          costLayerId: "layer-large",
          quantity: 1,
          unitCogs: "620",
          unitDeliveryCost: "0",
        }],
      }],
    },
  ];

  const result = calculateFinancialDashboardProductCosts({ orders, costLayers: layers });
  assert.equal(result.directCOGS, 1000);
  assert.equal(result.deliveryAndOtherOverheads, 240);
  assert.equal(
    result.details.deliveryAndOtherOverheads.reduce((sum, entry) => sum + entry.totalAmount, 0),
    result.deliveryAndOtherOverheads,
  );
  assert.deepEqual(result.details.deliveryAndOtherOverheads.map(({ unitAmount, totalAmount, source }) => ({
    unitAmount,
    totalAmount,
    source,
  })), [
    {
      unitAmount: 120,
      totalAmount: 120,
      source: "Batch transportation/other cost ÷ 10 good units",
    },
    {
      unitAmount: 120,
      totalAmount: 120,
      source: "Batch transportation/other cost ÷ 10 good units",
    },
  ]);

  const overheadPerProduct = calculateProductFixedOverheadPerSoldUnit({ orders, costLayers: layers });
  assert.equal(overheadPerProduct.get("product-1").totalOverhead, 240);
  assert.equal(calculateAllocatedProductionOverhead({ orders, overheadPerProduct }), 240);
});

test("local manufacturer-to-distributor freight is counted once per dispatched shipment", () => {
  const result = calculateManufacturerLogisticsExpenseDetails({
    shipments: [
      {
        id: "shipment-1",
        bookingMode: "MANUAL",
        dispatchedAt: new Date("2025-10-15T10:00:00Z"),
        freightCharge: "1200.00",
        deliveryPartner: "Local Logistics Co.",
        trackingNumber: "TRACK-1",
        stockTransferId: "transfer-1",
        stockTransfer: {
          id: "transfer-1",
          manufacturer: { name: "Manufacturer One" },
          distributor: { name: "Distributor One" },
        },
      },
      {
        id: "shipment-1",
        bookingMode: "MANUAL",
        dispatchedAt: new Date("2025-10-15T10:00:00Z"),
        freightCharge: "1200.00",
        deliveryPartner: "Local Logistics Co.",
        stockTransferId: "transfer-1",
      },
      {
        id: "ncm-shipment",
        bookingMode: "NCM",
        dispatchedAt: new Date("2025-10-15T10:00:00Z"),
        freightCharge: "500.00",
      },
      {
        id: "not-dispatched",
        bookingMode: "MANUAL",
        freightCharge: "800.00",
        deliveryPartner: "Local Logistics Co.",
      },
    ],
  });

  assert.equal(result.total, 1200);
  assert.deepEqual(result.details, [{
    id: "shipment-1",
    date: new Date("2025-10-15T10:00:00Z"),
    transferId: "transfer-1",
    title: "Transportation and logistics - manufacturer to distributor",
    category: "LOCAL_MANUFACTURER_TO_DISTRIBUTOR",
    amount: 1200,
    vendorName: "Local Logistics Co.",
    trackingNumber: "TRACK-1",
    manufacturerName: "Manufacturer One",
    distributorName: "Distributor One",
    paymentStatus: null,
    source: "Dispatched local stock-transfer shipment",
  }]);
});

test("inventory valuation uses on-hand platform balances and layer COGS without double counting transfers", () => {
  const result = calculateInventoryValuationAtCost({
    balances: [
      {
        locationId: "factory",
        inventorySkuId: "sku-costed",
        quantityOnHand: 2,
        inventorySku: { productId: "product-costed", product: { id: "product-costed", costPrice: 999 } },
      },
      {
        locationId: "distributor",
        inventorySkuId: "sku-costed",
        quantityOnHand: 2,
        inventorySku: { productId: "product-costed", product: { id: "product-costed", costPrice: 999 } },
      },
      {
        locationId: "factory",
        inventorySkuId: "sku-uncosted",
        quantityOnHand: 3,
        inventorySku: { productId: "product-uncosted", product: { id: "product-uncosted", costPrice: 50 } },
      },
    ],
    ledgerEntries: [
      {
        inventorySkuId: "sku-costed",
        destinationLocationId: "factory",
        quantity: 4,
        productionCostLayerId: "layer-1",
        productionCostLayer: { unitCogs: "100" },
      },
      {
        inventorySkuId: "sku-costed",
        sourceLocationId: "factory",
        destinationLocationId: "distributor",
        quantity: 2,
        productionCostLayerId: "layer-1",
        productionCostLayer: { unitCogs: "100" },
      },
    ],
    products: [
      { id: "product-costed", stockQuantity: 4, costPrice: 999 },
      { id: "product-uncosted", stockQuantity: 3, costPrice: 50 },
      { id: "legacy-product", stockQuantity: 4, costPrice: 20 },
    ],
  });

  assert.equal(result, 630);
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

  assert.equal(result.directCOGS, 190);
  assert.equal(result.deliveryAndOtherOverheads, 0);
  assert.equal(result.unitsSold, 3);
  assert.deepEqual(result.details.deliveryAndOtherOverheads, []);
  assert.equal(result.details.productCOGS.length, 2);
  assert.deepEqual(result.details.productCOGS.map(({ totalAmount }) => totalAmount), [160, 30]);
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
