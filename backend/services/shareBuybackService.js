import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { postShareBuybackAccounting } from "./accountingPostingEngine.js";
import { validateTreasuryPayoutAccount } from "./treasuryAccountingService.js";

const conflict = (message, code) => Object.assign(new Error(message), { statusCode: 409, code });
const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });
const decimal = (value) => new Prisma.Decimal(String(value));
const amountNumber = (value) => Number(value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));

export const recordShareBuyback = async ({
  sellerPartnerId,
  sharesToTransfer,
  sharePrice = 100,
  fromTreasuryAccountId,
  notes = "",
  idempotencyKey: rawIdempotencyKey,
}, { client = prisma, postAccounting = postShareBuybackAccounting } = {}) => {
  const key = String(rawIdempotencyKey || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,140}$/.test(key)) {
    throw invalid("A valid Idempotency-Key is required.");
  }
  if (!sellerPartnerId || !fromTreasuryAccountId) {
    throw invalid("Seller and Treasury account are required for a company share buyback.");
  }

  let shares;
  let price;
  try {
    shares = decimal(sharesToTransfer);
    price = decimal(sharePrice);
  } catch {
    throw invalid("Share count and share price must be valid numbers.");
  }
  if (!shares.isFinite() || !price.isFinite() || shares.lte(0) || price.lte(0)) {
    throw invalid("Share count and share price must be positive finite values.");
  }
  if (!shares.eq(shares.toDecimalPlaces(2)) || !price.eq(price.toDecimalPlaces(4))) {
    throw invalid("Share count supports at most two decimals and share price at most four decimals.");
  }
  const total = amountNumber(shares.mul(price));
  if (total <= 0) throw invalid("The buyback amount must be greater than zero.");

  const requestHash = createHash("sha256").update(key).digest("hex");
  const journalIdempotencyKey = `SHARE_BUYBACK:${requestHash}`;
  const payloadHash = createHash("sha256").update(JSON.stringify({
    sellerPartnerId,
    shares: shares.toFixed(2),
    sharePrice: price.toFixed(4),
    amount: total.toFixed(2),
    fromTreasuryAccountId,
    notes: String(notes || ""),
  })).digest("hex");
  const transactionDate = new Date();

  const transact = async (tx) => {
    const existingJournal = await tx.journalEntry.findUnique({
      where: { idempotencyKey: journalIdempotencyKey },
    });
    if (existingJournal) {
      if (existingJournal.status !== "POSTED" || existingJournal.sourceType !== "SHARE_BUYBACK") {
        throw conflict("An incomplete share-buyback posting exists. Finance review is required.", "SHARE_BUYBACK_POSTING_CONFLICT");
      }
      if (existingJournal.referenceNumber !== payloadHash) {
        throw conflict("This Idempotency-Key was already used for a different share buyback.", "IDEMPOTENCY_KEY_REUSED");
      }
      return { alreadyProcessed: true, journal: existingJournal };
    }

    const treasuryAccount = await tx.financialAccount.findUnique({ where: { id: fromTreasuryAccountId } });
    const mappedAccount = await validateTreasuryPayoutAccount(treasuryAccount, tx);
    const availableBalance = decimal(treasuryAccount.currentBalance || 0)
      .minus(decimal(treasuryAccount.reservedBalance || 0));
    if (availableBalance.lt(total)) {
      throw conflict(`Insufficient unreserved funds in ${treasuryAccount.accountName}.`, "INSUFFICIENT_TREASURY_FUNDS");
    }

    const seller = await tx.partnerEquity.findUnique({ where: { id: sellerPartnerId } });
    if (!seller) throw invalid("Seller partner record not found.");
    if (!["ACTIVE", "INACTIVE"].includes(seller.status)) {
      throw conflict("Only an active or inactive shareholder can participate in a company buyback.", "INVALID_SELLER_STATUS");
    }
    const sellerShares = decimal(seller.shareCount || 0);
    if (sellerShares.lt(shares)) {
      throw conflict(`Insufficient shares: ${seller.partnerName} owns ${sellerShares.toString()} shares.`, "INSUFFICIENT_SHARES");
    }

    const partners = await tx.partnerEquity.findMany({
      where: { status: { in: ["ACTIVE", "INACTIVE"] } },
    });
    const totalShares = partners.reduce((sum, partner) => sum.plus(decimal(partner.shareCount || 0)), new Prisma.Decimal(0));
    if (totalShares.lt(shares) || totalShares.lte(0)) {
      throw conflict("The cap table does not contain enough issued shares for this buyback.", "CAP_TABLE_CONFLICT");
    }

    const treasuryUpdate = await tx.financialAccount.updateMany({
      where: {
        id: treasuryAccount.id,
        status: "ACTIVE",
        currency: "NPR",
        currentBalance: treasuryAccount.currentBalance,
        reservedBalance: treasuryAccount.reservedBalance || new Prisma.Decimal(0),
      },
      data: { currentBalance: { decrement: total } },
    });
    if (treasuryUpdate.count !== 1) {
      throw conflict("Treasury balance or reservations changed during the buyback. Refresh and retry.", "TREASURY_BALANCE_CONFLICT");
    }

    const nextSellerShares = sellerShares.minus(shares).toDecimalPlaces(2);
    const sellerUpdate = await tx.partnerEquity.updateMany({
      where: {
        id: seller.id,
        shareCount: seller.shareCount,
        status: seller.status,
      },
      data: {
        shareCount: Number(nextSellerShares.toFixed(2)),
        currentCapital: Math.max(0, Number(decimal(seller.currentCapital || 0).minus(total).toFixed(2))),
        status: nextSellerShares.lte(0) ? "EXITED" : seller.status,
      },
    });
    if (sellerUpdate.count !== 1) {
      throw conflict("Seller share balance changed during the buyback. Refresh and retry.", "SHARE_BALANCE_CONFLICT");
    }

    const newTotalShares = totalShares.minus(shares);
    const denominator = newTotalShares.gt(0) ? newTotalShares : new Prisma.Decimal(1);
    const remainingPartners = await tx.partnerEquity.findMany({
      where: { status: { in: ["ACTIVE", "INACTIVE"] } },
    });
    for (const partner of remainingPartners) {
      const ownership = decimal(partner.shareCount || 0)
        .dividedBy(denominator)
        .mul(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      await tx.partnerEquity.update({
        where: { id: partner.id },
        data: { ownershipPercentage: Number(ownership.toFixed(2)) },
      });
    }

    await tx.cashTransaction.create({
      data: {
        idempotencyKey: `SHARE_BUYBACK_CASH:${requestHash}`,
        date: transactionDate,
        amount: total,
        type: "OUTFLOW",
        fromAccountId: treasuryAccount.id,
        category: "SHARE_BUYBACK",
        referenceId: seller.id,
        description: `Company Share Buyback: Repurchased ${shares.toFixed(2)} shares from ${seller.partnerName} at Rs ${price.toFixed(4)}/share`,
      },
    });
    await tx.shareTransaction.create({
      data: {
        transactionType: "SHARE_BUYBACK",
        fromPartnerId: seller.id,
        fromPartnerName: seller.partnerName,
        toPartnerName: "Company Treasury (Retired)",
        shareCount: Number(shares.toFixed(2)),
        sharePrice: Number(price.toFixed(4)),
        totalAmount: total,
        equityPercentageTransferred: amountNumber(shares.dividedBy(totalShares).mul(100)),
        depositAccountId: treasuryAccount.id,
        settlementType: "COMPANY_TREASURY",
        date: transactionDate,
        notes: notes || `Company repurchased and retired ${shares.toFixed(2)} shares from ${seller.partnerName}.`,
      },
    });

    const journal = await postAccounting({
      seller,
      sharesCount: Number(shares.toFixed(2)),
      unitPrice: Number(price.toFixed(4)),
      totalTransactionValue: total,
      fromTreasuryAccountId: treasuryAccount.id,
      cashAccountCode: mappedAccount.accountCode,
      sourceId: `BUYBACK-${requestHash}`,
      idempotencyKey: journalIdempotencyKey,
      referenceNumber: payloadHash,
      transactionDate,
      throwOnError: true,
    }, { client: tx, throwOnError: true, throwOnIdempotencyConflict: true });

    return { alreadyProcessed: false, journal };
  };

  try {
    return await client.$transaction(transact, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (error.code === "P2002" || error.code === "P2034") {
      throw conflict("A concurrent request changed the buyback or Treasury state. Retry with the same Idempotency-Key.", "SHARE_BUYBACK_CONCURRENCY_CONFLICT");
    }
    throw error;
  }
};
