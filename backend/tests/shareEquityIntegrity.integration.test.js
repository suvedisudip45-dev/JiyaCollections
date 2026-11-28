import "../utils/requireIntegrationDatabaseSafety.js";
import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../config/db.js";
import { issueNewShares } from "../controllers/financialController.js";
import { recordPeerShareTransfer } from "../services/peerShareTransferService.js";
import { recordShareBuyback } from "../services/shareBuybackService.js";

const isAuthorizedLocalSandbox = () => {
  if (process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1") return false;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must identify the authorized local accounting sandbox.");

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid MySQL URL for the authorized local accounting sandbox.");
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || databaseName !== "clothing") {
    throw new Error("Refusing share-equity integration test outside the authorized local clothing sandbox.");
  }
  return true;
};

const skip = !isAuthorizedLocalSandbox();
const rollbackSignal = new Error("Roll back share-equity integration fixture.");

const transactionClient = (tx) => ({
  $transaction: async (callback, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    return callback(tx);
  },
});

test("share buyback commits source, Treasury, cash, and GL together", { skip }, async (t) => {
  const [bankAccount, shareCapitalAccount] = await Promise.all([
    prisma.account.findUnique({ where: { accountCode: "1120" } }),
    prisma.account.findUnique({ where: { accountCode: "3100" } }),
  ]);
  if (!bankAccount?.isActive || !shareCapitalAccount?.isActive) {
    t.skip("Mapped bank and share-capital GL accounts are required for the rollback-only fixture.");
    return;
  }

  const suffix = randomUUID();
  const treasuryName = `Integration Share Buyback Treasury ${suffix}`;
  const treasuryBalance = 1000;
  const idempotencyKey = `IT-SHARE-BUYBACK-${suffix}`;
  const journalKey = `SHARE_BUYBACK:${createHash("sha256").update(idempotencyKey).digest("hex")}`;
  const cashKey = `SHARE_BUYBACK_CASH:${createHash("sha256").update(idempotencyKey).digest("hex")}`;
  let sellerId;
  let holderId;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const treasury = await tx.financialAccount.create({
        data: {
          accountName: treasuryName,
          accountType: "BANK",
          currentBalance: treasuryBalance,
          reservedBalance: 0,
          currency: "NPR",
          status: "ACTIVE",
          accountingAccountId: bankAccount.id,
        },
      });
      const seller = await tx.partnerEquity.create({
        data: {
          partnerName: `Integration Buyback Seller ${suffix}`,
          email: `buyback-seller-${suffix}@example.test`,
          role: "PARTNER",
          shareCount: 600,
          sharePrice: 100,
          ownershipPercentage: 60,
          initialCapital: 60000,
          currentCapital: 60000,
          status: "ACTIVE",
        },
      });
      sellerId = seller.id;
      const holder = await tx.partnerEquity.create({
        data: {
          partnerName: `Integration Buyback Holder ${suffix}`,
          email: `buyback-holder-${suffix}@example.test`,
          role: "PARTNER",
          shareCount: 400,
          sharePrice: 100,
          ownershipPercentage: 40,
          initialCapital: 40000,
          currentCapital: 40000,
          status: "ACTIVE",
        },
      });
      holderId = holder.id;

      const result = await recordShareBuyback({
        sellerPartnerId: seller.id,
        sharesToTransfer: "1",
        sharePrice: "100",
        fromTreasuryAccountId: treasury.id,
        notes: idempotencyKey,
        idempotencyKey,
      }, { client: transactionClient(tx) });
      assert.equal(result.alreadyProcessed, false);

      const [updatedSeller, updatedHolder, updatedTreasury, cash, shareTransaction, journal] = await Promise.all([
        tx.partnerEquity.findUnique({ where: { id: seller.id } }),
        tx.partnerEquity.findUnique({ where: { id: holder.id } }),
        tx.financialAccount.findUnique({ where: { id: treasury.id } }),
        tx.cashTransaction.findUnique({ where: { idempotencyKey: cashKey } }),
        tx.shareTransaction.findFirst({
          where: { transactionType: "SHARE_BUYBACK", fromPartnerId: seller.id, notes: idempotencyKey },
        }),
        tx.journalEntry.findUnique({
          where: { idempotencyKey: journalKey },
          include: { lines: { include: { account: true } } },
        }),
      ]);
      assert.equal(updatedSeller.shareCount, 599);
      assert.equal(updatedSeller.currentCapital, 59900);
      assert.equal(updatedHolder.shareCount, 400);
      assert.equal(updatedTreasury.currentBalance.toFixed(2), treasury.currentBalance.minus(100).toFixed(2));
      assert.equal(cash.amount.toFixed(2), "100.00");
      assert.equal(cash.type, "OUTFLOW");
      assert.equal(shareTransaction.shareCount, 1);
      assert.ok(journal);
      assert.equal(journal.status, "POSTED");
      assert.equal(journal.totalDebit.toFixed(2), "100.00");
      assert.equal(journal.totalCredit.toFixed(2), "100.00");
      assert.equal(journal.lines.reduce((sum, line) => sum + Number(line.debit), 0), 100);
      assert.equal(journal.lines.reduce((sum, line) => sum + Number(line.credit), 0), 100);
      assert.equal(journal.lines.find((line) => line.account.accountCode === "3100").debit.toFixed(2), "100.00");
      assert.equal(journal.lines.find((line) => line.account.accountCode === "1120").credit.toFixed(2), "100.00");
      throw rollbackSignal;
    }, { isolationLevel: "Serializable" }),
    (error) => error === rollbackSignal,
  );

  assert.equal(await prisma.partnerEquity.count({ where: { id: { in: [sellerId, holderId] } } }), 0);
  assert.equal(await prisma.cashTransaction.count({ where: { idempotencyKey: cashKey } }), 0);
  assert.equal(await prisma.journalEntry.count({ where: { idempotencyKey: journalKey } }), 0);
  assert.equal(await prisma.shareTransaction.count({
    where: { transactionType: "SHARE_BUYBACK", fromPartnerId: sellerId, notes: idempotencyKey },
  }), 0);
  assert.equal(await prisma.financialAccount.count({ where: { accountName: treasuryName } }), 0);
});

test("peer share transfer persists a unique transaction and rolls back cap-table writes", { skip }, async () => {
  const suffix = randomUUID();
  const idempotencyKey = `IT-PEER-SHARE-${suffix}`;
  const transactionKey = `PEER_SHARE_TRANSFER:${createHash("sha256").update(idempotencyKey).digest("hex")}`;
  let sellerId;
  let buyerId;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const seller = await tx.partnerEquity.create({
        data: {
          partnerName: `Integration Transfer Seller ${suffix}`,
          email: `transfer-seller-${suffix}@example.test`,
          role: "PARTNER",
          shareCount: 600,
          sharePrice: 100,
          ownershipPercentage: 60,
          initialCapital: 60000,
          currentCapital: 60000,
          status: "ACTIVE",
        },
      });
      sellerId = seller.id;
      const buyer = await tx.partnerEquity.create({
        data: {
          partnerName: `Integration Transfer Buyer ${suffix}`,
          email: `transfer-buyer-${suffix}@example.test`,
          role: "PARTNER",
          shareCount: 400,
          sharePrice: 100,
          ownershipPercentage: 40,
          initialCapital: 40000,
          currentCapital: 40000,
          status: "ACTIVE",
        },
      });
      buyerId = buyer.id;
      const beforeTotal = (await tx.partnerEquity.findMany({
        where: { status: { in: ["ACTIVE", "INACTIVE"] } },
        select: { shareCount: true },
      })).reduce((sum, partner) => sum + partner.shareCount, 0);

      const input = {
        sellerPartnerId: seller.id,
        buyerType: "EXISTING_PARTNER",
        buyerPartnerId: buyer.id,
        sharesToTransfer: "100",
        sharePrice: "125.50",
        idempotencyKey,
      };
      const result = await recordPeerShareTransfer(input, { client: transactionClient(tx) });
      const replay = await recordPeerShareTransfer(input, { client: transactionClient(tx) });
      await assert.rejects(
        recordPeerShareTransfer({ ...input, sharesToTransfer: "101" }, { client: transactionClient(tx) }),
        { code: "IDEMPOTENCY_KEY_REUSED" },
      );

      const [updatedSeller, updatedBuyer, shareTransaction] = await Promise.all([
        tx.partnerEquity.findUnique({ where: { id: seller.id } }),
        tx.partnerEquity.findUnique({ where: { id: buyer.id } }),
        tx.shareTransaction.findUnique({ where: { idempotencyKey: transactionKey } }),
      ]);
      const afterTotal = (await tx.partnerEquity.findMany({
        where: { status: { in: ["ACTIVE", "INACTIVE"] } },
        select: { shareCount: true },
      })).reduce((sum, partner) => sum + partner.shareCount, 0);
      assert.equal(result.alreadyProcessed, false);
      assert.equal(replay.alreadyProcessed, true);
      assert.equal(replay.transactionId, result.transactionId);
      assert.equal(updatedSeller.shareCount, 500);
      assert.equal(updatedBuyer.shareCount, 500);
      assert.equal(afterTotal, beforeTotal);
      assert.equal(shareTransaction.settlementType, "PRIVATE_PEER_TO_PEER");
      assert.equal(shareTransaction.requestPayloadHash.length, 64);
      throw rollbackSignal;
    }, { isolationLevel: "Serializable" }),
    (error) => error === rollbackSignal,
  );

  assert.equal(await prisma.partnerEquity.count({ where: { id: { in: [sellerId, buyerId] } } }), 0);
  assert.equal(await prisma.shareTransaction.count({ where: { idempotencyKey: transactionKey } }), 0);
});

test("primary share issuance updates cap table, Treasury, cash, and GL in one transaction", { skip }, async () => {
  const suffix = randomUUID();
  const investorName = `Integration Issuance Investor ${suffix}`;
  const investorEmail = `issuance-${suffix}@example.test`;
  const roundName = `Integration Issuance Round ${suffix}`;
  const treasuryName = `Integration Issuance Treasury ${suffix}`;
  const idempotencyKey = `IT-SHARE-ISSUANCE-${suffix}`;
  const requestHash = createHash("sha256").update(idempotencyKey).digest("hex");
  const journalKey = `CAPITAL_INJECTION:${requestHash}`;
  const cashKey = `CAPITAL_INJECTION_CASH:${requestHash}`;
  const investmentAmount = 10000;
  const rollbackError = Object.assign(
    new Error("Rollback primary share-issuance integration fixture."),
    { statusCode: 409, code: "INTEGRATION_ROLLBACK" },
  );
  const [bankAccount, shareCapitalAccount] = await Promise.all([
    prisma.account.findUnique({ where: { accountCode: "1120" } }),
    prisma.account.findUnique({ where: { accountCode: "3100" } }),
  ]);
  assert.ok(bankAccount?.isActive, "Active bank GL account 1120 must exist.");
  assert.ok(shareCapitalAccount?.isActive, "Active share-capital GL account 3100 must exist.");

  const originalTransaction = prisma.$transaction.bind(prisma);
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  try {
    await assert.rejects(
      originalTransaction(async (tx) => {
        const treasury = await tx.financialAccount.create({
          data: {
            accountName: treasuryName,
            accountType: "BANK",
            currentBalance: 0,
            reservedBalance: 0,
            currency: "NPR",
            status: "ACTIVE",
            accountingAccountId: bankAccount.id,
          },
        });
        await tx.partnerEquity.create({
          data: {
            partnerName: `Integration Issuance Founder ${suffix}`,
            email: `issuance-founder-${suffix}@example.test`,
            role: "FOUNDER",
            shareCount: 1000,
            sharePrice: 100,
            ownershipPercentage: 100,
            initialCapital: 100000,
            currentCapital: 100000,
            status: "ACTIVE",
          },
        });

        prisma.$transaction = async (callback, options) => {
          assert.equal(options.isolationLevel, "Serializable");
          const outcome = await callback(tx);
          assert.equal(outcome.alreadyProcessed, false);
          assert.equal(outcome.metrics.investmentAmount, investmentAmount);
          assert.ok(outcome.metrics.newSharesIssued > 0);

          const [updatedTreasury, investor, cash, shareTransaction, journal] = await Promise.all([
            tx.financialAccount.findUnique({ where: { id: treasury.id } }),
            tx.partnerEquity.findUnique({ where: { email: investorEmail } }),
            tx.cashTransaction.findUnique({ where: { idempotencyKey: cashKey } }),
            tx.shareTransaction.findFirst({
              where: { valuationRoundId: outcome.valuation.id, transactionType: "PRIMARY_ISSUANCE" },
            }),
            tx.journalEntry.findUnique({
              where: { idempotencyKey: journalKey },
              include: { lines: { include: { account: true } } },
            }),
          ]);
          assert.equal(updatedTreasury.currentBalance.toFixed(2), investmentAmount.toFixed(2));
          assert.ok(investor.shareCount > 0);
          assert.equal(cash.type, "INFLOW");
          assert.equal(cash.amount.toFixed(2), investmentAmount.toFixed(2));
          assert.equal(shareTransaction.toPartnerId, investor.id);
          assert.ok(journal);
          assert.equal(journal.status, "POSTED");
          assert.equal(journal.totalDebit.toFixed(2), investmentAmount.toFixed(2));
          assert.equal(journal.totalCredit.toFixed(2), investmentAmount.toFixed(2));
          assert.equal(journal.lines.find((line) => line.account.accountCode === "1120").debit.toFixed(2), investmentAmount.toFixed(2));
          assert.equal(journal.lines.find((line) => line.account.accountCode === "3100").credit.toFixed(2), investmentAmount.toFixed(2));
          throw rollbackError;
        };

        await issueNewShares({
          body: {
            investorName,
            email: investorEmail,
            preMoneyValuation: "1000000.00",
            investmentAmount: "10000.00",
            depositAccountId: treasury.id,
            roundName,
            idempotencyKey,
          },
        }, response);
        assert.equal(response.statusCode, 409);
        assert.equal(response.body.code, "INTEGRATION_ROLLBACK");
        throw rollbackError;
      }, { isolationLevel: "Serializable" }),
      (error) => error === rollbackError,
    );
  } finally {
    prisma.$transaction = originalTransaction;
  }

  assert.equal(await prisma.partnerEquity.count({ where: { email: investorEmail } }), 0);
  assert.equal(await prisma.partnerEquity.count({ where: { email: `issuance-founder-${suffix}@example.test` } }), 0);
  assert.equal(await prisma.financialAccount.count({ where: { accountName: treasuryName } }), 0);
  assert.equal(await prisma.companyValuation.count({ where: { roundName } }), 0);
  assert.equal(await prisma.cashTransaction.count({ where: { idempotencyKey: cashKey } }), 0);
  assert.equal(await prisma.journalEntry.count({ where: { idempotencyKey: journalKey } }), 0);
  assert.equal(await prisma.shareTransaction.count({
    where: { transactionType: "PRIMARY_ISSUANCE", toPartnerName: investorName },
  }), 0);
});
