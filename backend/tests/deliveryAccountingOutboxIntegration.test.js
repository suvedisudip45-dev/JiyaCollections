import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import { applyNcmStatus } from "../services/deliveryService.js";

test("NCM delivery commits delivered state and accounting outbox event in one transaction", async () => {
  const originals = [];
  const replace = (target, key, value) => {
    originals.push([target, key, target[key]]);
    target[key] = value;
  };
  const delivery = {
    id: "delivery-ncm-1",
    orderId: "order-ncm-1",
    state: "IN_TRANSIT",
    ncmOrderId: 12345,
    codAmount: 0,
    customerDeliveryCharge: 0,
    ncmDeliveryCharge: 0,
    order: { paymentMethod: "COD", payment: false },
  };
  const order = {
    id: "order-ncm-1",
    amount: 226,
    deliveryFee: 22.6,
    items: [{ productId: "product-1", quantity: 1 }],
    paymentMethod: "COD",
    orderType: "ONLINE_STORE",
    userId: "customer-1",
  };
  let committedDeliveryState = delivery.state;
  let committedAccountingEvent = null;
  let stagedDeliveryState = null;
  let stagedAccountingEvent = null;

  const tx = {
    deliveryEvent: { create: async () => ({ id: "delivery-event-1" }) },
    deliveryOrder: {
      update: async ({ data }) => {
        stagedDeliveryState = data.state;
        return { ...delivery, ...data };
      },
    },
    order: {
      findUnique: async () => order,
      update: async ({ data }) => ({ ...order, ...data }),
    },
    orderAssignment: {
      findUnique: async () => null,
      updateMany: async () => ({ count: 1 }),
    },
    collaborationSale: { updateMany: async () => ({ count: 0 }) },
    manufacturerInventoryCostAllocation: { findMany: async () => [] },
    accountingEvent: {
      upsert: async ({ create }) => {
        stagedAccountingEvent = { id: "accounting-event-1", ...create };
        return stagedAccountingEvent;
      },
    },
  };

  replace(prisma.stockTransferShipment, "findMany", async () => []);
  replace(prisma.deliveryOrder, "findMany", async () => [delivery]);
  replace(prisma.customerReturn, "findFirst", async () => null);
  replace(prisma, "$transaction", async (callback) => {
    const result = await callback(tx);
    committedDeliveryState = stagedDeliveryState;
    committedAccountingEvent = stagedAccountingEvent;
    return result;
  });

  try {
    const result = await applyNcmStatus({
      payload: {
        order_id: "12345",
        status: "Delivered",
        event: "delivery_completed",
        timestamp: "2026-10-16T10:00:00.000Z",
      },
    });

    assert.equal(result[0].deliveryState, "DELIVERED");
    assert.equal(result[0].accountingStatus, "PENDING");
    assert.equal(committedDeliveryState, "DELIVERED");
    assert.equal(committedAccountingEvent.status, "PENDING");
    assert.equal(committedAccountingEvent.idempotencyKey, "DELIVERY_SALE:order-ncm-1");
    assert.equal(committedAccountingEvent.payload.order.deliveryCharge, "22.6");
  } finally {
    for (const [target, key, original] of originals.reverse()) target[key] = original;
  }
});
