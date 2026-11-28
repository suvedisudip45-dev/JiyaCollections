import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STOREFRONT_CONTENT,
  getStorefrontContent,
  getTermsAndConditionsVersion,
  recordCustomerTermsAcceptance,
  updateStorefrontContent,
} from "../services/storefrontContentService.js";

test("storefront content uses defaults when no configuration exists", async () => {
  const client = {
    storefrontContentConfig: {
      findUnique: async () => null,
    },
  };

  const content = await getStorefrontContent(client);
  const { termsVersion, ...settings } = content;
  assert.deepEqual(settings, DEFAULT_STOREFRONT_CONTENT);
  assert.equal(termsVersion, getTermsAndConditionsVersion(DEFAULT_STOREFRONT_CONTENT.termsAndConditions));
});

test("storefront content update saves announcements and benefit cards", async () => {
  const content = {
    ...DEFAULT_STOREFRONT_CONTENT,
    announcementPrimary: "Free delivery",
    logoImage: "https://res.cloudinary.com/store/logo.png",
    footerDescription: "A shorter store description.",
    contactPhone: "+977 9800000000",
    contactEmail: "hello@example.com",
    aboutPage: {
      ...DEFAULT_STOREFRONT_CONTENT.aboutPage,
      description: " First paragraph.\n\nSecond paragraph. ",
      whyCards: DEFAULT_STOREFRONT_CONTENT.aboutPage.whyCards,
    },
    termsAndConditions: {
      ...DEFAULT_STOREFRONT_CONTENT.termsAndConditions,
      conditions: [
        { title: "First", description: "  First paragraph.\n\nSecond paragraph. " },
        { title: "Second", description: "Second condition." },
      ],
    },
    benefits: DEFAULT_STOREFRONT_CONTENT.benefits.map((benefit, index) => ({
      ...benefit,
      image: index === 0 ? "https://res.cloudinary.com/store/exchange.png" : "",
    })),
  };
  let saved;
  const client = {
    storefrontContentConfig: {
      upsert: async (input) => {
        saved = input;
        return input.create;
      },
    },
  };

  const result = await updateStorefrontContent(content, client);

  assert.equal(result.announcementPrimary, "Free delivery");
  assert.equal(result.logoImage, "https://res.cloudinary.com/store/logo.png");
  assert.equal(result.footerDescription, "A shorter store description.");
  assert.equal(result.contactPhone, "+977 9800000000");
  assert.equal(result.contactEmail, "hello@example.com");
  assert.equal(result.aboutPage.description, content.aboutPage.description);
  assert.deepEqual(result.termsAndConditions.conditions, content.termsAndConditions.conditions);
  assert.deepEqual(saved.update.termsAndConditions.conditions, content.termsAndConditions.conditions);
  assert.equal(result.benefits[0].image, content.benefits[0].image);
  assert.deepEqual(saved.update.benefits, content.benefits);
});

test("storefront logo must be an HTTPS URL or blank to use the bundled default", async () => {
  const client = {
    storefrontContentConfig: {
      upsert: async ({ create }) => create,
    },
  };
  assert.equal(
    (await updateStorefrontContent({ ...DEFAULT_STOREFRONT_CONTENT, logoImage: "" }, client)).logoImage,
    "",
  );
  await assert.rejects(
    updateStorefrontContent({ ...DEFAULT_STOREFRONT_CONTENT, logoImage: "http://example.com/logo.png" }, client),
    { code: "INVALID_STOREFRONT_CONTENT", status: 400 },
  );
});

test("storefront terms allow an empty list but reject more than 50 conditions", async () => {
  const client = {
    storefrontContentConfig: {
      upsert: async (input) => input.create,
    },
  };
  const noConditions = {
    ...DEFAULT_STOREFRONT_CONTENT,
    termsAndConditions: { ...DEFAULT_STOREFRONT_CONTENT.termsAndConditions, conditions: [] },
  };
  assert.deepEqual((await updateStorefrontContent(noConditions, client)).termsAndConditions.conditions, []);
  await assert.rejects(
    updateStorefrontContent({
      ...DEFAULT_STOREFRONT_CONTENT,
      termsAndConditions: {
        ...DEFAULT_STOREFRONT_CONTENT.termsAndConditions,
        conditions: Array.from({ length: 51 }, () => ({ title: "Condition", description: "Details" })),
      },
    }, client),
    { code: "INVALID_STOREFRONT_CONTENT", status: 400 }
  );
});

test("terms acceptance stores the authoritative snapshot, version, timestamp context, and source", async () => {
  const version = getTermsAndConditionsVersion(DEFAULT_STOREFRONT_CONTENT.termsAndConditions);
  let created;
  const client = {
    storefrontContentConfig: { findUnique: async () => null },
    customerTermsAcceptance: {
      create: async ({ data }) => {
        created = data;
        return { id: "acceptance-id", ...data, acceptedAt: new Date("2026-11-01T00:00:00.000Z") };
      },
    },
  };

  const acceptance = await recordCustomerTermsAcceptance({
    client,
    customerId: "customer-id",
    accepted: true,
    termsVersion: version,
    ipAddress: "127.0.0.1",
    userAgent: "test-browser",
    source: "SELF_SERVICE",
  });

  assert.equal(acceptance.acceptedAt.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(created.customerId, "customer-id");
  assert.equal(created.termsVersion, version);
  assert.deepEqual(created.termsSnapshot, DEFAULT_STOREFRONT_CONTENT.termsAndConditions);
  assert.equal(created.ipAddress, "127.0.0.1");
  assert.equal(created.userAgent, "test-browser");
  assert.equal(created.source, "SELF_SERVICE");
});

test("terms acceptance rejects unchecked and stale terms", async () => {
  const client = {
    storefrontContentConfig: { findUnique: async () => null },
    customerTermsAcceptance: { create: async () => assert.fail("Invalid acceptance must not be recorded.") },
  };
  await assert.rejects(recordCustomerTermsAcceptance({
    client,
    customerId: "customer-id",
    accepted: false,
    termsVersion: getTermsAndConditionsVersion(DEFAULT_STOREFRONT_CONTENT.termsAndConditions),
    source: "SELF_SERVICE",
  }), { code: "TERMS_ACCEPTANCE_REQUIRED", status: 400 });
  await assert.rejects(recordCustomerTermsAcceptance({
    client,
    customerId: "customer-id",
    accepted: true,
    termsVersion: "0".repeat(64),
    source: "SELF_SERVICE",
  }), { code: "TERMS_VERSION_CHANGED", status: 409 });
});

test("storefront content requires exactly three benefits and secure image URLs", async () => {
  await assert.rejects(
    updateStorefrontContent({ ...DEFAULT_STOREFRONT_CONTENT, benefits: [] }, { storefrontContentConfig: {} }),
    { code: "INVALID_STOREFRONT_CONTENT", status: 400 }
  );
  await assert.rejects(
    updateStorefrontContent({
      ...DEFAULT_STOREFRONT_CONTENT,
      benefits: DEFAULT_STOREFRONT_CONTENT.benefits.map((benefit, index) => (
        index === 0 ? { ...benefit, image: "http://example.com/image.png" } : benefit
      )),
    }, { storefrontContentConfig: {} }),
    { code: "INVALID_STOREFRONT_CONTENT", status: 400 }
  );
  await assert.rejects(
    updateStorefrontContent({
      ...DEFAULT_STOREFRONT_CONTENT,
      benefits: DEFAULT_STOREFRONT_CONTENT.benefits.map((benefit, index) => (
        index === 1 ? { ...benefit, title: " " } : benefit
      )),
    }, { storefrontContentConfig: {} }),
    { code: "INVALID_STOREFRONT_CONTENT", status: 400 }
  );
});
