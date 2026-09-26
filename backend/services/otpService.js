import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";

const OTP_EXPIRY_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Provider abstraction for SMS / Email dispatch
 */
export const otpProvider = {
  sendSms: async (destination, code, purpose) => {
    // In production, integrate SMS gateway (e.g. Sparrow SMS, Aakash SMS, Twilio)
    if (process.env.NODE_ENV !== "production") {
      console.log(`[DEV OTP PROVIDER] SMS sent to ${destination} for ${purpose}. Code hash reference created.`);
    }
    return true;
  },
  sendEmail: async (destination, code, purpose) => {
    // In production, integrate SMTP / Sendgrid / Resend
    if (process.env.NODE_ENV !== "production") {
      console.log(`[DEV OTP PROVIDER] Email sent to ${destination} for ${purpose}. Code hash reference created.`);
    }
    return true;
  },
};

/**
 * Generates a cryptographically secure 6-digit OTP
 */
export const generateSecureOtp = () => {
  return crypto.randomInt(100000, 999999).toString();
};

/**
 * Creates an OTP Challenge in the database
 */
export const createOtpChallenge = async ({
  accountId = null,
  destination,
  channel = "SMS",
  purpose = "LOGIN",
}) => {
  const cleanDestination = String(destination || "").trim().toLowerCase();
  const now = new Date();

  // Check resend cooldown
  const recentChallenge = await prisma.otpChallenge.findFirst({
    where: {
      destination: cleanDestination,
      purpose,
      isInvalidated: false,
      createdAt: { gte: new Date(now.getTime() - RESEND_COOLDOWN_SECONDS * 1000) },
    },
    orderBy: { createdAt: "desc" },
  });

  if (recentChallenge) {
    const waitSeconds = Math.ceil(
      (recentChallenge.createdAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000
    );
    throw new Error(`Please wait ${waitSeconds} second(s) before requesting another OTP.`);
  }

  // Invalidate any previous active challenge for this destination & purpose
  await prisma.otpChallenge.updateMany({
    where: {
      destination: cleanDestination,
      purpose,
      isInvalidated: false,
    },
    data: { isInvalidated: true },
  });

  const otpCode = generateSecureOtp();
  const salt = await bcrypt.genSalt(10);
  const codeHash = await bcrypt.hash(otpCode, salt);
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);

  const challenge = await prisma.otpChallenge.create({
    data: {
      accountId,
      destination: cleanDestination,
      channel,
      purpose,
      codeHash,
      expiresAt,
      attemptCount: 0,
      maxAttempts: MAX_ATTEMPTS,
      lastSentAt: now,
    },
  });

  // Dispatch through provider
  if (channel === "SMS") {
    await otpProvider.sendSms(cleanDestination, otpCode, purpose);
  } else {
    await otpProvider.sendEmail(cleanDestination, otpCode, purpose);
  }

  return {
    challengeId: challenge.id,
    destination: cleanDestination,
    expiresInSeconds: OTP_EXPIRY_MINUTES * 60,
  };
};

/**
 * Verifies an OTP Challenge
 */
export const verifyOtpChallenge = async ({ destination, purpose, code }) => {
  const cleanDestination = String(destination || "").trim().toLowerCase();
  const now = new Date();

  const challenge = await prisma.otpChallenge.findFirst({
    where: {
      destination: cleanDestination,
      purpose,
      isInvalidated: false,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    throw new Error("No active OTP challenge found. Please request a new OTP.");
  }

  if (challenge.expiresAt < now) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { isInvalidated: true },
    });
    throw new Error("OTP has expired. Please request a new OTP.");
  }

  if (challenge.attemptCount >= challenge.maxAttempts) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { isInvalidated: true },
    });
    throw new Error("Too many failed attempts. This OTP is no longer valid.");
  }

  const isMatch = await bcrypt.compare(String(code).trim(), challenge.codeHash);
  if (!isMatch) {
    const updatedAttempts = challenge.attemptCount + 1;
    const shouldInvalidate = updatedAttempts >= challenge.maxAttempts;

    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: {
        attemptCount: updatedAttempts,
        isInvalidated: shouldInvalidate,
      },
    });

    if (shouldInvalidate) {
      throw new Error("Invalid OTP code. Maximum verification attempts reached.");
    }
    throw new Error(`Invalid OTP code. ${challenge.maxAttempts - updatedAttempts} attempt(s) remaining.`);
  }

  // Mark as verified and invalidate
  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: {
      verifiedAt: now,
      isInvalidated: true,
    },
  });

  return {
    success: true,
    accountId: challenge.accountId,
    destination: challenge.destination,
    purpose: challenge.purpose,
  };
};
