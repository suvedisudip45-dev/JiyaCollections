import { prisma } from "../config/db.js";

const ORDER_CONTROL_SELECT = {
  id: true,
  userId: true,
  items: true,
  amount: true,
  deliveryFee: true,
  address: true,
  status: true,
  paymentMethod: true,
  payment: true,
  date: true,
  checkoutGroupId: true,
  updatedAt: true,
  loyaltyDiscount: true,
  rewardApplied: true,
  fulfillmentStatus: true,
  assignmentId: true,
  orderType: true,
  directOrderType: true,
  distributorId: true,
  manufacturerId: true,
  cancelledAt: true,
  cancellationReason: true,
  assignedGiftId: true,
  giftStatus: true,
  assignedGift: { select: { id: true, name: true, sku: true, priceValue: true } },
  deliveryOrder: {
    select: {
      id: true,
      state: true,
      deliveryType: true,
      packageVersion: true,
      packageWeight: true,
      packageDescription: true,
      originBranchName: true,
      destinationBranchName: true,
      itemAmount: true,
      customerDeliveryCharge: true,
      ncmDeliveryCharge: true,
      codAmount: true,
      ncmOrderId: true,
      vendorReference: true,
      ncmStatus: true,
      ncmPaymentStatus: true,
      ncmReconciliationRequired: true,
      ncmReconciliationReason: true,
      pickedUpAt: true,
      deliveredAt: true,
      returnedAt: true,
      updatedAt: true,
      events: {
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 30,
        select: {
          id: true,
          source: true,
          eventType: true,
          fromState: true,
          toState: true,
          ncmStatus: true,
          actorId: true,
          occurredAt: true,
        },
      },
    },
  },
  distributorCashEvents: {
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 20,
    select: {
      id: true,
      eventType: true,
      amount: true,
      status: true,
      occurredAt: true,
      accountingDocumentId: true,
      journalEntryId: true,
    },
  },
};

const serializeOrder = (order) => ({
  ...order,
  date: Number(order.date),
  items: Array.isArray(order.items) ? order.items : [],
  address: order.address && typeof order.address === "object" ? order.address : {},
});

export const getAdminOrderControlDetails = async (orderId, { client = prisma } = {}) => {
  const order = await client.order.findUnique({
    where: { id: orderId },
    select: ORDER_CONTROL_SELECT,
  });
  if (!order) return null;

  const [audit, checkoutShipments, ncmAttempts] = await Promise.all([
    client.systemAuditLog.findMany({
      where: { entityType: "Order", entityId: orderId, status: "SUCCESS" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        actorId: true,
        actorRole: true,
        action: true,
        beforeState: true,
        afterState: true,
        createdAt: true,
        correlationId: true,
      },
    }),
    order.checkoutGroupId
      ? client.order.findMany({
          where: { checkoutGroupId: order.checkoutGroupId },
          orderBy: [{ date: "asc" }, { id: "asc" }],
          take: 50,
          select: {
            id: true,
            amount: true,
            deliveryFee: true,
            status: true,
            fulfillmentStatus: true,
            payment: true,
            deliveryOrder: { select: { state: true, ncmOrderId: true, ncmStatus: true } },
          },
        })
      : Promise.resolve([]),
    order.deliveryOrder
      ? client.ncmRequestAttempt.findMany({
          where: { deliveryOrderId: order.deliveryOrder.id },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: 10,
          select: {
            id: true,
            operation: true,
            attemptNumber: true,
            httpStatus: true,
            result: true,
            errorCode: true,
            startedAt: true,
            finishedAt: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const shipmentOrderIds = checkoutShipments.length ? checkoutShipments.map(({ id }) => id) : [orderId];
  const assignments = await client.orderAssignment.findMany({
    where: { orderId: { in: shipmentOrderIds } },
    select: {
      id: true,
      orderId: true,
      distributorId: true,
      manufacturerId: true,
      deliveryType: true,
      status: true,
      notes: true,
      assignedAt: true,
      acceptedAt: true,
      dispatchedAt: true,
      onTheWayAt: true,
      manufacturingAt: true,
      qualityCheckAt: true,
      packedAt: true,
      readyAt: true,
      pickedUpAt: true,
      deliveredAt: true,
      returnedAt: true,
      rejectionReason: true,
      distributor: { select: { id: true, name: true, province: true, district: true, phone: true } },
      manufacturer: { select: { id: true, name: true, city: true, phone: true } },
    },
  });
  const assignmentByOrderId = new Map(assignments.map((entry) => [entry.orderId, entry]));
  const assignment = assignmentByOrderId.get(orderId) || null;

  return {
    order: { ...serializeOrder(order), orderAssignment: assignment },
    checkoutShipments: checkoutShipments.map((shipment) => {
      const shipmentAssignment = assignmentByOrderId.get(shipment.id) || null;
      return {
        ...shipment,
        currentShipment: shipment.id === order.id,
        orderAssignment: shipmentAssignment
          ? {
              id: shipmentAssignment.id,
              status: shipmentAssignment.status,
              deliveryType: shipmentAssignment.deliveryType,
              distributor: shipmentAssignment.distributor,
            }
          : null,
        distributor: shipmentAssignment?.distributor || null,
      };
    }),
    deliveryAttempts: ncmAttempts,
    audit,
  };
};
