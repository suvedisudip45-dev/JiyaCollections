import { createHash } from "node:crypto";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";
import { postJournalEntry, reverseJournalEntryById } from "./accountingPostingEngine.js";
import {
  validateTreasuryAccountingAccount,
  validateTreasuryAccountTypeMapping,
} from "./treasuryAccountingService.js";
import {
  amendVatReturn,
  fileVatReturn,
  recordVatFilingPayment,
} from "./vatFilingService.js";
import {
  netDistributorRefundPayable,
  recordDistributorSettlementPayout,
  settleDistributorRefundPayable,
} from "./distributorCashSettlementService.js";
import { recordFixedAssetDisposal } from "./fixedAssetDisposalService.js";
import { correctSettledTransaction } from "./settlementCorrectionService.js";
import { applyManufacturerCreditToBill } from "./supplierCreditApplicationService.js";
import { applyCollaborationFeeCreditToInvoice } from "./collaborationFeeCreditApplicationService.js";
import { recordLoanRepayment } from "./loanAccountingService.js";
import { recordShareBuyback } from "./shareBuybackService.js";
import { createSupplierReturn } from "./supplierReturnService.js";
import { applySupplierReturnCreditToBill } from "./supplierReturnCreditApplicationService.js";
import { parseNprAmountString } from "./accountingDecimal.js";
import {
  confirmNcmSettlementBatch,
  correctNcmSettlementBatch,
  resolveNcmSettlementVariance,
} from "./ncmSettlementService.js";

const ACTION_TYPES = new Set([
  "MANUAL_JOURNAL",
  "OPENING_BALANCE",
  "JOURNAL_REVERSAL",
  "COA_CREATE",
  "COA_UPDATE",
  "TREASURY_ACCOUNT_CREATE",
  "TREASURY_GL_MAPPING",
  "VAT_RETURN_FILE",
  "VAT_RETURN_PAYMENT",
  "VAT_RETURN_AMENDMENT",
  "DISTRIBUTOR_REFUND_PAYOUT",
  "FIXED_ASSET_DISPOSAL",
  "SETTLEMENT_CORRECTION",
  "DISTRIBUTOR_SETTLEMENT_PAYOUT",
  "DISTRIBUTOR_REFUND_NETTING",
  "NCM_SETTLEMENT_CONFIRM",
  "NCM_VARIANCE_RESOLUTION",
  "MANUFACTURER_CREDIT_APPLICATION",
  "COLLABORATION_CREDIT_APPLICATION",
  "SUPPLIER_RETURN_CREDIT_APPLICATION",
  "LOAN_REPAYMENT",
  "SHARE_BUYBACK",
  "SUPPLIER_RETURN_CREATE",
]);
const ACCOUNT_TYPES = new Set(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COGS", "EXPENSE"]);
const NORMAL_BALANCES = new Set(["DEBIT", "CREDIT"]);

const fail = (message, statusCode = 400, code = "ACCOUNTING_APPROVAL_ERROR") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const text = (value, label, maxLength, { required = false, minLength = 0 } = {}) => {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw fail(`${label} must be text.`);
  }
  const normalized = String(value ?? "").trim();
  if ((required && !normalized) || normalized.length < minLength || normalized.length > maxLength) {
    throw fail(`${label} must be ${required ? "provided and " : ""}between ${minLength} and ${maxLength} characters.`);
  }
  return normalized;
};

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const hashPayload = (actionType, payload) => {
  const hashablePayload = actionType === "DISTRIBUTOR_SETTLEMENT_PAYOUT"
    ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "evidenceUrl"))
    : payload;
  return createHash("sha256").update(stableStringify({ actionType, payload: hashablePayload })).digest("hex");
};

const normalizePayload = (actionType, input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw fail("An accounting action payload is required.");
  }

  if (actionType === "MANUAL_JOURNAL" || actionType === "OPENING_BALANCE") {
    const transactionDate = input.transactionDate ? new Date(input.transactionDate) : new Date();
    if (Number.isNaN(transactionDate.getTime())) throw fail("A valid accounting transaction date is required.");
    if (!Array.isArray(input.lines) || input.lines.length < 2 || input.lines.length > 100) {
      throw fail("A journal must contain between 2 and 100 lines.");
    }
    const lines = input.lines.map((line) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) throw fail("Every journal line must be an object.");
      return {
        accountId: text(line.accountId, "Journal account ID", 191, { required: true }),
        debit: String(line.debit ?? "0"),
        credit: String(line.credit ?? "0"),
        description: text(line.description, "Journal line description", 500),
      };
    });
    const referenceNumber = text(input.referenceNumber, "Journal reference", 191, {
      required: actionType === "OPENING_BALANCE",
    });
    const description = text(input.description, "Journal description", 2000, { required: true, minLength: 3 });
    const reason = text(input.reason, "Action reason", 2000, { required: true, minLength: 3 });
    if (actionType === "OPENING_BALANCE" && !referenceNumber) {
      throw fail("An opening balance journal requires a source evidence reference.");
    }
    return {
      transactionDate: transactionDate.toISOString(),
      referenceNumber,
      description,
      reason,
      lines,
    };
  }

  if (actionType === "JOURNAL_REVERSAL") {
    return {
      journalEntryId: text(input.journalEntryId, "Journal entry ID", 191, { required: true }),
      reason: text(input.reason, "Reversal reason", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "COA_CREATE") {
    const accountType = text(input.accountType, "Account type", 32, { required: true }).toUpperCase();
    if (!ACCOUNT_TYPES.has(accountType)) throw fail("Choose a supported chart-of-accounts type.");
    let normalBalance = input.normalBalance
      ? text(input.normalBalance, "Normal balance", 16, { required: true }).toUpperCase()
      : (["ASSET", "COGS", "EXPENSE"].includes(accountType) ? "DEBIT" : "CREDIT");
    if (!NORMAL_BALANCES.has(normalBalance)) throw fail("Choose DEBIT or CREDIT as the normal balance.");
    return {
      accountCode: text(input.accountCode, "Account code", 64, { required: true }),
      accountName: text(input.accountName, "Account name", 191, { required: true }),
      accountType,
      normalBalance,
      parentAccountId: text(input.parentAccountId, "Parent account ID", 191) || null,
      description: text(input.description, "Account description", 2000) || null,
      reason: text(input.reason, "Action reason", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "COA_UPDATE") {
    const payload = { id: text(input.id, "Account ID", 191, { required: true }) };
    if (input.accountName !== undefined) payload.accountName = text(input.accountName, "Account name", 191, { required: true });
    if (input.description !== undefined) payload.description = text(input.description, "Account description", 2000);
    if (input.isActive !== undefined) payload.isActive = input.isActive;
    payload.reason = text(input.reason, "Action reason", 2000, { required: true, minLength: 3 });
    if (payload.isActive !== undefined && typeof payload.isActive !== "boolean") {
      throw fail("Account active state must be a boolean.");
    }
    if (payload.accountName === undefined && payload.description === undefined && payload.isActive === undefined) {
      throw fail("At least one chart-of-accounts field must be changed.");
    }
    return payload;
  }

  if (actionType === "TREASURY_GL_MAPPING") {
    return {
      financialAccountId: text(input.financialAccountId, "Treasury account ID", 191, { required: true }),
      accountingAccountId: text(input.accountingAccountId, "GL account ID", 191, { required: true }),
      reason: text(input.reason, "Mapping change reason", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "TREASURY_ACCOUNT_CREATE") {
    const accountType = text(input.accountType, "Treasury account type", 16, { required: true }).toUpperCase();
    if (!["CASH", "BANK", "WALLET"].includes(accountType)) throw fail("Choose a supported Treasury account type.");
    return {
      accountName: text(input.accountName, "Treasury account name", 191, { required: true }),
      accountType,
      accountNumber: text(input.accountNumber, "Treasury account number", 191),
      bankName: text(input.bankName, "Bank name", 191),
      accountingAccountId: text(input.accountingAccountId, "GL account ID", 191, { required: true }),
      reason: text(input.reason, "Action reason", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "VAT_RETURN_FILE") {
    const filedDate = new Date(input.filedDate);
    if (Number.isNaN(filedDate.getTime())) throw fail("A valid VAT filing date is required.");
    return {
      id: text(input.id, "VAT filing ID", 191, { required: true }),
      assessedAmount: text(String(input.assessedAmount ?? ""), "Assessed VAT", 64, { required: true }),
      paymentCreditApplied: text(String(input.paymentCreditApplied ?? "0"), "Applied VAT payment credit", 64, { required: true }),
      assessmentAdjustmentAccountId: text(input.assessmentAdjustmentAccountId, "Assessment adjustment account ID", 191),
      filedDate: filedDate.toISOString(),
      filedReference: text(input.filedReference, "IRD filing reference", 191, { required: true }),
      filingEvidenceUrl: text(input.filingEvidenceUrl, "Filing evidence URL", 5000),
      adjustmentReason: text(input.adjustmentReason, "Assessment adjustment reason", 2000),
      reason: text(input.reason, "Approval request reason", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "VAT_RETURN_PAYMENT") {
    const paymentDate = new Date(input.paymentDate);
    if (Number.isNaN(paymentDate.getTime())) throw fail("A valid VAT payment date is required.");
    return {
      filingRecordId: text(input.filingRecordId, "VAT filing ID", 191, { required: true }),
      amount: text(String(input.amount ?? ""), "VAT payment amount", 64, { required: true }),
      paymentDate: paymentDate.toISOString(),
      paymentReference: text(input.paymentReference, "VAT payment reference", 191, { required: true }),
      treasuryAccountId: text(input.treasuryAccountId, "Treasury account ID", 191, { required: true }),
      evidenceUrl: text(input.evidenceUrl, "Payment evidence URL", 5000),
      adjustmentReason: text(input.adjustmentReason, "Payment variance reason", 2000),
      reason: text(input.reason, "Approval request reason", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "VAT_RETURN_AMENDMENT") {
    const amendedDate = new Date(input.amendedDate);
    if (Number.isNaN(amendedDate.getTime())) throw fail("A valid VAT amendment date is required.");
    return {
      id: text(input.id, "VAT filing ID", 191, { required: true }),
      amendedAssessedAmount: text(String(input.amendedAssessedAmount ?? ""), "Amended assessed VAT", 64, { required: true }),
      amendedDate: amendedDate.toISOString(),
      amendedReference: text(input.amendedReference, "IRD amendment reference", 191, { required: true }),
      adjustmentAccountId: text(input.adjustmentAccountId, "Adjustment account ID", 191, { required: true }),
      reason: text(input.reason, "Amendment reason", 2000, { required: true, minLength: 3 }),
      evidenceUrl: text(input.evidenceUrl, "Amendment evidence URL", 5000),
    };
  }

  if (actionType === "DISTRIBUTOR_REFUND_PAYOUT") {
    return {
      distributorId: text(input.distributorId, "Distributor ID", 191, { required: true }),
      accountingDocumentId: text(input.accountingDocumentId, "Refund payable ID", 191, { required: true }),
      financialAccountId: text(input.financialAccountId, "Treasury account ID", 191, { required: true }),
      amount: text(String(input.amount ?? ""), "Refund payout amount", 64, { required: true }),
      reason: text(input.reason, "Refund payout reason", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "FIXED_ASSET_DISPOSAL") {
    const status = text(input.status, "Asset disposal status", 32, { required: true }).toUpperCase();
    if (!["DAMAGED", "WRITTEN_OFF"].includes(status)) {
      throw fail("Select a valid asset damage or write-off status.");
    }
    const disposalAmount = Number(input.disposalAmount ?? 0);
    if (!Number.isFinite(disposalAmount) || disposalAmount < 0) {
      throw fail("Recovery amount must be a non-negative number.");
    }
    if (disposalAmount > 0) {
      throw fail("Recording disposal proceeds is unavailable until the tax-aware sale and VAT treatment is approved and implemented.", 409, "ASSET_SALE_TAX_FLOW_REQUIRED");
    }
    return {
      assetId: text(input.assetId, "Fixed asset ID", 191, { required: true }),
      status,
      damageNotes: text(input.damageNotes, "Damage or disposal notes", 2000),
      disposalAmount,
      reason: text(input.reason, "Asset write-off reason", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "SETTLEMENT_CORRECTION") {
    let type = text(input.type, "Settlement type", 32, { required: true }).toUpperCase();
    if (type === "MANUFACTURER_PAYMENT") type = "PAYABLE";
    if (!["PAYABLE", "RECEIVABLE", "MARKETING_CPA_PAYABLE", "NCM_COD"].includes(type)) {
      throw fail("This settlement type cannot use the correction approval workflow.");
    }
    const correctionMode = text(input.correctionMode, "Correction mode", 32, { required: true }).toUpperCase();
    if (!["VOID_NOT_EXECUTED", "RETURNED_FUNDS"].includes(correctionMode)) {
      throw fail("Choose whether the original cash movement was not executed or the funds were actually returned.");
    }
    return {
      type,
      recordId: text(input.recordId, "Settlement record ID", 191, { required: true }),
      payoutId: text(input.payoutId, "Payout ID", 191) || null,
      correctionMode,
      reason: text(input.reason, "Correction reason", 2000, { required: true, minLength: 3 }),
      evidenceReference: text(input.evidenceReference, "Correction evidence reference", 191, { required: true }),
      cashTransactionId: text(input.cashTransactionId, "Cash transaction ID", 191) || null,
    };
  }

  if (actionType === "DISTRIBUTOR_SETTLEMENT_PAYOUT") {
    const evidenceDigest = text(input.evidenceDigest, "Transfer evidence digest", 64, { required: true });
    if (!/^[a-f0-9]{64}$/i.test(evidenceDigest)) throw fail("Transfer evidence digest is invalid.");
    return {
      distributorId: text(input.distributorId, "Distributor ID", 191, { required: true }),
      requestId: text(input.requestId, "Settlement request ID", 191, { required: true }),
      transferReference: text(input.transferReference, "Transfer reference", 191, { required: true }),
      evidenceUrl: text(input.evidenceUrl, "Transfer evidence URL", 2000, { required: true }),
      evidenceDigest: evidenceDigest.toLowerCase(),
      financialAccountId: text(input.financialAccountId, "Treasury account ID", 191, { required: true }),
      reason: text(input.reason, "Settlement payout reason", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "DISTRIBUTOR_REFUND_NETTING") {
    return {
      distributorId: text(input.distributorId, "Distributor ID", 191, { required: true }),
      amount: text(String(input.amount ?? ""), "Refund netting amount", 64, { required: true }),
      reason: text(input.reason, "Refund netting reason", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "NCM_SETTLEMENT_CONFIRM") {
    const rawIds = input.settlementIds;
    if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 100) {
      throw fail("Select between 1 and 100 NCM settlements.", 400, "INVALID_SETTLEMENT_IDS");
    }
    const settlementIds = rawIds.map((id) => text(id, "NCM settlement ID", 191, { required: true }));
    const actualNetDeposit = input.actualNetDeposit == null
      ? null
      : text(String(input.actualNetDeposit), "Actual net deposit", 64, { required: true });
    const expectedNetDeposit = input.expectedNetDeposit == null
      ? null
      : text(String(input.expectedNetDeposit), "Expected net deposit", 64, { required: true });
    if (actualNetDeposit === null && expectedNetDeposit === null) {
      throw fail("An actual or expected NCM net deposit is required.", 400, "INVALID_NET_DEPOSIT");
    }
    const ticketId = input.ncmTicketId == null || input.ncmTicketId === ""
      ? null
      : Number(input.ncmTicketId);
    if (ticketId !== null && (!Number.isSafeInteger(ticketId) || ticketId < 1)) {
      throw fail("NCM ticket ID must be a positive whole number.", 400, "INVALID_NCM_TICKET_ID");
    }
    return {
      settlementIds,
      financialAccountId: text(input.financialAccountId, "Treasury account ID", 191, { required: true }),
      actualNetDeposit,
      expectedNetDeposit,
      reference: text(input.reference, "NCM bank reference", 191),
      notes: text(input.notes, "NCM settlement notes", 2000),
      reason: text(input.reason, "NCM settlement reason", 2000, { required: true, minLength: 3 }),
      varianceType: text(input.varianceType, "NCM variance type", 40),
      varianceReason: text(input.varianceReason, "NCM variance explanation", 2000),
      periodStart: text(input.periodStart, "NCM period start", 40),
      periodEnd: text(input.periodEnd, "NCM period end", 40),
      ncmTicketId: ticketId,
      createdBy: text(input.createdBy, "Creator", 191) || "ADMIN",
    };
  }

  if (actionType === "NCM_VARIANCE_RESOLUTION") {
    const action = text(input.action, "NCM variance action", 40, { required: true });
    if (!["COLLECT_SHORTFALL", "REFUND_OVERPAYMENT", "APPLY_OVERPAYMENT"].includes(action)) {
      throw fail("Choose a supported NCM variance action.", 400, "INVALID_RESOLUTION_ACTION");
    }
    return {
      batchId: text(input.batchId, "NCM batch ID", 191, { required: true }),
      action,
      amount: text(String(input.amount ?? ""), "NCM variance amount", 64, { required: true }),
      financialAccountId: text(input.financialAccountId, "Treasury account ID", 191),
      reference: text(input.reference, "NCM resolution reference", 191, { required: true }),
      notes: text(input.notes, "NCM resolution notes", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "MANUFACTURER_CREDIT_APPLICATION") {
    return {
      manufacturerId: text(input.manufacturerId, "Manufacturer ID", 191, { required: true }),
      creditDocumentId: text(input.creditDocumentId, "Supplier credit ID", 191, { required: true }),
      billDocumentId: text(input.billDocumentId, "Supplier bill ID", 191, { required: true }),
      amount: text(String(input.amount ?? ""), "Supplier credit application amount", 64, { required: true }),
      reason: text(input.reason, "Supplier credit application reason", 1000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "COLLABORATION_CREDIT_APPLICATION") {
    return {
      creditDocumentId: text(input.creditDocumentId, "Partner credit ID", 191, { required: true }),
      invoiceDocumentId: text(input.invoiceDocumentId, "Partner invoice ID", 191, { required: true }),
      amount: text(String(input.amount ?? ""), "Partner credit application amount", 64, { required: true }),
      reason: text(input.reason, "Partner credit application reason", 1000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "SUPPLIER_RETURN_CREDIT_APPLICATION") {
    let amount;
    try {
      amount = parseNprAmountString(input.amount, "Supplier credit application amount", {
        allowZero: false,
      }).toFixed(2);
    } catch (error) {
      throw fail(error.message || "Supplier credit application amount must be a positive decimal string.", 400, "INVALID_AMOUNT");
    }
    return {
      supplierReturnId: text(input.supplierReturnId, "Supplier return ID", 191, { required: true }),
      billDocumentId: text(input.billDocumentId, "Supplier bill ID", 191, { required: true }),
      amount,
      reason: text(input.reason, "Supplier credit application reason", 1000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "LOAN_REPAYMENT") {
    return {
      liabilityId: text(input.liabilityId, "Loan liability ID", 191, { required: true }),
      repaymentAmount: text(String(input.repaymentAmount ?? ""), "Loan repayment amount", 64, { required: true }),
      principalPortion: text(String(input.principalPortion ?? ""), "Principal portion", 64, { required: true }),
      interestPortion: text(String(input.interestPortion ?? ""), "Interest portion", 64, { required: true }),
      fromAccountId: text(input.fromAccountId, "Treasury account ID", 191, { required: true }),
      transactionDate: text(input.transactionDate, "Loan repayment date", 40) || null,
      reason: text(input.reason, "Loan repayment reason", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "SHARE_BUYBACK") {
    return {
      sellerPartnerId: text(input.sellerPartnerId, "Seller shareholder ID", 191, { required: true }),
      sharesToTransfer: text(String(input.sharesToTransfer ?? ""), "Share count", 64, { required: true }),
      sharePrice: text(String(input.sharePrice ?? "100"), "Share price", 64, { required: true }),
      fromTreasuryAccountId: text(input.fromTreasuryAccountId, "Treasury account ID", 191, { required: true }),
      reason: text(input.reason, "Share buyback reason", 2000, { required: true, minLength: 3 }),
    };
  }

  if (actionType === "SUPPLIER_RETURN_CREATE") {
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
      throw fail("Enter between 1 and 100 supplier-return items.");
    }
    const items = input.items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw fail("Each supplier-return item must be an object.");
      }
      const quantity = Number(item?.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw fail("Supplier-return quantities must be positive whole numbers.");
      }
      return {
        productId: text(item.productId || item._id || item.id, "Supplier-return product ID", 191, { required: true }),
        name: text(item.name, "Supplier-return product name", 191),
        quantity,
        unitCostPrice: text(String(item.unitCostPrice ?? ""), "Supplier-return unit cost", 64, { required: true }),
      };
    });
    const settlementType = text(input.settlementType || "CREDIT_NOTE_OFFSET_PAYABLE", "Supplier-return settlement type", 40, { required: true }).toUpperCase();
    if (!["CREDIT_NOTE_OFFSET_PAYABLE", "CASH_REFUND"].includes(settlementType)) {
      throw fail("Select a valid supplier-return settlement type.");
    }
    const supplierInvoiceNumber = text(input.supplierInvoiceNumber, "Supplier invoice number", 191);
    const vatReversal = text(String(input.vatReversal ?? "0"), "VAT reversal amount", 64, { required: true });
    const vatReversalNumber = Number(vatReversal);
    if (!Number.isFinite(vatReversalNumber) || vatReversalNumber < 0) {
      throw fail("VAT reversal must be a non-negative amount.");
    }
    if (vatReversalNumber > 0 && !supplierInvoiceNumber) {
      throw fail("An original supplier invoice reference is required for VAT reversal.");
    }
    const depositAccountId = text(input.depositAccountId, "Treasury account ID", 191);
    if (settlementType === "CASH_REFUND" && !depositAccountId) {
      throw fail("Select the Treasury account receiving the supplier cash refund.");
    }
    return {
      shipmentBatchId: text(input.shipmentBatchId, "Supplier shipment ID", 191),
      supplierName: text(input.supplierName, "Supplier name", 191, { required: true }),
      supplierReference: text(input.supplierReference, "Supplier reference", 191),
      supplierInvoiceNumber,
      settlementType,
      depositAccountId,
      reason: text(input.reason, "Supplier-return reason", 1000, { required: true, minLength: 3 }),
      notes: text(input.notes, "Supplier-return notes", 2000),
      vatReversal,
      items,
    };
  }

  throw fail("Unsupported accounting action type.");
};

const requireAdminActor = (actor) => {
  const accountId = text(actor?.accountId, "Authenticated Admin account ID", 191, { required: true });
  if (actor?.role !== "ADMIN") throw fail("Only authenticated Admin accounts can submit or review accounting actions.", 403, "ADMIN_REQUIRED");
  return { accountId, role: "ADMIN" };
};

const writeEvent = async (tx, { approvalId, sequence, eventType, actor, reason, snapshot }) =>
  tx.accountingActionApprovalEvent.create({
    data: {
      approvalId,
      sequence,
      eventType,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      reason: reason || null,
      snapshot: snapshot || undefined,
    },
  });

const executeApprovedAction = async (tx, approval, reviewer, auditContext) => {
  const payload = approval.payload;
  if (approval.actionType === "MANUAL_JOURNAL" || approval.actionType === "OPENING_BALANCE") {
    const journalEntry = await postJournalEntry({
      transactionDate: new Date(payload.transactionDate),
      sourceType: approval.actionType,
      sourceId: approval.id,
      idempotencyKey: `ACCOUNTING_APPROVAL:${approval.id}`,
      referenceNumber: payload.referenceNumber,
      description: payload.description,
      lines: payload.lines,
      createdBy: approval.makerAccountId,
      client: tx,
    });
    return { entityType: "JournalEntry", entityId: journalEntry.id, journalNumber: journalEntry.journalNumber };
  }

  if (approval.actionType === "JOURNAL_REVERSAL") {
    const reversedEntry = await reverseJournalEntryById({
      journalEntryId: payload.journalEntryId,
      reversalReason: payload.reason,
      reversedBy: reviewer.accountId,
      actorContext: { actorId: reviewer.accountId, actorRole: reviewer.role, portalSource: "ADMIN" },
      client: tx,
    });
    return { entityType: "JournalEntry", entityId: reversedEntry.id, journalNumber: reversedEntry.journalNumber };
  }

  if (approval.actionType === "COA_CREATE") {
    const existing = await tx.account.findUnique({ where: { accountCode: payload.accountCode } });
    if (existing) throw fail(`Account code ${payload.accountCode} already exists.`, 409, "COA_ACCOUNT_CODE_EXISTS");
    const account = await tx.account.create({
      data: {
        accountCode: payload.accountCode,
        accountName: payload.accountName,
        accountType: payload.accountType,
        normalBalance: payload.normalBalance,
        parentAccountId: payload.parentAccountId,
        description: payload.description,
        isSystemAccount: false,
        isActive: true,
        currentBalance: 0,
      },
    });
    return {
      entityType: "Account",
      entityId: account.id,
      beforeState: null,
      afterState: { accountCode: account.accountCode, accountName: account.accountName, accountType: account.accountType },
    };
  }

  if (approval.actionType === "COA_UPDATE") {
    const before = await tx.account.findUnique({ where: { id: payload.id } });
    if (!before) throw fail("Chart-of-accounts entry was not found.", 404, "COA_ACCOUNT_NOT_FOUND");
    const account = await tx.account.update({
      where: { id: payload.id },
      data: {
        accountName: payload.accountName,
        description: payload.description,
        isActive: payload.isActive,
      },
    });
    return {
      entityType: "Account",
      entityId: account.id,
      beforeState: { accountName: before.accountName, description: before.description, isActive: before.isActive },
      afterState: { accountName: account.accountName, description: account.description, isActive: account.isActive },
    };
  }

  if (approval.actionType === "TREASURY_GL_MAPPING") {
    const before = await tx.financialAccount.findUnique({
      where: { id: payload.financialAccountId },
      select: { id: true, accountingAccountId: true, accountName: true, accountType: true },
    });
    if (!before) throw fail("Treasury account was not found.", 404, "TREASURY_ACCOUNT_NOT_FOUND");
    const glAccount = await validateTreasuryAccountingAccount(payload.accountingAccountId, tx);
    validateTreasuryAccountTypeMapping(before.accountType, glAccount.accountCode);
    if (before.accountingAccountId === glAccount.id) {
      throw fail("This Treasury account is already mapped to the selected GL account.", 409, "TREASURY_MAPPING_UNCHANGED");
    }
    const result = await tx.financialAccount.updateMany({
      where: { id: before.id, accountingAccountId: before.accountingAccountId },
      data: { accountingAccountId: glAccount.id },
    });
    if (result.count !== 1) throw fail("Treasury mapping changed while this request was pending. Submit a new request.", 409, "TREASURY_MAPPING_CONFLICT");
    return {
      entityType: "FinancialAccount",
      entityId: before.id,
      beforeState: { accountingAccountId: before.accountingAccountId },
      afterState: { accountingAccountId: glAccount.id, accountCode: glAccount.accountCode, accountName: glAccount.accountName },
    };
  }

  if (approval.actionType === "TREASURY_ACCOUNT_CREATE") {
    const glAccount = await validateTreasuryAccountingAccount(payload.accountingAccountId, tx);
    validateTreasuryAccountTypeMapping(payload.accountType, glAccount.accountCode);
    const financialAccount = await tx.financialAccount.create({
      data: {
        accountName: payload.accountName,
        accountType: payload.accountType,
        accountNumber: payload.accountNumber,
        bankName: payload.bankName,
        currentBalance: 0,
        accountingAccountId: glAccount.id,
      },
      include: { accountingAccount: { select: { id: true, accountCode: true, accountName: true, accountType: true } } },
    });
    return {
      entityType: "FinancialAccount",
      entityId: financialAccount.id,
      afterState: {
        accountName: financialAccount.accountName,
        accountType: financialAccount.accountType,
        accountingAccountId: glAccount.id,
        currentBalance: "0.00",
      },
    };
  }

  if (approval.actionType === "VAT_RETURN_FILE") {
    const record = await fileVatReturn({
      ...payload,
      filedBy: approval.makerAccountId,
      client: tx,
      afterFile: (updated, client) => recordSystemAudit({
        ...auditContext,
        actorId: reviewer.accountId,
        actorRole: reviewer.role,
        portalSource: "ADMIN",
      }, {
        action: "VAT_RETURN_MARKED_FILED",
        entityType: "TaxFilingRecord",
        entityId: updated.id,
        afterState: {
          status: updated.status,
          assessedAmount: updated.assessedAmount?.toString() || "0",
          paymentCreditApplied: updated.paymentCreditApplied?.toString() || "0",
          assessmentAdjustmentJournalId: updated.assessmentAdjustmentJournalId,
          assessmentAdjustmentAccountId: updated.assessmentAdjustmentAccountId,
          filedReference: updated.filedReference,
          filedDate: updated.filedDate,
          makerAccountId: approval.makerAccountId,
        },
      }, { client }),
    });
    return { entityType: "TaxFilingRecord", entityId: record.id, status: record.status };
  }

  if (approval.actionType === "VAT_RETURN_PAYMENT") {
    const record = await recordVatFilingPayment({
      ...payload,
      idempotencyKey: approval.requestKey,
      recordedBy: approval.makerAccountId,
      client: tx,
      afterPayment: (updated, client) => recordSystemAudit({
        ...auditContext,
        actorId: reviewer.accountId,
        actorRole: reviewer.role,
        portalSource: "ADMIN",
      }, {
        action: "VAT_RETURN_PAYMENT_RECORDED",
        entityType: "TaxFilingRecord",
        entityId: updated.id,
        afterState: {
          periodKey: updated.periodKey,
          taxPaid: updated.taxPaid.toString(),
          paymentCreditApplied: updated.paymentCreditApplied?.toString() || "0",
          status: updated.status,
          latestPayment: updated.payments?.at(-1)
            ? {
                amount: updated.payments.at(-1).amount.toString(),
                adjustmentReason: updated.payments.at(-1).adjustmentReason,
              }
            : null,
          makerAccountId: approval.makerAccountId,
        },
      }, { client }),
    });
    return { entityType: "TaxFilingRecord", entityId: record.id, status: record.status };
  }

  if (approval.actionType === "VAT_RETURN_AMENDMENT") {
    const record = await amendVatReturn({
      ...payload,
      idempotencyKey: approval.requestKey,
      recordedBy: approval.makerAccountId,
      client: tx,
      afterAmendment: (updated, amendment, client) => recordSystemAudit({
        ...auditContext,
        actorId: reviewer.accountId,
        actorRole: reviewer.role,
        portalSource: "ADMIN",
      }, {
        action: "VAT_RETURN_AMENDED",
        entityType: "TaxFilingRecord",
        entityId: updated.id,
        afterState: {
          status: updated.status,
          periodKey: updated.periodKey,
          previousAssessedAmount: amendment.previousAssessedAmount.toString(),
          amendedAssessedAmount: amendment.amendedAssessedAmount.toString(),
          amendedReference: amendment.amendedReference,
          adjustmentReason: amendment.reason,
          adjustmentAccountId: amendment.adjustmentAccountId,
          journalEntryId: amendment.journalEntryId,
          paymentCreditJournalEntryId: amendment.paymentCreditJournalEntryId,
          makerAccountId: approval.makerAccountId,
        },
      }, { client }),
    });
    return { entityType: "TaxFilingRecord", entityId: record.id, status: record.status };
  }

  if (approval.actionType === "DISTRIBUTOR_REFUND_PAYOUT") {
    const result = await settleDistributorRefundPayable({
      ...payload,
      idempotencyKey: approval.requestKey,
      reviewerAccountId: reviewer.accountId,
      reason: payload.reason,
      actorContext: auditContext,
      client: tx,
    });
    return {
      entityType: "AccountingDocument",
      entityId: payload.accountingDocumentId,
      cashEventId: result.cashEvent?.id || null,
      status: result.cashEvent?.status || "POSTED",
      isReplay: result.isReplay,
    };
  }

  if (approval.actionType === "FIXED_ASSET_DISPOSAL") {
    const result = await recordFixedAssetDisposal({
      ...payload,
      idempotencyKey: approval.id,
      client: tx,
    });
    return {
      entityType: "FixedAsset",
      entityId: result.asset?.id || payload.assetId,
      afterState: {
        status: result.asset?.status || payload.status,
        scrapLoss: result.scrapLoss,
        alreadyProcessed: result.alreadyProcessed,
      },
    };
  }

  if (approval.actionType === "SETTLEMENT_CORRECTION") {
    const actorContext = {
      ...auditContext,
      actorId: reviewer.accountId,
      actorRole: reviewer.role,
      portalSource: "ADMIN",
    };
    const result = payload.type === "NCM_COD"
      ? await correctNcmSettlementBatch({
          batchId: payload.recordId,
          correctionMode: payload.correctionMode,
          correctionReason: payload.reason,
          evidenceReference: payload.evidenceReference,
          cashTransactionId: payload.cashTransactionId,
          actorAccountId: reviewer.accountId,
          actorContext,
          client: tx,
        })
      : await correctSettledTransaction({
          type: payload.type,
          recordId: payload.recordId,
          payoutId: payload.payoutId,
          correctionMode: payload.correctionMode,
          correctionReason: payload.reason,
          evidenceReference: payload.evidenceReference,
          cashTransactionId: payload.cashTransactionId,
          actorAccountId: reviewer.accountId,
          actorContext,
          client: tx,
        });
    return {
      entityType: payload.type === "NCM_COD" ? "NcmSettlementBatch" : "Settlement",
      entityId: payload.recordId,
      correctionMode: result.correctionMode,
      reversalTransactionId: result.reversalTransactionId,
      reversalJournalEntryId: result.reversalJournalEntryId,
      status: result.status || result.restoredStatus || "CORRECTED",
    };
  }

  if (approval.actionType === "DISTRIBUTOR_SETTLEMENT_PAYOUT") {
    const result = await recordDistributorSettlementPayout({
      ...payload,
      adminAccountId: reviewer.accountId,
      reason: payload.reason,
      actorContext: {
        ...auditContext,
        actorId: reviewer.accountId,
        actorRole: reviewer.role,
        portalSource: "ADMIN",
      },
      client: tx,
    });
    return {
      entityType: "DistributorSettlementRequestToken",
      entityId: payload.requestId,
      settlementId: result.settlement?.id || null,
      status: result.request?.status || "PAYMENT_SENT",
      isReplay: result.isReplay,
    };
  }

  if (approval.actionType === "DISTRIBUTOR_REFUND_NETTING") {
    const result = await netDistributorRefundPayable({
      distributorId: payload.distributorId,
      amount: payload.amount,
      idempotencyKey: approval.id,
      notes: payload.reason,
      reviewerAccountId: reviewer.accountId,
      actorContext: {
        ...auditContext,
        actorId: reviewer.accountId,
        actorRole: reviewer.role,
        portalSource: "ADMIN",
      },
      client: tx,
    });
    return {
      entityType: "DistributorSettlementOffset",
      entityId: result.offset?.id || approval.id,
      journalEntryId: result.journalEntryId || null,
      isReplay: result.isReplay,
    };
  }

  if (approval.actionType === "NCM_SETTLEMENT_CONFIRM") {
    const result = await confirmNcmSettlementBatch({
      ...payload,
      client: tx,
    });
    return {
      entityType: "NcmSettlementBatch",
      entityId: result.batchId || result.transactionId || approval.id,
      journalEntryId: result.journalEntryId || null,
      isReplay: result.alreadyProcessed,
    };
  }

  if (approval.actionType === "NCM_VARIANCE_RESOLUTION") {
    const result = await resolveNcmSettlementVariance({
      ...payload,
      idempotencyKey: approval.id,
      createdBy: reviewer.accountId,
      client: tx,
    });
    return {
      entityType: "NcmSettlementVarianceResolution",
      entityId: result.resolution?.id || approval.id,
      journalEntryId: result.resolution?.journalEntryId || null,
      isReplay: result.alreadyProcessed,
    };
  }

  if (approval.actionType === "MANUFACTURER_CREDIT_APPLICATION") {
    const result = await applyManufacturerCreditToBill({
      ...payload,
      idempotencyKey: approval.id,
      appliedByAccountId: reviewer.accountId,
      notes: payload.reason,
      client: tx,
    });
    return {
      entityType: "SupplierCreditApplication",
      entityId: result.application?.id || approval.id,
      journalEntryId: result.journalEntryId || null,
      isReplay: result.isReplay,
    };
  }

  if (approval.actionType === "COLLABORATION_CREDIT_APPLICATION") {
    const result = await applyCollaborationFeeCreditToInvoice({
      ...payload,
      idempotencyKey: approval.id,
      appliedByAccountId: reviewer.accountId,
      notes: payload.reason,
      client: tx,
    });
    return {
      entityType: "CollaborationFeeCreditApplication",
      entityId: result.application?.id || approval.id,
      journalEntryId: result.journalEntryId || null,
      isReplay: result.isReplay,
    };
  }

  if (approval.actionType === "SUPPLIER_RETURN_CREDIT_APPLICATION") {
    const result = await applySupplierReturnCreditToBill({
      supplierReturnId: payload.supplierReturnId,
      billDocumentId: payload.billDocumentId,
      amount: payload.amount,
      idempotencyKey: approval.id,
      appliedByAccountId: reviewer.accountId,
      notes: payload.reason,
      client: tx,
    });
    return {
      entityType: "SupplierReturnCreditApplication",
      entityId: result.application?.id || approval.id,
      journalEntryId: result.journalEntryId || result.application?.journalEntryId || null,
      isReplay: result.isReplay,
    };
  }

  if (approval.actionType === "LOAN_REPAYMENT") {
    const result = await recordLoanRepayment({
      liabilityId: payload.liabilityId,
      repaymentAmount: payload.repaymentAmount,
      principalPortion: payload.principalPortion,
      interestPortion: payload.interestPortion,
      fromAccountId: payload.fromAccountId,
      ...(payload.transactionDate ? { transactionDate: payload.transactionDate } : {}),
      idempotencyKey: approval.id,
      notes: payload.reason,
      client: tx,
    });
    return {
      entityType: "InvestorLiability",
      entityId: result.liability?.id || payload.liabilityId,
      isReplay: result.isReplay,
    };
  }

  if (approval.actionType === "SHARE_BUYBACK") {
    const result = await recordShareBuyback({
      sellerPartnerId: payload.sellerPartnerId,
      sharesToTransfer: payload.sharesToTransfer,
      sharePrice: payload.sharePrice,
      fromTreasuryAccountId: payload.fromTreasuryAccountId,
      notes: payload.reason,
      idempotencyKey: approval.id,
    }, { client: tx });
    return {
      entityType: "ShareBuyback",
      entityId: result.journal?.id || approval.id,
      journalEntryId: result.journal?.id || null,
      isReplay: result.alreadyProcessed,
    };
  }

  if (approval.actionType === "SUPPLIER_RETURN_CREATE") {
    const result = await createSupplierReturn({
      input: { ...payload, requestKey: approval.id },
      actorContext: {
        actorId: reviewer.accountId,
        actorRole: reviewer.role,
        portalSource: "ADMIN",
        ...auditContext,
      },
      client: tx,
    });
    return {
      entityType: "SupplierReturn",
      entityId: result.supplierReturnRecord?.id || approval.id,
      journalEntryId: result.supplierReturnRecord?.accountingJournalEntryId || null,
      isReplay: result.isReplay,
    };
  }

  throw fail("The accounting action has no approved execution handler.", 409, "ACCOUNTING_ACTION_HANDLER_MISSING");
};

export const requestAccountingActionApproval = async ({
  actionType: rawActionType,
  requestKey: rawRequestKey,
  payload: inputPayload,
  actor: rawActor,
  client = prisma,
  auditContext = {},
} = {}) => {
  const actor = requireAdminActor(rawActor);
  const actionType = text(rawActionType, "Accounting action type", 48, { required: true }).toUpperCase();
  if (!ACTION_TYPES.has(actionType)) throw fail("This accounting action does not support maker-checker approval.", 400, "UNSUPPORTED_ACCOUNTING_ACTION");
  const requestKey = text(rawRequestKey, "Idempotency key", 191, { required: true });
  const payload = normalizePayload(actionType, inputPayload);
  const payloadHash = hashPayload(actionType, payload);

  return client.$transaction(async (tx) => {
    const existing = await tx.accountingActionApproval.findUnique({ where: { requestKey }, include: { events: true } });
    if (existing) {
      if (existing.payloadHash !== payloadHash || existing.makerAccountId !== actor.accountId) {
        throw fail("This idempotency key was already used for a different accounting request.", 409, "IDEMPOTENCY_KEY_REUSED");
      }
      return { approvalRequest: existing, isReplay: true };
    }
    const approvalRequest = await tx.accountingActionApproval.create({
      data: { actionType, requestKey, payloadHash, payload, makerAccountId: actor.accountId, makerRole: actor.role },
    });
    await writeEvent(tx, {
      approvalId: approvalRequest.id,
      sequence: 1,
      eventType: "SUBMITTED",
      actor,
      reason: payload.reason || payload.description || null,
      snapshot: { actionType, payloadHash },
    });
    await recordSystemAudit({
      ...auditContext,
      actorId: actor.accountId,
      actorRole: actor.role,
      portalSource: "ADMIN",
    }, {
      action: "ACCOUNTING_ACTION_APPROVAL_SUBMITTED",
      entityType: "AccountingActionApproval",
      entityId: approvalRequest.id,
      afterState: { actionType, status: approvalRequest.status, payloadHash },
    }, { client: tx });
    return { approvalRequest, isReplay: false };
  }, { isolationLevel: "Serializable" });
};

export const reviewAccountingActionApproval = async ({
  approvalId: rawApprovalId,
  decision: rawDecision,
  reason: rawReason,
  actor: rawActor,
  client = prisma,
  auditContext = {},
} = {}) => {
  const actor = requireAdminActor(rawActor);
  const approvalId = text(rawApprovalId, "Approval request ID", 191, { required: true });
  const decision = text(rawDecision, "Review decision", 16, { required: true }).toUpperCase();
  const reason = text(rawReason, "Review reason", 2000, { required: true, minLength: 3 });
  if (!["APPROVE", "REJECT"].includes(decision)) throw fail("Choose APPROVE or REJECT.", 400, "INVALID_REVIEW_DECISION");

  return client.$transaction(async (tx) => {
    const approval = await tx.accountingActionApproval.findUnique({
      where: { id: approvalId },
      include: { events: { orderBy: { sequence: "desc" }, take: 1 } },
    });
    if (!approval) throw fail("Accounting approval request was not found.", 404, "ACCOUNTING_APPROVAL_NOT_FOUND");
    if (approval.makerAccountId === actor.accountId) {
      throw fail("The initiating Admin cannot review their own accounting action.", 403, "MAKER_CANNOT_REVIEW");
    }
    if (approval.status !== "PENDING") {
      if (approval.reviewerAccountId === actor.accountId && approval.reviewDecision === decision && approval.reviewReason === reason) {
        return { approvalRequest: approval, isReplay: true };
      }
      throw fail("This accounting request has already been reviewed.", 409, "ACCOUNTING_APPROVAL_ALREADY_REVIEWED");
    }

    let resultSnapshot = null;
    if (decision === "APPROVE") {
      resultSnapshot = await executeApprovedAction(tx, approval, actor, auditContext);
    }
    const nextStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const updated = await tx.accountingActionApproval.updateMany({
      where: { id: approval.id, status: "PENDING" },
      data: {
        status: nextStatus,
        reviewerAccountId: actor.accountId,
        reviewerRole: actor.role,
        reviewedAt: new Date(),
        reviewDecision: decision,
        reviewReason: reason,
        resultSnapshot,
      },
    });
    if (updated.count !== 1) throw fail("Accounting request changed during review; retry after refreshing.", 409, "ACCOUNTING_APPROVAL_CONFLICT");
    await writeEvent(tx, {
      approvalId: approval.id,
      sequence: (approval.events[0]?.sequence || 1) + 1,
      eventType: decision === "APPROVE" ? "APPROVED" : "REJECTED",
      actor,
      reason,
      snapshot: resultSnapshot || { actionType: approval.actionType, status: nextStatus },
    });
    await recordSystemAudit({
      ...auditContext,
      actorId: actor.accountId,
      actorRole: actor.role,
      portalSource: "ADMIN",
    }, {
      action: `ACCOUNTING_ACTION_${nextStatus}`,
      entityType: "AccountingActionApproval",
      entityId: approval.id,
      beforeState: { status: approval.status },
      afterState: {
        status: nextStatus,
        actionType: approval.actionType,
        makerAccountId: approval.makerAccountId,
        reviewerAccountId: actor.accountId,
        reason,
        resultSnapshot,
      },
    }, { client: tx });
    return {
      approvalRequest: {
        ...approval,
        status: nextStatus,
        reviewerAccountId: actor.accountId,
        reviewerRole: actor.role,
        reviewDecision: decision,
        reviewReason: reason,
        resultSnapshot,
      },
      isReplay: false,
    };
  }, { isolationLevel: "Serializable" });
};

export const listAccountingActionApprovals = async ({ status = "PENDING", limit = 50 } = {}, { client = prisma } = {}) => {
  const normalizedStatus = text(status, "Approval status", 24, { required: true }).toUpperCase();
  if (!["PENDING", "APPROVED", "REJECTED", "ALL"].includes(normalizedStatus)) {
    throw fail("Choose PENDING, APPROVED, REJECTED, or ALL.", 400, "INVALID_APPROVAL_STATUS");
  }
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50));
  return client.accountingActionApproval.findMany({
    where: normalizedStatus === "ALL" ? undefined : { status: normalizedStatus },
    include: { events: { orderBy: { sequence: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: safeLimit,
  });
};
