import { randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";
import { postSupplierPaymentAccounting } from "../services/accountingPostingEngine.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import {
  getManufacturerSettlementSummary,
  normalizeSettlementRequest,
} from "../services/manufacturerSettlementService.js";

const actorContext = (req) => ({
  actorId: req.auth?.accountId || null,
  actorRole: req.auth?.role || "SYSTEM",
  portalSource: req.auth?.role || "SYSTEM",
  ipAddress: req.ip || null,
  userAgent: req.headers["user-agent"] || null,
  correlationId: req.correlationId || null,
});

export const getManufacturerFinanceDashboard = async (req, res) => {
  try {
    const summary = await getManufacturerSettlementSummary(req.manufacturerId);
    if (!summary) return res.status(404).json({ success: false, message: "Manufacturer profile not found." });
    return res.json({
      success: true,
      dashboard: {
        manufacturer: summary.manufacturer,
        totalManufacturedGoodsValue: summary.totalManufacturedGoodsValue,
        logisticsReimbursements: summary.logisticsReimbursements,
        pendingSettlements: summary.pendingSettlementAmount,
        completedPayments: summary.completedPayments,
        outstandingPayable: summary.outstandingPayable,
        settlements: summary.settlements,
      },
    });
  } catch (error) {
    console.error("getManufacturerFinanceDashboard error:", error);
    return res.status(500).json({ success: false, message: "Unable to load manufacturer financial dashboard." });
  }
};

export const createManufacturerSettlementRequest = async (req, res) => {
  try {
    const input = normalizeSettlementRequest(req.body);
    const idempotencyKey = String(req.headers["idempotency-key"] || req.body.idempotencyKey || randomUUID()).trim();
    if (!/^[A-Za-z0-9._:-]{1,191}$/.test(idempotencyKey)) {
      return res.status(400).json({ success: false, message: "Settlement idempotency key is invalid." });
    }
    const settlement = await prisma.$transaction(async (tx) => {
      const existing = await tx.manufacturerSettlementRequest.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.manufacturerId !== req.manufacturerId || Number(existing.amount) !== Number(input.amount) || existing.requestType !== input.requestType) {
          throw Object.assign(new Error("Idempotency key was already used for a different settlement request."), { statusCode: 409 });
        }
        return existing;
      }
      const summary = await getManufacturerSettlementSummary(req.manufacturerId, { client: tx });
      if (!summary) throw Object.assign(new Error("Manufacturer profile not found."), { statusCode: 404 });
      const available = input.requestType === "PRODUCTION"
        ? summary.productionPayableAvailable
        : summary.logisticsPayableAvailable;
      if (Number(input.amount) > available) {
        throw Object.assign(new Error(`Requested settlement exceeds available ${input.requestType.toLowerCase()} payable of Rs ${available.toFixed(2)}.`), { statusCode: 409 });
      }

      const created = await tx.manufacturerSettlementRequest.create({
        data: {
          manufacturerId: req.manufacturerId,
          requestType: input.requestType,
          amount: input.amount,
          notes: input.notes,
          requestedBy: req.auth?.accountId || null,
          idempotencyKey,
        },
      });
      await recordSystemAudit(actorContext(req), {
        action: "MANUFACTURER_SETTLEMENT_REQUESTED",
        entityType: "ManufacturerSettlementRequest",
        entityId: created.id,
        afterState: { requestType: created.requestType, amount: input.amount.toFixed(2), status: created.status },
      }, { client: tx });
      return created;
    }, { isolationLevel: "Serializable" });
    return res.status(201).json({
      success: true,
      message: "Settlement request submitted to admin.",
      settlement,
    });
  } catch (error) {
    console.error("createManufacturerSettlementRequest error:", error);
    return res.status(error.statusCode || 400).json({ success: false, message: error.message || "Unable to submit settlement request." });
  }
};

export const listAdminManufacturerSettlements = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const status = String(req.query.status || "").trim().toUpperCase();
    if (status && !["PENDING", "PAID", "REJECTED"].includes(status)) {
      return res.status(400).json({ success: false, message: "Settlement status filter is invalid." });
    }
    const where = {
      ...(status ? { status } : {}),
      ...(req.query.manufacturerId ? { manufacturerId: String(req.query.manufacturerId).trim() } : {}),
    };
    const [settlements, total] = await prisma.$transaction([
      prisma.manufacturerSettlementRequest.findMany({
        where,
        include: {
          manufacturer: { select: { id: true, name: true } },
        },
        orderBy: { requestedAt: "desc" },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.manufacturerSettlementRequest.count({ where }),
    ]);
    return res.json(paginatedResponse("settlements", settlements, pagination, total));
  } catch (error) {
    console.error("listAdminManufacturerSettlements error:", error);
    return res.status(500).json({ success: false, message: "Unable to load manufacturer settlements." });
  }
};

export const payManufacturerSettlement = async (req, res) => {
  try {
    const { id } = req.params;
    const financialAccountId = String(req.body.financialAccountId || "").trim();
    if (!financialAccountId) return res.status(400).json({ success: false, message: "Source financial account is required." });
    const result = await prisma.$transaction(async (tx) => {
      const request = await tx.manufacturerSettlementRequest.findUnique({
        where: { id },
        include: { manufacturer: { select: { id: true, name: true } } },
      });
      if (!request) throw Object.assign(new Error("Manufacturer settlement request not found."), { statusCode: 404 });
      if (request.status !== "PENDING") throw Object.assign(new Error("Only pending settlement requests can be paid."), { statusCode: 409 });
      const account = await tx.financialAccount.findUnique({ where: { id: financialAccountId } });
      if (!account) throw Object.assign(new Error("Source financial account not found."), { statusCode: 404 });
      const amount = Number(request.amount);
      const summary = await getManufacturerSettlementSummary(request.manufacturerId, { client: tx });
      if (!summary) throw Object.assign(new Error("Manufacturer profile not found."), { statusCode: 404 });
      const outstanding = request.requestType === "LOGISTICS" ? summary.logisticsOutstanding : summary.productionOutstanding;
      if (amount > outstanding) {
        throw Object.assign(new Error(`Outstanding ${request.requestType.toLowerCase()} payable is Rs ${outstanding.toFixed(2)}; payment would exceed it.`), { statusCode: 409 });
      }
      const idempotencyKey = `MFG-SETTLEMENT:${request.id}`;
      const existingPayment = await tx.cashTransaction.findUnique({ where: { idempotencyKey } });
      if (existingPayment) throw Object.assign(new Error("This settlement payment has already been recorded."), { statusCode: 409 });
      const debited = await tx.financialAccount.updateMany({
        where: { id: account.id, currentBalance: { gte: amount } },
        data: { currentBalance: { decrement: amount } },
      });
      if (debited.count !== 1) throw Object.assign(new Error("Insufficient balance in the selected financial account."), { statusCode: 409 });

      await tx.cashTransaction.create({
        data: {
          idempotencyKey,
          amount,
          type: "OUTFLOW",
          fromAccountId: account.id,
          category: "SUPPLIER_PAYMENT",
          partyName: request.manufacturer.name,
          referenceId: request.manufacturerId,
          description: `${request.requestType} settlement ${request.id} paid to ${request.manufacturer.name}`,
        },
      });
      const journal = await postSupplierPaymentAccounting({
        payableId: `MFG-SETTLEMENT-${request.id}`,
        payeeName: request.manufacturer.name,
        amount,
        settlementAmount: amount,
        fromAccountType: account.accountType === "CASH" ? "CASH" : "BANK",
        payableAccountCode: "2160",
        idempotencyKey: `SUPPLIER_PAYMENT:${idempotencyKey}`,
        referenceNumber: `MFG-SET-${request.id.slice(-8).toUpperCase()}`,
        client: tx,
      });
      if (!journal) throw new Error("Accounting journal could not be posted for the settlement.");

      const updated = await tx.manufacturerSettlementRequest.updateMany({
        where: { id: request.id, status: "PENDING" },
        data: {
          status: "PAID",
          reviewedBy: req.auth?.accountId || null,
          financialAccountId: account.id,
          paidAt: new Date(),
        },
      });
      if (updated.count !== 1) throw Object.assign(new Error("Settlement request status changed before payment completed."), { statusCode: 409 });
      await recordSystemAudit(actorContext(req), {
        action: "MANUFACTURER_SETTLEMENT_PAID",
        entityType: "ManufacturerSettlementRequest",
        entityId: request.id,
        beforeState: { status: request.status },
        afterState: { status: "PAID", amount: amount.toFixed(2), financialAccountId: account.id, journalEntryId: journal.id },
      }, { client: tx });
      const updatedAccount = await tx.financialAccount.findUnique({ where: { id: account.id }, select: { currentBalance: true } });
      return { settlementId: request.id, journalEntryId: journal.id, amount, accountBalance: updatedAccount.currentBalance };
    }, { isolationLevel: "Serializable" });
    return res.json({ success: true, message: "Manufacturer settlement paid and recorded in the accounting journal.", ...result });
  } catch (error) {
    console.error("payManufacturerSettlement error:", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Unable to pay manufacturer settlement." });
  }
};
