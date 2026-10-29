import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { allocatePaymentToDocuments } from "./accountingSubledgerService.js";
import { postJournalEntry, postSupplierPaymentAccounting } from "./accountingPostingEngine.js";
import { recordSystemAudit } from "./auditService.js";

const fail = (message, statusCode = 400, code = "DISTRIBUTOR_CASH_ERROR") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const parseMoney = (value) => {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d{1,18}(?:\.\d{1,2})?$/.test(String(value).trim())) {
    throw fail("Amount must be positive with no more than two decimal places.", 400, "INVALID_AMOUNT");
  }
  const amount = new Prisma.Decimal(String(value).trim());
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw fail("Amount must be greater than zero.", 400, "INVALID_AMOUNT");
  }
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

const validateText = (value, label, maxLength, { required = false } = {}) => {
  if (value !== null && value !== undefined && typeof value !== "string") {
    throw fail(`${label} must be text.`, 400, "INVALID_INPUT");
  }
  const text = value == null ? "" : value.trim();
  if (required && !text) throw fail(`${label} is required.`, 400, "INVALID_INPUT");
  if (text.length > maxLength) throw fail(`${label} must be ${maxLength} characters or fewer.`, 400, "INVALID_INPUT");
  return text || null;
};

const ensureDistributorParty = async (tx, distributorId) => {
  const distributor = await tx.distributor.findUnique({
    where: { id: distributorId },
    select: { id: true, name: true },
  });
  if (!distributor) throw fail("Distributor profile not found.", 404, "DISTRIBUTOR_NOT_FOUND");
  const party = await ensureAccountingParty({
    partyType: "DISTRIBUTOR",
    sourceEntityId: distributor.id,
    displayName: distributor.name || `Distributor (${distributor.id.slice(-6)})`,
  }, { client: tx });
  return { distributor, party };
};

const getDistributorReceivableBalance = async (tx, partyId) => {
  const result = await tx.accountingDocument.aggregate({
    where: {
      partyId,
      side: "RECEIVABLE",
      sourceType: "DISTRIBUTOR_COD_SALE",
      status: { in: ["OPEN", "PARTIALLY_PAID"] },
    },
    _sum: { remainingAmount: true },
  });
  return new Prisma.Decimal(String(result._sum.remainingAmount || 0));
};

export const getDistributorCashPosition = async ({ distributorId, client = prisma } = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.");
  const party = await client.accountingParty.findUnique({
    where: {
      partyType_sourceEntityId: {
        partyType: "DISTRIBUTOR",
        sourceEntityId: distributorId,
      },
    },
    select: { id: true },
  });
  if (!party) {
    return {
      outstandingReceivable: "0.00",
      pendingRemittance: "0.00",
      refundPayable: "0.00",
      availableToRemit: "0.00",
      availableToOffset: "0.00",
    };
  }

  const [receivableResult, pendingResult, payableResult] = await Promise.all([
    client.accountingDocument.aggregate({
      where: { partyId: party.id, side: "RECEIVABLE", sourceType: "DISTRIBUTOR_COD_SALE", status: { in: ["OPEN", "PARTIALLY_PAID"] } },
      _sum: { remainingAmount: true },
    }),
    client.distributorRemittanceBatch.aggregate({
      where: { distributorId, status: "PENDING_REVIEW" },
      _sum: { amount: true },
    }),
    client.accountingDocument.aggregate({
      where: { partyId: party.id, side: "PAYABLE", sourceType: "DISTRIBUTOR_CUSTOMER_REFUND", status: { in: ["OPEN", "PARTIALLY_PAID"] } },
      _sum: { remainingAmount: true },
    }),
  ]);
  const outstanding = new Prisma.Decimal(String(receivableResult._sum.remainingAmount || 0));
  const pending = new Prisma.Decimal(String(pendingResult._sum.amount || 0));
  const refundPayable = new Prisma.Decimal(String(payableResult._sum.remainingAmount || 0));
  const availableReceivable = Prisma.Decimal.max(outstanding.minus(pending), 0);
  return {
    outstandingReceivable: outstanding.toFixed(2),
    pendingRemittance: pending.toFixed(2),
    refundPayable: refundPayable.toFixed(2),
    availableToRemit: availableReceivable.toFixed(2),
    availableToOffset: Prisma.Decimal.min(availableReceivable, refundPayable).toFixed(2),
  };
};

export const getDistributorCashPositions = async ({ distributorIds = [], client = prisma } = {}) => {
  const ids = [...new Set(distributorIds.filter((id) => typeof id === "string" && id.trim()))];
  if (!ids.length) return new Map();
  const parties = await client.accountingParty.findMany({
    where: { partyType: "DISTRIBUTOR", sourceEntityId: { in: ids } },
    select: { id: true, sourceEntityId: true },
  });
  if (!parties.length) {
    return new Map(ids.map((id) => [id, {
      outstandingReceivable: "0.00",
      pendingRemittance: "0.00",
      refundPayable: "0.00",
      availableToRemit: "0.00",
      availableToOffset: "0.00",
    }]));
  }
  const partyIdToDistributorId = new Map(parties.map((party) => [party.id, party.sourceEntityId]));
  const [documentBalances, pendingBatches] = await Promise.all([
    client.accountingDocument.groupBy({
      by: ["partyId", "side", "sourceType"],
      where: {
        partyId: { in: parties.map((party) => party.id) },
        status: { in: ["OPEN", "PARTIALLY_PAID"] },
        sourceType: { in: ["DISTRIBUTOR_COD_SALE", "DISTRIBUTOR_CUSTOMER_REFUND"] },
      },
      _sum: { remainingAmount: true },
    }),
    client.distributorRemittanceBatch.groupBy({
      by: ["distributorId"],
      where: { distributorId: { in: ids }, status: "PENDING_REVIEW" },
      _sum: { amount: true },
    }),
  ]);
  const balances = new Map(ids.map((id) => [id, {
    outstanding: new Prisma.Decimal(0),
    refund: new Prisma.Decimal(0),
    pending: new Prisma.Decimal(0),
  }]));
  for (const document of documentBalances) {
    const distributorId = partyIdToDistributorId.get(document.partyId);
    const balance = balances.get(distributorId);
    if (!balance) continue;
    const amount = new Prisma.Decimal(String(document._sum.remainingAmount || 0));
    if (document.side === "RECEIVABLE" && document.sourceType === "DISTRIBUTOR_COD_SALE") {
      balance.outstanding = balance.outstanding.plus(amount);
    } else if (document.side === "PAYABLE" && document.sourceType === "DISTRIBUTOR_CUSTOMER_REFUND") {
      balance.refund = balance.refund.plus(amount);
    }
  }
  for (const batch of pendingBatches) {
    const balance = balances.get(batch.distributorId);
    if (balance) balance.pending = new Prisma.Decimal(String(batch._sum.amount || 0));
  }
  return new Map([...balances].map(([id, balance]) => {
    const available = Prisma.Decimal.max(balance.outstanding.minus(balance.pending), 0);
    return [id, {
      outstandingReceivable: balance.outstanding.toFixed(2),
      pendingRemittance: balance.pending.toFixed(2),
      refundPayable: balance.refund.toFixed(2),
      availableToRemit: available.toFixed(2),
      availableToOffset: Prisma.Decimal.min(available, balance.refund).toFixed(2),
    }];
  }));
};

export const listDistributorSettlementOffsets = async ({ distributorId, take = 50, client = prisma } = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.");
  if (!Number.isInteger(Number(take)) || Number(take) < 1 || Number(take) > 100) {
    throw fail("Settlement offset page size must be from 1 to 100.", 400, "INVALID_PAGE_SIZE");
  }
  return client.distributorSettlementOffset.findMany({
    where: { distributorId },
    orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
    take: Number(take),
    select: {
      id: true,
      amount: true,
      approvedAt: true,
      approvedByAccountId: true,
      notes: true,
      journalEntryId: true,
      idempotencyKey: true,
    },
  });
};

export const netDistributorRefundPayable = async ({
  distributorId,
  amount,
  idempotencyKey,
  reviewerAccountId = null,
  notes = null,
  actorContext = {},
  client = prisma,
  journalPoster = postJournalEntry,
  allocationService = allocatePaymentToDocuments,
  now = new Date(),
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.");
  const offsetAmount = parseMoney(amount);
  const normalizedKey = validateText(idempotencyKey, "Idempotency key", 120, { required: true });
  const reviewNotes = validateText(notes, "Netting notes", 2000);
  const offsetKey = `DISTRIBUTOR_SETTLEMENT_NETTING:${normalizedKey}`;
  const journalKey = offsetKey;

  try {
    return await client.$transaction(async (tx) => {
      const replay = await tx.distributorSettlementOffset.findUnique({
        where: { idempotencyKey: offsetKey },
      });
      if (replay) {
        if (
          replay.distributorId !== distributorId ||
          !new Prisma.Decimal(String(replay.amount)).equals(offsetAmount)
        ) {
          throw fail("This idempotency key was already used with different settlement details.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return { success: true, offset: replay, isReplay: true };
      }

      const { party } = await ensureDistributorParty(tx, distributorId);
      const [receivableResult, payableResult, pendingResult] = await Promise.all([
        tx.accountingDocument.aggregate({
          where: {
            partyId: party.id,
            side: "RECEIVABLE",
            sourceType: "DISTRIBUTOR_COD_SALE",
            status: { in: ["OPEN", "PARTIALLY_PAID"] },
          },
          _sum: { remainingAmount: true },
        }),
        tx.accountingDocument.aggregate({
          where: {
            partyId: party.id,
            side: "PAYABLE",
            sourceType: "DISTRIBUTOR_CUSTOMER_REFUND",
            status: { in: ["OPEN", "PARTIALLY_PAID"] },
          },
          _sum: { remainingAmount: true },
        }),
        tx.distributorRemittanceBatch.aggregate({
          where: { distributorId, status: "PENDING_REVIEW" },
          _sum: { amount: true },
        }),
      ]);
      const receivable = new Prisma.Decimal(String(receivableResult._sum.remainingAmount || 0));
      const payable = new Prisma.Decimal(String(payableResult._sum.remainingAmount || 0));
      const pendingRemittance = new Prisma.Decimal(String(pendingResult._sum.amount || 0));
      const availableReceivable = Prisma.Decimal.max(receivable.minus(pendingRemittance), 0);
      const availableToOffset = Prisma.Decimal.min(availableReceivable, payable);
      if (offsetAmount.greaterThan(availableToOffset)) {
        throw fail(
          `Offset exceeds the available verified balances of NPR ${availableToOffset.toFixed(2)}.`,
          409,
          "OFFSET_EXCEEDS_AVAILABLE_BALANCE",
        );
      }

      const journal = await journalPoster({
        transactionDate: now,
        sourceType: "DISTRIBUTOR_SETTLEMENT_NETTING",
        sourceId: normalizedKey,
        idempotencyKey: journalKey,
        referenceNumber: `NET-${distributorId.slice(-8)}`,
        description: `Admin-approved offset of distributor COD receivable and refund payable`,
        createdBy: reviewerAccountId || "admin",
        lines: [
          {
            accountCode: "2190",
            debit: offsetAmount.toNumber(),
            credit: 0,
            accountingPartyId: party.id,
            description: "Clear verified payable for distributor-funded customer refund",
          },
          {
            accountCode: "1190",
            debit: 0,
            credit: offsetAmount.toNumber(),
            accountingPartyId: party.id,
            description: "Apply distributor COD receivable against approved refund payable",
          },
        ],
      }, { client: tx });
      if (!journal) throw fail("Settlement offset journal could not be posted.", 500, "OFFSET_ACCOUNTING_FAILED");

      const [receivableAllocation, payableAllocation] = await Promise.all([
        allocationService({
          partyId: party.id,
          side: "RECEIVABLE",
          amount: offsetAmount,
          journalEntryId: journal.id,
          sourceTypes: ["DISTRIBUTOR_COD_SALE"],
          notes: `Admin-approved offset against distributor refund payable. ${reviewNotes || ""}`.trim(),
          idempotencyKey: `${offsetKey}:AR`,
        }, { client: tx }),
        allocationService({
          partyId: party.id,
          side: "PAYABLE",
          amount: offsetAmount,
          journalEntryId: journal.id,
          sourceTypes: ["DISTRIBUTOR_CUSTOMER_REFUND"],
          notes: `Admin-approved offset against distributor COD receivable. ${reviewNotes || ""}`.trim(),
          idempotencyKey: `${offsetKey}:AP`,
        }, { client: tx }),
      ]);
      if (
        !receivableAllocation.unallocatedAmount.equals(0) ||
        !payableAllocation.unallocatedAmount.equals(0)
      ) {
        throw fail("The offset could not be fully allocated to both distributor balances.", 409, "OFFSET_ALLOCATION_INCOMPLETE");
      }

      const offset = await tx.distributorSettlementOffset.create({
        data: {
          distributorId,
          amount: offsetAmount,
          journalEntryId: journal.id,
          idempotencyKey: offsetKey,
          approvedByAccountId: reviewerAccountId,
          approvedAt: now,
          notes: reviewNotes,
        },
      });
      await recordSystemAudit({
        ...actorContext,
        actorId: reviewerAccountId,
        actorRole: "ADMIN",
        portalSource: "ADMIN",
      }, {
        action: "DISTRIBUTOR_REFUND_RECEIVABLE_NETTING_APPROVED",
        entityType: "DistributorSettlementOffset",
        entityId: offset.id,
        beforeState: {
          openCodReceivable: receivable.toFixed(2),
          openRefundPayable: payable.toFixed(2),
          pendingRemittance: pendingRemittance.toFixed(2),
        },
        afterState: {
          amount: offsetAmount.toFixed(2),
          journalEntryId: journal.id,
          notes: reviewNotes,
        },
      }, { client: tx });
      return { success: true, offset, journalEntryId: journal.id, isReplay: false };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2034") {
      throw fail("Distributor balances changed while approving the offset. Refresh and retry.", 409, "OFFSET_CONCURRENCY_CONFLICT");
    }
    if (error?.code === "P2002") {
      const replay = await client.distributorSettlementOffset.findUnique({
        where: { idempotencyKey: offsetKey },
      });
      if (replay) {
        if (
          replay.distributorId !== distributorId ||
          !new Prisma.Decimal(String(replay.amount)).equals(offsetAmount)
        ) {
          throw fail("This idempotency key was already used with different settlement details.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return { success: true, offset: replay, isReplay: true };
      }
    }
    throw error;
  }
};

export const listDistributorRemittances = async ({ distributorId, take = 50, cursor = null, client = prisma } = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.");
  const pageSize = Number(take);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw fail("Remittance page size must be from 1 to 100.", 400, "INVALID_PAGE_SIZE");
  }
  return client.distributorRemittanceBatch.findMany({
    where: { distributorId },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: String(cursor) }, skip: 1 } : {}),
    take: pageSize,
    select: {
      id: true,
      amount: true,
      receivedAt: true,
      reference: true,
      evidenceUrl: true,
      status: true,
      reviewedAt: true,
      reviewNotes: true,
      financialAccount: { select: { id: true, accountName: true } },
      events: {
        where: { eventType: "COMPANY_REMITTANCE" },
        take: 1,
        select: { id: true, status: true, journalEntryId: true, cashTransactionId: true },
      },
    },
  });
};

export const settleDistributorRefundPayable = async ({
  distributorId,
  accountingDocumentId,
  financialAccountId,
  amount,
  idempotencyKey,
  reviewerAccountId = null,
  actorContext = {},
  client = prisma,
  paymentAccountingPoster = postSupplierPaymentAccounting,
  now = new Date(),
} = {}) => {
  if (!distributorId || !accountingDocumentId || !financialAccountId) {
    throw fail("Distributor, payable, and treasury account are required.");
  }
  const payoutAmount = parseMoney(amount);
  const normalizedKey = validateText(idempotencyKey, "Idempotency key", 150, { required: true });

  try {
    return await client.$transaction(async (tx) => {
      const eventKey = `DISTRIBUTOR_REFUND_PAYOUT:${normalizedKey}`;
      const replay = await tx.distributorCashEvent.findUnique({ where: { idempotencyKey: eventKey } });
      if (replay) {
        if (
          replay.distributorId !== distributorId ||
          replay.accountingDocumentId !== accountingDocumentId ||
          !new Prisma.Decimal(String(replay.amount)).equals(payoutAmount)
        ) {
          throw fail("This payout idempotency key was already used with different details.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return { success: true, cashEvent: replay, isReplay: true };
      }

      const { distributor, party } = await ensureDistributorParty(tx, distributorId);
      const document = await tx.accountingDocument.findFirst({
        where: {
          id: accountingDocumentId,
          partyId: party.id,
          side: "PAYABLE",
          sourceType: "DISTRIBUTOR_CUSTOMER_REFUND",
          status: { in: ["OPEN", "PARTIALLY_PAID"] },
        },
      });
      if (!document) throw fail("Open verified distributor refund payable was not found.", 404, "REFUND_PAYABLE_NOT_FOUND");
      if (payoutAmount.greaterThan(new Prisma.Decimal(String(document.remainingAmount)))) {
        throw fail("Payout exceeds the remaining distributor refund payable.", 409, "PAYOUT_EXCEEDS_PAYABLE");
      }

      const account = await tx.financialAccount.findUnique({
        where: { id: financialAccountId },
        include: { accountingAccount: { select: { accountType: true, normalBalance: true } } },
      });
      if (
        !account ||
        account.status !== "ACTIVE" ||
        account.currency !== "NPR" ||
        !["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
      ) {
        throw fail("Selected active NPR treasury account was not found.", 404, "TREASURY_ACCOUNT_NOT_FOUND");
      }
      if (account.accountingAccountId && (
        account.accountingAccount?.accountType !== "ASSET" ||
        account.accountingAccount?.normalBalance !== "DEBIT"
      )) {
        throw fail("The selected treasury account must map to a debit-balance asset account.", 409, "INVALID_TREASURY_GL_MAPPING");
      }
      if (Number(account.currentBalance) < payoutAmount.toNumber()) {
        throw fail("The selected treasury account does not have enough available balance.", 409, "INSUFFICIENT_TREASURY_BALANCE");
      }

      const journal = await paymentAccountingPoster({
        payableId: document.id,
        payeeName: distributor.name,
        amount: payoutAmount.toNumber(),
        settlementAmount: payoutAmount.toNumber(),
        fromAccountType: String(account.accountType).toUpperCase(),
        cashAccountId: account.accountingAccountId || null,
        accountingPartyId: party.id,
        payableAccountCode: "2190",
        referenceNumber: `DREF-${document.id}`,
        idempotencyKey: eventKey,
        client: tx,
      });
      if (!journal) throw fail("Distributor refund payout accounting could not be posted.", 500, "REFUND_PAYOUT_ACCOUNTING_FAILED");

      const allocation = await allocatePaymentToDocuments({
        partyId: party.id,
        side: "PAYABLE",
        amount: payoutAmount,
        journalEntryId: journal.id,
        targetDocumentIds: [document.id],
        idempotencyKey: eventKey,
        notes: `Settle distributor refund payable ${document.documentNumber}.`,
      }, { client: tx });
      if (!allocation.unallocatedAmount.equals(0)) {
        throw fail("Payout could not be fully allocated to the selected refund payable.", 409, "PAYOUT_ALLOCATION_INCOMPLETE");
      }

      const balanceUpdate = await tx.financialAccount.updateMany({
        where: { id: account.id, status: "ACTIVE", currentBalance: { gte: payoutAmount.toNumber() } },
        data: { currentBalance: { decrement: payoutAmount.toNumber() } },
      });
      if (balanceUpdate.count !== 1) {
        throw fail("Treasury balance changed during payout. Refresh and retry.", 409, "TREASURY_BALANCE_CONFLICT");
      }
      const cashTransaction = await tx.cashTransaction.create({
        data: {
          idempotencyKey: eventKey,
          amount: payoutAmount.toNumber(),
          type: "OUTFLOW",
          fromAccountId: account.id,
          category: "REFUND",
          partyName: distributor.name,
          invoiceNumber: document.documentNumber,
          referenceId: document.sourceId,
          description: `Payout against verified distributor refund ${document.documentNumber}`,
          date: now,
        },
      });
      const cashEvent = await tx.distributorCashEvent.create({
        data: {
          distributorId,
          customerReturnId: document.sourceId,
          accountingDocumentId: document.id,
          eventType: "DISTRIBUTOR_REFUND_REIMBURSEMENT",
          amount: payoutAmount,
          status: "POSTED",
          paymentMethod: String(account.accountType).toUpperCase(),
          idempotencyKey: eventKey,
          occurredAt: now,
          recordedByAccountId: reviewerAccountId,
          verifiedByAccountId: reviewerAccountId,
          verifiedAt: now,
          journalEntryId: journal.id,
          cashTransactionId: cashTransaction.id,
          notes: "Admin payout against verified distributor customer-refund payable.",
        },
      });
      await recordSystemAudit({
        ...actorContext,
        actorId: reviewerAccountId,
        actorRole: "ADMIN",
        portalSource: "ADMIN",
      }, {
        action: "DISTRIBUTOR_REFUND_PAYABLE_SETTLED",
        entityType: "AccountingDocument",
        entityId: document.id,
        beforeState: { remainingAmount: document.remainingAmount.toString() },
        afterState: {
          amount: payoutAmount.toFixed(2),
          journalEntryId: journal.id,
          cashTransactionId: cashTransaction.id,
          cashEventId: cashEvent.id,
        },
      }, { client: tx });
      return { success: true, cashEvent, isReplay: false };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2034") {
      throw fail("Another payout changed this payable or treasury balance. Refresh and retry.", 409, "PAYOUT_CONFLICT");
    }
    if (String(error?.message || "").includes("changed during payment allocation")) {
      throw fail("Another payout changed this payable. Refresh and retry.", 409, "PAYOUT_CONFLICT");
    }
    if (error?.code === "P2002") {
      const replay = await client.distributorCashEvent.findUnique({
        where: { idempotencyKey: `DISTRIBUTOR_REFUND_PAYOUT:${normalizedKey}` },
      });
      if (
        replay &&
        replay.distributorId === distributorId &&
        replay.accountingDocumentId === accountingDocumentId &&
        new Prisma.Decimal(String(replay.amount)).equals(payoutAmount)
      ) {
        return { success: true, cashEvent: replay, isReplay: true };
      }
    }
    throw error;
  }
};

export const submitDistributorRemittance = async ({
  distributorId,
  amount,
  reference,
  evidenceUrl = null,
  idempotencyKey,
  recordedByAccountId = null,
  client = prisma,
  now = new Date(),
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.");
  const decAmount = parseMoney(amount);
  const normalizedReference = validateText(reference, "Transfer reference", 191, { required: true });
  const normalizedEvidenceUrl = validateText(evidenceUrl, "Evidence URL", 2000, { required: true });
  if (!/^https:\/\//i.test(normalizedEvidenceUrl)) {
    throw fail("Evidence URL must use HTTPS.", 400, "INVALID_EVIDENCE_URL");
  }
  const normalizedKey = validateText(idempotencyKey, "Idempotency key", 160, { required: true });

  try {
    return await client.$transaction(async (tx) => {
      const replay = await tx.distributorRemittanceBatch.findUnique({
        where: { idempotencyKey: normalizedKey },
      });
      if (replay) {
        if (
          replay.distributorId !== distributorId ||
          !new Prisma.Decimal(String(replay.amount)).equals(decAmount) ||
          replay.reference !== normalizedReference ||
          replay.evidenceUrl !== normalizedEvidenceUrl
        ) {
          throw fail("This idempotency key was already used with different remittance details.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return { success: true, remittance: replay, isReplay: true };
      }

      const { party } = await ensureDistributorParty(tx, distributorId);
      const [outstanding, pendingResult] = await Promise.all([
        getDistributorReceivableBalance(tx, party.id),
        tx.distributorRemittanceBatch.aggregate({
          where: { distributorId, status: "PENDING_REVIEW" },
          _sum: { amount: true },
        }),
      ]);
      const pending = new Prisma.Decimal(String(pendingResult._sum.amount || 0));
      const available = outstanding.minus(pending);
      if (decAmount.greaterThan(available)) {
        throw fail(
          `Remittance exceeds the available distributor receivable of NPR ${Prisma.Decimal.max(available, 0).toFixed(2)}.`,
          409,
          "REMITTANCE_EXCEEDS_RECEIVABLE",
        );
      }

      const batch = await tx.distributorRemittanceBatch.create({
        data: {
          distributorId,
          amount: decAmount,
          reference: normalizedReference,
          evidenceUrl: normalizedEvidenceUrl,
          status: "PENDING_REVIEW",
          idempotencyKey: normalizedKey,
          recordedByAccountId,
          receivedAt: now,
        },
      });
      await tx.distributorCashEvent.create({
        data: {
          distributorId,
          remittanceBatchId: batch.id,
          eventType: "COMPANY_REMITTANCE",
          amount: decAmount,
          status: "PENDING_VERIFICATION",
          externalReference: normalizedReference,
          evidenceUrl: normalizedEvidenceUrl,
          idempotencyKey: `DISTRIBUTOR_REMITTANCE:${normalizedKey}`,
          occurredAt: now,
          recordedByAccountId,
        },
      });
      await recordSystemAudit({
        actorId: recordedByAccountId,
        actorRole: "DISTRIBUTOR",
        portalSource: "DISTRIBUTOR",
      }, {
        action: "DISTRIBUTOR_COD_REMITTANCE_SUBMITTED",
        entityType: "DistributorRemittanceBatch",
        entityId: batch.id,
        afterState: { amount: decAmount.toFixed(2), reference: normalizedReference },
      }, { client: tx });
      return { success: true, remittance: batch, isReplay: false };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2002") {
      const replay = await client.distributorRemittanceBatch.findUnique({
        where: { idempotencyKey: normalizedKey },
      });
      if (replay) {
        if (
          replay.distributorId !== distributorId ||
          !new Prisma.Decimal(String(replay.amount)).equals(decAmount) ||
          replay.reference !== normalizedReference ||
          replay.evidenceUrl !== normalizedEvidenceUrl
        ) {
          throw fail("This idempotency key was already used with different remittance details.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return { success: true, remittance: replay, isReplay: true };
      }
    }
    if (error?.code === "P2034") {
      throw fail("Another remittance changed this balance. Refresh the statement and retry.", 409, "REMITTANCE_CONCURRENCY_CONFLICT");
    }
    if (String(error?.message || "").includes("changed during payment allocation")) {
      throw fail("Another remittance changed the receivable allocation. Refresh and retry.", 409, "REMITTANCE_CONCURRENCY_CONFLICT");
    }
    throw error;
  }
};

export const reviewDistributorRemittance = async ({
  distributorId,
  batchId,
  decision,
  financialAccountId = null,
  reviewNotes = null,
  reviewerAccountId = null,
  actorContext = {},
  client = prisma,
  now = new Date(),
} = {}) => {
  if (!distributorId || !batchId) throw fail("Distributor and remittance IDs are required.");
  const normalizedDecision = String(decision || "").trim().toUpperCase();
  if (!["VERIFY", "REJECT"].includes(normalizedDecision)) {
    throw fail("Decision must be VERIFY or REJECT.", 400, "INVALID_REMITTANCE_DECISION");
  }
  const notes = validateText(reviewNotes, "Review notes", 2000);
  if (normalizedDecision === "VERIFY" && !financialAccountId) {
    throw fail("A company treasury account is required to verify the deposit.", 400, "TREASURY_ACCOUNT_REQUIRED");
  }

  try {
    return await client.$transaction(async (tx) => {
      const batch = await tx.distributorRemittanceBatch.findFirst({
        where: { id: batchId, distributorId },
      });
      if (!batch) throw fail("Distributor remittance was not found.", 404, "REMITTANCE_NOT_FOUND");
      if (batch.status === "VERIFIED") {
        if (normalizedDecision !== "VERIFY" || batch.financialAccountId !== financialAccountId) {
          throw fail("This remittance has already been verified.", 409, "REMITTANCE_ALREADY_REVIEWED");
        }
        return { success: true, remittance: batch, isReplay: true };
      }
      if (batch.status === "REJECTED") {
        if (normalizedDecision !== "REJECT") throw fail("This remittance has already been rejected.", 409, "REMITTANCE_ALREADY_REVIEWED");
        return { success: true, remittance: batch, isReplay: true };
      }
      if (batch.status !== "PENDING_REVIEW") {
        throw fail("Remittance is not awaiting review.", 409, "REMITTANCE_NOT_PENDING");
      }

      const { distributor, party } = await ensureDistributorParty(tx, distributorId);
      if (normalizedDecision === "REJECT") {
        const claimed = await tx.distributorRemittanceBatch.updateMany({
          where: { id: batch.id, distributorId, status: "PENDING_REVIEW" },
          data: {
            status: "REJECTED",
            reviewedByAccountId: reviewerAccountId,
            reviewedAt: now,
            reviewNotes: notes,
          },
        });
        if (claimed.count !== 1) throw fail("Remittance status changed concurrently.", 409, "REMITTANCE_CONCURRENCY_CONFLICT");
        await tx.distributorCashEvent.updateMany({
          where: { remittanceBatchId: batch.id, eventType: "COMPANY_REMITTANCE", status: "PENDING_VERIFICATION" },
          data: { status: "REJECTED", verifiedByAccountId: reviewerAccountId, verifiedAt: now },
        });
        await recordSystemAudit({
          ...actorContext,
          actorId: reviewerAccountId,
          actorRole: "ADMIN",
          portalSource: "ADMIN",
        }, {
          action: "DISTRIBUTOR_COD_REMITTANCE_REJECTED",
          entityType: "DistributorRemittanceBatch",
          entityId: batch.id,
          beforeState: { status: batch.status },
          afterState: { status: "REJECTED", reviewNotes: notes },
        }, { client: tx });
        const rejected = await tx.distributorRemittanceBatch.findUnique({ where: { id: batch.id } });
        return { success: true, remittance: rejected, isReplay: false };
      }

      const account = await tx.financialAccount.findUnique({
        where: { id: financialAccountId },
        include: { accountingAccount: { select: { accountType: true, normalBalance: true } } },
      });
      if (
        !account ||
        account.status !== "ACTIVE" ||
        account.currency !== "NPR" ||
        !["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
      ) {
        throw fail("Selected active NPR treasury account was not found.", 404, "TREASURY_ACCOUNT_NOT_FOUND");
      }
      if (
        account.accountingAccountId &&
        (account.accountingAccount?.accountType !== "ASSET" || account.accountingAccount?.normalBalance !== "DEBIT")
      ) {
        throw fail("The selected treasury account must map to a debit-balance asset account.", 409, "INVALID_TREASURY_GL_MAPPING");
      }

      const batchAmount = new Prisma.Decimal(String(batch.amount));
      const receivableBalance = await getDistributorReceivableBalance(tx, party.id);
      if (batchAmount.greaterThan(receivableBalance)) {
        throw fail("Verified remittance exceeds the distributor's open COD receivable.", 409, "REMITTANCE_EXCEEDS_RECEIVABLE");
      }

      const bankLine = account.accountingAccountId
        ? { accountId: account.accountingAccountId, debit: batchAmount, credit: 0 }
        : { mappingKey: "BANK", debit: batchAmount, credit: 0 };
      const journal = await postJournalEntry({
        transactionDate: now,
        sourceType: "DISTRIBUTOR_REMITTANCE",
        sourceId: batch.id,
        idempotencyKey: `DISTRIBUTOR_REMITTANCE:${batch.id}`,
        referenceNumber: batch.reference || batch.id,
        description: `Verified COD remittance from ${distributor.name}`,
        lines: [
          {
            ...bankLine,
            description: `Bank receipt for distributor COD remittance ${batch.id}`,
          },
          {
            mappingKey: "DISTRIBUTOR_COD_RECEIVABLE",
            debit: 0,
            credit: batchAmount,
            accountingPartyId: party.id,
            description: `Clear distributor COD receivable for remittance ${batch.id}`,
          },
        ],
        client: tx,
      });

      const allocation = await allocatePaymentToDocuments({
        partyId: party.id,
        side: "RECEIVABLE",
        amount: batchAmount,
        journalEntryId: journal.id,
        sourceTypes: ["DISTRIBUTOR_COD_SALE"],
        idempotencyKey: `DISTRIBUTOR_REMITTANCE:${batch.id}`,
        notes: `Apply verified distributor COD remittance ${batch.id}.`,
      }, { client: tx });
      if (!allocation.unallocatedAmount.equals(0)) {
        throw fail("Remittance could not be fully allocated to distributor receivables.", 409, "REMITTANCE_ALLOCATION_INCOMPLETE");
      }

      await tx.financialAccount.update({
        where: { id: account.id },
        data: { currentBalance: { increment: batchAmount.toNumber() } },
      });
      const cashTransaction = await tx.cashTransaction.create({
        data: {
          idempotencyKey: `DISTRIBUTOR_REMITTANCE:${batch.id}`,
          amount: batchAmount.toNumber(),
          type: "INFLOW",
          toAccountId: account.id,
          category: "SALES",
          partyName: distributor.name,
          invoiceNumber: batch.reference || "",
          referenceId: batch.id,
          description: `Verified distributor COD remittance ${batch.id}`,
        },
      });
      const claimed = await tx.distributorRemittanceBatch.updateMany({
        where: { id: batch.id, distributorId, status: "PENDING_REVIEW" },
        data: {
          status: "VERIFIED",
          financialAccountId: account.id,
          reviewedByAccountId: reviewerAccountId,
          reviewedAt: now,
          reviewNotes: notes,
        },
      });
      if (claimed.count !== 1) throw fail("Remittance status changed concurrently.", 409, "REMITTANCE_CONCURRENCY_CONFLICT");
      const cashEvents = await tx.distributorCashEvent.updateMany({
        where: { remittanceBatchId: batch.id, eventType: "COMPANY_REMITTANCE", status: "PENDING_VERIFICATION" },
        data: {
          status: "POSTED",
          verifiedByAccountId: reviewerAccountId,
          verifiedAt: now,
          journalEntryId: journal.id,
          cashTransactionId: cashTransaction.id,
          notes,
        },
      });
      if (cashEvents.count !== 1) throw fail("Remittance evidence event is missing or already processed.", 409, "REMITTANCE_EVENT_CONFLICT");

      await recordSystemAudit({
        ...actorContext,
        actorId: reviewerAccountId,
        actorRole: "ADMIN",
        portalSource: "ADMIN",
      }, {
        action: "DISTRIBUTOR_COD_REMITTANCE_VERIFIED",
        entityType: "DistributorRemittanceBatch",
        entityId: batch.id,
        beforeState: { status: batch.status },
        afterState: {
          status: "VERIFIED",
          amount: batchAmount.toFixed(2),
          financialAccountId: account.id,
          journalEntryId: journal.id,
          cashTransactionId: cashTransaction.id,
        },
      }, { client: tx });

      const verified = await tx.distributorRemittanceBatch.findUnique({ where: { id: batch.id } });
      return { success: true, remittance: verified, journalEntryId: journal.id, isReplay: false };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2034") {
      throw fail("Another remittance review changed this balance. Refresh and retry.", 409, "REMITTANCE_CONCURRENCY_CONFLICT");
    }
    throw error;
  }
};
