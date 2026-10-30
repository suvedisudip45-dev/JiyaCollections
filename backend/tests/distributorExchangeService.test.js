import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import { processDistributorExchange } from "../services/distributorExchangeService.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

test("distributor cannot process an exchange owned by another hub", async (t) => {
  stubMethod(t, prisma, "$transaction", (callback) => callback({
    orderExchangeRequest: { findFirst: async () => null },
  }));

  await assert.rejects(
    processDistributorExchange({
      requestId: "exchange-1",
      distributorId: "dist-2",
      actorId: "account-1",
      action: "DISPATCH",
    }),
    (error) => error.code === "EXCHANGE_NOT_FOUND" && error.status === 404,
  );
});

test("replacement cannot be dispatched before the distributor receives and inspects the return", async (t) => {
  stubMethod(t, prisma, "$transaction", (callback) => callback({
    orderExchangeRequest: {
      findFirst: async () => ({
        id: "exchange-1",
        distributorId: "dist-1",
        deliveryRoute: "DISTRIBUTOR",
        status: "APPROVED_FOR_DISTRIBUTOR",
        inspectedAt: null,
        replacementStatus: null,
        replacementStockConsumedAt: null,
      }),
    },
  }));

  await assert.rejects(
    processDistributorExchange({
      requestId: "exchange-1",
      distributorId: "dist-1",
      actorId: "account-1",
      action: "DISPATCH",
    }),
    (error) => error.code === "EXCHANGE_RETURN_NOT_INSPECTED" && error.status === 409,
  );
});

test("distributor receives and records a good exchange return before replacement dispatch", async (t) => {
  const now = new Date();
  let updatedRequest;
  const tx = {
    orderExchangeRequest: {
      findFirst: async () => ({
        id: "exchange-1",
        distributorId: "dist-1",
        deliveryRoute: "DISTRIBUTOR",
        status: "APPROVED_FOR_DISTRIBUTOR",
        items: [{ productId: "product-1", size: "S", color: "Red", quantity: 1 }],
        inspectedAt: null,
      }),
      update: async ({ data }) => {
        updatedRequest = data;
        return { id: "exchange-1", ...data };
      },
    },
    inventoryLocation: {
      findUnique: async () => null,
      findMany: async () => [{ id: "location-1" }],
      create: async ({ data }) => ({ id: "location-1", ...data }),
    },
    inventoryLedgerEntry: {
      findUnique: async () => null,
      create: async ({ data }) => data,
    },
    inventorySku: {
      findUnique: async () => ({ id: "sku-1", productId: "product-1", isActive: true }),
    },
    inventoryBalance: {
      upsert: async () => ({}),
      findUnique: async () => ({ quantityOnHand: 2, reservedQuantity: 0 }),
      updateMany: async () => ({ count: 1 }),
      findMany: async () => [],
    },
    inventoryDiscrepancy: { create: async () => ({}) },
    product: {
      findUnique: async () => ({ id: "product-1", stockQuantity: 2, variants: [] }),
      update: async ({ data }) => data,
    },
    orderExchangeEvent: { create: async () => ({}) },
  };
  stubMethod(t, prisma, "$transaction", (callback) => callback(tx));

  const result = await processDistributorExchange({
    requestId: "exchange-1",
    distributorId: "dist-1",
    actorId: "account-1",
    action: "RECEIVE_AND_INSPECT",
    inspectedItems: [{ productId: "product-1", size: "S", color: "Red", quantity: 1, condition: "GOOD" }],
  });

  assert.equal(result.status, "IN_PROGRESS");
  assert.equal(updatedRequest.returnPickupStatus, "PICKUP_COMPLETE");
  assert.ok(updatedRequest.inspectedAt instanceof Date);
  assert.equal(updatedRequest.inspectionResult, "RESTOCKABLE");
});

test("dispatch consumes the approved distributor stock reservation", async (t) => {
  const ledgerEntries = [];
  let updatedRequest;
  const tx = {
    orderExchangeRequest: {
      findFirst: async () => ({
        id: "exchange-1",
        distributorId: "dist-1",
        deliveryRoute: "DISTRIBUTOR",
        status: "IN_PROGRESS",
        inspectedAt: new Date(),
        replacementItems: [{ productId: "product-1", size: "M", color: "Black", quantity: 1 }],
        items: [{ productId: "product-1", size: "S", color: "Red", quantity: 1 }],
        replacementStockReservedAt: new Date(),
        replacementStockConsumedAt: null,
        replacementStatus: "READY_FOR_DISPATCH",
      }),
      update: async ({ data }) => {
        updatedRequest = data;
        return { id: "exchange-1", ...data };
      },
    },
    orderExchangeEvent: {
      findFirst: async () => ({
        metadata: {
          replacementReservations: [{ inventorySkuId: "sku-1", locationId: "location-1", quantity: 1 }],
        },
      }),
      create: async () => ({}),
    },
    inventorySku: {
      findUnique: async () => ({
        id: "sku-1",
        productId: "product-1",
        sizeKey: "m",
        colorKey: "black",
        isActive: true,
      }),
    },
    inventoryBalance: {
      findUnique: async () => ({ id: "balance-1", quantityOnHand: 2, reservedQuantity: 1 }),
      updateMany: async () => ({ count: 1 }),
      findMany: async () => [],
    },
    inventoryLedgerEntry: {
      create: async ({ data }) => {
        ledgerEntries.push(data);
        return data;
      },
    },
    product: {
      findUnique: async () => ({ id: "product-1", stockQuantity: 2, variants: [] }),
      update: async ({ data }) => data,
    },
  };
  stubMethod(t, prisma, "$transaction", (callback) => callback(tx));

  const result = await processDistributorExchange({
    requestId: "exchange-1",
    distributorId: "dist-1",
    actorId: "account-1",
    action: "DISPATCH",
  });

  assert.equal(result.replacementStatus, "DISPATCHED");
  assert.ok(updatedRequest.replacementStockConsumedAt instanceof Date);
  assert.equal(ledgerEntries.length, 1);
  assert.equal(ledgerEntries[0].movementType, "FULFILLMENT");
  assert.equal(ledgerEntries[0].referenceType, "EXCHANGE");
});

test("completed distributor exchange accrues its configured settlement into distributor earnings", async (t) => {
  const exchange = {
    id: "exchange-1",
    orderId: "order-1",
    distributorId: "dist-1",
    deliveryRoute: "DISTRIBUTOR",
    logisticsSettlementAmount: 50,
    status: "IN_PROGRESS",
    replacementStatus: "DISPATCHED",
    replacementStockConsumedAt: new Date(),
  };
  const serviceCharges = [];
  const tx = {
    orderExchangeRequest: {
      findFirst: async () => exchange,
      update: async ({ data }) => ({ ...exchange, ...data }),
    },
    orderAssignment: {
      findFirst: async () => ({ id: "assignment-1" }),
    },
    distributor: {
      findUnique: async () => ({ id: "dist-1", name: "Distributor One" }),
    },
    orderExchangeEvent: { create: async () => ({}) },
  };
  stubMethod(t, prisma, "$transaction", (callback) => callback(tx));

  const result = await processDistributorExchange({
    requestId: "exchange-1",
    distributorId: "dist-1",
    actorId: "account-1",
    action: "DELIVER",
    postExchangeAccounting: async () => ({ id: "exchange-journal-1" }),
    accrueServiceCharge: async (charge) => serviceCharges.push(charge),
  });

  assert.equal(result.status, "COMPLETED");
  assert.equal(serviceCharges.length, 1);
  assert.equal(serviceCharges[0].serviceType, "EXCHANGE");
  assert.equal(serviceCharges[0].chargeAmount, 50);
  assert.equal(serviceCharges[0].sourceId, "exchange-1");
  assert.equal(serviceCharges[0].assignmentId, "assignment-1");
});
