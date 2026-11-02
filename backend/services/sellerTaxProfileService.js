import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { resolveVatRatePercent } from "./vatRateService.js";

const fail = (message, statusCode = 400, code = "SELLER_TAX_PROFILE_ERROR") =>
  Object.assign(new Error(message), { statusCode, code });

const inSerializableTransaction = (client, callback) =>
  typeof client.$transaction === "function"
    ? client.$transaction(callback, { isolationLevel: "Serializable" })
    : callback(client);

const normalizeText = (value, field, maxLength) => {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) {
    throw fail(`${field} must be ${maxLength} characters or fewer.`, 400, "INVALID_SELLER_TAX_PROFILE");
  }
  return text;
};

const parseFutureEffectiveFrom = (value, now) => {
  const effectiveFrom = new Date(value);
  if (!value || Number.isNaN(effectiveFrom.getTime()) || effectiveFrom <= now) {
    throw fail("A tax registration change must have a valid future effective date.", 400, "INVALID_TAX_EFFECTIVE_DATE");
  }
  return effectiveFrom;
};

export const getSellerTaxProfile = async ({ client = prisma } = {}) => {
  const [profile, registrations] = await Promise.all([
    client.sellerTaxProfile.findUnique({ where: { id: "default" } }),
    client.taxRegistrationVersion.findMany({ orderBy: { effectiveFrom: "desc" }, take: 100 }),
  ]);
  const currentRegistration = await resolveSellerTaxTreatment(new Date(), { client });
  return {
    profile: profile || { id: "default", legalName: "", panNumber: "", address: "" },
    registrations,
    currentRegistration: {
      taxStatus: currentRegistration.taxStatus,
      vatNumber: currentRegistration.vatNumber,
    },
  };
};

export const updateSellerTaxProfile = async ({
  legalName,
  panNumber,
  address,
  client = prisma,
  now = new Date(),
  afterUpdate = null,
} = {}) => {
  if (!client.sellerTaxProfile?.upsert) {
    throw fail("Seller tax profile storage is unavailable. Apply the pending Prisma migration first.", 503, "TAX_PROFILE_STORAGE_UNAVAILABLE");
  }
  return inSerializableTransaction(client, async (tx) => {
    const current = await tx.sellerTaxProfile.findUnique?.({ where: { id: "default" } });
    const data = {
      legalName: normalizeText(legalName === undefined ? current?.legalName : legalName, "Legal name", 255),
      panNumber: normalizeText(panNumber === undefined ? current?.panNumber : panNumber, "PAN number", 32),
      address: normalizeText(address === undefined ? current?.address : address, "Address", 5000),
    };
    if (!data.panNumber && tx.taxRegistrationVersion?.findFirst) {
      const activeVatRegistration = await tx.taxRegistrationVersion.findFirst({
        where: {
          status: "ACTIVE",
          taxStatus: "VAT_REGISTERED",
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
        },
      });
      if (activeVatRegistration) {
        throw fail("The seller PAN cannot be cleared while a VAT registration is effective or scheduled.", 409, "SELLER_PAN_REQUIRED");
      }
    }
    const profile = await tx.sellerTaxProfile.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    });
    if (afterUpdate) await afterUpdate(profile, tx);
    return profile;
  });
};

export const listTaxRegistrationVersions = async ({ client = prisma } = {}) => {
  if (!client.taxRegistrationVersion?.findMany) {
    throw fail("Tax registration history storage is unavailable. Apply the pending Prisma migration first.", 503, "TAX_REGISTRATION_STORAGE_UNAVAILABLE");
  }
  return client.taxRegistrationVersion.findMany({
    orderBy: { effectiveFrom: "desc" },
    take: 100,
  });
};

export const scheduleTaxRegistrationVersion = async ({
  taxStatus,
  vatNumber,
  effectiveFrom,
  createdBy = null,
  client = prisma,
  now = new Date(),
  afterCreate = null,
} = {}) => {
  const normalizedStatus = String(taxStatus ?? "").trim().toUpperCase();
  if (!["PAN_ONLY", "VAT_REGISTERED"].includes(normalizedStatus)) {
    throw fail("Tax registration status must be PAN_ONLY or VAT_REGISTERED.", 400, "INVALID_TAX_REGISTRATION_STATUS");
  }
  const normalizedVatNumber = normalizeText(vatNumber, "VAT registration number", 32);
  if (normalizedStatus === "VAT_REGISTERED" && !normalizedVatNumber) {
    throw fail("A VAT registration number is required to schedule VAT registration.", 400, "VAT_NUMBER_REQUIRED");
  }
  if (normalizedStatus === "VAT_REGISTERED" && client.sellerTaxProfile?.findUnique) {
    const profile = await client.sellerTaxProfile.findUnique({ where: { id: "default" } });
    if (!profile?.panNumber) {
      throw fail("Save the business PAN before scheduling VAT registration.", 400, "SELLER_PAN_REQUIRED");
    }
  }
  const startsAt = parseFutureEffectiveFrom(effectiveFrom, now);
  if (!client.taxRegistrationVersion?.findFirst || !client.taxRegistrationVersion?.create) {
    throw fail("Tax registration history storage is unavailable. Apply the pending Prisma migration first.", 503, "TAX_REGISTRATION_STORAGE_UNAVAILABLE");
  }

  try {
    return await inSerializableTransaction(client, async (tx) => {
      const latest = await tx.taxRegistrationVersion.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { effectiveFrom: "desc" },
      });
      if (latest && startsAt <= latest.effectiveFrom) {
        throw fail("Tax registration changes must be scheduled after the latest active version.", 409, "TAX_REGISTRATION_VERSION_ORDER_CONFLICT");
      }
      if (latest && !latest.effectiveUntil) {
        const closed = await tx.taxRegistrationVersion.updateMany({
          where: { id: latest.id, status: "ACTIVE", effectiveUntil: null },
          data: { effectiveUntil: startsAt },
        });
        if (closed.count !== 1) {
          throw fail("Tax registration changed concurrently. Refresh and retry.", 409, "TAX_REGISTRATION_CONCURRENCY_CONFLICT");
        }
      }
      const version = await tx.taxRegistrationVersion.create({
        data: {
          id: randomUUID(),
          taxStatus: normalizedStatus,
          vatNumber: normalizedStatus === "VAT_REGISTERED" ? normalizedVatNumber : null,
          effectiveFrom: startsAt,
          createdBy: createdBy ? String(createdBy).slice(0, 191) : null,
          status: "ACTIVE",
        },
      });
      if (afterCreate) await afterCreate(version, tx);
      return version;
    });
  } catch (error) {
    if (error?.code === "P2002" || error?.code === "P2034") {
      throw fail("Tax registration changed concurrently. Refresh and retry.", 409, "TAX_REGISTRATION_CONCURRENCY_CONFLICT");
    }
    throw error;
  }
};

export const cancelFutureTaxRegistrationVersion = async ({
  id,
  client = prisma,
  now = new Date(),
  afterCancel = null,
} = {}) => {
  if (typeof id !== "string" || !id.trim()) {
    throw fail("A tax registration version ID is required.", 400, "TAX_REGISTRATION_VERSION_REQUIRED");
  }
  return inSerializableTransaction(client, async (tx) => {
    const version = await tx.taxRegistrationVersion.findUnique({ where: { id: id.trim() } });
    if (!version || version.status !== "ACTIVE") {
      throw fail("Active tax registration version not found.", 404, "TAX_REGISTRATION_VERSION_NOT_FOUND");
    }
    if (version.effectiveFrom <= now) {
      throw fail("An effective or historical tax registration cannot be cancelled.", 409, "TAX_REGISTRATION_VERSION_IMMUTABLE");
    }
    const latest = await tx.taxRegistrationVersion.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { effectiveFrom: "desc" },
    });
    if (latest?.id !== version.id) {
      throw fail("Only the latest scheduled tax registration can be cancelled.", 409, "TAX_REGISTRATION_VERSION_ORDER_CONFLICT");
    }
    const cancelled = await tx.taxRegistrationVersion.updateMany({
      where: { id: version.id, status: "ACTIVE", effectiveFrom: { gt: now } },
      data: { status: "CANCELLED" },
    });
    if (cancelled.count !== 1) {
      throw fail("Tax registration changed concurrently. Refresh and retry.", 409, "TAX_REGISTRATION_CONCURRENCY_CONFLICT");
    }
    const previous = await tx.taxRegistrationVersion.findFirst({
      where: { status: "ACTIVE", effectiveFrom: { lt: version.effectiveFrom } },
      orderBy: { effectiveFrom: "desc" },
    });
    if (previous) {
      await tx.taxRegistrationVersion.updateMany({
        where: { id: previous.id, status: "ACTIVE", effectiveUntil: version.effectiveFrom },
        data: { effectiveUntil: null },
      });
    }
    const result = { ...version, status: "CANCELLED" };
    if (afterCancel) await afterCancel(result, tx);
    return result;
  });
};

export const resolveOrderTaxPoint = async (order, { client = prisma } = {}) => {
  let deliveredAt = order?.deliveredAt || null;
  if (!deliveredAt && client.deliveryOrder?.findUnique && order?.id) {
    const delivery = await client.deliveryOrder.findUnique({
      where: { orderId: order.id },
      select: { deliveredAt: true },
    });
    deliveredAt = delivery?.deliveredAt || null;
  }
  if (!deliveredAt && client.orderAssignment?.findUnique && order?.id) {
    const assignment = await client.orderAssignment.findUnique({
      where: { orderId: order.id },
      select: { deliveredAt: true },
    });
    deliveredAt = assignment?.deliveredAt || null;
  }
  const value = deliveredAt || order?.date || new Date();
  return value instanceof Date
    ? value
    : new Date(typeof value === "bigint" ? Number(value) : value);
};

export const resolveSellerTaxTreatment = async (transactionDate, { client = prisma } = {}) => {
  const effectiveAt = transactionDate instanceof Date
    ? transactionDate
    : new Date(typeof transactionDate === "bigint" ? Number(transactionDate) : (transactionDate ?? Date.now()));
  if (Number.isNaN(effectiveAt.getTime())) {
    throw fail("Transaction date is invalid for tax registration resolution.", 409, "INVALID_TAX_TRANSACTION_DATE");
  }
  const version = client.taxRegistrationVersion?.findFirst
    ? await client.taxRegistrationVersion.findFirst({
      where: {
        status: "ACTIVE",
        effectiveFrom: { lte: effectiveAt },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: effectiveAt } }],
      },
      orderBy: { effectiveFrom: "desc" },
    })
    : null;
  const profile = client.sellerTaxProfile?.findUnique
    ? await client.sellerTaxProfile.findUnique({ where: { id: "default" } })
    : null;
  const taxStatus = version?.taxStatus === "VAT_REGISTERED" ? "VAT_REGISTERED" : "PAN_ONLY";
  const vatRate = taxStatus === "VAT_REGISTERED"
    ? await resolveVatRatePercent(effectiveAt, { client })
    : null;
  return {
    taxStatus,
    vatNumber: taxStatus === "VAT_REGISTERED" ? version?.vatNumber || null : null,
    legalName: profile?.legalName || "",
    panNumber: profile?.panNumber || "",
    address: profile?.address || "",
    vatRate,
    taxTreatment: taxStatus === "VAT_REGISTERED" ? "STANDARD_RATED" : "NON_VAT",
  };
};

export const resolveOutputVatRatePercent = async (transactionDate, options = {}) => {
  const treatment = await resolveSellerTaxTreatment(transactionDate, options);
  return treatment.vatRate ?? new Prisma.Decimal(0);
};
