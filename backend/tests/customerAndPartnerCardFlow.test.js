import assert from "node:assert/strict";
import { prisma } from "../config/db.js";
import {
  createCampaign,
  generateBatch,
} from "../services/marketingCardService.js";
import {
  verifyCustomerCardCode,
  verifyCustomerQr,
  activateCustomerCard,
  listCustomerCards,
} from "../services/marketingCardCustomerService.js";
import {
  validatePartnerQr,
  redeemPartnerBenefit,
  rejectPartnerCard,
} from "../services/marketingPartnerService.js";

async function runTest() {
  console.log("▶ Testing Complete End-to-End Customer & Partner Flow...");

  // 1. Setup Test User / Customer
  let customer = await prisma.user.findFirst({ where: { email: "customer_flow_test@example.com" } });
  if (!customer) {
    customer = await prisma.user.create({
      data: {
        name: "Suman Sharma",
        firstName: "Suman",
        lastName: "Sharma",
        phone: "9841234567",
        email: "customer_flow_test@example.com",
        password: "password123",
      },
    });
  }

  // 2. Setup Test Partner
  let partner = await prisma.marketingPartner.findFirst({ where: { code: "STORE_PARTNER" } });
  if (!partner) {
    partner = await prisma.marketingPartner.create({
      data: {
        code: "STORE_PARTNER",
        name: "Store Partner Brand",
        status: "ACTIVE",
        email: "partner_store@example.com",
      },
    });
  }

  // 3. Setup Delivered Order with products
  const order = await prisma.order.create({
    data: {
      userId: customer.id,
      amount: 4500,
      deliveryFee: 100,
      status: "Delivered",
      fulfillmentStatus: "DELIVERED",
      paymentMethod: "COD",
      payment: true,
      date: BigInt(Date.now()),
      address: {
        firstName: "Suman",
        lastName: "Sharma",
        phone: "9841234567",
        city: "Kathmandu",
        street: "Putalisadak",
      },
      items: [
        { name: "Winter Puffer Jacket", size: "L", quantity: 1, price: 3500 },
        { name: "Cotton Crewneck T-Shirt", size: "M", quantity: 1, price: 1000 },
      ],
    },
  });

  // 4. Setup Manufacturer
  let manufacturer = await prisma.manufacturer.findFirst({ where: { isActive: true } });
  if (!manufacturer) {
    manufacturer = await prisma.manufacturer.create({
      data: {
        code: "MFG-TEST",
        name: "Kathmandu Hub Manufacturer",
        email: "mfg_test@example.com",
        city: "Kathmandu",
        province: "Bagmati",
      },
    });
  }

  // 5. Create Campaign with a 15% discount benefit (100% win for test)
  const campaign = await createCampaign({
    marketingPartnerId: partner.id,
    name: `Store Claim Campaign ${Date.now()}`,
    targetScopeType: "NATIONWIDE",
    requestedQuantity: 10,
    benefits: [
      {
        name: "15% In-Store Shopping Voucher",
        description: "15% off on total bill at partner store",
        benefitType: "DISCOUNT",
        value: 15,
        percentage: 100,
      },
    ],
  });

  // 6. Generate Batch & attach card to the delivered order
  const { batch, cards } = await generateBatch({
    campaignId: campaign.id,
    quantity: 1,
    actorId: "admin",
  });

  const cardObj = cards[0];

  await prisma.marketingCardOrder.create({
    data: {
      cardId: cardObj.id,
      orderId: order.id,
      manufacturerId: manufacturer.id,
    },
  });

  console.log(`✅ Order created and card ${cardObj.cardCode} attached (Delivered status).`);

  // ----------------------------------------------------
  // CUSTOMER FLOW TESTS
  // ----------------------------------------------------

  // Step 1: Customer enters card code
  const step1Result = await verifyCustomerCardCode({
    customerId: customer.id,
    cardCode: cardObj.cardCode,
  });
  assert.equal(step1Result.verified, true, "Step 1: Card code must be verified");
  assert.equal(step1Result.cardCode, cardObj.cardCode);
  console.log("✅ Step 1 passed: Customer entered card code and ownership/delivery was verified.");

  // Step 2: Customer scans physical QR code (matches card code)
  const step2Result = await verifyCustomerQr({
    customerId: customer.id,
    cardCode: cardObj.cardCode,
    token: cardObj.qrToken,
  });
  assert.equal(step2Result.success, true);
  assert.equal(step2Result.hasBenefit, true);
  assert.equal(step2Result.benefit.name, "15% In-Store Shopping Voucher");
  console.log("✅ Step 2 passed: QR token validated against card code, benefit revealed.");

  // Step 3: Customer activates card (cannot self-redeem)
  const activatedCard = await activateCustomerCard({
    customerId: customer.id,
    cardId: cardObj.id,
  });
  assert.equal(activatedCard.isActivated, true);
  assert.equal(activatedCard.status, "ACTIVE");
  console.log("✅ Step 3 passed: Card activated by customer for in-store redemption.");

  // ----------------------------------------------------
  // PARTNER IN-STORE CLAIM & REDEMPTION TESTS
  // ----------------------------------------------------

  // Partner scans card in store
  const partnerScan = await validatePartnerQr({
    partnerId: partner.id,
    cardCode: cardObj.cardCode,
  });

  assert.equal(partnerScan.valid, true);
  assert.equal(partnerScan.isActivated, true);
  assert.equal(partnerScan.customer.name, "Suman Sharma");
  assert.equal(partnerScan.customer.phone, "9841234567");
  assert.equal(partnerScan.order.products.length, 2, "Partner must see delivered order products");
  assert.equal(partnerScan.order.products[0].name, "Winter Puffer Jacket");
  console.log("✅ Partner scan verified: Customer details and ordered products retrieved accurately.");

  // Partner redeems the benefit in store
  const redeemResult = await redeemPartnerBenefit({
    partnerId: partner.id,
    cardCode: cardObj.cardCode,
    benefitId: partnerScan.benefits[0].id,
  });
  assert.equal(redeemResult.success, true);
  console.log("✅ Partner in-store benefit redemption confirmed.");

  // Re-scanning should show already redeemed
  const rescan = await validatePartnerQr({
    partnerId: partner.id,
    cardCode: cardObj.cardCode,
  });
  assert.equal(rescan.isRedeemed, true, "Card must reflect REDEEMED status");
  console.log("✅ Duplicate prevention verified: Card reflects already redeemed status.");

  // Test Partner Card Rejection (e.g. suspicious or fraud)
  const order2 = await prisma.order.create({
    data: {
      userId: customer.id,
      amount: 2000,
      deliveryFee: 100,
      status: "Delivered",
      fulfillmentStatus: "DELIVERED",
      paymentMethod: "COD",
      payment: true,
      date: BigInt(Date.now()),
      address: { firstName: "Suman", lastName: "Sharma", phone: "9841234567" },
      items: [{ name: "Cotton Scarf", size: "M", quantity: 1, price: 2000 }],
    },
  });

  const { cards: cards2 } = await generateBatch({
    campaignId: campaign.id,
    quantity: 1,
    actorId: "admin",
  });
  const card2 = cards2[0];
  await prisma.marketingCardOrder.create({
    data: { cardId: card2.id, orderId: order2.id, manufacturerId: manufacturer.id },
  });

  const rejectRes = await rejectPartnerCard({
    partnerId: partner.id,
    cardCode: card2.cardCode,
    reason: "Tampered physical QR code",
  });
  assert.equal(rejectRes.status, "REJECTED");

  const rejectScan = await validatePartnerQr({
    partnerId: partner.id,
    cardCode: card2.cardCode,
  });
  assert.equal(rejectScan.isRejected, true, "Card must reflect REJECTED status");
  console.log("✅ Partner card rejection & fraud flagging verified.");

  console.log("🎉 ALL END-TO-END CUSTOMER & PARTNER FLOW TESTS PASSED!");
}

runTest()
  .catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
