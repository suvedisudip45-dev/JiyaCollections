import { Prisma } from "@prisma/client";
import { recordSystemAudit } from "./auditService.js";
import { postMarketingCpaPayablePaymentAccounting } from "./accountingPostingEngine.js";
import { validateTreasuryPayoutAccount } from "./treasuryAccountingService.js";

const fail = (message, statusCode = 409, code = "MARKETING_CPA_SETTLEMENT_INVALID") =>
  Object.assign(new Error(message), { statusCode, code });

export const finalizeMarketingCpaPayablePayout = async ({
  client,
  payout,
  actorId = null,
  validateTreasury = validateTreasuryPayoutAccount,
  postAccounting = postMarketingCpaPayablePaymentAccounting,
  writeAudit = recordSystemAudit,
} = {}) => {
  if (!client || !payout || payout.targetType !== "MARKETING_CPA_PAYABLE") {
    throw fail("A Marketing CPA payable payout and transaction client are required.", 400);
  }
  if (!String(payout.externalPaymentReference || "").trim() || !String(payout.bankEvidenceReference || "").trim()) {
    throw fail("Payment instruction and settlement evidence references are required.", 400, "PAYOUT_EVIDENCE_REQUIRED");
  }
  const paymentAmount = new Prisma.Decimal(String(payout.amount ?? 0));
  const settlementAmount = new Prisma.Decimal(String(payout.settlementAmount ?? 0));
  const adjustmentAmount = new Prisma.Decimal(String(payout.adjustmentAmount ?? 0));
  if (
    !paymentAmount.isFinite() ||
    paymentAmount.lessThanOrEqualTo(0) ||
    !settlementAmount.equals(paymentAmount) ||
    String(payout.adjustmentType || "NONE").toUpperCase() !== "NONE" ||
    !adjustmentAmount.isZero()
  ) {
    throw fail("Marketing CPA payments must clear only the verified cash amount; adjustments and withholding are not supported.", 400, "CPA_ADJUSTMENT_UNSUPPORTED");
  }

  const document = await client.accountingDocument.findUnique({
    where: { id: payout.targetId },
    include: { party: true },
  });
  if (
    !document ||
    document.documentType !== "BILL" ||
    document.side !== "PAYABLE" ||
    document.sourceType !== "MARKETING_CPA" ||
    document.currency !== "NPR" ||
    !document.party ||
    document.party.partyType !== "MARKETING_PARTNER" ||
    !["OPEN", "PARTIALLY_PAID"].includes(document.status)
  ) {
    throw fail("Marketing CPA bill is missing, unsupported, or no longer open.", 409, "CPA_PAYABLE_NOT_OPEN");
  }

  const remaining = new Prisma.Decimal(String(document.remainingAmount));
  if (!remaining.isFinite() || paymentAmount.greaterThan(remaining)) {
    throw fail("Cash payment exceeds the Marketing CPA bill's remaining balance.", 409, "SETTLEMENT_AMOUNT_EXCEEDS_PAYABLE");
  }
  const nextRemaining = remaining.minus(paymentAmount);
  const nextAllocated = new Prisma.Decimal(String(document.allocatedAmount)).plus(paymentAmount);
  const nextStatus = nextRemaining.isZero() ? "PAID" : "PARTIALLY_PAID";
  const account = await client.financialAccount.findUnique({
    where: { id: payout.financialAccountId },
  });
  if (!account) throw fail("The payout Treasury account was not found.", 409, "INVALID_TREASURY_ACCOUNT");
  const accountingAccount = await validateTreasury(account, client);

  const debit = await client.financialAccount.updateMany({
    where: {
      id: account.id,
      status: "ACTIVE",
      currentBalance: { gte: paymentAmount },
    },
    data: { currentBalance: { decrement: paymentAmount } },
  });
  if (debit.count !== 1) {
    throw fail("Treasury balance is insufficient or changed.", 409, "INSUFFICIENT_FUNDS");
  }

  const claimed = await client.accountingDocument.updateMany({
    where: {
      id: document.id,
      allocatedAmount: document.allocatedAmount,
      remainingAmount: document.remainingAmount,
      status: document.status,
    },
    data: {
      allocatedAmount: nextAllocated,
      remainingAmount: nextRemaining,
      status: nextStatus,
    },
  });
  if (claimed.count !== 1) {
    throw fail("Marketing CPA bill changed during payout confirmation.", 409, "CPA_PAYABLE_CONCURRENCY_CONFLICT");
  }

  const journal = await postAccounting({
    payoutId: payout.id,
    document,
    amount: paymentAmount,
    cashAccountId: accountingAccount.id,
    client,
  });
  if (!journal?.id) throw new Error("Marketing CPA payout journal could not be posted.");

  await client.cashTransaction.create({
    data: {
      idempotencyKey: payout.idempotencyKey,
      amount: paymentAmount,
      type: "OUTFLOW",
      fromAccountId: account.id,
      category: "MARKETING_CPA_PAYOUT",
      partyName: document.party.displayName,
      referenceId: document.id,
      externalPaymentReference: payout.externalPaymentReference,
      description: `Cash payment against Marketing CPA bill ${document.documentNumber}; evidence ${payout.bankEvidenceReference}`,
    },
  });
  await client.accountingAllocation.create({
    data: {
      documentId: document.id,
      journalEntryId: journal.id,
      allocationType: "CASH",
      amount: paymentAmount,
      notes: `Financial payout ${payout.id}; payment evidence ${payout.bankEvidenceReference}`,
      idempotencyKey: `MARKETING_CPA_PAYOUT:${payout.id}`,
    },
  });
  await writeAudit(
    { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
    {
      action: "MARKETING_CPA_PAYABLE_PAYOUT_SETTLED",
      entityType: "AccountingDocument",
      entityId: document.id,
      beforeState: {
        remainingAmount: remaining.toFixed(2),
        status: document.status,
      },
      afterState: {
        remainingAmount: nextRemaining.toFixed(2),
        status: nextStatus,
        payoutId: payout.id,
        journalEntryId: journal.id,
        bankEvidenceReference: payout.bankEvidenceReference,
      },
    },
    { client },
  );

  return {
    documentId: document.id,
    journalEntryId: journal.id,
    remainingAmount: nextRemaining,
    status: nextStatus,
  };
};
