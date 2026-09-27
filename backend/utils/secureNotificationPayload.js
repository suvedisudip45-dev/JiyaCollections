import crypto from "node:crypto";

const deriveKey = (secret = process.env.OTP_SERVER_SECRET) => {
  const value = String(secret || "");
  if (value.length < 32) {
    throw new Error("OTP_SERVER_SECRET must contain at least 32 characters.");
  }
  return Buffer.from(crypto.hkdfSync(
    "sha256",
    Buffer.from(value, "utf8"),
    Buffer.from("clothes-store-admin-2fa", "utf8"),
    Buffer.from("notification-payload:aes-256-gcm:v1", "utf8"),
    32,
  ));
};

export const encryptNotificationText = (text, secret) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return {
    version: 1,
    algorithm: "AES-256-GCM",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
};

export const isEncryptedNotificationText = (value) => Boolean(
  value &&
  value.version === 1 &&
  value.algorithm === "AES-256-GCM" &&
  typeof value.iv === "string" &&
  typeof value.authTag === "string" &&
  typeof value.ciphertext === "string",
);

export const decryptNotificationText = (value, secret) => {
  if (!isEncryptedNotificationText(value)) {
    throw new Error("Encrypted notification content is invalid.");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
};