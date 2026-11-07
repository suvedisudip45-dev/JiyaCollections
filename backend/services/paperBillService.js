import { randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";

const fail = (message, statusCode = 400, code = "PAPER_BILL_ERROR") =>
  Object.assign(new Error(message), { statusCode, code });

const parsePositiveInteger = (value, label) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    throw fail(`${label} must be a positive whole number.`, 400, "INVALID_PAPER_BILL_RANGE");
  }
  return parsed;
};

const formatNumber = (prefix, serial, width) =>
  `${prefix}${String(serial).padStart(width || 0, "0")}`;

const ISSUED_PAPER_BILL_STATUSES = new Set([
  "ISSUED",
  "VOIDED",
  "CREDITED",
  "PARTIALLY_CREDITED",
]);

const classifyPaperBill = (assignment) => {
  const isIssued = Boolean(
    assignment?.paperBillNumber &&
    ISSUED_PAPER_BILL_STATUSES.has(String(assignment.paperBillStatus || "").toUpperCase()) &&
    ["VAT_TAX_INVOICE", "PAN_BILL"].includes(assignment.paperBillDocumentType)
  );
  if (!isIssued) return "NO_BILL";
  return assignment.paperBillDocumentType === "VAT_TAX_INVOICE" ? "VAT_BILL" : "PAN_BILL";
};

const parsePeriodDate = (value, endOfDay = false) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = value.split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) return null;
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}+05:45`);
};

export const validatePaperBillChoice = async ({
  client,
  distributorId,
  documentType,
  billNumber,
  assignmentId,
  exchangeRequestId,
} = {}) => {
  const externalNumber = String(billNumber || "").trim();
  if (!externalNumber || externalNumber.length > 191) {
    throw fail("Enter the physical bill number from the book allocated to this distributor.", 400, "PAPER_BILL_NUMBER_REQUIRED");
  }
  const allocations = await client.paperBillBookAllocation.findMany({
    where: { distributorId, status: "ACTIVE", book: { is: { documentType, status: "ACTIVE" } } },
    include: { book: true },
  });
  const match = allocations.find(({ book, startNumber, endNumber }) => {
    if (!externalNumber.startsWith(book.seriesPrefix)) return false;
    const serialText = externalNumber.slice(book.seriesPrefix.length);
    if (!/^\d+$/.test(serialText)) return false;
    if (book.serialWidth > 0 && serialText.length !== book.serialWidth) return false;
    const serial = Number(serialText);
    return Number.isSafeInteger(serial) && serial >= startNumber && serial <= endNumber &&
      formatNumber(book.seriesPrefix, serial, book.serialWidth) === externalNumber;
  });
  if (!match) {
    throw fail(
      `The bill number is not inside an active ${documentType === "VAT_TAX_INVOICE" ? "VAT invoice" : "PAN bill"} range allocated to this distributor.`,
      409,
      "PAPER_BILL_NUMBER_OUTSIDE_ALLOCATION",
    );
  }
  const [usedAssignment, usedInvoice, usedExchange] = await Promise.all([
    client.orderAssignment.findFirst({
      where: { paperBillNumber: externalNumber, ...(assignmentId ? { id: { not: assignmentId } } : {}) },
      select: { id: true },
    }),
    client.salesInvoice.findFirst({
      where: { invoiceNumber: externalNumber },
      select: { id: true },
    }),
    client.orderExchangeRequest.findFirst({
      where: {
        replacementPaperBillNumber: externalNumber,
        ...(exchangeRequestId ? { id: { not: exchangeRequestId } } : {}),
      },
      select: { id: true },
    }),
  ]);
  if (usedAssignment || usedInvoice || usedExchange) {
    throw fail("This physical bill number is already recorded against another order.", 409, "PAPER_BILL_NUMBER_ALREADY_USED");
  }
  return {
    paperBillAllocationId: match.id,
    paperBillNumber: externalNumber,
    paperBillDocumentType: documentType,
  };
};

export const listPaperBillControlData = async ({ client = prisma } = {}) => {
  const [books, distributors] = await Promise.all([
    client.paperBillBook.findMany({
      include: {
        allocations: {
          include: {
            distributor: { select: { id: true, name: true, status: true } },
            _count: { select: { assignments: true } },
          },
          orderBy: { allocatedAt: "desc" },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    }),
    client.distributor.findMany({
      where: { status: "ACTIVE", isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { books, distributors };
};

export const listDistributorPaperBillAllocations = async ({
  distributorId,
  client = prisma,
} = {}) => {
  if (!distributorId) throw fail("An approved distributor profile is required.", 403, "DISTRIBUTOR_REQUIRED");
  return client.paperBillBookAllocation.findMany({
    where: {
      distributorId,
      status: { in: ["PENDING_ACCEPTANCE", "ACTIVE"] },
      book: { is: { status: "ACTIVE" } },
    },
    include: { book: true },
    orderBy: [{ status: "asc" }, { allocatedAt: "desc" }],
  });
};

export const acceptDistributorPaperBillAllocation = async ({
  id,
  distributorId,
  acceptedBy = null,
  afterAccept = null,
  client = prisma,
} = {}) => {
  if (!id || !distributorId) {
    throw fail("A bill allocation and approved distributor profile are required.", 400, "PAPER_BILL_ALLOCATION_REQUIRED");
  }
  return client.$transaction(async (tx) => {
    const allocation = await tx.paperBillBookAllocation.findUnique({
      where: { id: String(id) },
      include: { book: true },
    });
    if (!allocation || allocation.distributorId !== distributorId) {
      throw fail("Bill allocation not found for this distributor.", 404, "PAPER_BILL_ALLOCATION_NOT_FOUND");
    }
    if (allocation.status === "ACTIVE" && allocation.acceptedAt) return allocation;
    if (allocation.status !== "PENDING_ACCEPTANCE") {
      throw fail("Only a pending bill allocation can be accepted.", 409, "PAPER_BILL_ALLOCATION_NOT_PENDING");
    }
    const acceptedAt = new Date();
    const updated = await tx.paperBillBookAllocation.updateMany({
      where: {
        id: allocation.id,
        distributorId,
        status: "PENDING_ACCEPTANCE",
      },
      data: {
        status: "ACTIVE",
        acceptedAt,
        acceptedBy: acceptedBy ? String(acceptedBy).slice(0, 191) : null,
      },
    });
    if (updated.count !== 1) {
      throw fail("This bill allocation has already been updated. Refresh and check its status.", 409, "PAPER_BILL_ALLOCATION_ALREADY_UPDATED");
    }
    const accepted = await tx.paperBillBookAllocation.findUnique({
      where: { id: allocation.id },
      include: { book: true },
    });
    if (afterAccept) await afterAccept(accepted, tx);
    return accepted;
  }, { isolationLevel: "Serializable" });
};

export const createPaperBillBook = async ({
  documentType,
  bookLabel,
  seriesPrefix,
  startNumber,
  endNumber,
  serialWidth = 0,
  createdBy = null,
  afterCreate = null,
  client = prisma,
} = {}) => {
  const type = String(documentType || "").trim().toUpperCase();
  const label = String(bookLabel || "").trim();
  const prefix = String(seriesPrefix || "").trim();
  const start = parsePositiveInteger(startNumber, "Starting bill number");
  const end = parsePositiveInteger(endNumber, "Ending bill number");
  const width = Number(serialWidth);
  if (!["VAT_TAX_INVOICE", "PAN_BILL"].includes(type)) {
    throw fail("Choose a VAT tax invoice book or PAN bill book.", 400, "INVALID_PAPER_BILL_TYPE");
  }
  if (!label || label.length > 120 || !prefix || prefix.length > 60 || /[\r\n]/.test(prefix)) {
    throw fail("Enter a book label and a valid series prefix.", 400, "INVALID_PAPER_BILL_BOOK");
  }
  if (end < start || !Number.isInteger(width) || width < 0 || width > 10 ||
      (width > 0 && String(end).length > width)) {
    throw fail("Enter a valid range and a serial width between 0 and 10.", 400, "INVALID_PAPER_BILL_RANGE");
  }
  return client.$transaction(async (tx) => {
    const overlaps = await tx.paperBillBook.findFirst({
      where: {
        seriesPrefix: prefix,
        startNumber: { lte: end },
        endNumber: { gte: start },
      },
      select: { id: true },
    });
    if (overlaps) throw fail("This bill-number range overlaps a book already recorded for the same series.", 409, "PAPER_BILL_BOOK_RANGE_OVERLAP");
    const record = await tx.paperBillBook.create({
      data: {
        id: randomUUID(),
        documentType: type,
        bookLabel: label,
        seriesPrefix: prefix,
        startNumber: start,
        endNumber: end,
        serialWidth: width,
        createdBy: createdBy ? String(createdBy).slice(0, 191) : null,
      },
    });
    if (afterCreate) await afterCreate(record, tx);
    return record;
  }, { isolationLevel: "Serializable" });
};

export const allocatePaperBillRange = async ({
  bookId,
  distributorId,
  startNumber,
  endNumber,
  allocatedBy = null,
  notes = "",
  afterAllocate = null,
  client = prisma,
} = {}) => {
  const start = parsePositiveInteger(startNumber, "Allocation start");
  const end = parsePositiveInteger(endNumber, "Allocation end");
  const note = String(notes || "").trim();
  if (end < start || note.length > 500) throw fail("Enter a valid allocation range and note.", 400, "INVALID_PAPER_BILL_ALLOCATION");
  return client.$transaction(async (tx) => {
    const book = await tx.paperBillBook.findUnique({ where: { id: String(bookId || "") } });
    if (!book || book.status !== "ACTIVE") throw fail("An active paper bill book is required.", 404, "PAPER_BILL_BOOK_NOT_FOUND");
    const distributor = await tx.distributor.findFirst({
      where: { id: String(distributorId || ""), status: "ACTIVE", isActive: true },
      select: { id: true },
    });
    if (!distributor) throw fail("Choose an active distributor.", 404, "PAPER_BILL_DISTRIBUTOR_NOT_FOUND");
    if (start < book.startNumber || end > book.endNumber) {
      throw fail("Allocation must stay inside the registered book range.", 400, "PAPER_BILL_ALLOCATION_OUTSIDE_BOOK");
    }
    const overlaps = await tx.paperBillBookAllocation.findFirst({
      where: { bookId: book.id, startNumber: { lte: end }, endNumber: { gte: start } },
      select: { id: true },
    });
    if (overlaps) throw fail("This range has already been allocated or returned; bill numbers cannot be reused.", 409, "PAPER_BILL_ALLOCATION_OVERLAP");
    const record = await tx.paperBillBookAllocation.create({
      data: {
        id: randomUUID(),
        bookId: book.id,
        distributorId: distributor.id,
        startNumber: start,
        endNumber: end,
        status: "PENDING_ACCEPTANCE",
        allocatedBy: allocatedBy ? String(allocatedBy).slice(0, 191) : null,
        notes: note || null,
      },
      include: { book: true, distributor: { select: { id: true, name: true } } },
    });
    if (afterAllocate) await afterAllocate(record, tx);
    return record;
  }, { isolationLevel: "Serializable" });
};

export const returnPaperBillAllocation = async ({
  id,
  returnedBy = null,
  afterReturn = null,
  client = prisma,
} = {}) => client.$transaction(async (tx) => {
  const allocation = await tx.paperBillBookAllocation.findUnique({ where: { id: String(id || "") } });
  if (!allocation || !["ACTIVE", "PENDING_ACCEPTANCE"].includes(allocation.status)) {
    throw fail("Active bill-book allocation not found.", 404, "PAPER_BILL_ALLOCATION_NOT_FOUND");
  }
  const updated = await tx.paperBillBookAllocation.update({
    where: { id: allocation.id },
    data: {
      status: "RETURNED",
      returnedAt: new Date(),
      returnedBy: returnedBy ? String(returnedBy).slice(0, 191) : null,
    },
  });
  if (afterReturn) await afterReturn(updated, tx);
  return updated;
}, { isolationLevel: "Serializable" });

export const listPaperBillOrderReport = async ({
  from,
  to,
  billFilter = "ALL",
  page = 1,
  limit = 100,
  client = prisma,
} = {}) => {
  const start = parsePeriodDate(from);
  const end = parsePeriodDate(to, true);
  if (!start || !end || end < start) {
    throw fail("Select a valid inclusive order date range.", 400, "INVALID_PAPER_BILL_REPORT_PERIOD");
  }
  const normalizedFilter = String(billFilter || "ALL").toUpperCase();
  const filterAliases = {
    WITH_VAT_BILL: "VAT_BILL",
    WITHOUT_VAT_BILL: "NO_VAT_BILL",
  };
  const effectiveFilter = filterAliases[normalizedFilter] || normalizedFilter;
  if (!["ALL", "VAT_BILL", "PAN_BILL", "NO_BILL", "VOIDED", "NO_VAT_BILL"].includes(effectiveFilter)) {
    throw fail("Choose all orders, VAT bills, PAN bills, orders without a bill, or voided bills.", 400, "INVALID_PAPER_BILL_REPORT_FILTER");
  }
  const currentPage = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(250, Math.max(1, Number(limit) || 100));
  const orderWhere = { date: { gte: BigInt(start.getTime()), lte: BigInt(end.getTime()) } };
  const orderSelect = {
    id: true,
    orderReference: true,
    date: true,
    amount: true,
    status: true,
    orderType: true,
    address: true,
    salesInvoice: {
      select: {
        id: true,
        invoiceNumber: true,
        documentType: true,
        status: true,
        issueDate: true,
        adjustments: {
          select: {
            id: true,
            sourceType: true,
            adjustmentType: true,
            status: true,
            amount: true,
            vatAmount: true,
            externalDocumentNumber: true,
            occurredAt: true,
          },
          orderBy: { occurredAt: "desc" },
        },
      },
    },
  };
  const skip = (currentPage - 1) * pageSize;
  const records = [];
  let total = 0;
  let batchSkip = 0;
  const batchSize = 500;
  while (true) {
    const orders = await client.order.findMany({
      where: orderWhere,
      select: orderSelect,
      orderBy: { date: "desc" },
      skip: batchSkip,
      take: batchSize,
    });
    if (!orders.length) break;
    const orderIds = orders.map(({ id }) => id);
    const [assignments, returns, exchanges] = await Promise.all([
      client.orderAssignment.findMany({
        where: { orderId: { in: orderIds } },
        include: {
          distributor: { select: { id: true, name: true } },
          paperBillAllocation: { include: { book: { select: { seriesPrefix: true, documentType: true } } } },
        },
      }),
      client.customerReturn.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true, orderId: true, lifecycleStatus: true, taxCreditNoteNumber: true, approvedRefundAmount: true, vatRefunded: true, completedAt: true },
      }),
      client.orderExchangeRequest.findMany({
        where: { orderId: { in: orderIds }, status: "COMPLETED" },
        select: {
          id: true,
          orderId: true,
          taxCreditNoteNumber: true,
          priceDifference: true,
          replacementPaperBillNumber: true,
          replacementPaperBillIssuedAt: true,
          completedAt: true,
        },
      }),
    ]);
    const assignmentsByOrder = new Map(assignments.map((assignment) => [assignment.orderId, assignment]));
    const returnsByOrder = new Map();
    for (const record of returns) {
      const list = returnsByOrder.get(record.orderId) || [];
      list.push(record);
      returnsByOrder.set(record.orderId, list);
    }
    const exchangesByOrder = new Map();
    for (const record of exchanges) {
      const list = exchangesByOrder.get(record.orderId) || [];
      list.push(record);
      exchangesByOrder.set(record.orderId, list);
    }
    for (const order of orders) {
      const assignment = assignmentsByOrder.get(order.id);
      const billClassification = classifyPaperBill(assignment);
      if (effectiveFilter === "VAT_BILL" && billClassification !== "VAT_BILL") continue;
      if (effectiveFilter === "PAN_BILL" && billClassification !== "PAN_BILL") continue;
      if (effectiveFilter === "NO_BILL" && billClassification !== "NO_BILL") continue;
      if (effectiveFilter === "VOIDED" && assignment?.paperBillStatus !== "VOIDED") continue;
      if (effectiveFilter === "NO_VAT_BILL" && billClassification === "VAT_BILL") continue;
      const isBillIssued = billClassification !== "NO_BILL";
      const hasVatBill = billClassification === "VAT_BILL";
      if (total >= skip && records.length < pageSize) {
        records.push({
          orderId: order.id,
          orderReference: order.orderReference,
          orderDate: new Date(Number(order.date)).toISOString(),
          orderStatus: order.status,
          orderType: order.orderType || null,
          amount: Number(order.amount || 0),
          customerName: String(order.address?.name || `${order.address?.firstName || ""} ${order.address?.lastName || ""}`).trim(),
          distributor: assignment?.distributor || null,
          assignmentStatus: assignment?.status || null,
          billRequested: assignment?.paperBillRequested || false,
          billStatus: assignment?.paperBillStatus || "NOT_SELECTED",
          billType: assignment?.paperBillDocumentType || null,
          billNumber: assignment?.paperBillNumber || null,
          billIssuedAt: assignment?.paperBillIssuedAt || null,
          billVoidedAt: assignment?.paperBillVoidedAt || null,
          billVoidReason: assignment?.paperBillVoidReason || null,
          billAdjustedAt: assignment?.paperBillAdjustedAt || null,
          billAdjustmentReason: assignment?.paperBillAdjustmentReason || null,
          billClassification,
          billIssued: isBillIssued,
          allocation: assignment?.paperBillAllocation ? {
            bookPrefix: assignment.paperBillAllocation.book.seriesPrefix,
            rangeStart: assignment.paperBillAllocation.startNumber,
            rangeEnd: assignment.paperBillAllocation.endNumber,
          } : null,
          salesInvoice: order.salesInvoice,
          returns: returnsByOrder.get(order.id) || [],
          exchanges: exchangesByOrder.get(order.id) || [],
          hasVatBill,
        });
      }
      total += 1;
    }
    batchSkip += orders.length;
    if (orders.length < batchSize) break;
  }
  return {
    records,
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
};

export const parsePaperBillSerial = ({ billNumber, seriesPrefix, serialWidth = 0 } = {}) => {
  const value = String(billNumber || "").trim();
  if (!value.startsWith(seriesPrefix)) return null;
  const suffix = value.slice(seriesPrefix.length);
  if (!/^\d+$/.test(suffix) || (serialWidth > 0 && suffix.length !== serialWidth)) return null;
  const serial = Number(suffix);
  return Number.isSafeInteger(serial) && formatNumber(seriesPrefix, serial, serialWidth) === value
    ? serial
    : null;
};
