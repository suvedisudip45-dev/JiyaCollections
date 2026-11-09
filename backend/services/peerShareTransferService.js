import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";

const conflict = (message, code) => Object.assign(new Error(message), { statusCode: 409, code });
const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });
const decimal = (value) => new Prisma.Decimal(String(value));

export const recordPeerShareTransfer = async ({
  sellerPartnerId,
  buyerType = "EXISTING_PARTNER",
  buyerPartnerId,
  buyerName,
  buyerEmail,
  buyerPhone,
  buyerRole = "ANGEL_INVESTOR",
  sharesToTransfer,
  sharePrice = 100,
  notes = "",
  idempotencyKey: rawIdempotencyKey,
}, { client = prisma } = {}) => {
  let shares;
  let price;
  try {
    shares = decimal(sharesToTransfer);
    price = decimal(sharePrice);
  } catch {
    throw invalid("Share count and share price must be valid numbers.");
  }
  if (!sellerPartnerId || !shares.isFinite() || !price.isFinite() || shares.lte(0) || price.lte(0)) {
    throw invalid("Seller, positive share count, and positive share price are required.");
  }
  if (!shares.eq(shares.toDecimalPlaces(2)) || !price.eq(price.toDecimalPlaces(4))) {
    throw invalid("Share count supports at most two decimals and share price at most four decimals.");
  }
  if (!["EXISTING_PARTNER", "NEW_INVESTOR"].includes(buyerType)) {
    throw invalid("Select a valid buyer type.");
  }
  if (buyerType === "EXISTING_PARTNER" && !buyerPartnerId) {
    throw invalid("Please select an existing buyer partner.");
  }
  if (buyerType === "EXISTING_PARTNER" && buyerPartnerId === sellerPartnerId) {
    throw invalid("Seller and buyer cannot be the same partner.");
  }
  const normalizedBuyerName = String(buyerName || "").trim();
  const normalizedBuyerEmail = String(buyerEmail || "").trim().toLowerCase();
  if (buyerType === "NEW_INVESTOR" && (!normalizedBuyerName || !normalizedBuyerEmail)) {
    throw invalid("Buyer name and email are required for a new incoming investor.");
  }

  const totalAmount = Number(shares.mul(price).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));
  const rawKey = String(rawIdempotencyKey || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,140}$/.test(rawKey)) {
    throw invalid("A valid Idempotency-Key is required.");
  }
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const idempotencyKey = `PEER_SHARE_TRANSFER:${keyHash}`;
  const payloadHash = createHash("sha256").update(JSON.stringify({
    sellerPartnerId,
    buyerType,
    buyerPartnerId: buyerType === "EXISTING_PARTNER" ? buyerPartnerId : null,
    buyerName: buyerType === "NEW_INVESTOR" ? normalizedBuyerName : "",
    buyerEmail: buyerType === "NEW_INVESTOR" ? normalizedBuyerEmail : "",
    buyerPhone: buyerType === "NEW_INVESTOR" ? buyerPhone || "" : "",
    buyerRole: buyerType === "NEW_INVESTOR" ? buyerRole : "",
    shares: shares.toFixed(2),
    sharePrice: price.toFixed(4),
    totalAmount: totalAmount.toFixed(2),
    notes: String(notes || ""),
  })).digest("hex");
  const transactionDate = new Date();
  const replay = async (tx) => {
    const existing = await tx.shareTransaction.findUnique({ where: { idempotencyKey } });
    if (!existing) return null;
    if (existing.transactionType !== "SECONDARY_TRANSFER" || existing.requestPayloadHash !== payloadHash) {
      throw conflict("This Idempotency-Key was already used for a different share transfer.", "IDEMPOTENCY_KEY_REUSED");
    }
    return {
      alreadyProcessed: true,
      transactionId: existing.id,
      sellerName: existing.fromPartnerName,
      buyerName: existing.toPartnerName,
      shares: Number(existing.shareCount),
      ownershipPercentage: Number(existing.equityPercentageTransferred),
    };
  };
  const transact = async (tx) => {
    const replayed = await replay(tx);
    if (replayed) return replayed;

    const seller = await tx.partnerEquity.findUnique({ where: { id: sellerPartnerId } });
    if (!seller || !["ACTIVE", "INACTIVE"].includes(seller.status)) {
      throw invalid("An active or inactive seller partner is required.");
    }

    const buyer = buyerType === "EXISTING_PARTNER"
      ? await tx.partnerEquity.findUnique({ where: { id: buyerPartnerId } })
      : null;
    if (buyerType === "EXISTING_PARTNER" && (!buyer || !["ACTIVE", "INACTIVE"].includes(buyer.status))) {
      throw invalid("An active or inactive buyer partner is required.");
    }

    const partners = await tx.partnerEquity.findMany({
      where: { status: { in: ["ACTIVE", "INACTIVE"] } },
    });
    const totalShares = partners.reduce(
      (sum, partner) => sum.plus(decimal(partner.shareCount || 0)),
      new Prisma.Decimal(0),
    );
    if (totalShares.lte(0)) {
      throw conflict("The cap table has no issued shares to transfer.", "CAP_TABLE_CONFLICT");
    }
    const sellerShares = decimal(seller.shareCount || 0);
    if (sellerShares.lt(shares)) {
      throw conflict(`Insufficient shares: ${seller.partnerName} owns ${sellerShares.toString()} shares.`, "INSUFFICIENT_SHARES");
    }

    let updatedBuyer = buyer;
    if (buyer) {
      const newBuyerShares = decimal(buyer.shareCount || 0).plus(shares).toDecimalPlaces(2);
      const buyerUpdate = await tx.partnerEquity.updateMany({
        where: { id: buyer.id, shareCount: buyer.shareCount, status: buyer.status },
        data: {
          shareCount: Number(newBuyerShares.toFixed(2)),
        },
      });
      if (buyerUpdate.count !== 1) {
        throw conflict("Buyer share balance changed during the transfer. Refresh and retry.", "SHARE_BALANCE_CONFLICT");
      }
      updatedBuyer = { ...buyer, shareCount: Number(newBuyerShares.toFixed(2)) };
    } else {
      const existingEmail = await tx.partnerEquity.findUnique({ where: { email: normalizedBuyerEmail } });
      if (existingEmail) {
        throw conflict("This email already belongs to a shareholder. Select that shareholder as the existing buyer.", "BUYER_ALREADY_EXISTS");
      }
      updatedBuyer = await tx.partnerEquity.create({
        data: {
          partnerName: normalizedBuyerName,
          email: normalizedBuyerEmail,
          phone: buyerPhone || "",
          role: buyerRole || "ANGEL_INVESTOR",
          shareCount: Number(shares.toFixed(2)),
          sharePrice: Number(price.toFixed(4)),
          ownershipPercentage: 0,
          // A private secondary purchase does not add capital to the company.
          initialCapital: 0,
          currentCapital: 0,
          status: "ACTIVE",
          notes: `Acquired ${shares.toFixed(2)} secondary shares from ${seller.partnerName}`,
        },
      });
    }

    const remainingSellerShares = sellerShares.minus(shares).toDecimalPlaces(2);
    const sellerUpdate = await tx.partnerEquity.updateMany({
      where: { id: seller.id, shareCount: seller.shareCount, status: seller.status },
      data: {
        shareCount: Number(remainingSellerShares.toFixed(2)),
        status: remainingSellerShares.lte(0) ? "EXITED" : seller.status,
      },
    });
    if (sellerUpdate.count !== 1) {
      throw conflict("Seller share balance changed during the transfer. Refresh and retry.", "SHARE_BALANCE_CONFLICT");
    }

    const afterTransferPartners = await tx.partnerEquity.findMany({
      where: { status: { in: ["ACTIVE", "INACTIVE"] } },
    });
    for (const partner of afterTransferPartners) {
      const percentage = decimal(partner.shareCount || 0)
        .dividedBy(totalShares)
        .mul(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      await tx.partnerEquity.update({
        where: { id: partner.id },
        data: { ownershipPercentage: Number(percentage.toFixed(2)) },
      });
    }
    const transferredPercentage = shares
      .dividedBy(totalShares)
      .mul(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const shareTransaction = await tx.shareTransaction.create({
      data: {
        idempotencyKey,
        requestPayloadHash: payloadHash,
        transactionType: "SECONDARY_TRANSFER",
        fromPartnerId: seller.id,
        fromPartnerName: seller.partnerName,
        toPartnerId: updatedBuyer.id,
        toPartnerName: updatedBuyer.partnerName,
        shareCount: Number(shares.toFixed(2)),
        sharePrice: Number(price.toFixed(4)),
        totalAmount,
        equityPercentageTransferred: Number(transferredPercentage.toFixed(2)),
        settlementType: "PRIVATE_PEER_TO_PEER",
        date: transactionDate,
        notes: notes || `Secondary sale: ${seller.partnerName} transferred ${shares.toFixed(2)} shares (${transferredPercentage.toFixed(2)}%) to ${updatedBuyer.partnerName} at Rs ${price.toFixed(4)}/share.`,
      },
    });

    return {
      alreadyProcessed: false,
      transactionId: shareTransaction.id,
      sellerName: seller.partnerName,
      buyerName: updatedBuyer.partnerName,
      shares: Number(shares.toFixed(2)),
      ownershipPercentage: Number(transferredPercentage.toFixed(2)),
    };
  };

  try {
    return await client.$transaction(transact, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (error.code === "P2002" || error.code === "P2034") {
      const replayed = await replay(client);
      if (replayed) return replayed;
      if (error.code === "P2002" && error.meta?.target?.toString().toLowerCase().includes("email")) {
        throw conflict("This email already belongs to a shareholder. Select that shareholder as the existing buyer.", "BUYER_ALREADY_EXISTS");
      }
      throw conflict("A concurrent request changed the cap table. Refresh and retry.", "SHARE_TRANSFER_CONCURRENCY_CONFLICT");
    }
    throw error;
  }
};
