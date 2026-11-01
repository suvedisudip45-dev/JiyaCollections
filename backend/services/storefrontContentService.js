import { createHash } from "node:crypto";
import { prisma } from "../config/db.js";

export const DEFAULT_STOREFRONT_CONTENT = Object.freeze({
  announcementPrimary: "Free shipping on orders over Rs 3,000",
  announcementSecondary: "Made for everyday movement",
  footerDescription: "At Aama Collections, we redefine everyday fashion with a focus on refined structure, confident silhouettes, and long-wearing essentials. Each piece is designed to move seamlessly from daily life to elevated moments, helping you feel polished, comfortable, and effortlessly styled.",
  contactPhone: "+1-8515-56789",
  contactEmail: "contact@aamacollections.com",
  aboutPage: {
    image: "",
    title: "About Us",
    description: "Aama Collections was born out of a passion for innovation and a desire to revolutionize the way people shop online. Our journey began with a simple idea: to provide a platform where customers can easily discover, explore, and purchase a wide range of products from the comfort of their homes.\n\nSince our inception, we've worked tirelessly to curate a diverse selection of high-quality products that cater to every taste and preference. From fashion and beauty to home essentials, we offer an extensive collection sourced from trusted brands and suppliers.",
    missionTitle: "Our Mission",
    missionDescription: "Our mission at Aama Collections is to empower customers with choice, convenience, and confidence. We're dedicated to providing a seamless shopping experience that exceeds expectations, from browsing and ordering to delivery and beyond.",
    whyTitle: "Why Choose Us",
    whyCards: [
      {
        title: "Quality Assurance:",
        description: "We meticulously select and vet each product to ensure it meets our stringent quality standards.",
      },
      {
        title: "Convenience:",
        description: "With our user-friendly interface and hassle-free ordering process, shopping has never been easier.",
      },
      {
        title: "Exceptional Customer Service:",
        description: "Our team of dedicated professionals is here to assist you, ensuring your satisfaction is our top priority.",
      },
    ],
  },
  termsAndConditions: {
    title: "Terms & Conditions",
    subtitle: "Aama Clothings — Customer Agreement & Policies",
    notice: "By creating an account, browsing our store, or placing an order on Aama Clothings, you agree to be bound by the terms, conditions, and policies set forth below.",
    conditions: [
      {
        title: "Account Registration & User Security",
        description: "When registering for an account, you agree to provide accurate, current, and complete information (including your legal first name, last name, email address, and mobile phone number). You are solely responsible for safeguarding your login credentials and for all activities that occur under your account.",
      },
      {
        title: "Products, Pricing & Stock Availability",
        description: "We make every effort to display the colors, fabrics, and sizes of our products accurately. Prices and stock availability are subject to change without prior notice. Products in your cart are not reserved until checkout is completed.",
      },
      {
        title: "Ordering, Checkout & Payment",
        description: "When placing an order via Cash on Delivery (COD) or other electronic payment methods, you enter into a binding purchase contract. We reserve the right to cancel any order in the event of suspected fraudulent activity, stock discrepancies, or delivery restrictions.",
      },
      {
        title: "Returns, Exchanges & 7-Day Guarantee",
        description: "Items may be returned or exchanged within 7 days of delivery, provided they remain unworn, unwashed, with all original tags and packaging intact. Discounted clearance items may have specific return limitations as described at the time of purchase.",
      },
      {
        title: "Verified Customer Reviews & Community Conduct",
        description: "Customer reviews may only be submitted by verified purchasers who have ordered the item. Reviews must remain respectful, factual, and free from abusive language, spam, or promotional material. Store administrators reserve full rights to moderate, approve, or remove inappropriate reviews.",
      },
      {
        title: "Privacy & Data Protection",
        description: "Your personal data, contact information, and purchase history are securely handled and will never be sold to third parties. We use your contact details solely for order processing, delivery updates, and customer support.",
      },
    ],
  },
  benefits: [
    {
      image: "",
      title: "Easy Exchange Policy",
      description: "We offer hassle free exchange policy",
    },
    {
      image: "",
      title: "7 Days Return Policy",
      description: "We provide 7 days free return policy",
    },
    {
      image: "",
      title: "Best customer support",
      description: "We provide 24/7 customer support",
    },
  ],
});

const normalizeContent = (config) => ({
  announcementPrimary: config?.announcementPrimary ?? DEFAULT_STOREFRONT_CONTENT.announcementPrimary,
  announcementSecondary: config?.announcementSecondary ?? DEFAULT_STOREFRONT_CONTENT.announcementSecondary,
  footerDescription: config?.footerDescription ?? DEFAULT_STOREFRONT_CONTENT.footerDescription,
  contactPhone: config?.contactPhone ?? DEFAULT_STOREFRONT_CONTENT.contactPhone,
  contactEmail: config?.contactEmail ?? DEFAULT_STOREFRONT_CONTENT.contactEmail,
  aboutPage: config?.aboutPage && typeof config.aboutPage === "object"
    ? { ...DEFAULT_STOREFRONT_CONTENT.aboutPage, ...config.aboutPage }
    : DEFAULT_STOREFRONT_CONTENT.aboutPage,
  termsAndConditions: config?.termsAndConditions && typeof config.termsAndConditions === "object"
    ? { ...DEFAULT_STOREFRONT_CONTENT.termsAndConditions, ...config.termsAndConditions }
    : DEFAULT_STOREFRONT_CONTENT.termsAndConditions,
  benefits: Array.isArray(config?.benefits) && config.benefits.length === 3
    ? config.benefits
    : DEFAULT_STOREFRONT_CONTENT.benefits,
});

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
};

export const getTermsAndConditionsVersion = (terms) => createHash("sha256")
  .update(JSON.stringify(canonicalize(terms)))
  .digest("hex");

export const getStorefrontContent = async (client = prisma) => {
  const config = await client.storefrontContentConfig.findUnique({
    where: { id: "default" },
    select: {
      announcementPrimary: true,
      announcementSecondary: true,
      footerDescription: true,
      contactPhone: true,
      contactEmail: true,
      benefits: true,
      aboutPage: true,
      termsAndConditions: true,
    },
  });
  const content = normalizeContent(config);
  return {
    ...content,
    termsVersion: getTermsAndConditionsVersion(content.termsAndConditions),
  };
};

export const recordCustomerTermsAcceptance = async ({
  client = prisma,
  customerId,
  accepted,
  termsVersion,
  ipAddress,
  userAgent,
  source,
}) => {
  if (accepted !== true || typeof termsVersion !== "string" || !/^[a-f0-9]{64}$/i.test(termsVersion)) {
    const error = new Error("You must accept the current Terms & Conditions to continue.");
    error.status = 400;
    error.code = "TERMS_ACCEPTANCE_REQUIRED";
    throw error;
  }
  if (!["SELF_SERVICE", "SOCIAL_PROFILE_ACTIVATION"].includes(source)) {
    const error = new Error("Terms & Conditions acceptance source is invalid.");
    error.status = 400;
    error.code = "INVALID_TERMS_ACCEPTANCE_SOURCE";
    throw error;
  }

  const config = await client.storefrontContentConfig.findUnique({
    where: { id: "default" },
    select: { termsAndConditions: true },
  });
  const termsSnapshot = normalizeTermsAndConditions(
    config?.termsAndConditions ?? DEFAULT_STOREFRONT_CONTENT.termsAndConditions
  );
  const currentVersion = getTermsAndConditionsVersion(termsSnapshot);
  if (termsVersion.toLowerCase() !== currentVersion) {
    const error = new Error("The Terms & Conditions have changed. Please review and accept the current version.");
    error.status = 409;
    error.code = "TERMS_VERSION_CHANGED";
    throw error;
  }

  return client.customerTermsAcceptance.create({
    data: {
      customerId,
      termsVersion: currentVersion,
      termsSnapshot,
      ipAddress: typeof ipAddress === "string" ? ipAddress.slice(0, 64) : null,
      userAgent: typeof userAgent === "string" ? userAgent.slice(0, 512) : null,
      source,
    },
  });
};

const requireText = (value, label, maxLength, allowBlank = true, preserveWhitespace = false) => {
  if (typeof value !== "string" || value.length > maxLength) {
    const error = new Error(`${label} must be a text value no longer than ${maxLength} characters.`);
    error.status = 400;
    error.code = "INVALID_STOREFRONT_CONTENT";
    throw error;
  }
  const normalized = value.trim();
  if (!allowBlank && !normalized) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    error.code = "INVALID_STOREFRONT_CONTENT";
    throw error;
  }
  return preserveWhitespace ? value : normalized;
};

export const updateStorefrontContent = async (content, client = prisma) => {
  if (!content || typeof content !== "object" || !Array.isArray(content.benefits) || content.benefits.length !== 3) {
    const error = new Error("Storefront content must include exactly three benefit cards.");
    error.status = 400;
    error.code = "INVALID_STOREFRONT_CONTENT";
    throw error;
  }

  const data = {
    announcementPrimary: requireText(content.announcementPrimary, "Primary announcement", 180),
    announcementSecondary: requireText(content.announcementSecondary, "Secondary announcement", 180),
    footerDescription: requireText(content.footerDescription, "Footer description", 5000, false, true),
    contactPhone: requireText(content.contactPhone, "Contact phone", 80),
    contactEmail: requireText(content.contactEmail, "Contact email", 254),
    aboutPage: normalizeAboutPage(content.aboutPage),
    termsAndConditions: normalizeTermsAndConditions(content.termsAndConditions),
    benefits: content.benefits.map((benefit, index) => {
      if (!benefit || typeof benefit !== "object") {
        const error = new Error(`Benefit card ${index + 1} is invalid.`);
        error.status = 400;
        error.code = "INVALID_STOREFRONT_CONTENT";
        throw error;
      }
      const image = requireText(benefit.image ?? "", `Benefit card ${index + 1} image`, 2048);
      if (image && !/^https:\/\//i.test(image)) {
        const error = new Error(`Benefit card ${index + 1} image must use a secure URL.`);
        error.status = 400;
        error.code = "INVALID_STOREFRONT_CONTENT";
        throw error;
      }
      return {
        image,
        title: requireText(benefit.title, `Benefit card ${index + 1} title`, 80, false),
        description: requireText(benefit.description, `Benefit card ${index + 1} description`, 240, false),
      };
    }),
  };
  if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) {
    const error = new Error("Contact email must be a valid email address.");
    error.status = 400;
    error.code = "INVALID_STOREFRONT_CONTENT";
    throw error;
  }

  const saved = await client.storefrontContentConfig.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: data,
    select: {
      announcementPrimary: true,
      announcementSecondary: true,
      footerDescription: true,
      contactPhone: true,
      contactEmail: true,
      benefits: true,
      aboutPage: true,
      termsAndConditions: true,
    },
  });
  return normalizeContent(saved);
};

const normalizeTermsAndConditions = (terms) => {
  if (!terms || typeof terms !== "object" || !Array.isArray(terms.conditions) || terms.conditions.length > 50) {
    const error = new Error("Terms & Conditions must contain a list of no more than 50 conditions.");
    error.status = 400;
    error.code = "INVALID_STOREFRONT_CONTENT";
    throw error;
  }

  return {
    title: requireText(terms.title, "Terms & Conditions title", 120, false),
    subtitle: requireText(terms.subtitle, "Terms & Conditions subtitle", 240),
    notice: requireText(terms.notice, "Terms & Conditions notice", 2000),
    conditions: terms.conditions.map((condition, index) => {
      if (!condition || typeof condition !== "object") {
        const error = new Error(`Terms & Conditions item ${index + 1} is invalid.`);
        error.status = 400;
        error.code = "INVALID_STOREFRONT_CONTENT";
        throw error;
      }
      return {
        title: requireText(condition.title, `Terms & Conditions item ${index + 1} title`, 180, false),
        description: requireText(condition.description, `Terms & Conditions item ${index + 1} description`, 10000, false, true),
      };
    }),
  };
};

const normalizeAboutPage = (aboutPage) => {
  const defaults = DEFAULT_STOREFRONT_CONTENT.aboutPage;
  if (!aboutPage || typeof aboutPage !== "object" || !Array.isArray(aboutPage.whyCards) || aboutPage.whyCards.length !== 3) {
    const error = new Error("About page content must include exactly three Why Choose Us cards.");
    error.status = 400;
    error.code = "INVALID_STOREFRONT_CONTENT";
    throw error;
  }

  const image = requireText(aboutPage.image ?? "", "About page image", 2048);
  if (image && !/^https:\/\//i.test(image)) {
    const error = new Error("About page image must use a secure URL.");
    error.status = 400;
    error.code = "INVALID_STOREFRONT_CONTENT";
    throw error;
  }

  return {
    image,
    title: requireText(aboutPage.title, "About page title", 100, false),
    description: requireText(aboutPage.description, "About page description", 10000, false, true),
    missionTitle: requireText(aboutPage.missionTitle, "Mission title", 100, false),
    missionDescription: requireText(aboutPage.missionDescription, "Mission description", 5000, false, true),
    whyTitle: requireText(aboutPage.whyTitle, "Why Choose Us title", 100, false),
    whyCards: aboutPage.whyCards.map((card, index) => {
      if (!card || typeof card !== "object") {
        const error = new Error(`Why Choose Us card ${index + 1} is invalid.`);
        error.status = 400;
        error.code = "INVALID_STOREFRONT_CONTENT";
        throw error;
      }
      return {
        title: requireText(card.title, `Why Choose Us card ${index + 1} title`, 100, false),
        description: requireText(card.description, `Why Choose Us card ${index + 1} description`, 2000, false, true),
      };
    }),
  };
};
