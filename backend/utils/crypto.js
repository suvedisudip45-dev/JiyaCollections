import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";

/**
 * Decrypt an AES-256-CBC encrypted password sent from the client.
 * @param {string} encryptedBase64 - Base64-encoded cipher text
 * @returns {string}               - Decrypted plaintext
 */
export const decryptAES = (encryptedBase64, ivHex = process.env.AES_IV) => {
  const key = Buffer.from(process.env.AES_SECRET_KEY, "hex");
  const iv = Buffer.from(ivHex, "hex");
  if (key.length !== 32 || iv.length !== 16) {
    throw new Error("Invalid AES configuration");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedBase64, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};
