import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import {
  validateSelfDeliveryTransition,
  listAssignedDistributorOrders,
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
} from "../services/distributorFinanceService.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

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
    status: "assigned",
    assignedAt: new Date(),
    distributor: { id: "dist-1", name: "Kathmandu Hub", city: "Kathmandu", phone: "9846000000" },
  };
  const mockOrder = {
    id: "order-1",
    userId: "user-1",
    amount: 1500,
    deliveryFee: 100,
    status: "Order Placed",
    fulfillmentStatus: "assigned",
    paymentMethod: "COD",
    payment: false,
    address: JSON.stringify({ province: "Bagmati", district: "Kathmandu", city: "Kathmandu" }),
    items: JSON.stringify([{ productId: "prod-1", name: "T-Shirt", size: "M", color: "Black", quantity: 1, price: 1500 }]),
    assignedGift: null,
  };

  stubMethod(t, prisma.orderAssignment, "findMany", async () => [mockAssignment]);
  stubMethod(t, prisma.orderAssignment, "count", async () => 1);
  stubMethod(t, prisma.order, "findMany", async () => [mockOrder]);

  const result = await listAssignedDistributorOrders({
    distributorId: "dist-1",
    status: "all",
  });

  assert.equal(result.success, true);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].orderId, "order-1");
  assert.equal(result.orders[0].order.amount, 1500);
});

test("3. updateSelfDeliveryStatus transitions to Delivered, updates order & inventory ledger", async (t) => {
  const mockAssignment = {
    id: "assign-1",
    orderId: "order-1",
    distributorId: "dist-1",
    status: "on_the_way",
    assignedAt: new Date(),
  };
  const mockOrder = {
    id: "order-1",
    status: "On the Way",
    fulfillmentStatus: "out_for_delivery",
    items: JSON.stringify([{ productId: "prod-1", size: "M", color: "Black", quantity: 2 }]),
  };
  const mockLocation = { id: "loc-dist-1", distributorId: "dist-1", kind: "DISTRIBUTOR", isActive: true };
  const mockSku = { id: "sku-1", productId: "prod-1", sizeKey: "m", colorKey: "black", isActive: true };
  const mockBalance = { id: "bal-1", quantityOnHand: 5, reservedQuantity: 2 };

  let ledgerCreated = false;
  let balanceUpdated = false;

  stubMethod(t, prisma.orderAssignment, "findFirst", async () => mockAssignment);
  stubMethod(t, prisma, "$transaction", async (cb) =>
    cb({
      order: {
        findUnique: async () => mockOrder,
        update: async ({ data }) => ({ ...mockOrder, ...data }),
      },
      orderAssignment: {
        update: async ({ data }) => ({ ...mockAssignment, ...data }),
      },
      inventoryLocation: {
        findFirst: async () => mockLocation,
      },
      inventorySku: {
        findFirst: async () => mockSku,
      },
      inventoryBalance: {
        findUnique: async () => mockBalance,
        update: async () => {
          balanceUpdated = true;
          return { ...mockBalance, quantityOnHand: 3, reservedQuantity: 0 };
        },
      },
      inventoryLedgerEntry: {
        create: async () => {
          ledgerCreated = true;
          return { id: "ledger-1" };
        },
      },
      systemAuditOutbox: { create: async () => ({ id: "audit-1" }) },
    })
  );

  const res = await updateSelfDeliveryStatus({
    distributorId: "dist-1",
    assignmentIdOrOrderId: "assign-1",
    status: "Delivered",
  });

  assert.equal(res.success, true);
  assert.equal(res.order.status, "Delivered");
  assert.equal(res.assignment.status, "delivered");
  assert.equal(balanceUpdated, true);
  assert.equal(ledgerCreated, true);
});

test("4. processSelfDeliveryReturn restocks good items and writes off damaged items with discrepancy", async (t) => {
  const mockAssignment = {
    id: "assign-1",
    orderId: "order-1",
    distributorId: "dist-1",
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
        create: async ({ data }) => ({ id: "ret-1", ...data }),
      },
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
    items: [
      { productId: "prod-1", size: "M", color: "Black", quantity: 1, condition: "GOOD" },
      { productId: "prod-2", size: "L", color: "Blue", quantity: 1, condition: "DAMAGED" },
    ],
    reason: "Size mismatch & stitching flaw",
    damageType: "STITCH_DAMAGE",
    damageNotes: "Torn collar seam on arrival",
  });

  assert.equal(res.success, true);
  assert.equal(res.hasDamagedItems, true);
  assert.equal(res.totalRefundAmount, 2200);
  assert.equal(movements.length, 2);
  assert.equal(movements.find((m) => m.movementType === "RETURN").destinationLocationId, "loc-stock");
  assert.equal(movements.find((m) => m.movementType === "DAMAGE").destinationLocationId, "loc-damaged");
  assert.equal(discrepancies.length, 1);
  assert.equal(discrepancies[0].damageType, "STITCH_DAMAGE");
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
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "findFirst", async () => mockRateCard);
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "findMany", async () => [mockRateCard]);
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "update", async ({ data }) => ({ ...mockRateCard, ...data }));

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
  assert.equal(saved.bonusRate, 25);

  const resolved = await resolveActiveRateCard({ distributorId: "dist-1" });
  assert.equal(resolved.deliveryCharge, 120);
  assert.equal(resolved.returnCharge, 60);
  assert.equal(resolved.bonusRate, 25);
  assert.equal(resolved.commissionRate, 10);
  assert.equal(resolved.vatRate, 13);
});

test("6. Distributor Financial Statement calculates earnings, VAT breakdown, and balances", async (t) => {
  const mockDistributor = { id: "dist-1", name: "Kathmandu Hub", city: "Kathmandu", status: "ACTIVE", isActive: true };
  const delivered = [
    { id: "a-1", orderId: "o-1", status: "delivered", deliveredAt: new Date() },
    { id: "a-2", orderId: "o-2", status: "delivered", deliveredAt: new Date() },
  ];
  const returned = [
    { id: "a-3", orderId: "o-3", status: "returned", returnedAt: new Date() },
  ];
  const settlements = [
    { id: "s-1", distributorId: "dist-1", amount: 100, status: "SETTLED", settledAt: new Date() },
  ];
  const mockRateCard = {
    id: "rc-1",
    distributorId: "dist-1",
    deliveryCharge: 100,
    returnCharge: 50,
    commissionRate: 10, // Rs. 10 commission per delivery
    bonusRate: 20, // Rs. 20 bonus per delivery
    vatRate: 13,
    status: "APPROVED",
  };

  stubMethod(t, prisma.distributor, "findUnique", async () => mockDistributor);
  stubMethod(t, prisma.orderAssignment, "findMany", async ({ where }) =>
    where.status.in ? (where.status.in.includes("delivered") ? delivered : returned) : []
  );
  stubMethod(t, prisma.order, "findMany", async () => [
    { id: "o-1", amount: 1000, paymentMethod: "COD" },
    { id: "o-2", amount: 2000, paymentMethod: "COD" },
  ]);
  stubMethod(t, prisma.distributorSettlementRequest, "findMany", async () => settlements);
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "findFirst", async () => mockRateCard);

  // 1. With VAT View (13%)
  const statementWithVat = await getDistributorFinancialStatement({
    distributorId: "dist-1",
    withVat: true,
  });

  // Calculations:
  // Deliveries: 2 * 100 = 200 gross
  // Incentives/Bonus: 2 * 20 = 40
  // Returns: 1 * 50 = 50
  // Admin Commission/Discount: 2 * 10 = 20
  // Subtotal before VAT = 200 + 40 + 50 - 20 = 270
  // 13% VAT = 270 * 0.13 = 35.10
  // Total With VAT = 305.10
  // Settled Paid = 100
  // Net Payable = 305.10 - 100 = 205.10
  assert.equal(statementWithVat.summary.grossDeliveryEarnings, 200);
  assert.equal(statementWithVat.summary.earnedIncentives, 40);
  assert.equal(statementWithVat.summary.returnFeesEarned, 50);
  assert.equal(statementWithVat.summary.adminDiscountsApplied, 20);
  assert.equal(statementWithVat.summary.subtotalBeforeVat, 270);
  assert.equal(statementWithVat.summary.vatAmount, 35.10);
  assert.equal(statementWithVat.summary.totalWithVat, 305.10);
  assert.equal(statementWithVat.summary.totalWithoutVat, 270);
  assert.equal(statementWithVat.summary.totalSettledPaid, 100);
  assert.equal(statementWithVat.summary.netPayableBalance, 205.10);
  assert.equal(statementWithVat.vatMode, "WITH_VAT");
  assert.equal(statementWithVat.transactions.length, 4); // 2 deliveries + 1 return + 1 settlement

  // 2. Without VAT View
  const statementWithoutVat = await getDistributorFinancialStatement({
    distributorId: "dist-1",
    withVat: false,
  });
  assert.equal(statementWithoutVat.vatMode, "WITHOUT_VAT");
  assert.equal(statementWithoutVat.summary.netPayableBalance, 170); // 270 - 100 = 170
});

test("7. submitDistributorSettlementRequest creates pending request and guards against exceeding balance", async (t) => {
  const mockDistributor = { id: "dist-1", name: "Kathmandu Hub", city: "Kathmandu", status: "ACTIVE", isActive: true };
  const delivered = [
    { id: "a-1", orderId: "o-1", status: "delivered", deliveredAt: new Date() },
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
  stubMethod(t, prisma.order, "findMany", async () => [{ id: "o-1", amount: 1000 }]);
  stubMethod(t, prisma.distributorSettlementRequest, "findMany", async () => []);
  stubMethod(t, prisma.distributorDeliveryChargeNegotiation, "findFirst", async () => mockRateCard);
  stubMethod(t, prisma.distributorSettlementRequest, "findFirst", async () => null);
  stubMethod(t, prisma.distributorSettlementRequest, "create", async ({ data }) => ({ id: "set-req-1", ...data }));

  // Available balance: 100 + 13% VAT = 113.00

  // 1. Success request within balance
  const res = await submitDistributorSettlementRequest({
    distributorId: "dist-1",
    amount: 100,
    notes: "Weekly payout request",
  });
  assert.equal(res.success, true);
  assert.equal(res.settlementRequest.amount, 100);
  assert.equal(res.settlementRequest.status, "PENDING");

  // 2. Excessive request throws error
  await assert.rejects(
    submitDistributorSettlementRequest({
      distributorId: "dist-1",
      amount: 500, // exceeds available 113.00
    }),
    { code: "INSUFFICIENT_SETTLEMENT_BALANCE" }
  );
});

test("8. executeAdminDistributorSettlement settles payout, records cash transaction and updates balances", async (t) => {
  const pendingSettlement = {
    id: "set-req-1",
    distributorId: "dist-1",
    amount: 100,
    status: "PENDING",
    distributor: { id: "dist-1", name: "Kathmandu Hub" },
  };
  const mockFinancialAccount = {
    id: "fa-1",
    accountName: "Nabil Bank Operating",
    currentBalance: 50000,
  };

  let cashTxCreated = false;
  let accountDeducted = false;

  stubMethod(t, prisma.distributorSettlementRequest, "findUnique", async () => pendingSettlement);
  stubMethod(t, prisma, "$transaction", async (cb) =>
    cb({
      financialAccount: {
        findUnique: async () => mockFinancialAccount,
        update: async () => {
          accountDeducted = true;
          return { ...mockFinancialAccount, currentBalance: 49900 };
        },
      },
      cashTransaction: {
        create: async () => {
          cashTxCreated = true;
          return { id: "ctx-1" };
        },
      },
      distributorSettlementRequest: {
        update: async ({ data }) => ({ ...pendingSettlement, ...data, status: "SETTLED" }),
      },
      systemAuditOutbox: { create: async () => ({ id: "audit-1" }) },
    })
  );

  const res = await executeAdminDistributorSettlement({
    settlementId: "set-req-1",
    amount: 100,
    financialAccountId: "fa-1",
    adminNotes: "Bank transfer processed successfully.",
    adminAccountId: "admin-1",
  });

  assert.equal(res.success, true);
  assert.equal(res.settlement.status, "SETTLED");
  assert.equal(accountDeducted, true);
  assert.equal(cashTxCreated, true);
});
