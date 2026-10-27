import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { createAccountingDocument } from "./accountingSubledgerService.js";
import { postJournalEntry } from "./accountingPostingEngine.js";
import { resolveActiveRateCard } from "./distributorRateCardService.js";

const money = (value, label) => {
  const amount = new Prisma.Decimal(String(value ?? 0));
  if (!amount.isFinite() || amount.isNegative()) {
    throw new Error(`${label} must be a non-negative amount.`);
  }
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

const commissionFor = (rate, base) => {
  const commissionRate = money(rate, "Distributor commission rate");
  return commissionRate.greaterThan(0) && commissionRate.lessThanOrEqualTo(100)
    ? base.mul(commissionRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : commissionRate;
};

export const accrueDistributorDeliveryEarning = async ({
  distributorId,
  distributorName,
  assignmentId,
  orderId,
  effectiveAt = new Date(),
  client = prisma,
  rateCardResolver = resolveActiveRateCard,
  journalPoster = postJournalEntry,
} = {}) => {
  if (!distributorId || !distributorName || !assignmentId || !orderId) {
    throw new Error("Distributor, assignment, and order details are required to accrue delivery earnings.");
  }
  if (!client.distributorServiceEarning) {
    throw new Error("Distributor service earning storage is unavailable. Apply the pending Prisma migration first.");
  }

  const idempotencyKey = `DISTRIBUTOR_DELIVERY_EARNING:${assignmentId}`;
  const prior = await client.distributorServiceEarning.findUnique({ where: { idempotencyKey } });
  if (prior) {
    if (prior.distributorId !== distributorId || prior.orderId !== orderId) {
      throw new Error("Delivery earning idempotency key is already associated with a different source.");
    }
    return prior;
  }

  const rateCard = await rateCardResolver({
    distributorId,
    effectiveAt,
    client,
  });
  const deliveryCharge = money(rateCard.deliveryCharge, "Delivery charge");
  const incentiveRate = rateCard.bonusRate ?? rateCard.incentiveRate ?? 0;
  const incentiveAmount = money(incentiveRate, "Delivery incentive");
  const commissionAmount = commissionFor(rateCard.commissionRate ?? 0, deliveryCharge);
  const payableAmount = deliveryCharge.plus(incentiveAmount).minus(commissionAmount)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (payableAmount.isNegative()) {
    throw new Error("Configured distributor commission exceeds delivery compensation.");
  }

  const vatInvoiceVerified = false;
  const vatRate = new Prisma.Decimal(0);
  const vatAmount = new Prisma.Decimal(0);
  const rateSnapshot = {
    rateCardId: rateCard.rateCardId || null,
    isDefaultFallback: Boolean(rateCard.isDefaultFallback),
    deliveryCharge: deliveryCharge.toFixed(2),
    incentiveAmount: incentiveAmount.toFixed(2),
    commissionRate: String(rateCard.commissionRate ?? 0),
    commissionAmount: commissionAmount.toFixed(2),
    otherCharges: "0.00",
    vatRate: vatRate.toFixed(2),
    vatAmount: vatAmount.toFixed(2),
    vatInvoiceVerified,
    taxTreatment: "NO_RECOVERABLE_INPUT_VAT_WITHOUT_VERIFIED_INVOICE",
  };
  const earning = await client.distributorServiceEarning.create({
    data: {
      distributorId,
      assignmentId,
      orderId,
      serviceType: "DELIVERY",
      idempotencyKey,
      rateCardId: rateCard.rateCardId || null,
      effectiveAt,
      deliveryCharge,
      incentiveAmount,
      commissionAmount,
      otherCharges: new Prisma.Decimal(0),
      vatRate,
      vatAmount,
      vatInvoiceVerified,
      payableAmount,
      snapshot: rateSnapshot,
    },
  });

  if (payableAmount.isZero()) return earning;

  const party = await ensureAccountingParty({
    partyType: "DISTRIBUTOR",
    sourceEntityId: distributorId,
    displayName: distributorName,
  }, { client });
  const journal = await journalPoster({
    transactionDate: effectiveAt,
    sourceType: "DISTRIBUTOR_SERVICE_EARNING",
    sourceId: earning.id,
    idempotencyKey,
    referenceNumber: `DIST-EARN-${assignmentId.slice(-8)}`,
    description: `Distributor delivery earning for order ${orderId}`,
    lines: [
      {
        mappingKey: "DELIVERY_EXPENSE",
        debit: payableAmount,
        credit: 0,
        description: `Distributor delivery service expense for order ${orderId}`,
        accountingPartyId: party.id,
      },
      {
        mappingKey: "DISTRIBUTOR_PAYABLE",
        debit: 0,
        credit: payableAmount,
        description: `Distributor service payable for order ${orderId}`,
        accountingPartyId: party.id,
      },
    ],
    client,
  });
  const document = await createAccountingDocument({
    documentType: "BILL",
    documentNumber: `DIST-EARN-${earning.id}`,
    partyId: party.id,
    side: "PAYABLE",
    sourceType: "DISTRIBUTOR_SERVICE_EARNING",
    sourceId: earning.id,
    issueDate: effectiveAt,
    amount: payableAmount,
    idempotencyKey,
    notes: JSON.stringify(rateSnapshot),
  }, { client });

  return client.distributorServiceEarning.update({
    where: { id: earning.id },
    data: {
      accountingDocumentId: document.id,
      journalEntryId: journal.id,
    },
  });
};
