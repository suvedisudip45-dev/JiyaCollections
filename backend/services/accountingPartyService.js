import { prisma } from "../config/db.js";

const PARTY_TYPES = new Set([
  "CUSTOMER",
  "MANUFACTURER",
  "MARKETING_PARTNER",
  "CARRIER",
  "VENDOR",
  "PAYMENT_PROVIDER",
  "OTHER",
]);

export const ensureAccountingParty = async ({
  partyType,
  sourceEntityId,
  displayName,
  legalName = null,
  currency = "NPR",
}, { client = prisma } = {}) => {
  const normalizedType = String(partyType || "").trim().toUpperCase();
  const sourceId = String(sourceEntityId || "").trim();
  const name = String(displayName || "").trim();
  const normalizedCurrency = String(currency || "").trim().toUpperCase();

  if (!PARTY_TYPES.has(normalizedType)) throw new Error("Unsupported accounting party type.");
  if (!sourceId) throw new Error("Accounting party source entity ID is required.");
  if (!name) throw new Error("Accounting party display name is required.");
  if (normalizedCurrency !== "NPR") throw new Error("Only NPR accounting parties are enabled in this implementation phase.");

  return client.accountingParty.upsert({
    where: {
      partyType_sourceEntityId: {
        partyType: normalizedType,
        sourceEntityId: sourceId,
      },
    },
    update: {
      displayName: name,
      legalName: legalName ? String(legalName).trim() : null,
    },
    create: {
      partyType: normalizedType,
      sourceEntityId: sourceId,
      displayName: name,
      legalName: legalName ? String(legalName).trim() : null,
      currency: normalizedCurrency,
      status: "ACTIVE",
    },
  });
};