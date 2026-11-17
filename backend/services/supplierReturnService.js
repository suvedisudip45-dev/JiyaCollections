import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { createAccountingDocument } from "./accountingSubledgerService.js";
import { postJournalEntry } from "./accountingPostingEngine.js";
import { recordSystemAudit } from "./auditService.js";
import {
  addDecimals,
  multiplyDecimals,
  parseNprAmountString,
  quantizeNprAmount,
  subtractDecimals,
} from "./accountingDecimal.js";

const fail = (message, statusCode = 400, code = "SUPPLIER_RETURN_INVALID") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const parseMoney = (value, label, { allowZero = false } = {}) => {
  try {
    return parseNprAmountString(
      value,
      label,
      { allowZero },
    );
  } catch (error) {
    throw fail(error.message || `${label} must be ${allowZero ? "non-negative" : "greater than zero"}.`);
  }
};

const normalizeText = (value) => String(value || "").trim();
const normalizeSupplierName = (value) => normalizeText(value).replace(/\s+/g, " ").toLowerCase();

const prepareSupplierReturn = (input) => {
  const requestKey = normalizeText(input.requestKey);
  if (!requestKey || requestKey.length > 128) {
    throw fail("A valid supplier-return request key is required.", 400, "SUPPLIER_RETURN_IDEMPOTENCY_REQUIRED");
  }
  const supplierName = normalizeText(input.supplierName);
  if (!supplierName) throw fail("Supplier name is required.");
  const supplierPartyId = normalizeText(input.supplierPartyId);
  if (!supplierPartyId) {
    throw fail("Select a registered supplier for this return.", 400, "SUPPLIER_IDENTITY_REQUIRED");
  }
  const supplierInvoiceNumber = normalizeText(input.supplierInvoiceNumber);
  const settlementType = normalizeText(input.settlementType || "CREDIT_NOTE_OFFSET_PAYABLE").toUpperCase();
  if (!["CREDIT_NOTE_OFFSET_PAYABLE", "CASH_REFUND"].includes(settlementType)) {
    throw fail("Select a valid supplier-return settlement type.");
  }
  const vatReversal = parseMoney(input.vatReversal ?? 0, "VAT reversal", { allowZero: true });
  if (!vatReversal.isZero() && !supplierInvoiceNumber) {
    throw fail("An original supplier invoice reference is required for VAT reversal.", 400, "SUPPLIER_INVOICE_EVIDENCE_REQUIRED");
  }
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw fail("At least one returned product is required.");

  const normalizedItems = items.map((item) => {
    const productId = normalizeText(item.productId || item._id || item.id);
    const quantity = Number(item.quantity);
    if (!productId) throw fail("Every supplier-return item must include a product.");
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw fail("Supplier-return quantities must be positive whole numbers.");
    }
    const unitCostPrice = parseMoney(item.unitCostPrice, `Unit cost for product ${productId}`);
    return {
      productId,
      name: normalizeText(item.name) || productId,
      quantity,
      unitCostPrice,
      totalDebitCost: quantizeNprAmount(multiplyDecimals(unitCostPrice, String(quantity))),
    };
  });
  const totalDebit = quantizeNprAmount(addDecimals(...normalizedItems.map((item) => item.totalDebitCost)));
  if (totalDebit.lessThanOrEqualTo(0)) throw fail("Supplier return amount must be greater than zero.");
  if (vatReversal.greaterThan(totalDebit)) {
    throw fail("VAT reversal cannot exceed the supplier-return amount.");
  }
  if (settlementType === "CASH_REFUND" && !normalizeText(input.depositAccountId)) {
    throw fail("Select the Treasury account receiving the supplier cash refund.", 400, "TREASURY_ACCOUNT_REQUIRED");
  }

  const payload = {
    shipmentBatchId: normalizeText(input.shipmentBatchId) || null,
    supplierName,
    supplierPartyId,
    supplierInvoiceNumber: supplierInvoiceNumber || null,
    settlementType,
    depositAccountId: normalizeText(input.depositAccountId) || null,
    reason: normalizeText(input.reason) || "Supplier return",
    notes: normalizeText(input.notes) || null,
    vatReversal: vatReversal.toFixed(2),
    items: normalizedItems.map((item) => ({
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      unitCostPrice: item.unitCostPrice.toFixed(2),
      totalDebitCost: item.totalDebitCost.toFixed(2),
    })),
  };
  const requestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return {
    ...payload,
    requestKey,
    requestHash,
    items: normalizedItems,
    totalDebit,
    vatReversal,
  };
};

const replayExisting = (existing, requestHash) => {
  if (existing.requestHash !== requestHash) {
    throw fail(
      "Supplier-return request key was already used with different details.",
      409,
      "SUPPLIER_RETURN_IDEMPOTENCY_CONFLICT",
    );
  }
  return { supplierReturnRecord: existing, isReplay: true };
};

export const createSupplierReturn = async ({
  input,
  actorContext,
  client = prisma,
  writeAudit = recordSystemAudit,
  documentService = createAccountingDocument,
  journalPoster = postJournalEntry,
}) => {
  const prepared = prepareSupplierReturn(input || {});
  const execute = async (tx) => {
    const existing = await tx.supplierReturn.findUnique({ where: { requestKey: prepared.requestKey } });
    if (existing) return replayExisting(existing, prepared.requestHash);

    const party = await tx.accountingParty.findFirst({
      where: {
        id: prepared.supplierPartyId,
        partyType: "VENDOR",
        status: "ACTIVE",
      },
      select: { id: true, sourceEntityId: true, displayName: true, legalName: true },
    });
    if (!party) {
      throw fail("The selected supplier is not an active registered vendor.", 404, "SUPPLIER_NOT_FOUND");
    }
    if (normalizeSupplierName(party.displayName) !== normalizeSupplierName(prepared.supplierName)) {
      throw fail("Supplier name does not match the selected registered supplier.", 409, "SUPPLIER_IDENTITY_MISMATCH");
    }
    const supplierReference = party.sourceEntityId;

    if (prepared.shipmentBatchId) {
      const shipment = await tx.inboundShipment.findUnique({ where: { id: prepared.shipmentBatchId } });
      if (!shipment) throw fail("The referenced supplier shipment was not found.", 404, "SUPPLIER_SHIPMENT_NOT_FOUND");
      if (normalizeSupplierName(shipment.supplierName) !== normalizeSupplierName(party.displayName)) {
        throw fail("Supplier name does not match the referenced inbound shipment.", 409, "SUPPLIER_SHIPMENT_MISMATCH");
      }
      if (prepared.supplierInvoiceNumber && normalizeText(shipment.invoiceNumber) !== prepared.supplierInvoiceNumber) {
        throw fail("Supplier invoice reference does not match the referenced inbound shipment.", 409, "SUPPLIER_INVOICE_MISMATCH");
      }
      if (prepared.vatReversal.isPositive() && !normalizeText(shipment.invoiceNumber)) {
        throw fail("The referenced inbound shipment has no supplier invoice evidence.", 409, "SUPPLIER_INVOICE_EVIDENCE_REQUIRED");
      }
    }

    const quantitiesByProduct = new Map();
    for (const item of prepared.items) {
      quantitiesByProduct.set(item.productId, (quantitiesByProduct.get(item.productId) || 0) + item.quantity);
    }
    const products = new Map();
    for (const [productId, quantity] of quantitiesByProduct) {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw fail(`Product ${productId} was not found.`, 404, "SUPPLIER_RETURN_PRODUCT_NOT_FOUND");
      if (product.stockQuantity < quantity) {
        throw fail(
          `Supplier return quantity exceeds available stock for ${product.name}.`,
          409,
          "SUPPLIER_RETURN_STOCK_INSUFFICIENT",
        );
      }
      products.set(productId, product);
    }

    const now = new Date();

    let treasury = null;
    if (prepared.settlementType === "CASH_REFUND") {
      treasury = await tx.financialAccount.findUnique({
        where: { id: prepared.depositAccountId },
        include: { accountingAccount: true },
      });
      if (
        !treasury
        || treasury.status !== "ACTIVE"
        || treasury.currency !== "NPR"
        || !["CASH", "BANK", "WALLET"].includes(String(treasury.accountType).toUpperCase())
        || !treasury.accountingAccountId
        || !treasury.accountingAccount?.isActive
      ) {
        throw fail("Select an active NPR Treasury account mapped to an active GL account.", 409, "INVALID_TREASURY_ACCOUNT");
      }
    }

    const supplierReturnRecord = await tx.supplierReturn.create({
      data: {
        id: randomUUID(),
        requestKey: prepared.requestKey,
        requestHash: prepared.requestHash,
        shipmentBatchId: prepared.shipmentBatchId,
        supplierName: party.displayName,
        supplierReference: supplierReference,
        supplierInvoiceNumber: prepared.supplierInvoiceNumber,
        items: prepared.items.map((item) => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          unitCostPrice: item.unitCostPrice.toFixed(2),
          totalDebitCost: item.totalDebitCost.toFixed(2),
        })),
        totalDebitAmount: prepared.totalDebit,
        vatReversal: prepared.vatReversal,
        settlementType: prepared.settlementType,
        status: "COMPLETED",
        reason: prepared.reason,
        notes: prepared.notes,
        returnDate: now,
      },
    });

    for (const [productId, quantity] of quantitiesByProduct) {
      const product = products.get(productId);
      const updated = await tx.product.updateMany({
        where: { id: productId, stockQuantity: product.stockQuantity },
        data: { stockQuantity: { decrement: quantity } },
      });
      if (updated.count !== 1) {
        throw fail(
          `Stock changed while processing the return for ${product.name}. Refresh and retry.`,
          409,
          "SUPPLIER_RETURN_STOCK_CONFLICT",
        );
      }
      await tx.stockLog.create({
        data: {
          productId,
          productName: product.name,
          previousQty: product.stockQuantity,
          newQty: product.stockQuantity - quantity,
          changeQty: -quantity,
          reason: `Supplier Return / Debit Note #${supplierReturnRecord.id.slice(0, 8)} (${party.displayName})`,
          source: "supplier_return",
        },
      });
    }

    const inventoryCredit = quantizeNprAmount(subtractDecimals(prepared.totalDebit, prepared.vatReversal));
    const lines = [
      {
        ...(prepared.settlementType === "CASH_REFUND"
          ? { accountId: treasury.accountingAccountId }
          : { mappingKey: "AP_CONTROL" }),
        debit: prepared.totalDebit,
        credit: 0,
        description: `Supplier return settlement for ${supplierReturnRecord.id}`,
        accountingPartyId: party.id,
        supplierName: party.displayName,
      },
      ...(inventoryCredit.isPositive() ? [{
        mappingKey: "INVENTORY",
        debit: 0,
        credit: inventoryCredit,
        description: `Inventory returned to ${party.displayName}`,
        accountingPartyId: party.id,
        supplierName: party.displayName,
      }] : []),
      ...(prepared.vatReversal.isPositive() ? [{
        mappingKey: "INPUT_VAT_RECEIVABLE",
        debit: 0,
        credit: prepared.vatReversal,
        description: `Input VAT reversal supported by supplier invoice ${prepared.supplierInvoiceNumber}`,
        accountingPartyId: party.id,
        supplierName: party.displayName,
      }] : []),
    ];

    const journal = await journalPoster({
      transactionDate: now,
      sourceType: "SUPPLIER_RETURN",
      sourceId: supplierReturnRecord.id,
      idempotencyKey: `SUPPLIER_RETURN:${supplierReturnRecord.id}`,
      referenceNumber: `SR-${supplierReturnRecord.id.replace(/-/g, "").toUpperCase()}`,
      description: `Supplier return for ${party.displayName}`,
      lines,
      createdBy: actorContext?.actorId || "admin",
      client: tx,
    });

    let document = null;
    let cashTransaction = null;
    if (prepared.settlementType === "CREDIT_NOTE_OFFSET_PAYABLE") {
      document = await documentService({
        documentType: "CREDIT_NOTE",
        documentNumber: `SRCN-${supplierReturnRecord.id.replace(/-/g, "").toUpperCase()}`,
        partyId: party.id,
        side: "PAYABLE",
        sourceType: "SUPPLIER_RETURN",
        sourceId: supplierReturnRecord.id,
        idempotencyKey: `SUPPLIER_RETURN_CREDIT_NOTE:${supplierReturnRecord.id}`,
        issueDate: now,
        amount: prepared.totalDebit,
        notes: `Supplier credit note against invoice ${prepared.supplierInvoiceNumber || "not supplied"}.`,
      }, { client: tx });
    } else {
      const balanceUpdate = await tx.financialAccount.updateMany({
        where: {
          id: treasury.id,
          status: "ACTIVE",
          currency: "NPR",
          currentBalance: treasury.currentBalance,
          reservedBalance: treasury.reservedBalance,
          accountingAccountId: treasury.accountingAccountId,
        },
        data: { currentBalance: { increment: prepared.totalDebit } },
      });
      if (balanceUpdate.count !== 1) {
        throw fail("Treasury account changed while recording the supplier refund. Refresh and retry.", 409, "TREASURY_UPDATE_CONFLICT");
      }
      cashTransaction = await tx.cashTransaction.create({
        data: {
          idempotencyKey: `SUPPLIER_RETURN_CASH_REFUND:${supplierReturnRecord.id}`,
          amount: prepared.totalDebit,
          type: "INFLOW",
          toAccountId: treasury.id,
          category: "SUPPLIER_PAYMENT",
          partyName: party.displayName,
          invoiceNumber: prepared.supplierInvoiceNumber || "",
          referenceId: supplierReturnRecord.id,
          description: `Supplier cash refund for debit note ${supplierReturnRecord.id}`,
        },
      });
    }

    await tx.supplierReturn.update({
      where: { id: supplierReturnRecord.id },
      data: {
        accountingJournalEntryId: journal.id,
        accountingDocumentId: document?.id || null,
        cashTransactionId: cashTransaction?.id || null,
      },
    });

    await writeAudit(actorContext, {
      action: "SUPPLIER_RETURN_POSTED",
      entityType: "SupplierReturn",
      entityId: supplierReturnRecord.id,
      afterState: {
        supplierReference,
        supplierInvoiceNumber: prepared.supplierInvoiceNumber,
        settlementType: prepared.settlementType,
        totalDebitAmount: prepared.totalDebit.toFixed(2),
        vatReversal: prepared.vatReversal.toFixed(2),
        accountingJournalEntryId: journal.id,
        accountingDocumentId: document?.id || null,
        cashTransactionId: cashTransaction?.id || null,
      },
    }, { client: tx });

    return {
      supplierReturnRecord: {
        ...supplierReturnRecord,
        accountingJournalEntryId: journal.id,
        accountingDocumentId: document?.id || null,
        cashTransactionId: cashTransaction?.id || null,
      },
      isReplay: false,
    };
  };

  const ownsTransaction = typeof client.$transaction === "function";
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = ownsTransaction
        ? await client.$transaction(execute, { isolationLevel: "Serializable" })
        : await execute(client);
      return result;
    } catch (error) {
      if (ownsTransaction && error?.code === "P2034" && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        continue;
      }
      if (error?.code === "P2002") {
        const existing = await client.supplierReturn.findUnique({ where: { requestKey: prepared.requestKey } });
        if (existing) return replayExisting(existing, prepared.requestHash);
      }
      throw error;
    }
  }
};
