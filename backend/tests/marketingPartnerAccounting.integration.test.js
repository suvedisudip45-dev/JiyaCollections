import "../utils/requireIntegrationDatabaseSafety.js";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../config/db.js";
import { postMarketingCpaRedemptionAccounting } from "../services/accountingPostingEngine.js";
import { redeemPartnerBenefit } from "../services/marketingPartnerService.js";

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
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || databaseName !== "clothing") {
    throw new Error("Refusing marketing CPA integration test outside the authorized local clothing sandbox.");
  }
  return true;
};

const skip = !isAuthorizedLocalSandbox();

const createRedemptionFixture = async (tx, suffix) => {
  const customer = await tx.user.create({
    data: {
      name: `CPA Integration Customer ${suffix}`,
      email: `cpa-integration-${suffix}@example.test`,
    },
  });
  const partner = await tx.marketingPartner.create({
    data: {
      code: `CPA${suffix.replace(/-/g, "").slice(0, 20)}`,
      name: `CPA Integration Partner ${suffix}`,
      status: "ACTIVE",
      email: `cpa-partner-${suffix}@example.test`,
    },
  });
  const campaign = await tx.marketingCampaign.create({
    data: {
      marketingPartnerId: partner.id,
      name: `CPA Integration Campaign ${suffix}`,
      status: "ACTIVE",
      cpaRate: 25.75,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60_000),
      cardExpiresAt: new Date(Date.now() + 120_000),
    },
  });
  const batch = await tx.marketingCardBatch.create({
    data: {
      campaignId: campaign.id,
      batchCode: `CPA-${suffix}`,
      quantity: 1,
      status: "GENERATED",
    },
  });
  const benefit = await tx.marketingBenefit.create({
    data: {
      campaignId: campaign.id,
      name: "CPA integration reward",
      benefitType: "CUSTOM",
      value: 1,
      status: "ACTIVE",
    },
  });
  const card = await tx.marketingCard.create({
    data: {
      cardCode: `CPA-${suffix}`,
      qrTokenHash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
      partnerId: partner.id,
      campaignId: campaign.id,
      batchId: batch.id,
      hasBenefit: true,
      benefitId: benefit.id,
      physicalStatus: "ATTACHED",
    },
  });
  await tx.marketingCardCustomer.create({
    data: {
      cardId: card.id,
      customerId: customer.id,
      status: "ACTIVE",
      activatedAt: new Date(),
    },
  });

  return { customer, partner, campaign, batch, benefit, card };
};

test("marketing CPA redemption and posted journal share one database transaction", { skip }, async () => {
  const suffix = randomUUID();
  let accountingEventKey;
  let journalIdempotencyKey;
  const rollbackSignal = new Error("Rollback successful-posting integration fixture.");
  let observedRedemptionId;
  let posterCalled = false;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const fixture = await createRedemptionFixture(tx, suffix);
      const result = await redeemPartnerBenefit({
        partnerId: fixture.partner.id,
        cardCode: fixture.card.cardCode,
        benefitId: fixture.benefit.id,
      }, {
        client: tx,
        expireCards: async () => {},
        postAccounting: async (input) => {
          posterCalled = true;
          assert.equal(input.client, tx, "CPA poster must receive the active transaction client");
          return postMarketingCpaRedemptionAccounting(input);
        },
      });

      assert.equal(result.success, true);
      observedRedemptionId = result.redemptionId;
      accountingEventKey = `MARKETING_CPA:${result.redemptionId}`;
      journalIdempotencyKey = accountingEventKey;
      const journal = await tx.journalEntry.findUnique({
        where: { idempotencyKey: journalIdempotencyKey },
        include: { lines: { include: { account: true } } },
      });
      assert.ok(
        journal,
        `CPA journal must exist before the redemption transaction commits (key ${journalIdempotencyKey}, result ${JSON.stringify(result)}, campaign ${JSON.stringify(fixture.campaign)})`,
      );
      assert.equal(journal.sourceType, "MARKETING_CPA");
      assert.equal(journal.sourceId, result.redemptionId);
      assert.equal(journal.status, "POSTED");
      assert.equal(journal.totalDebit.toFixed(2), "25.75");
      assert.equal(journal.totalCredit.toFixed(2), "25.75");
      const redemptionEvent = await tx.marketingCardEvent.findFirst({
        where: { cardId: fixture.card.id, eventType: "BENEFIT_REDEEMED" },
        select: { referenceId: true, metadata: true },
      });
      assert.equal(redemptionEvent.referenceId, result.redemptionId);
      assert.equal(redemptionEvent.metadata.redemptionId, result.redemptionId);
      assert.equal(redemptionEvent.metadata.cpaRateSnapshot, "25.75");
      assert.deepEqual(
        journal.lines.map(({ account, debit, credit }) => ({
          accountCode: account.accountCode,
          debit: debit.toFixed(2),
          credit: credit.toFixed(2),
        })).sort((left, right) => left.accountCode.localeCompare(right.accountCode)),
        [
          { accountCode: "2170", debit: "0.00", credit: "25.75" },
          { accountCode: "6420", debit: "25.75", credit: "0.00" },
        ],
      );
      const document = await tx.accountingDocument.findUnique({
        where: { idempotencyKey: `MARKETING_CPA_DOCUMENT:${result.redemptionId}` },
      });
      assert.ok(document);
      assert.equal(document.documentType, "BILL");
      assert.equal(document.side, "PAYABLE");
      assert.equal(document.sourceType, "MARKETING_CPA");
      assert.equal(document.sourceId, result.redemptionId);
      assert.equal(document.originalAmount.toFixed(2), "25.75");
      assert.equal(document.remainingAmount.toFixed(2), "25.75");
      const replayedJournal = await postMarketingCpaRedemptionAccounting({
        redemption: {
          id: result.redemptionId,
          cardId: fixture.card.id,
          redeemedAt: new Date(),
          cpaRateSnapshot: redemptionEvent.metadata.cpaRateSnapshot,
        },
        campaign: fixture.campaign,
        partner: fixture.partner,
        client: tx,
      });
      assert.equal(replayedJournal.id, journal.id);
      assert.equal(await tx.accountingDocument.count({
        where: { idempotencyKey: `MARKETING_CPA_DOCUMENT:${result.redemptionId}` },
      }), 1);
      assert.equal(await tx.marketingBenefitRedemption.count({
        where: { id: result.redemptionId, status: "REDEEMED" },
      }), 1);
      assert.equal(await tx.marketingCardEvent.count({
        where: { cardId: fixture.card.id, eventType: "BENEFIT_REDEEMED" },
      }), 1);
      assert.equal(await tx.accountingEvent.count({
        where: { idempotencyKey: accountingEventKey, status: "POSTED" },
      }), 1);

      throw rollbackSignal;
    }),
    (error) => error === rollbackSignal,
  );

  assert.equal(posterCalled, true);
  assert.ok(observedRedemptionId);
  assert.equal(await prisma.marketingBenefitRedemption.count({ where: { id: observedRedemptionId } }), 0);
  assert.equal(await prisma.journalEntry.count({ where: { idempotencyKey: journalIdempotencyKey } }), 0);
  assert.equal(await prisma.accountingEvent.count({ where: { idempotencyKey: accountingEventKey } }), 0);
  assert.equal(await prisma.accountingDocument.count({
    where: { sourceType: "MARKETING_CPA", sourceId: observedRedemptionId },
  }), 0);
});

test("failed marketing CPA posting leaves no redemption, card event, or accounting event in the sandbox", { skip }, async () => {
  const suffix = randomUUID();
  const accountingEventKey = `TEST-MARKETING-CPA-FAILURE:${suffix}`;
  let cardId;
  let customerId;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const fixture = await createRedemptionFixture(tx, suffix);
      cardId = fixture.card.id;
      customerId = fixture.customer.id;

      await redeemPartnerBenefit({
        partnerId: fixture.partner.id,
        cardCode: fixture.card.cardCode,
        benefitId: fixture.benefit.id,
      }, {
        client: tx,
        expireCards: async () => {},
        postAccounting: async ({ client }) => {
          await client.accountingEvent.create({
            data: {
              idempotencyKey: accountingEventKey,
              sourceType: "TEST_MARKETING_CPA",
              sourceId: suffix,
              sourceVersion: 1,
              eventType: "TEST_MARKETING_CPA",
              effectiveAt: new Date(),
              status: "PROCESSING",
              payload: { test: true },
              payloadHash: "0".repeat(64),
            },
          });
          throw new Error("Injected CPA accounting failure.");
        },
      });
    }),
    /Injected CPA accounting failure/,
  );

  assert.ok(cardId);
  assert.ok(customerId);
  assert.equal(await prisma.marketingBenefitRedemption.count({ where: { cardId, customerId } }), 0);
  assert.equal(await prisma.marketingCardEvent.count({ where: { cardId, eventType: "BENEFIT_REDEEMED" } }), 0);
  assert.equal(await prisma.accountingEvent.count({ where: { idempotencyKey: accountingEventKey } }), 0);
});
