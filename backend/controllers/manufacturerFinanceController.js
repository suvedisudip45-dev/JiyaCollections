import { randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";
import { postSupplierPaymentAccounting } from "../services/accountingPostingEngine.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { requireExternalPaymentReference } from "../utils/externalPaymentReference.js";
import { validateTreasuryPayoutAccount } from "../services/treasuryAccountingService.js";
import {
  confirmFinancialPayout,
  failFinancialPayout,
  initiateFinancialPayout,
} from "../services/financialPayoutService.js";
import {
  getManufacturerSettlementSummary,
  allocateManufacturerPaymentToDocuments,
  normalizeSettlementRequest,
  reconcileManufacturerLogisticsShipmentPayments,
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
        supplierCreditOutstanding: summary.supplierCreditOutstanding,
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
    const action = String(req.body?.action || "INITIATE").trim().toUpperCase();
    const adminAccountId = req.auth?.accountId || req.auth?.userId || null;
    if (action === "FAIL") {
      const result = await failFinancialPayout({
        payoutId: req.body?.payoutId,
        expectedTargetType: "MANUFACTURER_SETTLEMENT",
        failureReason: req.body?.failureReason,
        failedByAccountId: adminAccountId,
      });
      return res.json(result);
    }

    if (action === "INITIATE") {
      const financialAccountId = String(req.body?.financialAccountId || "").trim();
      if (!financialAccountId) return res.status(400).json({ success: false, message: "Source financial account is required." });
      const amount = req.body?.amount;
      const externalPaymentReference = requireExternalPaymentReference(req.body?.externalPaymentReference);
      const idempotencyKey = String(req.headers["idempotency-key"] || req.body?.idempotencyKey || "").trim();
      const initiated = await initiateFinancialPayout({
        targetType: "MANUFACTURER_SETTLEMENT",
        targetId: id,
        amount,
        financialAccountId,
        externalPaymentReference,
        idempotencyKey,
        initiatedByAccountId: adminAccountId,
        notes: req.body?.notes,
        validateTarget: async (tx) => {
          const request = await tx.manufacturerSettlementRequest.findUnique({
            where: { id },
            include: { manufacturer: { select: { id: true, name: true } } },
          });
          if (!request || !["PENDING", "PARTIALLY_PAID"].includes(request.status)) {
            throw Object.assign(new Error("Only an open manufacturer settlement request can be paid."), { statusCode: 409, code: "SETTLEMENT_NOT_PAYABLE" });
          }
          const amountLeft = new Prisma.Decimal(String(request.amount))
            .minus(new Prisma.Decimal(String(request.paidAmount || 0)));
          const pendingPayouts = await tx.financialPayout.aggregate({
            where: { targetType: "MANUFACTURER_SETTLEMENT", targetId: id, status: "INITIATED" },
            _sum: { settlementAmount: true },
          });
          const pendingAmount = new Prisma.Decimal(String(pendingPayouts._sum.settlementAmount || 0));
          const summary = await getManufacturerSettlementSummary(request.manufacturerId, { client: tx });
          if (!summary) throw Object.assign(new Error("Manufacturer profile not found."), { statusCode: 404 });
          const rawOutstanding = request.requestType === "LOGISTICS" ? summary.logisticsOutstanding : summary.productionOutstanding;
          const payableAvailable = new Prisma.Decimal(String(rawOutstanding)).minus(pendingAmount);
          const availableAmount = Prisma.Decimal.max(
            new Prisma.Decimal(0),
            Prisma.Decimal.min(amountLeft.minus(pendingAmount), payableAvailable),
          );
          const account = await tx.financialAccount.findUnique({ where: { id: financialAccountId } });
          await validateTreasuryPayoutAccount(account, tx);
          return { availableAmount };
        },
      });
      return res.status(initiated.isReplay ? 200 : 201).json({
        ...initiated,
        message: initiated.isReplay
          ? "This manufacturer payout was already initiated."
          : "Manufacturer payout initiated; funds are reserved pending bank confirmation.",
      });
    }

    if (action !== "CONFIRM") {
      return res.status(400).json({ success: false, message: "Payout action must be INITIATE, CONFIRM, or FAIL." });
    }
    const confirmed = await confirmFinancialPayout({
      payoutId: req.body?.payoutId,
      bankEvidenceReference: req.body?.bankEvidenceReference,
      confirmedByAccountId: adminAccountId,
      finalizePayout: async (tx, payout) => {
        if (payout.targetType !== "MANUFACTURER_SETTLEMENT" || payout.targetId !== id) {
          throw Object.assign(new Error("Payout does not match this manufacturer settlement."), { statusCode: 409, code: "PAYOUT_TARGET_MISMATCH" });
        }
        const request = await tx.manufacturerSettlementRequest.findUnique({
          where: { id },
          include: { manufacturer: { select: { id: true, name: true } } },
        });
        if (!request || !["PENDING", "PARTIALLY_PAID"].includes(request.status)) {
          throw Object.assign(new Error("Manufacturer settlement request is no longer payable."), { statusCode: 409, code: "SETTLEMENT_NOT_PAYABLE" });
        }
        const amount = new Prisma.Decimal(String(payout.amount));
        const amountLeft = new Prisma.Decimal(String(request.amount))
          .minus(new Prisma.Decimal(String(request.paidAmount || 0)));
        const summary = await getManufacturerSettlementSummary(request.manufacturerId, { client: tx });
        if (!summary) throw Object.assign(new Error("Manufacturer profile not found."), { statusCode: 404 });
        const rawOutstanding = request.requestType === "LOGISTICS" ? summary.logisticsOutstanding : summary.productionOutstanding;
        if (amount.greaterThan(amountLeft) || amount.greaterThan(new Prisma.Decimal(String(rawOutstanding)))) {
          throw Object.assign(new Error("The confirmed payout exceeds the remaining settlement request or payable."), { statusCode: 409, code: "PAYOUT_EXCEEDS_PAYABLE" });
        }
        const account = await tx.financialAccount.findUnique({ where: { id: payout.financialAccountId } });
        const accountingAccount = await validateTreasuryPayoutAccount(account, tx);
        const debited = await tx.financialAccount.updateMany({
          where: { id: account.id, status: "ACTIVE", currentBalance: { gte: amount } },
          data: { currentBalance: { decrement: amount } },
        });
        if (debited.count !== 1) throw Object.assign(new Error("Treasury balance is insufficient or changed."), { statusCode: 409, code: "INSUFFICIENT_FUNDS" });
        await tx.cashTransaction.create({
          data: {
            idempotencyKey: payout.idempotencyKey,
            amount,
            type: "OUTFLOW",
            fromAccountId: account.id,
            category: "SUPPLIER_PAYMENT",
            partyName: request.manufacturer.name,
            referenceId: request.manufacturerId,
            externalPaymentReference: payout.externalPaymentReference,
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
          cashAccountId: accountingAccount.id,
          supplierId: request.manufacturerId,
          idempotencyKey: `SUPPLIER_PAYMENT:${payout.idempotencyKey}`,
          referenceNumber: `MFG-SET-${payout.id.slice(-8).toUpperCase()}`,
          client: tx,
        });
        if (!journal?.id) throw new Error("Accounting journal could not be posted for the settlement.");
        const documentAllocation = ["PRODUCTION", "LOGISTICS"].includes(request.requestType)
          ? await allocateManufacturerPaymentToDocuments({
              manufacturerId: request.manufacturerId,
              amount,
              journalEntryId: journal.id,
              idempotencyKey: `MFG-SETTLEMENT-ALLOCATION:${payout.id}`,
              sourceTypes: request.requestType === "LOGISTICS"
                ? ["MANUFACTURER_LOGISTICS"]
                : ["MANUFACTURER_PRODUCTION", "MANUFACTURER_DELIVERY_COGS"],
              notes: `${request.requestType} settlement ${request.id}`,
              client: tx,
            })
          : null;
        const paidToDate = new Prisma.Decimal(String(request.paidAmount || 0)).plus(amount);
        const requestRemaining = new Prisma.Decimal(String(request.amount)).minus(paidToDate);
        const nextStatus = requestRemaining.isZero() ? "PAID" : "PARTIALLY_PAID";
        const updated = await tx.manufacturerSettlementRequest.updateMany({
          where: { id: request.id, status: request.status, paidAmount: request.paidAmount || new Prisma.Decimal(0) },
          data: {
            paidAmount: paidToDate,
            status: nextStatus,
            reviewedBy: adminAccountId,
            financialAccountId: account.id,
            externalPaymentReference: payout.externalPaymentReference,
            paidAt: requestRemaining.isZero() ? new Date() : null,
          },
        });
        if (updated.count !== 1) throw Object.assign(new Error("Manufacturer settlement changed before payout confirmation."), { statusCode: 409, code: "PAYOUT_STATE_CONFLICT" });
        const freightSettlementReconciliation = request.requestType === "LOGISTICS"
          ? await reconcileManufacturerLogisticsShipmentPayments({ manufacturerId: request.manufacturerId, client: tx })
          : null;
        await recordSystemAudit(actorContext(req), {
          action: "MANUFACTURER_SETTLEMENT_PAID",
          entityType: "ManufacturerSettlementRequest",
          entityId: request.id,
          beforeState: { status: request.status, paidAmount: String(request.paidAmount || 0) },
          afterState: {
            status: nextStatus,
            paidAmount: paidToDate.toFixed(2),
            payoutId: payout.id,
            journalEntryId: journal.id,
            bankEvidenceReference: String(req.body.bankEvidenceReference).trim(),
          },
        }, { client: tx });
        return { settlementId: request.id, journalEntryId: journal.id, amount, documentAllocation, freightSettlementReconciliation };
      },
    });
    const hasUnreconciledFreight = confirmed.settlement.freightSettlementReconciliation?.unreconciledPaidAmount.greaterThan(0);
    const hasUnallocatedLegacyPayment = confirmed.settlement.documentAllocation?.unallocatedAmount.greaterThan(0);
    return res.json({
      success: true,
      message: hasUnreconciledFreight
        ? "Manufacturer payout settled, but part of the logistics amount could not be matched to dispatched local freight."
        : hasUnallocatedLegacyPayment
          ? "Manufacturer payout settled; part of the amount remains allocated to legacy payable balances."
          : "Manufacturer payout settled and recorded in the accounting journal.",
      reconciliationRequired: Boolean(hasUnreconciledFreight || hasUnallocatedLegacyPayment),
      ...confirmed,
    });
  } catch (error) {
    console.error("payManufacturerSettlement error:", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Unable to process manufacturer settlement payout.", code: error.code });
  }
};
