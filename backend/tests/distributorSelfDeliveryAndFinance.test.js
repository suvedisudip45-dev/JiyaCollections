import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import {
  validateSelfDeliveryTransition,
  listAssignedDistributorOrders,
  markDistributorSelfDeliveryReady,
  dispatchDistributorSelfDeliveryOrders,
  updateSelfDeliveryStatus,
  processSelfDeliveryReturn,
} from "../services/distributorSelfDeliveryService.js";
import {
  recordDistributorRateCard,
  getDistributorRateCards,
  resolveActiveRateCard,
} from "../services/distributorRateCardService.js";
import {
  getDistributorFinancialStatement,
  submitDistributorSettlementRequest,
  executeAdminDistributorSettlement,
  resolveDistributorSettlementReconciliation,
} from "../services/distributorFinanceService.js";
import { getDistributorCashPositions } from "../services/distributorCashSettlementService.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

test("Admin service-settlement cash warnings aggregate distributor COD and pending remittances", async () => {
  const positions = await getDistributorCashPositions({
    distributorIds: ["dist-1", "dist-2"],
    client: {
      accountingParty: {
        findMany: async () => [
          { id: "party-1", sourceEntityId: "dist-1" },
          { id: "party-2", sourceEntityId: "dist-2" },
        ],
      },
      accountingDocument: {
        groupBy: async () => [
          {
            partyId: "party-1",
            side: "RECEIVABLE",
            sourceType: "DISTRIBUTOR_COD_SALE",
            _sum: { remainingAmount: new Prisma.Decimal("100") },
          },
          {
            partyId: "party-1",
            side: "PAYABLE",
            sourceType: "DISTRIBUTOR_CUSTOMER_REFUND",
            _sum: { remainingAmount: new Prisma.Decimal("15") },
          },
        ],
      },
      distributorRemittanceBatch: {
        groupBy: async () => [{
          distributorId: "dist-1",
          _sum: { amount: new Prisma.Decimal("20") },
        }],
      },
    },
  });

  assert.deepEqual(positions.get("dist-1"), {
    outstandingReceivable: "100.00",
    pendingRemittance: "20.00",
    refundPayable: "15.00",
    availableToRemit: "80.00",
    availableToOffset: "15.00",
  });
  assert.equal(positions.get("dist-2").outstandingReceivable, "0.00");
});

test("Admin distributor payout requires a valid external transfer reference", async () => {
  await assert.rejects(
    executeAdminDistributorSettlement({
      settlementId: "settlement-1",
      amount: 10,
      financialAccountId: "treasury-1",
    }),
    { code: "EXTERNAL_PAYMENT_REFERENCE_REQUIRED" },
  );
  await assert.rejects(
    executeAdminDistributorSettlement({
      settlementId: "settlement-1",
      amount: 10,
      financialAccountId: "treasury-1",
      externalPaymentReference: " ".repeat(2),
    }),
    { code: "INVALID_EXTERNAL_PAYMENT_REFERENCE" },
  );
});

test("1. Self-Delivery State Machine enforces sequential status progression", () => {
  // From assigned -> Dispatched
  const r1 = validateSelfDeliveryTransition("assigned", "Dispatched");
  assert.equal(r1.valid, true);
  assert.equal(r1.canonicalStatus, "Dispatched");
  assert.equal(r1.internalStatus, "dispatched");

  // From Dispatched -> On the Way
  const r2 = validateSelfDeliveryTransition("dispatched", "On the Way");
  assert.equal(r2.valid, true);
  assert.equal(r2.canonicalStatus, "On the Way");
  assert.equal(r2.internalStatus, "on_the_way");

  // From On the Way -> Delivered
  const r3 = validateSelfDeliveryTransition("on_the_way", "Delivered");
  assert.equal(r3.valid, true);
  assert.equal(r3.canonicalStatus, "Delivered");
  assert.equal(r3.internalStatus, "delivered");

  // Invalid jump: Assigned directly to Delivered
  const rInvalid = validateSelfDeliveryTransition("assigned", "Delivered");
  assert.equal(rInvalid.valid, false);
  assert.match(rInvalid.message, /Cannot mark order 'Delivered'/);

  // Invalid jump: Assigned directly to On the Way
  const rInvalid2 = validateSelfDeliveryTransition("assigned", "On the Way");
  assert.equal(rInvalid2.valid, false);
  assert.match(rInvalid2.message, /Cannot move order to 'On the Way'/);
});

test("2. listAssignedDistributorOrders fetches orders for the distributor hub", async (t) => {
  const mockAssignment = {
    id: "assign-1",
    orderId: "order-1",
    distributorId: "dist-1",
    deliveryType: "SELF_DELIVERY",
    status: "ready_for_pickup",
    assignedAt: new Date(),
    distributor: { id: "dist-1", name: "Kathmandu Hub", city: "Kathmandu", phone: "9846000000" },
  };
  const mockOrder = {
    id: "order-1",
    userId: "user-1",
    amount: 1500,
    deliveryFee: 100,
    loyaltyDiscount: 75,
    rewardApplied: { giftDescription: "Complimentary scarf" },
    status: "Order Placed",
    fulfillmentStatus: "assigned",
    paymentMethod: "COD",
    payment: false,
    address: JSON.stringify({ province: "Bagmati", district: "Kathmandu", city: "Kathmandu" }),
    items: JSON.stringify([{ productId: "prod-1", name: "T-Shirt", size: "M", color: "Black", quantity: 1, price: 1500 }]),
    assignedGift: null,
  };

  stubMethod(t, prisma.orderAssignment, "findMany", async () => [mockAssignment]);
  stubMethod(t, prisma.deliveryOrder, "findMany", async () => []);
  stubMethod(t, prisma.order, "findMany", async () => [mockOrder]);
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "findFirst", async () => ({
    deliveryCharge: 175,
    returnCharge: 50,
    commissionRate: 0,
    bonusRate: 0,
    incentiveRate: 0,
    vatRate: 13,
    vatInclusive: false,
  }));

  const result = await listAssignedDistributorOrders({
    distributorId: "dist-1",
    status: "all",
  });

  assert.equal(result.success, true);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].orderId, "order-1");
  assert.equal(result.orders[0].order.amount, 1500);
  assert.equal(result.orders[0].order.loyaltyDiscount, 75);
  assert.deepEqual(result.orders[0].order.rewardApplied, { giftDescription: "Complimentary scarf" });
  assert.equal(result.orders[0].expectedDeliveryCharge, 175);
});

test("self-delivery listing excludes NCM assignments and legacy NCM bookings", async (t) => {
  const assignments = [
    { id: "self-1", orderId: "order-self", deliveryType: "SELF_DELIVERY", status: "delivered" },
    { id: "ncm-type", orderId: "order-ncm-type", deliveryType: "NCM", status: "delivered" },
    { id: "ncm-legacy", orderId: "order-ncm-legacy", deliveryType: "SELF_DELIVERY", status: "dispatched" },
  ];
  let loadedOrderIds = [];

  stubMethod(t, prisma.orderAssignment, "findMany", async () => assignments);
  stubMethod(t, prisma.deliveryOrder, "findMany", async () => [{ orderId: "order-ncm-legacy" }]);
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "findFirst", async () => null);
  stubMethod(t, prisma.order, "findMany", async ({ where }) => {
    loadedOrderIds = where.id.in;
    return [{ id: "order-self", amount: 1000, address: "{}", items: "[]" }];
  });

  const result = await listAssignedDistributorOrders({ distributorId: "dist-1" });

  assert.deepEqual(loadedOrderIds, ["order-self"]);
  assert.deepEqual(result.orders.map((order) => order.orderId), ["order-self"]);
  assert.equal(result.pagination.total, 1);
});

test("bulk self-delivery dispatch validates input and returns individual assignment failures", async () => {
  await assert.rejects(
    dispatchDistributorSelfDeliveryOrders({ distributorId: "dist-1", assignmentIds: [] }),
    /Select at least one self-delivery order/,
  );
  await assert.rejects(
    dispatchDistributorSelfDeliveryOrders({
      distributorId: "dist-1",
      assignmentIds: Array.from({ length: 51 }, (_, index) => `assign-${index}`),
    }),
    /maximum of 50 orders/,
  );

  const client = {
    orderAssignment: {
      findFirst: async () => null,
    },
  };
  const result = await dispatchDistributorSelfDeliveryOrders({
    distributorId: "dist-1",
    assignmentIds: ["missing-1", "missing-1", "missing-2"],
    client,
  });

  assert.equal(result.success, false);
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every((entry) => !entry.success && entry.code === "ASSIGNMENT_NOT_FOUND"));
});

test("bulk self-delivery dispatch runs the existing dispatch transition once per assignment", async () => {
  const assignments = new Map(["assign-1", "assign-2"].map((id, index) => [
    id,
    {
      id,
      orderId: `order-${index + 1}`,
      distributorId: "dist-1",
      deliveryType: "SELF_DELIVERY",
      status: "on_hold",
      notes: "{}",
    },
  ]));
  let transactionCount = 0;
  const client = {
    orderAssignment: {
      findFirst: async ({ where }) => {
        const assignmentId = where.id || where.OR?.find((condition) => condition.id)?.id;
        return assignments.get(assignmentId) || null;
      },
    },
    deliveryOrder: { findUnique: async () => null },
    $transaction: async (callback) => {
      transactionCount += 1;
      return callback({
        order: {
          findUnique: async ({ where }) => ({ id: where.id, items: "[]" }),
          update: async ({ where, data }) => ({ id: where.id, ...data }),
        },
        orderAssignment: {
          updateMany: async () => ({ count: 1 }),
          update: async ({ where, data }) => ({ ...assignments.get(where.id), ...data }),
        },
        systemAuditOutbox: { create: async () => ({ id: "audit-1" }) },
      });
    },
  };

  const result = await dispatchDistributorSelfDeliveryOrders({
    distributorId: "dist-1",
    assignmentIds: ["assign-1", "assign-2"],
    client,
  });

  assert.equal(result.success, true);
  assert.equal(transactionCount, 2);
  assert.deepEqual(result.results.map(({ success, status }) => ({ success, status })), [
    { success: true, status: "dispatched" },
    { success: true, status: "dispatched" },
  ]);
});

test("self-delivery selection accepts the same city within the same province", async (t) => {
  const assignment = {
    id: "assign-1",
    orderId: "order-1",
    distributorId: "dist-1",
    deliveryType: "NCM",
    status: "package_details_complete",
  };
  const order = {
    id: "order-1",
    date: 1791566316000n,
    address: JSON.stringify({
      province: "Bagmati Province",
      district: "Bhaktapur",
      city: "Kathmandu",
    }),
  };
  let assignmentUpdate;
  let orderUpdate;

  stubMethod(t, prisma.orderAssignment, "findFirst", async () => assignment);
  stubMethod(t, prisma.order, "findUnique", async () => order);
  stubMethod(t, prisma.distributor, "findUnique", async () => ({
    province: "Bagmati Province",
    district: "Kathmandu",
    city: "Kathmandu",
    locations: [{ district: "Lalitpur" }],
  }));
  stubMethod(t, prisma.deliveryOrder, "findUnique", async () => null);
  stubMethod(t, prisma, "$transaction", async (callback) => callback({
    orderAssignment: {
      updateMany: async ({ data }) => {
        assignmentUpdate = data;
        return { count: 1 };
      },
    },
    deliveryOrder: { findUnique: async () => null },
    order: {
      update: async ({ data }) => {
        orderUpdate = data;
        return { ...order, ...data };
      },
    },
    systemAuditOutbox: { create: async () => ({ id: "audit-1" }) },
  }));

  const result = await markDistributorSelfDeliveryReady({
    distributorId: "dist-1",
    assignmentIdOrOrderId: "assign-1",
  });

  assert.equal(result.success, true);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(result.order.date, 1791566316000);
  assert.deepEqual(assignmentUpdate, { deliveryType: "SELF_DELIVERY", status: "ready_for_pickup" });
  assert.deepEqual(orderUpdate, { fulfillmentStatus: "ready_for_pickup" });
});

test("self-delivery selection rejects orders outside the distributor district", async (t) => {
  const assignment = {
    id: "assign-1",
    orderId: "order-1",
    distributorId: "dist-1",
    status: "package_details_complete",
  };
  stubMethod(t, prisma.orderAssignment, "findFirst", async () => assignment);
  stubMethod(t, prisma.order, "findUnique", async () => ({
    id: "order-1",
    address: JSON.stringify({ district: "Pokhara" }),
  }));
  stubMethod(t, prisma.distributor, "findUnique", async () => ({
    district: "Kathmandu",
    locations: [{ district: "Lalitpur" }],
  }));

  await assert.rejects(
    markDistributorSelfDeliveryReady({
      distributorId: "dist-1",
      assignmentIdOrOrderId: "assign-1",
    }),
    { code: "SELF_DELIVERY_DISTRICT_MISMATCH" },
  );
});

test("3. updateSelfDeliveryStatus transitions to Delivered, updates inventory and queues accounting", async (t) => {
  const mockAssignment = {
    id: "assign-1",
    orderId: "order-1",
    distributorId: "dist-1",
    deliveryType: "SELF_DELIVERY",
    status: "on_the_way",
    assignedAt: new Date(),
  };
  let mockOrder = {
    id: "order-1",
    date: 1791566316000n,
    amount: 200,
    deliveryFee: 20,
    paymentMethod: "PREPAID",
    payment: true,
    status: "On the Way",
    fulfillmentStatus: "out_for_delivery",
    items: JSON.stringify([{ productId: "prod-1", size: "M", color: "Black", quantity: 2 }]),
  };
  const mockLocation = { id: "loc-dist-1", distributorId: "dist-1", kind: "DISTRIBUTOR", isActive: true };
  const mockSku = { id: "sku-1", productId: "prod-1", sizeKey: "m", colorKey: "black", isActive: true };
  const mockBalance = { id: "bal-1", quantityOnHand: 5, reservedQuantity: 2 };

  let ledgerCreated = false;
  let balanceUpdated = false;
  let balanceReadCount = 0;
  const cashEvents = [];
  const deliveryEarnings = [];

  stubMethod(t, prisma.orderAssignment, "findFirst", async () => mockAssignment);
  stubMethod(t, prisma.deliveryOrder, "findUnique", async () => null);
  stubMethod(t, prisma, "$transaction", async (cb) =>
    cb({
      order: {
        findUnique: async () => mockOrder,
        update: async ({ data }) => ({ ...mockOrder, ...data }),
      },
      product: {
        findUnique: async () => ({ id: "prod-1", stockQuantity: 3, variants: [] }),
        update: async ({ data }) => ({ id: "prod-1", ...data }),
      },
      orderAssignment: {
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }) => ({ ...mockAssignment, ...data }),
      },
      distributorCashEvent: {
        create: async ({ data }) => {
          cashEvents.push(data);
          return data;
        },
      },
      distributor: { findUnique: async () => ({ id: "dist-1", name: "Test Distributor" }) },
      inventoryLocation: {
        findFirst: async () => mockLocation,
      },
      inventorySku: {
        findUnique: async () => mockSku,
      },
      inventoryBalance: {
        findMany: async () => {
          balanceReadCount += 1;
          return balanceReadCount === 1
            ? [{ id: mockBalance.id, locationId: mockLocation.id, quantityOnHand: 5, reservedQuantity: 2 }]
            : [{
                quantityOnHand: 3,
                reservedQuantity: 0,
                inventorySku: { size: "M", color: "Black", sizeKey: "m", colorKey: "black" },
              }];
        },
        updateMany: async () => {
          balanceUpdated = true;
          return { count: 1 };
        },
      },
      inventoryLedgerEntry: {
        findMany: async () => [],
        create: async () => {
          ledgerCreated = true;
          return { id: "ledger-1" };
        },
      },
      accountingEvent: {
        upsert: async ({ create }) => ({ id: "accounting-event-1", ...create }),
      },
      systemAuditOutbox: { create: async () => ({ id: "audit-1" }) },
    })
  );

  const res = await updateSelfDeliveryStatus({
    distributorId: "dist-1",
    assignmentIdOrOrderId: "assign-1",
    status: "Delivered",
    accrueDeliveryEarning: async (earning) => deliveryEarnings.push(earning),
  });

  assert.equal(res.success, true);
  assert.doesNotThrow(() => JSON.stringify(res));
  assert.equal(res.order.date, 1791566316000);
  assert.equal(res.order.status, "Delivered");
  assert.equal(res.assignment.status, "delivered");
  assert.equal(res.accountingStatus, "PENDING");
  assert.equal(balanceUpdated, true);
  assert.equal(ledgerCreated, true);
  assert.equal(deliveryEarnings.length, 1);
  assert.equal(deliveryEarnings[0].assignmentId, "assign-1");

  mockOrder = { ...mockOrder, paymentMethod: "COD", payment: false };
  balanceReadCount = 0;
  const codResult = await updateSelfDeliveryStatus({
    distributorId: "dist-1",
    assignmentIdOrOrderId: "assign-1",
    status: "Delivered",
    collectionConfirmed: true,
    notificationConfig: { enabled: false, sms: { enabled: false } },
    accrueDeliveryEarning: async (earning) => deliveryEarnings.push(earning),
  });
  assert.equal(codResult.order.payment, true);
  assert.equal(cashEvents[0].amount, "200.00");
  assert.equal(cashEvents[0].status, "PENDING_VERIFICATION");
  assert.match(cashEvents[0].notes, /SMS OTP was disabled/);
});

test("COD delivery without SMS OTP requires explicit distributor collection confirmation", async () => {
  const assignment = {
    id: "assign-cod",
    orderId: "order-cod",
    distributorId: "dist-1",
    deliveryType: "SELF_DELIVERY",
    status: "on_the_way",
  };
  const client = {
    orderAssignment: { findFirst: async () => assignment },
    deliveryOrder: { findUnique: async () => null },
    $transaction: async (callback) => callback({
      order: {
        findUnique: async () => ({
          id: "order-cod",
          amount: 1500,
          deliveryFee: 100,
          paymentMethod: "COD",
          payment: false,
        }),
      },
    }),
  };

  await assert.rejects(
    updateSelfDeliveryStatus({
      distributorId: "dist-1",
      assignmentIdOrOrderId: "assign-cod",
      status: "Delivered",
      notificationConfig: { enabled: false, sms: { enabled: false } },
      client,
    }),
    { code: "COD_COLLECTION_CONFIRMATION_REQUIRED" },
  );
});

test("4. processSelfDeliveryReturn restocks good items and writes off damaged items with discrepancy", async (t) => {
  const mockAssignment = {
    id: "assign-1",
    orderId: "order-1",
    distributorId: "dist-1",
    deliveryType: "SELF_DELIVERY",
    status: "delivered",
  };
  const mockOrder = {
    id: "order-1",
    userId: "cust-1",
    items: JSON.stringify([
      { productId: "prod-1", size: "M", color: "Black", quantity: 1, purchasedUnitPrice: 1000 },
      { productId: "prod-2", size: "L", color: "Blue", quantity: 1, purchasedUnitPrice: 1200 },
    ]),
    address: JSON.stringify({ firstName: "Ram", lastName: "Sharma", phone: "9841000000" }),
  };
  const mockStockLoc = { id: "loc-stock", distributorId: "dist-1", kind: "DISTRIBUTOR", isActive: true };
  const mockDamagedLoc = { id: "loc-damaged", distributorId: "dist-1", kind: "DAMAGED", isActive: true };
  const mockSku1 = { id: "sku-1", productId: "prod-1", sizeKey: "m", colorKey: "black", isActive: true };
  const mockSku2 = { id: "sku-2", productId: "prod-2", sizeKey: "l", colorKey: "blue", isActive: true };

  const movements = [];
  const discrepancies = [];

  stubMethod(t, prisma.orderAssignment, "findFirst", async () => mockAssignment);
  stubMethod(t, prisma.customerReturn, "findFirst", async () => ({
    id: "return-1",
    totalRefundAmount: 2200,
    approvedRefundAmount: "2200.00",
    refundPolicySnapshot: { version: 1, ratePercent: "0.00" },
    vatRefunded: 253.1,
    items: JSON.stringify([
      { productId: "prod-1", size: "M", color: "Black", quantity: 1 },
      { productId: "prod-2", size: "L", color: "Blue", quantity: 1 },
    ]),
    adminNotes: "Approved return",
  }));
  stubMethod(t, prisma.deliveryOrder, "findUnique", async () => null);
  stubMethod(t, prisma.order, "findUnique", async () => mockOrder);
  stubMethod(t, prisma, "$transaction", async (cb) =>
    cb({
      inventoryLocation: {
        findFirst: async ({ where }) => (where.kind === "DISTRIBUTOR" ? mockStockLoc : mockDamagedLoc),
      },
      inventorySku: {
        findFirst: async ({ where }) => (where.productId === "prod-1" ? mockSku1 : mockSku2),
      },
      inventoryBalance: {
        upsert: async () => ({ id: "bal" }),
      },
      inventoryLedgerEntry: {
        create: async ({ data }) => {
          movements.push(data);
          return { id: "ledger" };
        },
      },
      inventoryDiscrepancy: {
        create: async ({ data }) => {
          discrepancies.push(data);
          return { id: "disc-1" };
        },
      },
      customerReturn: {
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }) => ({ id: "return-1", ...data }),
      },
      customerReturnEvent: { create: async () => ({ id: "event-1" }) },
      orderAssignment: {
        update: async () => ({ id: "assign-1", status: "returned" }),
      },
      order: {
        update: async () => ({ id: "order-1", status: "Returned" }),
      },
      systemAuditOutbox: { create: async () => ({ id: "audit-1" }) },
    })
  );

  const res = await processSelfDeliveryReturn({
    distributorId: "dist-1",
    assignmentIdOrOrderId: "assign-1",
    returnRequestId: "return-1",
    items: [
      { productId: "prod-1", size: "M", color: "Black", quantity: 1, condition: "GOOD" },
      { productId: "prod-2", size: "L", color: "Blue", quantity: 1, condition: "DAMAGED" },
    ],
    reason: "Size mismatch & stitching flaw",
    damageType: "STITCH_DAMAGE",
    damageNotes: "Torn collar seam on arrival",
    inspectionEvidenceUrl: "https://res.cloudinary.com/demo/return-photo.png",
  });

  assert.equal(res.success, true);
  assert.equal(res.hasDamagedItems, true);
  assert.equal(res.totalRefundAmount, 2200);
  assert.equal(res.customerReturn.lifecycleStatus, "REFUND_PENDING");
  assert.equal(res.customerReturn.refundStatus, "PENDING");
  assert.equal(res.customerReturn.refundMethod, "CASH");
  assert.equal(res.customerReturn.inspectionEvidenceUrl, "https://res.cloudinary.com/demo/return-photo.png");
  assert.equal(movements.length, 2);
  assert.equal(movements.find((m) => m.movementType === "RETURN").destinationLocationId, "loc-stock");
  assert.equal(movements.find((m) => m.movementType === "DAMAGE").destinationLocationId, "loc-damaged");
  assert.equal(discrepancies.length, 1);
  assert.equal(discrepancies[0].damageType, "STITCH_DAMAGE");
});

test("self-delivery return QA requires an admin-approved return request", async (t) => {
  stubMethod(t, prisma.orderAssignment, "findFirst", async () => ({
    id: "assign-1",
    orderId: "order-1",
    distributorId: "dist-1",
    deliveryType: "SELF_DELIVERY",
    status: "delivered",
  }));
  stubMethod(t, prisma.deliveryOrder, "findUnique", async () => null);

  await assert.rejects(
    processSelfDeliveryReturn({
      distributorId: "dist-1",
      assignmentIdOrOrderId: "assign-1",
      items: [{ productId: "prod-1", size: "M", color: "Black", quantity: 1, condition: "GOOD" }],
      reason: "Customer requested return",
    }),
    { code: "RETURN_ADMIN_APPROVAL_REQUIRED" },
  );
});

test("5. Rate Card Engine records and resolves negotiated rates", async (t) => {
  const mockRateCard = {
    id: "rate-1",
    distributorId: "dist-1",
    productId: null,
    deliveryCharge: 120,
    returnCharge: 60,
    commissionRate: 10,
    bonusRate: 25,
    incentiveRate: 0,
    vatRate: 13,
    vatInclusive: false,
    status: "APPROVED",
  };

  stubMethod(t, prisma.distributor, "findUnique", async () => ({ id: "dist-1" }));
  let latestRateCard = mockRateCard;
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "findFirst", async () => latestRateCard);
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "findMany", async () => [mockRateCard]);
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "update", async ({ data }) => ({ ...mockRateCard, ...data }));
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "create", async ({ data }) => {
    latestRateCard = { id: "rate-2", ...data };
    return latestRateCard;
  });

  const saved = await recordDistributorRateCard({
    distributorId: "dist-1",
    deliveryCharge: 120,
    returnCharge: 60,
    commissionRate: 10,
    bonusRate: 25,
    vatRate: 13,
  });

  assert.equal(saved.deliveryCharge, 120);
  assert.equal(saved.returnCharge, 60);
  assert.equal(saved.bonusRate, 0);

  const resolved = await resolveActiveRateCard({ distributorId: "dist-1" });
  assert.equal(resolved.deliveryCharge, 120);
  assert.equal(resolved.returnCharge, 60);
  assert.equal(resolved.bonusRate, 0);
  assert.equal(resolved.commissionRate, 10);
  assert.equal(resolved.vatRate, 13);
});

test("6. Distributor Financial Statement calculates earnings, VAT breakdown, and balances", async (t) => {
  const mockDistributor = { id: "dist-1", name: "Kathmandu Hub", city: "Kathmandu", status: "ACTIVE", isActive: true };
  const delivered = [
    { id: "a-1", orderId: "o-1", deliveryType: "SELF_DELIVERY", status: "delivered", deliveredAt: new Date() },
    { id: "a-2", orderId: "o-2", deliveryType: "SELF_DELIVERY", status: "delivered", deliveredAt: new Date() },
    { id: "a-4", orderId: "o-4", deliveryType: "SELF_DELIVERY", status: "delivered", deliveredAt: new Date() },
    { id: "a-ncm", orderId: "o-ncm", deliveryType: "NCM", status: "delivered", deliveredAt: new Date() },
  ];
  const returned = [
    { id: "a-3", orderId: "o-3", deliveryType: "SELF_DELIVERY", status: "returned", returnedAt: new Date() },
    { id: "a-5", orderId: "o-5", deliveryType: "SELF_DELIVERY", status: "returned", returnedAt: new Date() },
  ];
  const settlements = [
    { id: "s-1", distributorId: "dist-1", amount: 100, status: "SETTLED", settledAt: new Date() },
    { id: "s-2", distributorId: "dist-1", amount: 20, paidAmount: 0, status: "PENDING", requestedAt: new Date() },
  ];
  const mockRateCard = {
    id: "rc-1",
    distributorId: "dist-1",
    deliveryCharge: 100,
    returnCharge: 50,
    commissionRate: 10, // Rs. 10 commission per delivery
    bonusRate: 20, // Legacy field is ignored for new delivery earnings.
    vatRate: 13,
    status: "APPROVED",
  };

  stubMethod(t, prisma.distributor, "findUnique", async () => mockDistributor);
  stubMethod(t, prisma.orderAssignment, "findMany", async ({ where }) => {
    const assignments = where.status.in?.includes("delivered") ? delivered : returned;
    return assignments.filter((assignment) =>
      where.deliveryType.in.includes(assignment.deliveryType) &&
      where.status.in.includes(assignment.status)
    );
  });
  stubMethod(t, prisma.deliveryOrder, "findMany", async ({ where }) =>
    ["o-4", "o-5"].filter((orderId) => where.orderId.in.includes(orderId)).map((orderId) => ({ orderId }))
  );
  stubMethod(t, prisma.order, "findMany", async () => [
    { id: "o-1", amount: 1000, paymentMethod: "COD" },
    { id: "o-2", amount: 2000, paymentMethod: "COD" },
    { id: "o-4", amount: 3000, paymentMethod: "COD" },
  ]);
  stubMethod(t, prisma.distributorServiceEarning, "findMany", async () => []);
  stubMethod(t, prisma.distributorBonusPlan, "findMany", async () => []);
  stubMethod(t, prisma.distributorSettlementRequest, "findMany", async () => settlements);
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "findFirst", async () => mockRateCard);

  // 1. With VAT View (13%)
  const statementWithVat = await getDistributorFinancialStatement({
    distributorId: "dist-1",
    withVat: true,
  });

  // Calculations:
  // Deliveries: 2 * 100 = 200 gross
  // Per-delivery incentives are disabled for new earnings.
  // Returns: 1 * 50 = 50
  // Admin Commission/Discount: 2 * 10 = 20
  // Subtotal before VAT = 200 + 50 - 20 = 230
  // 13% VAT = 230 * 0.13 = 29.90
  // Total With VAT = 259.90
  // Settled Paid = 100
  // Net Payable = 259.90 - 100 paid - 20 pending = 139.90
  assert.equal(statementWithVat.summary.grossDeliveryEarnings, 200);
  assert.equal(statementWithVat.summary.earnedIncentives, 0);
  assert.equal(statementWithVat.summary.returnFeesEarned, 50);
  assert.equal(statementWithVat.summary.adminDiscountsApplied, 20);
  assert.equal(statementWithVat.summary.subtotalBeforeVat, 230);
  assert.equal(statementWithVat.summary.vatAmount, 29.90);
  assert.equal(statementWithVat.summary.totalWithVat, 259.90);
  assert.equal(statementWithVat.summary.totalWithoutVat, 230);
  assert.equal(statementWithVat.summary.totalSettledPaid, 100);
  assert.equal(statementWithVat.summary.netPayableBalance, 139.90);
  assert.equal(statementWithVat.summary.grossOutstandingPayableBalance, 159.90);
  assert.equal(statementWithVat.summary.pendingSettlementAmount, 20);
  assert.equal(statementWithVat.vatMode, "WITH_VAT");
  assert.equal(statementWithVat.transactions.length, 5); // 2 self-deliveries + 1 return + 2 settlements

  // 2. Without VAT View
  const statementWithoutVat = await getDistributorFinancialStatement({
    distributorId: "dist-1",
    withVat: false,
  });
  assert.equal(statementWithoutVat.vatMode, "WITHOUT_VAT");
  assert.equal(statementWithoutVat.summary.netPayableBalance, 110); // 230 - 100 paid - 20 pending
});

test("7. submitDistributorSettlementRequest creates pending request and guards against exceeding balance", async (t) => {
  const mockDistributor = { id: "dist-1", name: "Kathmandu Hub", city: "Kathmandu", status: "ACTIVE", isActive: true };
  const delivered = [
    { id: "a-1", orderId: "o-1", deliveryType: "SELF_DELIVERY", status: "delivered", deliveredAt: new Date() },
  ];
  const mockRateCard = {
    deliveryCharge: 100,
    returnCharge: 50,
    commissionRate: 0,
    bonusRate: 0,
    vatRate: 13,
    status: "APPROVED",
  };

  stubMethod(t, prisma.distributor, "findUnique", async () => mockDistributor);
  stubMethod(t, prisma.orderAssignment, "findMany", async () => delivered);
  stubMethod(t, prisma.deliveryOrder, "findMany", async () => []);
  stubMethod(t, prisma.order, "findMany", async () => [{ id: "o-1", amount: 1000 }]);
  stubMethod(t, prisma.distributorSettlementRequest, "findMany", async () => []);
  stubMethod(t, prisma.distributorBonusPlan, "findMany", async () => []);
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "findFirst", async () => mockRateCard);
  let createdRequest = null;
  stubMethod(t, prisma.distributorSettlementRequest, "findFirst", async ({ where }) =>
    createdRequest?.idempotencyKey === where.idempotencyKey ? createdRequest : null);
  let payableCreated = false;
  let requestAccountingPosted = false;
  stubMethod(t, prisma, "$transaction", async (callback) => callback({
    $queryRaw: async () => [],
    distributor: { findUnique: async () => mockDistributor },
    orderAssignment: {
      findMany: async ({ where }) => where.status.in.includes("delivered") ? delivered : [],
    },
    deliveryOrder: { findMany: async () => [] },
    order: { findMany: async () => [{ id: "o-1", amount: 1000 }] },
    distributorDeliveryChargeNegotiation: { findFirst: async () => mockRateCard },
    distributorBonusPlan: { findMany: async () => [] },
    distributorSettlementRequest: {
      findFirst: async ({ where }) =>
        createdRequest?.idempotencyKey === where.idempotencyKey ? createdRequest : null,
      findMany: async () => createdRequest ? [createdRequest] : [],
      create: async ({ data }) => {
        createdRequest = {
          id: "set-req-1",
          ...data,
          distributor: mockDistributor,
        };
        return createdRequest;
      },
      update: async ({ data }) => ({ id: "set-req-1", ...data }),
    },
    accountPayable: {
      create: async ({ data }) => {
        payableCreated = true;
        return { id: "ap-1", ...data };
      },
    },
  }));

  // Available balance: 100 + 13% VAT = 113.00

  // 1. Success request within balance
  const res = await submitDistributorSettlementRequest({
    distributorId: "dist-1",
    amount: 100,
    notes: "Weekly payout request",
    idempotencyKey: "settlement-request-1",
    postRequestAccounting: async () => {
      requestAccountingPosted = true;
    },
  });
  assert.equal(res.success, true);
  assert.equal(res.settlementRequest.amount, 100);
  assert.equal(res.settlementRequest.status, "PENDING");
  assert.equal(res.settlementRequest.metadata.settlementBasis, "LEGACY_EARNINGS_RECONCILIATION_REQUIRED");
  assert.equal(payableCreated, false);
  assert.equal(requestAccountingPosted, false);
  assert.match(res.message, /historical earnings are reconciled/);

  const replay = await submitDistributorSettlementRequest({
    distributorId: "dist-1",
    amount: 100,
    idempotencyKey: "settlement-request-1",
  });
  assert.equal(replay.isReplay, true);
  assert.equal(replay.settlementRequest.id, "set-req-1");
  await assert.rejects(
    submitDistributorSettlementRequest({
      distributorId: "dist-1",
      amount: 99,
      idempotencyKey: "settlement-request-1",
    }),
    { code: "IDEMPOTENCY_KEY_REUSED" }
  );
  await assert.rejects(
    submitDistributorSettlementRequest({
      distributorId: "dist-1",
      amount: "100.001",
    }),
    { code: "INVALID_AMOUNT" }
  );

  // A second request cannot consume the balance already reserved by the pending request.
  await assert.rejects(
    submitDistributorSettlementRequest({
      distributorId: "dist-1",
      amount: 13.01,
      idempotencyKey: "settlement-request-2",
    }),
    { code: "INSUFFICIENT_SETTLEMENT_BALANCE" }
  );

  // 2. Excessive request throws error
  await assert.rejects(
    submitDistributorSettlementRequest({
      distributorId: "dist-1",
      amount: 500, // exceeds available 113.00
    }),
    { code: "INSUFFICIENT_SETTLEMENT_BALANCE" }
  );
});

test("Admin cannot pay a request-only distributor payable until earning documents are reconciled", async () => {
  const client = {
    $transaction: async (callback) => callback({
      distributorSettlementRequest: {
        findUnique: async () => ({
          id: "legacy-request-1",
          distributorId: "dist-1",
          amount: 25,
          metadata: { settlementBasis: "LEGACY_EARNINGS_RECONCILIATION_REQUIRED" },
          distributor: { id: "dist-1", name: "Kathmandu Hub" },
        }),
      },
    }),
  };

  await assert.rejects(
    executeAdminDistributorSettlement({
      settlementId: "legacy-request-1",
      amount: 25,
      financialAccountId: "fa-1",
      externalPaymentReference: "BANK-REF-LEGACY",
      client,
    }),
    { code: "LEGACY_EARNINGS_RECONCILIATION_REQUIRED" },
  );
});

test("Admin reconciliation links only verified open earnings and audits the resolution", async () => {
  const request = {
    id: "legacy-request-1",
    distributorId: "dist-1",
    amount: new Prisma.Decimal("25.00"),
    paidAmount: new Prisma.Decimal("0"),
    status: "PENDING",
    metadata: {
      settlementBasis: "LEGACY_EARNINGS_RECONCILIATION_REQUIRED",
      statementSnapshot: { lineItems: [{ earningId: "earning-1" }] },
    },
    distributor: { id: "dist-1", name: "Kathmandu Hub" },
  };
  let update;
  let auditPayload;
  const client = {
    $transaction: async (callback) => callback({
      distributorSettlementRequest: {
        findUnique: async () => request,
        findMany: async () => [{ id: request.id, metadata: request.metadata }],
        updateMany: async (args) => {
          update = args;
          return { count: 1 };
        },
      },
      accountingDocument: {
        findMany: async () => [{
          id: "document-1",
          sourceId: "earning-1",
          remainingAmount: new Prisma.Decimal("30.00"),
        }],
      },
    }),
  };

  const result = await resolveDistributorSettlementReconciliation({
    settlementId: request.id,
    decision: "RECONCILE",
    earningDocumentIds: ["document-1"],
    reviewNotes: "Matched to the recorded delivery earning.",
    reviewerAccountId: "admin-1",
    writeAudit: async (_actor, payload) => { auditPayload = payload; },
    client,
  });

  assert.equal(result.settlementRequest.metadata.settlementBasis, "ACCOUNTING_SUBLEDGER");
  assert.deepEqual(result.settlementRequest.metadata.earningDocumentIds, ["document-1"]);
  assert.equal(update.data.metadata.reconciledBy, "admin-1");
  assert.equal(auditPayload.action, "DISTRIBUTOR_SETTLEMENT_RECONCILIATION_RESOLVED");
});

test("Admin may reject an unsupported legacy settlement request with an audited reason", async () => {
  const request = {
    id: "legacy-request-2",
    distributorId: "dist-1",
    amount: new Prisma.Decimal("25.00"),
    paidAmount: new Prisma.Decimal("0"),
    status: "PENDING",
    metadata: { settlementBasis: "LEGACY_EARNINGS_RECONCILIATION_REQUIRED" },
    distributor: { id: "dist-1", name: "Kathmandu Hub" },
  };
  let update;
  let auditPayload;
  const client = {
    $transaction: async (callback) => callback({
      distributorSettlementRequest: {
        findUnique: async () => request,
        updateMany: async (args) => {
          update = args;
          return { count: 1 };
        },
      },
    }),
  };

  const result = await resolveDistributorSettlementReconciliation({
    settlementId: request.id,
    decision: "REJECT",
    reviewNotes: "No supported delivery earning was found.",
    reviewerAccountId: "admin-1",
    writeAudit: async (_actor, payload) => { auditPayload = payload; },
    client,
  });

  assert.equal(result.settlementRequest.status, "REJECTED");
  assert.equal(update.data.status, "REJECTED");
  assert.equal(update.data.metadata.rejectionNotes, "No supported delivery earning was found.");
  assert.equal(auditPayload.action, "DISTRIBUTOR_SETTLEMENT_RECONCILIATION_REJECTED");
});

test("8. executeAdminDistributorSettlement records partial and final payout against payable and treasury", async (t) => {
  let settlementState = {
    id: "set-req-1",
    distributorId: "dist-1",
    amount: 100,
    paidAmount: 0,
    status: "PENDING",
    metadata: { accountPayableId: "ap-1" },
    distributor: { id: "dist-1", name: "Kathmandu Hub" },
  };
  const mockFinancialAccount = {
    id: "fa-1",
    accountName: "Nabil Bank Operating",
    currentBalance: 50000,
    status: "ACTIVE",
    accountType: "BANK",
  };
  const mockPayable = {
    id: "ap-1",
    referenceType: "DISTRIBUTOR_SETTLEMENT",
    referenceId: "set-req-1",
    totalAmount: 100,
    paidAmount: 0,
    remainingBalance: 100,
    settlementHistory: [],
  };

  let cashTxCount = 0;
  let accountDeducted = 0;
  let payableUpdated = false;
  const paymentAccountingKeys = [];
  let payableState = { ...mockPayable };
  let currentBalance = mockFinancialAccount.currentBalance;
  const cashTransactions = new Map();

  stubMethod(t, prisma, "$transaction", async (cb) =>
    cb({
      distributorSettlementRequest: {
        findUnique: async () => settlementState,
        update: async ({ data }) => {
          settlementState = { ...settlementState, ...data };
          return settlementState;
        },
      },
      financialAccount: {
        findUnique: async () => ({ ...mockFinancialAccount, currentBalance }),
        update: async ({ data }) => {
          const decrement = Number(data.currentBalance.decrement);
          accountDeducted += decrement;
          currentBalance -= decrement;
          return { ...mockFinancialAccount, currentBalance };
        },
      },
      cashTransaction: {
        findUnique: async ({ where }) => cashTransactions.get(where.idempotencyKey) || null,
        create: async ({ data }) => {
          cashTxCount += 1;
          const transaction = { id: `ctx-${cashTxCount}`, ...data };
          cashTransactions.set(data.idempotencyKey, transaction);
          return transaction;
        },
      },
      accountPayable: {
        findUnique: async () => payableState,
        update: async ({ data }) => {
          payableUpdated = true;
          payableState = { ...payableState, ...data };
          return payableState;
        },
      },
      systemAuditOutbox: { create: async () => ({ id: "audit-1" }) },
    })
  );

  const res = await executeAdminDistributorSettlement({
    settlementId: "set-req-1",
    amount: 40,
    financialAccountId: "fa-1",
    externalPaymentReference: "BANK-TRANSFER-001",
    idempotencyKey: "settlement-payment-1",
    adminNotes: "First partial bank transfer.",
    adminAccountId: "admin-1",
    validatePayoutAccount: async () => ({ id: "gl-bank", accountCode: "1120" }),
    loadCashPosition: async () => ({
      outstandingReceivable: "250.00",
      pendingRemittance: "50.00",
      availableToRemit: "200.00",
    }),
    postPaymentAccounting: async ({ idempotencyKey }) => {
      paymentAccountingKeys.push(idempotencyKey);
    },
  });

  test("Admin payout allocates delivery and target bonus documents against distributor payable 2190", async () => {
    let settlement = {
      id: "set-subledger-1",
      distributorId: "dist-1",
      amount: 120,
      paidAmount: 0,
      status: "PENDING",
      metadata: {
        settlementBasis: "ACCOUNTING_SUBLEDGER",
        earningDocumentIds: ["earning-doc-1", "bonus-doc-1"],
      },
      distributor: { id: "dist-1", name: "Kathmandu Hub" },
    };
    const documents = [
      {
        id: "earning-doc-1",
        partyId: "party-1",
        side: "PAYABLE",
        sourceType: "DISTRIBUTOR_SERVICE_EARNING",
        originalAmount: "100.00",
        allocatedAmount: "0.00",
        remainingAmount: "100.00",
        status: "OPEN",
        issueDate: new Date("2026-10-27T00:00:00.000Z"),
      },
      {
        id: "bonus-doc-1",
        partyId: "party-1",
        side: "PAYABLE",
        sourceType: "DISTRIBUTOR_TARGET_BONUS",
        originalAmount: "40.00",
        allocatedAmount: "0.00",
        remainingAmount: "40.00",
        status: "OPEN",
        issueDate: new Date("2026-10-28T00:00:00.000Z"),
      },
    ];
    let balance = 500;
    const cashTransactions = new Map();
    const allocations = new Map();
    let paymentJournalArguments;
    let requestedSourceTypes;
    const tx = {
      distributorSettlementRequest: {
        findUnique: async () => settlement,
        updateMany: async ({ data }) => {
          settlement = { ...settlement, ...data };
          return { count: 1 };
        },
      },
      accountingParty: { upsert: async () => ({ id: "party-1" }) },
      accountingDocument: {
        findMany: async ({ where }) => {
          requestedSourceTypes = where.sourceType.in;
          return documents.filter((document) => where.sourceType.in.includes(document.sourceType));
        },
        updateMany: async ({ where, data }) => {
          const document = documents.find((item) => item.id === where.id);
          Object.assign(document, data);
          return { count: 1 };
        },
      },
      accountingAllocation: {
        findUnique: async ({ where }) => allocations.get(where.idempotencyKey) || null,
        create: async ({ data }) => {
          const allocation = { id: "allocation-1", ...data };
          allocations.set(data.idempotencyKey, allocation);
          return allocation;
        },
      },
      financialAccount: {
        findUnique: async () => ({
          id: "fa-1",
          accountName: "Operating Bank",
          accountType: "BANK",
          status: "ACTIVE",
          currentBalance: balance,
          accountingAccountId: "gl-bank",
          accountingAccount: { accountType: "ASSET", normalBalance: "DEBIT" },
        }),
        updateMany: async ({ data }) => {
          balance -= Number(data.currentBalance.decrement);
          return { count: 1 };
        },
      },
      cashTransaction: {
        findUnique: async ({ where }) => cashTransactions.get(where.idempotencyKey) || null,
        create: async ({ data }) => {
          const transaction = { id: "cash-1", ...data };
          cashTransactions.set(data.idempotencyKey, transaction);
          return transaction;
        },
      },
      systemAuditOutbox: { create: async () => ({ id: "audit-1" }) },
    };
    const client = { $transaction: async (callback) => callback(tx) };

    const result = await executeAdminDistributorSettlement({
      settlementId: settlement.id,
      amount: 120,
      financialAccountId: "fa-1",
      externalPaymentReference: "BANK-TRANSFER-SUBLEDGER-001",
      idempotencyKey: "settlement-subledger-payment-1",
      adminAccountId: "admin-1",
      client,
      validatePayoutAccount: async () => ({ id: "gl-bank", accountCode: "1120" }),
      loadCashPosition: async () => ({
        outstandingReceivable: "300.00",
        pendingRemittance: "0.00",
        availableToRemit: "300.00",
      }),
      postPaymentAccounting: async (args) => {
        paymentJournalArguments = args;
        return { id: "payment-journal-1" };
      },
      resolveAccountingParty: async () => ({ id: "party-1" }),
      writeAudit: async () => {},
    });

    assert.equal(result.success, true);
    assert.equal(result.settlement.status, "SETTLED");
    assert.equal(result.codExposureWarning.code, "UNREMITTED_COD_OUTSTANDING");
    assert.equal(result.codExposureWarning.outstandingReceivable, "300.00");
    assert.equal(result.requiresCodRemittanceReview, true);
    assert.deepEqual(requestedSourceTypes, ["DISTRIBUTOR_SERVICE_EARNING", "DISTRIBUTOR_TARGET_BONUS"]);
    assert.equal(documents[0].remainingAmount.toString(), "0");
    assert.equal(documents[0].status, "PAID");
    assert.equal(documents[1].remainingAmount.toString(), "20");
    assert.equal(documents[1].status, "PARTIALLY_PAID");
    assert.equal(balance, 380);
    assert.equal(paymentJournalArguments.payableAccountCode, "2190");
    assert.equal(paymentJournalArguments.accountingPartyId, "party-1");
    assert.equal(paymentJournalArguments.cashAccountId, "gl-bank");
    assert.equal(cashTransactions.get("settlement-subledger-payment-1").amount, 120);
    assert.equal(allocations.size, 2);
  });

  assert.equal(res.success, true);
  assert.equal(res.settlement.status, "PARTIALLY_PAID");
  assert.equal(res.settlement.paidAmount, 40);
  assert.equal(res.settlement.externalPaymentReference, "BANK-TRANSFER-001");
  assert.equal(res.payable.remainingBalance, 60);
  assert.equal(res.codExposureWarning.code, "UNREMITTED_COD_OUTSTANDING");
  assert.equal(res.codExposureWarning.outstandingReceivable, "250.00");
  assert.equal(res.requiresCodRemittanceReview, true);
  assert.equal(cashTransactions.get("settlement-payment-1").amount, 40);

  const replay = await executeAdminDistributorSettlement({
    settlementId: "set-req-1",
    amount: 40,
    financialAccountId: "fa-1",
    externalPaymentReference: "BANK-TRANSFER-001",
    idempotencyKey: "settlement-payment-1",
    postPaymentAccounting: async ({ idempotencyKey }) => {
      paymentAccountingKeys.push(idempotencyKey);
    },
  });
  assert.equal(replay.isReplay, true);
  assert.equal(replay.settlement.paidAmount, 40);
  assert.equal(cashTxCount, 1);
  assert.equal(cashTransactions.get("settlement-payment-1").externalPaymentReference, "BANK-TRANSFER-001");
  await assert.rejects(
    executeAdminDistributorSettlement({
      settlementId: "set-req-1",
      amount: 39,
      financialAccountId: "fa-1",
      externalPaymentReference: "BANK-TRANSFER-001",
      idempotencyKey: "settlement-payment-1",
      postPaymentAccounting: async () => {},
    }),
    { code: "IDEMPOTENCY_KEY_REUSED" }
  );
  await assert.rejects(
    executeAdminDistributorSettlement({
      settlementId: "set-req-1",
      amount: 40,
      financialAccountId: "fa-1",
      externalPaymentReference: "DIFFERENT-TRANSFER-REFERENCE",
      idempotencyKey: "settlement-payment-1",
      postPaymentAccounting: async () => {},
    }),
    { code: "IDEMPOTENCY_KEY_REUSED" }
  );

  const finalRes = await executeAdminDistributorSettlement({
    settlementId: "set-req-1",
    amount: 60,
    financialAccountId: "fa-1",
    externalPaymentReference: "BANK-TRANSFER-002",
    idempotencyKey: "settlement-payment-2",
    adminNotes: "Final bank transfer.",
    adminAccountId: "admin-1",
    validatePayoutAccount: async () => ({ id: "gl-bank", accountCode: "1120" }),
    loadCashPosition: async () => ({
      outstandingReceivable: "0.00",
      pendingRemittance: "0.00",
      availableToRemit: "0.00",
    }),
    postPaymentAccounting: async ({ idempotencyKey }) => {
      paymentAccountingKeys.push(idempotencyKey);
    },
  });

  assert.equal(finalRes.success, true);
  assert.equal(finalRes.settlement.status, "SETTLED");
  assert.equal(finalRes.settlement.paidAmount, 100);
  assert.equal(finalRes.payable.remainingBalance, 0);
  assert.equal(accountDeducted, 100);
  assert.equal(currentBalance, 49900);
  assert.equal(cashTxCount, 2);
  assert.equal(payableUpdated, true);
  assert.equal(paymentAccountingKeys.length, 2);
  assert.notEqual(paymentAccountingKeys[0], paymentAccountingKeys[1]);
});
