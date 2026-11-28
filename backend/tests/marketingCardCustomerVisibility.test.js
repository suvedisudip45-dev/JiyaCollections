import test from "node:test";
import assert from "node:assert/strict";
import {
  listClaimedCustomerRewards,
  listCustomerCards,
} from "../services/marketingCardCustomerService.js";

const makeLink = ({
  id,
  status = "ACTIVE",
  physicalStatus = "AVAILABLE",
  cardExpiresAt = null,
  benefitExpiresAt = null,
}) => ({
  id: `link-${id}`,
  status,
  linkedAt: new Date(),
  card: {
    id,
    cardCode: id,
    physicalStatus,
    hasBenefit: false,
    isPublic: true,
    benefit: benefitExpiresAt ? { expiresAt: benefitExpiresAt } : null,
    campaign: {
      id: "campaign",
      name: "Test campaign",
      status: "ACTIVE",
      cardExpiresAt,
    },
    events: [],
  },
});

test("customer card list hides cancelled and expired cards but keeps valid cards", async () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);
  const links = [
    makeLink({ id: "valid", cardExpiresAt: future }),
    makeLink({ id: "admin-cancelled", physicalStatus: "CANCELLED" }),
    makeLink({ id: "expired", cardExpiresAt: past }),
    makeLink({ id: "expired-benefit", benefitExpiresAt: past }),
    makeLink({ id: "customer-cancelled", status: "CANCELLED" }),
  ];
  const client = {
    marketingCardCustomer: {
      findMany: async () => links,
    },
  };

  const cards = await listCustomerCards("customer-id", client);

  assert.deepEqual(cards.map((card) => card.id), ["valid"]);
  assert.equal(cards[0].cardExpiresAt.toISOString(), future.toISOString());
});

test("claimed reward expiry uses the earlier benefit or card expiry", async () => {
  const benefitExpiry = new Date(Date.now() + 2 * 60_000);
  const cardExpiry = new Date(Date.now() + 60_000);
  const client = {
    marketingBenefitRedemption: {
      findMany: async () => [{
        id: "redemption",
        claimedAt: new Date(),
        benefit: {
          id: "benefit",
          name: "Test reward",
          status: "ACTIVE",
          benefitType: "DISCOUNT",
          value: 10,
          expiresAt: benefitExpiry,
        },
        card: {
          id: "card",
          cardCode: "CARD-1",
          isPublic: true,
          campaign: {
            id: "campaign",
            name: "Test campaign",
            isOwnStore: true,
            cardExpiresAt: cardExpiry,
          },
        },
      }],
    },
  };

  const [reward] = await listClaimedCustomerRewards("customer-id", client);

  assert.equal(reward.expiresAt.toISOString(), cardExpiry.toISOString());
});
