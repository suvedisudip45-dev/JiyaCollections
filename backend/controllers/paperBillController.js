import { recordSystemAudit } from "../services/auditService.js";
import {
  allocatePaperBillRange,
  acceptDistributorPaperBillAllocation,
  createPaperBillBook,
  listDistributorPaperBillAllocations,
  listPaperBillControlData,
  listPaperBillOrderReport,
  returnPaperBillAllocation,
} from "../services/paperBillService.js";
import { resolveCalendarDateRangeInput } from "../services/nepaliFiscalCalendar.js";

const responseError = (res, error, fallbackMessage) => {
  console.error(fallbackMessage, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || fallbackMessage,
    code: error.code || "PAPER_BILL_ERROR",
  });
};

const actorId = (req) => req.auth?.accountId || req.auth?.userId || null;

export const getDistributorPaperBillAllocations = async (req, res) => {
  try {
    const allocations = await listDistributorPaperBillAllocations({
      distributorId: req.distributorId,
    });
    return res.status(200).json({ success: true, allocations });
  } catch (error) {
    return responseError(res, error, "Allocated bill ranges could not be loaded.");
  }
};

export const acceptDistributorPaperBillAllocationController = async (req, res) => {
  try {
    const record = await acceptDistributorPaperBillAllocation({
      id: req.params.id,
      distributorId: req.distributorId,
      acceptedBy: actorId(req),
      afterAccept: (accepted, tx) => recordSystemAudit(
        { actorId: actorId(req), actorRole: "DISTRIBUTOR", portalSource: "DISTRIBUTOR" },
        {
          action: "PAPER_BILL_RANGE_ACCEPTED",
          entityType: "PaperBillBookAllocation",
          entityId: accepted.id,
          afterState: {
            distributorId: accepted.distributorId,
            bookId: accepted.bookId,
            startNumber: accepted.startNumber,
            endNumber: accepted.endNumber,
            acceptedAt: accepted.acceptedAt,
          },
        },
        { client: tx },
      ),
    });
    return res.status(200).json({
      success: true,
      message: "Physical bill range accepted and ready for use.",
      record,
    });
  } catch (error) {
    return responseError(res, error, "Bill range could not be accepted.");
  }
};

export const getPaperBillControlDataAdmin = async (_req, res) => {
  try {
    const data = await listPaperBillControlData();
    return res.status(200).json({ success: true, ...data });
  } catch (error) {
    return responseError(res, error, "Paper bill books could not be loaded.");
  }
};

export const createPaperBillBookAdmin = async (req, res) => {
  try {
    const record = await createPaperBillBook({
      ...req.body,
      createdBy: actorId(req),
      afterCreate: (created, tx) => recordSystemAudit(
        { actorId: actorId(req), actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "PAPER_BILL_BOOK_CREATED",
          entityType: "PaperBillBook",
          entityId: created.id,
          afterState: {
            documentType: created.documentType,
            bookLabel: created.bookLabel,
            seriesPrefix: created.seriesPrefix,
            startNumber: created.startNumber,
            endNumber: created.endNumber,
          },
        },
        { client: tx },
      ),
    });
    return res.status(201).json({ success: true, message: "Paper bill book recorded.", record });
  } catch (error) {
    return responseError(res, error, "Paper bill book could not be recorded.");
  }
};

export const allocatePaperBillRangeAdmin = async (req, res) => {
  try {
    const record = await allocatePaperBillRange({
      ...req.body,
      allocatedBy: actorId(req),
      afterAllocate: (allocated, tx) => recordSystemAudit(
        { actorId: actorId(req), actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "PAPER_BILL_RANGE_ALLOCATED",
          entityType: "PaperBillBookAllocation",
          entityId: allocated.id,
          afterState: {
            bookId: allocated.bookId,
            distributorId: allocated.distributorId,
            startNumber: allocated.startNumber,
            endNumber: allocated.endNumber,
            status: allocated.status,
          },
        },
        { client: tx },
      ),
    });
    return res.status(201).json({ success: true, message: "Bill range assigned; distributor confirmation is pending.", record });
  } catch (error) {
    return responseError(res, error, "Bill range could not be allocated.");
  }
};

export const returnPaperBillRangeAdmin = async (req, res) => {
  try {
    const record = await returnPaperBillAllocation({
      id: req.params.id,
      returnedBy: actorId(req),
      afterReturn: (returned, tx) => recordSystemAudit(
        { actorId: actorId(req), actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "PAPER_BILL_RANGE_RETURNED",
          entityType: "PaperBillBookAllocation",
          entityId: returned.id,
          afterState: { status: returned.status, returnedAt: returned.returnedAt },
        },
        { client: tx },
      ),
    });
    return res.status(200).json({ success: true, message: "Unused bill range marked as returned; numbers remain reserved.", record });
  } catch (error) {
    return responseError(res, error, "Bill range could not be returned.");
  }
};

export const getPaperBillOrderReportAdmin = async (req, res) => {
  try {
    const { startDate: from, endDate: to } = await resolveCalendarDateRangeInput(
      req.query.from,
      req.query.to,
      req.query.calendar,
    );
    const report = await listPaperBillOrderReport({
      from,
      to,
      billFilter: req.query.billFilter,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.status(200).json({ success: true, ...report });
  } catch (error) {
    return responseError(res, error, "Paper bill order report could not be loaded.");
  }
};
