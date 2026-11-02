import { prisma } from "../config/db.js";

const fail = (message, statusCode = 400, code = "SALES_INVOICE_ERROR") =>
  Object.assign(new Error(message), { statusCode, code });

export const listSalesInvoices = async ({ client = prisma } = {}) => client.salesInvoice.findMany({
  include: {
    order: { select: { orderReference: true, orderType: true, distributorId: true } },
  },
  orderBy: { taxPoint: "desc" },
  take: 100,
});

export const recordPaperSalesInvoice = async ({
  id,
  invoiceNumber,
  issueDate,
  evidenceUrl,
  issuedBy = null,
  client = prisma,
  afterIssue = null,
} = {}) => {
  const recordId = String(id ?? "").trim();
  const externalNumber = String(invoiceNumber ?? "").trim();
  const issuedAt = new Date(issueDate);
  const evidence = String(evidenceUrl ?? "").trim();
  if (!recordId || !externalNumber || externalNumber.length > 191) {
    throw fail("A valid internal invoice and the paper bill number are required.", 400, "PAPER_INVOICE_NUMBER_REQUIRED");
  }
  if (!issueDate || Number.isNaN(issuedAt.getTime())) {
    throw fail("Enter the date shown on the paper bill.", 400, "INVALID_PAPER_INVOICE_DATE");
  }
  if (evidence.length > 5000) throw fail("Paper bill evidence URL is too long.", 400, "INVALID_INVOICE_EVIDENCE");

  try {
    return await client.$transaction(async (tx) => {
      const current = await tx.salesInvoice.findUnique({ where: { id: recordId } });
      if (!current) throw fail("Sales invoice record not found.", 404, "SALES_INVOICE_NOT_FOUND");
      if (current.issueChannel !== "PAPER") throw fail("This invoice is not configured for paper issuance.", 409, "INVOICE_CHANNEL_MISMATCH");
      if (current.status === "PAPER_ISSUED") {
        if (current.invoiceNumber === externalNumber && current.issueDate?.getTime() === issuedAt.getTime()) return current;
        throw fail("An issued paper bill is immutable. Record a correction using the approved credit/debit-note process.", 409, "SALES_INVOICE_IMMUTABLE");
      }
      if (current.status !== "PENDING_PAPER_DETAILS") {
        throw fail("Only a pending paper bill can be recorded as issued.", 409, "SALES_INVOICE_NOT_PENDING");
      }
      const updated = await tx.salesInvoice.update({
        where: { id: current.id },
        data: {
          invoiceNumber: externalNumber,
          issueDate: issuedAt,
          evidenceUrl: evidence || null,
          status: "PAPER_ISSUED",
          issuedBy: issuedBy ? String(issuedBy).slice(0, 191) : null,
        },
        include: {
          order: { select: { orderReference: true, orderType: true, distributorId: true } },
        },
      });
      if (afterIssue) await afterIssue(current, updated, tx);
      return updated;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2002") {
      throw fail("That paper invoice number is already recorded.", 409, "PAPER_INVOICE_NUMBER_CONFLICT");
    }
    throw error;
  }
};
