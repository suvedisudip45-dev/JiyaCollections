import { recordSystemAudit } from "../services/auditService.js";
import {
  listSalesInvoices,
  recordPaperSalesInvoice,
} from "../services/salesInvoiceService.js";
import { resolveCalendarDateInput } from "../services/nepaliFiscalCalendar.js";

const responseError = (res, error, fallbackMessage) => {
  console.error(fallbackMessage, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || fallbackMessage,
    code: error.code || "SALES_INVOICE_ERROR",
  });
};

export const getSalesInvoicesAdmin = async (_req, res) => {
  try {
    const records = await listSalesInvoices();
    return res.status(200).json({ success: true, records });
  } catch (error) {
    return responseError(res, error, "Failed to load sales invoice records.");
  }
};

export const recordPaperSalesInvoiceAdmin = async (req, res) => {
  try {
    const actorId = req.auth?.accountId || req.auth?.userId || null;
    const issueDate = await resolveCalendarDateInput(req.body?.issueDate, req.body?.calendar);
    const record = await recordPaperSalesInvoice({
      id: req.params.id,
      invoiceNumber: req.body?.invoiceNumber,
      issueDate,
      evidenceUrl: req.body?.evidenceUrl,
      issuedBy: actorId,
      afterIssue: (before, updated, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "PAPER_SALES_INVOICE_RECORDED",
          entityType: "SalesInvoice",
          entityId: updated.id,
          beforeState: { status: before.status },
          afterState: {
            status: updated.status,
            invoiceNumber: updated.invoiceNumber,
            issueDate: updated.issueDate,
            documentType: updated.documentType,
          },
        },
        { client: tx },
      ),
    });
    return res.status(200).json({ success: true, message: "Paper bill details recorded.", record });
  } catch (error) {
    return responseError(res, error, "Failed to record paper bill details.");
  }
};
