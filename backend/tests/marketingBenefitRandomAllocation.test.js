import assert from "node:assert/strict";
import { prisma } from "../config/db.js";
import {
  createCampaign,
  generateBatch,
} from "../services/marketingCardService.js";
import {
  linkCustomerCard,
  redeemCustomerBenefit,
} from "../services/marketingCardCustomerService.js";

async function runTest() {
  console.log("▶ Testing Partial Benefit Card Allocation (Winning vs Non-winning 'Better Luck Next Time')...");

  // Ensure partner exists
  let partner = await prisma.marketingPartner.findFirst({ where: { status: "ACTIVE" } });
  if (!partner) {
    partner = await prisma.marketingPartner.create({
      data: {
        code: "TEST_PARTNER",
        name: "Test Partner",
        status: "ACTIVE",
      },
    });
  }

  // 1. Create a test campaign with 2 benefits (20 discount vouchers, 20 gifts)
  const campaign = await createCampaign({
    marketingPartnerId: partner.id,
    name: `Test 500 Cards Campaign ${Date.now()}`,
    targetScopeType: "NATIONWIDE",
    requestedQuantity: 500,
    benefits: [
      {
        name: "Rs 500 Discount Voucher",
        description: "20% off on all items",
        benefitType: "DISCOUNT",
        value: 500,
        quantity: 20, // Only 20 winning cards
      },
      {
        name: "Gift Hamper",
        description: "Exclusive promotional gift",
        benefitType: "GIFT",
        value: 1000,
        quantity: 20, // Only 20 winning cards
      },
    ],
  });

  console.log(`✅ Campaign created with ${campaign.benefits.length} benefits: 20 Discount + 20 Gift`);

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

  const winningCards = dbCards.filter((c) => c.hasBenefit);
  const nonWinningCards = dbCards.filter((c) => !c.hasBenefit);

  const discountCards = dbCards.filter((c) => c.benefit?.benefitType === "DISCOUNT");
  const giftCards = dbCards.filter((c) => c.benefit?.benefitType === "GIFT");

  console.log(`Generated batch of 500 cards:`);
  console.log(`- Winning cards:     ${winningCards.length} (Expected: 40)`);
  console.log(`  • Discount vouchers: ${discountCards.length} (Expected: 20)`);
  console.log(`  • Gift hampers:      ${giftCards.length} (Expected: 20)`);
  console.log(`- Non-winning cards: ${nonWinningCards.length} (Expected: 460 - Better Luck Next Time)`);

  assert.equal(winningCards.length, 40, "Exactly 40 cards must be winning cards");
  assert.equal(discountCards.length, 20, "Exactly 20 cards must have Discount voucher");
  assert.equal(giftCards.length, 20, "Exactly 20 cards must have Gift hamper");
  assert.equal(nonWinningCards.length, 460, "Exactly 460 cards must have no benefit (Better luck next time)");

  // Check random distribution (winning cards should not all be in first 40 cards)
  const first40 = dbCards.slice(0, 40);
  const winningInFirst40 = first40.filter((c) => c.hasBenefit).length;
  console.log(`- Winning cards in first 40 positions: ${winningInFirst40}/40 (Demonstrates random shuffle, not sequential)`);
  assert.ok(winningInFirst40 < 40, "Winning cards should be shuffled randomly across the 500 cards");

  console.log("✅ All benefit allocation & 'Better Luck Next Time' tests passed!");
}

runTest()
  .catch((e) => {
    console.error("❌ Test failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
