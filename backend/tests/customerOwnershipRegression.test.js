import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../config/db.js";
import { createCampaign, generateBatch } from "../services/marketingCardService.js";
import {
  verifyCustomerCardCode,
  listCustomerCards,
  activateCustomerCard,
} from "../services/marketingCardCustomerService.js";

const createCustomer = async ({ email, name, phone }) => prisma.user.upsert({
  where: { email },
  update: {},
  create: { name, email, phone, password: "test-password" },
});

const createPartner = async ({ code, email, name }) => prisma.marketingPartner.upsert({
  where: { code },
  update: {},
  create: {
    code,
    email,
    name,
    status: "ACTIVE",
  },
});

const createManufacturer = async ({ name, email }) => {
  const existing = await prisma.manufacturer.findFirst({ where: { email } });
  if (existing) return existing;
  return prisma.manufacturer.create({
    data: {
      name,
      email,
      phone: "9800000003",
      city: "Kathmandu",
      isActive: true,
      isAvailable: true,
      commissionStatus: "PENDING",
    },
  });
};

test("customer cannot verify or activate another customer's delivered marketing card", async () => {
  const customerA = await createCustomer({ email: "customer_ownership_a@example.com", name: "Customer A", phone: "9800000001" });
  const customerB = await createCustomer({ email: "customer_ownership_b@example.com", name: "Customer B", phone: "9800000002" });
  const partner = await createPartner({ code: "OWNERSHIP_TEST_PARTNER", email: "ownership_test_partner@example.com", name: "Ownership Test Partner" });
  const manufacturer = await createManufacturer({ name: "Ownership Test MFG", email: "ownership_test_mfg@example.com" });

  const order = await prisma.order.create({
    data: {
      userId: customerA.id,
      amount: 2500,
      deliveryFee: 100,
      status: "Delivered",
      fulfillmentStatus: "DELIVERED",
      paymentMethod: "COD",
      payment: true,
      date: BigInt(Date.now()),
      address: {
        firstName: "Customer",
        lastName: "A",
        phone: "9800000001",
        city: "Kathmandu",
        street: "Test Street",
      },
      items: [{ name: "T-shirt", size: "M", quantity: 1, price: 2500 }],
    },
  });

  const campaign = await createCampaign({
    marketingPartnerId: partner.id,
    name: `Ownership Test Campaign ${Date.now()}`,
    targetScopeType: "NATIONWIDE",
    requestedQuantity: 1,
    benefits: [{
      name: "Test Partner Reward",
      description: "Reward on a valid delivered order",
      benefitType: "DISCOUNT",
      value: 10,
      percentage: 100,
    }],
  });

  const { cards } = await generateBatch({
    campaignId: campaign.id,
    quantity: 1,
    actorId: "test-user",
  });

  const card = cards[0];

  await prisma.marketingCardOrder.create({
    data: {
      cardId: card.id,
      orderId: order.id,
      manufacturerId: manufacturer.id,
    },
  });

  await assert.rejects(
    () => verifyCustomerCardCode({ customerId: customerB.id, cardCode: card.cardCode }),
    (error) => {
      assert.equal(error.code, "MARKETING_CARD_FORBIDDEN");
      assert.match(error.message, /different customer/i);
      return true;
    }
  );

  const cardsForB = await listCustomerCards(customerB.id);
  assert.equal(cardsForB.some((entry) => entry.cardCode === card.cardCode), false);

  await assert.rejects(
    () => activateCustomerCard({ customerId: customerB.id, cardId: card.id }),
    (error) => {
      assert.match(error.message, /verify|scan|card must be verified/i);
      return true;
    }
  );
});
