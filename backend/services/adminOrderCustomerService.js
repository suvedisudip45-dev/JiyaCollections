import { prisma } from "../config/db.js";
import {
  generateSocialCustomerCode,
  normalizePhoneNumber,
} from "../utils/socialCustomerProfile.js";

const parseJson = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const phoneVariantsFor = (phone) => {
  const normalizedPhone = normalizePhoneNumber(phone);
  return normalizedPhone
    ? [normalizedPhone, `977${normalizedPhone}`, `+977${normalizedPhone}`]
    : [];
};

const getLatestOrderForPhone = async (phoneVariants, userId = null) => {
  const orders = await prisma.order.findMany({
    where: userId ? { userId } : undefined,
    select: { id: true, userId: true, address: true, date: true, status: true, orderType: true },
    orderBy: { date: "desc" },
  });

  return orders.find((order) => {
    const address = parseJson(order.address);
    return phoneVariants.includes(String(address.phone || "").trim());
  }) || null;
};

const ensureCustomerCode = async (user) => {
  if (user.socialCustomerCode) return user;

  let code = generateSocialCustomerCode();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await prisma.user.update({
        where: { id: user.id },
        data: {
          socialCustomerCode: code,
          socialCustomerPhone: user.socialCustomerPhone || user.phone || "",
        },
      });
    } catch (error) {
      if (error.code !== "P2002") throw error;
      code = generateSocialCustomerCode();
    }
  }

  throw new Error("Unable to provision the customer social code");
};

const buildCustomerSnapshot = (user, latestOrder) => {
  const accountAddress = parseJson(user?.addresses, []);
  const previousAddress = parseJson(latestOrder?.address, {});
  const address = Array.isArray(accountAddress) && accountAddress.length > 0
    ? accountAddress[0]
    : previousAddress;

  return {
    id: user?.id || null,
    firstName: user?.firstName || previousAddress.firstName || "",
    lastName: user?.lastName || previousAddress.lastName || "",
    name: user?.name || `${user?.firstName || previousAddress.firstName || ""} ${user?.lastName || previousAddress.lastName || ""}`.trim(),
    email: user?.email || previousAddress.email || "",
    phone: user?.phone || user?.socialCustomerPhone || previousAddress.phone || "",
    gender: user?.gender || previousAddress.gender || "PREFER_NOT_TO_SAY",
    isInactiveProfile: Boolean(user?.isInactiveProfile),
    hasAccount: Boolean(user),
    address: {
      firstName: user?.firstName || previousAddress.firstName || "",
      lastName: user?.lastName || previousAddress.lastName || "",
      phone: user?.phone || user?.socialCustomerPhone || previousAddress.phone || "",
      email: user?.email || previousAddress.email || "",
      gender: user?.gender || previousAddress.gender || "PREFER_NOT_TO_SAY",
      province: address.province || previousAddress.province || address.state || "Bagmati Province",
      district: address.district || previousAddress.district || address.city || "Kathmandu",
      city: address.city || previousAddress.city || "Kathmandu",
      ncmBranch: address.ncmBranch || previousAddress.ncmBranch || address.city || previousAddress.city || "Kathmandu",
      state: address.state || previousAddress.state || address.province || previousAddress.province || "Bagmati Province",
      zipcode: address.zipcode || previousAddress.zipcode || "44600",
      country: address.country || previousAddress.country || "Nepal",
      street: address.street || previousAddress.street || "",
      landmark: address.landmark || previousAddress.landmark || "",
    },
    previousOrderId: latestOrder?.id || null,
  };
};

export const findAdminOrderCustomer = async (phone) => {
  const normalizedPhone = normalizePhoneNumber(phone);
  const phoneVariants = phoneVariantsFor(normalizedPhone);
  if (!normalizedPhone || phoneVariants.length === 0) {
    return { state: "INVALID_PHONE", normalizedPhone: "", customer: null };
  }

  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { phone: { in: phoneVariants } },
        { socialCustomerPhone: { in: phoneVariants } },
      ],
    },
  });

  const latestOrder = await getLatestOrderForPhone(phoneVariants, user?.id || null);
  if (!user && latestOrder?.userId && latestOrder.userId !== "admin_social_client") {
    user = await prisma.user.findUnique({ where: { id: latestOrder.userId } });
  }

  if (!user && !latestOrder) {
    return { state: "NEW_CUSTOMER", normalizedPhone, customer: null };
  }

  if (user && !user.socialCustomerCode) {
    user = await ensureCustomerCode(user);
  }

  return {
    state: "CODE_REQUIRED",
    normalizedPhone,
    customer: buildCustomerSnapshot(user, latestOrder),
    socialCustomerCode: user?.socialCustomerCode || null,
    userId: user?.id || null,
  };
};

export const verifyAdminOrderCustomer = async (phone, code) => {
  const result = await findAdminOrderCustomer(phone);
  if (result.state !== "CODE_REQUIRED") return result;

  const suppliedCode = String(code || "").trim().toUpperCase();
  const verified = Boolean(result.socialCustomerCode)
    && suppliedCode === String(result.socialCustomerCode).trim().toUpperCase();

  return {
    ...result,
    state: verified ? "VERIFIED" : "UNVERIFIED",
    verified,
    loyaltyEligible: verified,
    giftEligible: verified,
    userId: verified ? result.userId : null,
  };
};

export const getAdminOrderCustomerForCreation = async (phone, code = "") => {
  const result = code
    ? await verifyAdminOrderCustomer(phone, code)
    : await findAdminOrderCustomer(phone);

  return {
    ...result,
    loyaltyEligible: result.state === "NEW_CUSTOMER" || result.state === "VERIFIED",
    giftEligible: result.state === "NEW_CUSTOMER" || result.state === "VERIFIED",
    userId: result.state === "VERIFIED" ? result.userId : null,
  };
};

export { normalizePhoneNumber };
