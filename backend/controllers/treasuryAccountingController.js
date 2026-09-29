import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import {
  postCustomerPaymentAccounting,
  postJournalEntry,
  postNcmRemittanceAccounting,
} from "../services/accountingPostingEngine.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import {
  getDirectCashOffsetAccountCode,
  validateTreasuryAccountingAccount,
  validateTreasuryAccountTypeMapping,
} from "../services/treasuryAccountingService.js";

const serializeTreasuryAccount = {
  accountingAccount: { select: { id: true, accountCode: true, accountName: true, accountType: true } },
};

const responseForDuplicate = (existing, request) => {
  const sameRequest =
    Number(existing.amount) === request.amount &&
    existing.type === request.type &&
    (existing.fromAccountId || null) === (request.fromAccountId || null) &&
    (existing.toAccountId || null) === (request.toAccountId || null) &&
    existing.category === request.category;

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
    const account = await prisma.financialAccount.create({
      data: {
        accountName: String(accountName).trim(),
        accountType: treasuryType,
        accountNumber: accountNumber || "",
        bankName: bankName || "",
        currentBalance: 0,
        accountingAccountId: glAccount.id,
      },
      include: serializeTreasuryAccount,
    });
    res.status(201).json({ success: true, message: "Treasury account created and mapped to the GL.", account });
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
    validateTreasuryAccountTypeMapping(treasuryAccount.accountType, glAccount.accountCode);
    const updated = await prisma.financialAccount.update({
      where: { id: account.id },
      data: { accountingAccountId: glAccount.id },
      include: serializeTreasuryAccount,
    });
    res.json({ success: true, account: updated });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const recordCashTransfer = async (req, res) => {
  const idempotencyKey = String(req.body?.idempotencyKey || req.headers?.["idempotency-key"] || "").trim();
  try {
    const { fromAccountId, toAccountId, description } = req.body || {};
    const amount = new Prisma.Decimal(String(req.body?.amount || 0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const type = String(req.body?.type || "").toUpperCase();
    const category = type === "TRANSFER"
      ? "INTERNAL_TRANSFER"
      : type === "INFLOW"
      ? String(req.body?.category || "MISC_INFLOW").toUpperCase()
      : String(req.body?.category || "EXPENSE").toUpperCase();

    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      return res.status(400).json({ success: false, message: "Enter a valid positive amount." });
    }
    if (!idempotencyKey) {
      return res.status(400).json({ success: false, message: "An idempotency key is required." });
    }

    const amountNumber = Number(amount.toFixed(2));
    const request = { amount: amountNumber, type, fromAccountId, toAccountId, category };
    const existing = await prisma.cashTransaction.findUnique({ where: { idempotencyKey } });
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
      prisma.financialAccount.findUnique({ where: { id: sourceId } }),
      destinationId ? prisma.financialAccount.findUnique({ where: { id: destinationId } }) : Promise.resolve(null),
    ]);
    if (!sourceAccount || (destinationId && !destinationAccount)) {
      return res.status(404).json({ success: false, message: "Treasury source or destination account not found." });
    }
    if (!sourceAccount.accountingAccountId || (destinationAccount && !destinationAccount.accountingAccountId)) {
      return res.status(409).json({ success: false, message: "Map all Treasury accounts to GL accounts before recording this movement." });
    }
    if (isPayment && sourceAccount.currentBalance < amountNumber) {
      return res.status(400).json({ success: false, message: `Insufficient funds in ${sourceAccount.accountName}.` });
    }

    let offsetAccount = null;
    if (!isTransfer) {
      const offsetCode = getDirectCashOffsetAccountCode(type, category);
      offsetAccount = await prisma.account.findUnique({ where: { accountCode: offsetCode } });
      if (!offsetAccount?.isActive) {
        return res.status(409).json({ success: false, message: `Accounting account ${offsetCode} is unavailable.` });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      if (isPayment || isTransfer) {
        const debitResult = await tx.financialAccount.updateMany({
          where: { id: sourceId, currentBalance: { gte: amountNumber } },
          data: { currentBalance: { decrement: amountNumber } },
        });
        if (debitResult.count !== 1) {
          throw Object.assign(new Error("Treasury funds changed or are insufficient; refresh and retry."), { statusCode: 409 });
        }
      }
      if (isReceipt || isTransfer) {
        await tx.financialAccount.update({
          where: { id: destinationId },
          data: { currentBalance: { increment: amountNumber } },
        });
      }

      const cashTransaction = await tx.cashTransaction.create({
        data: {
          idempotencyKey,
          amount: amountNumber,
          type,
          fromAccountId: isPayment || isTransfer ? sourceId : null,
          toAccountId: isReceipt || isTransfer ? destinationId : null,
          category,
          partyName: String(req.body?.partyName || req.body?.payeeName || "").trim(),
          invoiceNumber: String(req.body?.invoiceNumber || "").trim(),
          description: description || `${type} - ${category}`,
        },
      });

      const journalLines = isTransfer
        ? [
            { accountId: destinationAccount.accountingAccountId, debit: amountNumber, credit: 0, description: `Transfer into ${destinationAccount.accountName}` },
            { accountId: sourceAccount.accountingAccountId, debit: 0, credit: amountNumber, description: `Transfer out of ${sourceAccount.accountName}` },
          ]
        : isReceipt
        ? [
            { accountId: sourceAccount.accountingAccountId, debit: amountNumber, credit: 0, description: `${category} receipt` },
            { accountId: offsetAccount.id, debit: 0, credit: amountNumber, description: `${category} receipt` },
          ]
        : [
            { accountId: offsetAccount.id, debit: amountNumber, credit: 0, description: `${category} payment` },
            { accountId: sourceAccount.accountingAccountId, debit: 0, credit: amountNumber, description: `${category} payment` },
          ];

      await postJournalEntry({
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
    if (error.code === "P2002" && idempotencyKey) {
      const existing = await prisma.cashTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        const duplicate = responseForDuplicate(existing, {
          amount: Number(req.body?.amount || 0),
          type: String(req.body?.type || "").toUpperCase(),
          fromAccountId: req.body?.fromAccountId,
          toAccountId: req.body?.toAccountId,
          category: String(req.body?.category || (req.body?.type === "INFLOW" ? "MISC_INFLOW" : "EXPENSE")).toUpperCase(),
        });
        return res.status(duplicate.status).json(duplicate.body);
      }
    }
    res.status(error.statusCode || 500).json({ success: false, message: error.message || "Treasury movement failed." });
  }
};

export const collectReceivable = async (req, res) => {
  const idempotencyKey = String(req.body?.idempotencyKey || req.headers?.["idempotency-key"] || "").trim();
  try {
    const { receivableId, toAccountId, notes } = req.body || {};
    const amount = new Prisma.Decimal(String(req.body?.amount || 0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (!receivableId || !toAccountId || !amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      return res.status(400).json({ success: false, message: "Receivable, deposit account, and a positive amount are required." });
    }
    if (!idempotencyKey) {
      return res.status(400).json({ success: false, message: "An idempotency key is required for receipts." });
    }

    const amountNumber = Number(amount.toFixed(2));
    const existing = await prisma.cashTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) {
      const sameRequest = Number(existing.amount) === amountNumber && existing.type === "INFLOW" && existing.toAccountId === toAccountId;
      if (!sameRequest) {
        return res.status(409).json({ success: false, message: "This idempotency key was already used for a different receipt." });
      }
      return res.json({ success: true, alreadyProcessed: true, transactionId: existing.id, message: "This receipt was already posted." });
    }

    const ncmSettlement = await prisma.deliveryFinancialSettlement.findFirst({
      where: { OR: [{ id: receivableId }, { deliveryOrderId: receivableId }] },
    });
    if (ncmSettlement) {
      const cod = Number(ncmSettlement.codCollected || ncmSettlement.codExpected || 0);
      const fee = Number(ncmSettlement.deliveryFeeActual || ncmSettlement.deliveryFeeExpected || 0);
      const netDeposit = Number((cod - fee).toFixed(2));
      if (ncmSettlement.settlementState === "SETTLED") {
        return res.status(409).json({ success: false, alreadySettled: true, message: "This NCM settlement is already marked settled." });
      }
      if (netDeposit < 0 || Math.abs(netDeposit - amountNumber) > 0.05) {
        return res.status(400).json({
          success: false,
          message: `Expected net remittance is NPR ${netDeposit.toFixed(2)} (COD ${cod.toFixed(2)} less carrier fee ${fee.toFixed(2)}).`,
        });
      }

      const treasury = await prisma.financialAccount.findUnique({ where: { id: toAccountId } });
      if (!treasury) return res.status(404).json({ success: false, message: "Deposit Treasury account not found." });
      if (!treasury.accountingAccountId) {
        return res.status(409).json({ success: false, message: "Map the destination Treasury account to a GL account first." });
      }
      const glAccount = await prisma.account.findUnique({ where: { id: treasury.accountingAccountId }, select: { accountCode: true } });
      if (!glAccount) return res.status(409).json({ success: false, message: "The Treasury GL mapping is unavailable." });

      const cashTransaction = await prisma.$transaction(async (tx) => {
        const updatedSettlement = await tx.deliveryFinancialSettlement.updateMany({
          where: { id: ncmSettlement.id, settlementState: { not: "SETTLED" } },
          data: { settlementState: "SETTLED", settledAt: new Date(), codCollected: cod },
        });
        if (updatedSettlement.count !== 1) {
          throw Object.assign(new Error("This NCM settlement was concurrently settled."), { statusCode: 409 });
        }
        await tx.financialAccount.update({
          where: { id: toAccountId },
          data: { currentBalance: { increment: netDeposit } },
        });
        const transaction = await tx.cashTransaction.create({
          data: {
            idempotencyKey,
            amount: netDeposit,
            type: "INFLOW",
            toAccountId,
            category: "COD_REMITTANCE",
            partyName: "Nepal Can Move (NCM)",
            referenceId: ncmSettlement.id,
            description: `NCM COD ${cod.toFixed(2)} less carrier fee ${fee.toFixed(2)}${notes ? ` - ${notes}` : ""}`,
          },
        });
        await postNcmRemittanceAccounting({
          settlementId: ncmSettlement.id,
          codCollected: cod,
          deliveryFeeActual: fee,
          cashAccountCode: glAccount.accountCode,
          destinationAccountName: treasury.accountName,
          createdBy: req.auth?.email || "admin",
        }, { client: tx });
        return transaction;
      });

      return res.json({ success: true, transactionId: cashTransaction.id, message: `NPR ${netDeposit.toFixed(2)} NCM remittance posted.` });
    }

    if (String(receivableId).startsWith("AR-MFG-DIRECT-")) {
      return res.status(409).json({
        success: false,
        message: "This legacy manufacturer balance has no posted AR document. Create and reconcile a documented receivable before collecting it.",
      });
    }

    const receivable = await prisma.accountReceivable.findUnique({ where: { id: receivableId } });
    if (!receivable) return res.status(404).json({ success: false, message: "Receivable record not found." });
    if (["SETTLED", "CANCELLED"].includes(receivable.status)) {
      return res.status(409).json({ success: false, alreadySettled: true, message: "This receivable is already closed." });
    }
    if (amountNumber > Number(receivable.remainingBalance)) {
      return res.status(400).json({ success: false, message: "Receipt exceeds the remaining receivable balance." });
    }

    const treasury = await prisma.financialAccount.findUnique({ where: { id: toAccountId } });
    if (!treasury) return res.status(404).json({ success: false, message: "Deposit Treasury account not found." });
    if (!treasury.accountingAccountId) {
      return res.status(409).json({ success: false, message: "Map the destination Treasury account to a GL account first." });
    }
    const glAccount = await prisma.account.findUnique({ where: { id: treasury.accountingAccountId }, select: { accountCode: true } });
    if (!glAccount) return res.status(409).json({ success: false, message: "The Treasury GL mapping is unavailable." });

    const receivedAmount = Number(receivable.receivedAmount) + amountNumber;
    const remainingBalance = Number((Number(receivable.totalAmount) - receivedAmount).toFixed(2));
    const status = remainingBalance <= 0 ? "SETTLED" : "PARTIALLY_RECEIVED";
    let collectionHistory = [];
    try {
      collectionHistory = typeof receivable.collectionHistory === "string"
        ? JSON.parse(receivable.collectionHistory)
        : receivable.collectionHistory || [];
    } catch {
      collectionHistory = [];
    }
    collectionHistory.push({
      idempotencyKey,
      date: new Date().toISOString(),
      amount: amountNumber,
      toAccountId,
      accountName: treasury.accountName,
      notes: notes || "Receivable collection",
    });

    const transaction = await prisma.$transaction(async (tx) => {
      const collectionUpdate = await tx.accountReceivable.updateMany({
        where: { id: receivableId, receivedAmount: receivable.receivedAmount, remainingBalance: { gte: amountNumber } },
        data: { receivedAmount, remainingBalance, status, collectionHistory },
      });
      if (collectionUpdate.count !== 1) {
        throw Object.assign(new Error("Receivable balance changed before collection; refresh and retry."), { statusCode: 409 });
      }
      await tx.financialAccount.update({
        where: { id: toAccountId },
        data: { currentBalance: { increment: amountNumber } },
      });
      const cashRecord = await tx.cashTransaction.create({
        data: {
          idempotencyKey,
          amount: amountNumber,
          type: "INFLOW",
          toAccountId,
          category: "RECEIVABLE_COLLECTION",
          partyName: receivable.payerName,
          referenceId: receivable.id,
          description: `Receipt for ${receivable.title}${notes ? ` - ${notes}` : ""}`,
        },
      });
      await postCustomerPaymentAccounting({
        id: receivable.id,
        orderId: receivable.referenceId || receivable.id,
        customerName: receivable.payerName,
        amount: amountNumber,
        depositAccountCode: glAccount.accountCode,
        idempotencyKey: `RECEIPT:${idempotencyKey}`,
        referenceNumber: `RCPT-${cashRecord.id.slice(-8)}`,
        client: tx,
      });
      return cashRecord;
    });

    return res.json({ success: true, transactionId: transaction.id, message: `NPR ${amountNumber.toFixed(2)} receipt posted. Remaining: NPR ${remainingBalance.toFixed(2)}.` });
  } catch (error) {
    const status = error.code === "P2002" ? 409 : error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.message || "Receipt posting failed." });
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
