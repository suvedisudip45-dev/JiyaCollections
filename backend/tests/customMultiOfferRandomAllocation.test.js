import assert from "node:assert/strict";
import { prisma } from "../config/db.js";
import {
  createCampaign,
  generateBatch,
} from "../services/marketingCardService.js";

async function runTest() {
  console.log("▶ Testing Custom Multi-Offer Percentage Distribution (10% to 10%, 20% to 5%, Free Accessory to 5%, 80% Better Luck Next Time)...");

  // Ensure partner exists
  let partner = await prisma.marketingPartner.findFirst({ where: { status: "ACTIVE" } });
  if (!partner) {
    partner = await prisma.marketingPartner.create({
      data: {
        code: "MULTI_PARTNER",
        name: "Multi-Offer Partner",
        status: "ACTIVE",
      },
    });
  }

  // 1. Create a campaign with the user's custom offers:
  // - Offer 1: 10% discount for 10% customers
  // - Offer 2: 20% discount for 5% customers
  // - Offer 3: Free accessories worth 100 for 5% customers
  const campaign = await createCampaign({
    marketingPartnerId: partner.id,
    name: `Multi-Tier Offer Campaign ${Date.now()}`,
    targetScopeType: "NATIONWIDE",
    requestedQuantity: 500,
    benefits: [
      {
        name: "10% Discount Voucher",
        description: "10% off on all items",
        benefitType: "DISCOUNT",
        value: 10,
        percentage: 10, // 10% of batch
      },
      {
        name: "20% Discount Voucher",
        description: "20% off on all items",
        benefitType: "DISCOUNT",
        value: 20,
        percentage: 5, // 5% of batch
      },
      {
        name: "Free Accessories (Worth Rs 100)",
        description: "Free accessory gift item",
        benefitType: "GIFT",
        value: 100,
        percentage: 5, // 5% of batch
      },
    ],
  });

  console.log(`✅ Campaign created with 3 custom percentage offers:`, campaign.benefits.map((b) => `${b.name} (${b.percentage}%)`));

  // 2. Generate a batch of 500 cards
  const { batch, cards } = await generateBatch({
    campaignId: campaign.id,
    quantity: 500,
    actorId: "admin",
  });

  assert.equal(cards.length, 500, "Should generate exactly 500 cards");

  // 3. Inspect generated cards in database
  const dbCards = await prisma.marketingCard.findMany({
    where: { batchId: batch.id },
    include: { benefit: true },
  });

  const offer10Pct = dbCards.filter((c) => c.benefit?.name === "10% Discount Voucher");
  const offer20Pct = dbCards.filter((c) => c.benefit?.name === "20% Discount Voucher");
  const offerGift = dbCards.filter((c) => c.benefit?.name === "Free Accessories (Worth Rs 100)");
  const nonWinningCards = dbCards.filter((c) => !c.hasBenefit);

  console.log(`Generated batch of 500 cards:`);
  console.log(`- 10% Discount cards (10% of 500): ${offer10Pct.length} (Expected: 50)`);
  console.log(`- 20% Discount cards (5% of 500):  ${offer20Pct.length} (Expected: 25)`);
  console.log(`- Free Accessories (5% of 500):    ${offerGift.length} (Expected: 25)`);
  console.log(`- Non-winning 'Better Luck Next Time' (80% of 500): ${nonWinningCards.length} (Expected: 400)`);

  assert.equal(offer10Pct.length, 50, "10% Discount must be assigned to exactly 50 cards (10% of 500)");
  assert.equal(offer20Pct.length, 25, "20% Discount must be assigned to exactly 25 cards (5% of 500)");
  assert.equal(offerGift.length, 25, "Free Accessories must be assigned to exactly 25 cards (5% of 500)");
  assert.equal(nonWinningCards.length, 400, "Remaining 400 cards must have no benefit (Better luck next time)");

  // Check random distribution (winning cards should be scattered across the 500 cards)
  const first100 = dbCards.slice(0, 100);
  const winningInFirst100 = first100.filter((c) => c.hasBenefit).length;
  console.log(`- Winning cards in first 100 positions: ${winningInFirst100}/100 (Expected around ~20 due to random shuffle)`);
  assert.ok(winningInFirst100 < 100, "Winning cards must be randomly distributed, not concentrated in first slots");

  console.log("✅ All custom multi-offer random distribution tests passed successfully!");
}

runTest()
  .catch((e) => {
    console.error("❌ Test failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
