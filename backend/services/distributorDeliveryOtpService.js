import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { createNotificationInTransaction } from "../notifications/notificationService.js";
import { loadNotificationConfig } from "../notifications/config.js";
import { encryptNotificationText } from "../utils/secureNotificationPayload.js";
import { generateSecureOtp, loadOtpConfig } from "./otpService.js";

const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;

const fail = (message, statusCode = 400, code = "DELIVERY_OTP_ERROR") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const parseAddress = (address) => {
  if (!address) return {};
  if (typeof address === "object") return address;
  try {
    return JSON.parse(address);
  } catch {
    return {};
  }
};

export const formatCollectionAmount = (order) => {
  const amount = Number(order.amount);
  const deliveryFee = Number(order.deliveryFee || 0);
  if (!Number.isFinite(amount) || !Number.isFinite(deliveryFee) || amount < 0 || deliveryFee < 0) {
    throw fail("The order collection amount is invalid.", 409, "INVALID_COLLECTION_AMOUNT");
  }
  return (Math.round(amount * 100) / 100).toFixed(2);
};

const normalizeAmount = (amount) => Number(amount).toFixed(2);

const buildCodeHash = ({ code, orderId, distributorId, collectionAmount, secret }) => crypto
  .createHmac("sha256", secret)
  .update(`${orderId}|${distributorId}|${collectionAmount}|${code}`, "utf8")
  .digest("hex");

const isCodUnpaidOrder = (order) => (
  String(order.paymentMethod || "COD").trim().toUpperCase() === "COD" && !order.payment
);

export const isDistributorDeliveryOtpEnabled = (notificationConfig = loadNotificationConfig()) => (
  Boolean(notificationConfig.enabled && notificationConfig.sms.enabled)
);

const getAssignedOrder = async ({ tx, orderId, distributorId, requireCustomerPhone = true }) => {
  const assignment = await tx.orderAssignment.findFirst({
    where: { orderId, distributorId },
    select: { id: true, orderId: true, distributorId: true, deliveryType: true, status: true },
  });
  if (!assignment) throw fail("Assigned order not found for this distributor hub.", 404, "ASSIGNMENT_NOT_FOUND");
  if (String(assignment.deliveryType || "SELF_DELIVERY").toUpperCase() !== "SELF_DELIVERY") {
    throw fail("Customer OTP is available only for distributor self-delivery.", 409, "NOT_SELF_DELIVERY");
  }
  if (!["on_the_way", "out_for_delivery", "On the Way"].includes(assignment.status)) {
    throw fail("Move the order to 'On the Way' before requesting the customer delivery code.", 409, "INVALID_OTP_ORDER_STATUS");
  }

  const ncmDelivery = await tx.deliveryOrder.findUnique({
    where: { orderId },
    select: { id: true },
  });
  if (ncmDelivery) throw fail("This order is managed by NCM delivery.", 409, "NCM_DELIVERY_EXISTS");

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      amount: true,
      deliveryFee: true,
      payment: true,
      paymentMethod: true,
      address: true,
    },
  });
  if (!order) throw fail("Order not found.", 404, "ORDER_NOT_FOUND");
  if (!isCodUnpaidOrder(order)) {
    throw fail("A customer delivery code is only required for unpaid cash-on-delivery orders.", 409, "DELIVERY_OTP_NOT_REQUIRED");
  }

  const phone = String(parseAddress(order.address).phone || "").trim();
  if (requireCustomerPhone && (!phone || phone.length > 40)) {
    throw fail("The customer phone number is missing or invalid; place the order on hold and contact support.", 409, "CUSTOMER_PHONE_UNAVAILABLE");
  }
  return { assignment, order, phone, collectionAmount: formatCollectionAmount(order) };
};

export const issueDistributorDeliveryOtp = async ({
  distributorId,
  orderId,
  actorId = null,
  requestIp = null,
  client = prisma,
  notificationConfig = loadNotificationConfig(),
  otpConfig = loadOtpConfig(),
  otpGenerator = generateSecureOtp,
  now = new Date(),
} = {}) => {
  if (!distributorId || !orderId) throw fail("Distributor and order IDs are required.");
  const otpRequired = isDistributorDeliveryOtpEnabled(notificationConfig);
  if (!otpRequired) {
    await client.$transaction(async (tx) => {
      await getAssignedOrder({ tx, orderId, distributorId, requireCustomerPhone: false });
    });
    return {
      success: true,
      otpRequired: false,
      message: "SMS verification is disabled. Confirm customer collection to complete this COD delivery.",
    };
  }
  const secret = String(process.env.OTP_SERVER_SECRET || "");
  if (secret.length < 32) {
    throw fail("Secure customer delivery verification is not configured.", 503, "DELIVERY_OTP_UNAVAILABLE");
  }

  const code = otpGenerator(otpConfig.length);
  const activeOrderKey = `${orderId}:ACTIVE`;
  try {
    const result = await client.$transaction(async (tx) => {
      const { order, phone, collectionAmount } = await getAssignedOrder({ tx, orderId, distributorId });
      const active = await tx.deliveryOtpChallenge.findUnique({
        where: { activeOrderKey },
        select: { id: true, status: true, lastSentAt: true, expiresAt: true },
      });
      if (active && now.getTime() - new Date(active.lastSentAt).getTime() < RESEND_COOLDOWN_MS) {
        const remaining = Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - new Date(active.lastSentAt).getTime())) / 1000);
        throw fail(`Wait ${remaining} second(s) before requesting another customer code.`, 429, "DELIVERY_OTP_COOLDOWN");
      }

      if (active) {
        await tx.deliveryOtpChallenge.update({
          where: { id: active.id },
          data: { status: "SUPERSEDED", activeOrderKey: null },
        });
      }

      const challengeId = crypto.randomUUID();
      const notification = await createNotificationInTransaction({
        notificationType: "DISTRIBUTOR_DELIVERY_OTP",
        channel: "SMS",
        recipientAddress: phone,
        idempotencyKey: `delivery-otp:${challengeId}`,
        template: "DISTRIBUTOR_DELIVERY_OTP",
        payload: {
          secureContent: encryptNotificationText(
            `Your delivery verification code is ${code}. Share it only with the delivery partner at handoff. This code expires shortly.`,
          ),
        },
      }, { tx, config: notificationConfig });

      await tx.deliveryOtpChallenge.create({
        data: {
          id: challengeId,
          orderId,
          distributorId,
          activeOrderKey,
          notificationId: notification.id,
          idempotencyKey: `delivery-otp:${orderId}:${challengeId}`,
          codeHash: buildCodeHash({ code, orderId, distributorId, collectionAmount, secret }),
          collectionAmount,
          status: "PENDING",
          attemptCount: 0,
          maxAttempts: MAX_ATTEMPTS,
          expiresAt: new Date(now.getTime() + otpConfig.expiryMinutes * 60_000),
          lastSentAt: now,
          createdByAccountId: actorId,
          requestIp: requestIp ? String(requestIp).slice(0, 64) : null,
        },
      });
      return {
        success: true,
        otpRequired: true,
        message: "Customer delivery code queued securely.",
        expiresInSeconds: otpConfig.expiryMinutes * 60,
        notificationStatus: notification.status,
      };
    }, { isolationLevel: "Serializable" });
    return result;
  } catch (error) {
    if (error?.code === "P2002") {
      throw fail("A delivery code request is already being processed. Retry shortly.", 409, "DELIVERY_OTP_REQUEST_CONFLICT");
    }
    throw error;
  }
};

export const verifyDistributorDeliveryOtp = async ({
  tx,
  distributorId,
  order,
  code,
  paymentMethod = "CASH",
  actorId = null,
  now = new Date(),
} = {}) => {
  if (!tx || !order?.id || !distributorId) throw fail("Delivery verification context is incomplete.", 500);
  const normalizedPaymentMethod = String(paymentMethod).trim().toUpperCase();
  if (!["CASH", "BANK_TRANSFER", "MOBILE_WALLET", "CARD"].includes(normalizedPaymentMethod)) {
    return { error: fail("Select a valid customer payment method.", 400, "INVALID_PAYMENT_METHOD") };
  }
  const activeOrderKey = `${order.id}:ACTIVE`;
  const challenge = await tx.deliveryOtpChallenge.findUnique({
    where: { activeOrderKey },
  });
  if (!challenge || challenge.distributorId !== distributorId || challenge.status !== "PENDING") {
    return { error: fail("Request a new customer delivery code before completing this COD delivery.", 409, "DELIVERY_OTP_REQUIRED") };
  }
  if (challenge.expiresAt <= now) {
    await tx.deliveryOtpChallenge.updateMany({
      where: { id: challenge.id, status: "PENDING", activeOrderKey },
      data: { status: "EXPIRED", activeOrderKey: null },
    });
    return { error: fail("The customer delivery code has expired. Request a new code.", 409, "DELIVERY_OTP_EXPIRED") };
  }
  if (challenge.attemptCount >= challenge.maxAttempts) {
    await tx.deliveryOtpChallenge.updateMany({
      where: { id: challenge.id, status: "PENDING", activeOrderKey },
      data: { status: "LOCKED", activeOrderKey: null },
    });
    return { error: fail("The customer delivery code is locked. Request support.", 429, "DELIVERY_OTP_LOCKED") };
  }

  const collectionAmount = formatCollectionAmount(order);
  if (normalizeAmount(challenge.collectionAmount) !== collectionAmount) {
    await tx.deliveryOtpChallenge.updateMany({
      where: { id: challenge.id, status: "PENDING", activeOrderKey },
      data: { status: "SUPERSEDED", activeOrderKey: null },
    });
    return { error: fail("The order collection amount changed. Request a new customer code.", 409, "DELIVERY_OTP_AMOUNT_CHANGED") };
  }

  const normalizedCode = String(code || "").trim();
  const secret = String(process.env.OTP_SERVER_SECRET || "");
  if (secret.length < 32) throw fail("Secure customer delivery verification is not configured.", 503, "DELIVERY_OTP_UNAVAILABLE");
  const expectedHash = buildCodeHash({
    code: normalizedCode,
    orderId: order.id,
    distributorId,
    collectionAmount,
    secret,
  });
  const expected = Buffer.from(challenge.codeHash, "hex");
  const actual = Buffer.from(expectedHash, "hex");
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!matches) {
    const nextAttemptCount = challenge.attemptCount + 1;
    const locked = nextAttemptCount >= challenge.maxAttempts;
    const updated = await tx.deliveryOtpChallenge.updateMany({
      where: {
        id: challenge.id,
        status: "PENDING",
        activeOrderKey,
        attemptCount: challenge.attemptCount,
        expiresAt: { gt: now },
      },
      data: {
        attemptCount: { increment: 1 },
        ...(locked ? { status: "LOCKED", activeOrderKey: null } : {}),
      },
    });
    return {
      error: updated.count === 1
        ? fail(locked ? "The customer delivery code is locked after too many failed attempts." : "The customer delivery code is invalid.", locked ? 429 : 400, locked ? "DELIVERY_OTP_LOCKED" : "INVALID_DELIVERY_OTP")
        : fail("Delivery verification changed concurrently. Request a new code and retry.", 409, "DELIVERY_OTP_CONFLICT"),
    };
  }

  const verified = await tx.deliveryOtpChallenge.updateMany({
    where: {
      id: challenge.id,
      status: "PENDING",
      activeOrderKey,
      attemptCount: challenge.attemptCount,
      expiresAt: { gt: now },
      collectionAmount,
    },
    data: { status: "VERIFIED", verifiedAt: now, activeOrderKey: null },
  });
  if (verified.count !== 1) {
    return { error: fail("Delivery verification changed concurrently. Request a new code and retry.", 409, "DELIVERY_OTP_CONFLICT") };
  }
  return { verified: true, collectionAmount, paymentMethod: normalizedPaymentMethod, actorId };
};
