import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { normalizeBalancedJournalLines } from "./accountingMoney.js";
import { getNepaliFiscalPeriod } from "./nepaliFiscalCalendar.js";
import { classifySaleChannel, calculateLegacyManufacturerCommission } from "./accountingRecognitionPolicy.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { createAccountingDocument } from "./accountingSubledgerService.js";
import { resolveVatRatePercent } from "./vatRateService.js";

// ==========================================
// 1. STANDARD CHART OF ACCOUNTS DEFINITION
// ==========================================
export const STANDARD_CHART_OF_ACCOUNTS = [
  // ASSETS (1000 - 1999)
  { accountCode: "1000", accountName: "Assets", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: null },
  { accountCode: "1100", accountName: "Current Assets", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1000" },
  { accountCode: "1110", accountName: "Cash on Hand", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1100" },
  { accountCode: "1120", accountName: "Bank Accounts", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1100" },
  { accountCode: "1130", accountName: "Accounts Receivable (Control)", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1100" },
  { accountCode: "1140", accountName: "Merchandise Inventory", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1100" },
  { accountCode: "1150", accountName: "Input VAT Receivable", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1100" },
  { accountCode: "1160", accountName: "Supplier Advances & Prepaid Expenses", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1100" },
  { accountCode: "1170", accountName: "NCM COD Receivable", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1100" },
  { accountCode: "1180", accountName: "Payment Gateway Clearing", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1100" },
  { accountCode: "1190", accountName: "Distributor COD Receivable", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1100" },
  { accountCode: "1500", accountName: "Non-Current & Fixed Assets", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1000" },
  { accountCode: "1510", accountName: "Computers & IT Equipment", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1500" },
  { accountCode: "1520", accountName: "Furniture & Store Fixtures", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1500" },
  { accountCode: "1530", accountName: "Vehicles & Delivery Fleet", accountType: "ASSET", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "1500" },
  { accountCode: "1590", accountName: "Accumulated Depreciation", accountType: "ASSET", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "1500" },

  // LIABILITIES (2000 - 2999)
  { accountCode: "2000", accountName: "Liabilities", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: null },
  { accountCode: "2100", accountName: "Current Liabilities", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "2000" },
  { accountCode: "2110", accountName: "Accounts Payable (Control)", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "2100" },
  { accountCode: "2120", accountName: "Output VAT Payable", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "2100" },
  { accountCode: "2130", accountName: "Corporate Income Tax / TDS Payable", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "2100" },
  { accountCode: "2140", accountName: "Customer Refunds & Advances Payable", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "2100" },
  { accountCode: "2150", accountName: "Partner Profit Distributions Payable", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "2100" },
  { accountCode: "2160", accountName: "Manufacturer Payable (Control)", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "2100" },
  { accountCode: "2170", accountName: "Marketing Partner Payable (Control)", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "2100" },
  { accountCode: "2180", accountName: "NCM Carrier Payable (Control)", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "2100" },
  { accountCode: "2190", accountName: "Distributor Payable (Control)", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "2100" },
  { accountCode: "2500", accountName: "Non-Current Liabilities & Debt", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "2000" },
  { accountCode: "2510", accountName: "Bank Term Loans & Credit Facilities", accountType: "LIABILITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "2500" },

  // EQUITY (3000 - 3999)
  { accountCode: "3000", accountName: "Equity", accountType: "EQUITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: null },
  { accountCode: "3100", accountName: "Share Capital", accountType: "EQUITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "3000" },
  { accountCode: "3200", accountName: "Share Premium / Additional Paid-in Capital", accountType: "EQUITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "3000" },
  { accountCode: "3300", accountName: "Retained Earnings", accountType: "EQUITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "3000" },
  { accountCode: "3400", accountName: "Current Year Profit / Loss", accountType: "EQUITY", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "3000" },
  { accountCode: "3500", accountName: "Partner Drawings", accountType: "EQUITY", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "3000" },

  // REVENUE (4000 - 4999)
  { accountCode: "4000", accountName: "Revenue", accountType: "REVENUE", normalBalance: "CREDIT", isSystemAccount: true, parentCode: null },
  { accountCode: "4100", accountName: "Gross Sales Revenue", accountType: "REVENUE", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "4000" },
  { accountCode: "4200", accountName: "Delivery & Shipping Revenue", accountType: "REVENUE", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "4000" },
  { accountCode: "4300", accountName: "Collaboration Selling Fee Revenue", accountType: "REVENUE", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "4000" },
  { accountCode: "4500", accountName: "Sales Returns & Allowances", accountType: "REVENUE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "4000" },
  { accountCode: "4600", accountName: "Customer Discounts & Loyalty Rewards", accountType: "REVENUE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "4000" },

  // COST OF GOODS SOLD (5000 - 5999)
  { accountCode: "5000", accountName: "Cost of Sales", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: null },
  { accountCode: "5100", accountName: "Cost of Goods Sold (COGS)", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "5000" },
  { accountCode: "5200", accountName: "Inbound Freight & Customs Duties", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "5000" },
  { accountCode: "5300", accountName: "Packaging & Fulfillment Materials", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "5000" },
  { accountCode: "5400", accountName: "Purchase Returns & Supplier Credits", accountType: "EXPENSE", normalBalance: "CREDIT", isSystemAccount: true, parentCode: "5000" },
  { accountCode: "5500", accountName: "Inventory Damaged & Scrap Loss", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "5000" },

  // OPERATING EXPENSES (6000 - 6999)
  { accountCode: "6000", accountName: "Operating Expenses", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: null },
  { accountCode: "6100", accountName: "Salaries & Wages Expense", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "6000" },
  { accountCode: "6200", accountName: "Office & Store Rent Expense", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "6000" },
  { accountCode: "6300", accountName: "Utilities Expense (Electricity/Internet)", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "6000" },
  { accountCode: "6400", accountName: "Marketing & Advertising Expense", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "6000" },
  { accountCode: "6410", accountName: "Manufacturer Commission Expense", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "6000" },
  { accountCode: "6420", accountName: "Marketing Partner CPA Expense", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "6000" },
  { accountCode: "6430", accountName: "Delivery & Carrier Expense", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "6000" },
  { accountCode: "6440", accountName: "Distributor NCM Fulfillment Expense", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "6000" },
  { accountCode: "6500", accountName: "Software & Technology Tools", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "6000" },
  { accountCode: "6600", accountName: "Fixed Asset Depreciation Expense", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "6000" },
  { accountCode: "6700", accountName: "Miscellaneous Operating Expenses", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "6000" },

  // FINANCE & OTHER (7000 - 8999)
  { accountCode: "7000", accountName: "Finance Costs & Other", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: null },
  { accountCode: "7100", accountName: "Loan Interest & Financing Cost", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "7000" },
  { accountCode: "7200", accountName: "Bank Fees & Gateway Commissions", accountType: "EXPENSE", normalBalance: "DEBIT", isSystemAccount: true, parentCode: "7000" },
  { accountCode: "8100", accountName: "Other Income / Asset Disposal Gains", accountType: "REVENUE", normalBalance: "CREDIT", isSystemAccount: true, parentCode: null },
];

export const STANDARD_ACCOUNT_MAPPINGS = [
  { mappingKey: "CASH_ON_HAND", accountCode: "1110" },
  { mappingKey: "BANK", accountCode: "1120" },
  { mappingKey: "CUSTOMER_RECEIVABLE_CONTROL", accountCode: "1130" },
  { mappingKey: "INVENTORY", accountCode: "1140" },
  { mappingKey: "INPUT_VAT_RECEIVABLE", accountCode: "1150" },
  { mappingKey: "NCM_COD_RECEIVABLE", accountCode: "1170" },
  { mappingKey: "PAYMENT_GATEWAY_CLEARING", accountCode: "1180" },
  { mappingKey: "DISTRIBUTOR_COD_RECEIVABLE", accountCode: "1190" },
  { mappingKey: "AP_CONTROL", accountCode: "2110" },
  { mappingKey: "OUTPUT_VAT_PAYABLE", accountCode: "2120" },
  { mappingKey: "MANUFACTURER_PAYABLE", accountCode: "2160" },
  { mappingKey: "MARKETING_PARTNER_PAYABLE", accountCode: "2170" },
  { mappingKey: "NCM_CARRIER_PAYABLE", accountCode: "2180" },
  { mappingKey: "DISTRIBUTOR_PAYABLE", accountCode: "2190" },
  { mappingKey: "PRODUCT_SALES_REVENUE", accountCode: "4100" },
  { mappingKey: "DELIVERY_REVENUE", accountCode: "4200" },
  { mappingKey: "COLLABORATION_FEE_REVENUE", accountCode: "4300" },
  { mappingKey: "SALES_RETURNS", accountCode: "4500" },
  { mappingKey: "SALES_DISCOUNTS", accountCode: "4600" },
  { mappingKey: "COGS", accountCode: "5100" },
  { mappingKey: "MANUFACTURER_COMMISSION_EXPENSE", accountCode: "6410" },
  { mappingKey: "MARKETING_PARTNER_CPA_EXPENSE", accountCode: "6420" },
  { mappingKey: "DELIVERY_EXPENSE", accountCode: "6430" },
  { mappingKey: "DISTRIBUTOR_NCM_TRANSFER_EXPENSE", accountCode: "6440" },
];

export const ensureStandardAccountMappings = async (client = prisma) => {
  const mappings = [];
  for (const item of STANDARD_ACCOUNT_MAPPINGS) {
    const account = await client.account.findUnique({ where: { accountCode: item.accountCode } });
    if (!account) throw new Error(`Required system account ${item.accountCode} is missing for mapping ${item.mappingKey}.`);
    mappings.push(await client.accountingAccountMapping.upsert({
      where: { mappingKey: item.mappingKey },
      update: {},
      create: { mappingKey: item.mappingKey, accountId: account.id },
    }));
  }
  return mappings;
};

// Ensure the system COA and account mappings exist without overwriting custom remaps.
export const ensureStandardChartOfAccounts = async (client = prisma) => {
  try {
    const count = await client.account.count();
    if (count === 0) console.log("Seeding Standard Chart of Accounts (COA)...");

    const codeToIdMap = {};
    for (const item of STANDARD_CHART_OF_ACCOUNTS.filter((a) => !a.parentCode)) {
      const account = await client.account.upsert({
        where: { accountCode: item.accountCode },
        update: {},
        create: {
          accountCode: item.accountCode,
          accountName: item.accountName,
          accountType: item.accountType,
          normalBalance: item.normalBalance,
          isSystemAccount: item.isSystemAccount,
          isActive: true,
          currentBalance: 0,
        },
      });
      codeToIdMap[item.accountCode] = account.id;
    }

    for (const item of STANDARD_CHART_OF_ACCOUNTS.filter((a) => a.parentCode)) {
      const parent = codeToIdMap[item.parentCode]
        ? { id: codeToIdMap[item.parentCode] }
        : await client.account.findUnique({ where: { accountCode: item.parentCode }, select: { id: true } });
      if (!parent) throw new Error(`Parent account ${item.parentCode} is missing for ${item.accountCode}.`);
      const account = await client.account.upsert({
        where: { accountCode: item.accountCode },
        update: { parentAccountId: parent.id, isSystemAccount: true },
        create: {
          accountCode: item.accountCode,
          accountName: item.accountName,
          accountType: item.accountType,
          normalBalance: item.normalBalance,
          parentAccountId: parent.id,
          isSystemAccount: item.isSystemAccount,
          isActive: true,
          currentBalance: 0,
        },
      });
      codeToIdMap[item.accountCode] = account.id;
    }

    await ensureStandardAccountMappings(client);
    if (count === 0) console.log("Chart of Accounts successfully seeded with standard accounts and mappings.");
    return await client.account.findMany({ orderBy: { accountCode: "asc" } });
  } catch (error) {
    console.error("Error seeding Chart of Accounts:", error);
    throw error;
  }
};

// Ensure active Fiscal Year & Accounting Period
export const ensureFiscalYearAndPeriod = async (txDate = new Date(), client = prisma) => {
  const calendar = getNepaliFiscalPeriod(txDate);

  const fiscalYear = await client.fiscalYear.upsert({
    where: { name: calendar.fiscalYearName },
    update: {},
    create: {
      name: calendar.fiscalYearName,
      startDate: calendar.fiscalYearStart,
      endDate: calendar.fiscalYearEnd,
      status: "OPEN",
    },
  });

  const period = await client.accountingPeriod.upsert({
    where: {
      fiscalYearId_periodName: {
        fiscalYearId: fiscalYear.id,
        periodName: calendar.periodName,
      },
    },
    update: {},
    create: {
      fiscalYearId: fiscalYear.id,
      periodName: calendar.periodName,
      startDate: calendar.periodStart,
      endDate: calendar.periodEnd,
      status: "OPEN",
    },
  });

  return { fiscalYear, period, fiscalYearNumber: calendar.fiscalYearNumber };
};

// Account Lookup helper
export const getAccountByCode = async (accountCode, client = prisma) => {
  const account = await client.account.findUnique({ where: { accountCode } });
  if (!account) {
    throw new Error(`GL Account code ${accountCode} not found in Chart of Accounts.`);
  }
  return account;
};

export const getAccountByMappingKey = async (mappingKey, client = prisma) => {
  const mapping = await client.accountingAccountMapping.findUnique({
    where: { mappingKey },
    include: { account: true },
  });
  if (!mapping?.account) {
    throw new Error(`Accounting account mapping ${mappingKey} is not configured.`);
  }
  return mapping.account;
};

// ==========================================
// 2. CORE DOUBLE-ENTRY POSTING ENGINE
// ==========================================

/**
 * Atomic Journal Entry Poster
 * Enforces:
 * 1. Total Debits == Total Credits (Zero Imbalance)
 * 2. At least 2 lines
 * 3. Line cannot have both DR and CR
 * 4. Period is OPEN
 * 5. Idempotency (Cannot double post the same operational event)
 */
export const postJournalEntry = async ({
  transactionDate = new Date(),
  sourceType,
  sourceId,
  idempotencyKey,
  referenceNumber = "",
  description,
  lines = [],
  createdBy = "system",
  allowClosedPeriod = false,
  accountingEventId = null,
  afterPost = null,
  client = prisma,
}) => {
  const cleanDate = transactionDate ? new Date(transactionDate) : new Date();
  const idempKey = idempotencyKey || (sourceType && sourceId ? `${sourceType}:${sourceId}` : null);
  const normalized = normalizeBalancedJournalLines(lines);

  try {
    const postWithinTransaction = async (tx) => {
      if (idempKey) {
        const existingEntry = await tx.journalEntry.findUnique({
          where: { idempotencyKey: idempKey },
          include: { lines: { include: { account: true } } },
        });
        if (existingEntry?.status === "POSTED") {
          if (afterPost) await afterPost(tx, existingEntry);
          return existingEntry;
        }
      }

      const { fiscalYear, period, fiscalYearNumber } = await ensureFiscalYearAndPeriod(cleanDate, tx);
      if (!allowClosedPeriod && (fiscalYear.status === "CLOSED" || period.status === "CLOSED")) {
        throw new Error(`Cannot post accounting transaction to closed period ${period.periodName} (${fiscalYear.name}).`);
      }

      const processedLines = [];
      for (const line of normalized.lines) {
        const account = line.accountId
          ? await tx.account.findUnique({ where: { id: line.accountId } })
          : line.mappingKey
          ? await getAccountByMappingKey(line.mappingKey, tx)
          : line.accountCode
          ? await getAccountByCode(line.accountCode, tx)
          : null;
        if (!account && (line.accountId || line.mappingKey || line.accountCode)) {
          throw new Error(`GL account ${line.accountId || line.mappingKey || line.accountCode} not found.`);
        }
        if (!account) throw new Error("Journal line requires account ID, mapping key, or legacy account code.");

        processedLines.push({
          accountId: account.id,
          debit: line.debit,
          credit: line.credit,
          description: line.description || description || "",
          customerId: line.customerId || null,
          customerName: line.customerName || "",
          supplierId: line.supplierId || null,
          supplierName: line.supplierName || "",
          productId: line.productId || null,
          assetId: line.assetId || null,
          accountingPartyId: line.accountingPartyId || null,
          costCenter: line.costCenter || "",
        });
      }

      const sequence = await tx.journalSequence.upsert({
        where: { fiscalYear: fiscalYearNumber },
        create: { fiscalYear: fiscalYearNumber, nextNumber: 2 },
        update: { nextNumber: { increment: 1 } },
      });
      const journalNumber = `JE-${fiscalYearNumber}-${String(sequence.nextNumber - 1).padStart(5, "0")}`;
      const eventSourceType = sourceType || "MANUAL_JOURNAL";
      const accountingEventKey = idempKey || `JOURNAL:${journalNumber}`;
      const eventPayload = {
        sourceType: eventSourceType,
        sourceId: sourceId || journalNumber,
        effectiveAt: cleanDate.toISOString(),
        currency: "NPR",
        lines: processedLines.map((line) => ({
          accountId: line.accountId,
          accountingPartyId: line.accountingPartyId,
          productId: line.productId,
          debit: line.debit.toFixed(2),
          credit: line.credit.toFixed(2),
        })),
      };
      let accountingEvent;
      if (accountingEventId) {
        accountingEvent = await tx.accountingEvent.findUnique({ where: { id: accountingEventId } });
        if (
          !accountingEvent ||
          accountingEvent.idempotencyKey !== accountingEventKey ||
          accountingEvent.sourceType !== eventSourceType ||
          accountingEvent.sourceId !== (sourceId || journalNumber) ||
          accountingEvent.status !== "PROCESSING"
        ) {
          throw new Error("Accounting outbox event is not claimed for this journal posting.");
        }
      } else {
        accountingEvent = await tx.accountingEvent.create({
          data: {
            idempotencyKey: accountingEventKey,
            sourceType: eventSourceType,
            sourceId: sourceId || journalNumber,
            sourceVersion: 1,
            eventType: eventSourceType,
            effectiveAt: cleanDate,
            status: "PROCESSING",
            payload: eventPayload,
            payloadHash: crypto.createHash("sha256").update(JSON.stringify(eventPayload)).digest("hex"),
          },
        });
      }

      const journalEntry = await tx.journalEntry.create({
        data: {
          journalNumber,
          transactionDate: cleanDate,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          sourceType: sourceType || "MANUAL_JOURNAL",
          sourceId: sourceId || null,
          idempotencyKey: idempKey,
          accountingEventId: accountingEvent.id,
          referenceNumber: referenceNumber || "",
          description: description || `Journal entry ${journalNumber}`,
          status: "POSTED",
          totalDebit: normalized.totalDebit,
          totalCredit: normalized.totalCredit,
          createdBy,
          postedAt: new Date(),
          lines: { create: processedLines },
        },
        include: { lines: { include: { account: true } } },
      });

      for (const line of processedLines) {
        const account = await tx.account.findUnique({ where: { id: line.accountId } });
        const delta = account.normalBalance === "DEBIT"
          ? line.debit.minus(line.credit)
          : line.credit.minus(line.debit);
        await tx.account.update({
          where: { id: line.accountId },
          data: { currentBalance: { increment: delta } },
        });
      }

      if (afterPost) await afterPost(tx, journalEntry);

      await tx.accountingEvent.update({
        where: { id: accountingEvent.id },
        data: {
          status: "POSTED",
          processedAt: new Date(),
          claimedAt: null,
          nextAttemptAt: null,
          lastError: null,
        },
      });

      return journalEntry;
    };

    return await (typeof client.$transaction === "function"
      ? client.$transaction(postWithinTransaction)
      : postWithinTransaction(client));
  } catch (error) {
    if (idempKey && error.code === "P2002") {
      const existingEntry = await client.journalEntry.findUnique({
        where: { idempotencyKey: idempKey },
        include: { lines: { include: { account: true } } },
      });
      if (existingEntry?.status === "POSTED") return existingEntry;
    }
    throw error;
  }
};

// ==========================================
// 3. OPERATIONAL BUSINESS TRANSACTION POSTERS
// ==========================================

/**
 * Delivered Sales Order Posting (Target Domain Model)
 * Recognized at NCM DELIVERED transition.
 * DR NCM COD Receivable (1170) or Bank (1120)
 * CR Product Sales Revenue (4100): Taxable base ex-VAT
 * CR Output VAT Payable (2120): 13% Output VAT
 * CR Delivery Revenue (4200): Delivery charge ex-VAT (if applicable)
 * DR COGS (5100): Approved Unit COGS * Qty
 * DR Input VAT Receivable (1150): Split if valid manufacturer tax invoice provided
 * CR Manufacturer Payable (2160): Approved COGS
 * Previously posted direct-sale commissions are preserved for historical return reversals only.
 */
const hydrateProductionCostRecognitionMode = async (items, client) => {
  const allocations = items.flatMap((item) =>
    Array.isArray(item?.productionCostAllocations) ? item.productionCostAllocations : []
  );
  const missingRecognitionMode = allocations.filter((allocation) =>
    !Object.prototype.hasOwnProperty.call(allocation, "manufacturerPayableRecognizedAtProduction")
  );
  if (!missingRecognitionMode.length) return;

  const costLayerIds = [...new Set(missingRecognitionMode
    .map((allocation) => allocation.costLayerId)
    .filter(Boolean))];
  if (missingRecognitionMode.some((allocation) => !allocation.costLayerId)) {
    throw new Error("Production cost allocation is missing its cost-layer recognition reference; reconcile before delivery accounting.");
  }
  const costLayers = await client.manufacturerInventoryCostLayer.findMany({
    where: { id: { in: costLayerIds } },
    select: {
      id: true,
      manufacturerId: true,
      unitVatAmount: true,
      vatInvoiceVerified: true,
      manufacturerPayableRecognizedAtProduction: true,
    },
  });
  const costLayersById = new Map(costLayers.map((layer) => [layer.id, layer]));
  for (const allocation of missingRecognitionMode) {
    const layer = costLayersById.get(allocation.costLayerId);
    if (!layer) {
      throw new Error(`Production cost layer ${allocation.costLayerId} was not found; reconcile before delivery accounting.`);
    }
    allocation.manufacturerId ||= layer.manufacturerId;
    allocation.unitVatAmount ??= String(layer.unitVatAmount || 0);
    allocation.vatInvoiceVerified ??= layer.vatInvoiceVerified === true;
    allocation.manufacturerPayableRecognizedAtProduction =
      layer.manufacturerPayableRecognizedAtProduction === true;
  }
};

export const postManufacturerProductionAccounting = async ({
  productionRequest,
  manufacturer,
  goodQuantity,
  inventoryValue,
  recoverableInputVat = 0,
  transactionDate = new Date(),
  createdBy = "system",
  client = prisma,
} = {}) => {
  if (!productionRequest?.id || !manufacturer?.id || productionRequest.manufacturerId !== manufacturer.id) {
    throw new Error("A production request and its matching manufacturer are required for accounting.");
  }
  if (!Number.isInteger(goodQuantity) || goodQuantity < 0) {
    throw new Error("Good production quantity must be a non-negative whole number.");
  }
  if (goodQuantity === 0) return null;

  const inventoryAmount = new Prisma.Decimal(String(inventoryValue))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const inputVatAmount = new Prisma.Decimal(String(recoverableInputVat || 0))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (
    !inventoryAmount.isFinite() || !inventoryAmount.greaterThan(0) ||
    !inputVatAmount.isFinite() || inputVatAmount.isNegative()
  ) {
    throw new Error("Production inventory and recoverable VAT amounts must be valid non-negative values.");
  }

  const manufacturerRecord = await client.manufacturer.findUnique({
    where: { id: manufacturer.id },
    select: { id: true, name: true },
  });
  if (!manufacturerRecord) throw new Error("Manufacturer was not found for production accounting.");
  const party = await ensureAccountingParty({
    partyType: "MANUFACTURER",
    sourceEntityId: manufacturer.id,
    displayName: manufacturerRecord.name || `Manufacturer (${manufacturer.id.slice(-6)})`,
  }, { client });

  const payableAmount = inventoryAmount.plus(inputVatAmount)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const idempotencyKey = `MANUFACTURER_PRODUCTION:${productionRequest.id}`;
  const documentHash = crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24).toUpperCase();
  const lines = [
    {
      mappingKey: "INVENTORY",
      debit: inventoryAmount,
      credit: 0,
      description: `Accepted good production inventory for request ${productionRequest.id}`,
    },
    ...(inputVatAmount.greaterThan(0) ? [{
      mappingKey: "INPUT_VAT_RECEIVABLE",
      debit: inputVatAmount,
      credit: 0,
      description: `Verified manufacturer input VAT for production request ${productionRequest.id}`,
      supplierId: manufacturer.id,
      accountingPartyId: party.id,
    }] : []),
    {
      mappingKey: "MANUFACTURER_PAYABLE",
      debit: 0,
      credit: payableAmount,
      description: `Manufacturer payable for accepted production request ${productionRequest.id}`,
      supplierId: manufacturer.id,
      accountingPartyId: party.id,
    },
  ];

  return postJournalEntry({
    transactionDate,
    sourceType: "MANUFACTURER_PRODUCTION",
    sourceId: productionRequest.id,
    idempotencyKey,
    referenceNumber: `MFG-PROD-${productionRequest.id.slice(-6)}`,
    description: `Accepted production receipt and manufacturer payable for request ${productionRequest.id}`,
    createdBy,
    lines,
    afterPost: async (tx) => {
      await createAccountingDocument({
        documentType: "BILL",
        documentNumber: `MFG-PROD-${documentHash}`,
        partyId: party.id,
        side: "PAYABLE",
        sourceType: "MANUFACTURER_PRODUCTION",
        sourceId: productionRequest.id,
        amount: payableAmount,
        issueDate: transactionDate,
        idempotencyKey,
        notes: `Manufacturer payable for accepted production request ${productionRequest.id}.`,
      }, { client: tx });
    },
    client,
  });
};

export const postManufacturerLogisticsAccounting = async ({
  shipment,
  transfer,
  freightCharge,
  transactionDate = new Date(),
  createdBy = "system",
  client = prisma,
} = {}) => {
  const amount = new Prisma.Decimal(String(freightCharge ?? ""));
  if (!shipment?.id || !transfer?.id || !transfer?.manufacturerId || !transfer?.manufacturer?.name) {
    throw new Error("A dispatched shipment, transfer, and manufacturer are required for freight accounting.");
  }
  if (!amount.isFinite() || !amount.greaterThan(0)) {
    throw new Error("Manufacturer-paid local freight must be a valid amount greater than zero.");
  }
  const party = await ensureAccountingParty({
    partyType: "MANUFACTURER",
    sourceEntityId: transfer.manufacturerId,
    displayName: transfer.manufacturer.name,
  }, { client });
  const idempotencyKey = `MANUFACTURER_LOGISTICS:TRANSFER:${shipment.id}`;
  const documentHash = crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24).toUpperCase();

  return postJournalEntry({
    transactionDate,
    sourceType: "MANUFACTURER_LOGISTICS",
    sourceId: shipment.id,
    idempotencyKey,
    referenceNumber: `MFG-LOG-${shipment.id.slice(-8).toUpperCase()}`,
    description: `Manufacturer-paid logistics for stock transfer ${transfer.id}`,
    createdBy,
    lines: [
      {
        mappingKey: "DELIVERY_EXPENSE",
        debit: amount,
        credit: 0,
        description: `Local logistics expense for stock transfer ${transfer.id}`,
        supplierId: transfer.manufacturerId,
        supplierName: transfer.manufacturer.name,
        accountingPartyId: party.id,
      },
      {
        mappingKey: "MANUFACTURER_PAYABLE",
        debit: 0,
        credit: amount,
        description: `Local logistics payable to ${transfer.manufacturer.name}`,
        supplierId: transfer.manufacturerId,
        accountingPartyId: party.id,
      },
    ],
    afterPost: async (tx) => createAccountingDocument({
      documentType: "BILL",
      documentNumber: `MFG-LOG-${documentHash}`,
      partyId: party.id,
      side: "PAYABLE",
      sourceType: "MANUFACTURER_LOGISTICS",
      sourceId: shipment.id,
      amount,
      issueDate: transactionDate,
      idempotencyKey,
      notes: `Manufacturer-paid local freight for stock transfer ${transfer.id}.`,
    }, { client: tx }),
    client,
  });
};

export const postDeliveredOrderAccounting = async (orderOrParams, opts = {}) => {
  const client = opts.client || prisma;
  const order = orderOrParams.order || orderOrParams;
  const deliveryOrder = orderOrParams.deliveryOrder || opts.deliveryOrder || null;
  if (!order || !order.id) return null;

  const grossAmount = new Prisma.Decimal(String(order.amount || 0));
  if (grossAmount.lessThanOrEqualTo(0)) return null;

  const deliveryCharge = new Prisma.Decimal(String(
    order.deliveryCharge || order.deliveryFee || deliveryOrder?.customerDeliveryCharge || 0
  ));
  const productGross = grossAmount.minus(deliveryCharge);

  const vatRate = await resolveVatRatePercent(order.date, { client });
  const vatDivisor = new Prisma.Decimal(1).plus(vatRate.div(100));
  const productTaxable = productGross.div(vatDivisor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const productVat = productGross.minus(productTaxable);

  const deliveryTaxable = deliveryCharge.greaterThan(0)
    ? deliveryCharge.div(vatDivisor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : new Prisma.Decimal(0);
  const deliveryVat = deliveryCharge.minus(deliveryTaxable);
  const totalVat = productVat.plus(deliveryVat);

  let items = [];
  try {
    items = typeof order.items === "string" ? JSON.parse(order.items) : (order.items || []);
  } catch {
    items = [];
  }

  await hydrateProductionCostRecognitionMode(items, client);

  const saleChannel = classifySaleChannel(order);
  const isDirectDistributorSale = saleChannel === "DISTRIBUTOR_DIRECT";
  const manufacturerCosts = new Map();
  let directLegacyInventoryCogs = new Prisma.Decimal(0);
  const fallbackManufacturerId = order.manufacturerId || deliveryOrder?.manufacturerId ||
    items.find((item) => item?.manufacturerId)?.manufacturerId ||
    items.flatMap((item) => item?.productionCostAllocations || [])
      .find((allocation) => allocation?.manufacturerId)?.manufacturerId || null;
  const getManufacturerCosts = (manufacturerId) => {
    const key = manufacturerId || "";
    if (!manufacturerCosts.has(key)) {
      manufacturerCosts.set(key, {
        manufacturerId: manufacturerId || null,
        productionCogs: new Prisma.Decimal(0),
        productionInputVat: new Prisma.Decimal(0),
        inventoryRecognizedCogs: new Prisma.Decimal(0),
        legacyGrossCogs: new Prisma.Decimal(0),
        legacyInputVat: new Prisma.Decimal(0),
        legacyDeliveryOverhead: new Prisma.Decimal(0),
        party: null,
      });
    }
    return manufacturerCosts.get(key);
  };
  for (const item of items) {
    const qty = Number(item.quantity || 1);
    const manufacturerId = item.manufacturerId || fallbackManufacturerId;
    if (Array.isArray(item.productionCostAllocations)) {
      for (const allocation of item.productionCostAllocations) {
        const allocationQty = new Prisma.Decimal(String(allocation.quantity || 0));
        const unitCogs = new Prisma.Decimal(String(allocation.unitCogs || 0));
        const costs = getManufacturerCosts(allocation.manufacturerId || manufacturerId);
        costs.legacyDeliveryOverhead = costs.legacyDeliveryOverhead.plus(
          new Prisma.Decimal(String(allocation.unitDeliveryCost || 0)).mul(allocationQty)
        );
        if (allocation.manufacturerPayableRecognizedAtProduction === true) {
          costs.inventoryRecognizedCogs = costs.inventoryRecognizedCogs.plus(unitCogs.mul(allocationQty));
        } else {
          costs.productionCogs = costs.productionCogs.plus(unitCogs.mul(allocationQty));
        }
        if (
          allocation.manufacturerPayableRecognizedAtProduction !== true &&
          allocation.vatInvoiceVerified === true
        ) {
          costs.productionInputVat = costs.productionInputVat.plus(
            new Prisma.Decimal(String(allocation.unitVatAmount || 0)).mul(allocationQty)
          );
        }
      }
      const legacyQty = new Prisma.Decimal(String(item.legacyCostQuantity ?? qty));
      const legacyUnitCost = new Prisma.Decimal(String(
        item.legacyUnitCogsVatInclusiveAtAcceptance ??
        item.agreedUnitCogsVatInclusiveAtAcceptance ??
        item.costPrice ??
        0
      ));
      const costs = getManufacturerCosts(manufacturerId);
      const directLegacyUnitCost = item.legacyInventoryUnitCogs ?? item.costPrice;
      if (isDirectDistributorSale && directLegacyUnitCost !== undefined && directLegacyUnitCost !== null) {
        directLegacyInventoryCogs = directLegacyInventoryCogs.plus(
          new Prisma.Decimal(String(directLegacyUnitCost)).mul(legacyQty)
        );
      } else {
        costs.legacyGrossCogs = costs.legacyGrossCogs.plus(legacyUnitCost.mul(legacyQty));
      }
      costs.legacyDeliveryOverhead = costs.legacyDeliveryOverhead.plus(
        new Prisma.Decimal(String(item.unitDeliveryCost ?? item.approvedDeliveryCost ?? 0)).mul(legacyQty)
      );
    } else {
      const unitCost = item.agreedUnitCogsVatInclusiveAtAcceptance !== undefined && item.agreedUnitCogsVatInclusiveAtAcceptance !== null
        ? new Prisma.Decimal(String(item.agreedUnitCogsVatInclusiveAtAcceptance))
        : (item.costPrice ? new Prisma.Decimal(String(item.costPrice)) : new Prisma.Decimal(0));
      const costs = getManufacturerCosts(manufacturerId);
      const directLegacyUnitCost = item.legacyInventoryUnitCogs ?? item.costPrice;
      if (isDirectDistributorSale && directLegacyUnitCost !== undefined && directLegacyUnitCost !== null) {
        directLegacyInventoryCogs = directLegacyInventoryCogs.plus(
          new Prisma.Decimal(String(directLegacyUnitCost)).mul(qty)
        );
      } else {
        costs.legacyGrossCogs = costs.legacyGrossCogs.plus(unitCost.mul(qty));
      }
      costs.legacyDeliveryOverhead = costs.legacyDeliveryOverhead.plus(
        new Prisma.Decimal(String(item.unitDeliveryCost ?? item.approvedDeliveryCost ?? 0)).mul(qty)
      );
    }
  }

  const hasValidTaxInvoice = Boolean(orderOrParams.hasValidTaxInvoice || opts.hasValidTaxInvoice);
  for (const costs of manufacturerCosts.values()) {
    costs.productionCogs = costs.productionCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    costs.productionInputVat = costs.productionInputVat.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    costs.inventoryRecognizedCogs = costs.inventoryRecognizedCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    costs.legacyGrossCogs = costs.legacyGrossCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    costs.legacyDeliveryOverhead = costs.legacyDeliveryOverhead.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (hasValidTaxInvoice && costs.legacyGrossCogs.greaterThan(0)) {
      const netLegacyCost = costs.legacyGrossCogs.div(1.13).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      costs.legacyInputVat = costs.legacyGrossCogs.minus(netLegacyCost);
    }
  }

  directLegacyInventoryCogs = directLegacyInventoryCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const paymentMethod = String(order.paymentMethod || "COD").toUpperCase();
  const isCod = paymentMethod === "COD";
  const collectionDistributorId = isCod ? String(order.collectionDistributorId || "").trim() : "";
  const tenderMappingKey = isDirectDistributorSale
    ? order.payment !== true
      ? "CUSTOMER_RECEIVABLE_CONTROL"
      : ["CASH", "COD"].includes(paymentMethod)
        ? "CASH_ON_HAND"
        : "BANK"
    : isCod
      ? collectionDistributorId ? "DISTRIBUTOR_COD_RECEIVABLE" : "NCM_COD_RECEIVABLE"
      : "BANK";

  let customerParty = null;
  if (order.userId) {
    customerParty = await ensureAccountingParty({
      partyType: "CUSTOMER",
      sourceEntityId: order.userId,
      displayName: order.customerName || `Customer (${order.userId.slice(-6)})`,
    }, { client });
  }

  let collectionDistributorParty = null;
  let ncmParty = null;
  if (collectionDistributorId) {
    const distributor = await client.distributor.findUnique({
      where: { id: collectionDistributorId },
      select: { id: true, name: true },
    });
    if (!distributor) throw new Error("Distributor for COD receivable was not found.");
    collectionDistributorParty = await ensureAccountingParty({
      partyType: "DISTRIBUTOR",
      sourceEntityId: collectionDistributorId,
      displayName: distributor.name || `Distributor (${collectionDistributorId.slice(-6)})`,
    }, { client });
  } else if (tenderMappingKey === "NCM_COD_RECEIVABLE") {
    ncmParty = await ensureAccountingParty({
      partyType: "CARRIER",
      sourceEntityId: "NCM",
      displayName: "Nepal Can Move (NCM)",
    }, { client });
  }

  for (const costs of manufacturerCosts.values()) {
    if (!costs.manufacturerId) continue;
    const mfg = await client.manufacturer.findUnique({ where: { id: costs.manufacturerId } }).catch(() => null);
    costs.party = await ensureAccountingParty({
      partyType: "MANUFACTURER",
      sourceEntityId: costs.manufacturerId,
      displayName: mfg?.name || `Manufacturer (${costs.manufacturerId.slice(-6)})`,
    }, { client });
  }
  if ([...manufacturerCosts.values()].some((costs) =>
    costs.legacyDeliveryOverhead.greaterThan(0) && !costs.party
  )) {
    throw new Error("Legacy delivery/other cost requires a manufacturer accounting party.");
  }

  const lines = [
    {
      mappingKey: tenderMappingKey,
      debit: grossAmount,
      credit: 0,
      description: isDirectDistributorSale && order.payment !== true
        ? `Customer receivable for direct distributor Order #${order.id.slice(-6)}`
        : `Receivable/Tender for Order #${order.id.slice(-6)}`,
      customerId: collectionDistributorParty || ncmParty ? null : order.userId,
      accountingPartyId: collectionDistributorParty?.id || ncmParty?.id || customerParty?.id,
    },
    {
      mappingKey: "PRODUCT_SALES_REVENUE",
      debit: 0,
      credit: productTaxable,
      description: `Sales Revenue ex-VAT for Order #${order.id.slice(-6)}`,
      customerId: order.userId,
      accountingPartyId: customerParty?.id,
    },
    {
      mappingKey: "OUTPUT_VAT_PAYABLE",
      debit: 0,
      credit: totalVat,
      description: `${vatRate.toFixed(2)}% Output VAT Collected on Order #${order.id.slice(-6)}`,
    },
  ];

  if (deliveryTaxable.greaterThan(0)) {
    lines.push({
      mappingKey: "DELIVERY_REVENUE",
      debit: 0,
      credit: deliveryTaxable,
      description: `Delivery Revenue ex-VAT for Order #${order.id.slice(-6)}`,
      customerId: order.userId,
    });
  }

  for (const costs of manufacturerCosts.values()) {
    const legacyCogs = costs.legacyGrossCogs.minus(costs.legacyInputVat);
    const cogs = costs.productionCogs.plus(costs.inventoryRecognizedCogs).plus(legacyCogs);
    const inputVat = costs.productionInputVat.plus(costs.legacyInputVat);
    const manufacturerPayable = costs.productionCogs.plus(costs.productionInputVat).plus(costs.legacyGrossCogs);
    if (cogs.greaterThan(0)) {
      lines.push({
        mappingKey: "COGS",
        debit: cogs,
        credit: 0,
        description: `Approved manufacturer COGS for delivered Order #${order.id.slice(-6)}`,
        accountingPartyId: costs.party?.id,
      });
    }
    if (costs.inventoryRecognizedCogs.greaterThan(0)) {
      lines.push({
        mappingKey: "INVENTORY",
        debit: 0,
        credit: costs.inventoryRecognizedCogs,
        description: `Relieve previously recognized manufacturer inventory for Order #${order.id.slice(-6)}`,
      });
    }
    if (inputVat.greaterThan(0)) {
      lines.push({
        mappingKey: "INPUT_VAT_RECEIVABLE",
        debit: inputVat,
        credit: 0,
        description: `Verified manufacturer input VAT for delivered Order #${order.id.slice(-6)}`,
        accountingPartyId: costs.party?.id,
      });
    }
    if (costs.legacyDeliveryOverhead.greaterThan(0)) {
      lines.push({
        mappingKey: "DELIVERY_EXPENSE",
        debit: costs.legacyDeliveryOverhead,
        credit: 0,
        description: `Legacy delivery/other cost for delivered Order #${order.id.slice(-6)}`,
        accountingPartyId: costs.party?.id,
      });
    }
    const totalManufacturerPayable = manufacturerPayable.plus(costs.legacyDeliveryOverhead);
    if (totalManufacturerPayable.greaterThan(0)) {
      lines.push({
        mappingKey: "MANUFACTURER_PAYABLE",
        debit: 0,
        credit: totalManufacturerPayable,
        description: `Manufacturer payable recognized on delivery of Order #${order.id.slice(-6)}`,
        supplierId: costs.manufacturerId,
        accountingPartyId: costs.party?.id,
      });
    }
  }

  if (directLegacyInventoryCogs.greaterThan(0)) {
    lines.push(
      {
        mappingKey: "COGS",
        debit: directLegacyInventoryCogs,
        credit: 0,
        description: `Legacy hub inventory COGS for direct Order #${order.id.slice(-6)}`,
      },
      {
        mappingKey: "INVENTORY",
        debit: 0,
        credit: directLegacyInventoryCogs,
        description: `Legacy hub inventory reduction for direct Order #${order.id.slice(-6)}`,
      },
    );
  }

  const transactionDate = order.deliveredAt || deliveryOrder?.deliveredAt || new Date();

  return await postJournalEntry({
    transactionDate: new Date(transactionDate),
    sourceType: "DELIVERY_SALE",
    sourceId: order.id,
    idempotencyKey: `DELIVERY_SALE:${order.id}`,
    referenceNumber: `ORD-${order.id.slice(-6)}`,
    description: `Delivered sale, revenue, VAT, and manufacturer COGS for Order #${order.id.slice(-6)}`,
    lines,
    accountingEventId: opts.accountingEventId,
    afterPost: async (tx) => {
      if (collectionDistributorParty || ncmParty) {
        await createAccountingDocument({
          documentType: "INVOICE",
          documentNumber: collectionDistributorParty ? `DCO-${order.id}` : `NCM-COD-${order.id}`,
          partyId: collectionDistributorParty?.id || ncmParty.id,
          side: "RECEIVABLE",
          sourceType: collectionDistributorParty ? "DISTRIBUTOR_COD_SALE" : "NCM_COD_SALE",
          sourceId: order.id,
          amount: grossAmount,
          issueDate: transactionDate,
          idempotencyKey: collectionDistributorParty
            ? `DISTRIBUTOR_COD_SALE:${order.id}`
            : `NCM_COD_SALE:${order.id}`,
          notes: collectionDistributorParty
            ? `COD collected by distributor for delivered order ${order.id}.`
            : `COD collected by NCM for delivered order ${order.id}.`,
        }, { client: tx });
      }

      for (const costs of manufacturerCosts.values()) {
        if (!costs.party) continue;
        const amount = costs.productionCogs
          .plus(costs.productionInputVat)
          .plus(costs.legacyGrossCogs)
          .plus(costs.legacyDeliveryOverhead);
        if (!amount.greaterThan(0)) continue;
        const key = `MANUFACTURER_DELIVERY_COGS:${order.id}:${costs.manufacturerId}`;
        const documentHash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 24).toUpperCase();
        await createAccountingDocument({
          documentType: "BILL",
          documentNumber: `MFG-DEL-${documentHash}`,
          partyId: costs.party.id,
          side: "PAYABLE",
          sourceType: "MANUFACTURER_DELIVERY_COGS",
          sourceId: order.id,
          amount,
          issueDate: transactionDate,
          idempotencyKey: key,
          notes: `Manufacturer payable for delivered order ${order.id}.`,
        }, { client: tx });
      }
    },
    client,
  });
};

/**
 * Confirmed Delivery Return Posting
 * Reverses revenue, VAT, and manufacturer AP after physical inspection.
 */
export const postConfirmedDeliveryReturnAccounting = async ({ returnRecord, deliveryOrder, client = prisma }) => {
  if (!returnRecord || !returnRecord.id) return null;

  const returnId = returnRecord.id;
  const orderId = returnRecord.orderId;
  const order = await client.order.findUnique({ where: { id: orderId } });
  if (!order) return null;

  const grossAmount = new Prisma.Decimal(String(order.amount || 0));
  const deliveryCharge = new Prisma.Decimal(String(order.deliveryCharge || 0));
  const productGross = grossAmount.minus(deliveryCharge);

  const vatRate = await resolveVatRatePercent(order.date, { client });
  const vatDivisor = new Prisma.Decimal(1).plus(vatRate.div(100));
  const productTaxable = productGross.div(vatDivisor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const productVat = productGross.minus(productTaxable);
  const deliveryTaxable = deliveryCharge.greaterThan(0)
    ? deliveryCharge.div(vatDivisor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : new Prisma.Decimal(0);
  const deliveryVat = deliveryCharge.minus(deliveryTaxable);
  const totalVat = productVat.plus(deliveryVat);

  let items = [];
  try {
    items = typeof order.items === "string" ? JSON.parse(order.items) : (order.items || []);
  } catch {
    items = [];
  }
  await hydrateProductionCostRecognitionMode(items, client);

  let totalAgreedCogs = new Prisma.Decimal(0);
  let directLegacyInventoryCogs = new Prisma.Decimal(0);
  let productionLayerCogs = new Prisma.Decimal(0);
  let productionLayerInputVat = new Prisma.Decimal(0);
  let productionInventoryRecognizedCogs = new Prisma.Decimal(0);
  let legacyManufacturerCogs = new Prisma.Decimal(0);
  const isDirectDistributorSale = classifySaleChannel(order) === "DISTRIBUTOR_DIRECT";
  for (const item of items) {
    const qty = new Prisma.Decimal(String(item.quantity || 1));
    if (Array.isArray(item.productionCostAllocations)) {
      for (const allocation of item.productionCostAllocations) {
        const allocatedQuantity = new Prisma.Decimal(String(allocation.quantity || 0));
        const allocationCogs = new Prisma.Decimal(String(allocation.unitCogs || 0)).mul(allocatedQuantity);
        if (allocation.manufacturerPayableRecognizedAtProduction === true) {
          productionInventoryRecognizedCogs = productionInventoryRecognizedCogs.plus(allocationCogs);
        } else {
          productionLayerCogs = productionLayerCogs.plus(allocationCogs);
        }
        if (
          allocation.manufacturerPayableRecognizedAtProduction !== true &&
          allocation.vatInvoiceVerified === true
        ) {
          productionLayerInputVat = productionLayerInputVat.plus(
            new Prisma.Decimal(String(allocation.unitVatAmount || 0)).mul(allocatedQuantity)
          );
        }
      }
      const legacyQuantity = new Prisma.Decimal(String(item.legacyCostQuantity ?? qty));
      const legacyUnitCost = new Prisma.Decimal(String(
        item.legacyUnitCogsVatInclusiveAtAcceptance ??
        item.agreedUnitCogsVatInclusiveAtAcceptance ??
        item.costPrice ??
        0
      ));
      if (isDirectDistributorSale && item.costPrice !== undefined && item.costPrice !== null) {
        directLegacyInventoryCogs = directLegacyInventoryCogs.plus(
          new Prisma.Decimal(String(item.costPrice)).mul(legacyQuantity)
        );
      } else {
        legacyManufacturerCogs = legacyManufacturerCogs.plus(legacyUnitCost.mul(legacyQuantity));
      }
    } else {
      const unitCost = item.agreedUnitCogsVatInclusiveAtAcceptance !== undefined && item.agreedUnitCogsVatInclusiveAtAcceptance !== null
        ? new Prisma.Decimal(String(item.agreedUnitCogsVatInclusiveAtAcceptance))
        : (item.costPrice ? new Prisma.Decimal(String(item.costPrice)) : new Prisma.Decimal(0));
      if (isDirectDistributorSale && item.costPrice !== undefined && item.costPrice !== null) {
        directLegacyInventoryCogs = directLegacyInventoryCogs.plus(
          new Prisma.Decimal(String(item.costPrice)).mul(qty)
        );
      } else {
        legacyManufacturerCogs = legacyManufacturerCogs.plus(unitCost.mul(qty));
      }
    }
  }
  directLegacyInventoryCogs = directLegacyInventoryCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  productionLayerCogs = productionLayerCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  productionLayerInputVat = productionLayerInputVat.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  productionInventoryRecognizedCogs = productionInventoryRecognizedCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  legacyManufacturerCogs = legacyManufacturerCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  totalAgreedCogs = productionLayerCogs
    .plus(productionInventoryRecognizedCogs)
    .plus(legacyManufacturerCogs)
    .plus(directLegacyInventoryCogs)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const isDirect = classifySaleChannel(order) === "MANUFACTURER_DIRECT";
  let commissionAmount = new Prisma.Decimal(0);
  if (isDirect && totalAgreedCogs.greaterThan(0)) {
    // Reverse commissions already posted for legacy direct orders when they are returned.
    const commissionRate = items[0]?.agreedCommissionRateAtAcceptance || 0;
    if (Number(commissionRate) > 0) {
      const comm = calculateLegacyManufacturerCommission({
        productRevenueExVat: productTaxable.toString(),
        agreedCogsVatInclusive: totalAgreedCogs.toString(),
        recoverableInputVat: "0",
        commissionRatePercent: commissionRate,
      });
      commissionAmount = new Prisma.Decimal(comm.commissionAmount);
    }
  }

  const paymentMethod = String(order.paymentMethod || "COD").toUpperCase();
  const isCod = paymentMethod === "COD";
  const tenderMappingKey = isDirectDistributorSale
    ? order.payment !== true
      ? "CUSTOMER_RECEIVABLE_CONTROL"
      : ["CASH", "COD"].includes(paymentMethod)
        ? "CASH_ON_HAND"
        : "BANK"
    : isCod ? "NCM_COD_RECEIVABLE" : "BANK";

  const manufacturerId = returnRecord.manufacturerId || order.manufacturerId ||
    items.find((item) => item?.manufacturerId)?.manufacturerId ||
    items.flatMap((item) => item?.productionCostAllocations || [])
      .find((allocation) => allocation?.manufacturerId)?.manufacturerId || null;
  let manufacturerParty = null;
  if (manufacturerId) {
    const mfg = await client.manufacturer.findUnique({ where: { id: manufacturerId } }).catch(() => null);
    manufacturerParty = await ensureAccountingParty({
      partyType: "MANUFACTURER",
      sourceEntityId: manufacturerId,
      displayName: mfg?.name || `Manufacturer (${manufacturerId.slice(-6)})`,
    }, { client });
  }

  const lines = [
    {
      mappingKey: "SALES_RETURNS",
      debit: productTaxable.plus(deliveryTaxable),
      credit: 0,
      description: `Sales Return ex-VAT reversal for Order #${order.id.slice(-6)}`,
    },
    {
      mappingKey: "OUTPUT_VAT_PAYABLE",
      debit: totalVat,
      credit: 0,
      description: `Output VAT adjustment for return of Order #${order.id.slice(-6)}`,
    },
    {
      mappingKey: tenderMappingKey,
      debit: 0,
      credit: grossAmount,
      description: `Clear COD/Payment receivable for returned Order #${order.id.slice(-6)}`,
    },
  ];

  if (legacyManufacturerCogs.greaterThan(0)) {
    lines.push(
      {
        mappingKey: "MANUFACTURER_PAYABLE",
        debit: legacyManufacturerCogs,
        credit: 0,
        description: `Reverse Manufacturer AP for returned Order #${order.id.slice(-6)}`,
        accountingPartyId: manufacturerParty?.id,
      },
      {
        mappingKey: "COGS",
        debit: 0,
        credit: legacyManufacturerCogs,
        description: `Reverse COGS for returned Order #${order.id.slice(-6)}`,
        accountingPartyId: manufacturerParty?.id,
      }
    );
  }

  if (directLegacyInventoryCogs.greaterThan(0)) {
    lines.push(
      {
        mappingKey: "INVENTORY",
        debit: directLegacyInventoryCogs,
        credit: 0,
        description: `Restore legacy hub inventory for returned Order #${order.id.slice(-6)}`,
      },
      {
        mappingKey: "COGS",
        debit: 0,
        credit: directLegacyInventoryCogs,
        description: `Reverse legacy hub inventory COGS for returned Order #${order.id.slice(-6)}`,
      },
    );
  }

  if (productionLayerCogs.greaterThan(0)) {
    lines.push(
      {
        mappingKey: "MANUFACTURER_PAYABLE",
        debit: productionLayerCogs.plus(productionLayerInputVat),
        credit: 0,
        description: `Reverse manufacturer payable for returned production-batch goods on Order #${order.id.slice(-6)}`,
        supplierId: manufacturerId,
        accountingPartyId: manufacturerParty?.id,
      },
      {
        mappingKey: "COGS",
        debit: 0,
        credit: productionLayerCogs,
        description: `Reverse production-batch COGS for returned Order #${order.id.slice(-6)}`,
        accountingPartyId: manufacturerParty?.id,
      },
      ...(productionLayerInputVat.greaterThan(0) ? [{
        mappingKey: "INPUT_VAT_RECEIVABLE",
        debit: 0,
        credit: productionLayerInputVat,
        description: `Reverse recoverable manufacturer input VAT for returned Order #${order.id.slice(-6)}`,
        supplierId: manufacturerId,
        accountingPartyId: manufacturerParty?.id,
      }] : [])
    );
  }
  if (productionInventoryRecognizedCogs.greaterThan(0)) {
    lines.push(
      {
        mappingKey: "INVENTORY",
        debit: productionInventoryRecognizedCogs,
        credit: 0,
        description: `Restore previously recognized production-batch inventory for returned Order #${order.id.slice(-6)}`,
      },
      {
        mappingKey: "COGS",
        debit: 0,
        credit: productionInventoryRecognizedCogs,
        description: `Reverse COGS for returned pre-cutover production-batch inventory on Order #${order.id.slice(-6)}`,
        accountingPartyId: manufacturerParty?.id,
      },
    );
  }

  if (commissionAmount.greaterThan(0)) {
    lines.push(
      {
        mappingKey: "MANUFACTURER_PAYABLE",
        debit: commissionAmount,
        credit: 0,
        description: `Reverse Manufacturer Commission AP for returned Order #${order.id.slice(-6)}`,
        accountingPartyId: manufacturerParty?.id,
      },
      {
        mappingKey: "MANUFACTURER_COMMISSION_EXPENSE",
        debit: 0,
        credit: commissionAmount,
        description: `Reverse Manufacturer Commission Expense for returned Order #${order.id.slice(-6)}`,
        accountingPartyId: manufacturerParty?.id,
      }
    );
  }

  const supplierCreditAmount = legacyManufacturerCogs
    .plus(productionLayerCogs)
    .plus(productionLayerInputVat)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return await postJournalEntry({
    transactionDate: new Date(),
    sourceType: "DELIVERY_RETURN",
    sourceId: returnId,
    idempotencyKey: `DELIVERY_RETURN:${returnId}`,
    referenceNumber: `RET-${returnId.slice(-6)}`,
    description: `Confirmed delivery return and financial reversal for Order #${order.id.slice(-6)}`,
    lines,
    afterPost: async (tx) => {
      if (!manufacturerParty || !supplierCreditAmount.greaterThan(0)) return;
      const deliveryBill = await tx.accountingDocument.findFirst({
        where: {
          partyId: manufacturerParty.id,
          side: "PAYABLE",
          sourceType: "MANUFACTURER_DELIVERY_COGS",
          sourceId: order.id,
        },
        select: { id: true },
      });
      if (!deliveryBill) return;
      const key = `MANUFACTURER_DELIVERY_RETURN:${returnId}:${manufacturerId}`;
      const documentHash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 24).toUpperCase();
      await createAccountingDocument({
        documentType: "CREDIT_NOTE",
        documentNumber: `MFG-RET-${documentHash}`,
        partyId: manufacturerParty.id,
        side: "RECEIVABLE",
        sourceType: "MANUFACTURER_DELIVERY_RETURN",
        sourceId: returnId,
        amount: supplierCreditAmount,
        issueDate: new Date(),
        idempotencyKey: key,
        notes: `Supplier credit for manufacturer payable reversed on returned order ${order.id}.`,
      }, { client: tx });
    },
    client,
  });
};

/**
 * Marketing Partner CPA Redemption Posting
 * Accrues CPA expense and partner payable on verified benefit redemption.
 */
export const postMarketingCpaRedemptionAccounting = async ({ redemption, campaign, partner, client = prisma }) => {
  if (!redemption || !redemption.id) return null;
  const cpaRate = new Prisma.Decimal(String(campaign?.cpaRate || redemption.cpaRate || 0));
  if (cpaRate.lessThanOrEqualTo(0)) return null;

  const partnerId = partner?.id || campaign?.marketingPartnerId || redemption.partnerId;
  let partnerParty = null;
  if (partnerId) {
    const p = partner || await client.marketingPartner.findUnique({ where: { id: partnerId } }).catch(() => null);
    partnerParty = await ensureAccountingParty({
      partyType: "MARKETING_PARTNER",
      sourceEntityId: partnerId,
      displayName: p?.name || `Marketing Partner (${partnerId.slice(-6)})`,
    }, { client });
  }

  const lines = [
    {
      mappingKey: "MARKETING_PARTNER_CPA_EXPENSE",
      debit: cpaRate,
      credit: 0,
      description: `Marketing CPA expense for card benefit redemption #${redemption.id.slice(-6)}`,
      accountingPartyId: partnerParty?.id,
    },
    {
      mappingKey: "MARKETING_PARTNER_PAYABLE",
      debit: 0,
      credit: cpaRate,
      description: `Marketing CPA payable for partner ${partner?.name || partnerId}`,
      accountingPartyId: partnerParty?.id,
    },
  ];

  return await postJournalEntry({
    transactionDate: redemption.redeemedAt ? new Date(redemption.redeemedAt) : new Date(),
    sourceType: "MARKETING_CPA",
    sourceId: redemption.id,
    idempotencyKey: `MARKETING_CPA:${redemption.id}`,
    referenceNumber: `CPA-${redemption.id.slice(-6)}`,
    description: `Marketing CPA accrual for benefit redemption on card ${redemption.cardId || ""}`,
    lines,
    client,
  });
};

export const postCollaborationFeeInvoiceAccounting = async ({ invoice, partner, client = prisma }) => {
  if (!invoice?.id || !partner?.id) return null;
  const totalAmount = new Prisma.Decimal(String(invoice.totalAmount || 0));
  if (totalAmount.lessThanOrEqualTo(0)) return null;

  const partnerParty = await ensureAccountingParty({
    partyType: "MARKETING_PARTNER",
    sourceEntityId: partner.id,
    displayName: partner.name || `Marketing Partner (${partner.id.slice(-6)})`,
  }, { client });
  const netAmount = new Prisma.Decimal(String(invoice.netAmount || 0));
  const vatAmount = new Prisma.Decimal(String(invoice.vatAmount || 0));
  const lines = [{
    mappingKey: "CUSTOMER_RECEIVABLE_CONTROL",
    debit: totalAmount,
    credit: 0,
    description: `Collaboration fee receivable for ${invoice.invoiceNumber}`,
    accountingPartyId: partnerParty.id,
  }];

  for (const [mappingKey, amount, description] of [
    ["COLLABORATION_FEE_REVENUE", netAmount, `Collaboration selling fee revenue for ${invoice.invoiceNumber}`],
    ["OUTPUT_VAT_PAYABLE", vatAmount, `Output VAT on collaboration fees for ${invoice.invoiceNumber}`],
  ]) {
    if (amount.isZero()) continue;
    lines.push({
      mappingKey,
      debit: amount.isNegative() ? amount.abs() : 0,
      credit: amount.isPositive() ? amount : 0,
      description,
      accountingPartyId: partnerParty.id,
    });
  }

  return postJournalEntry({
    transactionDate: invoice.issuedAt || new Date(),
    sourceType: "COLLABORATION_FEE_INVOICE",
    sourceId: invoice.id,
    idempotencyKey: `COLLABORATION_FEE_INVOICE:${invoice.id}`,
    referenceNumber: invoice.invoiceNumber,
    description: `Monthly collaboration fee invoice for ${partner.name}`,
    lines,
    client,
  });
};

/**
 * NCM Carrier Settlement Posting
 * Bank remittance clears COD receivable and recognizes carrier fee expense.
 */
export const postNcmSettlementAccounting = async ({ settlement, client = prisma }) => {
  if (!settlement || !settlement.id) return null;

  const codCollected = new Prisma.Decimal(String(settlement.codCollected || 0));
  const feeActual = new Prisma.Decimal(String(settlement.deliveryFeeActual || 0));
  const netRemitted = codCollected.minus(feeActual);

  if (codCollected.lessThanOrEqualTo(0) && feeActual.lessThanOrEqualTo(0)) return null;

  const lines = [];
  if (netRemitted.greaterThan(0)) {
    lines.push({
      mappingKey: "BANK",
      debit: netRemitted,
      credit: 0,
      description: `Bank deposit from NCM COD remittance for ticket #${settlement.ncmTicketId || settlement.id.slice(-6)}`,
    });
  }
  if (feeActual.greaterThan(0)) {
    lines.push({
      mappingKey: "DELIVERY_EXPENSE",
      debit: feeActual,
      credit: 0,
      description: `NCM carrier delivery fee expense for settlement #${settlement.id.slice(-6)}`,
    });
  }
  if (codCollected.greaterThan(0)) {
    lines.push({
      mappingKey: "NCM_COD_RECEIVABLE",
      debit: 0,
      credit: codCollected,
      description: `Clear NCM COD Receivable for ticket #${settlement.ncmTicketId || settlement.id.slice(-6)}`,
    });
  }

  return await postJournalEntry({
    transactionDate: settlement.settledAt ? new Date(settlement.settledAt) : new Date(),
    sourceType: "NCM_SETTLEMENT",
    sourceId: settlement.id,
    idempotencyKey: `NCM_SETTLEMENT:${settlement.id}`,
    referenceNumber: `NCM-${settlement.ncmTicketId || settlement.id.slice(-6)}`,
    description: `NCM COD bank remittance and carrier fee settlement`,
    lines,
    client,
  });
};

export const postNcmCarrierFeeAccrualAccounting = async ({
  settlementId,
  feeAmount,
  ncmPartyId,
  createdBy = "ADMIN",
}, { client = prisma } = {}) => {
  const fee = new Prisma.Decimal(String(feeAmount || 0));
  if (!fee.isFinite() || fee.isNegative()) {
    throw new Error("NCM carrier fee must be a non-negative amount.");
  }
  if (fee.isZero()) return null;
  if (!settlementId || !ncmPartyId) {
    throw new Error("NCM settlement and carrier party are required to accrue carrier fees.");
  }
  return postJournalEntry({
    transactionDate: new Date(),
    sourceType: "NCM_CARRIER_FEE_ACCRUAL",
    sourceId: settlementId,
    idempotencyKey: `NCM_CARRIER_FEE_ACCRUAL:${settlementId}`,
    referenceNumber: `NCM-FEE-${String(settlementId).slice(-8)}`,
    description: "Accrue NCM carrier fee deducted from COD remittance.",
    createdBy,
    lines: [
      {
        mappingKey: "DELIVERY_EXPENSE",
        debit: fee,
        credit: 0,
        description: "NCM carrier fee expense accrued at remittance.",
        accountingPartyId: ncmPartyId,
      },
      {
        mappingKey: "NCM_CARRIER_PAYABLE",
        debit: 0,
        credit: fee,
        description: "NCM carrier fee payable accrued before net settlement.",
        accountingPartyId: ncmPartyId,
      },
    ],
    client,
  });
};

/**
 * 1. Sales Invoice & Order Accounting
 * DR Accounts Receivable / Cash: Total MRP Amount
 * CR Sales Revenue: Taxable Base Amount (Ex-13% VAT)
 * CR Output VAT: 13% Embedded VAT
 * DR Cost of Goods Sold (COGS): Direct Product Cost
 * CR Merchandise Inventory: Direct Product Cost
 */
export const postSalesOrderAccounting = async (order, opts = {}) => {
  try {
    if (!order || !order.id) return null;
    const grossAmount = Number(order.amount || 0);
    if (grossAmount <= 0) return null;

    const client = opts.client || prisma;
    const dateVal = order.date ? new Date(Number(order.date)) : new Date();
    const vatRate = await resolveVatRatePercent(dateVal, { client });
    const grossDecimal = new Prisma.Decimal(String(grossAmount));
    const vatDivisor = new Prisma.Decimal(1).plus(vatRate.div(100));
    const taxableRevenue = grossDecimal.div(vatDivisor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
    const outputVat = grossDecimal.minus(taxableRevenue).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();

    // Calculate Direct Product COGS from order items
    let items = [];
    try {
      items = typeof order.items === "string" ? JSON.parse(order.items) : (order.items || []);
    } catch {
      items = [];
    }

    let totalCOGS = 0;
    for (const item of items) {
      const pId = item.productId || item._id || item.id;
      const qty = Number(item.quantity || 1);
      if (pId) {
        const product = await client.product.findUnique({ where: { id: pId }, select: { costPrice: true } });
        const unitCost = product ? Number(product.costPrice || 0) : 0;
        totalCOGS += unitCost * qty;
      }
    }
    totalCOGS = Number(totalCOGS.toFixed(2));

    const isPrepaid = order.payment === true || order.paymentMethod !== "COD";
    const arOrCashAccount = isPrepaid ? "1120" : "1130"; // 1120 Bank if online, 1130 AR if COD

    const lines = [
      // Revenue Leg
      {
        accountCode: arOrCashAccount,
        debit: grossAmount,
        credit: 0,
        description: `Receivable/Payment for Order #${order.id.slice(-6)}`,
        customerId: order.userId,
      },
      {
        accountCode: "4100",
        debit: 0,
        credit: taxableRevenue,
        description: `Taxable Sales Revenue for Order #${order.id.slice(-6)}`,
        customerId: order.userId,
      },
      {
        accountCode: "2120",
        debit: 0,
        credit: outputVat,
        description: `${vatRate.toFixed(2)}% Output VAT Collected for Order #${order.id.slice(-6)}`,
      },
    ];

    // Inventory Perpetual Leg
    if (totalCOGS > 0) {
      lines.push(
        {
          accountCode: "5100",
          debit: totalCOGS,
          credit: 0,
          description: `COGS for Order #${order.id.slice(-6)}`,
        },
        {
          accountCode: "1140",
          debit: 0,
          credit: totalCOGS,
          description: `Inventory reduction for Order #${order.id.slice(-6)}`,
        }
      );
    }

    return await postJournalEntry({
      transactionDate: dateVal,
      sourceType: "SALES_INVOICE",
      sourceId: order.id,
      idempotencyKey: `SALES_INVOICE:${order.id}`,
      referenceNumber: `ORD-${order.id.slice(-6)}`,
      description: `Sales Revenue & COGS recognition for Order #${order.id.slice(-6)} (${order.paymentMethod})`,
      lines,
      client,
    });
  } catch (error) {
    console.error("Error in postSalesOrderAccounting:", error);
    throw error;
  }
};

/**
 * 2. Customer Payment Received (Clearing Accounts Receivable)
 * DR Cash/Bank (1110/1120)
 * CR Accounts Receivable (1130)
 */
export const postCustomerPaymentAccounting = async (paramsOrOrder) => {
  try {
    const orderId = paramsOrOrder.orderId || paramsOrOrder.id;
    const customerName = paramsOrOrder.customerName || (paramsOrOrder.userId ? `Customer (${paramsOrOrder.userId.slice(-6)})` : "Customer");
    const amt = Number(paramsOrOrder.amount || 0);
    const settlementAmount = Number(paramsOrOrder.settlementAmount ?? amt);
    const discountAmount = Number(paramsOrOrder.discountAmount || 0);
    const fineAmount = Number(paramsOrOrder.fineAmount || 0);
    const depositAccountType = paramsOrOrder.depositAccountType || "BANK";
    const depositAccountCode = paramsOrOrder.depositAccountCode || (depositAccountType === "CASH" ? "1110" : "1120");
    const referenceNumber = paramsOrOrder.referenceNumber;
    const idempotencyKey = paramsOrOrder.idempotencyKey || `CUSTOMER_PAYMENT:${orderId}:${amt}`;
    const client = paramsOrOrder.client || prisma;

    if (amt <= 0) return null;

    return await postJournalEntry({
      transactionDate: new Date(),
      sourceType: "CUSTOMER_PAYMENT",
      sourceId: orderId,
      idempotencyKey,
      referenceNumber: referenceNumber || `PAY-${orderId ? orderId.slice(-6) : Date.now()}`,
      description: `Customer payment received from ${customerName || "Customer"}`,
      lines: [
        {
          accountCode: depositAccountCode,
          debit: amt,
          credit: 0,
          description: `Cash/Bank receipt for Order #${orderId ? orderId.slice(-6) : ""}`,
        },
        ...(discountAmount > 0 ? [{
          accountCode: "6700",
          debit: discountAmount,
          credit: 0,
          description: `Discount allowed on receivable from ${customerName}`,
        }] : []),
        {
          accountCode: "1130",
          debit: 0,
          credit: settlementAmount,
          description: `Clear Accounts Receivable for Order #${orderId ? orderId.slice(-6) : ""}`,
          customerName,
        },
        ...(fineAmount > 0 ? [{
          accountCode: "8100",
          debit: 0,
          credit: fineAmount,
          description: `Fine income on receivable from ${customerName}`,
        }] : []),
      ],
      client,
    });
  } catch (error) {
    console.error("Error in postCustomerPaymentAccounting:", error);
    throw error;
  }
};

/**
 * 3. Inbound Supplier Shipment / Inventory Purchase
 * DR Merchandise Inventory (1140): Ex-VAT Base Cost
 * DR Input VAT Receivable (1150): 13% Tax
 * CR Bank (1120) [paidAmount] and/or CR Accounts Payable (2110) [payableAmount]
 */
export const postInboundShipmentAccounting = async (shipmentOrParams, opts = {}) => {
  try {
    const shipmentId = shipmentOrParams.shipmentId || shipmentOrParams.id;
    const batchNumber = shipmentOrParams.batchNumber || `BATCH-${Date.now().toString().slice(-4)}`;
    const carrier = shipmentOrParams.carrier || "Freight Carrier";
    const supplierName = shipmentOrParams.supplierName || opts.supplierName || "Supplier";
    const freight = Number(shipmentOrParams.totalFreightCost || 0);
    const taxes = Number(shipmentOrParams.customsOrTaxes || 0);
    const itemsCost = Number(shipmentOrParams.totalItemsCost || shipmentOrParams.itemsTotalCost || 0);
    const totalBatchCost = Number((freight + taxes + itemsCost).toFixed(2));

    if (totalBatchCost <= 0) return null;

    let paidAmount = Number(shipmentOrParams.paidAmount || opts.paidAmount || 0);
    let payableAmount = Number(shipmentOrParams.payableAmount || opts.payableAmount || 0);

    // If neither explicitly provided, infer from paidFromAccountId or isCredit
    if (paidAmount === 0 && payableAmount === 0) {
      if (shipmentOrParams.paidFromAccountId && (shipmentOrParams.isCredit === false || opts.recordAsPayable === false)) {
        paidAmount = totalBatchCost;
      } else {
        payableAmount = totalBatchCost;
      }
    }

    const lines = [
      {
        accountCode: "1140",
        debit: Number((freight + itemsCost).toFixed(2)),
        credit: 0,
        description: `Inventory & Freight landed cost for Batch ${batchNumber} (${supplierName})`,
        supplierName,
      },
    ];

    if (taxes > 0) {
      lines.push({
        accountCode: "1150",
        debit: taxes,
        credit: 0,
        description: `Input VAT / Customs Duty for Batch ${batchNumber}`,
      });
    }

    // Split credits between Bank (paidAmount) and Accounts Payable (payableAmount)
    if (paidAmount > 0) {
      lines.push({
        accountCode: "1120",
        debit: 0,
        credit: paidAmount,
        description: `Upfront payment to ${supplierName} / ${carrier} for Batch ${batchNumber}`,
        supplierName,
      });
    }

    if (payableAmount > 0) {
      lines.push({
        accountCode: "2110",
        debit: 0,
        credit: payableAmount,
        description: `Accounts Payable liability owed to ${supplierName} for Batch ${batchNumber}`,
        supplierName,
      });
    }

    return await postJournalEntry({
      transactionDate: shipmentOrParams.shipmentDate ? new Date(shipmentOrParams.shipmentDate) : new Date(),
      sourceType: "PURCHASE_BILL",
      sourceId: shipmentId || batchNumber,
      idempotencyKey: `PURCHASE_BILL:${shipmentId || batchNumber}`,
      referenceNumber: batchNumber,
      description: `Inbound inventory purchase & freight landed cost for ${batchNumber} (${supplierName})`,
      lines,
    });
  } catch (error) {
    console.error("Error in postInboundShipmentAccounting:", error);
    throw error;
  }
};

/**
 * 4. Supplier Payable Settlement
 * DR Accounts Payable (2110)
 * CR Bank Accounts (1120) / Cash (1110)
 */
export const postSupplierPaymentAccounting = async ({
  payableId,
  payeeName,
  amount,
  settlementAmount,
  discountAmount = 0,
  fineAmount = 0,
  fromAccountType = "BANK",
  referenceNumber,
  payableAccountCode = "2110",
  cashAccountCode,
  cashAccountId = null,
  supplierId = null,
  accountingPartyId = null,
  idempotencyKey,
  client = prisma,
}) => {
  try {
    const amt = Number(amount || 0);
    if (amt <= 0) return null;
    const settled = Number(settlementAmount ?? (amt + Number(discountAmount || 0) - Number(fineAmount || 0)));

    const cashBankCode = cashAccountCode || (fromAccountType === "CASH" ? "1110" : "1120");

    return await postJournalEntry({
      transactionDate: new Date(),
      sourceType: "SUPPLIER_PAYMENT",
      sourceId: payableId,
      idempotencyKey: idempotencyKey || `SUPPLIER_PAYMENT:${payableId}:${Date.now()}`,
      referenceNumber: referenceNumber || `SETTLE-${payableId ? payableId.slice(-6) : ""}`,
      description: `Payable settlement paid to ${payeeName}`,
      lines: [
        {
          accountCode: payableAccountCode,
          debit: settled,
          credit: 0,
          description: `Settle Accounts Payable for ${payeeName}`,
          ...(supplierId ? { supplierId } : {}),
          supplierName: payeeName,
          ...(accountingPartyId ? { accountingPartyId } : {}),
        },
        ...(Number(fineAmount) > 0 ? [{
          accountCode: "6700",
          debit: Number(fineAmount),
          credit: 0,
          description: `Fine expense on payable to ${payeeName}`,
        }] : []),
        {
          ...(cashAccountId ? { accountId: cashAccountId } : { accountCode: cashBankCode }),
          debit: 0,
          credit: amt,
          description: `Disbursed from liquid account to ${payeeName}`,
        },
        ...(Number(discountAmount) > 0 ? [{
          accountCode: "8100",
          debit: 0,
          credit: Number(discountAmount),
          description: `Discount received on payable to ${payeeName}`,
        }] : []),
      ],
      client,
    });
  } catch (error) {
    console.error("Error in postSupplierPaymentAccounting:", error);
    throw error;
  }
};

export const postDistributorSettlementRequestAccounting = async ({
  settlement,
  distributorName,
  client = prisma,
}) => {
  const amount = Number(settlement?.amount || 0);
  if (!settlement?.id || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("A valid distributor settlement request and positive amount are required for accounting.");
  }
  return postJournalEntry({
    transactionDate: settlement.requestedAt || new Date(),
    sourceType: "DISTRIBUTOR_SETTLEMENT_REQUEST",
    sourceId: settlement.id,
    idempotencyKey: `DISTRIBUTOR_SETTLEMENT_REQUEST:${settlement.id}`,
    referenceNumber: `DIST-SET-${settlement.id.slice(-8)}`,
    description: `Distributor delivery services payable to ${distributorName}`,
    lines: [
      {
        accountCode: "6430",
        debit: amount,
        credit: 0,
        description: `Distributor settlement service expense for ${distributorName}`,
        supplierName: distributorName,
      },
      {
        accountCode: "2110",
        debit: 0,
        credit: amount,
        description: `Distributor settlement payable to ${distributorName}`,
        supplierName: distributorName,
      },
    ],
    client,
  });
};

/**
 * 5. Customer Return (RMA) & Sales Reversal
 * DR Sales Returns (4500): Ex-VAT Base
 * DR Output VAT Adjustment (2120): 13% VAT
 * CR Cash/Bank (1110/1120) or Customer Refund Payable (2140) / AP (2110)
 * (If restocked): DR Merchandise Inventory (1140), CR COGS (5100)
 */
export const buildCustomerReturnAccountingLines = ({
  returnId,
  customerName,
  totalRefund,
  vat,
  isPayable,
  refundMethod,
  treasuryGlAccountId,
  restockedInventoryCost,
  damagedInventoryCost,
}) => {
  const netReturn = Number((totalRefund - vat).toFixed(2));
  const creditAccount = isPayable ? "2110" : refundMethod === "BANK_TRANSFER" ? "1120" : refundMethod === "CASH" ? "1110" : "2140";
  const lines = [
    {
      accountCode: "4500",
      debit: netReturn,
      credit: 0,
      description: `Sales Return ex-VAT for RMA #${returnId ? returnId.slice(-6) : ""}`,
      customerName,
    },
    {
      accountCode: "2120",
      debit: vat,
      credit: 0,
      description: `Output VAT adjustment for RMA #${returnId ? returnId.slice(-6) : ""}`,
    },
    {
      ...(treasuryGlAccountId ? { accountId: treasuryGlAccountId } : { accountCode: creditAccount }),
      debit: 0,
      credit: totalRefund,
      description: `Refund payout/credit to ${customerName}`,
      customerName,
    },
  ];

  const restockCost = Number(restockedInventoryCost);
  if (Number.isFinite(restockCost) && restockCost > 0) {
    lines.push(
      {
        accountCode: "1140",
        debit: restockCost,
        credit: 0,
        description: `Restock inventory for RMA #${returnId ? returnId.slice(-6) : ""}`,
      },
      {
        accountCode: "5100",
        debit: 0,
        credit: restockCost,
        description: `Reverse COGS for restocked item in RMA #${returnId ? returnId.slice(-6) : ""}`,
      },
    );
  }
  const damagedCost = Number(damagedInventoryCost);
  if (Number.isFinite(damagedCost) && damagedCost > 0) {
    lines.push(
      {
        accountCode: "5500",
        debit: damagedCost,
        credit: 0,
        description: `Scrap loss for damaged return RMA #${returnId ? returnId.slice(-6) : ""}`,
      },
      {
        accountCode: "5100",
        debit: 0,
        credit: damagedCost,
        description: `Relieve sold COGS for damaged return RMA #${returnId ? returnId.slice(-6) : ""}`,
      },
    );
  }
  return lines;
};

export const resolveCustomerReturnTreasuryGlAccountId = async (client, financialAccountId) => {
  const selectedTreasuryAccount = await client.financialAccount.findUnique({
    where: { id: financialAccountId },
  });
  const treasuryGlAccountId = selectedTreasuryAccount?.accountId || null;
  if (!treasuryGlAccountId) {
    throw new Error("The selected refund treasury account is not linked to a General Ledger account.");
  }
  return treasuryGlAccountId;
};

export const postCustomerReturnAccounting = async (returnOrParams, opts = {}) => {
  try {
    const client = opts.client || prisma;
    const returnId = returnOrParams.returnId || returnOrParams.id;
    const customerName = returnOrParams.customerName || "Customer";
    const totalRefund = Number(returnOrParams.totalRefundAmount || returnOrParams.refundAmount || 0);
    if (!Number.isFinite(totalRefund) || totalRefund < 0) {
      throw new Error("Customer return refund amount must be a non-negative finite amount.");
    }

    let vat = returnOrParams.vatRefunded;
    if (vat === undefined || vat === null) {
      const sourceOrder = returnOrParams.orderId
        ? await client.order.findUnique({ where: { id: returnOrParams.orderId }, select: { date: true } })
        : null;
      const transactionDate = sourceOrder?.date ?? returnOrParams.inspectedAt ?? returnOrParams.completedAt ?? new Date();
      const vatRate = await resolveVatRatePercent(transactionDate, { client });
      const vatDivisor = new Prisma.Decimal(1).plus(vatRate.div(100));
      vat = new Prisma.Decimal(String(totalRefund)).minus(
        new Prisma.Decimal(String(totalRefund)).div(vatDivisor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      ).toNumber();
    }
    vat = Number(vat);
    if (!Number.isFinite(vat) || vat < 0 || vat > totalRefund) {
      throw new Error("Customer return VAT adjustment must be between zero and the refund amount.");
    }
    const isPayable = opts.recordAsPayable !== undefined ? opts.recordAsPayable : returnOrParams.refundMethod === "PAYABLE";
    const refundMethod = returnOrParams.refundMethod || (isPayable ? "PAYABLE" : "CASH");
    const selectedTreasuryAccountId = opts.refundFromAccountId || returnOrParams.refundFromAccountId;
    let treasuryGlAccountId = null;
    if (!isPayable && selectedTreasuryAccountId) {
      treasuryGlAccountId = await resolveCustomerReturnTreasuryGlAccountId(client, selectedTreasuryAccountId);
    }
    const lines = buildCustomerReturnAccountingLines({
      returnId,
      customerName,
      totalRefund,
      vat,
      isPayable,
      refundMethod,
      treasuryGlAccountId,
      restockedInventoryCost: returnOrParams.restockedInventoryCost,
      damagedInventoryCost: returnOrParams.damagedInventoryCost,
    });
    const hasInventoryAdjustment = Number(returnOrParams.restockedInventoryCost) > 0
      || Number(returnOrParams.damagedInventoryCost) > 0;
    if (totalRefund === 0 && !hasInventoryAdjustment) return null;

    return await postJournalEntry({
      transactionDate: new Date(returnOrParams.inspectedAt || returnOrParams.completedAt || new Date()),
      sourceType: "SALES_RETURN",
      sourceId: returnId,
      idempotencyKey: `SALES_RETURN:${returnId}`,
      referenceNumber: `RMA-${returnId ? returnId.slice(-6) : ""}`,
      description: `Customer Return RMA refund and revenue reversal for ${customerName}`,
      lines,
      client,
    });
  } catch (error) {
    console.error("Error in postCustomerReturnAccounting:", error);
    throw error;
  }
};

export const postDistributorCustomerRefundAccounting = async ({
  returnRecord,
  client = prisma,
} = {}) => {
  if (!returnRecord?.id || !returnRecord.distributorId) {
    throw new Error("Distributor refund accounting requires a return and distributor.");
  }
  const totalRefund = new Prisma.Decimal(String(
    returnRecord.approvedRefundAmount ?? returnRecord.totalRefundAmount ?? 0,
  )).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (totalRefund.lessThanOrEqualTo(0)) throw new Error("Approved distributor refund must be greater than zero.");
  const vat = new Prisma.Decimal(String(returnRecord.vatRefunded || 0))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (vat.isNegative() || vat.greaterThan(totalRefund)) {
    throw new Error("Approved distributor refund VAT is invalid.");
  }
  const netReturn = totalRefund.minus(vat);
  const distributor = await client.distributor.findUnique({
    where: { id: returnRecord.distributorId },
    select: { id: true, name: true },
  });
  if (!distributor) throw new Error("Distributor for return refund payable was not found.");
  const distributorParty = await ensureAccountingParty({
    partyType: "DISTRIBUTOR",
    sourceEntityId: distributor.id,
    displayName: distributor.name || `Distributor (${distributor.id.slice(-6)})`,
  }, { client });

  const items = parseItemsForAccounting(returnRecord.items);
  const restockedInventoryCost = items.reduce((total, item) => {
    if (String(item.condition || "").toUpperCase() !== "RESTOCKABLE") return total;
    const unitCost = new Prisma.Decimal(String(item.unitCostPrice || 0));
    const quantity = new Prisma.Decimal(String(item.quantity || 0));
    return total.plus(unitCost.mul(quantity));
  }, new Prisma.Decimal(0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const damagedInventoryCost = items.reduce((total, item) => {
    if (String(item.condition || "").toUpperCase() !== "DAMAGED") return total;
    const unitCost = new Prisma.Decimal(String(item.unitCostPrice || 0));
    const quantity = new Prisma.Decimal(String(item.quantity || 0));
    return total.plus(unitCost.mul(quantity));
  }, new Prisma.Decimal(0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const lines = [
    {
      mappingKey: "SALES_RETURNS",
      debit: netReturn,
      credit: 0,
      description: `Sales return for distributor-refunded RMA #${returnRecord.id.slice(-6)}`,
      accountingPartyId: distributorParty.id,
    },
    {
      mappingKey: "OUTPUT_VAT_PAYABLE",
      debit: vat,
      credit: 0,
      description: `Output VAT reversal for distributor-refunded RMA #${returnRecord.id.slice(-6)}`,
    },
    {
      mappingKey: "DISTRIBUTOR_PAYABLE",
      debit: 0,
      credit: totalRefund,
      description: `Customer refund reimbursement payable to ${distributor.name}`,
      accountingPartyId: distributorParty.id,
    },
  ];
  if (restockedInventoryCost.greaterThan(0)) {
    lines.push(
      {
        mappingKey: "INVENTORY",
        debit: restockedInventoryCost,
        credit: 0,
        description: `Returned inventory received by distributor for RMA #${returnRecord.id.slice(-6)}`,
      },
      {
        mappingKey: "COGS",
        debit: 0,
        credit: restockedInventoryCost,
        description: `Reverse COGS for returned inventory in RMA #${returnRecord.id.slice(-6)}`,
      },
    );
  }
  if (damagedInventoryCost.greaterThan(0)) {
    lines.push(
      {
        accountCode: "5500",
        debit: damagedInventoryCost,
        credit: 0,
        description: `Write off damaged returned inventory for RMA #${returnRecord.id.slice(-6)}`,
      },
      {
        mappingKey: "COGS",
        debit: 0,
        credit: damagedInventoryCost,
        description: `Relieve sold COGS for damaged RMA #${returnRecord.id.slice(-6)}`,
      },
    );
  }

  const transactionDate = returnRecord.completedAt || returnRecord.inspectedAt || new Date();
  return postJournalEntry({
    transactionDate: new Date(transactionDate),
    sourceType: "DISTRIBUTOR_CUSTOMER_REFUND",
    sourceId: returnRecord.id,
    idempotencyKey: `DISTRIBUTOR_CUSTOMER_REFUND:${returnRecord.id}`,
    referenceNumber: `RMA-${returnRecord.id.slice(-6)}`,
    description: `Verified customer refund paid by distributor for RMA #${returnRecord.id.slice(-6)}`,
    lines,
    client,
    afterPost: (tx) => createAccountingDocument({
      documentType: "BILL",
      documentNumber: `DREF-${returnRecord.id}`,
      partyId: distributorParty.id,
      side: "PAYABLE",
      sourceType: "DISTRIBUTOR_CUSTOMER_REFUND",
      sourceId: returnRecord.id,
      amount: totalRefund,
      issueDate: transactionDate,
      idempotencyKey: `DISTRIBUTOR_CUSTOMER_REFUND:${returnRecord.id}`,
      notes: `Admin-verified customer refund paid by distributor for RMA ${returnRecord.id}.`,
    }, { client: tx }),
  });
};

export const postOrderExchangeAccounting = async ({ exchangeRequest, client = prisma } = {}) => {
  if (!exchangeRequest?.id || !exchangeRequest.orderId) {
    throw new Error("Order exchange accounting requires a persisted exchange request.");
  }
  const order = await client.order.findUnique({
    where: { id: exchangeRequest.orderId },
    select: { id: true, userId: true, date: true },
  });
  if (!order) throw new Error("The original order for this exchange could not be found.");

  const returnedItems = parseItemsForAccounting(exchangeRequest.items);
  const replacementItems = parseItemsForAccounting(exchangeRequest.replacementItems);
  if (!returnedItems.length || !replacementItems.length) {
    throw new Error("Exchange accounting requires returned and replacement item snapshots.");
  }
  const totalOf = (items) => items.reduce(
    (total, item) => total.plus(new Prisma.Decimal(String(item.unitPrice ?? 0)).mul(Number(item.quantity || 0))),
    new Prisma.Decimal(0),
  ).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const originalGross = totalOf(returnedItems);
  const replacementGross = totalOf(replacementItems);
  const recordedOriginal = new Prisma.Decimal(String(exchangeRequest.originalTotalValue || 0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const recordedReplacement = new Prisma.Decimal(String(exchangeRequest.replacementTotalValue || 0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (
    (!recordedOriginal.isZero() && !recordedOriginal.equals(originalGross)) ||
    (!recordedReplacement.isZero() && !recordedReplacement.equals(replacementGross))
  ) {
    throw new Error("Exchange value snapshots do not match the recorded item prices.");
  }

  const transactionDate = new Date();
  const originalDate = new Date(Number(order.date));
  if (Number.isNaN(originalDate.getTime())) throw new Error("The original order date is invalid for VAT reversal.");
  const [originalVatRate, replacementVatRate] = await Promise.all([
    resolveVatRatePercent(originalDate, { client }),
    resolveVatRatePercent(transactionDate, { client }),
  ]);
  const vatForGross = (gross, rate) => {
    const net = gross.div(new Prisma.Decimal(1).plus(rate.div(100)))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return { net, vat: gross.minus(net) };
  };
  const originalAmounts = vatForGross(originalGross, originalVatRate);
  const replacementAmounts = vatForGross(replacementGross, replacementVatRate);
  const revenueChange = replacementAmounts.net.minus(originalAmounts.net)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const vatChange = replacementAmounts.vat.minus(originalAmounts.vat)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const grossChange = replacementGross.minus(originalGross)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const lines = [];
  const exchangeItemKey = (item) => JSON.stringify([
    String(item.productId || ""),
    String(item.size || "Standard").trim().replace(/\s+/g, " ").toLowerCase(),
    String(item.color || "Standard").trim().replace(/\s+/g, " ").toLowerCase(),
  ]);
  const addSignedLine = (mappingKey, amount, description, productId = null, customerId = null, customerName = "") => {
    const value = new Prisma.Decimal(String(amount)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (value.isZero()) return;
    lines.push({
      mappingKey,
      debit: value.isNegative() ? value.abs() : new Prisma.Decimal(0),
      credit: value.isPositive() ? value : new Prisma.Decimal(0),
      description,
      productId,
      customerId,
      customerName,
    });
  };
  const customer = await client.user.findUnique({
    where: { id: order.userId },
    select: { name: true },
  });
  const customerName = customer?.name || "Customer";
  if (revenueChange.isPositive()) {
    lines.push({
      mappingKey: "PRODUCT_SALES_REVENUE",
      debit: 0,
      credit: revenueChange,
      description: `Exchange product revenue increase for Order #${order.id.slice(-6)}`,
      customerId: order.userId,
      customerName,
    });
  } else if (revenueChange.isNegative()) {
    lines.push({
      mappingKey: "SALES_RETURNS",
      debit: revenueChange.abs(),
      credit: 0,
      description: `Exchange price reduction for Order #${order.id.slice(-6)}`,
      customerId: order.userId,
      customerName,
    });
  }
  addSignedLine(
    "OUTPUT_VAT_PAYABLE",
    vatChange,
    `Exchange VAT change for Order #${order.id.slice(-6)}`,
    null,
    order.userId,
    customerName,
  );

  let distributorParty = null;
  const isDistributorRoute = exchangeRequest.deliveryRoute === "DISTRIBUTOR";
  const settlementDistributorId = isDistributorRoute
    ? exchangeRequest.distributorId
    : exchangeRequest.settlementDistributorId;
  if (grossChange.isPositive() || grossChange.isNegative()) {
    if (!settlementDistributorId) {
      throw new Error("A distributor must be assigned to settle an exchange price difference.");
    }
    const distributor = await client.distributor.findUnique({
      where: { id: settlementDistributorId },
      select: { id: true, name: true },
    });
    if (!distributor) throw new Error("The distributor for this exchange accounting entry could not be found.");
    distributorParty = await ensureAccountingParty({
      partyType: "DISTRIBUTOR",
      sourceEntityId: distributor.id,
      displayName: distributor.name || `Distributor (${distributor.id.slice(-6)})`,
    }, { client });
  }

  if (grossChange.isPositive() && distributorParty) {
    lines.push({
      mappingKey: "DISTRIBUTOR_COD_RECEIVABLE",
      debit: grossChange,
      credit: 0,
      description: `Distributor-collected exchange upgrade amount for Order #${order.id.slice(-6)}`,
      accountingPartyId: distributorParty?.id || null,
      customerId: order.userId,
      customerName,
    });
  } else if (grossChange.isPositive()) {
    lines.push({
      mappingKey: "NCM_COD_RECEIVABLE",
      debit: grossChange,
      credit: 0,
      description: `Exchange price upgrade COD receivable for Order #${order.id.slice(-6)}`,
      customerId: order.userId,
      customerName,
    });
  } else if (grossChange.isNegative() && distributorParty) {
    lines.push({
      mappingKey: "DISTRIBUTOR_PAYABLE",
      debit: 0,
      credit: grossChange.abs(),
      description: `Distributor-funded exchange downgrade refund for ${customerName}`,
      accountingPartyId: distributorParty.id,
      customerId: order.userId,
      customerName,
    });
  } else if (grossChange.isNegative()) {
    lines.push({
      accountCode: "2110",
      debit: 0,
      credit: grossChange.abs(),
      description: `Customer exchange downgrade refund payable for ${customerName}`,
      customerId: order.userId,
      customerName,
    });
  }

  const events = await client.orderExchangeEvent.findMany({
    where: {
      exchangeRequestId: exchangeRequest.id,
      eventType: "DISTRIBUTOR_RETURN_INSPECTED",
    },
    select: { metadata: true },
    orderBy: { occurredAt: "desc" },
  });
  const inspectedItems = events.flatMap((event) =>
    Array.isArray(event.metadata?.inspectedItems) ? event.metadata.inspectedItems : []
  );
  const inspectionByKey = new Map(inspectedItems.map((item) => [
    exchangeItemKey(item),
    String(item.condition || "").toUpperCase(),
  ]));
  const inspectionResult = String(exchangeRequest.inspectionResult || "").toUpperCase();
  const fallbackCondition = inspectionResult === "RESTOCKABLE"
    ? "GOOD"
    : inspectionResult;
  let hasScrap = false;
  for (const item of returnedItems) {
    const condition = inspectionByKey.get(exchangeItemKey(item))
      || fallbackCondition;
    if (!["GOOD", "RESTOCKABLE", "DAMAGED"].includes(condition)) continue;
    const unitCost = item.unitCostPrice;
    if (unitCost === null || unitCost === undefined || !new Prisma.Decimal(String(unitCost)).isFinite()) {
      throw new Error(`The original cost snapshot is missing for returned product ${item.name || item.productId}.`);
    }
    const cost = new Prisma.Decimal(String(unitCost))
      .mul(Number(item.quantity || 0))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (cost.isNegative()) throw new Error("Exchange item cost snapshots cannot be negative.");
    if (condition === "DAMAGED") {
      hasScrap = hasScrap || cost.greaterThan(0);
      lines.push(
        {
          accountCode: "5500",
          debit: cost,
          credit: 0,
          description: `Damaged exchange return scrap loss for ${item.name || item.productId}`,
          productId: item.productId,
        },
        {
          mappingKey: "COGS",
          debit: 0,
          credit: cost,
          description: `Relieve sold COGS for damaged exchange return ${item.name || item.productId}`,
          productId: item.productId,
        },
      );
    } else {
      lines.push(
        {
          mappingKey: "INVENTORY",
          debit: cost,
          credit: 0,
          description: `Restock exchange return ${item.name || item.productId}`,
          productId: item.productId,
        },
        {
          mappingKey: "COGS",
          debit: 0,
          credit: cost,
          description: `Reverse COGS for exchange return ${item.name || item.productId}`,
          productId: item.productId,
        },
      );
    }
  }
  for (const item of replacementItems) {
    const unitCost = item.unitCostPrice;
    if (unitCost === null || unitCost === undefined || !new Prisma.Decimal(String(unitCost)).isFinite()) {
      throw new Error(`The replacement catalog cost snapshot is missing for ${item.name || item.productId}.`);
    }
    const cost = new Prisma.Decimal(String(unitCost))
      .mul(Number(item.quantity || 0))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (cost.isNegative()) throw new Error("Exchange item cost snapshots cannot be negative.");
    lines.push(
      {
        mappingKey: "COGS",
        debit: cost,
        credit: 0,
        description: `Recognize replacement COGS for ${item.name || item.productId}`,
        productId: item.productId,
      },
      {
        mappingKey: "INVENTORY",
        debit: 0,
        credit: cost,
        description: `Relieve replacement inventory for ${item.name || item.productId}`,
        productId: item.productId,
      },
    );
  }

  const totalDebits = lines.reduce((total, line) => total.plus(line.debit || 0), new Prisma.Decimal(0));
  const totalCredits = lines.reduce((total, line) => total.plus(line.credit || 0), new Prisma.Decimal(0));
  if (totalDebits.isZero() && totalCredits.isZero()) return null;

  const sourceId = `EXCHANGE-${exchangeRequest.id}`;
  const refundAmount = grossChange.isNegative() ? grossChange.abs() : new Prisma.Decimal(0);
  const entry = await postJournalEntry({
    transactionDate,
    sourceType: "ORDER_EXCHANGE",
    sourceId,
    idempotencyKey: `ORDER_EXCHANGE:${exchangeRequest.id}`,
    referenceNumber: `ORD-${order.id.slice(-6)}`,
    description: `Return and exchange accounting for Order #${order.id.slice(-6)}`,
    createdBy: "SYSTEM",
    lines,
    client,
    afterPost: async (tx, postedEntry) => {
      if (grossChange.isPositive() && distributorParty) {
        const document = await createAccountingDocument({
          documentType: "INVOICE",
          documentNumber: `DEX-${crypto.createHash("sha256").update(exchangeRequest.id).digest("hex").slice(0, 24).toUpperCase()}`,
          partyId: distributorParty.id,
          side: "RECEIVABLE",
          sourceType: "DISTRIBUTOR_COD_SALE",
          sourceId,
          amount: grossChange,
          issueDate: transactionDate,
          idempotencyKey: `DISTRIBUTOR_COD_SALE:${sourceId}`,
          notes: `Distributor-collected exchange upgrade amount for Order ${order.id}.`,
        }, { client: tx });
        await tx.distributorCashEvent.updateMany({
          where: {
            orderExchangeRequestId: exchangeRequest.id,
            eventType: "EXCHANGE_UPGRADE_COLLECTION",
            status: { in: ["PENDING_VERIFICATION", "VERIFIED"] },
          },
          data: { accountingDocumentId: document.id, journalEntryId: postedEntry.id },
        });
      }
      if (grossChange.isNegative() && distributorParty) {
        const document = await createAccountingDocument({
          documentType: "BILL",
          documentNumber: `DEXR-${crypto.createHash("sha256").update(exchangeRequest.id).digest("hex").slice(0, 23).toUpperCase()}`,
          partyId: distributorParty.id,
          side: "PAYABLE",
          sourceType: "DISTRIBUTOR_CUSTOMER_REFUND",
          sourceId,
          amount: refundAmount,
          issueDate: transactionDate,
          idempotencyKey: `DISTRIBUTOR_CUSTOMER_REFUND:${sourceId}`,
          notes: `Distributor-paid customer exchange downgrade refund for Order ${order.id}.`,
        }, { client: tx });
        await tx.distributorCashEvent.updateMany({
          where: {
            orderExchangeRequestId: exchangeRequest.id,
            eventType: "EXCHANGE_DOWNGRADE_REFUND",
            status: { in: ["PENDING_VERIFICATION", "VERIFIED"] },
          },
          data: { accountingDocumentId: document.id, journalEntryId: postedEntry.id },
        });
      }
      if (grossChange.isNegative() && !distributorParty) {
        const existingPayable = await tx.accountPayable.findFirst({
          where: { referenceType: "CUSTOMER_EXCHANGE_REFUND", referenceId: exchangeRequest.id },
          select: { id: true },
        });
        if (!existingPayable) {
          await tx.accountPayable.create({
            data: {
              title: `Customer exchange refund #${exchangeRequest.id.slice(0, 8)}`,
              payeeName: customerName,
              category: "OPERATING_EXPENSE",
              referenceType: "CUSTOMER_EXCHANGE_REFUND",
              referenceId: exchangeRequest.id,
              totalAmount: refundAmount,
              paidAmount: 0,
              remainingBalance: refundAmount,
              status: "UNPAID",
              priority: "HIGH",
              notes: `NCM-route exchange downgrade refund for Order ${order.id}.`,
            },
          });
        }
      }
      return postedEntry;
    },
  });

  await client.orderExchangeRequest.update({
    where: { id: exchangeRequest.id },
    data: {
      exchangeJournalEntryId: entry.id,
      ...(hasScrap ? { scrapJournalEntryId: entry.id } : {}),
      ...(grossChange.isNegative() ? { taxCreditNoteNumber: `CN-${entry.journalNumber}` } : {}),
    },
  });
  return entry;
};

const parseItemsForAccounting = (items) => {
  if (Array.isArray(items)) return items;
  if (typeof items !== "string") return [];
  try {
    const parsed = JSON.parse(items);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Direct expense posting (flexible signature accepting entity object or named params)
 * DR Relevant Operating Expense (6100-6700)
 * CR Bank/Cash (1120/1110) or Accounts Payable (2110)
 */
export const postDirectExpenseAccounting = async (params) => {
  return postExpenseAccounting({
    expenseId: params.expenseId || `EXP-${Date.now()}`,
    category: params.category || "EXPENSE",
    title: params.description || params.title || "Operating Expense",
    amount: params.amount,
    paidFromAccountType: params.fromAccountId ? "BANK" : "BANK",
    isPayable: false,
    payeeName: params.payeeName || "Vendor",
  });
};

/**
 * 6. Operating / Monthly Expenses
 * DR Relevant Operating Expense (6100 - 6700)
 * CR Bank/Cash (1120/1110) or Accounts Payable (2110)
 */
export const postExpenseAccounting = async ({
  expenseId,
  category,
  title,
  amount,
  paidFromAccountType = "BANK",
  isPayable = false,
  payeeName,
}) => {
  try {
    const amt = Number(amount || 0);
    if (amt <= 0) return;

    let expenseCode = "6700"; // Miscellaneous
    const cat = (category || "").toUpperCase();
    if (cat.includes("SALAR")) expenseCode = "6100";
    else if (cat.includes("RENT")) expenseCode = "6200";
    else if (cat.includes("UTILIT")) expenseCode = "6300";
    else if (cat.includes("MARKET") || cat.includes("ADS")) expenseCode = "6400";
    else if (cat.includes("SOFTWARE") || cat.includes("TOOL")) expenseCode = "6500";
    else if (cat.includes("DELIVERY") || cat.includes("COURIER")) expenseCode = "6430";

    const creditCode = isPayable ? "2110" : paidFromAccountType === "CASH" ? "1110" : "1120";

    await postJournalEntry({
      transactionDate: new Date(),
      sourceType: "EXPENSE_PAYMENT",
      sourceId: expenseId,
      idempotencyKey: `EXPENSE:${expenseId}:${amt}`,
      referenceNumber: `EXP-${expenseId ? expenseId.slice(-6) : Date.now()}`,
      description: title || `Operating expense: ${category}`,
      lines: [
        {
          accountCode: expenseCode,
          debit: amt,
          credit: 0,
          description: title || `Expense: ${category}`,
        },
        {
          accountCode: creditCode,
          debit: 0,
          credit: amt,
          description: isPayable ? `Recorded as liability to ${payeeName || "Vendor"}` : `Paid from liquid treasury`,
          supplierName: payeeName,
        },
      ],
    });
  } catch (error) {
    console.error("Error in postExpenseAccounting:", error);
  }
};

/**
 * 7. Fixed Asset Purchase - flexible for direct entity arg or named params with partial payment split
 */
export const postFixedAssetPurchaseAccounting = async (assetOrParams, opts = {}) => {
  const asset = assetOrParams;
  const vendorName = asset.vendorName || opts.vendorName || "Asset Vendor";
  try {
    const cost = Number(asset.purchaseCost || asset.cost || 0);
    if (cost <= 0) return null;

    let assetCode = "1510";
    if (asset.category === "FURNITURE_FIXTURES") assetCode = "1520";
    else if (asset.category === "VEHICLES") assetCode = "1530";

    let paidAmount = Number(asset.paidAmount || opts.paidAmount || 0);
    let payableAmount = Number(asset.payableAmount || opts.payableAmount || 0);

    if (paidAmount === 0 && payableAmount === 0) {
      if (asset.paidFromAccountId && !opts.recordAsPayable && !asset.isPayable) {
        paidAmount = cost;
      } else {
        payableAmount = cost;
      }
    }

    const lines = [
      {
        accountCode: assetCode,
        debit: cost,
        credit: 0,
        description: `Capitalized Asset: ${asset.assetName} (${vendorName})`,
        assetId: asset.id,
        supplierName: vendorName,
      },
    ];

    if (paidAmount > 0) {
      lines.push({
        accountCode: "1120",
        debit: 0,
        credit: paidAmount,
        description: `Paid from liquid bank account for ${asset.assetName}`,
        supplierName: vendorName,
      });
    }

    if (payableAmount > 0) {
      lines.push({
        accountCode: "2110",
        debit: 0,
        credit: payableAmount,
        description: `Asset liability payable to ${vendorName}`,
        supplierName: vendorName,
      });
    }

    const result = await postJournalEntry({
      transactionDate: asset.purchaseDate ? new Date(asset.purchaseDate) : new Date(),
      sourceType: "ASSET_PURCHASE",
      sourceId: asset.id,
      idempotencyKey: `ASSET_PURCHASE:${asset.id}`,
      referenceNumber: asset.assetTag || asset.id,
      description: `Fixed Asset Acquisition: ${asset.assetName} (${asset.assetTag || asset.id}) from ${vendorName}`,
      lines,
    });
    return result;
  } catch (error) {
    console.error("Error in postFixedAssetPurchaseAccounting:", error);
    throw error;
  }
};

/**
 * 8. Fixed Asset Depreciation Run - accepts { totalDepreciation, count, date } or { periodName, totalDepreciation }
 * DR Depreciation Expense (6600)
 * CR Accumulated Depreciation (1590)
 */
export const postDepreciationAccounting = async (params) => {
  try {
    const depAmt = Number(params.totalDepreciation || 0);
    if (depAmt <= 0) return;

    const periodName = params.periodName ||
      (params.date ? `${new Date(params.date).getFullYear()}-${String(new Date(params.date).getMonth() + 1).padStart(2, '0')}` : `BATCH-${Date.now()}`);

    const result = await postJournalEntry({
      transactionDate: params.date ? new Date(params.date) : new Date(),
      sourceType: "ASSET_DEPRECIATION",
      sourceId: `DEP-${periodName}`,
      idempotencyKey: `ASSET_DEPRECIATION:${periodName}:${depAmt}`,
      referenceNumber: `DEP-${periodName}`,
      description: `Fixed Asset Depreciation batch for period ${periodName} (${params.count || 1} assets)`,
      lines: [
        {
          accountCode: "6600",
          debit: depAmt,
          credit: 0,
          description: `Depreciation expense for ${periodName}`,
        },
        {
          accountCode: "1590",
          debit: 0,
          credit: depAmt,
          description: `Accumulated depreciation for ${periodName}`,
        },
      ],
    });
    return result;
  } catch (error) {
    console.error("Error in postDepreciationAccounting:", error);
  }
};

/**
 * 9. Loan Disbursement - flexible: accepts full entity or named params
 * DR Bank Accounts (1120)
 * CR Bank Term Loans & Borrowings (2510)
 */
export const postLoanDisbursementAccounting = async (loanOrParams) => {
  try {
    const principal = Number(loanOrParams.principalAmount || loanOrParams.principal || 0);
    const lenderName = loanOrParams.investorName || loanOrParams.lenderName || "Lender";
    const loanId = loanOrParams.id || loanOrParams.loanId || `LOAN-${Date.now()}`;
    if (principal <= 0) return;

    const result = await postJournalEntry({
      transactionDate: loanOrParams.startDate ? new Date(loanOrParams.startDate) : new Date(),
      sourceType: "LOAN_DISBURSEMENT",
      sourceId: loanId,
      idempotencyKey: `LOAN_DISBURSEMENT:${loanId}`,
      referenceNumber: `LOAN-${loanId.slice(-6)}`,
      description: `Loan facility disbursement from ${lenderName} (Rs ${principal.toLocaleString()} at ${loanOrParams.interestRate || 0}% APR)`,
      lines: [
        {
          accountCode: "1120",
          debit: principal,
          credit: 0,
          description: `Loan funds received into bank from ${lenderName}`,
        },
        {
          accountCode: "2510",
          debit: 0,
          credit: principal,
          description: `Borrowing liability created to ${lenderName}`,
        },
      ],
    });
    return result;
  } catch (error) {
    console.error("Error in postLoanDisbursementAccounting:", error);
  }
};

/**
 * 10. Loan Repayment (Principal + Interest Split) - flexible signature
 * DR Bank Term Loans (2510): Principal Portion
 * DR Loan Interest Expense (7100): Interest Expense Portion  
 * CR Bank Accounts (1120): Total Repayment
 */
export const postLoanRepaymentAccounting = async (params) => {
  try {
    // Support both: ({ liability, amount, principalPortion, interestPortion }) and ({ liabilityId, lenderName, totalAmount, principalPortion, interestPortion })
    const liability = params.liability || {};
    const total = Number(params.amount || params.totalAmount || 0);
    const p = Number(params.principalPortion || total);
    const i = Number(params.interestPortion || 0);
    const lenderName = liability.investorName || params.lenderName || "Lender";
    const liabilityId = liability.id || params.liabilityId || `REPAY-${Date.now()}`;

    if (total <= 0) return;

    const lines = [
      {
        accountCode: "2510",
        debit: p,
        credit: 0,
        description: `Principal reduction on loan to ${lenderName}`,
      },
    ];

    if (i > 0) {
      lines.push({
        accountCode: "7100",
        debit: i,
        credit: 0,
        description: `Finance interest expense on loan to ${lenderName}`,
      });
    }

    lines.push({
      accountCode: "1120",
      debit: 0,
      credit: total,
      description: `EMI payment disbursed from bank to ${lenderName}`,
    });

    const result = await postJournalEntry({
      transactionDate: new Date(),
      sourceType: "LOAN_REPAYMENT",
      sourceId: liabilityId,
      idempotencyKey: `LOAN_REPAYMENT:${liabilityId}:${total}:${Date.now()}`,
      referenceNumber: `EMI-${liabilityId.slice(-6)}`,
      description: `Loan EMI repayment to ${lenderName} (Principal: Rs ${p}, Interest: Rs ${i})`,
      lines,
    });
    return result;
  } catch (error) {
    console.error("Error in postLoanRepaymentAccounting:", error);
  }
};

/**
 * 11. Primary Share Issuance (Equity Capital Injection) - flexible signature
 * DR Bank Accounts (1120): Investment Inflow
 * CR Share Capital (3100): Share Capital Issued
 */
export const postShareIssuanceAccounting = async (params) => {
  try {
    // Support: ({ investorPartner, valuationRecord, invAmt, depositAccountId }) and ({ investorName, investmentAmount, roundName })
    const investorName = params.investorName ||
      (params.investorPartner ? params.investorPartner.partnerName : "Investor");
    const amount = Number(params.invAmt || params.investmentAmount || 0);
    const roundName = params.roundName ||
      (params.valuationRecord ? params.valuationRecord.id : "EQUITY-ROUND");
    const sourceId = (params.valuationRecord ? params.valuationRecord.id : null) ||
      params.sourceId || `EQ-${Date.now()}`;
    if (amount <= 0) return;

    const result = await postJournalEntry({
      transactionDate: new Date(),
      sourceType: "CAPITAL_INJECTION",
      sourceId,
      idempotencyKey: `CAPITAL_INJECTION:${sourceId}`,
      referenceNumber: roundName || "EQUITY-ROUND",
      description: `Primary Share Issuance: ${investorName} invested Rs ${amount.toLocaleString()}`,
      lines: [
        {
          accountCode: "1120",
          debit: amount,
          credit: 0,
          description: `Capital inflow from ${investorName}`,
        },
        {
          accountCode: "3100",
          debit: 0,
          credit: amount,
          description: `Share Capital equity issued in ${roundName}`,
        },
      ],
    });
    return result;
  } catch (error) {
    console.error("Error in postShareIssuanceAccounting:", error);
  }
};

/**
 * 11b. Share Buyback (Company Repurchases Shares)
 * DR Share Capital (3100): Face Value Retired
 * CR Bank Accounts (1120): Buyback Payout
 */
export const postShareBuybackAccounting = async (params) => {
  try {
    const total = Number(params.totalTransactionValue || params.totalAmount || 0);
    if (total <= 0) return;
    const sellerName = params.seller ? params.seller.partnerName : (params.sellerName || "Shareholder");
    const sourceId = `BUYBACK-${params.seller ? params.seller.id : Date.now()}`;

    const result = await postJournalEntry({
      transactionDate: new Date(),
      sourceType: "SHARE_BUYBACK",
      sourceId,
      idempotencyKey: `SHARE_BUYBACK:${sourceId}`,
      referenceNumber: sourceId,
      description: `Company Share Buyback: Repurchased from ${sellerName}`,
      lines: [
        {
          accountCode: "3100",
          debit: total,
          credit: 0,
          description: `Share capital retired - bought back from ${sellerName}`,
        },
        {
          accountCode: "1120",
          debit: 0,
          credit: total,
          description: `Buyback payout to ${sellerName}`,
        },
      ],
    });
    return result;
  } catch (error) {
    console.error("Error in postShareBuybackAccounting:", error);
  }
};

/**
 * 11c. Partner Profit Distribution Accounting
 * DR Partner Drawings (3500)
 * CR Bank Accounts (1120) or Partner Profit Distributions Payable (2150)
 */
export const postProfitDistributionAccounting = async ({
  distributionId,
  partnerId,
  partnerName,
  amount,
  fiscalYear = "FY",
  isImmediatePayout = false,
  cashAccountCode = "1120",
  createdBy = "system",
  client = prisma,
}) => {
  try {
    const distAmount = Number(amount || 0);
    if (distAmount <= 0) return null;

    const lines = [
      {
        accountCode: "3500",
        debit: distAmount,
        credit: 0,
        description: `Profit distribution dividend declared for ${partnerName} (${fiscalYear})`,
      },
      {
        accountCode: isImmediatePayout ? cashAccountCode : "2150",
        debit: 0,
        credit: distAmount,
        description: isImmediatePayout
          ? `Dividend paid out to ${partnerName}`
          : `Dividend payable accrued for ${partnerName}`,
      },
    ];

    return await postJournalEntry({
      transactionDate: new Date(),
      sourceType: "PROFIT_DISTRIBUTION",
      sourceId: `${distributionId}-${partnerId}`,
      idempotencyKey: `PROFIT_DISTRIBUTION:${distributionId}:${partnerId}`,
      referenceNumber: `DIST-${String(distributionId).slice(-6)}`,
      description: `Profit Distribution to ${partnerName} - Rs ${distAmount.toFixed(2)} (${fiscalYear})`,
      lines,
      createdBy,
      client,
    });
  } catch (error) {
    console.error("Error in postProfitDistributionAccounting:", error);
    throw error;
  }
};

/**
 * 12. Reversal Engine
 * Reverses a posted journal entry atomically with reciprocal DR/CR.
 */
export const reverseJournalEntryById = async ({ journalEntryId, reversalReason, reversedBy = "admin" }) => {
  const original = await prisma.journalEntry.findUnique({
    where: { id: journalEntryId },
    include: { lines: true },
  });

  if (!original) {
    throw new Error("Journal entry not found.");
  }
  if (original.status === "REVERSED") {
    throw new Error("Journal entry is already reversed.");
  }

  // Create reciprocal reversed lines (DR becomes CR, CR becomes DR)
  const reversedLines = original.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.credit,
    credit: l.debit,
    description: `Reversal of ${original.journalNumber}: ${l.description || ""}`,
    customerId: l.customerId,
    customerName: l.customerName,
    supplierId: l.supplierId,
    supplierName: l.supplierName,
    productId: l.productId,
    assetId: l.assetId,
  }));

  const reversalResult = await postJournalEntry({
    transactionDate: new Date(),
    sourceType: "REVERSAL",
    sourceId: `REV-${original.id}`,
    idempotencyKey: `REVERSAL:${original.id}`,
    referenceNumber: `REV-${original.journalNumber}`,
    description: `Reversal of ${original.journalNumber}. Reason: ${reversalReason || "User Requested Reversal"}`,
    lines: reversedLines,
    createdBy: reversedBy,
    allowClosedPeriod: true,
  });

  // Mark original as REVERSED
  await prisma.journalEntry.update({
    where: { id: original.id },
    data: {
      status: "REVERSED",
      reversedEntryId: reversalResult.id,
      reversalReason: reversalReason || "Reversed by user",
    },
  });

  return reversalResult;
};

/**
 * reverseJournalEntry - convenience alias accepting (journalEntryId, reason) args
 */
export const reverseJournalEntry = async (journalEntryId, reversalReason = "Reversal") => {
  return reverseJournalEntryById({ journalEntryId, reversalReason });
};

/**
 * postSupplierPaymentAccounting - flexible signature
 * Accepts (payable, { amount, fromAccountId }) from financialController
 */
export const postSupplierPaymentAccountingFromPayable = async (payable, opts = {}) => {
  return postSupplierPaymentAccounting({
    payableId: payable.id,
    payeeName: payable.payeeName,
    amount: opts.amount,
  });
};

/**
 * postNcmRemittanceAccounting - double-entry posting when NCM delivers COD funds to Bank/Cash
 * DR 1120 Bank (or 1110 Cash) for Net Liquid Received
 * DR 6430 Delivery & Courier Charges Expense for NCM Carrier Service Fee
 * CR 1170 NCM COD Receivable for Total COD Collected
 */
export const postNcmRemittanceAccounting = async ({
  settlementId,
  codCollected,
  deliveryFeeActual = 0,
  isCash = false,
  cashAccountCode,
  destinationAccountName = "Bank Account",
  createdBy = "admin",
  ncmPartyId = null,
}, { client = prisma } = {}) => {
  const codDecimal = new Prisma.Decimal(codCollected || 0);
  const feeDecimal = new Prisma.Decimal(deliveryFeeActual || 0);
  const netDecimal = codDecimal.minus(feeDecimal);

  if (!codDecimal.isFinite() || !feeDecimal.isFinite() || codDecimal.lte(0) || feeDecimal.isNegative()) {
    throw new Error("COD collected amount must be greater than zero for remittance posting.");
  }
  if (netDecimal.isNegative()) {
    throw new Error("Carrier fee cannot exceed NCM COD collected in a remittance posting.");
  }

  const lines = [];
  if (netDecimal.greaterThan(0)) {
    lines.push({
      accountCode: cashAccountCode || (isCash ? "1110" : "1120"),
      debit: netDecimal,
      credit: 0,
      description: `Net COD remittance received into ${destinationAccountName}`,
    });
  }

  if (feeDecimal.greaterThan(0)) {
    lines.push({
      mappingKey: "NCM_CARRIER_PAYABLE",
      debit: feeDecimal,
      credit: 0,
      description: `Clear NCM carrier fee payable from COD remittance`,
      ...(ncmPartyId ? { accountingPartyId: ncmPartyId } : {}),
    });
  }

  lines.push({
    mappingKey: "NCM_COD_RECEIVABLE",
    debit: 0,
    credit: codDecimal,
    description: `NCM COD collection settled`,
    ...(ncmPartyId ? { accountingPartyId: ncmPartyId } : {}),
  });

  return await postJournalEntry({
    transactionDate: new Date(),
    sourceType: "PAYMENT",
    sourceId: `NCM-REMIT-${settlementId}`,
    idempotencyKey: `NCM_REMITTANCE:${settlementId}`,
    referenceNumber: `NCM-REMIT-${String(settlementId).slice(-6)}`,
    description: `NCM COD Remittance settlement of Rs ${codDecimal.toString()}`,
    lines,
    createdBy,
    client,
  });
};
