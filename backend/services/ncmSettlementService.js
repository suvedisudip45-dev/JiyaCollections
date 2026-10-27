import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import {
  postNcmCarrierFeeAccrualAccounting,
  postNcmRemittanceAccounting,
} from "./accountingPostingEngine.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { allocatePaymentToDocuments, createAccountingDocument } from "./accountingSubledgerService.js";

const fail = (message, statusCode = 400, code = "NCM_SETTLEMENT_ERROR") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const normalizeIds = (settlementIds) => {
  if (!Array.isArray(settlementIds) || settlementIds.length < 1 || settlementIds.length > 100) {
    throw fail("Select between 1 and 100 NCM settlements.", 400, "INVALID_SETTLEMENT_IDS");
  }
  const ids = settlementIds.map((id) => typeof id === "string" ? id.trim() : "");
  if (ids.some((id) => !id || id.length > 191) || new Set(ids).size !== ids.length) {
    throw fail("NCM settlement IDs must be valid and unique.", 400, "INVALID_SETTLEMENT_IDS");
  }
  return ids.sort();
};

const optionalText = (value, label, maxLength) => {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw fail(`${label} must be text.`, 400, "INVALID_SETTLEMENT_INPUT");
  }
  const text = String(value || "").trim();
  if (text.length > maxLength) throw fail(`${label} must be ${maxLength} characters or fewer.`, 400, "INVALID_SETTLEMENT_INPUT");
  return text || null;
};

export const confirmNcmSettlementBatch = async ({
  settlementIds,
  financialAccountId,
  reference = null,
  notes = null,
  expectedNetDeposit = null,
  createdBy = "ADMIN",
  client = prisma,
  settlementPoster = postNcmRemittanceAccounting,
  carrierFeeAccrualPoster = postNcmCarrierFeeAccrualAccounting,
  partyResolver = ensureAccountingParty,
  documentCreator = createAccountingDocument,
  documentAllocator = allocatePaymentToDocuments,
  now = new Date(),
} = {}) => {
  const ids = normalizeIds(settlementIds);
  if (typeof financialAccountId !== "string" || !financialAccountId.trim()) {
    throw fail("Select an active NPR treasury account.", 400, "TREASURY_ACCOUNT_REQUIRED");
  }
  const receiptReference = optionalText(reference, "Bank reference", 191);
  const settlementNotes = optionalText(notes, "Settlement notes", 2000);
  const expectedDepositText = expectedNetDeposit == null ? null : String(expectedNetDeposit).trim();
  if (expectedDepositText !== null && !/^\d{1,18}(?:\.\d{1,2})?$/.test(expectedDepositText)) {
    throw fail("Expected net deposit must be a positive amount with at most two decimal places.", 400, "INVALID_NET_DEPOSIT");
  }
  const expectedDeposit = expectedDepositText === null
    ? null
    : new Prisma.Decimal(expectedDepositText).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (expectedDeposit && !expectedDeposit.greaterThan(0)) {
    throw fail("Expected net deposit must be a positive amount.", 400, "INVALID_NET_DEPOSIT");
  }
  const batchHash = crypto.createHash("sha256").update(ids.join("|")).digest("hex");
  const batchKey = `NCM_COD_BATCH:${batchHash}`;

  try {
    return await client.$transaction(async (tx) => {
      const replay = await tx.cashTransaction.findUnique({ where: { idempotencyKey: batchKey } });
      if (replay) {
        if (replay.toAccountId !== financialAccountId || replay.referenceId !== batchKey) {
          throw fail("These NCM settlements were already processed with different treasury details.", 409, "NCM_SETTLEMENT_ALREADY_PROCESSED");
        }
        return { success: true, transactionId: replay.id, netDeposit: replay.amount, alreadyProcessed: true };
      }

      const account = await tx.financialAccount.findUnique({
        where: { id: financialAccountId },
        include: { accountingAccount: { select: { id: true, accountCode: true, accountType: true, normalBalance: true } } },
      });
      if (
        !account ||
        account.status !== "ACTIVE" ||
        account.currency !== "NPR" ||
        !["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase()) ||
        !account.accountingAccount ||
        account.accountingAccount.accountType !== "ASSET" ||
        account.accountingAccount.normalBalance !== "DEBIT"
      ) {
        throw fail("Select an active NPR cash, bank, or wallet account mapped to a debit-balance asset.", 409, "INVALID_TREASURY_ACCOUNT");
      }

      const settlements = await tx.deliveryFinancialSettlement.findMany({
        where: { id: { in: ids } },
        orderBy: { id: "asc" },
      });
      if (settlements.length !== ids.length) {
        throw fail("One or more selected NCM settlements no longer exist. Refresh and retry.", 409, "SETTLEMENTS_CHANGED");
      }
      if (settlements.some((settlement) => !["PENDING", "COD_RECEIVED", "REQUESTED"].includes(settlement.settlementState))) {
        throw fail("One or more selected NCM settlements are not open for remittance.", 409, "SETTLEMENTS_NOT_OPEN");
      }
      if (settlements.some((settlement) => Number(settlement.otherAdjustments || 0) !== 0)) {
        throw fail("Resolve and document other settlement adjustments before confirming the remittance.", 409, "SETTLEMENT_VARIANCE_REVIEW_REQUIRED");
      }

      let totalCod = new Prisma.Decimal(0);
      let totalFee = new Prisma.Decimal(0);
      for (const settlement of settlements) {
        const cod = new Prisma.Decimal(String(settlement.codCollected || settlement.codExpected || 0));
        const fee = new Prisma.Decimal(String(settlement.deliveryFeeActual || settlement.deliveryFeeExpected || 0));
        if (!cod.isFinite() || !fee.isFinite() || cod.lessThanOrEqualTo(0) || fee.isNegative()) {
          throw fail("A selected NCM settlement has invalid COD or carrier-fee values.", 409, "INVALID_SETTLEMENT_AMOUNT");
        }
        totalCod = totalCod.plus(cod);
        totalFee = totalFee.plus(fee);
      }
      const netDeposit = totalCod.minus(totalFee).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (!netDeposit.greaterThan(0)) {
        throw fail("Net remittance must be positive. Reconcile carrier charges separately before closing these settlements.", 409, "NON_POSITIVE_NET_REMITTANCE");
      }
      if (expectedDeposit && !expectedDeposit.equals(netDeposit)) {
        throw fail(`Receipt must match the reconciled net remittance of NPR ${netDeposit.toFixed(2)}.`, 409, "NET_REMITTANCE_MISMATCH");
      }

      const ncmParty = await partyResolver({
        partyType: "CARRIER",
        sourceEntityId: "NCM",
        displayName: "Nepal Can Move (NCM)",
      }, { client: tx });
      const deliveryOrders = await tx.deliveryOrder.findMany({
        where: { id: { in: settlements.map(({ deliveryOrderId }) => deliveryOrderId) } },
        select: { id: true, orderId: true },
      });
      if (deliveryOrders.length !== settlements.length) {
        throw fail("One or more NCM delivery orders are missing; reconcile them before remittance.", 409, "NCM_DELIVERY_LINK_MISSING");
      }
      const orderIds = deliveryOrders.map(({ orderId }) => orderId);
      const receivableDocuments = await tx.accountingDocument.findMany({
        where: {
          partyId: ncmParty.id,
          side: "RECEIVABLE",
          sourceType: "NCM_COD_SALE",
          sourceId: { in: orderIds },
          status: { in: ["OPEN", "PARTIALLY_PAID"] },
        },
      });
      const openNcmCod = receivableDocuments.reduce(
        (sum, document) => sum.plus(new Prisma.Decimal(String(document.remainingAmount))),
        new Prisma.Decimal(0),
      );
      if (openNcmCod.lessThan(totalCod)) {
        throw fail("NCM COD sale documents are missing or already allocated. Reconcile delivery accounting before settlement.", 409, "NCM_COD_SUBLEDGER_MISMATCH");
      }

      const settledAt = now;
      for (const settlement of settlements) {
        const claim = await tx.deliveryFinancialSettlement.updateMany({
          where: {
            id: settlement.id,
            settlementState: settlement.settlementState,
          },
          data: {
            settlementState: "SETTLED",
            settledAt,
            codCollected: Number(settlement.codCollected || settlement.codExpected || 0),
          },
        });
        if (claim.count !== 1) {
          throw fail("An NCM settlement changed while processing. Refresh and retry.", 409, "SETTLEMENT_CONCURRENCY_CONFLICT");
        }
      }

      let carrierFeeDocument = null;
      if (totalFee.greaterThan(0)) {
        const feeJournal = await carrierFeeAccrualPoster({
          settlementId: batchHash,
          feeAmount: totalFee.toFixed(2),
          ncmPartyId: ncmParty.id,
          createdBy,
        }, { client: tx });
        if (!feeJournal?.id) {
          throw fail("NCM carrier fee accrual journal could not be posted.", 500, "NCM_FEE_ACCOUNTING_FAILED");
        }
        carrierFeeDocument = await documentCreator({
          documentType: "BILL",
          documentNumber: `NCM-FEE-${batchHash.slice(0, 24)}`,
          partyId: ncmParty.id,
          side: "PAYABLE",
          sourceType: "NCM_CARRIER_FEE",
          sourceId: batchHash,
          issueDate: settledAt,
          amount: totalFee,
          idempotencyKey: `NCM_CARRIER_FEE:${batchHash}`,
          notes: `NCM fee deducted from COD remittance; accrual journal ${feeJournal.id}.`,
        }, { client: tx });
      }

      const journal = await settlementPoster({
        settlementId: batchHash,
        codCollected: totalCod.toFixed(2),
        deliveryFeeActual: totalFee.toFixed(2),
        cashAccountCode: account.accountingAccount.accountCode,
        destinationAccountName: account.accountName,
        createdBy,
        ncmPartyId: ncmParty.id,
      }, { client: tx });
      if (!journal?.id) throw fail("NCM remittance journal could not be posted.", 500, "NCM_ACCOUNTING_FAILED");

      const receivableAllocation = await documentAllocator({
        partyId: ncmParty.id,
        side: "RECEIVABLE",
        amount: totalCod,
        journalEntryId: journal.id,
        targetDocumentIds: receivableDocuments.map(({ id }) => id),
        sourceTypes: ["NCM_COD_SALE"],
        idempotencyKey: `${batchKey}:COD`,
        notes: `NCM remittance batch ${batchHash}`,
      }, { client: tx });
      if (new Prisma.Decimal(String(receivableAllocation.unallocatedAmount)).greaterThan(0)) {
        throw fail("NCM remittance could not be fully allocated to delivered COD invoices.", 409, "NCM_COD_ALLOCATION_INCOMPLETE");
      }
      if (carrierFeeDocument) {
        const feeAllocation = await documentAllocator({
          partyId: ncmParty.id,
          side: "PAYABLE",
          amount: totalFee,
          journalEntryId: journal.id,
          targetDocumentIds: [carrierFeeDocument.id],
          sourceTypes: ["NCM_CARRIER_FEE"],
          idempotencyKey: `${batchKey}:FEE`,
          notes: `NCM carrier fee netted against remittance ${batchHash}`,
        }, { client: tx });
        if (new Prisma.Decimal(String(feeAllocation.unallocatedAmount)).greaterThan(0)) {
          throw fail("NCM carrier fee could not be fully allocated to its payable document.", 409, "NCM_FEE_ALLOCATION_INCOMPLETE");
        }
      }

      const journalLink = await tx.deliveryFinancialSettlement.updateMany({
        where: { id: { in: ids }, settlementState: "SETTLED", journalEntryId: null },
        data: { journalEntryId: journal.id },
      });
      if (journalLink.count !== settlements.length) {
        throw fail("NCM settlement journal could not be linked to every order.", 409, "SETTLEMENT_JOURNAL_LINK_FAILED");
      }

      const balanceUpdate = await tx.financialAccount.updateMany({
        where: { id: account.id, status: "ACTIVE", currency: "NPR" },
        data: { currentBalance: { increment: netDeposit.toNumber() } },
      });
      if (balanceUpdate.count !== 1) {
        throw fail("Treasury account changed while posting the remittance.", 409, "TREASURY_ACCOUNT_CONFLICT");
      }

      const cashTransaction = await tx.cashTransaction.create({
        data: {
          idempotencyKey: batchKey,
          amount: netDeposit.toNumber(),
          type: "INFLOW",
          toAccountId: account.id,
          category: "COD_REMITTANCE",
          partyName: "Nepal Can Move (NCM)",
          invoiceNumber: receiptReference || "",
          referenceId: batchKey,
          description: `NCM remittance: COD NPR ${totalCod.toFixed(2)} less carrier fee NPR ${totalFee.toFixed(2)}${settlementNotes ? ` - ${settlementNotes}` : ""}`,
          date: settledAt,
        },
      });

      return {
        success: true,
        alreadyProcessed: false,
        transactionId: cashTransaction.id,
        journalEntryId: journal.id,
        netDeposit: netDeposit.toFixed(2),
        totalCod: totalCod.toFixed(2),
        totalFee: totalFee.toFixed(2),
        settledCount: settlements.length,
      };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2034") {
      throw fail("NCM settlement changed concurrently. Refresh the reconciliation list and retry.", 409, "SETTLEMENT_CONCURRENCY_CONFLICT");
    }
    if (error?.code === "P2002") {
      const replay = await client.cashTransaction.findUnique({ where: { idempotencyKey: batchKey } });
      if (replay && replay.toAccountId === financialAccountId && replay.referenceId === batchKey) {
        return { success: true, transactionId: replay.id, netDeposit: replay.amount, alreadyProcessed: true };
      }
    }
    throw error;
  }
};
