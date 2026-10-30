import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";

const KATHMANDU_OFFSET_MS = 345 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SELF_DELIVERY_STATUSES = [
  "on_hold",
  "package_details_complete",
  "ready_for_pickup",
  "Ready for Pickup",
  "dispatched",
  "Dispatched",
  "on_the_way",
  "On the Way",
  "out_for_delivery",
  "delivered",
  "Delivered",
  "returned",
  "Returned",
  "return_requested",
];

const serviceError = (message, statusCode = 400, code = "INVALID_DELIVERY_FILTER") =>
  Object.assign(new Error(message), { statusCode, code });

const parseNcmPrice = (value, label) => {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(raw)) {
    throw serviceError(`${label} must be a non-negative amount with no more than two decimal places.`, 400, "INVALID_NCM_PRICING");
  }
  return Number(raw);
};

const datePartsInKathmandu = (value) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const getPart = (name) => Number(parts.find((part) => part.type === name)?.value);
  return { year: getPart("year"), month: getPart("month"), day: getPart("day") };
};

const parseDateOnly = (value, fieldName) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) throw serviceError(`${fieldName} must use YYYY-MM-DD format.`);
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw serviceError(`${fieldName} must be a valid calendar date.`);
  }
  return date;
};

const kathmanduMidnight = (date) => new Date(date.getTime() - KATHMANDU_OFFSET_MS);

const shiftUtcCalendarDate = (date, dayCount) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + dayCount));

export const getKathmanduDateRange = ({
  range = "month",
  startDate,
  endDate,
  now = new Date(),
} = {}) => {
  const normalizedRange = String(range || "month").trim().toLowerCase();
  if (normalizedRange === "all") return null;

  let firstDate;
  let lastDateExclusive;
  if (normalizedRange === "custom") {
    if (!startDate || !endDate) {
      throw serviceError("Both startDate and endDate are required for a custom range.");
    }
    firstDate = parseDateOnly(startDate, "startDate");
    const lastDate = parseDateOnly(endDate, "endDate");
    if (firstDate.getTime() > lastDate.getTime()) {
      throw serviceError("startDate must not be later than endDate.");
    }
    lastDateExclusive = shiftUtcCalendarDate(lastDate, 1);
  } else {
    const current = datePartsInKathmandu(now);
    const currentDate = new Date(Date.UTC(current.year, current.month - 1, current.day));
    if (normalizedRange === "today") {
      firstDate = currentDate;
      lastDateExclusive = shiftUtcCalendarDate(currentDate, 1);
    } else if (normalizedRange === "week") {
      const daysSinceMonday = (currentDate.getUTCDay() + 6) % 7;
      firstDate = shiftUtcCalendarDate(currentDate, -daysSinceMonday);
      lastDateExclusive = shiftUtcCalendarDate(firstDate, 7);
    } else if (normalizedRange === "month") {
      firstDate = new Date(Date.UTC(current.year, current.month - 1, 1));
      lastDateExclusive = new Date(Date.UTC(current.year, current.month, 1));
    } else if (normalizedRange === "year") {
      firstDate = new Date(Date.UTC(current.year, 0, 1));
      lastDateExclusive = new Date(Date.UTC(current.year + 1, 0, 1));
    } else {
      throw serviceError("range must be today, week, month, year, all, or custom.");
    }
  }

  return {
    start: kathmanduMidnight(firstDate),
    endExclusive: kathmanduMidnight(lastDateExclusive),
  };
};

const getPagination = ({ page, limit } = {}) => {
  const parsedPage = page === undefined ? 1 : Number(page);
  const parsedLimit = limit === undefined ? 25 : Number(limit);
  if (!Number.isSafeInteger(parsedPage) || parsedPage < 1 || parsedPage > 100000) {
    throw serviceError("page must be an integer between 1 and 100000.");
  }
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
    throw serviceError("limit must be an integer between 1 and 100.");
  }
  return {
    page: parsedPage,
    limit: parsedLimit,
  };
};

const getDeliveryRange = (query) =>
  getKathmanduDateRange({
    range: query.range || "month",
    startDate: query.startDate,
    endDate: query.endDate,
  });

const getCustomerName = (user) =>
  user?.name ||
  [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
  null;

const getDeliveryLocation = (address) => {
  let parsedAddress = address;
  if (typeof address === "string") {
    try {
      parsedAddress = JSON.parse(address);
    } catch {
      return null;
    }
  }
  if (!parsedAddress || typeof parsedAddress !== "object" || Array.isArray(parsedAddress)) return null;
  return [
    parsedAddress.city,
    parsedAddress.municipality,
    parsedAddress.ward ? `Ward ${parsedAddress.ward}` : null,
    parsedAddress.district,
    parsedAddress.province,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join(", ") || null;
};

const addOrderDateFilter = (range) => {
  if (!range) return {};
  return {
    order: {
      is: {
        date: {
          gte: BigInt(range.start.getTime()),
          lt: BigInt(range.endExclusive.getTime()),
        },
      },
    },
  };
};

const getNcmStateFilter = (status) => {
  const value = String(status || "all").trim().toUpperCase();
  if (value === "ALL") return {};
  if (value === "COMPLETED") return { state: "DELIVERED" };
  if (value === "NEEDS_RECONCILIATION") return { ncmReconciliationRequired: true };
  if (value === "INCOMPLETE") {
    return { state: { notIn: ["DELIVERED", "RETURNED", "CANCELLED"] } };
  }
  if (value === "RETURNED") {
    return { OR: [{ state: "RETURNED" }, { returnedAt: { not: null } }] };
  }
  const allowed = [
    "READY_TO_DELIVER",
    "BOOKING_PENDING",
    "BOOKING_UNKNOWN",
    "BOOKING_FAILED",
    "BOOKED",
    "NCM_CREATED",
    "PICKUP_CONFIRMED",
    "IN_TRANSIT",
    "ARRIVED_AT_DESTINATION",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "RETURN_REQUESTED",
    "RETURNED",
    "CANCELLED",
  ];
  if (!allowed.includes(value)) throw serviceError("Unsupported NCM delivery status.");
  return { state: value };
};

const getSelfDeliveryStatusValues = (status) => {
  const value = String(status || "all").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "all") return SELF_DELIVERY_STATUSES;
  if (value === "completed" || value === "delivered") return ["delivered", "Delivered"];
  if (value === "returned") return ["returned", "Returned", "return_requested"];
  if (value === "incomplete") {
    return SELF_DELIVERY_STATUSES.filter(
      (item) => !["delivered", "Delivered", "returned", "Returned", "return_requested"].includes(item),
    );
  }
  const exact = SELF_DELIVERY_STATUSES.filter(
    (item) => item.toLowerCase().replace(/[\s-]+/g, "_") === value,
  );
  if (!exact.length) throw serviceError("Unsupported self-delivery status.");
  return exact;
};

const normalizeSearchText = (value) => String(value || "").trim().slice(0, 120);

export const listAdminNcmDeliveries = async (query = {}, client = prisma) => {
  const { page, limit } = getPagination(query);
  const range = getDeliveryRange(query);
  const search = normalizeSearchText(query.search);
  const reconciliationQueue = String(query.status || "").trim().toUpperCase() === "NEEDS_RECONCILIATION";
  const where = {
    ...getNcmStateFilter(query.status),
    ...(!reconciliationQueue && range
      ? { createdAt: { gte: range.start, lt: range.endExclusive } }
      : {}),
    ...(search
      ? {
          OR: [
            { orderId: { contains: search } },
            { vendorReference: { contains: search } },
            ...(Number.isSafeInteger(Number(search)) && Number(search) > 0
              ? [{ ncmOrderId: Number(search) }]
              : []),
          ],
        }
      : {}),
  };

  const [records, total] = await Promise.all([
    client.deliveryOrder.findMany({
      where,
      select: {
        id: true,
        orderId: true,
        ncmOrderId: true,
        state: true,
        ncmStatus: true,
        ncmReconciliationRequired: true,
        ncmReconciliationReason: true,
        originBranchName: true,
        destinationBranchName: true,
        createdAt: true,
        ncmCreatedAt: true,
        deliveredAt: true,
        returnedAt: true,
        order: {
          select: {
            id: true,
            userId: true,
            address: true,
            status: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    client.deliveryOrder.count({ where }),
  ]);
  const userIds = [...new Set(records.map((record) => record.order.userId).filter(Boolean))];
  const users = userIds.length
    ? await client.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, firstName: true, lastName: true },
      })
    : [];
  const usersById = new Map(users.map((user) => [user.id, user]));

  return {
    success: true,
    deliveries: records.map(({ order, ...record }) => ({
      ...record,
      customerName: getCustomerName(usersById.get(order.userId)),
      orderStatus: order.status,
      deliveryLocation: getDeliveryLocation(order.address),
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

export const getAdminNcmDeliveryDetails = async (deliveryId, client = prisma) => {
  const delivery = await client.deliveryOrder.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      orderId: true,
      assignmentId: true,
      manufacturerId: true,
      distributorId: true,
      state: true,
      deliveryType: true,
      packageWeight: true,
      packageDescription: true,
      originBranchName: true,
      destinationBranchName: true,
      itemAmount: true,
      customerDeliveryCharge: true,
      ncmDeliveryCharge: true,
      ncmDeliveryChargeBeforeDiscount: true,
      ncmDeliveryDiscount: true,
      codAmount: true,
      ncmOrderId: true,
      vendorReference: true,
      ncmStatus: true,
      ncmReconciliationRequired: true,
      ncmReconciliationReason: true,
      ncmPaymentStatus: true,
      lastSyncedAt: true,
      lastSyncError: true,
      readyAt: true,
      ncmCreatedAt: true,
      pickedUpAt: true,
      deliveredAt: true,
      returnedAt: true,
      createdAt: true,
      updatedAt: true,
      order: {
        select: {
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
          fulfillmentStatus: true,
        },
      },
      events: {
        select: {
          id: true,
          source: true,
          eventType: true,
          fromState: true,
          toState: true,
          ncmStatus: true,
          actorId: true,
          payloadJson: true,
          occurredAt: true,
        },
        orderBy: { occurredAt: "desc" },
        take: 100,
      },
    },
  });
  if (!delivery) return null;

  const [customer, returnRequests, exchanges, financialSettlement, distributorReview] = await Promise.all([
    client.user.findUnique({
      where: { id: delivery.order.userId },
      select: { id: true, name: true, firstName: true, lastName: true, phone: true },
    }),
    client.customerReturn.findMany({
      where: { orderId: delivery.orderId },
      select: {
        id: true,
        returnDate: true,
        lifecycleStatus: true,
        refundStatus: true,
        reason: true,
        originalNcmOrderId: true,
        ncmReturnOrderId: true,
        returnPickupStatus: true,
        returnPickupCompletedAt: true,
        manufacturerReceivedAt: true,
        inspectedAt: true,
        inspectionResult: true,
        completedAt: true,
        events: {
          select: { id: true, eventType: true, occurredAt: true, actorRole: true, reason: true },
          orderBy: { occurredAt: "desc" },
          take: 50,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    client.orderExchangeRequest.findMany({
      where: { orderId: delivery.orderId },
      select: {
        id: true,
        status: true,
        reasonCode: true,
        createdAt: true,
        decidedAt: true,
        returnPickupStatus: true,
        returnPickupCompletedAt: true,
        replacementStatus: true,
        replacementDeliveredAt: true,
        completedAt: true,
        ncmReturnOrderId: true,
        ncmReplacementOrderId: true,
        events: {
          select: { id: true, eventType: true, occurredAt: true, actorRole: true, reason: true },
          orderBy: { occurredAt: "desc" },
          take: 50,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    client.deliveryFinancialSettlement.findUnique({
      where: { deliveryOrderId: delivery.id },
      select: {
        id: true,
        codExpected: true,
        codCollected: true,
        deliveryFeeExpected: true,
        deliveryFeeActual: true,
        deliveryFeeDiscount: true,
        otherAdjustments: true,
        manufacturerPayable: true,
        platformReceivable: true,
        ncmTicketId: true,
        settlementState: true,
        settledAt: true,
        varianceReason: true,
      },
    }),
    client.distributorReview.findUnique({
      where: { orderId: delivery.orderId },
      select: { rating: true, comment: true, createdAt: true },
    }),
  ]);

  return {
    success: true,
    delivery: {
      ...delivery,
      customer: customer
        ? { ...customer, name: getCustomerName(customer) }
        : null,
      order: {
        ...delivery.order,
        date: delivery.order.date == null ? null : Number(delivery.order.date),
        createdAt: delivery.order.date == null ? null : Number(delivery.order.date),
      },
      returnRequests,
      exchanges,
      financialSettlement,
      distributorReview,
    },
  };
};

export const recordAdminNcmDeliveryPricing = async ({
    deliveryId,
    chargeBeforeDiscount,
    discountAmount,
    note,
    actorAccountId = null,
    client = prisma,
    writeAudit = recordSystemAudit,
  } = {}) => {
    if (typeof deliveryId !== "string" || !deliveryId.trim() || deliveryId.length > 191) {
      throw serviceError("A valid NCM delivery ID is required.", 400, "INVALID_DELIVERY_ID");
    }
    const gross = parseNcmPrice(chargeBeforeDiscount, "NCM delivery charge before discount");
    const discount = parseNcmPrice(discountAmount, "NCM delivery discount");
    const normalizedNote = String(note || "").trim();
    if (normalizedNote.length < 10 || normalizedNote.length > 1000) {
      throw serviceError("Add an evidence note between 10 and 1000 characters.", 400, "NCM_PRICING_NOTE_REQUIRED");
    }
    if (discount > gross) {
      throw serviceError("NCM discount cannot exceed the delivery charge before discount.", 400, "INVALID_NCM_PRICING");
    }
    const net = Number((gross - discount).toFixed(2));
    const execute = async (tx) => {
      const delivery = await tx.deliveryOrder.findUnique({
        where: { id: deliveryId },
        select: {
          id: true,
          orderId: true,
          ncmOrderId: true,
          customerDeliveryCharge: true,
        },
      });
      if (!delivery) throw serviceError("NCM delivery not found.", 404, "NCM_DELIVERY_NOT_FOUND");
      const settlement = await tx.deliveryFinancialSettlement.findUnique({
        where: { deliveryOrderId: delivery.id },
        select: { id: true, settlementState: true },
      });
      if (settlement?.settlementState === "SETTLED") {
        throw serviceError("Carrier pricing cannot be changed after its COD remittance has been settled.", 409, "NCM_SETTLEMENT_ALREADY_CLOSED");
      }

      const updatedDelivery = await tx.deliveryOrder.update({
        where: { id: delivery.id },
        data: {
          ncmDeliveryChargeBeforeDiscount: gross,
          ncmDeliveryDiscount: discount,
          ncmDeliveryCharge: net,
        },
        select: {
          id: true,
          orderId: true,
          customerDeliveryCharge: true,
          ncmDeliveryChargeBeforeDiscount: true,
          ncmDeliveryDiscount: true,
          ncmDeliveryCharge: true,
        },
      });
      if (settlement) {
        await tx.deliveryFinancialSettlement.update({
          where: { deliveryOrderId: delivery.id },
          data: {
            deliveryFeeActual: net,
            deliveryFeeDiscount: discount,
          },
        });
      }
      await tx.deliveryEvent.create({
        data: {
          deliveryOrderId: delivery.id,
          orderId: delivery.orderId,
          source: "ADMIN",
          eventType: "NCM_PRICING_RECORDED",
          ncmStatus: null,
          actorId: actorAccountId,
          payloadJson: {
            chargeBeforeDiscount: gross,
            discountAmount: discount,
            actualCharge: net,
            customerDeliveryCharge: Number(delivery.customerDeliveryCharge || 0),
            note: normalizedNote,
          },
          idempotencyKey: `NCM_PRICING_RECORDED:${delivery.id}:${randomUUID()}`,
        },
      });
      await writeAudit(
        { actorId: actorAccountId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "NCM_DELIVERY_PRICING_RECORDED",
          entityType: "DeliveryOrder",
          entityId: delivery.id,
          beforeState: {},
          afterState: {
            chargeBeforeDiscount: gross,
            discountAmount: discount,
            actualCharge: net,
            customerDeliveryCharge: Number(delivery.customerDeliveryCharge || 0),
            note: normalizedNote,
          },
        },
        { client: tx },
      );
      return {
        success: true,
        pricing: updatedDelivery,
        message: "NCM carrier charge and discount recorded. The customer delivery charge was not changed.",
      };
    };
    return typeof client.$transaction === "function"
      ? client.$transaction(execute, { isolationLevel: "Serializable" })
      : execute(client);
};

const buildSelfDeliveryWhere = ({ distributorId, range, statuses, search }) => {
  const conditions = [
    Prisma.sql`a.\`deliveryType\` = ${"SELF_DELIVERY"}`,
    Prisma.sql`a.\`distributorId\` IS NOT NULL`,
    Prisma.sql`a.\`status\` IN (${Prisma.join(statuses)})`,
    Prisma.sql`NOT EXISTS (SELECT 1 FROM \`DeliveryOrder\` ncm WHERE ncm.\`orderId\` = a.\`orderId\`)`,
  ];
  if (distributorId) conditions.push(Prisma.sql`a.\`distributorId\` = ${distributorId}`);
  if (range) {
    conditions.push(Prisma.sql`o.\`date\` >= ${BigInt(range.start.getTime())}`);
    conditions.push(Prisma.sql`o.\`date\` < ${BigInt(range.endExclusive.getTime())}`);
  }
  if (search) {
    const like = `%${search}%`;
    conditions.push(Prisma.sql`(
      o.\`id\` LIKE ${like}
      OR d.\`name\` LIKE ${like}
      OR u.\`name\` LIKE ${like}
      OR CAST(o.\`address\` AS CHAR) LIKE ${like}
    )`);
  }
  return Prisma.join(conditions, " AND ");
};

export const listAdminSelfDeliveries = async (query = {}, client = prisma) => {
  const { page, limit } = getPagination(query);
  const range = getDeliveryRange(query);
  const distributorId = String(query.distributorId || "").trim();
  if (distributorId.length > 64) throw serviceError("distributorId is invalid.");
  const statuses = getSelfDeliveryStatusValues(query.status);
  const where = buildSelfDeliveryWhere({
    distributorId,
    range,
    statuses,
    search: normalizeSearchText(query.search),
  });
  const [records, countRows] = await Promise.all([
    client.$queryRaw(Prisma.sql`
      SELECT
        a.\`id\` AS assignmentId,
        a.\`orderId\` AS orderId,
        a.\`status\` AS status,
        a.\`assignedAt\` AS assignedAt,
        a.\`dispatchedAt\` AS dispatchedAt,
        a.\`deliveredAt\` AS deliveredAt,
        a.\`returnedAt\` AS returnedAt,
        CAST(o.\`date\` AS CHAR) AS createdAt,
        o.\`status\` AS orderStatus,
        o.\`address\` AS address,
        u.\`name\` AS customerName,
        d.\`id\` AS distributorId,
        d.\`name\` AS distributorName,
        d.\`province\` AS distributorProvince,
        d.\`district\` AS distributorDistrict,
        d.\`qualityRating\` AS distributorRating,
        d.\`ratingCount\` AS distributorRatingCount,
        review.\`rating\` AS orderRating
      FROM \`OrderAssignment\` a
      INNER JOIN \`Order\` o ON o.\`id\` = a.\`orderId\`
      INNER JOIN \`Distributor\` d ON d.\`id\` = a.\`distributorId\`
      LEFT JOIN \`User\` u ON u.\`id\` = o.\`userId\`
      LEFT JOIN \`DistributorReview\` review ON review.\`orderId\` = o.\`id\`
      WHERE ${where}
      ORDER BY o.\`date\` DESC, a.\`assignedAt\` DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `),
    client.$queryRaw(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM \`OrderAssignment\` a
      INNER JOIN \`Order\` o ON o.\`id\` = a.\`orderId\`
      INNER JOIN \`Distributor\` d ON d.\`id\` = a.\`distributorId\`
      LEFT JOIN \`User\` u ON u.\`id\` = o.\`userId\`
      WHERE ${where}
    `),
  ]);
  const total = Number(countRows[0]?.total || 0);
  return {
    success: true,
    deliveries: records.map(({ address, ...record }) => ({
      ...record,
      createdAt: record.createdAt == null ? null : Number(record.createdAt),
      distributorRating: Number(record.distributorRating || 0),
      distributorRatingCount: Number(record.distributorRatingCount || 0),
      orderRating: record.orderRating == null ? null : Number(record.orderRating),
      deliveryLocation: getDeliveryLocation(address),
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

export const listAdminSelfDeliveryDistributors = async (query = {}, client = prisma) => {
  const { page, limit } = getPagination({ page: query.page, limit: query.limit || 100 });
  const search = normalizeSearchText(query.search);
  const where = {
    assignments: { some: { deliveryType: "SELF_DELIVERY" } },
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { district: { contains: search } },
            { province: { contains: search } },
          ],
        }
      : {}),
  };
  const [distributors, total] = await Promise.all([
    client.distributor.findMany({
      where,
      select: { id: true, name: true, province: true, district: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    client.distributor.count({ where }),
  ]);
  return {
    success: true,
    distributors,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

export const getAdminSelfDeliveryDetails = async (assignmentId, client = prisma) => {
  const assignment = await client.orderAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      orderId: true,
      distributorId: true,
      deliveryType: true,
      status: true,
      assignedAt: true,
      acceptedAt: true,
      dispatchedAt: true,
      onTheWayAt: true,
      deliveredAt: true,
      returnedAt: true,
      notes: true,
    },
  });
  if (!assignment || assignment.deliveryType?.toUpperCase() !== "SELF_DELIVERY" || !assignment.distributorId) {
    return null;
  }
  const ncmDelivery = await client.deliveryOrder.findUnique({
    where: { orderId: assignment.orderId },
    select: { id: true },
  });
  if (ncmDelivery) return null;

  const [order, distributor, returnRequests, exchanges, distributorReview] = await Promise.all([
    client.order.findUnique({
      where: { id: assignment.orderId },
      select: {
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
        fulfillmentStatus: true,
      },
    }),
    client.distributor.findUnique({
      where: { id: assignment.distributorId },
      select: {
        id: true,
        name: true,
        province: true,
        district: true,
        city: true,
        qualityRating: true,
        ratingCount: true,
      },
    }),
    client.customerReturn.findMany({
      where: { orderId: assignment.orderId },
      select: {
        id: true,
        returnDate: true,
        lifecycleStatus: true,
        refundStatus: true,
        reason: true,
        completedAt: true,
        events: {
          select: { id: true, eventType: true, occurredAt: true, actorRole: true, reason: true },
          orderBy: { occurredAt: "desc" },
          take: 50,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    client.orderExchangeRequest.findMany({
      where: { orderId: assignment.orderId },
      select: {
        id: true,
        status: true,
        reasonCode: true,
        createdAt: true,
        decidedAt: true,
        returnPickupStatus: true,
        returnPickupCompletedAt: true,
        replacementStatus: true,
        replacementDeliveredAt: true,
        completedAt: true,
        events: {
          select: { id: true, eventType: true, occurredAt: true, actorRole: true, reason: true },
          orderBy: { occurredAt: "desc" },
          take: 50,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    client.distributorReview.findUnique({
      where: { orderId: assignment.orderId },
      select: { rating: true, comment: true, createdAt: true },
    }),
  ]);
  if (!order) return null;
  const customer = await client.user.findUnique({
    where: { id: order.userId },
    select: { id: true, name: true, firstName: true, lastName: true, phone: true },
  });

  return {
    success: true,
    delivery: {
      ...assignment,
      order: {
        ...order,
        date: order.date == null ? null : Number(order.date),
        createdAt: order.date == null ? null : Number(order.date),
      },
      customer: customer
        ? { ...customer, name: getCustomerName(customer) }
        : null,
      distributor,
      returnRequests,
      exchanges,
      distributorReview,
    },
  };
};
