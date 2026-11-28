import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import {
  postJournalEntry,
} from "../services/accountingPostingEngine.js";
import {
  accountingDecimal,
  compareDecimals,
  parseNprAmountString,
} from "../services/accountingDecimal.js";
import { requestAccountingActionApproval } from "../services/accountingActionApprovalService.js";
import { recordCustomerReceipt } from "../services/customerReceiptService.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import {
  getDirectCashOffsetAccountCode,
  normalizeStockReturnExpenseReference,
  validateTreasuryAccountingAccount,
  validateTreasuryAccountTypeMapping,
} from "../services/treasuryAccountingService.js";

const serializeTreasuryAccount = {
  accountingAccount: { select: { id: true, accountCode: true, accountName: true, accountType: true } },
};

const responseForDuplicate = (existing, request) => {
  const sameRequest =
    accountingDecimal(existing.amount, "Stored Treasury amount").equals(request.amount) &&
    existing.type === request.type &&
    (existing.fromAccountId || null) === (request.fromAccountId || null) &&
    (existing.toAccountId || null) === (request.toAccountId || null) &&
    existing.category === request.category &&
    (existing.referenceId || null) === (request.referenceId || null);

  if (!sameRequest) {
    return { status: 409, body: { success: false, message: "This idempotency key was already used for a different Treasury transaction." } };
  }
  return {
    status: 200,
    body: { success: true, alreadyProcessed: true, message: "This transaction was already posted.", transactionId: existing.id },
  };
};

export const getTreasuryAccounts = async (_req, res) => {
  try {
    const accounts = await prisma.financialAccount.findMany({
      include: {
        ...serializeTreasuryAccount,
        inflows: { take: 10, orderBy: { date: "desc" } },
        outflows: { take: 10, orderBy: { date: "desc" } },
      },
      orderBy: { createdAt: "asc" },
    });
    res.json({ success: true, accounts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createTreasuryAccount = async (req, res) => {
  try {
    const { accountName, accountType, accountNumber, bankName, initialBalance = 0, accountingAccountId } = req.body || {};
    if (!String(accountName || "").trim()) {
      return res.status(400).json({ success: false, message: "Account name is required." });
    }

    const openingAmount = new Prisma.Decimal(String(initialBalance || 0));
    if (!openingAmount.isFinite() || openingAmount.isNegative()) {
      return res.status(400).json({ success: false, message: "Opening balance must be a non-negative amount." });
    }
    if (!openingAmount.isZero()) {
      return res.status(400).json({
        success: false,
        message: "Opening balances require an approved opening-balance journal. Create this account with zero balance for now.",
      });
    }

    const treasuryType = String(accountType || "BANK").toUpperCase();
    const glAccount = await validateTreasuryAccountingAccount(accountingAccountId, prisma);
    validateTreasuryAccountTypeMapping(treasuryType, glAccount.accountCode);
    const result = await requestAccountingActionApproval({
      actionType: "TREASURY_ACCOUNT_CREATE",
      requestKey: req.headers?.["idempotency-key"] || req.body?.idempotencyKey || "",
      payload: { ...req.body, accountType: treasuryType },
      actor: { accountId: req.auth?.accountId || req.auth?.userId, role: req.auth?.role },
      auditContext: {
        ipAddress: req.ip || null,
        userAgent: req.get?.("user-agent") || null,
        correlationId: req.correlationId || null,
      },
    });
    res.status(result.isReplay ? 200 : 202).json({
      success: true,
      message: result.isReplay ? "This Treasury account request already exists." : "Treasury account creation submitted for independent Admin approval.",
      approvalRequest: result.approvalRequest,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const mapTreasuryAccount = async (req, res) => {
  try {
    const { financialAccountId, accountingAccountId } = req.body || {};
    if (!financialAccountId || !accountingAccountId) {
      return res.status(400).json({ success: false, message: "Treasury account and GL account are required." });
    }
    const account = await prisma.financialAccount.findUnique({ where: { id: financialAccountId } });
    if (!account) return res.status(404).json({ success: false, message: "Treasury account not found." });
    const glAccount = await validateTreasuryAccountingAccount(accountingAccountId, prisma);
    validateTreasuryAccountTypeMapping(account.accountType, glAccount.accountCode);
    const result = await requestAccountingActionApproval({
      actionType: "TREASURY_GL_MAPPING",
      requestKey: req.headers?.["idempotency-key"] || req.body?.idempotencyKey || "",
      payload: {
        financialAccountId: account.id,
        accountingAccountId: glAccount.id,
        reason: req.body?.reason,
      },
      actor: { accountId: req.auth?.accountId || req.auth?.userId, role: req.auth?.role },
      auditContext: {
        ipAddress: req.ip || null,
        userAgent: req.get?.("user-agent") || null,
        correlationId: req.correlationId || null,
      },
    });
    res.status(result.isReplay ? 200 : 202).json({
      success: true,
      message: result.isReplay ? "This Treasury mapping request already exists." : "Treasury mapping change submitted for independent Admin approval.",
      approvalRequest: result.approvalRequest,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const createRecordCashTransferHandler = ({
  client = prisma,
  postJournal = postJournalEntry,
} = {}) => async (req, res) => {
  const idempotencyKey = String(req.body?.idempotencyKey || req.headers?.["idempotency-key"] || "").trim();
  let request;
  try {
    const { fromAccountId, toAccountId, description } = req.body || {};
    let amount;
    try {
      amount = parseNprAmountString(req.body?.amount, "Treasury amount", { allowZero: false });
    } catch (error) {
      return res.status(400).json({
        success: false,
        code: error.code || "INVALID_TREASURY_AMOUNT",
        message: error.message,
      });
    }
    const type = String(req.body?.type || "").toUpperCase();
    const category = type === "TRANSFER"
      ? "INTERNAL_TRANSFER"
      : type === "INFLOW"
        ? String(req.body?.category || "MISC_INFLOW").toUpperCase()
        : String(req.body?.category || "EXPENSE").toUpperCase();
    const referenceId = normalizeStockReturnExpenseReference({
      type,
      category,
      stockReturnId: req.body?.stockReturnId,
    });

    if (!idempotencyKey) {
      return res.status(400).json({ success: false, message: "An idempotency key is required." });
    }

    if (referenceId) {
      const stockReturn = await client.distributorStockReturn.findUnique({
        where: { id: referenceId },
        select: { id: true },
      });
      if (!stockReturn) {
        return res.status(404).json({ success: false, message: "Stock return reference was not found." });
      }
    }

    request = { amount, type, fromAccountId, toAccountId, category, referenceId };
    const existing = await client.cashTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) {
      const duplicate = responseForDuplicate(existing, request);
      return res.status(duplicate.status).json(duplicate.body);
    }

    const isTransfer = type === "TRANSFER" && fromAccountId && toAccountId;
    const isReceipt = type === "INFLOW" && toAccountId;
    const isPayment = type === "OUTFLOW" && fromAccountId;
    if (!isTransfer && !isReceipt && !isPayment) {
      return res.status(400).json({ success: false, message: "Unsupported Treasury movement." });
    }
    if (isTransfer && fromAccountId === toAccountId) {
      return res.status(400).json({ success: false, message: "Choose different source and destination accounts." });
    }

    const sourceId = isPayment || isTransfer ? fromAccountId : toAccountId;
    const destinationId = isReceipt || isTransfer ? toAccountId : null;
    const [sourceAccount, destinationAccount] = await Promise.all([
      client.financialAccount.findUnique({ where: { id: sourceId } }),
      destinationId ? client.financialAccount.findUnique({ where: { id: destinationId } }) : Promise.resolve(null),
    ]);
    if (!sourceAccount || (destinationId && !destinationAccount)) {
      return res.status(404).json({ success: false, message: "Treasury source or destination account not found." });
    }
    if (!sourceAccount.accountingAccountId || (destinationAccount && !destinationAccount.accountingAccountId)) {
      return res.status(409).json({ success: false, message: "Map all Treasury accounts to GL accounts before recording this movement." });
    }
    if (isPayment && compareDecimals(sourceAccount.currentBalance, amount) < 0) {
      return res.status(400).json({ success: false, message: `Insufficient funds in ${sourceAccount.accountName}.` });
    }

    let offsetAccount = null;
    if (!isTransfer) {
      const offsetCode = getDirectCashOffsetAccountCode(type, category);
      offsetAccount = await client.account.findUnique({ where: { accountCode: offsetCode } });
      if (!offsetAccount?.isActive) {
        return res.status(409).json({ success: false, message: `Accounting account ${offsetCode} is unavailable.` });
      }
    }

    const result = await client.$transaction(async (tx) => {
      if (referenceId) {
        const linkedReturn = await tx.distributorStockReturn.findUnique({
          where: { id: referenceId },
          select: { id: true },
        });
        if (!linkedReturn) {
          throw Object.assign(new Error("Stock return reference was not found."), { statusCode: 404 });
        }
      }
      if (isPayment || isTransfer) {
        const debitResult = await tx.financialAccount.updateMany({
          where: { id: sourceId, currentBalance: { gte: amount } },
          data: { currentBalance: { decrement: amount } },
        });
        if (debitResult.count !== 1) {
          throw Object.assign(new Error("Treasury funds changed or are insufficient; refresh and retry."), { statusCode: 409 });
        }
      }
      if (isReceipt || isTransfer) {
        await tx.financialAccount.update({
          where: { id: destinationId },
          data: { currentBalance: { increment: amount } },
        });
      }

      const cashTransaction = await tx.cashTransaction.create({
        data: {
          idempotencyKey,
          amount,
          type,
          fromAccountId: isPayment || isTransfer ? sourceId : null,
          toAccountId: isReceipt || isTransfer ? destinationId : null,
          category,
          referenceId: referenceId || undefined,
          partyName: String(req.body?.partyName || req.body?.payeeName || "").trim(),
          invoiceNumber: String(req.body?.invoiceNumber || "").trim(),
          description: description || `${type} - ${category}`,
        },
      });

      const journalLines = isTransfer
        ? [
            { accountId: destinationAccount.accountingAccountId, debit: amount, credit: 0, description: `Transfer into ${destinationAccount.accountName}` },
            { accountId: sourceAccount.accountingAccountId, debit: 0, credit: amount, description: `Transfer out of ${sourceAccount.accountName}` },
          ]
        : isReceipt
          ? [
              { accountId: sourceAccount.accountingAccountId, debit: amount, credit: 0, description: `${category} receipt` },
              { accountId: offsetAccount.id, debit: 0, credit: amount, description: `${category} receipt` },
            ]
          : [
              { accountId: offsetAccount.id, debit: amount, credit: 0, description: `${category} payment` },
              { accountId: sourceAccount.accountingAccountId, debit: 0, credit: amount, description: `${category} payment` },
            ];

      await postJournal({
        transactionDate: new Date(),
        sourceType: isTransfer ? "TREASURY_TRANSFER" : "TREASURY_ENTRY",
        sourceId: cashTransaction.id,
        idempotencyKey: `${isTransfer ? "TREASURY_TRANSFER" : "TREASURY_ENTRY"}:${idempotencyKey}`,
        referenceNumber: String(req.body?.invoiceNumber || "").trim() || `TREASURY-${cashTransaction.id.slice(-8)}`,
        description: description || `${type} - ${category}`,
        lines: journalLines,
        createdBy: req.auth?.email || "admin",
        client: tx,
      });
      return cashTransaction;
    });

    return res.json({ success: true, message: "Treasury movement and journal posted.", transactionId: result.id });
  } catch (error) {
    if (error.code === "P2002" && idempotencyKey && request) {
      const existing = await client.cashTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        const duplicate = responseForDuplicate(existing, request);
        return res.status(duplicate.status).json(duplicate.body);
      }
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      ...(error.code ? { code: error.code } : {}),
      message: error.message || "Treasury movement failed.",
    });
  }
};

export const recordCashTransfer = createRecordCashTransferHandler();

export const collectReceivable = async (req, res) => {
  const idempotencyKey = String(req.body?.idempotencyKey || req.headers?.["idempotency-key"] || "").trim();
  try {
    const { receivableId, toAccountId, notes } = req.body || {};
    const invoiceIds = req.body?.invoiceIds || req.body?.invoiceId || receivableId;
    if (!idempotencyKey || idempotencyKey.length > 120 || /\s/.test(idempotencyKey)) {
      return res.status(400).json({
        success: false,
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "A valid receipt idempotency key of at most 120 characters is required.",
      });
    }
    if (!invoiceIds || typeof toAccountId !== "string" || !toAccountId.trim()) {
      return res.status(400).json({ success: false, code: "RECEIPT_SOURCE_REQUIRED", message: "A customer invoice and deposit Treasury account are required." });
    }
    const actorAccountId = req.auth?.accountId || req.auth?.userId || req.auth?.sub;
    if (!actorAccountId) {
      return res.status(401).json({ success: false, code: "RECEIPT_ACTOR_REQUIRED", message: "An authenticated receiving actor is required." });
    }
    const ncmSettlement = req.body?.invoiceIds || req.body?.invoiceId
      ? null
      : await prisma.deliveryFinancialSettlement.findFirst({
        where: { OR: [{ id: receivableId }, { deliveryOrderId: receivableId }] },
      });
    if (ncmSettlement) {
      let expectedNetDeposit;
      try {
        expectedNetDeposit = parseNprAmountString(req.body?.amount, "Actual received amount", { allowZero: false });
      } catch (error) {
        return res.status(400).json({ success: false, code: error.code || "INVALID_RECEIPT_AMOUNT", message: error.message });
      }
      const settlementReason = String(req.body?.description || notes || "").trim();
      const result = await requestAccountingActionApproval({
        actionType: "NCM_SETTLEMENT_CONFIRM",
        requestKey: idempotencyKey,
        payload: {
          settlementIds: [ncmSettlement.id],
          financialAccountId: toAccountId,
          expectedNetDeposit: expectedNetDeposit.toFixed(2),
          reference: idempotencyKey,
          notes,
          reason: settlementReason,
          createdBy: req.auth?.email || "admin",
        },
        actor: {
          accountId: actorAccountId,
          role: req.auth?.role,
        },
        auditContext: {
          ipAddress: req.ip || null,
          userAgent: req.headers?.["user-agent"] || null,
          correlationId: req.correlationId || null,
        },
      });
      return res.json({
        success: true,
        alreadyPending: true,
        message: result.isReplay
          ? "This NCM remittance approval request already exists."
          : "NCM remittance submitted for independent Admin approval.",
        approvalRequest: result.approvalRequest,
      });
    }

    if (String(receivableId).startsWith("AR-MFG-DIRECT-")) {
      return res.status(409).json({
        success: false,
        message: "This legacy manufacturer balance has no posted AR document. Create and reconcile a documented receivable before collecting it.",
      });
    }
    const receipt = await recordCustomerReceipt({
      invoiceIds,
      amount: req.body?.amount,
      adjustmentType: req.body?.adjustmentType,
      adjustmentAmount: req.body?.adjustmentAmount,
      toAccountId,
      tenderMethod: req.body?.tenderMethod,
      evidenceReference: req.body?.evidenceReference,
      notes,
      idempotencyKey,
      receivedByAccountId: actorAccountId,
    }, {
      auditContext: {
        actorRole: req.auth?.role || null,
        portalSource: "ADMIN",
        ipAddress: req.ip || null,
        userAgent: req.headers?.["user-agent"] || null,
        correlationId: req.correlationId || null,
      },
    });
    return res.json({
      success: true,
      ...receipt,
      message: receipt.alreadyProcessed
        ? "This customer receipt was already recorded."
        : `NPR ${receipt.amount} received and allocated against customer invoice(s).`,
    });
  } catch (error) {
    const status = error.code === "P2002" ? 409 : error.statusCode || 500;
    return res.status(status).json({
      success: false,
      code: error.code || "RECEIPT_POSTING_FAILED",
      message: error.message || "Receipt posting failed.",
    });
  }
};

export const getCashTransactions = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const [transactions, total] = await prisma.$transaction([
      prisma.cashTransaction.findMany({
        include: {
          fromAccount: { select: { accountName: true, accountType: true } },
          toAccount: { select: { accountName: true, accountType: true } },
        },
        orderBy: { date: "desc" },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.cashTransaction.count(),
    ]);
    res.json(paginatedResponse("transactions", transactions, pagination, total));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
